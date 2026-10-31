import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  activityPricePresentation,
  safePriceSource,
  summarizeActivityPrices,
  type ActivityPricing,
} from "@workspace/activity-pricing";

import { useColors } from "@/hooks/useColors";

export type PricedLike = { name?: string; estimatedCost?: number | null; pricing?: ActivityPricing | null };

/** Read pricing without trusting the legacy guessed estimatedCost. */
export function asPriced(activity: unknown): PricedLike {
  const a = (activity ?? {}) as PricedLike;
  return { name: a.name, estimatedCost: null, pricing: a.pricing ?? null };
}

export function formatCheckedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Plain-text price line for share sheets and exports. */
export function activityPriceText(activity: unknown): string {
  const p = activityPricePresentation(asPriced(activity));
  const checked = formatCheckedDate(p.checkedAt);
  if (p.verified) return `${p.label} (source: ${p.sourceUrl ?? "n/a"}${checked ? `, checked ${checked}` : ""})`;
  return p.label;
}

export async function openPriceSource(url: string | null | undefined) {
  const safe = safePriceSource(url);
  if (!safe) return;
  try { await Linking.openURL(safe); } catch { /* ignore */ }
}

export function ActivityPrice({ activity, compact = false, testID }: { activity: unknown; compact?: boolean; testID?: string }) {
  const colors = useColors();
  const p = activityPricePresentation(asPriced(activity));
  const isUser = !p.verified && (activity as PricedLike)?.pricing?.status === "user_entered" && p.label.includes("user-entered");
  const tone = p.verified ? "#1D8A7A" : isUser ? "#B7791F" : colors.mutedForeground;
  const checked = formatCheckedDate(p.checkedAt);
  const icon = p.verified ? "check-circle" : isUser ? "edit-3" : "help-circle";

  if (compact) {
    return (
      <View testID={testID} style={[styles.chip, { backgroundColor: tone + "14" }]}>
        <Feather name={icon} size={11} color={tone} />
        <Text style={[styles.chipText, { color: tone }]} numberOfLines={1}>{p.label}</Text>
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.block, { borderTopColor: colors.border }]}>
      <View style={styles.row}>
        <Feather name={icon} size={12} color={tone} />
        <Text style={[styles.label, { color: tone }]}>{p.label}</Text>
        {p.verified ? <Text style={[styles.badge, { color: tone, borderColor: tone + "55" }]}>VERIFIED</Text> : null}
      </View>
      {p.verified || isUser ? (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          {p.note}{checked ? ` Checked ${checked}.` : ""}
        </Text>
      ) : null}
      {p.verified && p.sourceUrl ? (
        <Pressable
          onPress={() => openPriceSource(p.sourceUrl)}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={`Open price source: ${p.sourceTitle}`}
          style={styles.row}
        >
          <Feather name="external-link" size={11} color={colors.primary} />
          <Text style={[styles.source, { color: colors.primary }]} numberOfLines={1}>{p.sourceTitle}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ActivityPriceSummary({ activities, title = "Verified activity prices" }: { activities: unknown[]; title?: string }) {
  const colors = useColors();
  const s = summarizeActivityPrices(activities.map(asPriced));
  return (
    <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.summaryEyebrow, { color: colors.mutedForeground }]}>{title.toUpperCase()}</Text>
      {s.totals.length ? (
        s.totals.map((t) => (
          <Text key={t.currency} style={[styles.summaryValue, { color: colors.foreground }]}>
            {s.hasFromPrices ? "From " : ""}{t.label}
          </Text>
        ))
      ) : (
        <Text style={[styles.summaryValue, { color: colors.mutedForeground, fontSize: 15 }]}>No verified totals yet</Text>
      )}
      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        {s.verifiedCount} verified per person · {s.unknownCount} unavailable (excluded). Currencies are never combined.
      </Text>
    </View>
  );
}

export function VerifyPricesButton({
  running, error, onPress, progress,
}: { running: boolean; error: string | null; onPress: () => void; progress?: string | null }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={onPress}
        disabled={running}
        testID="verify-prices-button"
        accessibilityRole="button"
        accessibilityState={{ busy: running }}
        style={({ pressed }) => [styles.verifyBtn, { borderColor: colors.primary, opacity: pressed || running ? 0.7 : 1 }]}
      >
        {running ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="shield" size={14} color={colors.primary} />}
        <Text style={[styles.verifyText, { color: colors.primary }]}>{running ? progress || "Checking prices…" : "Verify prices"}</Text>
      </Pressable>
      {error ? <Text style={[styles.note, { color: colors.primary, textAlign: "center" }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 220 },
  chipText: { fontFamily: "DmSans_600SemiBold", fontSize: 11 },
  block: { marginTop: 8, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, gap: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  label: { fontFamily: "DmSans_700Bold", fontSize: 12, flexShrink: 1 },
  badge: { fontFamily: "DmSans_700Bold", fontSize: 8.5, letterSpacing: 1, borderWidth: 1, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 },
  note: { fontFamily: "DmSans_400Regular", fontSize: 11, lineHeight: 15 },
  source: { fontFamily: "DmSans_600SemiBold", fontSize: 11, textDecorationLine: "underline", flexShrink: 1 },
  summary: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  summaryEyebrow: { fontFamily: "DmSans_700Bold", fontSize: 10, letterSpacing: 1.2 },
  summaryValue: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20 },
  verifyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: 12, paddingVertical: 10 },
  verifyText: { fontFamily: "DmSans_700Bold", fontSize: 13 },
});
