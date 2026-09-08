import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-client";
import {
  AccommodationSuggestion,
  addMemberAccommodationLink,
  setAccommodationStatus,
  useTrip,
} from "@/hooks/useFirebase";

export default function AccommodationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { trip, loading } = useTrip(id);

  const [isPasting, setIsPasting] = useState(false);
  const [link, setLink] = useState("");
  const [cost, setCost] = useState("");
  const [submittingLink, setSubmittingLink] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 24;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "DmSans_400Regular" }}>Trip not found</Text>
      </View>
    );
  }

  const handleAI = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/accommodation-preferences/${id}`);
  };

  const handlePasteSubmit = async () => {
    if (!link.trim()) {
      Alert.alert("Link required", "Please paste a link to an accommodation.");
      return;
    }

    setSubmittingLink(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const res = await apiFetch("/api/parse-accommodation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: link.trim(),
          destination: trip.destination,
        }),
      });

      if (!res.ok) {
        throw new Error("Could not parse accommodation link. Make sure the URL is valid.");
      }

      const parsed = await res.json();
      const totalCostNum = parseFloat(cost.replace(/[^0-9.]/g, "")) || 0;
      const memberCount = Object.keys(trip.members ?? {}).length || 1;

      const suggestion: AccommodationSuggestion = {
        id: `link-${Date.now()}`,
        name: parsed.name || "Suggested Place",
        type: parsed.type || "other",
        location: parsed.location || trip.destination || "Unknown location",
        totalCost: totalCostNum,
        costPerPerson: totalCostNum > 0 ? Math.round(totalCostNum / memberCount) : 0,
        nights: trip.days || 1,
        rating: parsed.rating || 0,
        amenities: parsed.amenities || [],
        rooms: parsed.rooms || 1,
        beds: parsed.beds || 1,
        cancellation: parsed.cancellation || "Flexible",
        whyItFits: parsed.whyItFits || "Suggested by a group member.",
        tags: parsed.tags || [],
        distanceNote: parsed.distanceNote || "",
        link: link.trim(),
        photos: parsed.photos || [],
        submittedBy: user?.displayName || "Member",
      };

      await addMemberAccommodationLink(id, suggestion);
      // Wait for firebase sync
      await new Promise((resolve) => setTimeout(resolve, 300));
      router.replace(`/accommodation-vote/${id}`);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to add accommodation.");
    } finally {
      setSubmittingLink(false);
    }
  };

  const handleSkip = async () => {
    setSkipping(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await setAccommodationStatus(id, "skipped");
      router.replace(`/building/${id}`);
    } catch (err) {
      Alert.alert("Error", "Failed to skip accommodation.");
    } finally {
      setSkipping(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerLabel, { color: colors.primary }]}>STEP 1 OF 4</Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Accommodation</Text>
        </View>
      </View>

      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomInset, paddingHorizontal: 16, paddingTop: 24 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <View style={styles.intro}>
          <Text style={[styles.title, { color: colors.foreground }]}>Where is the pack staying?</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Choose how you want to find your accommodation. You can let AI find the best spot or bring your own ideas.
          </Text>
        </View>

        <View style={styles.options}>
          {/* AI Option */}
          <Pressable
            onPress={handleAI}
            style={({ pressed }) => [
              styles.card,
              styles.cardHeader,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.primary + "15" }]}>
              <Feather name="zap" size={20} color={colors.primary} />
            </View>
            <View style={styles.cardContent}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Let AI generate an accommodation for you</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                Everyone submits their budget and needs, and we'll curate a shortlist for the group.
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>

          {/* Paste Link Option */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: isPasting ? colors.primary : colors.border }]}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setIsPasting(!isPasting);
              }}
              style={styles.cardHeader}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
                <Feather name="link" size={20} color={colors.foreground} />
              </View>
              <View style={styles.cardContent}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Paste an accommodation link and vote</Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                  Found a great Airbnb or hotel? Paste the link and let the group vote on it.
                </Text>
              </View>
              <Feather name={isPasting ? "chevron-up" : "chevron-down"} size={20} color={colors.mutedForeground} />
            </Pressable>

            {isPasting && (
              <View style={[styles.form, { borderTopColor: colors.border }]}>
                <View>
                  <Text style={[styles.label, { color: colors.foreground }]}>Listing URL</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="https://airbnb.com/..."
                    placeholderTextColor={colors.mutedForeground}
                    value={link}
                    onChangeText={setLink}
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </View>
                
                <View>
                  <Text style={[styles.label, { color: colors.foreground }]}>Total Cost (Optional)</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="e.g. 1200"
                    placeholderTextColor={colors.mutedForeground}
                    value={cost}
                    onChangeText={setCost}
                    keyboardType="numeric"
                  />
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    We'll split this by the {Object.keys(trip.members ?? {}).length} members in your group.
                  </Text>
                </View>

                <Pressable
                  onPress={handlePasteSubmit}
                  disabled={submittingLink || !link.trim()}
                  style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: submittingLink || !link.trim() ? 0.6 : 1 }]}
                >
                  {submittingLink ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.submitBtnText}>Add and start voting</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </View>

        <View style={styles.hostSection}>
          <Pressable
            onPress={handleSkip}
            disabled={skipping}
            style={[styles.skipBtn, { borderColor: colors.border }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
              <Feather name="check-square" size={20} color={colors.foreground} />
            </View>
            <View style={styles.cardContent}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Already decided on accommodation? Generate itinerary</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                Skip accommodation planning and move straight to building the itinerary.
              </Text>
            </View>
            {skipping ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Feather name="arrow-right" size={20} color={colors.mutedForeground} />
            )}
          </Pressable>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12,
  },
  backBtn: { padding: 4 },
  headerLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11, letterSpacing: 2, textTransform: "uppercase" },
  headerTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20 },

  intro: { marginBottom: 28 },
  title: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 28, marginBottom: 12 },
  subtitle: { fontFamily: "DmSans_400Regular", fontSize: 15, lineHeight: 22 },

  options: { gap: 16 },
  
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 16,
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontFamily: "DmSans_700Bold",
    fontSize: 16,
  },
  cardSub: {
    fontFamily: "DmSans_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },

  form: {
    padding: 16,
    borderTopWidth: 1,
    gap: 16,
    backgroundColor: "transparent",
  },
  label: {
    fontFamily: "DmSans_500Medium",
    fontSize: 13,
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontFamily: "DmSans_400Regular",
    fontSize: 15,
  },
  hint: {
    fontFamily: "DmSans_400Regular",
    fontSize: 12,
    marginTop: 6,
  },
  
  submitBtn: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitBtnText: {
    color: "#fff",
    fontFamily: "DmSans_600SemiBold",
    fontSize: 15,
  },

  hostSection: {
    marginTop: 40,
  },
  hostDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },
  line: {
    flex: 1,
    height: 1,
  },
  hostDividerText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  skipBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
});
