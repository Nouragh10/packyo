import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
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

import { useColors } from "@/hooks/useColors";
import { useTrip, useWishes } from "@/hooks/useFirebase";
import type { Wish } from "@/hooks/useFirebase";
import { isWishEligible, wishUpvotePercentage } from "@/lib/wish-eligibility";

/* ── Inclusion rule (mirrors building/[id].tsx) ─────────────── */
function computeRankedWishes(wishes: Wish[], memberCount: number) {
  const sorted = [...wishes].sort((a, b) => b.score - a.score);
  const guaranteed = sorted.filter((w) => isWishEligible(w, memberCount));
  const candidates: Wish[] = [];
  const excluded = sorted.filter((w) => !isWishEligible(w, memberCount));

  return { guaranteed, candidates, excluded };
}

/* ── Mascot icon (robot/AI bird) ───────────────────────────── */
function MascotIcon() {
  return (
    <View style={styles.mascot}>
      <View style={styles.mascotHead}>
        <View style={styles.mascotEyeRow}>
          <View style={styles.mascotEye} />
          <View style={styles.mascotEye} />
        </View>
        <View style={styles.mascotMouth} />
      </View>
      <View style={styles.mascotBody}>
        <Feather name="zap" size={14} color="#E85D3A" />
      </View>
    </View>
  );
}

