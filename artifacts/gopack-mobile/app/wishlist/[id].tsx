import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
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

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { addWish, useTrip, useWishes } from "@/hooks/useFirebase";
import { SavedActivityWishPicker } from "@/components/SavedItemPickers";

/* ── Category detection for thumbnail icon ─────────────────── */
const CATEGORY_MAP: { keywords: string[]; icon: string; bg: string; color: string }[] = [
  { keywords: ["temple", "sacred", "spiritual", "shrine", "mosque", "church"], icon: "sun", bg: "#FFF3E0", color: "#FB8C00" },
  { keywords: ["beach", "surf", "ocean", "sea", "snorkel", "dive", "swim"], icon: "anchor", bg: "#E3F2FD", color: "#1E88E5" },
  { keywords: ["hike", "trek", "mountain", "waterfall", "nature", "forest", "jungle"], icon: "triangle", bg: "#E8F5E9", color: "#43A047" },
  { keywords: ["food", "cook", "class", "eat", "dinner", "lunch", "market", "restaurant"], icon: "coffee", bg: "#FFF8E1", color: "#F9A825" },
  { keywords: ["sail", "boat", "cruise", "kayak", "yacht"], icon: "wind", bg: "#E3F2FD", color: "#039BE5" },
  { keywords: ["spa", "massage", "relax", "wellness", "yoga"], icon: "heart", bg: "#FCE4EC", color: "#E91E63" },
  { keywords: ["museum", "art", "gallery", "culture", "history", "tour"], icon: "map", bg: "#F3E5F5", color: "#8E24AA" },
  { keywords: ["nightlife", "bar", "club", "night", "drink"], icon: "moon", bg: "#E8EAF6", color: "#3949AB" },
  { keywords: ["shopping", "market", "shop"], icon: "shopping-bag", bg: "#FFF3E0", color: "#FB8C00" },
  { keywords: ["day trip", "nusa", "island", "villa"], icon: "flag", bg: "#E0F7FA", color: "#00ACC1" },
];

function getCategory(text: string) {
  const lower = text.toLowerCase();
  for (const cat of CATEGORY_MAP) {
    if (cat.keywords.some((k) => lower.includes(k))) return cat;
  }
  return { icon: "star", bg: "#F5F5F5", color: "#9E9E9E" };
}

/* ── Wish thumbnail ─────────────────────────────────────────── */
function WishThumb({ text, size = 48 }: { text: string; size?: number }) {
  const cat = getCategory(text);
  return (
    <View style={[styles.thumb, { width: size, height: size, backgroundColor: cat.bg, borderRadius: size * 0.22 }]}>
      <Feather name={cat.icon as any} size={size * 0.42} color={cat.color} />
    </View>
  );
}

/* ── Tag chip ───────────────────────────────────────────────── */
function TagChip({ label }: { label: string }) {
  return (
    <View style={styles.tagChip}>
      <Text style={styles.tagChipText}>{label}</Text>
    </View>
  );
}

function getCategoryLabel(text: string): string {
  const lower = text.toLowerCase();
  if (lower.match(/temple|shrine|sacred|spiritual/)) return "Culture";
  if (lower.match(/beach|surf|ocean|sea|swim/)) return "Beach";
  if (lower.match(/hike|trek|waterfall|nature|forest/)) return "Adventure";
  if (lower.match(/food|cook|eat|dinner|market|restaurant/)) return "Food";
  if (lower.match(/sail|boat|cruise|kayak/)) return "Sailing";
  if (lower.match(/spa|massage|relax|yoga/)) return "Wellness";
  if (lower.match(/museum|art|gallery|history/)) return "Culture";
  if (lower.match(/night|bar|club/)) return "Nightlife";
  if (lower.match(/shop|market/)) return "Shopping";
  return "Activity";
}

