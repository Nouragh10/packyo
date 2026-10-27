import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
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

import { WikiImage } from "@/components/WikiImage";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  AccommodationSuggestion,
  PublicItineraryActivity,
  PublicItineraryDay,
  removeSavedActivity,
  removeSavedPublicDestination,
  removeSavedStay,
  saveActivity,
  savedActivityKey,
  savedStayKey,
  saveStay,
  useSavedActivities,
  useSavedStays,
  savePublicDestination,
  useSavedDestinations,
  usePublicReview,
} from "@/hooks/useFirebase";

function DestinationPhoto({
  destination,
  photos,
}: {
  destination: string;
  photos?: string[];
}) {
  const cityName = destination.split(",")[0].trim();
  if (photos?.[0]) {
    return <Image source={{ uri: photos[0] }} style={styles.heroImage} contentFit="cover" />;
  }
  return (
    <WikiImage
      name={cityName}
      context="travel destination"
      style={styles.heroImage}
      resizeMode="cover"
      placeholderColor="#D1C9BE"
    />
  );
}

type SaveControl = {
  isSaved: (key: string) => boolean;
  isPending: (key: string) => boolean;
  toggle: (key: string, day: PublicItineraryDay, activity: PublicItineraryActivity) => void;
  reviewId: string;
};

