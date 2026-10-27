import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-client";
import { sendTripPush } from "@/lib/push-notifications";
import {
  AccommodationPreference,
  AccommodationSuggestion,
  setAccommodationStatus,
  mergeAiAccommodationSuggestions,
  submitAccommodationPreference,
  useTrip,
} from "@/hooks/useFirebase";
import { SavedStaySuggestionPicker } from "@/components/SavedItemPickers";

const TEAL = "#26A69A";

const TYPES = [
  { value: "hotel", label: "Hotel", icon: "home" },
  { value: "airbnb", label: "Airbnb", icon: "key" },
  { value: "hostel", label: "Hostel", icon: "users" },
  { value: "no_preference", label: "No preference", icon: "help-circle" },
] as const;

const AMENITIES = [
  "WiFi", "Pool", "Kitchen", "Gym", "Parking",
  "AC", "Breakfast", "Pet-friendly", "Washer",
];

const PRIORITIES = [
  { value: "affordability", label: "Best value" },
  { value: "balanced", label: "Balanced" },
  { value: "luxury", label: "Luxury" },
] as const;

const MEMBER_COLORS = ["#F15A3A", "#F4BC55", "#A77BD6", "#68B7A0", "#EE9D54", "#6EA6D8"];

function Avatar({ name, index, size = 28 }: { name: string; index: number; size?: number }) {
  const bg = MEMBER_COLORS[index % MEMBER_COLORS.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#fff" }}>
      <Text style={{ color: "#fff", fontSize: size * 0.38, fontFamily: "DmSans_700Bold" }}>
        {(name ?? "?")[0].toUpperCase()}
      </Text>
    </View>
  );
}

