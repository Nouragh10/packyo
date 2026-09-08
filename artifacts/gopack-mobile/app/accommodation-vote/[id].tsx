import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
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
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { WikiImage } from "@/components/WikiImage";
import { apiFetch } from "@/lib/api-client";
import { sendTripPush } from "@/lib/push-notifications";
import {
  AccommodationSuggestion,
  addMemberAccommodationLink,
  confirmAccommodation,
  lockAccommodationVotes,
  setAccommodationStatus,
  unlockAccommodationVotes,
  useTrip,
  voteAccommodation,
} from "@/hooks/useFirebase";

const TEAL = "#26A69A";
const MEMBER_COLORS = ["#F15A3A", "#F4BC55", "#A77BD6", "#68B7A0", "#EE9D54", "#6EA6D8"];
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;

/* ── Helpers ───────────────────────────────────────────────────── */

function StarRating({ rating }: { rating: number }) {
  if (!rating || rating <= 0) return null;
  if (rating > 5) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <Feather name="star" size={11} color="#FFA726" />
        <Text style={{ fontFamily: "DmSans_600SemiBold", fontSize: 12, color: "#FFA726" }}>
          {rating.toFixed(1)}<Text style={{ fontFamily: "DmSans_400Regular", color: "#BDB0A0" }}>/10</Text>
        </Text>
      </View>
    );
  }
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Feather key={i} name="star" size={11} color={i < full || (half && i === full) ? "#FFA726" : "#D0C9C0"} />
      ))}
      <Text style={{ fontFamily: "DmSans_600SemiBold", fontSize: 12, color: "#FFA726", marginLeft: 3 }}>
        {rating.toFixed(1)}
      </Text>
    </View>
  );
}

function TypeBadge({ type, colors }: { type: string; colors: any }) {
  const icons: Record<string, string> = { hotel: "home", airbnb: "key", hostel: "users", other: "map-pin" };
  const labels: Record<string, string> = { hotel: "Hotel", airbnb: "Airbnb", hostel: "Hostel", other: "Other" };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: TEAL + "20", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
      <Feather name={icons[type] as any ?? "map-pin"} size={11} color={TEAL} />
      <Text style={{ fontFamily: "DmSans_600SemiBold", fontSize: 11, color: TEAL }}>{labels[type] ?? type}</Text>
    </View>
  );
}

/* ── Swipe card ────────────────────────────────────────────────── */

