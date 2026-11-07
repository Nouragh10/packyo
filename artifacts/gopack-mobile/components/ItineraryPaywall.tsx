import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Mascot } from "@/components/Mascot";
import { useColors } from "@/hooks/useColors";
import type { UnlockKind } from "@/lib/purchases";

type LockedDay = { dayNumber: number; city: string; activityCount: number; dateLabel?: string };

type Props = {
  lockedDays: LockedDay[];
  totalDays: number;
  memberCount: number;
  prices: Record<UnlockKind, string>;
  busy: UnlockKind | "restore" | null;
  error: string | null;
  onUnlock: (kind: UnlockKind) => void;
  onRestore: () => void;
};

/** Day 1 stays free; the rest of the trip sits behind this card. */
export function ItineraryPaywall({ lockedDays, totalDays, memberCount, prices, busy, error, onUnlock, onRestore }: Props) {
  const colors = useColors();
  const tap = (kind: UnlockKind) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onUnlock(kind); };

  return (
    <View testID="itinerary-paywall">
      {lockedDays.map((d) => (
        <View key={d.dayNumber} style={[styles.lockedDay, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.lockedMeta, { color: colors.mutedForeground }]}>
              Day {d.dayNumber}{d.dateLabel ? ` • ${d.dateLabel}` : ""}
            </Text>
            <Text style={[styles.lockedCity, { color: colors.foreground }]}>{d.city}</Text>
            <View style={styles.ghostRow}>
              {Array.from({ length: Math.min(d.activityCount, 4) }).map((_, i) => (
                <View key={i} style={[styles.ghost, { backgroundColor: colors.secondary, width: `${70 - i * 12}%` }]} />
              ))}
            </View>
          </View>
          <View style={[styles.lockBadge, { backgroundColor: colors.secondary }]}>
            <Feather name="lock" size={14} color={colors.mutedForeground} />
            <Text style={[styles.lockBadgeText, { color: colors.mutedForeground }]}>{d.activityCount} plans</Text>
          </View>
        </View>
      ))}

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]}>
        <Mascot name="map-mate" size={72} style={{ alignSelf: "center", marginTop: -48 }} />
        <Text style={[styles.title, { color: colors.foreground }]}>Unlock the whole trip</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Day 1 is on us. Unlock all {totalDays} days with times, routes and prices.
        </Text>

        <Pressable
          testID="unlock-group"
          onPress={() => tap("group")}
          disabled={!!busy}
          style={[styles.option, styles.optionPrimary, { backgroundColor: colors.primary, opacity: busy && busy !== "group" ? 0.6 : 1 }]}
        >
          <View style={{ flex: 1 }}>
            <View style={styles.optionHead}>
              <Text style={[styles.optionTitle, { color: "#fff" }]}>Unlock for the whole pack</Text>
              <View style={styles.bestBadge}><Text style={styles.bestBadgeText}>BEST VALUE</Text></View>
            </View>
            <Text style={[styles.optionSub, { color: "rgba(255,255,255,0.9)" }]}>
              One payment, {memberCount > 1 ? `all ${memberCount} members see` : "everyone in the trip sees"} every day
            </Text>
          </View>
          {busy === "group" ? <ActivityIndicator color="#fff" /> : <Text style={[styles.price, { color: "#fff" }]}>{prices.group}</Text>}
        </Pressable>

        <Pressable
          testID="unlock-personal"
          onPress={() => tap("personal")}
          disabled={!!busy}
          style={[styles.option, { borderColor: colors.border, borderWidth: 1.5, opacity: busy && busy !== "personal" ? 0.6 : 1 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.optionTitle, { color: colors.foreground }]}>Just for me</Text>
            <Text style={[styles.optionSub, { color: colors.mutedForeground }]}>Only you see the full itinerary</Text>
          </View>
          {busy === "personal" ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.price, { color: colors.foreground }]}>{prices.personal}</Text>}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable onPress={onRestore} disabled={!!busy} style={styles.restore} testID="unlock-restore">
          {busy === "restore"
            ? <ActivityIndicator size="small" color={colors.mutedForeground} />
            : <Text style={[styles.restoreText, { color: colors.mutedForeground }]}>Already paid? Refresh</Text>}
        </Pressable>
        <Text style={[styles.fine, { color: colors.mutedForeground }]}>One-time purchase for this trip. No subscription.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lockedDay: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12, gap: 12 },
  lockedMeta: { fontFamily: "DmSans_500Medium", fontSize: 13, marginBottom: 4 },
  lockedCity: { fontFamily: "DmSans_600SemiBold", fontSize: 18 },
  ghostRow: { marginTop: 10, gap: 6 },
  ghost: { height: 8, borderRadius: 4 },
  lockBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  lockBadgeText: { fontFamily: "DmSans_500Medium", fontSize: 12 },
  card: { borderWidth: 2, borderRadius: 20, padding: 20, paddingTop: 8, marginTop: 44, marginBottom: 24 },
  title: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 24, textAlign: "center", marginTop: 4 },
  sub: { fontFamily: "DmSans_400Regular", fontSize: 14, textAlign: "center", marginTop: 6, marginBottom: 18, lineHeight: 20 },
  option: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 16, marginBottom: 10, gap: 12 },
  optionPrimary: {},
  optionHead: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  optionTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 16 },
  optionSub: { fontFamily: "DmSans_400Regular", fontSize: 13, marginTop: 3 },
  price: { fontFamily: "DmSans_600SemiBold", fontSize: 18 },
  bestBadge: { backgroundColor: "#F4BC55", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  bestBadgeText: { fontFamily: "DmSans_600SemiBold", fontSize: 10, color: "#241F1B", letterSpacing: 0.5 },
  error: { fontFamily: "DmSans_500Medium", fontSize: 13, color: "#F15A3A", textAlign: "center", marginTop: 4 },
  restore: { alignItems: "center", paddingVertical: 10, marginTop: 4 },
  restoreText: { fontFamily: "DmSans_500Medium", fontSize: 13, textDecorationLine: "underline" },
  fine: { fontFamily: "DmSans_400Regular", fontSize: 11, textAlign: "center" },
});
