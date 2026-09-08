import { getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  getReactNativePersistence,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  OAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  User,
} from "firebase/auth";
import {
  equalTo,
  get,
  getDatabase,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  set,
  update,
} from "firebase/database";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/lib/api-client";

const firebaseConfig = {
  apiKey: "AIzaSyDtdq065PaOR3xlML_fekm53h2XcPz3NAo",
  authDomain: "gopacknow-83d54.firebaseapp.com",
  databaseURL: "https://gopacknow-83d54-default-rtdb.firebaseio.com",
  projectId: "gopacknow-83d54",
  storageBucket: "gopacknow-83d54.firebasestorage.app",
  messagingSenderId: "107013969008",
  appId: "1:107013969008:web:5c6026da49efe7b58510b5",
};

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

let auth: ReturnType<typeof getAuth>;
try {
  auth = initializeAuth(app, {
    persistence:
      Platform.OS === "web"
        ? browserLocalPersistence
        : getReactNativePersistence(AsyncStorage),
    ...(Platform.OS === "web"
      ? { popupRedirectResolver: browserPopupRedirectResolver }
      : {}),
  });
} catch {
  auth = getAuth(app);
}

export { auth, onAuthStateChanged };
export type { User };

export const db = getDatabase(app);
export const storage = getStorage(app);

export const signInWithEmail = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

export const signUpWithEmail = async (
  email: string,
  password: string,
  displayName: string,
) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await sendEmailVerification(cred.user);
  await firebaseSignOut(auth);
  return cred;
};

export const signInGuest = () => signInAnonymously(auth);
export const signOut = () => firebaseSignOut(auth);

/**
 * Exchanges an OAuth token returned by the platform sign-in UI for a Firebase
 * session. The OAuth UI itself deliberately lives in the screen so this module
 * remains usable on web and native.
 */
export const signInWithGoogleCredential = (
  idToken?: string | null,
  accessToken?: string | null,
) => {
  if (!idToken && !accessToken) {
    throw new Error("Google did not return a sign-in token. Please try again.");
  }
  const credential = GoogleAuthProvider.credential(idToken ?? null, accessToken ?? null);
  return signInWithCredential(auth, credential);
};

export const signInWithAppleCredential = (
  identityToken: string,
  rawNonce?: string,
) => {
  if (!identityToken) {
    throw new Error("Apple did not return an identity token. Please try again.");
  }
  const provider = new OAuthProvider("apple.com");
  const credential = provider.credential({
    idToken: identityToken,
    rawNonce,
  });
  return signInWithCredential(auth, credential);
};

export const signInWithApplePopup = () => {
  if (Platform.OS !== "web") {
    throw new Error("Apple popup sign-in is only available in a web browser.");
  }
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  return signInWithPopup(auth, provider);
};

export const updateCurrentUserProfile = async (displayName: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("No user signed in");
  await updateProfile(currentUser, { displayName });
};

export const updateCurrentUserPhoto = async (photoURL: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("No user signed in");
  await updateProfile(currentUser, { photoURL });
};

async function isSessionRecent(user: User): Promise<boolean> {
  try {
    const tokenResult = await user.getIdTokenResult();
    const authTime = new Date(tokenResult.authTime).getTime();
    return Date.now() - authTime < 4 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Deletes the signed-in user's account through the trusted API service.
 *
 * Firebase requires a "recent" sign-in for this sensitive operation. If the
 * session is stale and the account uses email/password, this throws
 * `auth/needs-password` so the caller can prompt for a password and retry
 * with it before starting the server-side deletion.
 *
 * `wipeData` (if provided) runs only after we're confident deletion will
 * proceed (session confirmed recent, or reauthentication just succeeded),
 * before the server begins deletion. The server persists a retry marker after
 * its atomic RTDB cleanup, then deletes the Firebase Auth user.
 */
export const deleteAccount = async (password?: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("No user signed in");

  const recent = await isSessionRecent(currentUser);

  if (!recent) {
    if (currentUser.email) {
      if (!password) {
        const needsPassword = new Error("Password required to confirm deletion");
        (needsPassword as any).code = "auth/needs-password";
        throw needsPassword;
      }
      const credential = EmailAuthProvider.credential(currentUser.email, password);
      await reauthenticateWithCredential(currentUser, credential);
    } else {
      const recentLoginRequired = new Error("Please start a new guest session before deleting it");
      (recentLoginRequired as any).code = "auth/requires-recent-login";
      throw recentLoginRequired;
    }
  }

  const idToken = await currentUser.getIdToken(true);
  const response = await fetch(`${getApiBaseUrl()}/api/auth/delete-account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const result = await response.json().catch(() => ({} as { error?: string }));
  if (!response.ok) {
    const error = new Error(result.error ?? "We couldn't delete your account.");
    (error as any).code = response.status === 401 ? "auth/requires-recent-login" : "account/deletion-failed";
    throw error;
  }

  await firebaseSignOut(auth).catch(() => undefined);
};

export { equalTo, get, onValue, orderByChild, push, query, ref, set, update };