export default function AccommodationPreferencesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { trip, loading } = useTrip(id);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const myPref = trip?.accommodationPreferences?.[user?.uid ?? ""];
  const alreadySubmitted = !!myPref;

  const [maxCost, setMaxCost] = useState(300);
  const [type, setType] = useState<AccommodationPreference["type"]>("no_preference");
  const [rooms, setRooms] = useState(1);
  const [location, setLocation] = useState("");
  const [amenities, setAmenities] = useState<string[]>([]);
  const [priority, setPriority] = useState<AccommodationPreference["priority"]>("balanced");
  const [cancellation, setCancellation] = useState<AccommodationPreference["cancellation"]>("any");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (myPref) {
      setMaxCost(myPref.maxCostPerPerson ?? 300);
      setType(myPref.type ?? "no_preference");
      setRooms(myPref.rooms ?? 1);
      setLocation(myPref.location ?? "");
      setAmenities(myPref.amenities ?? []);
      setPriority(myPref.priority ?? "balanced");
      setCancellation(myPref.cancellation ?? "any");
    }
  }, [alreadySubmitted]);

  const members = Object.entries(trip?.members ?? {});
  const memberPrefs = trip?.accommodationPreferences ?? {};
  const submittedUids = Object.keys(memberPrefs);
  const totalMembers = members.length;
  const submittedCount = submittedUids.length;
  const isCreator = trip?.hostMemberId === user?.uid;
  const rawSuggestions = trip?.accommodationSuggestions as AccommodationSuggestion[] | Record<string, AccommodationSuggestion> | undefined;
  const existingSuggestions: AccommodationSuggestion[] = Array.isArray(rawSuggestions) ? rawSuggestions : Object.values(rawSuggestions ?? {});
  const savedSuggestionCount = existingSuggestions.filter((sg) => String(sg?.id ?? "").startsWith("saved-")).length;

  const toggleAmenity = (a: string) => {
    setAmenities((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  };

  const handleSubmit = async () => {
    if (!user || !id) return;
    setError("");
    setSubmitting(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await submitAccommodationPreference(id, user.uid, {
        maxCostPerPerson: maxCost,
        type,
        rooms,
        location: location.trim(),
        amenities,
        priority,
        cancellation,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerate = async () => {
    if (!id || !trip) return;
    setGenerating(true);
    setError("");
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      const memberPrefsList = Object.entries(memberPrefs).map(([uid, pref]) => ({
        name: trip.members[uid]?.name ?? "Member",
        maxCostPerPerson: pref.maxCostPerPerson,
        type: pref.type,
        rooms: pref.rooms,
        location: pref.location,
        amenities: pref.amenities,
        priority: pref.priority,
        cancellation: pref.cancellation,
      }));

      const res = await apiFetch("/api/suggest-accommodations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: trip.destination,
          days: trip.days,
          memberCount: totalMembers,
          memberPreferences: memberPrefsList,
        }),
      });

      if (!res.ok) {
        const errData = await res.json() as { error?: string };
        throw new Error(errData.error ?? "AI couldn't generate suggestions. Try again.");
      }
      const data = await res.json() as { suggestions: any[] };
      if (!data.suggestions?.length) throw new Error("No suggestions returned.");

      // The AI is shown a single example with id "opt-1" and often echoes that
      // literal id for every suggestion. Duplicate ids become duplicate React
      // keys in the vote screen's list, which makes votes appear to land on
      // the wrong card. Always assign our own unique ids instead of trusting
      // the model's output.
      const suggestionsWithUniqueIds = data.suggestions.map((s, i) => ({
        ...s,
        id: `ai-${Date.now()}-${i}`,
      }));

      // Merged in a transaction against the live list so saved-stay picks
      // added while the AI was running are never overwritten.
      await mergeAiAccommodationSuggestions(id, suggestionsWithUniqueIds);
      await sendTripPush(
        id,
        `Vote on stays for ${trip.destination || "your trip"}`,
        `${suggestionsWithUniqueIds.length} accommodation options are ready.`,
        `/accommodation-vote/${id}`,
      );
      router.replace(`/accommodation-vote/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleSkipAccommodation = async () => {
    if (!id || !isCreator) return;
    setError("");
    setGenerating(true);
    try {
      await setAccommodationStatus(id, "skipped");
      router.replace(`/building/${id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "We couldn't skip accommodation right now.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={TEAL} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerLabel, { color: colors.primary }]}>STEP 1 OF 4</Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Everyone's preferences</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={[styles.progressBar, { backgroundColor: colors.muted }]}>
        <View style={[styles.progressFill, { backgroundColor: colors.primary, width: totalMembers > 0 ? `${(submittedCount / totalMembers) * 100}%` : "0%" }]} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
      >
        {/* Status card */}
        <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statusTitle, { color: colors.foreground }]}>
            {submittedCount} of {totalMembers} submitted
          </Text>
          <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>
            Everyone tells us what they need — AI finds the best option for the whole group.
          </Text>
          <View style={styles.membersRow}>
            {members.map(([uid, m], i) => {
              const submitted = !!memberPrefs[uid];
              return (
                <View key={uid} style={styles.memberChip}>
                  <View style={{ position: "relative" }}>
                    <Avatar name={m.name} index={i} size={34} />
                    {submitted && (
                      <View style={styles.checkBadge}>
                        <Feather name="check" size={9} color="#fff" />
                      </View>
                    )}
                  </View>
                  <Text style={[styles.memberName, { color: submitted ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
                    {m.name.split(" ")[0]}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Generate button — creator only */}
        {isCreator && (
          <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 }}>
            <Pressable
              onPress={handleGenerate}
              disabled={generating}
              style={[styles.generateBtn, { backgroundColor: colors.primary, opacity: generating ? 0.7 : 1 }]}
            >
              {generating ? (
                <View style={styles.btnRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.generateBtnText}>Finding best options…</Text>
                </View>
              ) : (
                <View style={styles.btnRow}>
                  <Feather name="zap" size={16} color="#fff" />
                  <Text style={styles.generateBtnText}>
                    Find accommodation{submittedCount < totalMembers ? ` (${totalMembers - submittedCount} still pending)` : ""}
                  </Text>
                </View>
              )}
            </Pressable>
            {submittedCount < totalMembers && (
              <Text style={[styles.generateHint, { color: colors.mutedForeground }]}>
                You can generate now or wait for everyone to submit first.
              </Text>
            )}
            <Pressable
              onPress={handleSkipAccommodation}
              disabled={generating}
              style={[styles.skipButton, { borderColor: colors.border, opacity: generating ? 0.55 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Skip accommodation because it is already booked"
            >
              <Feather name="check-circle" size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.skipButtonTitle, { color: colors.foreground }]}>We already have a place</Text>
                <Text style={[styles.skipButtonCopy, { color: colors.mutedForeground }]}>
                  Skip stay voting and build the itinerary now.
                </Text>
              </View>
              <Feather name="arrow-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}

        {trip && id ? (
          <SavedStaySuggestionPicker
            key={user?.uid ?? "signed-out"}
            tripId={id}
            trip={trip}
            uid={user?.uid}
            displayName={user?.displayName ?? "Member"}
          />
        ) : null}
        {savedSuggestionCount > 0 ? (
          <Text style={[styles.generateHint, { color: colors.mutedForeground, paddingHorizontal: 16 }]}>
            {savedSuggestionCount} saved {savedSuggestionCount === 1 ? "stay is" : "stays are"} ready for the vote and will be kept alongside new options.
          </Text>
        ) : null}

        {!!error && (
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        )}

        {/* Form */}
        <View style={styles.form}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {alreadySubmitted ? "Your preferences (edit anytime)" : "Your preferences"}
          </Text>

          {alreadySubmitted && (
            <View style={[styles.submittedBadge, { backgroundColor: "#4CAF5020", borderColor: "#4CAF5040" }]}>
              <Feather name="check-circle" size={14} color="#4CAF50" />
              <Text style={[styles.submittedText, { color: "#4CAF50" }]}>Submitted — you can still update</Text>
            </View>
          )}

          {/* Max cost per person */}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Max budget per person / night</Text>
            <View style={styles.daysRow}>
              <Pressable onPress={() => setMaxCost((c) => Math.max(50, c - 50))} style={[styles.dayBtn, { borderColor: colors.border }]}>
                <Feather name="minus" size={18} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.daysNum, { color: colors.primary }]}>${maxCost}</Text>
              <Pressable onPress={() => setMaxCost((c) => Math.min(5000, c + 50))} style={[styles.dayBtn, { borderColor: colors.border }]}>
                <Feather name="plus" size={18} color={colors.foreground} />
              </Pressable>
            </View>
          </View>

          {/* Type */}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Accommodation type</Text>
            <View style={styles.chipGrid}>
              {TYPES.map((t) => {
                const selected = type === t.value;
                return (
                  <Pressable
                    key={t.value}
                    onPress={() => setType(t.value)}
                    style={[styles.typeChip, { backgroundColor: selected ? colors.primary + "15" : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                  >
                    <Feather name={t.icon as any} size={14} color={selected ? colors.primary : colors.foreground} />
                    <Text style={[styles.chipText, { color: selected ? colors.primary : colors.foreground }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Rooms */}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Number of rooms</Text>
            <View style={styles.daysRow}>
              <Pressable onPress={() => setRooms((r) => Math.max(1, r - 1))} style={[styles.dayBtn, { borderColor: colors.border }]}>
                <Feather name="minus" size={18} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.daysNum, { color: colors.foreground }]}>{rooms}</Text>
              <Text style={[styles.daysLabel, { color: colors.mutedForeground }]}>room{rooms !== 1 ? "s" : ""}</Text>
              <Pressable onPress={() => setRooms((r) => Math.min(10, r + 1))} style={[styles.dayBtn, { borderColor: colors.border }]}>
                <Feather name="plus" size={18} color={colors.foreground} />
              </Pressable>
            </View>
          </View>

          {/* Location preference */}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Preferred area / near what? (optional)</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="map-pin" size={16} color={colors.primary} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="e.g. city center, near the beach…"
                placeholderTextColor={colors.mutedForeground}
                value={location}
                onChangeText={setLocation}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Amenities */}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Must-have amenities</Text>
            <View style={styles.chipGrid}>
              {AMENITIES.map((a) => {
                const selected = amenities.includes(a);
                return (
                  <Pressable
                    key={a}
                    onPress={() => toggleAmenity(a)}
                    style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.muted, borderColor: selected ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]}>{a}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Priority */}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>What matters most?</Text>
            <View style={styles.chipRow}>
              {PRIORITIES.map((p) => {
                const selected = priority === p.value;
                return (
                  <Pressable
                    key={p.value}
                    onPress={() => setPriority(p.value)}
                    style={[styles.chip, { flex: 1, backgroundColor: selected ? colors.primary : colors.muted, borderColor: selected ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Cancellation */}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Cancellation policy</Text>
            <View style={styles.chipRow}>
              {[
                { value: "flexible", label: "Flexible preferred" },
                { value: "any", label: "Any policy is fine" },
              ].map((c) => {
                const selected = cancellation === c.value;
                return (
                  <Pressable
                    key={c.value}
                    onPress={() => setCancellation(c.value as AccommodationPreference["cancellation"])}
                    style={[styles.chip, { flex: 1, backgroundColor: selected ? colors.primary : colors.muted, borderColor: selected ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{alreadySubmitted ? "Update" : "Next"}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
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
  headerLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11, letterSpacing: 2 },
  headerTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20 },

  progressBar: { height: 3 },
  progressFill: { height: 3 },

  statusCard: {
    margin: 16, marginBottom: 8, borderRadius: 16, borderWidth: 1, padding: 16, gap: 8,
  },
  statusTitle: { fontFamily: "DmSans_700Bold", fontSize: 16 },
  statusSub: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 18 },
  membersRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  memberChip: { alignItems: "center", gap: 4, width: 48 },
  memberName: { fontFamily: "DmSans_500Medium", fontSize: 11, textAlign: "center" },
  checkBadge: {
    position: "absolute", bottom: -2, right: -2,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "#4CAF50", alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#fff",
  },

  generateBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  generateBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
  generateHint: { fontFamily: "DmSans_400Regular", fontSize: 12, textAlign: "center", marginTop: 8 },
  skipButton: { marginTop: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 10 },
  skipButtonTitle: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  skipButtonCopy: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 2 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { fontFamily: "DmSans_400Regular", fontSize: 13, textAlign: "center", paddingHorizontal: 16 },

  form: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },
  sectionTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20 },
  submittedBadge: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  submittedText: { fontFamily: "DmSans_500Medium", fontSize: 13 },

  fieldLabel: {
    fontFamily: "DmSans_500Medium", fontSize: 12,
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 8,
  },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, alignItems: "center" },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, borderWidth: 1 },
  chipText: { fontFamily: "DmSans_500Medium", fontSize: 14 },

  daysRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  dayBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  daysNum: { fontFamily: "DmSans_700Bold", fontSize: 24, minWidth: 60, textAlign: "center" },
  daysLabel: { fontFamily: "DmSans_400Regular", fontSize: 14 },

  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  input: { flex: 1, fontFamily: "DmSans_400Regular", fontSize: 14 },

  submitBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  submitBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
});
