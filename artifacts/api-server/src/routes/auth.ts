import { Router, type IRouter, type Request, type Response } from "express";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createHash, createPublicKey, verify } from "node:crypto";
import { Resend } from "resend";
import { getAdminDb } from "../lib/firebase-admin";

const router: IRouter = Router();
const APPLE_NATIVE_AUDIENCE = "com.gopack.app";
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
  if (!audiences.includes(APPLE_NATIVE_AUDIENCE)) {
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

function buildEmailHtml(verifyUrl: string, displayName: string): string {
  const firstName = displayName?.split(" ")[0] ?? "there";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your GoPackNow email</title>
</head>
<body style="margin:0;padding:0;background:#F5F0EB;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0EB;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo / Header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#E85D3A;border-radius:20px;width:64px;height:64px;text-align:center;vertical-align:middle;">
                    <span style="font-size:32px;line-height:64px;">🧳</span>
                  </td>
                </tr>
              </table>
              <div style="margin-top:16px;font-size:28px;font-weight:700;color:#E85D3A;letter-spacing:-0.5px;">GoPackNow</div>
              <div style="font-size:14px;color:#8B7E75;margin-top:4px;">Plan trips together</div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#FFFFFF;border-radius:20px;padding:48px 48px 40px;box-shadow:0 2px 16px rgba(0,0,0,0.06);">

              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#1A1412;letter-spacing:-0.3px;">
                Confirm your email, ${firstName} 👋
              </h1>
              <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#5C5047;">
                Welcome to GoPackNow! You're one step away from planning epic trips with your crew. Click the button below to verify your email address.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:32px;">
                    <a href="${verifyUrl}"
                       style="display:inline-block;background:#E85D3A;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:16px 40px;border-radius:14px;letter-spacing:0.2px;">
                      Verify my email →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="border-top:1px solid #F0EAE4;"></td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#8B7E75;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:12px;color:#B0A49A;word-break:break-all;line-height:1.5;">
                ${verifyUrl}
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 0 0;">
              <p style="margin:0 0 4px;font-size:13px;color:#B0A49A;">
                This link expires in 24 hours. If you didn't create a GoPackNow account, you can safely ignore this email.
              </p>
              <p style="margin:0;font-size:13px;color:#B0A49A;">
                — The GoPackNow Team · <a href="https://gopack.now" style="color:#E85D3A;text-decoration:none;">gopack.now</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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

router.post("/auth/send-verification", async (req: Request, res: Response) => {
  const { uid, email, displayName } = req.body as {
    uid?: string;
    email?: string;
    displayName?: string;
  };

  if (!uid || !email) {
    res.status(400).json({ error: "uid and email are required" });
    return;
  }

  try {
    const verifyUrl = await getFirebaseAdminAuth().generateEmailVerificationLink(email);

    const { error } = await getResendClient().emails.send({
      from: "GoPackNow <onboarding@resend.dev>",
      to: email,
      subject: "Confirm your GoPackNow email address",
      html: buildEmailHtml(verifyUrl, displayName ?? ""),
    });

    if (error) {
      req.log.error({ error }, "Resend error");
      res.status(500).json({ error: "Failed to send email" });
      return;
    }

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "send-verification error");
    res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
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
        [`accountDeletion/${uid}`]: {
          status: "database_cleaned",
          updatedAt: Date.now(),
        },
      };

      for (const { tripId, trip } of tripSnapshots) {
        if (!trip.exists()) continue;
        if (trip.val()?.hostMemberId === uid) {
          updates[`trips/${tripId}`] = null;
        } else {
          updates[`trips/${tripId}/members/${uid}`] = null;
        }
      }

      // Firebase applies this multi-location update atomically. It records a
      // durable retry marker only if every account-data mutation succeeds.
      await adminDb.ref().update(updates);
    }

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
