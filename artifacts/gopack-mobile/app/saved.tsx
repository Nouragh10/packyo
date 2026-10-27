import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  removeSavedActivity,
  removeSavedStay,
  useSavedActivities,
  useSavedStays,
} from "@/hooks/useFirebase";

type SavedSection = "activities" | "stays";

function formatStayType(type: string | undefined) {
  if (!type || type === "other") return "Stay";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function SavedTabs({
  section,
  onChange,
  colors,
}: {
  section: SavedSection;
  onChange: (next: SavedSection) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.tabs, { backgroundColor: colors.muted }]}>
      {(["activities", "stays"] as const).map((item) => (
        <Pressable
          key={item}
          onPress={() => onChange(item)}
          style={[styles.tab, section === item && { backgroundColor: colors.card }]}
          accessibilityRole="tab"
          accessibilityState={{ selected: section === item }}
        >
          <Feather
            name={item === "activities" ? "activity" : "home"}
            size={15}
            color={section === item ? colors.primary : colors.mutedForeground}
          />
          <Text style={[styles.tabText, { color: section === item ? colors.foreground : colors.mutedForeground }]}>
            {item === "activities" ? "Activities" : "Stays"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function RemoveButton({
  onPress,
  pending,
  label,
  colors,
}: {
  onPress: () => void;
  pending: boolean;
  label: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      hitSlop={8}
      style={({ pressed }) => [styles.remove, { opacity: pressed || pending ? 0.5 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {pending ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <Feather name="x" size={16} color={colors.mutedForeground} />}
    </Pressable>
  );
}

export default function SavedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = React.useState<SavedSection>(params.section === "stays" ? "stays" : "activities");
  const { savedActivities, loading: actLoading, error: actError } = useSavedActivities(user?.uid);
  const { savedStays, loading: stayLoading, error: stayError } = useSavedStays(user?.uid);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState("");

  React.useEffect(() => {
    setRemoving(null);
    setRemoveError("");
  }, [user?.uid]);
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 24;
  const loading = section === "activities" ? actLoading : stayLoading;
  const loadError = section === "activities" ? actError : stayError;

  const changeSection = (next: SavedSection) => {
    setSection(next);
    router.setParams({ section: next });
  };

  const remove = async (kind: SavedSection, key: string) => {
    if (!user || removing) return;
    setRemoving(key);
    setRemoveError("");
    try {
      if (kind === "activities") await removeSavedActivity(user.uid, key);
      else await removeSavedStay(user.uid, key);
    } catch {
      setRemoveError("We couldn't remove that item. Please try again.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to profile">
          <Feather name="arrow-left" size={21} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>SAVED</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{section === "activities" ? "Activities" : "Stays"}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <SavedTabs section={section} onChange={changeSection} colors={colors} />
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            {section === "activities"
              ? "Activities you saved from Discover. Add them as wishes when you plan a trip to the same city."
              : "Stays you saved from Discover. Suggest them to your pack when it's time to vote on accommodation."}
          </Text>
          {removeError ? <Text style={[styles.error, { color: colors.destructive }]}>{removeError}</Text> : null}

          {!user ? (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="lock" size={24} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Sign in to see saved items</Text>
            </View>
          ) : loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : loadError ? (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="alert-circle" size={24} color={colors.destructive} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load saved items</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Check your connection and reopen this page.</Text>
            </View>
          ) : section === "activities" ? (
            savedActivities.length === 0 ? (
              <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="bookmark" size={24} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No saved activities</Text>
                <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                  Tap Save on any activity in a Discover itinerary to keep it here.
                </Text>
                <Pressable onPress={() => router.push("/(tabs)/discover" as any)} style={[styles.emptyCta, { backgroundColor: colors.primary }]}>
                  <Text style={styles.emptyCtaText}>Browse Discover</Text>
                </Pressable>
              </View>
            ) : (
              savedActivities.map((item) => (
                <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.iconWrap, { backgroundColor: colors.primary + "14" }]}>
                    <Feather name="map-pin" size={17} color={colors.primary} />
                  </View>
                  <Pressable
                    style={styles.cardCopy}
                    onPress={() => item.reviewId && router.push(`/discover-itinerary/${item.reviewId}` as any)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.name}</Text>
                    <Text style={[styles.cardTrip, { color: colors.mutedForeground }]}>
                      {item.destination.split(",")[0]} · {item.category}
                    </Text>
                    {item.description ? (
                      <Text style={[styles.cardBody, { color: colors.mutedForeground }]} numberOfLines={2}>{item.description}</Text>
                    ) : null}
                  </Pressable>
                  <RemoveButton
                    onPress={() => remove("activities", item.id)}
                    pending={removing === item.id}
                    label={`Remove ${item.name} from saved activities`}
                    colors={colors}
                  />
                </View>
              ))
            )
          ) : savedStays.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="home" size={24} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No saved stays</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                Discover itineraries show where travellers stayed. Save one to reuse it before your pack votes.
              </Text>
              <Pressable onPress={() => router.push("/(tabs)/discover" as any)} style={[styles.emptyCta, { backgroundColor: colors.primary }]}>
                <Text style={styles.emptyCtaText}>Browse Discover</Text>
              </Pressable>
            </View>
          ) : (
            savedStays.map((stay) => (
              <View key={stay.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.primary + "14" }]}>
                  <Feather name="home" size={17} color={colors.primary} />
                </View>
                <Pressable
                  style={styles.cardCopy}
                  onPress={() => stay.reviewId && router.push(`/discover-itinerary/${stay.reviewId}` as any)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{stay.accommodation.name}</Text>
                  <Text style={[styles.cardTrip, { color: colors.mutedForeground }]}>
                    {stay.destination.split(",")[0]} · {formatStayType(stay.accommodation.type)}
                    {stay.accommodation.rating > 0 ? ` · ${stay.accommodation.rating.toFixed(1)} rating` : ""}
                  </Text>
                </Pressable>
                <RemoveButton
                  onPress={() => remove("stays", stay.id)}
                  pending={removing === stay.id}
                  label={`Remove ${stay.accommodation.name} from saved stays`}
                  colors={colors}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { padding: 4, marginRight: 11 },
  headerCopy: { gap: 1 },
  eyebrow: { fontFamily: "DmSans_700Bold", fontSize: 10, letterSpacing: 1.2 },
  title: { fontFamily: "DmSans_700Bold", fontSize: 23 },
  content: { padding: 16 },
  tabs: { flexDirection: "row", padding: 4, borderRadius: 14, gap: 4 },
  tab: { flex: 1, minHeight: 40, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  tabText: { fontFamily: "DmSans_700Bold", fontSize: 13 },
  description: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 19, marginTop: 14, marginBottom: 13 },
  error: { fontFamily: "DmSans_500Medium", fontSize: 12, marginBottom: 10 },
  loading: { paddingVertical: 70, alignItems: "center" },
  card: { flexDirection: "row", alignItems: "flex-start", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 10, gap: 11 },
  iconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: "DmSans_700Bold", fontSize: 15, lineHeight: 20 },
  cardTrip: { fontFamily: "DmSans_500Medium", fontSize: 12, marginTop: 3 },
  cardBody: { fontFamily: "DmSans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 5 },
  remove: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 28, marginTop: 6 },
  emptyTitle: { fontFamily: "DmSans_700Bold", fontSize: 16, marginTop: 12 },
  emptyBody: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 6, maxWidth: 290 },
  emptyCta: { marginTop: 14, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9 },
  emptyCtaText: { fontFamily: "DmSans_700Bold", fontSize: 13, color: "#fff" },
});