/* ── Screen ─────────────────────────────────────────────────── */
export default function WishlistResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { trip, loading } = useTrip(id);
  const wishes = useWishes(id);
  const [showAllIncluded, setShowAllIncluded] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 12;

  if (loading || !trip) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color="#E85D3A" />
      </View>
    );
  }

  const members = Object.entries(trip.members ?? {});
  const lockedBy = trip.votesLockedBy ?? {};
  const lockedCount = Object.keys(lockedBy).length;
  const allLocked = members.length > 0 && lockedCount >= members.length;

  const { guaranteed, candidates, excluded } = computeRankedWishes(wishes, members.length);
  const allIncluded = [...guaranteed, ...candidates];
  const displayedIncluded = showAllIncluded ? allIncluded : allIncluded.slice(0, 5);
  const hiddenCount = allIncluded.length - 5;

  const handleContinue = () => {
    router.push(`/accommodation/${id}`);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Voting Summary</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Voting complete card */}
        <View style={[styles.completeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.completeTitle, { color: allLocked ? "#4CAF50" : "#F59E0B" }]}>
              {allLocked ? "Voting complete!" : `Waiting for ${members.length - lockedCount} more…`}
            </Text>
            <Text style={[styles.completeSub, { color: colors.mutedForeground }]}>
              AI will build the itinerary using{"\n"}top-voted activities.
            </Text>
          </View>
          <MascotIcon />
        </View>

        {/* TOP WISHES — Included */}
        {allIncluded.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: "#4CAF50" }]}>Top wishes (Included):</Text>
            </View>
            {displayedIncluded.map((w, idx) => {
              const upCount = Object.keys(w.upvoters ?? {}).length;
              const upPercent = Math.round(wishUpvotePercentage(w, members.length));
              return (
                <View key={w.id} style={[styles.rankRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.rankNum, { color: colors.mutedForeground }]}>{idx + 1}</Text>
                  <Text style={[styles.rankName, { color: colors.foreground }]} numberOfLines={1}>{w.text}</Text>
                  <View style={styles.rankVote}>
                    <Feather name="thumbs-up" size={12} color="#4CAF50" />
                     <Text style={[styles.rankVoteNum, { color: "#4CAF50" }]}>{upCount} · {upPercent}%</Text>
                  </View>
                </View>
              );
            })}
            {!showAllIncluded && hiddenCount > 0 && (
              <Pressable onPress={() => setShowAllIncluded(true)} style={styles.moreRow}>
                <Text style={[styles.moreText, { color: colors.mutedForeground }]}>
                  # {hiddenCount} more included
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* LOWEST — Excluded */}
        {excluded.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: "#EF5350" }]}>Lowest (Excluded):</Text>
            </View>
            {excluded.map((w) => {
              const downCount = Object.keys(w.downvoters ?? {}).length;
              const upPercent = Math.round(wishUpvotePercentage(w, members.length));
              return (
                <View key={w.id} style={[styles.rankRow, styles.excludedRow, { borderBottomColor: colors.border }]}>
                  <Feather name="slash" size={14} color="#9CA3AF" />
                  <Text style={[styles.rankName, { color: colors.mutedForeground }]} numberOfLines={1}>{w.text}</Text>
                  <View style={styles.rankVote}>
                    <Feather name="thumbs-down" size={12} color="#EF5350" />
                     <Text style={[styles.rankVoteNum, { color: "#EF5350" }]}>{downCount} down · {upPercent}% up</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {wishes.length === 0 && (
          <View style={styles.emptyState}>
            <Feather name="star" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No wishes added yet.</Text>
          </View>
        )}

        <Text style={[styles.caption, { color: colors.mutedForeground }]}>
          AI includes top-voted activities and excludes lowest-voted.
        </Text>
      </ScrollView>

      {/* CTA */}
      <View style={[styles.cta, { borderTopColor: colors.border, paddingBottom: bottomInset, backgroundColor: colors.background }]}>
        <Pressable style={styles.ctaBtn} onPress={handleContinue}>
          <Text style={styles.ctaBtnText}>Continue to accommodation</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, marginRight: 10 },
  headerTitle: { fontFamily: "DmSans_700Bold", fontSize: 18 },

  /* Complete card */
  completeCard: {
    margin: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    padding: 20, flexDirection: "row", alignItems: "flex-start", gap: 12,
  },
  completeTitle: { fontFamily: "DmSans_700Bold", fontSize: 20, marginBottom: 6 },
  completeSub: { fontFamily: "DmSans_400Regular", fontSize: 14, lineHeight: 20 },

  /* Mascot */
  mascot: { alignItems: "center", gap: 4 },
  mascotHead: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "#FFF3E0", borderWidth: 2, borderColor: "#FB8C00",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  mascotEyeRow: { flexDirection: "row", gap: 6 },
  mascotEye: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#241F1B" },
  mascotMouth: { width: 14, height: 3, borderRadius: 2, backgroundColor: "#FB8C00" },
  mascotBody: {
    width: 32, height: 24, borderRadius: 8,
    backgroundColor: "#FFF3E0", borderWidth: 2, borderColor: "#FB8C00",
    alignItems: "center", justifyContent: "center",
  },

  /* Sections */
  section: { paddingHorizontal: 16, marginBottom: 4 },
  sectionHeaderRow: { paddingVertical: 10 },
  sectionTitle: { fontFamily: "DmSans_700Bold", fontSize: 15 },

  /* Rank rows */
  rankRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  excludedRow: { opacity: 0.65 },
  rankNum: { fontFamily: "DmSans_700Bold", fontSize: 16, minWidth: 24 },
  rankName: { flex: 1, fontFamily: "DmSans_500Medium", fontSize: 14 },
  rankVote: { flexDirection: "row", alignItems: "center", gap: 4 },
  rankVoteNum: { fontFamily: "DmSans_700Bold", fontSize: 14 },

  moreRow: { paddingVertical: 10 },
  moreText: { fontFamily: "DmSans_500Medium", fontSize: 13 },
  caption: {
    fontFamily: "DmSans_400Regular", fontSize: 12,
    textAlign: "center", paddingHorizontal: 24, marginTop: 12, marginBottom: 16,
  },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontFamily: "DmSans_400Regular", fontSize: 14 },

  /* CTA */
  cta: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  ctaBtn: {
    backgroundColor: "#E85D3A", borderRadius: 14, paddingVertical: 16,
    alignItems: "center",
  },
  ctaBtnText: { fontFamily: "DmSans_700Bold", fontSize: 16, color: "#fff" },
});
