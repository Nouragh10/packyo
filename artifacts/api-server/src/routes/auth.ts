import { Router, type IRouter, type Request, type Response } from "express";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createHash, createPublicKey, verify } from "node:crypto";
import { Resend } from "resend";
import { getAdminApp, getAdminDb } from "../lib/firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { MASCOT_PNG_BASE64 } from "../lib/email-assets";
import { VERIFICATION_SUBJECT, verificationEmailHtml, verificationEmailText } from "../lib/verification-email";

const router: IRouter = Router();
// Packyo has shipped under more than one iOS bundle identifier. Apple puts the
// signed app's bundle identifier in `aud`, independently of the Firebase app
// registration. Accept the known Packyo identifiers while users migrate builds.
const APPLE_NATIVE_AUDIENCES = new Set([
  "com.gopack.app",
  "com.gopacknow.app",
  "com.gopack.mobile",
]);
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_KEYS_TTL_MS = 60 * 60 * 1000;

type ApplePublicKey = {
  kid: string;
  kty: string;
  use: string;
  alg: string;
  n: string;
  e: string;
};

type AppleIdentityClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
};

let appleKeysCache: { keys: ApplePublicKey[]; expiresAt: number } | null = null;

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

async function getApplePublicKeys(): Promise<ApplePublicKey[]> {
  if (appleKeysCache && appleKeysCache.expiresAt > Date.now()) {
    return appleKeysCache.keys;
  }

  const response = await fetch(APPLE_KEYS_URL);
  if (!response.ok) {
    throw new Error("Apple sign-in verification is temporarily unavailable.");
  }
  const body = await response.json() as { keys?: ApplePublicKey[] };
  if (!body.keys?.length) {
    throw new Error("Apple sign-in verification returned no public keys.");
  }

  appleKeysCache = {
    keys: body.keys,
    expiresAt: Date.now() + APPLE_KEYS_TTL_MS,
  };
  return body.keys;
}

async function verifyAppleIdentityToken(identityToken: string, rawNonce: string) {
  const parts = identityToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Apple returned an invalid identity token.");
  }

  const header = decodeJwtPart<{ alg?: string; kid?: string }>(parts[0]);
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Apple returned an unsupported identity token.");
  }

  const key = (await getApplePublicKeys()).find((candidate) => candidate.kid === header.kid);
  if (!key) {
    appleKeysCache = null;
    const refreshedKey = (await getApplePublicKeys()).find((candidate) => candidate.kid === header.kid);
    if (!refreshedKey) throw new Error("Apple's signing key could not be found.");
    return verifyAppleIdentityTokenWithKey(parts, rawNonce, refreshedKey);
  }

  return verifyAppleIdentityTokenWithKey(parts, rawNonce, key);
}

function verifyAppleIdentityTokenWithKey(
  parts: string[],
  rawNonce: string,
  key: ApplePublicKey,
): AppleIdentityClaims & { sub: string } {
  const validSignature = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key, format: "jwk" }),
    Buffer.from(parts[2], "base64url"),
  );
  if (!validSignature) throw new Error("Apple identity token signature is invalid.");

  const claims = decodeJwtPart<AppleIdentityClaims>(parts[1]);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const expectedNonce = createHash("sha256").update(rawNonce).digest("hex");

  if (claims.iss !== APPLE_ISSUER) throw new Error("Apple identity token issuer is invalid.");
  if (!audiences.some((audience) => audience && APPLE_NATIVE_AUDIENCES.has(audience))) {
    throw new Error("This Apple sign-in was issued for a different Packyo app.");
  }
  if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Apple identity token has expired.");
  }
  if (!claims.sub) throw new Error("Apple identity token has no user identifier.");
  if (claims.nonce !== expectedNonce) throw new Error("Apple sign-in nonce verification failed.");

  return claims as AppleIdentityClaims & { sub: string };
}