function ActivityRow({
  activity,
  colors,
  isLast,
  day,
  save,
}: {
  activity: PublicItineraryActivity;
  colors: ReturnType<typeof useColors>;
  isLast: boolean;
  day: PublicItineraryDay;
  save: SaveControl;
}) {
  const category = activity.category
    ? activity.category.charAt(0).toUpperCase() + activity.category.slice(1)
    : "";
  const key = savedActivityKey(save.reviewId, day.day, activity);
  const saved = save.isSaved(key);
  const pending = save.isPending(key);
  const hasCost = typeof activity.estimatedCost === "number";

  return (
    <View style={styles.activityRow}>
      <View style={styles.activityRail}>
        <View style={[styles.activityDot, { backgroundColor: colors.primary }]} />
        {!isLast && <View style={[styles.activityLine, { backgroundColor: colors.border }]} />}
      </View>
      <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.activityMeta}>
          <Text style={[styles.activityTime, { color: colors.mutedForeground }]}>
            {activity.time || "Flexible time"}
          </Text>
          {category ? (
            <Text style={[styles.activityCategory, { color: colors.primary, backgroundColor: colors.primary + "15" }]}>
              {category}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {activity.name ? (
            <Pressable
              onPress={() => save.toggle(key, day, activity)}
              disabled={pending}
              hitSlop={8}
              testID={`discover-save-activity-${key}`}
              accessibilityRole="button"
              accessibilityLabel={saved ? `Remove ${activity.name} from saved activities` : `Save ${activity.name}`}
              accessibilityState={{ selected: saved, busy: pending }}
              style={[
                styles.activitySave,
                { borderColor: colors.primary, backgroundColor: saved ? colors.primary : "transparent", opacity: pending ? 0.6 : 1 },
              ]}
            >
              {pending ? (
                <ActivityIndicator size="small" color={saved ? "#fff" : colors.primary} />
              ) : (
                <Feather name={saved ? "check" : "bookmark"} size={12} color={saved ? "#fff" : colors.primary} />
              )}
              <Text style={[styles.activitySaveText, { color: saved ? "#fff" : colors.primary }]}>
                {saved ? "Saved" : "Save"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.activityName, { color: colors.foreground }]}>
          {activity.name || "Untitled activity"}
        </Text>
        {activity.description ? (
          <Text style={[styles.activityDescription, { color: colors.mutedForeground }]}>
            {activity.description}
          </Text>
        ) : null}
        {hasCost ? (
          <Text style={[styles.activityCost, { color: activity.estimatedCost === 0 ? "#26A69A" : colors.foreground }]}>
            {activity.estimatedCost === 0 ? "No entry fee" : `≈ $${activity.estimatedCost} / person`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function DaySection({
  day,
  colors,
  save,
}: {
  day: PublicItineraryDay;
  colors: ReturnType<typeof useColors>;
  save: SaveControl;
}) {
  return (
    <View style={styles.daySection}>
      <View style={styles.dayHeader}>
        <View style={[styles.dayNumber, { backgroundColor: colors.primary }]}>
          <Text style={styles.dayNumberText}>{day.day}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.dayTitle, { color: colors.foreground }]}>
            {day.city || `Day ${day.day}`}
          </Text>
          <Text style={[styles.dayTheme, { color: colors.mutedForeground }]}>
            {day.theme}
          </Text>
        </View>
      </View>
      {day.activities.length > 0 ? (
        day.activities.map((activity, index) => (
          <ActivityRow
            key={`${day.day}-${index}-${activity.name}`}
            activity={activity}
            colors={colors}
            isLast={index === day.activities.length - 1}
            day={day}
            save={save}
          />
        ))
      ) : (
        <View style={[styles.emptyDay, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.emptyDayText, { color: colors.mutedForeground }]}>
            No activities listed for this day.
          </Text>
        </View>
      )}
    </View>
  );
}

export default function DiscoverItineraryPreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { review, loading } = usePublicReview(id);
  const { savedDestinations } = useSavedDestinations(user?.uid);
  const [savePending, setSavePending] = React.useState(false);
  const [saveError, setSaveError] = React.useState("");
  const [saveStateOverride, setSaveStateOverride] = React.useState<boolean | null>(null);
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 20;
  const persistedSaved = !!id && savedDestinations.some((saved) => saved.id === id);
  const isSaved = saveStateOverride ?? persistedSaved;
  const { savedActivities } = useSavedActivities(user?.uid);
  const { savedStays } = useSavedStays(user?.uid);
  const [pendingKeys, setPendingKeys] = React.useState<Record<string, boolean>>({});
  const pendingRef = React.useRef<Record<string, boolean>>({});
  const [itemError, setItemError] = React.useState("");
  const savedActivityIds = React.useMemo(() => new Set(savedActivities.map((a) => a.id)), [savedActivities]);
  const savedStayIds = React.useMemo(() => new Set(savedStays.map((s) => s.id)), [savedStays]);

  const uidForState = user?.uid ?? null;
  React.useEffect(() => {
    // Identity changed: drop pending/override/error state from the previous account.
    pendingRef.current = {};
    setPendingKeys({});
    setItemError("");
    setSaveError("");
    setSaveStateOverride(null);
  }, [uidForState]);
  const currentUidRef = React.useRef(uidForState);
  currentUidRef.current = uidForState;

  const runItem = async (key: string, action: () => Promise<unknown>) => {
    if (pendingRef.current[key]) return;
    if (!user) {
      setItemError("Sign in to save activities and stays.");
      return;
    }
    pendingRef.current[key] = true;
    setPendingKeys((p) => ({ ...p, [key]: true }));
    setItemError("");
    const startedUid = user.uid;
    try {
      await action();
    } catch {
      if (currentUidRef.current === startedUid) setItemError("We couldn't update your saved items. Please try again.");
    } finally {
      if (currentUidRef.current !== startedUid) return;
      delete pendingRef.current[key];
      setPendingKeys((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  };

  const activitySave: SaveControl = {
    reviewId: id ?? "",
    isSaved: (key) => savedActivityIds.has(key),
    isPending: (key) => !!pendingKeys[key],
    toggle: (key, day, activity) => {
      if (!review || !user) return void runItem(key, async () => {});
      const uid = user.uid;
      runItem(key, () =>
        savedActivityIds.has(key) ? removeSavedActivity(uid, key) : saveActivity(uid, review, day, activity),
      );
    },
  };

  const toggleStay = (stay: AccommodationSuggestion) => {
    if (!review || !id) return;
    const key = savedStayKey(id, stay);
    if (!user) return void runItem(key, async () => {});
    const uid = user.uid;
    runItem(key, () => (savedStayIds.has(key) ? removeSavedStay(uid, key) : saveStay(uid, review, stay)));
  };

  React.useEffect(() => {
    setSaveStateOverride(null);
  }, [id, persistedSaved]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/discover");
    }
  };

  const handleSave = async () => {
    if (!review || !id || savePending) return;
    if (!user) {
      setSaveError("Sign in to save this trip to your profile.");
      return;
    }

    const nextSaved = !isSaved;
    setSaveStateOverride(nextSaved);
    setSaveError("");
    setSavePending(true);
    try {
      if (nextSaved) {
        await savePublicDestination(user.uid, review);
      } else {
        await removeSavedPublicDestination(user.uid, id);
      }
    } catch {
      setSaveStateOverride(isSaved);
      setSaveError("We couldn't update your saved trips. Please try again.");
    } finally {
      setSavePending(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading itinerary preview…</Text>
      </View>
    );
  }

  if (!review) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingHorizontal: 32 }]}>
        <View style={[styles.errorIcon, { backgroundColor: colors.primary + "15" }]}>
          <Feather name="map" size={26} color={colors.primary} />
        </View>
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>Trip preview unavailable</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
          This public itinerary may have been removed or is no longer available.
        </Text>
        <Pressable onPress={goBack} style={[styles.backAction, { backgroundColor: colors.primary }]}>
          <Feather name="arrow-left" size={16} color="#fff" />
          <Text style={styles.backActionText}>Back to Discover</Text>
        </Pressable>
      </View>
    );
  }

  const city = review.destination.split(",")[0].trim();
  const days = review.itineraryDays ?? [];
  const totalActivities = days.reduce((total, day) => total + day.activities.length, 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={goBack} style={styles.headerBack} accessibilityLabel="Back to Discover">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Itinerary preview</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>From the Packyo community</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
      >
        <View style={styles.hero}>
          <DestinationPhoto destination={review.destination} photos={review.photos} />
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <Text style={styles.heroEyebrow}>TOP RATED TRIP</Text>
            <Text style={styles.heroTitle}>{city}</Text>
            <Text style={styles.heroDuration}>
              {review.days > 0 ? `${review.days} ${review.days === 1 ? "day" : "days"}` : "Trip itinerary"}
              {totalActivities > 0 ? ` · ${totalActivities} activities` : ""}
            </Text>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryStat}>
            <Feather name="star" size={16} color="#F59E0B" />
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {review.rating > 0 ? review.rating.toFixed(1) : "—"}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>community rating</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryStat}>
            <Feather name="users" size={16} color={colors.primary} />
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {review.memberNames.length || "—"}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>travellers</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryStat}>
            <Feather name="calendar" size={16} color={colors.primary} />
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {days.length || review.days || "—"}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>days shown</Text>
          </View>
        </View>

        <Pressable
          onPress={handleSave}
          disabled={savePending}
          testID="discover-save-trip-button"
          accessibilityRole="button"
          accessibilityLabel={isSaved ? `Remove ${city} from saved trips` : `Save ${city} to your trips`}
          accessibilityState={{ selected: isSaved, busy: savePending }}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: isSaved ? colors.primary + "14" : colors.primary,
              borderColor: colors.primary,
              opacity: pressed || savePending ? 0.78 : 1,
            },
          ]}
        >
          {savePending ? (
            <ActivityIndicator size="small" color={isSaved ? colors.primary : "#fff"} />
          ) : (
            <Feather name="bookmark" size={17} color={isSaved ? colors.primary : "#fff"} />
          )}
          <Text style={[styles.saveButtonText, { color: isSaved ? colors.primary : "#fff" }]}>
            {isSaved ? "Saved to destinations" : "Save trip"}
          </Text>
        </Pressable>
        {saveError ? <Text style={[styles.saveError, { color: colors.primary }]}>{saveError}</Text> : null}

        {review.confirmedAccommodation ? (() => {
          const stay = review.confirmedAccommodation;
          const stayKey = savedStayKey(review.id, stay);
          const staySaved = savedStayIds.has(stayKey);
          const stayPending = !!pendingKeys[stayKey];
          return (
            <View style={[styles.stayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.stayEyebrow, { color: colors.mutedForeground }]}>WHERE THEY STAYED</Text>
              <View style={styles.stayRow}>
                <View style={[styles.stayIcon, { backgroundColor: colors.primary + "14" }]}>
                  <Feather name="home" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.stayName, { color: colors.foreground }]} numberOfLines={2}>{stay.name}</Text>
                  <Text style={[styles.stayMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {[stay.type === "other" ? "Stay" : stay.type.charAt(0).toUpperCase() + stay.type.slice(1), stay.location, stay.rating > 0 ? `${stay.rating.toFixed(1)} rating` : ""].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </View>
              {stay.totalCost > 0 && stay.nights > 0 ? (
                <Text style={[styles.stayMeta, { color: colors.mutedForeground }]}>
                  Past-trip price: about ${Math.round(stay.totalCost / stay.nights)}/night. Prices will be re-estimated for your dates and group.
                </Text>
              ) : null}
              <Pressable
                onPress={() => toggleStay(stay)}
                disabled={stayPending}
                testID="discover-save-stay-button"
                accessibilityRole="button"
                accessibilityLabel={staySaved ? `Remove ${stay.name} from saved stays` : `Save ${stay.name} to your stays`}
                accessibilityState={{ selected: staySaved, busy: stayPending }}
                style={[styles.staySave, { borderColor: colors.primary, backgroundColor: staySaved ? colors.primary : "transparent", opacity: stayPending ? 0.6 : 1 }]}
              >
                {stayPending ? (
                  <ActivityIndicator size="small" color={staySaved ? "#fff" : colors.primary} />
                ) : (
                  <Feather name={staySaved ? "check" : "bookmark"} size={14} color={staySaved ? "#fff" : colors.primary} />
                )}
                <Text style={[styles.staySaveText, { color: staySaved ? "#fff" : colors.primary }]}>
                  {staySaved ? "Saved to stays" : "Save this stay"}
                </Text>
              </Pressable>
            </View>
          );
        })() : null}
        {itemError ? <Text style={[styles.saveError, { color: colors.primary }]}>{itemError}</Text> : null}

        {(review.highlight || review.text || review.vibes.length > 0) && (
          <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {review.highlight ? (
              <Text style={[styles.highlight, { color: colors.foreground }]}>“{review.highlight}”</Text>
            ) : review.text ? (
              <Text style={[styles.reviewText, { color: colors.foreground }]}>{review.text}</Text>
            ) : null}
            {review.memberNames.length > 0 ? (
              <Text style={[styles.reviewByline, { color: colors.mutedForeground }]}>
                Shared by {review.memberNames.slice(0, 2).join(" and ")}
              </Text>
            ) : null}
            {review.vibes.length > 0 ? (
              <View style={styles.vibes}>
                {review.vibes.slice(0, 4).map((vibe) => (
                  <Text key={vibe} style={[styles.vibe, { color: colors.primary, backgroundColor: colors.primary + "12" }]}>
                    {vibe}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.itineraryHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>The itinerary</Text>
          <View style={styles.readOnly}>
            <Feather name="eye" size={12} color={colors.mutedForeground} />
            <Text style={[styles.readOnlyText, { color: colors.mutedForeground }]}>Save what you like</Text>
          </View>
        </View>

        {days.length > 0 ? (
          days.map((day) => <DaySection key={day.day} day={day} colors={colors} save={activitySave} />)
        ) : (
          <View style={[styles.noItinerary, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="calendar" size={28} color={colors.mutedForeground} />
            <Text style={[styles.noItineraryTitle, { color: colors.foreground }]}>
              No itinerary preview yet
            </Text>
            <Text style={[styles.noItineraryBody, { color: colors.mutedForeground }]}>
              This trip has a public review, but its day-by-day plan was not shared.
            </Text>
          </View>
        )}

        <Pressable
          onPress={() =>
            router.push({
              pathname: "/(tabs)/create",
              params: { prefillDestination: review.destination },
            })
          }
          style={[styles.createButton, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
        >
          <Feather name="plus" size={17} color="#fff" />
          <Text style={styles.createButtonText}>Plan your own trip to {city}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontFamily: "DmSans_400Regular", fontSize: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: { padding: 4, marginRight: 10 },
  headerTitle: { fontFamily: "DmSans_700Bold", fontSize: 17 },
  headerSubtitle: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 1 },
  errorIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" },
  errorTitle: { fontFamily: "DmSans_700Bold", fontSize: 21, textAlign: "center" },
  errorBody: { fontFamily: "DmSans_400Regular", fontSize: 14, textAlign: "center", lineHeight: 20 },
  backAction: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  backActionText: { fontFamily: "DmSans_700Bold", fontSize: 13, color: "#fff" },
  hero: { height: 220, position: "relative", overflow: "hidden" },
  heroImage: { width: "100%", height: "100%" },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.42)" },
  heroContent: { position: "absolute", left: 24, right: 24, bottom: 22 },
  heroEyebrow: { fontFamily: "DmSans_700Bold", fontSize: 10, letterSpacing: 1.7, color: "#FFD3C6", marginBottom: 5 },
  heroTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 34, color: "#fff" },
  heroDuration: { fontFamily: "DmSans_500Medium", fontSize: 13, color: "rgba(255,255,255,0.86)", marginTop: 3 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 16, marginHorizontal: 16 },
  summaryStat: { alignItems: "center", gap: 3, flex: 1 },
  summaryValue: { fontFamily: "DmSans_700Bold", fontSize: 17 },
  summaryLabel: { fontFamily: "DmSans_400Regular", fontSize: 10, textAlign: "center" },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 38 },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginHorizontal: 16,
    marginBottom: 18,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 13,
  },
  saveButtonText: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  saveError: { fontFamily: "DmSans_400Regular", fontSize: 12, textAlign: "center", marginHorizontal: 20, marginTop: -8, marginBottom: 18 },
  reviewCard: { marginHorizontal: 16, marginBottom: 22, padding: 16, borderRadius: 14, borderWidth: 1 },
  highlight: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 19, lineHeight: 26 },
  reviewText: { fontFamily: "DmSans_400Regular", fontSize: 14, lineHeight: 21 },
  reviewByline: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 8 },
  vibes: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  vibe: { fontFamily: "DmSans_600SemiBold", fontSize: 11, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  itineraryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 12 },
  sectionTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 23 },
  readOnly: { flexDirection: "row", alignItems: "center", gap: 4 },
  readOnlyText: { fontFamily: "DmSans_400Regular", fontSize: 11 },
  daySection: { marginHorizontal: 16, marginBottom: 22 },
  dayHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  dayNumber: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNumberText: { fontFamily: "DmSans_700Bold", fontSize: 15, color: "#fff" },
  dayTitle: { fontFamily: "DmSans_700Bold", fontSize: 16 },
  dayTheme: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 1 },
  activityRow: { flexDirection: "row", alignItems: "stretch", minHeight: 84 },
  activityRail: { width: 22, alignItems: "center" },
  activityDot: { width: 9, height: 9, borderRadius: 5, marginTop: 17, zIndex: 1 },
  activityLine: { position: "absolute", top: 25, bottom: 0, width: 1 },
  activityCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  activityMeta: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
  activityTime: { fontFamily: "DmSans_600SemiBold", fontSize: 11 },
  activityCategory: { fontFamily: "DmSans_600SemiBold", fontSize: 10, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  activitySave: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, minHeight: 24 },
  activitySaveText: { fontFamily: "DmSans_700Bold", fontSize: 11 },
  stayCard: { marginHorizontal: 16, marginBottom: 18, padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
  stayEyebrow: { fontFamily: "DmSans_700Bold", fontSize: 10, letterSpacing: 1.2 },
  stayRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  stayIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stayName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 17, lineHeight: 22 },
  stayMeta: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 2 },
  staySave: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 10 },
  staySaveText: { fontFamily: "DmSans_700Bold", fontSize: 13 },
  activityName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 17, lineHeight: 22 },
  activityDescription: { fontFamily: "DmSans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 4 },
  activityCost: { fontFamily: "DmSans_600SemiBold", fontSize: 11, marginTop: 7 },
  emptyDay: { borderRadius: 12, borderWidth: 1, padding: 14, marginLeft: 22 },
  emptyDayText: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  noItinerary: { marginHorizontal: 16, alignItems: "center", borderRadius: 16, borderWidth: 1, padding: 28, gap: 8 },
  noItineraryTitle: { fontFamily: "DmSans_700Bold", fontSize: 16 },
  noItineraryBody: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 19, textAlign: "center" },
  createButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginHorizontal: 16, marginTop: 20, borderRadius: 14, paddingVertical: 14 },
  createButtonText: { fontFamily: "DmSans_700Bold", fontSize: 14, color: "#fff" },
});