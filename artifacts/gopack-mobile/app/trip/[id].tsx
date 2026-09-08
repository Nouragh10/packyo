import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { GoPackIcon } from "@/components/GoPackLogo";
import { Mascot } from "@/components/Mascot";
import {
  addWish,
  lockVotes,
  confirmPack,
  incrementAiUsage,
  unlockVotes,
  useTrip,
  useWishes,
  voteWish,
  Wish,
} from "@/hooks/useFirebase";

const MEMBER_COLORS = ["#F15A3A", "#F4BC55", "#A77BD6", "#68B7A0", "#EE9D54", "#6EA6D8"];

const WISH_PLACEHOLDERS = [
  "Visit a local market at sunrise…",
  "Find the best street food spot…",
  "Watch the sunset from a rooftop…",
  "Take a cooking class together…",
  "Explore a hidden neighbourhood…",
  "Go on a sunrise hike…",
  "Try a boat tour of the coast…",
  "Find a cosy jazz bar for the evening…",
  "Day trip to nearby ruins or nature…",
  "Catch a live music night…",
];

type Tab = "overview" | "wish" | "vote" | "go";

function Avatar({ name, index, size = 32 }: { name: string; index: number; size?: number }) {
  const bg = MEMBER_COLORS[index % MEMBER_COLORS.length];
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: bg, alignItems: "center", justifyContent: "center",
        borderWidth: 1.5, borderColor: "#fff",
      }}
    >
      <Text style={{ color: "#fff", fontSize: size * 0.38, fontFamily: "DmSans_700Bold" }}>
        {(name ?? "?")[0].toUpperCase()}
      </Text>
    </View>
  );
}

/* ── Swipe card constants ────────────────────────────────────────── */

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 420);

/* ── TopSwipeCard ────────────────────────────────────────────────── */