function getFirebaseAdminAuth() {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Email verification is not configured.");
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: "gopacknow-83d54",
        clientEmail,
        privateKey,
      }),
    });
  }

  return getAuth();
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Email verification is not configured.");
  }
  return new Resend(apiKey);
}

router.post("/auth/apple-native", async (req: Request, res: Response) => {
  const { identityToken, rawNonce } = req.body as {
    identityToken?: string;
    rawNonce?: string;
  };
  if (!identityToken || identityToken.length > 10_000 || !rawNonce || rawNonce.length > 200) {
    res.status(400).json({ error: "Apple sign-in credentials are missing or invalid." });
    return;
  }

  try {
    const claims = await verifyAppleIdentityToken(identityToken, rawNonce);
    const adminAuth = getFirebaseAdminAuth();
    const emailVerified =
      claims.email_verified === true || claims.email_verified === "true";
    let uid = `apple:${createHash("sha256").update(claims.sub).digest("hex")}`;

    if (claims.email && emailVerified) {
      try {
        uid = (await adminAuth.getUserByEmail(claims.email)).uid;
      } catch (error: any) {
        if (error?.code !== "auth/user-not-found") throw error;
      }
    }

    try {
      await adminAuth.getUser(uid);
    } catch (error: any) {
      if (error?.code !== "auth/user-not-found") throw error;
      await adminAuth.createUser({
        uid,
        email: claims.email && emailVerified ? claims.email : undefined,
        emailVerified,
      });
    }

    const customToken = await adminAuth.createCustomToken(uid, {
      signInProvider: "apple.com",
      appleSubject: claims.sub,
    });
    res.json({ customToken });
  } catch (error) {
    req.log.warn({ error }, "native Apple sign-in failed");
    res.status(401).json({
      error: error instanceof Error ? error.message : "Apple sign-in failed.",
    });
  }
});

// Sends the Packyo-branded "confirm your email" message. The caller must be signed in
// as the account being verified; uid and email come from the ID token, never the body.
const VERIFY_RESEND_COOLDOWN_MS = 60_000;

router.post("/auth/send-verification", async (req: Request, res: Response) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }

  try {
    const adminAuth = getFirebaseAdminAuth();
    let uid: string;
    try {
      uid = (await adminAuth.verifyIdToken(token)).uid;
    } catch {
      res.status(401).json({ error: "Your sign-in expired. Please sign in again." });
      return;
    }
    const user = await adminAuth.getUser(uid);
    if (!user.email) {
      res.status(400).json({ error: "This account has no email address." });
      return;
    }
    if (user.emailVerified) {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }

    // One email per minute per account, so the endpoint can't be used to flood an inbox.
    const now = Date.now();
    const gate = await getAdminDb()
      .ref(`emailVerificationSends/${uid}`)
      .transaction((last: number | null) => (last && now - last < VERIFY_RESEND_COOLDOWN_MS ? undefined : now));
    if (!gate.committed) {
      res.status(429).json({ error: "We just sent one. Check your inbox (and spam) before asking again." });
      return;
    }

    const verifyUrl = await adminAuth.generateEmailVerificationLink(user.email);
    const base = process.env.PUBLIC_API_URL?.replace(/\/+$/, "") ?? `https://${req.get("host")}`;
    const { error } = await getResendClient().emails.send({
      from: process.env.EMAIL_FROM ?? "Packyo <hello@packyo.app>",
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      to: user.email,
      subject: VERIFICATION_SUBJECT,
      html: verificationEmailHtml(verifyUrl, user.displayName, `${base}/api/email/mascot.png`),
      text: verificationEmailText(verifyUrl, user.displayName),
    });

    if (error) {
      await getAdminDb().ref(`emailVerificationSends/${uid}`).remove().catch(() => undefined);
      req.log.error({ error }, "Resend error");
      res.status(502).json({ error: "Failed to send email" });
      return;
    }

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "send-verification error");
    res.status(500).json({ error: "Could not send the email right now." });
  }
});

