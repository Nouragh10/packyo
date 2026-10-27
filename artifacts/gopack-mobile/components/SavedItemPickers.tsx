import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { sameCity } from "@/lib/activity-classifier";
import {
  addSavedStayToTrip,
  addWish,
  estimateSavedStayCost,
  savedStaySuggestionId,
  useSavedActivities,
  useSavedStays,
  type AccommodationSuggestion,
  type Trip,
  type Wish,
} from "@/hooks/useFirebase";

type Colors = ReturnType<typeof useColors>;

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  colors,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  colors: Colors;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Platform.OS === "web" ? 34 : insets.bottom + 12;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: bottom }]}>
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
            <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>{subtitle}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={20} color={colors.foreground} />
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function TriggerButton({ label, icon, onPress, colors, testID }: { label: string; icon: string; onPress: () => void; colors: Colors; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.trigger,
        { borderColor: colors.primary, backgroundColor: colors.primary + "10", opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Feather name={icon as any} size={15} color={colors.primary} />
      <Text style={[styles.triggerText, { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

/* ── Wishlist: add a wish from saved activities ───────────────────── */

export function SavedActivityWishPicker({
  tripId,
  trip,
  wishes,
  uid,
  displayName,
}: {
  tripId: string;
  trip: Trip;
  wishes: Wish[];
  uid: string | undefined;
  displayName: string;
}) {
  const colors = useColors();
  const { savedActivities, loading, error } = useSavedActivities(uid);
  const [open, setOpen] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const pendingRef = React.useRef(false);
  const [addError, setAddError] = React.useState("");

  const matching = React.useMemo(
    () => savedActivities.filter((a) => sameCity(a.destination, trip.destination)),
    [savedActivities, trip.destination],
  );
  const existing = React.useMemo(() => new Set(wishes.map((w) => normalizeText(w.text))), [wishes]);

  if (!uid || loading || error || matching.length === 0) return null;

  const choose = async (id: string, text: string) => {
    if (pendingRef.current || existing.has(normalizeText(text))) return;
    pendingRef.current = true;
    setPendingId(id);
    setAddError("");
    try {
      // Same path as a typed wish: authored by the current member, no votes.
      await addWish(tripId, text, uid, displayName);
      setOpen(false);
    } catch {
      setAddError("We couldn't add that wish. Please try again.");
    } finally {
      pendingRef.current = false;
      setPendingId(null);
    }
  };

  return (
    <>
      <TriggerButton label="Add a wish from activities" icon="bookmark" onPress={() => setOpen(true)} colors={colors} testID="wishlist-add-from-activities" />
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Saved activities"
        subtitle={`Your saves in ${trip.destination.split(",")[0]}. Picking one adds it as your wish for the pack to vote on.`}
        colors={colors}
      >
        {addError ? <Text style={[styles.error, { color: colors.destructive }]}>{addError}</Text> : null}
        {matching.map((a) => {
          const already = existing.has(normalizeText(a.name));
          const busy = pendingId === a.id;
          return (
            <Pressable
              key={a.id}
              onPress={() => choose(a.id, a.name)}
              disabled={already || pendingId !== null}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: already ? 0.55 : 1 }]}
              accessibilityRole="button"
              accessibilityState={{ disabled: already || pendingId !== null, busy }}
            >
              <View style={[styles.rowIcon, { backgroundColor: colors.primary + "14" }]}>
                <Feather name="map-pin" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={2}>{a.name}</Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {a.category}{a.description ? ` · ${a.description}` : ""}
                </Text>
              </View>
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : already ? (
                <Text style={[styles.rowState, { color: colors.mutedForeground }]}>Added</Text>
              ) : (
                <Feather name="plus" size={18} color={colors.primary} />
              )}
            </Pressable>
          );
        })}
      </Sheet>
    </>
  );
}

/* ── Accommodation: add from saved stays ───────────────────────────── */

export function SavedStaySuggestionPicker({
  tripId,
  trip,
  uid,
  displayName,
  onAdded,
}: {
  tripId: string;
  trip: Trip;
  uid: string | undefined;
  displayName: string;
  onAdded?: () => void;
}) {
  const colors = useColors();
  const { savedStays, loading, error } = useSavedStays(uid);
  const [open, setOpen] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const pendingRef = React.useRef(false);
  const [addError, setAddError] = React.useState("");

  const matching = React.useMemo(
    () => savedStays.filter((s) => sameCity(s.destination, trip.destination)),
    [savedStays, trip.destination],
  );
  const suggestionIds = React.useMemo(() => {
    const raw = trip.accommodationSuggestions as AccommodationSuggestion[] | Record<string, AccommodationSuggestion> | undefined;
    const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    return new Set(list.map((s) => s?.id));
  }, [trip.accommodationSuggestions]);

  if (!uid || loading || error || matching.length === 0) return null;

  const choose = async (stayId: string) => {
    const stay = matching.find((s) => s.id === stayId);
    if (!stay || pendingRef.current || suggestionIds.has(savedStaySuggestionId(stay))) return;
    pendingRef.current = true;
    setPendingId(stayId);
    setAddError("");
    try {
      await addSavedStayToTrip(tripId, stay, displayName, trip);
      setOpen(false);
      onAdded?.();
    } catch {
      setAddError("We couldn't add that stay. Please try again.");
    } finally {
      pendingRef.current = false;
      setPendingId(null);
    }
  };

  return (
    <>
      <TriggerButton label="Add from saved stays" icon="home" onPress={() => setOpen(true)} colors={colors} testID="accommodation-add-from-saved-stays" />
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Saved stays"
        subtitle={`Your saves in ${trip.destination.split(",")[0]}. Picking one adds it to the pack's accommodation vote.`}
        colors={colors}
      >
        {addError ? <Text style={[styles.error, { color: colors.destructive }]}>{addError}</Text> : null}
        {matching.map((s) => {
          const est = estimateSavedStayCost(s, Math.max(trip.days || 1, 1), Object.keys(trip.members ?? {}).length);
          const already = suggestionIds.has(savedStaySuggestionId(s));
          const busy = pendingId === s.id;
          return (
            <Pressable
              key={s.id}
              onPress={() => choose(s.id)}
              disabled={already || pendingId !== null}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: already ? 0.55 : 1 }]}
              accessibilityRole="button"
              accessibilityState={{ disabled: already || pendingId !== null, busy }}
            >
              <View style={[styles.rowIcon, { backgroundColor: colors.primary + "14" }]}>
                <Feather name="home" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={2}>{s.accommodation.name}</Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {[s.accommodation.location, s.accommodation.rating > 0 ? `${s.accommodation.rating.toFixed(1)} rating` : ""].filter(Boolean).join(" · ") || "Saved stay"}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {est.totalCost > 0
                    ? `Past-trip estimate: ~$${est.nightly}/night, ~$${est.costPerPerson}/person for ${Math.max(trip.days || 1, 1)} nights. Not a current quote.`
                    : "No past price on record."}
                </Text>
              </View>
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : already ? (
                <Text style={[styles.rowState, { color: colors.mutedForeground }]}>In vote</Text>
              ) : (
                <Feather name="plus" size={18} color={colors.primary} />
              )}
            </Pressable>
          );
        })}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(20,16,12,0.42)" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
  sheetTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 21 },
  sheetSub: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 18, marginTop: 3 },
  trigger: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: 14, paddingVertical: 12, marginHorizontal: 16, marginTop: 12 },
  triggerText: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: "DmSans_700Bold", fontSize: 14, lineHeight: 19 },
  rowMeta: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 2 },
  rowState: { fontFamily: "DmSans_600SemiBold", fontSize: 11 },
  error: { fontFamily: "DmSans_500Medium", fontSize: 12, marginBottom: 4 },
});