/* ── Screen ─────────────────────────────────────────────────── */
export default function WishlistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { trip, loading } = useTrip(id);
  const wishes = useWishes(id);

  const [view, setView] = useState<"overview" | "all">("overview");
  const [tab, setTab] = useState<"all" | "member">("all");
  const [sortLabel] = useState("Newest");
  const [wishInput, setWishInput] = useState("");
  const [adding, setAdding] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 12;

  const members = Object.entries(trip?.members ?? {});
  const memberWishCounts: Record<string, number> = {};
  for (const w of wishes) {
    memberWishCounts[w.authorId] = (memberWishCounts[w.authorId] ?? 0) + 1;
  }
  const membersWithWishes = members.filter(([uid]) => (memberWishCounts[uid] ?? 0) > 0).length;

  const wishesGroupedByMember: Record<string, typeof wishes> = {};
  for (const w of wishes) {
    if (!wishesGroupedByMember[w.authorId]) wishesGroupedByMember[w.authorId] = [];
    wishesGroupedByMember[w.authorId].push(w);
  }

  const handleAddWish = async () => {
    if (!id || !user || !wishInput.trim()) return;
    setAdding(true);
    try {
      await addWish(id, wishInput.trim(), user.uid, user.displayName ?? "You");
      setWishInput("");
    } finally {
      setAdding(false);
    }
  };

  if (loading || !trip) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "DmSans_400Regular" }}>Loading…</Text>
      </View>
    );
  }

  /* ── OVERVIEW (Screen 7) ───────────────────────────────────── */
  if (view === "overview") {
    return (
      <KeyboardAvoidingView
        style={[styles.root, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Pack Wishlists</Text>
          <View style={styles.memberBadge}>
            <Text style={styles.memberBadgeText}>{membersWithWishes}/{members.length} added</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomInset + 80 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.overviewSubtitle, { color: colors.mutedForeground }]}>
            Everyone adds things they want to do.
          </Text>

          {/* Member rows */}
          <View style={[styles.memberList, { borderColor: colors.border }]}>
            {members.map(([uid, member]) => {
              const count = memberWishCounts[uid] ?? 0;
              const isMe = uid === user?.uid;
              const initials = member.name.charAt(0).toUpperCase();
              return (
                <Pressable
                  key={uid}
                  style={[styles.memberRow, { borderBottomColor: colors.border }]}
                  onPress={() => { setView("all"); setTab("member"); }}
                >
                  <View style={[styles.memberAvatar, { backgroundColor: uid === user?.uid ? "#E85D3A20" : "#F4BC5520" }]}>
                    <Text style={[styles.memberAvatarText, { color: uid === user?.uid ? "#E85D3A" : "#D4A017" }]}>
                      {initials}
                    </Text>
                  </View>
                  <View style={styles.memberMeta}>
                    <Text style={[styles.memberName, { color: colors.foreground }]}>
                      {isMe ? `You (${member.name})` : member.name}
                    </Text>
                    <Text style={[styles.memberWishCount, { color: count > 0 ? "#E85D3A" : colors.mutedForeground }]}>
                      {count > 0 ? `${count} wishes` : "No wishes yet"}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.overviewCaption, { color: colors.mutedForeground }]}>
            See progress of who has added their wishlist.
          </Text>

          {/* View all wishes CTA */}
          <View style={styles.overviewCta}>
            <Pressable style={styles.viewAllBtn} onPress={() => setView("all")}>
              <Text style={styles.viewAllBtnText}>View all wishes</Text>
            </Pressable>
          </View>
          <SavedActivityWishPicker
            key={user?.uid ?? "signed-out"}
            tripId={id}
            trip={trip}
            wishes={wishes}
            uid={user?.uid}
            displayName={user?.displayName ?? "You"}
          />
        </ScrollView>

        {/* Add wish bar */}
        <View style={[styles.addBar, { borderTopColor: colors.border, paddingBottom: bottomInset, backgroundColor: colors.background }]}>
          <TextInput
            style={[styles.addInput, { backgroundColor: colors.muted, color: colors.foreground }]}
            placeholder="Add your wish… (e.g. Sunset sailing)"
            placeholderTextColor={colors.mutedForeground}
            value={wishInput}
            onChangeText={setWishInput}
            onSubmitEditing={handleAddWish}
            returnKeyType="send"
            editable={!adding}
          />
          <Pressable
            style={[styles.addSendBtn, (!wishInput.trim() || adding) && { opacity: 0.4 }]}
            onPress={handleAddWish}
            disabled={!wishInput.trim() || adding}
          >
            <Feather name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  /* ── ALL WISHES (Screen 8) ─────────────────────────────────── */
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => setView("overview")} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>All Wishes</Text>
        <Pressable style={styles.voteNavBtn} onPress={() => router.push(`/wishlist-vote/${id}`)}>
          <Text style={styles.voteNavBtnText}>Vote</Text>
          <Feather name="chevron-right" size={13} color="#fff" />
        </Pressable>
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <Pressable
          style={[styles.tabItem, tab === "all" && [styles.tabItemActive, { borderBottomColor: "#E85D3A" }]]}
          onPress={() => setTab("all")}
        >
          <Text style={[styles.tabText, { color: tab === "all" ? "#E85D3A" : colors.mutedForeground }]}>All wishes</Text>
        </Pressable>
        <Pressable
          style={[styles.tabItem, tab === "member" && [styles.tabItemActive, { borderBottomColor: "#E85D3A" }]]}
          onPress={() => setTab("member")}
        >
          <Text style={[styles.tabText, { color: tab === "member" ? "#E85D3A" : colors.mutedForeground }]}>By member</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset + 80 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {tab === "all" && (
          <>
            <SavedActivityWishPicker
            key={user?.uid ?? "signed-out"}
              tripId={id}
              trip={trip}
              wishes={wishes}
              uid={user?.uid}
              displayName={user?.displayName ?? "You"}
            />
            {/* Filter row */}
            <View style={styles.filterRow}>
              <View style={[styles.filterPill, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={[styles.filterPillText, { color: colors.foreground }]}>All categories</Text>
                <Feather name="chevron-down" size={12} color={colors.mutedForeground} />
              </View>
              <View style={[styles.filterPill, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={[styles.filterPillText, { color: colors.foreground }]}>{sortLabel}</Text>
                <Feather name="chevron-down" size={12} color={colors.mutedForeground} />
              </View>
            </View>

            {wishes.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="star" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No wishes yet</Text>
                <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                  Add your first wish below. Everyone in the pack adds what they personally want to do.
                </Text>
              </View>
            ) : (
              <>
                {wishes.map((w) => {
                  const upCount = Object.keys(w.upvoters ?? {}).length;
                  const downCount = Object.keys(w.downvoters ?? {}).length;
                  const tag = getCategoryLabel(w.text);
                  return (
                    <View key={w.id} style={[styles.wishCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <WishThumb text={w.text} />
                      <View style={styles.wishCardBody}>
                        <Text style={[styles.wishCardName, { color: colors.foreground }]} numberOfLines={2}>{w.text}</Text>
                        <Text style={[styles.wishCardAuthor, { color: colors.mutedForeground }]}>Added by {w.authorName}</Text>
                        <View style={styles.wishCardTags}>
                          <TagChip label={tag} />
                        </View>
                      </View>
                      <View style={styles.wishCardVotes}>
                        {upCount > 0 && (
                          <View style={styles.voteMini}>
                            <Feather name="thumbs-up" size={10} color="#4CAF50" />
                            <Text style={[styles.voteMiniText, { color: "#4CAF50" }]}>{upCount}</Text>
                          </View>
                        )}
                        {downCount > 0 && (
                          <View style={styles.voteMini}>
                            <Feather name="thumbs-down" size={10} color="#EF5350" />
                            <Text style={[styles.voteMiniText, { color: "#EF5350" }]}>{downCount}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
                {wishes.length > 5 && (
                  <Text style={[styles.moreWishes, { color: colors.mutedForeground }]}>
                    + {wishes.length - 5} more wishes
                  </Text>
                )}
                <Text style={[styles.sectionCaption, { color: colors.mutedForeground }]}>
                  All wishes added by the pack, grouped.
                </Text>
              </>
            )}
          </>
        )}

        {tab === "member" && (
          <>
            {members.map(([uid, member]) => {
              const memberWishes = wishesGroupedByMember[uid] ?? [];
              const isMe = uid === user?.uid;
              return (
                <View key={uid} style={styles.memberGroup}>
                  <View style={[styles.memberGroupHeader, { borderBottomColor: colors.border }]}>
                    <View style={[styles.memberAvatarSm, { backgroundColor: isMe ? "#E85D3A20" : "#F4BC5520" }]}>
                      <Text style={[styles.memberAvatarSmText, { color: isMe ? "#E85D3A" : "#D4A017" }]}>
                        {member.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={[styles.memberGroupName, { color: colors.foreground }]}>
                      {isMe ? `${member.name} (you)` : member.name}
                    </Text>
                    <Text style={[styles.memberGroupCount, { color: colors.mutedForeground }]}>
                      {memberWishes.length} wishes
                    </Text>
                  </View>
                  {memberWishes.length === 0 && (
                    <Text style={[styles.noWishes, { color: colors.mutedForeground }]}>No wishes added yet</Text>
                  )}
                  {memberWishes.map((w) => {
                    const upCount = Object.keys(w.upvoters ?? {}).length;
                    const downCount = Object.keys(w.downvoters ?? {}).length;
                    return (
                      <View key={w.id} style={[styles.wishCard, styles.wishCardIndent, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <WishThumb text={w.text} size={40} />
                        <View style={styles.wishCardBody}>
                          <Text style={[styles.wishCardName, { color: colors.foreground }]} numberOfLines={1}>{w.text}</Text>
                          <View style={styles.wishCardTags}>
                            <TagChip label={getCategoryLabel(w.text)} />
                          </View>
                        </View>
                        <View style={styles.wishCardVotes}>
                          {upCount > 0 && (
                            <View style={styles.voteMini}>
                              <Feather name="thumbs-up" size={10} color="#4CAF50" />
                              <Text style={[styles.voteMiniText, { color: "#4CAF50" }]}>{upCount}</Text>
                            </View>
                          )}
                          {downCount > 0 && (
                            <View style={styles.voteMini}>
                              <Feather name="thumbs-down" size={10} color="#EF5350" />
                              <Text style={[styles.voteMiniText, { color: "#EF5350" }]}>{downCount}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Add wish bar */}
      <View style={[styles.addBar, { borderTopColor: colors.border, paddingBottom: bottomInset, backgroundColor: colors.background }]}>
        <TextInput
          style={[styles.addInput, { backgroundColor: colors.muted, color: colors.foreground }]}
          placeholder="Add your wish… (e.g. Sunset sailing)"
          placeholderTextColor={colors.mutedForeground}
          value={wishInput}
          onChangeText={setWishInput}
          onSubmitEditing={handleAddWish}
          returnKeyType="send"
          editable={!adding}
        />
        <Pressable
          style={[styles.addSendBtn, (!wishInput.trim() || adding) && { opacity: 0.4 }]}
          onPress={handleAddWish}
          disabled={!wishInput.trim() || adding}
        >
          <Feather name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  /* Header */
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { flex: 1, fontFamily: "DmSans_700Bold", fontSize: 18 },
  memberBadge: {
    backgroundColor: "#4CAF5020", borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  memberBadgeText: { fontFamily: "DmSans_600SemiBold", fontSize: 12, color: "#4CAF50" },
  voteNavBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#E85D3A", borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  voteNavBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13, color: "#fff" },

  /* Overview */
  overviewSubtitle: {
    fontFamily: "DmSans_400Regular", fontSize: 14,
    paddingHorizontal: 20, marginTop: 16, marginBottom: 12,
  },
  memberList: { borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: 16, borderRadius: 14, overflow: "hidden" },
  memberRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
    backgroundColor: "#fff",
  },
  memberAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  memberAvatarText: { fontFamily: "DmSans_700Bold", fontSize: 20 },
  memberMeta: { flex: 1 },
  memberName: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  memberWishCount: { fontFamily: "DmSans_400Regular", fontSize: 13, marginTop: 2 },
  overviewCaption: {
    fontFamily: "DmSans_400Regular", fontSize: 12,
    textAlign: "center", marginTop: 12, paddingHorizontal: 24,
  },
  overviewCta: { paddingHorizontal: 20, marginTop: 24 },
  viewAllBtn: {
    backgroundColor: "#E85D3A", borderRadius: 14,
    paddingVertical: 15, alignItems: "center",
  },
  viewAllBtnText: { fontFamily: "DmSans_700Bold", fontSize: 16, color: "#fff" },

  /* All Wishes tab bar */
  tabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabItemActive: { borderBottomWidth: 2 },
  tabText: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },

  /* Filter row */
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  filterPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  filterPillText: { fontFamily: "DmSans_500Medium", fontSize: 13 },

  /* Wish card */
  wishCard: {
    flexDirection: "row", alignItems: "flex-start",
    marginHorizontal: 16, marginTop: 10,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    padding: 12, gap: 10,
  },
  wishCardIndent: { marginLeft: 16 },
  thumb: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  wishCardBody: { flex: 1 },
  wishCardName: { fontFamily: "DmSans_600SemiBold", fontSize: 14, lineHeight: 19 },
  wishCardAuthor: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 2 },
  wishCardTags: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  tagChip: { backgroundColor: "#F5F5F5", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  tagChipText: { fontFamily: "DmSans_500Medium", fontSize: 11, color: "#616161" },
  wishCardVotes: { alignItems: "flex-end", gap: 4, paddingTop: 2 },
  voteMini: { flexDirection: "row", alignItems: "center", gap: 3 },
  voteMiniText: { fontFamily: "DmSans_600SemiBold", fontSize: 11 },

  moreWishes: {
    fontFamily: "DmSans_500Medium", fontSize: 13,
    textAlign: "center", marginTop: 16,
  },
  sectionCaption: {
    fontFamily: "DmSans_400Regular", fontSize: 12,
    textAlign: "center", marginTop: 8, paddingHorizontal: 24, marginBottom: 8,
  },

  /* Member group */
  memberGroup: { marginTop: 16, marginHorizontal: 16 },
  memberGroupHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 8,
  },
  memberAvatarSm: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  memberAvatarSmText: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  memberGroupName: { flex: 1, fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  memberGroupCount: { fontFamily: "DmSans_400Regular", fontSize: 13 },
  noWishes: { fontFamily: "DmSans_400Regular", fontSize: 13, paddingLeft: 42, paddingVertical: 6 },

  /* Empty */
  emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontFamily: "DmSans_700Bold", fontSize: 18 },
  emptyBody: { fontFamily: "DmSans_400Regular", fontSize: 14, textAlign: "center", lineHeight: 20 },

  /* Add bar */
  addBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, gap: 8,
  },
  addInput: {
    flex: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: "DmSans_400Regular", fontSize: 14,
  },
  addSendBtn: {
    backgroundColor: "#E85D3A", borderRadius: 10,
    padding: 11, alignItems: "center", justifyContent: "center",
  },
});