const MASCOT_PNG = Buffer.from(MASCOT_PNG_BASE64, "base64");
router.get("/email/mascot.png", (_req: Request, res: Response) => {
  res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
  res.send(MASCOT_PNG);
});

router.post("/auth/delete-account", async (req: Request, res: Response) => {
  const authorization = req.get("authorization");
  const idToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!idToken) {
    res.status(401).json({ error: "Sign in again before deleting your account." });
    return;
  }

  let uid: string;
  let tokenIsFresh = false;
  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(idToken, true);
    uid = decoded.uid;
    tokenIsFresh = Date.now() / 1000 - (decoded.auth_time ?? 0) <= 4 * 60;
  } catch {
    res.status(401).json({ error: "Your sign-in has expired. Please sign in again." });
    return;
  }

  const adminDb = getAdminDb();
  const deletionRef = adminDb.ref(`accountDeletion/${uid}`);

  try {
    const pendingDeletion = await deletionRef.get();

    // A marker means the RTDB cleanup completed in an earlier request but the
    // Auth deletion response was interrupted. Retrying finishes the account
    // removal without touching trip records a second time.
    if (!pendingDeletion.exists()) {
      if (!tokenIsFresh) {
        res.status(401).json({ error: "Please sign in again before deleting your account." });
        return;
      }
      const userTrips = await adminDb.ref(`userTrips/${uid}`).get();
      const tripIds = userTrips.exists()
        ? Object.keys(userTrips.val() as Record<string, unknown>)
        : [];
      const tripSnapshots = await Promise.all(
        tripIds.map(async (tripId) => ({
          tripId,
          trip: await adminDb.ref(`trips/${tripId}`).get(),
        })),
      );
      const updates: Record<string, unknown> = {
        [`userTrips/${uid}`]: null,
        [`emailVerificationSends/${uid}`]: null,
        [`accountDeletion/${uid}`]: {
          status: "database_cleaned",
          updatedAt: Date.now(),
        },
      };

      for (const { tripId, trip } of tripSnapshots) {
        if (!trip.exists()) continue;
        if (trip.val()?.hostMemberId === uid) {
          updates[`trips/${tripId}`] = null;
          updates[`itineraryUnlocks/${tripId}`] = null;
        } else {
          updates[`trips/${tripId}/members/${uid}`] = null;
          updates[`trips/${tripId}/memberReviews/${uid}`] = null;
          if (trip.val()?.review?.reviewedBy === uid) updates[`trips/${tripId}/review`] = null;
          updates[`itineraryUnlocks/${tripId}/members/${uid}`] = null;
        }
      }

      // Public reviews (Discover) this user wrote, including ones for trips they've left.
      const publicReviews = await adminDb.ref("reviews").orderByChild("reviewedBy").equalTo(uid).get();
      publicReviews.forEach((r) => {
        updates[`reviews/${r.key}`] = null;
      });

      // Firebase applies this multi-location update atomically. It records a
      // durable retry marker only if every account-data mutation succeeds.
      await adminDb.ref().update(updates);
    }

    // Profile photo in Cloud Storage. Best effort: a storage hiccup shouldn't
    // block deleting the account itself.
    await getStorage(getAdminApp())
      .bucket("gopacknow-83d54.firebasestorage.app")
      .deleteFiles({ prefix: `profilePhotos/${uid}/` })
      .catch((err) => req.log.warn({ err, uid }, "delete-account: profile photo cleanup failed"));

    await getFirebaseAdminAuth().deleteUser(uid).catch((err: { code?: string }) => {
      if (err.code !== "auth/user-not-found") throw err;
    });
    await deletionRef.remove().catch((err) => {
      req.log.warn({ err, uid }, "delete-account marker cleanup failed");
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, uid }, "delete-account error");
    res.status(500).json({
      error: "We couldn't finish deleting your account. Please retry; Packyo will safely resume the deletion.",
    });
  }
});

export default router;