function TopAccommodationCard({
  suggestion, uid, myVote, onSwipeLeft, onSwipeRight, colors,
}: {
  suggestion: AccommodationSuggestion;
  uid: string;
  myVote: "up" | "down" | null;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  colors: any;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => { tx.value = e.translationX; ty.value = e.translationY * 0.2; })
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
      { rotate: `${interpolate(tx.value, [-SCREEN_WIDTH, 0, SCREEN_WIDTH], [-12, 0, 12])}deg` },
    ],
  }));
  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [20, SWIPE_THRESHOLD * 0.8], [0, 1], Extrapolation.CLAMP),
  }));
  const nopeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_THRESHOLD * 0.8, -20], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.swipeCard, { backgroundColor: colors.card, borderColor: colors.border }, cardStyle]}>
        <Animated.View style={[styles.swipeLabel, styles.swipeLabelRight, likeStyle]}>
          <Feather name="heart" size={20} color="#4CAF50" />
          <Text style={[styles.swipeLabelText, { color: "#4CAF50" }]}>LOVE IT</Text>
        </Animated.View>
        <Animated.View style={[styles.swipeLabel, styles.swipeLabelLeft, nopeStyle]}>
          <Feather name="x" size={20} color="#ef4444" />
          <Text style={[styles.swipeLabelText, { color: "#ef4444" }]}>SKIP</Text>
        </Animated.View>

        {(suggestion.photos ?? [])[0] ? (
          <View style={styles.swipeImageWrap}>
            <WikiImage
              name={suggestion.name}
              context={suggestion.location}
              query={`${suggestion.name} ${suggestion.location}`}
              initialUri={(suggestion.photos ?? [])[0]}
              fallbackCategory="stay"
              style={{ width: "100%", height: "100%" }}
            />
          </View>
        ) : (
          <View style={styles.swipeImageWrap}>
            <WikiImage
              name={suggestion.name}
              context={suggestion.location}
              query={`${suggestion.name} hotel ${suggestion.location}`}
              fallbackCategory="stay"
              fallbackIndex={suggestion.name.length}
              style={{ width: "100%", height: "100%" }}
            />
          </View>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <TypeBadge type={suggestion.type} colors={colors} />
          <StarRating rating={suggestion.rating} />
          {myVote ? (
            <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: myVote === "up" ? "#4CAF5018" : "#9E9E9E18", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
              <Feather name={myVote === "up" ? "heart" : "x"} size={11} color={myVote === "up" ? "#4CAF50" : "#9E9E9E"} />
              <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 11, color: myVote === "up" ? "#4CAF50" : "#9E9E9E" }}>
                {myVote === "up" ? "You loved this" : "You skipped"}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={[styles.swipeCardName, { color: colors.foreground }]} numberOfLines={2}>{suggestion.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Feather name="map-pin" size={12} color={colors.mutedForeground} />
          <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 13, color: colors.mutedForeground }} numberOfLines={1}>
            {suggestion.location}
          </Text>
        </View>

        <View style={[styles.whyBox, { backgroundColor: colors.muted }]}>
          <Feather name="zap" size={12} color={TEAL} />
          <Text style={[styles.whyText, { color: colors.foreground }]} numberOfLines={3}>{suggestion.whyItFits}</Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 20 }}>
          <View>
            <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 11, color: colors.mutedForeground }}>Per person</Text>
            <Text style={{ fontFamily: "DmSans_700Bold", fontSize: 18, color: TEAL }}>${(suggestion.costPerPerson ?? 0).toLocaleString()}</Text>
          </View>
          <View style={{ width: 1, height: 32, backgroundColor: colors.border }} />
          <View>
            <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 11, color: colors.mutedForeground }}>Total</Text>
            <Text style={{ fontFamily: "DmSans_700Bold", fontSize: 18, color: colors.foreground }}>${(suggestion.totalCost ?? 0).toLocaleString()}</Text>
          </View>
        </View>

        {(suggestion.amenities ?? []).length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            {(suggestion.amenities ?? []).slice(0, 3).map((a) => (
              <View key={a} style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.muted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <Feather name="check" size={10} color={TEAL} />
                <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 11, color: colors.mutedForeground }}>{a}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {suggestion.link ? (
          <Pressable
            onPress={() => {
              const raw = suggestion.link!;
              const lurl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
              if (Platform.OS === "web") window.open(lurl, "_blank", "noopener,noreferrer");
              else Linking.openURL(lurl).catch(() => {});
            }}
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Feather name="external-link" size={12} color={TEAL} />
            <Text style={{ fontFamily: "DmSans_500Medium", fontSize: 12, color: TEAL, textDecorationLine: "underline" }}>
              View listing
            </Text>
          </Pressable>
        ) : null}

        <Text style={[styles.swipeHint, { color: colors.mutedForeground }]}>← skip · love it →</Text>
      </Animated.View>
    </GestureDetector>
  );
}

/* ── Swipe stack ───────────────────────────────────────────────── */

