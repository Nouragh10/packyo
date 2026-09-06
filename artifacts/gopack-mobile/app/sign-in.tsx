import { Feather } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import * as Google from "expo-auth-session/providers/google";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  auth,
  signInWithEmail,
  signInWithGoogleCredential,
  signUpWithEmail,
  signOut,
} from "@/lib/firebase";
import { GoPackIcon } from "@/components/GoPackLogo";
import colors from "@/constants/colors";

const PRIMARY = colors.light.primary;
const MUTED = colors.light.mutedForeground;
const INPUT_BG = "#FFFFFF";

WebBrowser.maybeCompleteAuthSession();

const googleClientIds = {
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
};

// Expo validates these eagerly when the hook renders. Keep a structurally
// valid inert value here so an unconfigured OAuth provider does not crash the
// whole sign-in screen; handleGoogle still blocks the request with guidance.
const hookGoogleClientIds = {
  androidClientId: googleClientIds.androidClientId ?? "missing-google-android-client-id.apps.googleusercontent.com",
  iosClientId: googleClientIds.iosClientId ?? "missing-google-ios-client-id.apps.googleusercontent.com",
  webClientId: googleClientIds.webClientId ?? "missing-google-web-client-id.apps.googleusercontent.com",
};

const googleIosRedirectScheme = googleClientIds.iosClientId
  ? `com.googleusercontent.apps.${googleClientIds.iosClientId.replace(/\.apps\.googleusercontent\.com$/, "")}`
  : null;

