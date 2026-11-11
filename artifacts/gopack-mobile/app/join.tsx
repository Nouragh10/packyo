import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { joinTrip } from "@/hooks/useFirebase";
import { track } from "@/lib/analytics";

export default function JoinScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const handleJoin = async () => {
    const inviteInput = (code.trim() || link.trim()).replace(/\s+/g, "");
    if (!inviteInput) {
      setError("Enter an invite code or paste an invite link.");
      return;
    }
    if (!user) {
      setError("You must be signed in to join a trip.");
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const tripId = await joinTrip(
        inviteInput,
        user.uid,
        user.displayName ?? "Traveler",
      );
      track("trip_joined");
      router.replace(`/trip/${tripId}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Trip not found.";
      setError(message.includes("not found") ? "We couldn't find that invite. Check the code and try again." : message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <Pressable
          onPress={() => {
            if (router.canDismiss()) {
              router.dismiss();
            } else {
              router.replace("/(tabs)");
            }
          }}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>Join a trip</Text>
        
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.foreground }]}>Enter invite code</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: error ? colors.destructive : colors.border,
                color: colors.foreground,
              },
            ]}
             placeholder="ABC123"
            placeholderTextColor={colors.mutedForeground}
            value={code}
            onChangeText={(t) => {
              setCode(t);
              setLink("");
              setError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleJoin}
          />
        </View>

        <Text style={[styles.orText, { color: colors.mutedForeground }]}>or</Text>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.foreground }]}>Paste invite link</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: error ? colors.destructive : colors.border,
                color: colors.foreground,
              },
            ]}
             placeholder="packyo.com/join/ABC123"
            placeholderTextColor={colors.mutedForeground}
            value={link}
            onChangeText={(t) => {
              setLink(t);
              setCode("");
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleJoin}
          />
        </View>

        {error && (
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        )}

        <Pressable
          onPress={handleJoin}
          disabled={loading || (!code.trim() && !link.trim())}
          style={[
            styles.joinBtn,
            { backgroundColor: code.trim() || link.trim() ? colors.primary : colors.muted },
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.joinBtnText}>Join Trip</Text>
          )}
        </Pressable>

        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          Need an invite?{"\n"}Ask your trip leader for the code or invite link.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  backBtn: { padding: 4 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 16,
  },
  title: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 32, marginBottom: 12 },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontFamily: "DmSans_500Medium",
    fontSize: 14,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontFamily: "DmSans_400Regular",
    fontSize: 16,
  },
  orText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    textAlign: "center",
    marginVertical: 4,
  },
  errorText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  joinBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    paddingVertical: 16,
    marginTop: 16,
  },
  joinBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 16, color: "#fff" },
  helpText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 24,
  },
});