function AccommodationSwipeStack({
  suggestions, uid, allVotes, tripId, colors, onComplete,
}: {
  suggestions: AccommodationSuggestion[];
  uid: string;
  allVotes: Record<number, Record<string, "up" | "down">>;
  tripId: string;
  colors: any;
  onComplete: () => void;
}) {
  const [swipeOrder, setSwipeOrder] = useState<number[]>(() => suggestions.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  posRef.current = pos;
  onCompleteRef.current = onComplete;

  // When new suggestions are added (e.g. member pastes a link), append their
  // indices so they appear in the swipe deck without resetting current position.
  useEffect(() => {
    setSwipeOrder(prev => {
      const prevSet = new Set(prev);
      const added = suggestions.map((_, i) => i).filter(i => !prevSet.has(i));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [suggestions.length]);

  const doVote = useCallback((dir: "up" | "down") => {
    const i = posRef.current;
    const actualIdx = swipeOrder[i];
    if (actualIdx === undefined) return;
    voteAccommodation(tripId, actualIdx, uid, dir);
    posRef.current = i + 1;
    setPos(i + 1);
    if (i + 1 >= swipeOrder.length) onCompleteRef.current();
  }, [tripId, uid, swipeOrder]);

  const onSwipeRight = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    doVote("up");
  }, [doVote]);
  const onSwipeLeft = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    doVote("down");
  }, [doVote]);

  if (suggestions.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Feather name="home" size={44} color={colors.border} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No picks yet</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Add a listing link so the pack can vote.
        </Text>
      </View>
    );
  }

  if (pos >= swipeOrder.length) {
    return (
      <View style={styles.allDoneWrap}>
        <View style={[styles.allDoneCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="check-circle" size={44} color={TEAL} />
          <Text style={[styles.allDoneTitle, { color: colors.foreground }]}>All voted!</Text>
          <Text style={[styles.allDoneSub, { color: colors.mutedForeground }]}>
            You've rated all {swipeOrder.length} options. Locking in your vote…
          </Text>
        </View>
      </View>
    );
  }

  const topIdx = swipeOrder[pos];
  const nextIdx = swipeOrder[pos + 1];
  const thirdIdx = swipeOrder[pos + 2];
  const topSuggestion = suggestions[topIdx];
  if (!topSuggestion) return null;
  const myVote = ((allVotes[topIdx] ?? {}) as Record<string, "up" | "down">)[uid] ?? null;

  return (
    <View style={styles.swipeStackWrap}>
      <Text style={[styles.swipeCounter, { color: colors.mutedForeground }]}>{pos + 1} / {swipeOrder.length}</Text>
      <View style={styles.swipeStack}>
        {thirdIdx !== undefined && suggestions[thirdIdx] ? (
            <View style={[styles.swipeCard, styles.swipeBgCard3, { backgroundColor: colors.card, borderColor: colors.border }]} />
        ) : null}
        {nextIdx !== undefined && suggestions[nextIdx] ? (
            <View style={[styles.swipeCard, styles.swipeBgCard2, { backgroundColor: colors.card, borderColor: colors.border }]} />
        ) : null}
        <TopAccommodationCard
          key={`ac-${pos}`}
          suggestion={topSuggestion}
          uid={uid}
          myVote={myVote}
          onSwipeLeft={onSwipeLeft}
          onSwipeRight={onSwipeRight}
          colors={colors}
        />
      </View>
      <View style={styles.swipeTapRow}>
        <Pressable onPress={onSwipeLeft} style={[styles.swipeActionPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="x" size={20} color="#ef4444" />
          <Text style={[styles.swipeActionPillText, { color: colors.foreground }]}>Skip</Text>
        </Pressable>
        <Pressable onPress={onSwipeRight} style={[styles.swipeActionPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="heart" size={18} color="#F15A3A" />
          <Text style={[styles.swipeActionPillText, { color: colors.foreground }]}>Love it</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── Ranked card (post-lock view) ──────────────────────────────── */

interface CardProps {
  suggestion: AccommodationSuggestion;
  idx: number;
  tripId: string;
  uid: string;
  votes: Record<string, "up" | "down">;
  members: Record<string, { name: string }>;
  isWinning: boolean;
  hasQuorum: boolean;
  isCreator: boolean;
  colors: any;
  onConfirm: () => void;
}

function AccommodationCard({
  suggestion, idx, tripId, uid, votes, members, isWinning, hasQuorum, isCreator, colors, onConfirm,
}: CardProps) {
  const upVoters = Object.entries(votes).filter(([, v]) => v === "up");
  const downVoters = Object.entries(votes).filter(([, v]) => v === "down");
  const score = upVoters.length - downVoters.length;
  const upNames = upVoters.map(([id]) => members[id]?.name ?? "Unknown");
  const downNames = downVoters.map(([id]) => members[id]?.name ?? "Unknown");
  const winner = isWinning && hasQuorum;

  return (
    <View style={[
      styles.card,
      { backgroundColor: winner ? "#2B2723" : colors.card, borderColor: winner ? TEAL : colors.border, borderWidth: winner ? 2 : 1 },
    ]}>
      {winner && (
        <View style={[styles.winBadge, { backgroundColor: TEAL }]}>
          <Text style={styles.winBadgeText}>⭐ WINNER</Text>
        </View>
      )}
      {suggestion.submittedBy !== "AI" && (
        <View style={styles.memberBadge}>
          <Feather name="user" size={10} color="#FFA726" />
          <Text style={styles.memberBadgeText}>Added by {suggestion.submittedBy}</Text>
        </View>
      )}
      <View style={{ width: "100%", height: 150, borderRadius: 12, overflow: "hidden" }}>
        <WikiImage
          name={suggestion.name}
          context={suggestion.location}
          query={`${suggestion.name} hotel ${suggestion.location}`}
          initialUri={(suggestion.photos ?? [])[0]}
          fallbackCategory="stay"
          fallbackIndex={idx}
          style={{ width: "100%", height: "100%" }}
        />
      </View>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TypeBadge type={suggestion.type} colors={colors} />
            <StarRating rating={suggestion.rating} />
          </View>
          <Text style={[styles.cardName, { color: winner ? "#FFFFFF" : colors.foreground }]}>{suggestion.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Feather name="map-pin" size={11} color={winner ? "#BDB0A0" : colors.mutedForeground} />
            <Text style={[styles.cardLocation, { color: winner ? "#BDB0A0" : colors.mutedForeground }]}>{suggestion.location}</Text>
          </View>
        </View>
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ fontFamily: "DmSans_700Bold", fontSize: 18, color: score > 0 ? TEAL : colors.mutedForeground }}>
            {score > 0 ? `+${score}` : score}
          </Text>
          <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 10, color: colors.mutedForeground }}>score</Text>
        </View>
      </View>
      <View style={[styles.whyBox, { backgroundColor: winner ? "#3A3330" : colors.muted }]}>
        <Feather name="zap" size={12} color={TEAL} />
        <Text style={[styles.whyText, { color: winner ? "#FFFFFF" : colors.foreground }]}>{suggestion.whyItFits}</Text>
      </View>
      <View style={styles.costRow}>
        <View style={styles.costItem}>
          <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Total</Text>
        <Text style={[styles.costValue, { color: winner ? "#FFFFFF" : colors.foreground }]}>${(suggestion.totalCost ?? 0).toLocaleString()}</Text>
        </View>
        <View style={[styles.costDivider, { backgroundColor: colors.border }]} />
        <View style={styles.costItem}>
          <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Per person</Text>
          <Text style={[styles.costValue, { color: TEAL }]}>${(suggestion.costPerPerson ?? 0).toLocaleString()}</Text>
        </View>
        <View style={[styles.costDivider, { backgroundColor: colors.border }]} />
        <View style={styles.costItem}>
          <Text style={[styles.costLabel, { color: colors.mutedForeground }]}>Rooms</Text>
        <Text style={[styles.costValue, { color: winner ? "#FFFFFF" : colors.foreground }]}>{suggestion.rooms} × {suggestion.beds} beds</Text>
        </View>
      </View>
      {(suggestion.tags ?? []).length > 0 && (
        <View style={styles.tagsRow}>
          {suggestion.tags.map((tag) => (
            <View key={tag} style={[styles.tag, { backgroundColor: colors.muted }]}>
              <Text style={[styles.tagText, { color: colors.foreground }]}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Feather name="navigation" size={11} color={colors.mutedForeground} />
        <Text style={[styles.distanceText, { color: colors.mutedForeground }]}>{suggestion.distanceNote}</Text>
      </View>
      {(suggestion.amenities ?? []).length > 0 && (
        <View style={styles.amenitiesRow}>
          {suggestion.amenities.slice(0, 5).map((a) => (
            <View key={a} style={styles.amenityItem}>
              <Feather name="check" size={10} color={TEAL} />
              <Text style={[styles.amenityText, { color: colors.mutedForeground }]}>{a}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Feather name="shield" size={11} color={colors.mutedForeground} />
        <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>{suggestion.cancellation}</Text>
      </View>
      {suggestion.link && (
        <Pressable
          style={[styles.linkBtn, { borderColor: TEAL }]}
          onPress={() => {
            const raw = suggestion.link!;
            const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
            if (Platform.OS === "web") window.open(url, "_blank", "noopener,noreferrer");
            else Linking.openURL(url).catch(() => Alert.alert("Couldn't open link", "Make sure the URL is valid."));
          }}
        >
          <Feather name="external-link" size={13} color={TEAL} />
          <Text style={[styles.linkBtnText, { color: TEAL }]}>View listing</Text>
        </Pressable>
      )}
      {upNames.length > 0 && (
        <View style={styles.voterRow}>
          <Feather name="heart" size={11} color="#4CAF50" />
          <Text style={[styles.voterNames, { color: "#4CAF50" }]} numberOfLines={1}>{upNames.join(", ")}</Text>
        </View>
      )}
      {downNames.length > 0 && (
        <View style={styles.voterRow}>
          <Feather name="x" size={11} color={colors.mutedForeground} />
          <Text style={[styles.voterNames, { color: colors.mutedForeground }]} numberOfLines={1}>{downNames.join(", ")}</Text>
        </View>
      )}
      {isCreator && winner && (
        <Pressable onPress={onConfirm} style={[styles.confirmBtn, { backgroundColor: TEAL }]}>
          <Feather name="check" size={16} color="#fff" />
          <Text style={styles.confirmBtnText}>Book this one</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ── Main screen ───────────────────────────────────────────────── */

export default function AccommodationVoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { trip, loading } = useTrip(id);
  const [locking, setLocking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [breaking, setBreaking] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkCost, setLinkCost] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [parseStatus, setParseStatus] = useState<"idle" | "fetching" | "saving">("idle");

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const suggestions = trip?.accommodationSuggestions ?? [];
  const allVotes = trip?.accommodationVotes ?? {};
  const lockedBy = trip?.accommodationLockedBy ?? {};
  const members = trip?.members ?? {};
  const memberCount = Object.keys(members).length;
  const lockedCount = Object.keys(lockedBy).length;
  const allLocked = memberCount > 0 && lockedCount >= memberCount;
  const myLocked = !!lockedBy[user?.uid ?? ""];
  const isCreator = trip?.hostMemberId === user?.uid;

  // Participation threshold: majority of members must vote before host can confirm
  const participationThreshold = Math.max(1, Math.ceil(memberCount / 2));
  const hasQuorum = lockedCount >= participationThreshold;

  const getVotesForIdx = (idx: number): Record<string, "up" | "down"> =>
    (allVotes[idx] ?? {}) as Record<string, "up" | "down">;

  const getScore = (idx: number) => {
    const v = getVotesForIdx(idx);
    const up = Object.values(v).filter((d) => d === "up").length;
    const down = Object.values(v).filter((d) => d === "down").length;
    return up - down;
  };

  const winnerIdx = suggestions.reduce((best, _, idx) =>
    getScore(idx) > getScore(best) ? idx : best, 0);

  const handleAutoLock = async () => {
    if (!user || !id) return;
    setLocking(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await lockAccommodationVotes(id, user.uid);
    } finally {
      setLocking(false);
    }
  };

  const handleUnlock = async () => {
    if (!user || !id) return;
    setLocking(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await unlockAccommodationVotes(id, user.uid);
    } finally {
      setLocking(false);
    }
  };

  const handleConfirm = async () => {
    if (!id || !suggestions[winnerIdx]) return;
    setConfirming(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await confirmAccommodation(id, suggestions[winnerIdx]);
      await sendTripPush(
        id,
        `${suggestions[winnerIdx].name} is your confirmed stay`,
        "Open Packyo to see the winning accommodation.",
        `/trip/${id}`,
      );
      router.replace(`/trip/${id}`);
    } finally {
      setConfirming(false);
    }
  };

  const handleSkipAccommodation = async () => {
    if (!id || !isCreator) return;
    Alert.alert(
      "Skip stay planning?",
      "Use this if your group has already booked a place. You can still build the itinerary without an accommodation selection.",
      [
        { text: "Keep voting", style: "cancel" },
        {
          text: "Already booked",
          onPress: async () => {
            try {
              await setAccommodationStatus(id, "skipped");
              router.replace(`/building/${id}`);
            } catch {
              Alert.alert("Couldn't skip accommodation", "Please try again.");
            }
          },
        },
      ],
    );
  };

  const handleAiTiebreak = async () => {
    if (!id || !trip) return;
    const currentTopScore = getScore(winnerIdx);
    const tiedOptions = suggestions
      .map((s, i) => ({ ...s, origIdx: i }))
      .filter((_, i) => getScore(i) === currentTopScore);
    setBreaking(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      const res = await apiFetch("/api/ai-pick-accommodation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestions: tiedOptions.map((s) => ({
            name: s.name, type: s.type, location: s.location,
            costPerPerson: s.costPerPerson, whyItFits: s.whyItFits,
          })),
          destination: trip.destination,
          memberCount,
        }),
      });
      if (!res.ok) throw new Error("AI could not decide");
      const result = await res.json() as { winnerIdx: number; reason: string };
      const picked = tiedOptions[result.winnerIdx];
      Alert.alert(
        "AI Tiebreaker",
        `AI picks: ${picked?.name ?? "Unknown"}\n\n"${result.reason}"`,
        [
          { text: "Keep voting", style: "cancel" },
          isCreator && picked
            ? {
                text: "Confirm this pick",
                onPress: async () => {
                  await confirmAccommodation(id, suggestions[picked.origIdx]);
                  await sendTripPush(
                    id,
                    `${suggestions[picked.origIdx].name} is your confirmed stay`,
                    "Open Packyo to see the winning accommodation.",
                    `/trip/${id}`,
                  );
                  router.replace(`/trip/${id}`);
                },
              }
            : { text: "OK" },
        ].filter(Boolean) as any,
      );
    } catch {
      Alert.alert("Error", "Could not break the tie. Please try again.");
    } finally {
      setBreaking(false);
    }
  };

  const handleAddLink = async () => {
    const rawUrl = linkUrl.trim();
    if (!rawUrl || !id) return;
    setAddingLink(true);
    const mCount = Object.keys(members).length || 1;
    const total = parseFloat(linkCost) || 0;
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    try {
      setParseStatus("fetching");
      const parseRes = await apiFetch("/api/parse-accommodation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, destination: trip?.destination ?? "" }),
      });
      let parsed: Partial<AccommodationSuggestion> = {};
      if (parseRes.ok) parsed = await parseRes.json();

      setParseStatus("saving");
      const newSuggestion: AccommodationSuggestion = {
        id: `member-${Date.now()}`,
        name: (parsed.name as string) || "Member pick",
        type: (parsed.type as AccommodationSuggestion["type"]) || "other",
        location: (parsed.location as string) || trip?.destination || "",
        totalCost: total,
        costPerPerson: total ? Math.round(total / mCount) : 0,
        nights: trip?.days ?? 1,
        rating: typeof parsed.rating === "number" ? parsed.rating : 0,
        amenities: Array.isArray(parsed.amenities) ? parsed.amenities : [],
        rooms: 1,
        beds: mCount,
        cancellation: (parsed.cancellation as string) || "Check listing",
        whyItFits: (parsed.whyItFits as string) || "Added by a pack member",
        tags: Array.isArray(parsed.tags) ? parsed.tags : ["Member pick"],
        distanceNote: (parsed.distanceNote as string) || "See listing for details",
        link: url,
        photos: Array.isArray(parsed.photos) ? parsed.photos : [],
        submittedBy: user?.displayName ?? "Member",
      };
      await addMemberAccommodationLink(id, newSuggestion);
      setShowAddLink(false);
      setLinkUrl("");
      setLinkCost("");
      setParseStatus("idle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Couldn't add listing", "Failed to parse or save the link. Please try again.");
      setParseStatus("idle");
    } finally {
      setAddingLink(false);
    }
  };

  if (loading || !trip) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={TEAL} size="large" />
      </View>
    );
  }

  const topScore = getScore(winnerIdx);
  const isTied = hasQuorum && suggestions.length > 1 &&
    suggestions.filter((_, i) => getScore(i) === topScore).length > 1;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerLabel, { color: colors.primary }]}>STEP 4 OF 4</Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Which stay works best?</Text>
        </View>
        <Pressable onPress={() => setShowAddLink(true)} style={[styles.addBtn, { borderColor: TEAL }]}>
          <Feather name="plus" size={14} color={TEAL} />
          <Text style={[styles.addBtnText, { color: TEAL }]}>Add link</Text>
        </Pressable>
        {isCreator ? (
          <Pressable
            onPress={handleSkipAccommodation}
            style={[styles.skipStayHeaderButton, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Skip accommodation because it is already booked"
          >
            <Feather name="check" size={14} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {/* Lock-in bar */}
      <View style={[styles.lockBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[styles.lockBarTitle, { color: colors.foreground }]}>
              {allLocked
                ? "All voted ✓"
                : hasQuorum
                ? "Majority voted ✓"
                : myLocked
                ? "Your vote is locked"
                : `${lockedCount} of ${memberCount} voted`}
            </Text>
            {!hasQuorum && (
              <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 11, color: colors.mutedForeground }}>
                {participationThreshold - lockedCount} more to confirm
              </Text>
            )}
          </View>
          <View style={[styles.lockProgress, { backgroundColor: colors.muted }]}>
            {/* Threshold marker */}
            {memberCount > 0 && (
              <View style={{
                position: "absolute", left: `${(participationThreshold / memberCount) * 100}%`,
                top: -2, bottom: -2, width: 1.5, backgroundColor: TEAL + "80", zIndex: 1,
              }} />
            )}
            <View style={[styles.lockProgressFill, {
              backgroundColor: allLocked ? "#4CAF50" : hasQuorum ? "#4CAF50" : TEAL,
              width: memberCount > 0 ? `${(lockedCount / memberCount) * 100}%` : "0%",
            }]} />
          </View>
        </View>
        {myLocked && (
          <Pressable
            onPress={handleUnlock}
            disabled={locking}
            style={[styles.lockBtn, { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }]}
          >
            {locking
              ? <ActivityIndicator color={colors.mutedForeground} size="small" />
              : (
                <>
                  <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.lockBtnText, { color: colors.mutedForeground }]}>Re-vote</Text>
                </>
              )}
          </Pressable>
        )}
      </View>

      {/* Main content — swipe deck when not locked, ranked list when locked */}
      {!myLocked ? (
        <AccommodationSwipeStack
          suggestions={suggestions}
          uid={user?.uid ?? ""}
          allVotes={allVotes as Record<number, Record<string, "up" | "down">>}
          tripId={id!}
          colors={colors}
          onComplete={handleAutoLock}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomInset + 20 }}
        >
          {isTied && (
            <Pressable
              onPress={handleAiTiebreak}
              disabled={breaking}
              style={[styles.aiTieBtn, { backgroundColor: "#7E57C218", borderColor: "#7E57C2" }]}
            >
              {breaking ? (
                <ActivityIndicator color="#7E57C2" size="small" />
              ) : (
                <>
                  <Feather name="zap" size={16} color="#7E57C2" />
                  <Text style={[styles.aiTieBtnText, { color: "#7E57C2" }]}>Too close to call — let AI break the tie</Text>
                </>
              )}
            </Pressable>
          )}

          {hasQuorum && !isCreator && !isTied && (
            <View style={[styles.waitingBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="clock" size={16} color={colors.mutedForeground} />
              <Text style={[styles.waitingText, { color: colors.mutedForeground }]}>
                Waiting for the trip creator to confirm the accommodation…
              </Text>
            </View>
          )}

          {confirming && (
            <View style={[styles.confirmingBanner, { backgroundColor: TEAL + "18" }]}>
              <ActivityIndicator color={TEAL} size="small" />
              <Text style={[styles.waitingText, { color: TEAL }]}>Confirming accommodation…</Text>
            </View>
          )}

          {[...suggestions]
            .map((s, i) => ({ s, i, score: getScore(i) }))
            .sort((a, b) => b.score - a.score)
            .map(({ s, i }) => (
              <AccommodationCard
                key={s.id}
                suggestion={s}
                idx={i}
                tripId={id!}
                uid={user?.uid ?? ""}
                votes={getVotesForIdx(i)}
                members={members}
                isWinning={i === winnerIdx}
                hasQuorum={hasQuorum}
                isCreator={isCreator}
                colors={colors}
                onConfirm={handleConfirm}
              />
            ))}
        </ScrollView>
      )}

      {/* Add member link modal */}
      <Modal visible={showAddLink} transparent animationType="slide" onRequestClose={() => setShowAddLink(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => { if (!addingLink) setShowAddLink(false); }}>
          <Pressable style={[styles.addSheet, { backgroundColor: colors.card }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Add your own pick</Text>
            <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
              Paste any listing URL — Airbnb, Booking.com, Hotels.com, etc. AI will extract the details automatically.
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Listing URL *</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="https://airbnb.com/rooms/..."
                placeholderTextColor={colors.mutedForeground}
                value={linkUrl}
                onChangeText={setLinkUrl}
                autoCapitalize="none"
                keyboardType="url"
                editable={!addingLink}
              />
            </View>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Total cost for group (optional, $)</Text>
            <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="e.g. 1200"
                placeholderTextColor={colors.mutedForeground}
                value={linkCost}
                onChangeText={setLinkCost}
                keyboardType="numeric"
                editable={!addingLink}
              />
            </View>

            {addingLink && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
                <ActivityIndicator color={TEAL} size="small" />
                <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 13, color: colors.mutedForeground }}>
                  {parseStatus === "fetching" ? "AI is reading the listing…" : "Saving to vote…"}
                </Text>
              </View>
            )}

            <Pressable
              onPress={handleAddLink}
              disabled={addingLink || !linkUrl.trim()}
              style={[styles.submitBtn, { backgroundColor: TEAL, opacity: addingLink || !linkUrl.trim() ? 0.6 : 1 }]}
            >
              {addingLink
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitBtnText}>Add to vote</Text>
              }
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },

  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12 },
  backBtn: { padding: 4 },
  headerLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11, letterSpacing: 2 },
  headerTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  skipStayHeaderButton: { width: 34, height: 34, marginLeft: 7, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },

  lockBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  lockBarTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 13, marginBottom: 6 },
  lockProgress: { height: 4, borderRadius: 2, overflow: "hidden" },
  lockProgressFill: { height: 4, borderRadius: 2 },
  lockBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  lockBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },

  swipeStackWrap: { flex: 1, alignItems: "center", paddingTop: 6, minHeight: 0 },
  swipeCounter: { fontFamily: "DmSans_400Regular", fontSize: 12, marginBottom: 8 },
  swipeStack: { flex: 1, width: "100%", minHeight: 0, justifyContent: "center" },
  swipeCard: { position: "absolute" as const, left: 16, right: 16, borderRadius: 18, borderWidth: 1, padding: 12, gap: 7 },
  swipeBgCard2: { top: 12, transform: [{ scale: 0.96 }], opacity: 0.85 },
  swipeBgCard3: { top: 24, transform: [{ scale: 0.92 }], opacity: 0.6 },
  swipeImageWrap: { width: "100%", height: 122, borderRadius: 12, marginBottom: 4, overflow: "hidden" },
  swipeLabel: {
    position: "absolute", top: 16, flexDirection: "row", alignItems: "center",
    gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    borderWidth: 2, zIndex: 10, backgroundColor: "rgba(255,255,255,0.92)",
  },
  swipeLabelRight: { right: 14, borderColor: "#4CAF50" },
  swipeLabelLeft: { left: 14, borderColor: "#ef4444" },
  swipeLabelText: { fontFamily: "DmSans_700Bold", fontSize: 13, letterSpacing: 1 },
  swipeTapRow: { flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 4 },
  swipeActionPill: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 100, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 12,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  swipeActionPillText: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  swipeCardName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 18, lineHeight: 22 },
  swipeHint: { fontFamily: "DmSans_400Regular", fontSize: 10, textAlign: "center" },

  allDoneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  allDoneCard: { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: "center", gap: 12, width: "100%" },
  allDoneTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 26 },
  allDoneSub: { fontFamily: "DmSans_400Regular", fontSize: 14, textAlign: "center", lineHeight: 20 },

  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22, letterSpacing: -0.3 },
  emptyText: { fontFamily: "DmSans_400Regular", fontSize: 14, textAlign: "center", lineHeight: 20 },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  winBadge: { alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  winBadgeText: { fontFamily: "DmSans_700Bold", fontSize: 11, color: "#fff", letterSpacing: 1 },
  memberBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: "#FFA72620", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  memberBadgeText: { fontFamily: "DmSans_600SemiBold", fontSize: 11, color: "#FFA726" },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20, lineHeight: 26 },
  cardLocation: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  whyBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, borderRadius: 10, padding: 10 },
  whyText: { fontFamily: "DmSans_400Regular", fontSize: 13, flex: 1, lineHeight: 18 },
  costRow: { flexDirection: "row", alignItems: "center" },
  costItem: { flex: 1, alignItems: "center", gap: 2 },
  costLabel: { fontFamily: "DmSans_400Regular", fontSize: 11 },
  costValue: { fontFamily: "DmSans_700Bold", fontSize: 15 },
  costDivider: { width: 1, height: 30, marginHorizontal: 4 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  tagText: { fontFamily: "DmSans_500Medium", fontSize: 11 },
  distanceText: { fontFamily: "DmSans_400Regular", fontSize: 12, flex: 1 },
  amenitiesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  amenityItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  amenityText: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  cancelText: { fontFamily: "DmSans_400Regular", fontSize: 12, flex: 1 },
  linkBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 8 },
  linkBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  voterRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  voterNames: { fontFamily: "DmSans_400Regular", fontSize: 12, flex: 1 },
  confirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 100, paddingVertical: 14, marginTop: 4 },
  confirmBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
  aiTieBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1, borderRadius: 16, padding: 14 },
  aiTieBtnText: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  waitingBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, padding: 14, borderWidth: 1 },
  confirmingBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, padding: 12 },
  waitingText: { fontFamily: "DmSans_400Regular", fontSize: 13, flex: 1 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  addSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 48, gap: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  sheetTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22 },
  sheetSub: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 18 },
  fieldLabel: { fontFamily: "DmSans_500Medium", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  input: { flex: 1, fontFamily: "DmSans_400Regular", fontSize: 14 },
  submitBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  submitBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
});