const googleConfigurationError = () => {
  const missing =
    Platform.OS === "android"
      ? !googleClientIds.androidClientId
      : Platform.OS === "ios"
      ? !googleClientIds.iosClientId
      : !googleClientIds.webClientId;
  if (!missing) return null;

  const variable =
    Platform.OS === "android"
      ? "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID"
      : Platform.OS === "ios"
      ? "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"
      : "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID";
  return `Google sign-in is not configured for ${Platform.OS}. Add ${variable} and rebuild the app.`;
};

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mode, setMode] = useState<"landing" | "signin" | "signup" | "verify">("landing");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resent, setResent] = useState(false);
  const redirectUri =
    Platform.OS === "ios" && googleIosRedirectScheme
      ? `${googleIosRedirectScheme}:/oauthredirect`
      : AuthSession.makeRedirectUri({
          scheme: "gopack-mobile",
          path: "sign-in",
        });
  const [, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    ...hookGoogleClientIds,
    redirectUri,
  });

  useEffect(() => {
    if (googleResponse?.type !== "success") return;
    const { authentication, params } = googleResponse;
    const idToken = authentication?.idToken ?? params.id_token;
    const accessToken = authentication?.accessToken ?? params.access_token;
    if (!idToken && !accessToken) {
      setError("Google did not return a sign-in token. Please try again.");
      return;
    }

    (async () => {
      setLoading(true);
      setError("");
      try {
        await signInWithGoogleCredential(idToken, accessToken);
        router.replace("/(tabs)");
      } catch (e: any) {
        setError(e?.message ?? "Google sign-in failed. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [googleResponse, router]);

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== "web") return;
    const params = new URLSearchParams(window.location.search);
    const devEmail = params.get("e2eEmail");
    const devPassword = params.get("e2ePassword");
    if (!devEmail || !devPassword) return;
    (async () => {
      setLoading(true);
      try {
        const cred = await signInWithEmail(devEmail, devPassword);
        if (!cred.user.emailVerified) {
          setEmail(devEmail);
          setPassword(devPassword);
          setMode("verify");
        } else {
          router.replace("/(tabs)");
        }
      } catch (e: any) {
        setError(e?.message ?? "Dev auto-login failed.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Please enter your name.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (mode === "signup") {
        await signUpWithEmail(email.trim(), password, name.trim());
        setMode("verify");
      } else {
        const cred = await signInWithEmail(email.trim(), password);
        if (!cred.user.emailVerified) {
          setMode("verify");
        } else {
          router.replace("/(tabs)");
        }
      }
    } catch (e: any) {
      const msg =
        e?.code === "auth/invalid-credential"
          ? "Incorrect email or password."
          : e?.code === "auth/email-already-in-use"
          ? "That email is already in use."
          : e?.code === "auth/weak-password"
          ? "Password must be at least 6 characters."
          : e?.message ?? "Something went wrong. Try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResent(false);
    setError("");
    try {
      const { sendEmailVerification } = await import("firebase/auth");
      const cred = await signInWithEmail(email.trim(), password);
      await sendEmailVerification(cred.user);
      await signOut();
      setResent(true);
    } catch {
      setError("Could not resend email. Try again.");
    }
  };

  const handleCheckVerified = async () => {
    setLoading(true);
    setError("");
    try {
      const cred = await signInWithEmail(email.trim(), password);
      if (cred.user.emailVerified) {
        router.replace("/(tabs)");
      } else {
        await signOut();
        setError("Email not verified yet. Check your inbox and click the link.");
      }
    } catch {
      setError("Could not sign in. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    const configurationError = googleConfigurationError();
    if (configurationError) {
      setError(configurationError);
      return;
    }

    setError("");
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // The hook handles native custom schemes and the web origin redirect.
      // A dismissed/cancelled prompt intentionally leaves the current screen unchanged.
      await promptGoogle();
    } catch (e: any) {
      setError(e?.message ?? "Could not start Google sign-in. Please try again.");
    }
  };

  if (mode === "verify") {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.verifyContainer}>
          <View style={styles.verifyIconWrap}>
            <Feather name="mail" size={36} color={PRIMARY} />
          </View>
          <Text style={styles.verifyTitle}>Verify your email</Text>
          <Text style={styles.verifyBody}>
            We sent a verification link to{"\n"}
            <Text style={styles.verifyEmail}>{email.trim()}</Text>
          </Text>
          <Text style={styles.verifyHint}>
            Open the link in your inbox, then come back and tap Continue.
          </Text>

          {!!error && <Text style={[styles.errorText, { marginBottom: 4 }]}>{error}</Text>}
          {resent && !error && (
            <Text style={styles.resentText}>Verification email resent!</Text>
          )}

          <Pressable
            style={[styles.primaryBtn, loading && styles.disabledBtn, { marginTop: 8 }]}
            onPress={handleCheckVerified}
            disabled={loading}
          >
            <Text style={styles.primaryBtnText}>
              {loading ? "Checking..." : "I've verified — Continue"}
            </Text>
          </Pressable>

          <Pressable onPress={handleResend} style={styles.toggleBtn}>
            <Text style={styles.toggleText}>Resend verification email</Text>
          </Pressable>

          <Pressable
            onPress={() => { setMode("landing"); setError(""); setResent(false); }}
            style={styles.toggleBtn}
          >
            <Text style={[styles.toggleText, { color: MUTED }]}>Back to sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (mode === "landing") {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScrollView contentContainerStyle={styles.landingScroll}>
          <View style={styles.logoSection}>
            <View style={styles.logoRow}>
              <GoPackIcon size={32} />
              <Text style={styles.wordmark}>packyo</Text>
            </View>
            <Text style={styles.landingTitle}>Planned together.{"\n"}Better trips.</Text>
            <Text style={styles.landingSub}>
              Group voting, wishlist picks,{"\n"}AI itineraries — all in one place.
            </Text>
          </View>

          <View style={styles.authButtons}>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => { setMode("signin"); setError(""); }}
            >
              <Text style={styles.primaryBtnText}>Sign in with email</Text>
            </Pressable>

            <Pressable
              style={[styles.outlineBtn, loading && styles.disabledBtn]}
              onPress={handleGoogle}
              disabled={loading}
              testID="google-sign-in"
            >
              <Feather name="globe" size={18} color="#241F1B" style={styles.btnIcon} />
              <Text style={styles.outlineBtnText}>Continue with Google</Text>
            </Pressable>

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            <Text style={styles.signupText}>
              Don't have an account?{" "}
              <Text style={styles.signupLink} onPress={() => { setMode("signup"); setError(""); }}>
                Sign up
              </Text>
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => setMode("landing")} style={styles.backBtn}>
          <Feather name="arrow-left" size={24} color="#241F1B" />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.formTitle}>
            {mode === "signin" ? "Sign In" : "Sign Up"}
          </Text>

          <View style={styles.form}>
            {mode === "signup" && (
              <TextInput
                style={styles.input}
                placeholder="Your name"
                placeholderTextColor={MUTED}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                returnKeyType="next"
              />
            )}
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={MUTED}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              returnKeyType="next"
            />
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Password"
                placeholderTextColor={MUTED}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eyeBtn}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={18}
                  color={MUTED}
                />
              </Pressable>
            </View>

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              style={[styles.primaryBtn, loading && styles.disabledBtn, { marginTop: 16 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              <Text style={styles.primaryBtnText}>
                {loading ? "Please wait..." : mode === "signin" ? "Sign In" : "Create Account"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.light.background,
  },
  landingScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
    justifyContent: "space-between",
  },
  logoSection: {
    alignItems: "flex-start",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 40,
  },
  wordmark: {
    fontFamily: "DmSans_700Bold",
    fontSize: 28,
    color: "#241F1B",
    letterSpacing: -0.5,
  },
  landingTitle: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 40,
    lineHeight: 46,
    color: "#241F1B",
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  landingSub: {
    fontFamily: "DmSans_400Regular",
    fontSize: 16,
    lineHeight: 24,
    color: "#241F1B",
  },
  authButtons: {
    gap: 12,
    marginTop: 40,
  },
  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 24,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 16,
    color: "#FFFFFF",
  },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "#E8E1D9",
  },
  btnIcon: {
    marginRight: 10,
  },
  outlineBtnText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 16,
    color: "#241F1B",
  },
  signupText: {
    textAlign: "center",
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    color: MUTED,
    marginTop: 16,
  },
  signupLink: {
    color: PRIMARY,
    fontFamily: "DmSans_600SemiBold",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  formTitle: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 32,
    color: "#241F1B",
    marginBottom: 24,
  },
  form: {
    gap: 16,
  },
  input: {
    backgroundColor: INPUT_BG,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: "DmSans_400Regular",
    color: "#241F1B",
    borderWidth: 1,
    borderColor: "#E8E1D9",
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  eyeBtn: {
    position: "absolute",
    right: 16,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  disabledBtn: {
    opacity: 0.6,
  },
  toggleBtn: {
    alignItems: "center",
    paddingVertical: 8,
  },
  toggleText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    color: MUTED,
  },
  errorText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 13,
    color: "#EF4444",
    textAlign: "center",
  },
  verifyContainer: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  verifyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  verifyTitle: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 28,
    color: "#241F1B",
    textAlign: "center",
  },
  verifyBody: {
    fontFamily: "DmSans_400Regular",
    fontSize: 15,
    color: MUTED,
    textAlign: "center",
    lineHeight: 22,
  },
  verifyEmail: {
    fontFamily: "DmSans_600SemiBold",
    color: "#241F1B",
  },
  verifyHint: {
    fontFamily: "DmSans_400Regular",
    fontSize: 13,
    color: MUTED,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  resentText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 13,
    color: "#4CAF50",
    textAlign: "center",
    marginBottom: 4,
  },
});