function TopSwipeCard({
  wish, uid, onSwipeLeft, onSwipeRight, colors,
}: {
  wish: Wish; uid: string;
  onSwipeLeft: () => void; onSwipeRight: () => void; colors: any;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.2;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD) {
        tx.value = withTiming(SCREEN_WIDTH * 1.5, { duration: 280 }, (done) => {
          if (done) runOnJS(onSwipeRight)();
        });
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        tx.value = withTiming(-SCREEN_WIDTH * 1.5, { duration: 280 }, (done) => {
          if (done) runOnJS(onSwipeLeft)();
        });
      } else {
        tx.value = withSpring(0, { damping: 14, stiffness: 130 });
        ty.value = withSpring(0, { damping: 14, stiffness: 130 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-SCREEN_WIDTH, 0, SCREEN_WIDTH], [-14, 0, 14])}deg` },
    ],
  }));

  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [20, SWIPE_THRESHOLD * 0.8], [0, 1], Extrapolation.CLAMP),
  }));

  const nopeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_THRESHOLD * 0.8, -20], [1, 0], Extrapolation.CLAMP),
  }));

  const upvoted = !!wish.upvoters?.[uid];
  const downvoted = !!wish.downvoters?.[uid];
  const score = wish.score ?? 0;
  const authorIdx = (wish.authorName ?? "?").charCodeAt(0) % MEMBER_COLORS.length;

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.swipeCard, { backgroundColor: colors.card, borderColor: colors.border }, cardStyle]}>
        {/* Header strip — labels stamp over this */}
        <View style={[styles.swipeCardHeader, { backgroundColor: colors.primary + "12" }]}>
          <View style={styles.swipeCardAuthorRow}>
            <Avatar name={wish.authorName} index={authorIdx} size={26} />
            <Text style={[styles.swipeCardAuthor, { color: colors.mutedForeground }]}>{wish.authorName}</Text>
          </View>
          <View style={[styles.swipeScorePill, { backgroundColor: score > 0 ? "#4CAF5022" : colors.muted }]}>
            <Feather name="arrow-up" size={12} color={score > 0 ? "#4CAF50" : colors.mutedForeground} />
            <Text style={[styles.swipeScoreText, { color: score > 0 ? "#4CAF50" : colors.mutedForeground }]}>
              {score > 0 ? `+${score}` : score}
            </Text>
          </View>
        </View>

        {/* LOVE IT stamp */}
        <Animated.View style={[styles.swipeLabel, styles.swipeLabelRight, likeStyle]}>
          <Feather name="heart" size={18} color="#4CAF50" />
          <Text style={[styles.swipeLabelText, { color: "#4CAF50" }]}>LOVE IT</Text>
        </Animated.View>
        {/* SKIP stamp */}
        <Animated.View style={[styles.swipeLabel, styles.swipeLabelLeft, nopeStyle]}>
          <Feather name="x" size={18} color="#ef4444" />
          <Text style={[styles.swipeLabelText, { color: "#ef4444" }]}>SKIP</Text>
        </Animated.View>

        {/* Wish text */}
        <View style={styles.swipeCardBody}>
          {(upvoted || downvoted) && (
            <View style={[styles.prevVotePill, { backgroundColor: upvoted ? "#4CAF5015" : "#9E9E9E15", alignSelf: "flex-start" }]}>
              <Feather name={upvoted ? "heart" : "x"} size={11} color={upvoted ? "#4CAF50" : "#9E9E9E"} />
              <Text style={[styles.prevVoteText, { color: upvoted ? "#4CAF50" : "#9E9E9E" }]}>
                {upvoted ? "You loved this" : "You skipped"}
              </Text>
            </View>
          )}
          <Text style={[styles.swipeCardWishText, { color: colors.foreground }]}>{wish.text}</Text>
          <Text style={[styles.swipeHint, { color: colors.mutedForeground }]}>swipe or tap below</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/* ── SwipeWishStack ──────────────────────────────────────────────── */

/* ── WishItem (Wish tab — simple list row) ──────────────────────── */

function WishItem({ wish, colors }: { wish: Wish; colors: any }) {
  return (
    <View style={[styles.wishRow, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.wishText, { color: colors.foreground }]}>{wish.text}</Text>
        <Text style={[styles.wishAuthor, { color: colors.mutedForeground }]}>{wish.authorName}</Text>
      </View>
    </View>
  );
}

/* ── SwipeWishStack (Vote tab) ───────────────────────────────────── */

function SwipeWishStack({
  wishes, uid, userName, tripId, colors, onComplete,
}: {
  wishes: Wish[]; uid: string; userName: string; tripId: string; colors: any;
  onComplete?: () => void;
}) {
  // Snapshot the order at mount — prevents Firebase re-sorts from shuffling cards mid-session
  const [swipeOrder] = useState<string[]>(() => wishes.map((w) => w.id));
  // Live wish data by ID (score, upvoters, etc. stay current)
  const wishMap = useMemo(() => new Map(wishes.map((w) => [w.id, w])), [wishes]);

  const [topIndex, setTopIndex] = useState(0);
  // Refs so runOnJS worklets always read the latest values without stale closures
  const topIndexRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  topIndexRef.current = topIndex;
  onCompleteRef.current = onComplete;

  // Stable callbacks — no state/prop deps that could go stale inside Reanimated worklets
  const onSwipeRight = useCallback(() => {
    const i = topIndexRef.current;
    const wishId = swipeOrder[i];
    if (!wishId) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    voteWish(tripId, wishId, uid, userName, "up");
    topIndexRef.current = i + 1;
    setTopIndex(i + 1);
    if (i + 1 >= swipeOrder.length) onCompleteRef.current?.();
  }, [tripId, uid, userName, swipeOrder]);

  const onSwipeLeft = useCallback(() => {
    const i = topIndexRef.current;
    const wishId = swipeOrder[i];
    if (!wishId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    voteWish(tripId, wishId, uid, userName, "down");
    topIndexRef.current = i + 1;
    setTopIndex(i + 1);
    if (i + 1 >= swipeOrder.length) onCompleteRef.current?.();
  }, [tripId, uid, userName, swipeOrder]);

  if (wishes.length === 0) {
    return (
      <View style={styles.emptyWish}>
        <Feather name="star" size={32} color="#ccc" />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No wishes yet — add the first one below!</Text>
      </View>
    );
  }

  if (topIndex >= swipeOrder.length) {
    return (
      <View style={styles.allDoneWrap}>
        <View style={[styles.allDoneCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="check-circle" size={44} color={colors.primary} />
          <Text style={[styles.allDoneTitle, { color: colors.foreground }]}>All caught up!</Text>
          <Text style={[styles.allDoneSub, { color: colors.mutedForeground }]}>
            You've voted on all {swipeOrder.length} {swipeOrder.length === 1 ? "wish" : "wishes"}.
          </Text>
        </View>
      </View>
    );
  }

  const topWish = wishMap.get(swipeOrder[topIndex]);
  const nextWish = wishMap.get(swipeOrder[topIndex + 1]);
  const thirdWish = wishMap.get(swipeOrder[topIndex + 2]);
  if (!topWish) return null;

  return (
    <View style={styles.swipeStackWrap}>
      <Text style={[styles.swipeCounter, { color: colors.mutedForeground }]}>
        {topIndex + 1} / {swipeOrder.length}
      </Text>

      <View style={styles.swipeStack}>
        {thirdWish && (
          <View style={[styles.swipeCard, styles.swipeBgCard3, { backgroundColor: colors.card, borderColor: colors.border }]} />
        )}
        {nextWish && (
          <View style={[styles.swipeCard, styles.swipeBgCard2, { backgroundColor: colors.card, borderColor: colors.border }]} />
        )}
        <TopSwipeCard
          key={`card-${topIndex}`}
          wish={topWish}
          uid={uid}
          onSwipeLeft={onSwipeLeft}
          onSwipeRight={onSwipeRight}
          colors={colors}
        />
      </View>

      <View style={styles.swipeTapRow}>
        <Pressable
          onPress={onSwipeLeft}
          style={[styles.swipeTapBtn, { backgroundColor: "#ef444418" }]}
        >
          <Feather name="x" size={22} color="#ef4444" />
        </Pressable>
        <Pressable
          onPress={onSwipeRight}
          style={[styles.swipeTapBtn, { backgroundColor: "#F15A3A" }]}
        >
          <Feather name="heart" size={20} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

/* ── VoteCard (Vote tab) ─────────────────────────────────────────── */

function VoteCard({
  wish, rank, memberCount, colors,
}: {
  wish: Wish; rank: number; memberCount: number; colors: any;
}) {
  const upNames = Object.values(wish.upvoters ?? {}) as string[];
  const downNames = Object.values(wish.downvoters ?? {}) as string[];
  const score = wish.score ?? 0;

  const isPackFavorite = memberCount > 0 && upNames.length >= memberCount;
  const isLeastFavorite = memberCount > 0 && downNames.length >= memberCount;

  return (
    <View style={[
      styles.voteCard,
      { backgroundColor: colors.card, borderColor: isPackFavorite ? colors.primary : isLeastFavorite ? "#9E9E9E" : colors.border },
    ]}>
      <View style={styles.voteCardTop}>
        <Text style={[styles.voteRank, { color: colors.mutedForeground }]}>{rank}</Text>
        <Text style={[styles.voteCardText, { color: colors.foreground }]} numberOfLines={3}>
          {wish.text}
        </Text>
        <View
          style={[
            styles.scorePill,
            { backgroundColor: score > 0 ? colors.primary : score < 0 ? "#9E9E9E30" : colors.muted },
          ]}
        >
          <Text style={[styles.scorePillText, { color: score > 0 ? "#fff" : colors.foreground }]}>
            {score > 0 ? `+${score}` : score}
          </Text>
        </View>
      </View>

      {(isPackFavorite || isLeastFavorite) && (
        <View style={[
          styles.packBadge,
          { backgroundColor: isPackFavorite ? colors.primary + "18" : "#9E9E9E18",
            borderColor: isPackFavorite ? colors.primary + "40" : "#9E9E9E40" },
        ]}>
          <Text style={[styles.packBadgeText, { color: isPackFavorite ? colors.primary : "#757575" }]}>
            {isPackFavorite ? "Pack's Favorite!" : "Least Favorite!"}
          </Text>
        </View>
      )}

      {upNames.length > 0 && (
        <View style={styles.voterRow}>
          <Feather name="arrow-up" size={12} color={colors.primary} />
          <Text style={[styles.voterNames, { color: colors.primary }]} numberOfLines={1}>
            {upNames.join(", ")}
          </Text>
        </View>
      )}
      {downNames.length > 0 && (
        <View style={styles.voterRow}>
          <Feather name="arrow-down" size={12} color={colors.mutedForeground} />
          <Text style={[styles.voterNames, { color: colors.mutedForeground }]} numberOfLines={1}>
            {downNames.join(", ")}
          </Text>
        </View>
      )}
    </View>
  );
}

/* ── Screen ──────────────────────────────────────────────────────── */

export default function TripHubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { trip, loading } = useTrip(id);
  const wishes = useWishes(id);

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [wishInput, setWishInput] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const placeholderTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    placeholderTimer.current = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % WISH_PLACEHOLDERS.length);
    }, 2800);
    return () => { if (placeholderTimer.current) clearInterval(placeholderTimer.current); };
  }, []);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [lockingVotes, setLockingVotes] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 12;

  const members = Object.entries(trip?.members ?? {});
  const memberCount = members.length;
  const memberNames = members.map(([, m]) => m.name);
  const isHost = user?.uid === trip?.hostMemberId;

  const tripEnded = (() => {
    if (!trip?.startDate) return false;
    const start = new Date(trip.startDate);
    const end = new Date(start.getTime() + (trip.days || 1) * 24 * 60 * 60 * 1000);
    return end < new Date();
  })();
  const isMember = !!trip?.members?.[user?.uid ?? ""];
  const hasReview = !!user && !!(
    trip?.memberReviews?.[user.uid] ||
    (trip?.review as { reviewedBy?: string } | undefined)?.reviewedBy === user.uid
  );
  const showReviewBanner = tripEnded && isMember && !hasReview;

  const lockedBy = trip?.votesLockedBy ?? {};
  const lockedCount = Object.keys(lockedBy).length;
  const allLocked = memberCount > 0 && lockedCount >= memberCount;
  const myLocked = !!lockedBy[user?.uid ?? ""];

  const pendingDestination = !trip?.destination && !!trip?.destinationSuggestions?.length;
  const collectingPreferences = !!trip?.collectingPreferences && !trip?.destinationSuggestions?.length;
  const accomStatus = trip?.accommodationStatus;
  const destConfirmed = !!trip?.destination;
  const showAccomBanner = destConfirmed && !accomStatus;
  const accomVoting = accomStatus === "voting";
  const accomConfirmed = accomStatus === "confirmed";
  const accomCollecting = accomStatus === "collecting_prefs";
  const checklistSteps = [
    { id: "dest", done: destConfirmed },
    { id: "wish", done: wishes.length > 0 },
    { id: "accom", done: accomConfirmed || accomStatus === "skipped" },
    { id: "itinerary", done: !!trip?.itinerary },
  ];
  const completedSteps = checklistSteps.filter(s => s.done).length;
  const totalSteps = checklistSteps.length;


  const handleAddWish = async () => {
    if (!wishInput.trim() || !user || !id) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await addWish(id, wishInput.trim(), user.uid, user.displayName ?? "Traveler");
    setWishInput("");
  };

  const handleToggleLock = async () => {
    if (!user || !id) return;
    if (!myLocked && wishes.length > 0) {
      const unvoted = wishes.filter(
        (w) => !w.upvoters?.[user.uid] && !w.downvoters?.[user.uid],
      );
      if (unvoted.length > 0) {
        Alert.alert(
          "Vote on everything first",
          `You still need to vote on ${unvoted.length} wish${unvoted.length > 1 ? "es" : ""} before locking in. Go through the list and give each one a ▲ or ▼.`,
          [{ text: "OK" }],
        );
        return;
      }
    }
    setLockingVotes(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (myLocked) {
        await unlockVotes(id, user.uid);
      } else {
        await lockVotes(id, user.uid);
      }
    } finally {
      setLockingVotes(false);
    }
  };

  const inviteLink = `https://gopacknow.app/join/${id ?? ""}`;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleCopyId = async () => {
    await Clipboard.setStringAsync(trip?.inviteCode ?? id ?? "");
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

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

  const waitingMembers = members
    .filter(([uid]) => !lockedBy[uid])
    .map(([, m]) => m.name);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {activeTab === "overview" && (
        <View style={{ flex: 1 }}>
          <View style={[styles.heroHeader, { paddingTop: topInset }]}>
            <Pressable onPress={() => router.back()} style={styles.heroBack}>
              <Feather name="arrow-left" size={24} color="#fff" />
            </Pressable>
            <View style={styles.heroContent}>
              <Text style={styles.heroTitle}>{trip.destination || (trip as any).packName || "Destination TBD"}</Text>
              <Text style={styles.heroDates}>
                {trip.startDate ? new Date(trip.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : "Dates TBD"}
                {trip.startDate && trip.days
                  ? ` - ${new Date(trip.endDate ?? new Date(new Date(trip.startDate).getTime() + Math.max(0, trip.days - 1) * 86400000)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : ""}
              </Text>
            </View>
          </View>
          
          <View style={styles.overviewBody}>
            <View style={styles.membersRowOverview}>
              <View style={styles.membersStackOverview}>
                {memberNames.slice(0, 4).map((name, i) => (
                  <View key={i} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                    <Avatar name={name} index={i} size={36} />
                  </View>
                ))}
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.membersCountOverview, { color: colors.foreground }]}>{memberCount} members</Text>
              </View>
              <Pressable onPress={() => setShowInvite(true)} style={styles.inviteBtnOverview}>
                <Feather name="user-plus" size={14} color={colors.primary} />
                <Text style={styles.inviteBtnOverviewText}>Invite</Text>
              </Pressable>
            </View>

            <View style={styles.progressContainer}>
              <Text style={[styles.progressTitle, { color: colors.foreground }]}>Planning progress</Text>
              <Text style={[styles.progressSubtitle, { color: colors.mutedForeground }]}>{completedSteps} of {totalSteps} steps complete</Text>
              <View style={[styles.progressBarOverview, { backgroundColor: colors.muted }]}>
                <View style={[styles.progressFillOverview, { backgroundColor: colors.primary, width: `${totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0}%` }]} />
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomInset + 20 }}>
              {tripEnded && isMember ? (
                <Pressable
                  onPress={() => router.push(hasReview ? `/memory/${id}` : `/review/${id}`)}
                  style={[styles.reviewBanner, { backgroundColor: hasReview ? "#7E57C2" : colors.primary }]}
                >
                  <Feather name={hasReview ? "book-open" : "camera"} size={17} color="#fff" />
                  <Text style={styles.reviewBannerText}>
                    {hasReview ? "Open your trip memory guide" : "Rate the trip, add photos, and make a memory guide"}
                  </Text>
                  <Feather name="chevron-right" size={17} color="#fff" />
                </Pressable>
              ) : null}
              {checklistSteps.map((step, idx) => {
                let icon = "circle";
                let title = "";
                let onPress = () => {};
                let statusIcon = step.done ? "check-circle" : "chevron-right";
                let statusColor = step.done ? "#4CAF50" : colors.mutedForeground;

                switch (step.id) {
                  case "dest":
                    icon = "map-pin"; title = "Destination";
                    onPress = () => router.push(destConfirmed ? `/destination-vote/${id}` : `/destination-preferences/${id}`);
                    break;
                  case "pref":
                    icon = "sliders"; title = "Destination Preferences";
                    onPress = () => router.push(`/destination-preferences/${id}`);
                    if (!destConfirmed && collectingPreferences) { statusIcon = "clock"; statusColor = "#F59E0B"; }
                    break;
                  case "wish":
                    icon = "star"; title = "Wishes";
                    onPress = () => router.push(`/wishlist/${id}`);
                    break;
                  case "vote":
                    icon = "check-square"; title = "Vote on Wishes";
                    onPress = () => router.push(`/wishlist-vote/${id}`);
                    if (wishes.length > 0 && !allLocked) { statusIcon = "clock"; statusColor = "#F59E0B"; }
                    break;
                  case "accom":
                    icon = "home"; title = "Accommodation";
                    onPress = () => router.push(`/accommodation/${id}`);
                    if (accomVoting || accomCollecting) { statusIcon = "clock"; statusColor = "#F59E0B"; }
                    break;
                  case "itinerary":
                    icon = "calendar"; title = "Itinerary";
                    if (trip.itinerary) {
                      onPress = () => router.push(`/itinerary/${id}`);
                    } else if (allLocked) {
                      onPress = () => router.push(`/building/${id}`);
                      statusIcon = "clock"; statusColor = "#F59E0B";
                    } else {
                      onPress = () => setActiveTab("go");
                      statusIcon = "clock"; statusColor = "#F59E0B";
                    }
                    break;
                }

                if (step.id === "pref" && destConfirmed) return null; // Hide prefs once confirmed like in wireframe

                return (
                  <React.Fragment key={step.id}>
                    <Pressable onPress={onPress} style={[styles.checklistItem, { borderBottomColor: colors.border }]}>
                      <View style={[styles.checklistIconWrap, { backgroundColor: step.done ? "#4CAF5015" : colors.muted }]}>
                        <Feather name={icon as any} size={18} color={step.done ? "#4CAF50" : colors.foreground} />
                      </View>
                      <Text style={[styles.checklistTitle, { color: colors.foreground }]}>{title}</Text>
                      <Feather name={statusIcon as any} size={20} color={statusColor} />
                    </Pressable>
                    {step.id === "dest" && !destConfirmed && (
                      <Pressable
                        onPress={() => router.push(`/destination-preferences/${id}`)}
                        style={[styles.helpDecideBtn, { backgroundColor: "#E85D3A15", borderColor: "#E85D3A40" }]}
                      >
                        <Feather name="compass" size={15} color="#E85D3A" />
                        <Text style={styles.helpDecideText}>Help us decide!</Text>
                      </Pressable>
                    )}
                  </React.Fragment>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Other Tabs (Wish, Vote, Go) */}
      {activeTab !== "overview" && (
        <>
          <View style={[styles.header, { paddingTop: topInset + 12, borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setActiveTab("overview")} style={styles.backBtn}>
              <Feather name="arrow-left" size={22} color={colors.foreground} />
            </Pressable>
            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
                {activeTab === 'wish' ? 'Wishes' : activeTab === 'vote' ? 'Vote on Wishes' : 'Itinerary'}
              </Text>
            </View>
          </View>

          {/* ── PACK GATE ── */}
          {!trip?.packConfirmed && (
            <View style={styles.packGate}>
              <GoPackIcon size={64} />
              <Text style={[styles.gateTitle, { color: colors.foreground }]}>
                {isHost ? "Is the pack complete?" : "Waiting for the host…"}
              </Text>
              <Text style={[styles.gateSub, { color: colors.mutedForeground }]}>
                {isHost
                  ? "Once everyone has joined, confirm the pack to unlock the wishlist and start planning."
                  : `${trip?.members?.[trip?.hostMemberId ?? ""]?.name ?? "The host"} will confirm the pack when everyone is in.`}
              </Text>
              <View style={[styles.gateBadge, { backgroundColor: colors.muted, borderColor: colors.border, gap: 6 }]}>
                <Feather name="users" size={14} color={colors.mutedForeground} />
                <Text style={[styles.gateBadgeText, { color: colors.mutedForeground }]}>
                  {memberCount} {memberCount === 1 ? "member" : "members"} · {memberNames.join(", ")}
                </Text>
              </View>
              <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowInvite(true); }} style={[styles.gateBtn, { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border }]}>
                <Feather name="user-plus" size={16} color={colors.foreground} />
                <Text style={[styles.gateBtnText, { color: colors.foreground }]}>Invite someone</Text>
              </Pressable>
              {isHost && (
                <Pressable onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); await confirmPack(id as string); }} style={[styles.gateBtn, { backgroundColor: colors.primary, marginTop: 0 }]}>
                  <Feather name="check-circle" size={18} color="#fff" />
                  <Text style={styles.gateBtnText}>Pack is complete — let's go!</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── WISH TAB ── */}
          {trip?.packConfirmed && activeTab === "wish" && (
            <View style={{ flex: 1 }}>
              <FlatList
                data={wishes}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => <WishItem wish={item} colors={colors} />}
                ListEmptyComponent={<View style={styles.emptyWish}><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No wishes yet — add the first one below!</Text></View>}
                contentContainerStyle={{ paddingTop: 8 }}
              />
              <View style={[styles.addWishBar, { borderTopColor: colors.border, paddingBottom: bottomInset + 12 }]}>
                <TextInput style={[styles.addWishInput, { backgroundColor: colors.muted, color: colors.foreground }]} placeholder={WISH_PLACEHOLDERS[placeholderIdx]} placeholderTextColor={colors.mutedForeground} value={wishInput} onChangeText={setWishInput} onSubmitEditing={handleAddWish} returnKeyType="done" />
                <Pressable onPress={handleAddWish} style={[styles.addWishBtn, { backgroundColor: colors.primary }]} disabled={!wishInput.trim()}>
                  <Feather name="plus" size={22} color="#fff" />
                </Pressable>
              </View>
            </View>
          )}

          {/* ── VOTE TAB ── */}
          {trip?.packConfirmed && activeTab === "vote" && (
            <View style={{ flex: 1 }}>
              <View style={[styles.lockBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.lockBarTitle, { color: colors.foreground }]}>{allLocked ? "Everyone's voted ✓" : `${lockedCount} of ${memberCount} finished voting`}</Text>
                  <View style={[styles.lockProgress, { backgroundColor: colors.muted }]}><View style={[styles.lockProgressFill, { backgroundColor: allLocked ? "#4CAF50" : colors.primary, width: memberCount > 0 ? `${(lockedCount / memberCount) * 100}%` : "0%" }]} /></View>
                </View>
                {myLocked && (
                  <Pressable onPress={async () => { setLockingVotes(true); await unlockVotes(id!, user?.uid ?? ""); setLockingVotes(false); }} disabled={lockingVotes} style={[styles.lockBtn, { backgroundColor: colors.primary }]}>
                    {lockingVotes ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="refresh-cw" size={14} color="#fff" /><Text style={styles.lockBtnText}>Re-vote</Text></>}
                  </Pressable>
                )}
              </View>
              {!myLocked ? (
                <SwipeWishStack wishes={wishes} uid={user?.uid ?? ""} userName={user?.displayName ?? "Traveler"} tripId={id!} colors={colors} onComplete={async () => { setLockingVotes(true); await lockVotes(id!, user?.uid ?? ""); setLockingVotes(false); }} />
              ) : (
                <FlatList data={wishes} keyExtractor={(item) => item.id} renderItem={({ item, index }) => <VoteCard wish={item} rank={index + 1} memberCount={memberCount} colors={colors} />} ListHeaderComponent={<View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}><Text style={[styles.lockBarTitle, { color: colors.foreground }]}>Current rankings</Text></View>} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 12 }} />
              )}
            </View>
          )}

          {/* ── GO TAB ── */}
          {trip?.packConfirmed && activeTab === "go" && (
            <ScrollView contentContainerStyle={[styles.goTab, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
              {/* Vote lock-in status */}
              <View style={[styles.membersLockCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.membersLockTitle, { color: colors.foreground }]}>Vote lock-in status</Text>
                {members.map(([uid, member], i) => (
                  <View key={uid} style={[styles.memberLockRow, { borderTopColor: colors.border }]}>
                    <Avatar name={member.name} index={i} size={28} />
                    <Text style={[styles.memberLockName, { color: colors.foreground }]}>{member.name}</Text>
                    {!!lockedBy[uid]
                      ? <View style={styles.lockedBadge}><Feather name="check" size={12} color="#fff" /><Text style={styles.lockedBadgeText}>Locked</Text></View>
                      : <Text style={[styles.waitingText, { color: colors.mutedForeground }]}>Voting…</Text>}
                  </View>
                ))}
              </View>

              {/* Generate CTA when all locked */}
              {allLocked && (
                <Pressable
                  onPress={() => router.push(`/building/${id}`)}
                  style={[styles.generateItineraryBtn, { backgroundColor: colors.primary }]}
                >
                  <Feather name="zap" size={18} color="#fff" />
                  <Text style={styles.generateItineraryText}>Generate itinerary</Text>
                </Pressable>
              )}
            </ScrollView>
          )}
        </>
      )}

      {/* Invite modal */}
      <Modal visible={showInvite} transparent animationType="slide" onRequestClose={() => setShowInvite(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowInvite(false)}>
          <Pressable style={[styles.inviteSheet, { backgroundColor: colors.card }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={{ alignItems: "center", marginBottom: 4 }}><Mascot name="luggage-crew" size={80} /></View>
            <View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: colors.foreground }]}>Invite the pack</Text><Pressable onPress={() => setShowInvite(false)}><Feather name="x" size={20} color={colors.mutedForeground} /></Pressable></View>
            <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>TRIP LINK</Text>
            <View style={[styles.sheetLinkRow, { backgroundColor: colors.muted, borderColor: colors.border }]}><Text style={[styles.sheetLinkText, { color: colors.foreground }]} numberOfLines={1}>{inviteLink}</Text><Pressable onPress={handleCopy} style={[styles.copyBtn, { backgroundColor: colors.primary }]}><Feather name={copied ? "check" : "copy"} size={16} color="#fff" /></Pressable></View>
             <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>INVITE CODE</Text>
             <View style={[styles.sheetLinkRow, { backgroundColor: colors.muted, borderColor: colors.border }]}><Text style={[styles.inviteCode, { color: colors.primary }]}>{trip?.inviteCode ?? id}</Text><Pressable onPress={handleCopyId} style={[styles.copyBtn, { backgroundColor: colors.primary }]}><Feather name={copiedId ? "check" : "copy"} size={16} color="#fff" /></Pressable></View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 8,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 17 },
  inviteBtn: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  inviteBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  membersRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
  },
  memberMore: { fontFamily: "DmSans_500Medium", fontSize: 12, marginLeft: 10 },
  tabRow: { flexDirection: "row", paddingHorizontal: 16 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2 },
  tabBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },

  /* Wish tab */
  inviteCard: {
    flexDirection: "row", alignItems: "center",
    margin: 16, padding: 14, borderRadius: 12, borderWidth: 1, gap: 12,
  },
  inviteCardTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 14, marginBottom: 2 },
  inviteCardSub: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  inviteCardBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  wishRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14, gap: 12, borderBottomWidth: 1,
  },
  wishText: { fontFamily: "DmSans_400Regular", fontSize: 15, lineHeight: 21 },
  wishAuthor: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 2 },
  arrowStack: { alignItems: "center", gap: 1 },
  arrowBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  scoreText: { fontFamily: "DmSans_700Bold", fontSize: 13, minWidth: 24, textAlign: "center" },
  addWishBar: {
    flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1,
  },
  addWishInput: {
    flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: "DmSans_400Regular", fontSize: 15,
  },
  addWishBtn: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  emptyWish: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
  emptyText: { fontFamily: "DmSans_400Regular", fontSize: 15 },

  /* Vote tab */
  lockBar: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  lockBarTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 13, marginBottom: 6 },
  lockProgress: { height: 4, borderRadius: 2, overflow: "hidden" },
  lockProgressFill: { height: 4, borderRadius: 2 },
  lockBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
  },
  lockBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13, color: "#fff" },
  voteCard: {
    borderRadius: 14, borderWidth: 1,
    padding: 14, marginBottom: 10, gap: 8,
  },
  voteCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  voteRank: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 18, minWidth: 22, textAlign: "center", marginTop: 1 },
  voteCardText: { flex: 1, fontFamily: "DmSans_400Regular", fontSize: 15, lineHeight: 21 },
  scorePill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, minWidth: 36, alignItems: "center" },
  scorePillText: { fontFamily: "DmSans_700Bold", fontSize: 13 },
  voterRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  voterNames: { fontFamily: "DmSans_400Regular", fontSize: 12, flex: 1 },
  packBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 6,
  },
  packBadgeText: { fontFamily: "DmSans_600SemiBold", fontSize: 12 },
  voteCardActions: { flexDirection: "row", gap: 8, marginTop: 2 },
  voteActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  voteActionCount: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },

  /* Go tab */
  goTab: { alignItems: "center", paddingHorizontal: 20, gap: 16, paddingTop: 20 },
  membersLockCard: {
    width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, gap: 0,
  },
  membersLockTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 14, marginBottom: 12 },
  memberLockRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, borderTopWidth: 1,
  },
  memberLockName: { flex: 1, fontFamily: "DmSans_500Medium", fontSize: 14 },
  lockedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#4CAF50", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
  },
  lockedBadgeText: { fontFamily: "DmSans_600SemiBold", fontSize: 12, color: "#fff" },
  waitingText: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  goCard: {
    width: "100%", backgroundColor: "#2B2723",
    borderRadius: 20, padding: 28, gap: 10,
  },
  goReadyLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11, letterSpacing: 2, color: "#F15A3A" },
  goCardTitle: {
    fontFamily: "PlayfairDisplay_700Bold", fontSize: 30,
    color: "#FFFFFF", lineHeight: 38,
  },
  goWaiting: { fontFamily: "DmSans_400Regular", fontSize: 13, color: "#756C66" },
  goCardBtn: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: "center", justifyContent: "center", marginTop: 8,
  },
  goManageLink: { fontFamily: "DmSans_400Regular", fontSize: 13, textDecorationLine: "underline" },
  packCard: {
    width: "100%", flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", borderRadius: 16, borderWidth: 1, padding: 20,
  },
  packCardLeft: { gap: 6 },
  packCardLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11, letterSpacing: 2 },
  packCardTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22, lineHeight: 28 },
  packCardBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },

  destBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 11,
  },
  destBannerText: { fontFamily: "DmSans_600SemiBold", fontSize: 13, color: "#fff", flex: 1 },
  reviewBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  reviewBannerText: { fontFamily: "DmSans_600SemiBold", fontSize: 13, color: "#fff", flex: 1 },
  accomBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginBottom: 10, borderRadius: 16,
    backgroundColor: "#26A69A", padding: 16,
    shadowColor: "#26A69A", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  accomBannerIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
  },
  accomBannerTitle: { fontFamily: "DmSans_700Bold", fontSize: 15, color: "#fff", marginBottom: 2 },
  accomBannerSub: { fontFamily: "DmSans_400Regular", fontSize: 12, color: "rgba(255,255,255,0.85)" },

  packGate: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 36,
    gap: 16,
  },
  gateTitle: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 24,
    textAlign: "center" as const,
    marginTop: 8,
  },
  gateSub: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    textAlign: "center" as const,
    lineHeight: 22,
  },
  gateBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  gateBadgeText: { fontFamily: "DmSans_400Regular", fontSize: 13 },
  gateBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    marginTop: 4,
  },
  gateBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 16, color: "#fff" },
  gateHint: {
    fontFamily: "DmSans_400Regular",
    fontSize: 12,
    textAlign: "center" as const,
    marginTop: 4,
  },

  accomCard: {
    width: "100%", borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 2,
  },
  accomCardLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11, letterSpacing: 1.5 },
  accomCardName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 18 },
  accomCardSub: { fontFamily: "DmSans_400Regular", fontSize: 13 },

  accomOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  accomOptionIcon: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center",
  },
  accomOptionTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 15, marginBottom: 2 },
  accomOptionSub: { fontFamily: "DmSans_400Regular", fontSize: 12, lineHeight: 17 },
  accomBookBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  accomBookBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13, color: "#fff" },

  /* Modals */
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  inviteSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, gap: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22 },
  sheetLabel: { fontFamily: "DmSans_500Medium", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 },
  sheetLinkRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 12, borderWidth: 1, paddingLeft: 14, overflow: "hidden",
  },
  sheetLinkText: { flex: 1, fontFamily: "DmSans_400Regular", fontSize: 13 },
  copyBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  inviteCode: { fontFamily: "DmSans_700Bold", fontSize: 22, letterSpacing: 3, textAlign: "center", paddingVertical: 8 },

  /* ── Swipe card stack ── */
  swipeStackWrap: {
    flex: 1,
    alignItems: "center" as const,
    paddingTop: 8,
  },
  swipeCounter: {
    fontFamily: "DmSans_400Regular",
    fontSize: 13,
    marginBottom: 10,
  },
  swipeStack: {
    flex: 1,
    width: "100%",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  swipeCard: {
    position: "absolute" as const,
    width: CARD_WIDTH,
    borderRadius: 18,
    borderWidth: 1.5,
    overflow: "hidden" as const,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  swipeCardHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  swipeCardBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    gap: 8,
  },
  swipeBgCard2: {
    top: 14,
    transform: [{ scale: 0.96 }],
    opacity: 0.85,
  },
  swipeBgCard3: {
    top: 28,
    transform: [{ scale: 0.92 }],
    opacity: 0.6,
  },
  swipeLabel: {
    position: "absolute" as const,
    top: 14,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 2.5,
  },
  swipeLabelRight: {
    right: 16,
    borderColor: "#4CAF50",
    backgroundColor: "#4CAF5010",
    transform: [{ rotate: "8deg" }],
  },
  swipeLabelLeft: {
    left: 16,
    borderColor: "#ef4444",
    backgroundColor: "#ef444410",
    transform: [{ rotate: "-8deg" }],
  },
  swipeLabelText: {
    fontFamily: "DmSans_700Bold",
    fontSize: 13,
    letterSpacing: 1,
  },
  swipeCardAuthorRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  swipeCardAuthor: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 13,
  },
  prevVotePill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  prevVoteText: {
    fontFamily: "DmSans_500Medium",
    fontSize: 12,
  },
  swipeCardWishText: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 20,
    lineHeight: 28,
  },
  swipeCardBottom: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  swipeScorePill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  swipeScoreText: {
    fontFamily: "DmSans_700Bold",
    fontSize: 13,
  },
  swipeHint: {
    fontFamily: "DmSans_400Regular",
    fontSize: 12,
    opacity: 0.5,
  },
  swipeTapRow: {
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: 20,
    paddingVertical: 14,
  },
  swipeTapBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  allDoneWrap: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 24,
  },
  allDoneCard: {
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 32,
    alignItems: "center" as const,
    gap: 12,
    width: "100%",
  },
  allDoneTitle: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 26,
  },
  heroHeader: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    backgroundColor: '#F15A3A', // primary coral
    minHeight: 140,
    justifyContent: 'space-between',
  },
  heroBack: {
    marginBottom: 16,
  },
  heroContent: {
    gap: 4,
  },
  heroTitle: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 28,
    color: '#fff',
  },
  heroDates: {
    fontFamily: "DmSans_500Medium",
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
  },
  overviewBody: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  membersRowOverview: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  membersStackOverview: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  membersCountOverview: {
    fontFamily: "DmSans_500Medium",
    fontSize: 15,
  },
  inviteBtnOverview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F15A3A15',
    borderRadius: 100,
  },
  inviteBtnOverviewText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 14,
    color: '#F15A3A',
  },
  progressContainer: {
    marginBottom: 24,
  },
  progressTitle: {
    fontFamily: "DmSans_700Bold",
    fontSize: 18,
    marginBottom: 4,
  },
  progressSubtitle: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    marginBottom: 12,
  },
  progressBarOverview: {
    height: 6,
    borderRadius: 3,
    width: '100%',
    overflow: 'hidden',
  },
  progressFillOverview: {
    height: '100%',
    borderRadius: 3,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  checklistIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  checklistTitle: {
    flex: 1,
    fontFamily: "DmSans_600SemiBold",
    fontSize: 16,
  },
  helpDecideBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 0,
    marginTop: -1,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  helpDecideText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 14,
    color: "#E85D3A",
  },
  generateItineraryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 24,
  },
  generateItineraryText: {
    fontFamily: "DmSans_700Bold",
    fontSize: 16,
    color: "#fff",
  },
  allDoneSub: {
    fontFamily: "DmSans_400Regular",
    fontSize: 15,
    textAlign: "center" as const,
    lineHeight: 22,
  },
  reviewBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  reviewBtnText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
  },
});
