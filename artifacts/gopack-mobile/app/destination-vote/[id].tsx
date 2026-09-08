import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
import { WikiImage } from "@/components/WikiImage";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-client";
import {
  DestinationSuggestion,
  chooseDestinationWithAi,
  confirmDestination,
  lockDestinationVotes,
  resetDestinationForRevote,
  storeRedoSuggestions,
  unlockDestinationVotes,
  useTrip,
  voteDestination,
} from "@/hooks/useFirebase";

const MEMBER_COLORS = ["#F15A3A", "#F4BC55", "#A77BD6", "#68B7A0", "#EE9D54", "#6EA6D8"];
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 420);
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;

/* ── Helpers ───────────────────────────────────────────────────── */

function destinationFallbackIndex(name: string): number {
  return Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
}

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

/* ── Swipe card ────────────────────────────────────────────────── */

function TopDestinationCard({
  suggestion, myVote, onSwipeLeft, onSwipeRight, colors,
}: {
  suggestion: DestinationSuggestion;
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
      <Animated.View style={[styles.swipeCard, { backgroundColor: colors.card, borderColor: colors.border, width: CARD_WIDTH }, cardStyle]}>
        <Animated.View style={[styles.swipeLabel, styles.swipeLabelRight, likeStyle]}>
          <Feather name="heart" size={20} color="#4CAF50" />
          <Text style={[styles.swipeLabelText, { color: "#4CAF50" }]}>LOVE IT</Text>
        </Animated.View>
        <Animated.View style={[styles.swipeLabel, styles.swipeLabelLeft, nopeStyle]}>
          <Feather name="x" size={20} color="#ef4444" />
          <Text style={[styles.swipeLabelText, { color: "#ef4444" }]}>SKIP</Text>
        </Animated.View>

        <View style={styles.swipeImageWrap}>
          <WikiImage
            name={suggestion.name}
            context="travel destination"
            query={`${suggestion.name} city travel`}
            fallbackCategory={suggestion.tags[0] ?? "default"}
            fallbackIndex={destinationFallbackIndex(suggestion.name)}
            style={styles.swipeImage}
            placeholderColor={colors.muted}
          />
        </View>

        {myVote ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: myVote === "up" ? "#4CAF5018" : "#9E9E9E18", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginBottom: 8 }}>
            <Feather name={myVote === "up" ? "heart" : "x"} size={12} color={myVote === "up" ? "#4CAF50" : "#9E9E9E"} />
            <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 12, color: myVote === "up" ? "#4CAF50" : "#9E9E9E" }}>
              {myVote === "up" ? "You loved this" : "You skipped"}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.swipeCardName, { color: colors.foreground, marginBottom: 4 }]}>{suggestion.name}</Text>
        <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 15, color: colors.mutedForeground, lineHeight: 22, marginBottom: 12 }}>
          {suggestion.pitch}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {suggestion.tags.map((tag) => (
            <View key={tag} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.primary + "18" }}>
              <Text style={{ fontFamily: "DmSans_500Medium", fontSize: 13, color: colors.primary }}>{tag}</Text>
            </View>
          ))}
        </View>

        <View style={{ gap: 8, marginTop: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="navigation" size={14} color={colors.mutedForeground} />
            <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 13, color: colors.mutedForeground }}>{suggestion.flightHint}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="sun" size={14} color={colors.mutedForeground} />
            <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 13, color: colors.mutedForeground }}>{suggestion.bestTime}</Text>
          </View>
        </View>

        <Text style={[styles.swipeHint, { color: colors.mutedForeground }]}>← skip · love it →</Text>
      </Animated.View>
    </GestureDetector>
  );
}

/* ── Swipe stack ───────────────────────────────────────────────── */

function DestinationSwipeStack({
  suggestions, uid, allVotes, tripId, colors, onComplete,
}: {
  suggestions: DestinationSuggestion[];
  uid: string;
  allVotes: Record<number, Record<string, "up" | "down">>;
  tripId: string;
  colors: any;
  onComplete: () => void;
}) {
  const [swipeOrder] = useState<number[]>(() => suggestions.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  posRef.current = pos;
  onCompleteRef.current = onComplete;

  const doVote = useCallback((dir: "up" | "down") => {
    const i = posRef.current;
    const actualIdx = swipeOrder[i];
    if (actualIdx === undefined) return;
    voteDestination(tripId, actualIdx, uid, dir);
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

  if (pos >= swipeOrder.length) {
    return (
      <View style={styles.allDoneWrap}>
        <View style={[styles.allDoneCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="check-circle" size={44} color={colors.primary} />
          <Text style={[styles.allDoneTitle, { color: colors.foreground }]}>All voted!</Text>
          <Text style={[styles.allDoneSub, { color: colors.mutedForeground }]}>
            You've rated all {swipeOrder.length} destinations. Locking in your vote…
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
          <View style={[styles.swipeCard, styles.swipeBgCard3, { backgroundColor: colors.card, borderColor: colors.border, width: CARD_WIDTH }]} />
        ) : null}
        {nextIdx !== undefined && suggestions[nextIdx] ? (
          <View style={[styles.swipeCard, styles.swipeBgCard2, { backgroundColor: colors.card, borderColor: colors.border, width: CARD_WIDTH }]} />
        ) : null}
        <TopDestinationCard
          key={`dest-${pos}`}
          suggestion={topSuggestion}
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

interface SuggestionCardProps {
  suggestion: DestinationSuggestion;
  idx: number;
  tripId: string;
  uid: string;
  votes: Record<string, "up" | "down">;
  members: Record<string, { name: string }>;
  isWinning: boolean;
  isAiChoice: boolean;
  allLocked: boolean;
  isCreator: boolean;
  packConfirmed: boolean;
  colors: any;
  onConfirm: () => void;
}

function SuggestionCard({
  suggestion, idx, votes, members, isWinning, isAiChoice, allLocked, isCreator, colors, onConfirm,
}: SuggestionCardProps) {
  const upVoters = Object.entries(votes).filter(([, v]) => v === "up");
  const downVoters = Object.entries(votes).filter(([, v]) => v === "down");
  const score = upVoters.length - downVoters.length;
  const upNames = upVoters.map(([id]) => members[id]?.name ?? "Unknown");
  const downNames = downVoters.map(([id]) => members[id]?.name ?? "Unknown");

  return (
    <View style={[
      styles.card,
      {
        backgroundColor: isWinning && allLocked ? "#2B2723" : colors.card,
        borderColor: isWinning && allLocked ? "#F15A3A" : colors.border,
        borderWidth: isWinning && allLocked ? 2 : 1,
      },
    ]}>
      {isWinning && allLocked && (
        <View style={styles.winBadge}>
          <Text style={styles.winBadgeText}>{isAiChoice ? "✦ AI CHOICE" : "⭐ WINNER"}</Text>
        </View>
      )}
      <View style={styles.rankedImageWrap}>
        <WikiImage
          name={suggestion.name}
          context="travel destination"
          query={`${suggestion.name} city travel`}
          fallbackCategory={suggestion.tags[0] ?? "default"}
          fallbackIndex={destinationFallbackIndex(suggestion.name)}
          style={styles.rankedImage}
          placeholderColor={colors.muted}
        />
      </View>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.cardName, { color: isWinning && allLocked ? "#FFFFFF" : colors.foreground }]}>
            {suggestion.name}
          </Text>
          <Text style={[styles.cardPitch, { color: isWinning && allLocked ? "#BDB0A0" : colors.mutedForeground }]}>
            {suggestion.pitch}
          </Text>
        </View>
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ fontFamily: "DmSans_700Bold", fontSize: 18, color: score > 0 ? colors.primary : colors.mutedForeground }}>
            {score > 0 ? `+${score}` : score}
          </Text>
          <Text style={{ fontFamily: "DmSans_400Regular", fontSize: 10, color: colors.mutedForeground }}>score</Text>
        </View>
      </View>
      <View style={styles.tagsRow}>
        {suggestion.tags.map((tag) => (
          <View key={tag} style={[styles.tag, { backgroundColor: colors.muted }]}>
            <Text style={[styles.tagText, { color: colors.foreground }]}>{tag}</Text>
          </View>
        ))}
      </View>
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Feather name="navigation" size={12} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{suggestion.flightHint}</Text>
        </View>
        <View style={styles.metaItem}>
          <Feather name="sun" size={12} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{suggestion.bestTime}</Text>
        </View>
      </View>
      {upNames.length > 0 && (
        <View style={styles.voterRow}>
          <Feather name="heart" size={11} color={colors.primary} />
          <Text style={[styles.voterNames, { color: colors.primary }]} numberOfLines={1}>{upNames.join(", ")}</Text>
        </View>
      )}
      {downNames.length > 0 && (
        <View style={styles.voterRow}>
          <Feather name="x" size={11} color={colors.mutedForeground} />
          <Text style={[styles.voterNames, { color: colors.mutedForeground }]} numberOfLines={1}>{downNames.join(", ")}</Text>
        </View>
      )}
      {isCreator && isWinning && allLocked && (
        <Pressable onPress={onConfirm} style={styles.confirmBtn}>
          <Feather name="check" size={16} color="#fff" />
          <Text style={styles.confirmBtnText}>Set as destination</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ── Main screen ───────────────────────────────────────────────── */

export default function DestinationVoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { trip, loading } = useTrip(id);

  useEffect(() => {
    if (trip && !trip.packConfirmed && id) {
      router.replace(`/trip/${id}`);
    }
  }, [trip?.packConfirmed, id]);

  const [locking, setLocking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [redoing, setRedoing] = useState(false);
  const [breaking, setBreaking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const inviteLink = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "gopacknow.com"}/join/${id}`;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleCopyId = async () => {
    await Clipboard.setStringAsync(id ?? "");
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const suggestions = trip?.destinationSuggestions ?? [];
  const allVotes = trip?.destinationVotes ?? {};
  const lockedBy = trip?.destinationLockedBy ?? {};
  const members = trip?.members ?? {};
  const memberCount = Object.keys(members).length;
  const lockedCount = Object.keys(lockedBy).length;
  const allLocked = memberCount > 0 && lockedCount >= memberCount;
  const myLocked = !!lockedBy[user?.uid ?? ""];
  const isCreator = trip?.hostMemberId === user?.uid;
  const aiDecision = trip?.aiDestinationDecision;

  const getVotesForIdx = (idx: number): Record<string, "up" | "down"> =>
    (allVotes[idx] ?? {}) as Record<string, "up" | "down">;

  const getScore = (idx: number) => {
    const v = getVotesForIdx(idx);
    const up = Object.values(v).filter((d) => d === "up").length;
    const down = Object.values(v).filter((d) => d === "down").length;
    return up - down;
  };

  const winnerIdx = suggestions.reduce((best, _, idx) => {
    return getScore(idx) > getScore(best) ? idx : best;
  }, 0);

  const topScore = getScore(winnerIdx);
  const isTied = allLocked && suggestions.length > 1 &&
    suggestions.filter((_, i) => getScore(i) === topScore).length > 1;
  const tiedSuggestions = isTied
    ? suggestions.map((s, i) => ({ ...s, origIdx: i })).filter((_, i) => getScore(i) === topScore)
    : [];

  const handleAutoLock = async () => {
    if (!user || !id) return;
    setLocking(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await lockDestinationVotes(id, user.uid);
    } finally {
      setLocking(false);
    }
  };

  const handleConfirm = async () => {
    if (!id || !suggestions[winnerIdx]) return;
    setConfirming(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await confirmDestination(id, suggestions[winnerIdx].name);
      router.replace(`/trip/${id}`);
    } finally {
      setConfirming(false);
    }
  };

  const handleResetForRevote = async () => {
    if (!id) return;
    Alert.alert(
      "Reset votes?",
      "All votes and locks will be cleared so the pack can vote again on the same destinations.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset & Re-vote",
          style: "destructive",
          onPress: async () => {
            setResetting(true);
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              await resetDestinationForRevote(id);
            } finally {
              setResetting(false);
            }
          },
        },
      ],
    );
  };

  const handleAiTiebreakDestination = async () => {
    if (!id || !trip) return;
    if (!isCreator) {
      Alert.alert("Only the trip creator can decide", "Ask the trip creator to use the AI tiebreaker.");
      return;
    }
    if (tiedSuggestions.length < 2) {
      Alert.alert("No tie to break", "The destination votes are no longer tied.");
      return;
    }

    setBreaking(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      const res = await apiFetch("/api/ai-pick-destination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestions: tiedSuggestions.map((s) => ({
            name: s.name, pitch: s.pitch, tags: s.tags, flightHint: s.flightHint,
          })),
          memberCount,
        }),
      });

      const result = await res.json().catch(() => null) as {
        winnerIdx?: unknown;
        reason?: unknown;
        error?: unknown;
      } | null;

      if (!res.ok) {
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "AI could not decide. Please try again.",
        );
      }

      const aiWinnerIdx = Number(result?.winnerIdx);
      if (
        !Number.isInteger(aiWinnerIdx) ||
        aiWinnerIdx < 0 ||
        aiWinnerIdx >= tiedSuggestions.length
      ) {
        throw new Error("AI returned an invalid destination choice. Please try again.");
      }

      const picked = tiedSuggestions[aiWinnerIdx];
      if (!picked || !suggestions[picked.origIdx]) {
        throw new Error("The selected destination is no longer available. Please try again.");
      }

      const reason = typeof result?.reason === "string" ? result.reason.trim() : "";
      await chooseDestinationWithAi(
        id,
        picked.origIdx,
        suggestions[picked.origIdx].name,
        reason,
      );
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {
        // Web previews may not expose the Vibration API. Haptics must never
        // prevent a successfully saved destination from navigating forward.
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Could not break the tie. Please try again.";
      Alert.alert("Could not decide", message);
    } finally {
      setBreaking(false);
    }
  };

  const handleRedo = () => {
    const memberPrefs = trip?.memberPreferences;
    if (!memberPrefs || Object.keys(memberPrefs).length === 0) {
      Alert.alert(
        "Preferences not saved",
        "Member preferences were not saved from the original generation. Go back to the preferences screen and submit again.",
        [{ text: "OK" }],
      );
      return;
    }

    Alert.alert(
      "Try new suggestions?",
      "The AI will generate 3 fresh destinations using the same preferences — votes are reset.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Regenerate",
          onPress: async () => {
            if (!id) return;
            setRedoing(true);
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              const memberPrefsList = Object.entries(memberPrefs).map(([uid, pref]) => ({
                name: trip?.members[uid]?.name ?? "Member",
                vibes: pref.vibes,
                distance: pref.distance,
                budget: pref.budget,
                days: pref.days,
                startDate: pref.startDate,
                startLocation: pref.startLocation,
              }));

              const res = await apiFetch("/api/suggest-destinations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  memberPreferences: memberPrefsList,
                  excludedDestinations: suggestions.map((s) => s.name),
                }),
              });

              if (!res.ok) {
                const errData = await res.json() as { error?: string };
                throw new Error(errData.error ?? "AI couldn't generate suggestions. Try again.");
              }
              const data = await res.json() as { suggestions: DestinationSuggestion[] };
              if (!data.suggestions?.length) throw new Error("No suggestions returned.");

              await storeRedoSuggestions(id, data.suggestions);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              Alert.alert("Error", msg);
            } finally {
              setRedoing(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!trip || suggestions.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No suggestions yet.</Text>
        <Pressable onPress={() => router.back()} style={[styles.backLink, { borderColor: colors.border }]}>
          <Text style={[styles.backLinkText, { color: colors.foreground }]}>Go back</Text>
        </Pressable>
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
          <Text style={[styles.headerLabel, { color: colors.primary }]}>WHERE TO?</Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Vote on a destination</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {isCreator && (
            <Pressable
              onPress={handleRedo}
              disabled={redoing}
              style={[styles.redoBtn, { borderColor: colors.border }]}
            >
              {redoing
                ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                : <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
              }
            </Pressable>
          )}
          <Pressable onPress={() => setShowInvite(true)} style={[styles.inviteBtn, { borderColor: colors.primary }]}>
            <Text style={[styles.inviteBtnText, { color: colors.primary }]}>Invite</Text>
          </Pressable>
        </View>
      </View>

      {/* Lock-in bar */}
      <View style={[styles.lockBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.lockBarTitle, { color: colors.foreground }]}>
            {allLocked
              ? "All votes locked in ✓"
              : myLocked
              ? "Your vote is locked ✓"
              : `${lockedCount} of ${memberCount} locked in`}
          </Text>
          <View style={[styles.lockProgress, { backgroundColor: colors.muted }]}>
            <View style={[styles.lockProgressFill, {
              backgroundColor: allLocked ? "#4CAF50" : colors.primary,
              width: memberCount > 0 ? `${(lockedCount / memberCount) * 100}%` : "0%",
            }]} />
          </View>
        </View>
      </View>

      {/* Member avatars */}
      <View style={[styles.membersRow, { borderBottomColor: colors.border }]}>
        {Object.entries(members).map(([uid, m], i) => (
          <View key={uid} style={{ marginRight: i < Object.keys(members).length - 1 ? -6 : 0 }}>
            <Avatar name={m.name} index={i} size={26} />
          </View>
        ))}
        <Text style={[styles.membersLabel, { color: colors.mutedForeground }]}>
          {"  "}{Object.values(members).map((m) => m.name).join(", ")}
        </Text>
      </View>

      {/* Main content — swipe deck when not locked, ranked list when locked */}
      {!myLocked ? (
        <DestinationSwipeStack
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
          {/* Tie-break banner — shown when all locked but no majority */}
          {isTied && !aiDecision && (
            <View style={[styles.tieBanner, { backgroundColor: "#FFA72615", borderColor: "#FFA726" }]}>
              <Feather name="alert-circle" size={18} color="#FFA726" />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.tieBannerTitle, { color: "#FFA726" }]}>It's a tie — no majority yet</Text>
                <Text style={[styles.tieBannerSub, { color: colors.mutedForeground }]}>
                  The pack is split between {tiedSuggestions.length} destinations.
                </Text>
              </View>
            </View>
          )}

          {/* Tie-break actions — creator only */}
          {isTied && isCreator && !aiDecision && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={handleResetForRevote}
                disabled={resetting}
                style={[styles.tieActionBtn, { borderColor: colors.border, flex: 1 }]}
              >
                {resetting
                  ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                  : (
                    <>
                      <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
                      <Text style={[styles.tieActionText, { color: colors.foreground }]}>Re-vote</Text>
                    </>
                  )}
              </Pressable>
              <Pressable
                onPress={handleAiTiebreakDestination}
                disabled={breaking}
                style={[styles.tieActionBtn, { borderColor: "#7E57C2", backgroundColor: "#7E57C218", flex: 1 }]}
              >
                {breaking
                  ? <ActivityIndicator size="small" color="#7E57C2" />
                  : (
                    <>
                      <Feather name="zap" size={14} color="#7E57C2" />
                      <Text style={[styles.tieActionText, { color: "#7E57C2" }]}>Let AI decide</Text>
                    </>
                  )}
              </Pressable>
            </View>
          )}

          {aiDecision ? (
            <>
              <View style={[styles.aiChoiceBanner, { backgroundColor: "#7E57C218", borderColor: "#7E57C2" }]}>
                <View style={styles.aiChoiceIcon}>
                  <Feather name="zap" size={17} color="#7E57C2" />
                </View>
                <View style={styles.aiChoiceCopy}>
                  <Text style={styles.aiChoiceEyebrow}>AI CHOSE</Text>
                  <Text style={[styles.aiChoiceName, { color: colors.foreground }]}>{aiDecision.name}</Text>
                  {aiDecision.reason ? (
                    <Text style={[styles.aiChoiceReason, { color: colors.mutedForeground }]}>
                      {aiDecision.reason}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                testID="continue-to-wishlist-button"
                accessibilityRole="button"
                accessibilityLabel="Continue to wishlist"
                onPress={() => router.push(`/wishlist/${id}`)}
                style={[styles.continueWishlistBtn, { backgroundColor: colors.primary }]}
              >
                <View>
                  <Text style={styles.continueWishlistEyebrow}>STEP 2</Text>
                  <Text style={styles.continueWishlistText}>Continue to wishlist</Text>
                </View>
                <Feather name="arrow-right" size={21} color="#fff" />
              </Pressable>
            </>
          ) : null}

          {/* Non-creator waiting banner (only when not tied) */}
          {allLocked && !isTied && !isCreator && (
            <View style={[styles.waitingBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="clock" size={16} color={colors.mutedForeground} />
              <Text style={[styles.waitingText, { color: colors.mutedForeground }]}>
                Waiting for the trip creator to confirm the destination…
              </Text>
            </View>
          )}

          {redoing && (
            <View style={[styles.confirmingBanner, { backgroundColor: "#7E57C222" }]}>
              <ActivityIndicator color="#7E57C2" size="small" />
              <Text style={[styles.waitingText, { color: "#7E57C2" }]}>Asking AI for fresh suggestions…</Text>
            </View>
          )}

          {confirming && (
            <View style={[styles.confirmingBanner, { backgroundColor: colors.primary + "18" }]}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.waitingText, { color: colors.primary }]}>Setting destination…</Text>
            </View>
          )}

          {[...suggestions]
            .map((s, i) => ({ s, i, score: getScore(i) }))
            .sort((a, b) => b.score - a.score)
            .map(({ s, i }) => (
              <SuggestionCard
                key={i}
                suggestion={s}
                idx={i}
                tripId={id!}
                uid={user?.uid ?? ""}
                votes={getVotesForIdx(i)}
                members={members}
                isWinning={aiDecision ? i === aiDecision.suggestionIndex : !isTied && i === winnerIdx}
                isAiChoice={aiDecision?.suggestionIndex === i}
                allLocked={allLocked}
                isCreator={isCreator && !aiDecision}
                packConfirmed={!!trip?.packConfirmed}
                colors={colors}
                onConfirm={handleConfirm}
              />
            ))}
        </ScrollView>
      )}

      {/* Invite modal */}
      <Modal visible={showInvite} transparent animationType="slide" onRequestClose={() => setShowInvite(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowInvite(false)}>
          <Pressable style={[styles.inviteSheet, { backgroundColor: colors.card }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Invite the pack</Text>
              <Pressable onPress={() => setShowInvite(false)}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>TRIP LINK</Text>
            <View style={[styles.sheetLinkRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.sheetLinkText, { color: colors.foreground }]} numberOfLines={1}>{inviteLink}</Text>
              <Pressable onPress={handleCopy} style={[styles.copyBtn, { backgroundColor: colors.primary }]}>
                <Feather name={copied ? "check" : "copy"} size={16} color="#fff" />
              </Pressable>
            </View>
            <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>TRIP ID</Text>
            <View style={[styles.sheetLinkRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.inviteCode, { color: colors.primary }]}>{id}</Text>
              <Pressable onPress={handleCopyId} style={[styles.copyBtn, { backgroundColor: colors.primary }]}>
                <Feather name={copiedId ? "check" : "copy"} size={16} color="#fff" />
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  emptyText: { fontFamily: "DmSans_400Regular", fontSize: 15 },
  backLink: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backLinkText: { fontFamily: "DmSans_500Medium", fontSize: 14 },

  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12 },
  backBtn: { padding: 4 },
  headerLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11, letterSpacing: 2 },
  headerTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20 },
  redoBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inviteBtn: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  inviteBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },

  lockBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  lockBarTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 13, marginBottom: 6 },
  lockProgress: { height: 4, borderRadius: 2, overflow: "hidden" },
  lockProgressFill: { height: 4, borderRadius: 2 },
  lockBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  lockBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },

  membersRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  membersLabel: { fontFamily: "DmSans_400Regular", fontSize: 12, flexShrink: 1 },

  swipeStackWrap: { flex: 1, alignItems: "center", paddingTop: 6 },
  swipeCounter: { fontFamily: "DmSans_400Regular", fontSize: 12, marginBottom: 8 },
  swipeStack: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
  swipeCard: { position: "absolute" as const, width: CARD_WIDTH, borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  swipeBgCard2: { top: 12, transform: [{ scale: 0.96 }], opacity: 0.85 },
  swipeBgCard3: { top: 24, transform: [{ scale: 0.92 }], opacity: 0.6 },
  swipeLabel: {
    position: "absolute", top: 16, flexDirection: "row", alignItems: "center",
    gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    borderWidth: 2, zIndex: 10, backgroundColor: "rgba(255,255,255,0.92)",
  },
  swipeLabelRight: { right: 14, borderColor: "#4CAF50" },
  swipeLabelLeft: { left: 14, borderColor: "#ef4444" },
  swipeLabelText: { fontFamily: "DmSans_700Bold", fontSize: 13, letterSpacing: 1 },
  swipeTapRow: { flexDirection: "row", gap: 16, marginTop: 12, marginBottom: 4 },
  swipeActionPill: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 100, borderWidth: 1, paddingHorizontal: 28, paddingVertical: 14,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  swipeActionPillText: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  swipeCardName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22, lineHeight: 28 },
  swipeHint: { fontFamily: "DmSans_400Regular", fontSize: 11, textAlign: "center", marginTop: 2 },
  swipeImageWrap: { width: "100%", height: 180, borderRadius: 12, marginBottom: 2, overflow: "hidden" },
  swipeImage: { width: "100%", height: "100%" },

  allDoneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  allDoneCard: { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: "center", gap: 12, width: "100%" },
  allDoneTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 26 },
  allDoneSub: { fontFamily: "DmSans_400Regular", fontSize: 14, textAlign: "center", lineHeight: 20 },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  rankedImageWrap: { width: "100%", height: 140, borderRadius: 12, overflow: "hidden" },
  rankedImage: { width: "100%", height: "100%" },
  winBadge: { alignSelf: "flex-start", backgroundColor: "#F15A3A", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  winBadgeText: { fontFamily: "DmSans_700Bold", fontSize: 11, color: "#fff", letterSpacing: 1 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22, lineHeight: 28 },
  cardPitch: { fontFamily: "DmSans_400Regular", fontSize: 14, lineHeight: 20 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  tagText: { fontFamily: "DmSans_500Medium", fontSize: 12 },
  metaRow: { flexDirection: "row", gap: 16 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  voterRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  voterNames: { fontFamily: "DmSans_400Regular", fontSize: 12, flex: 1 },
  confirmBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#F15A3A", borderRadius: 100, paddingVertical: 14, marginTop: 4,
  },
  confirmBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
  waitingBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, padding: 14, borderWidth: 1 },
  confirmingBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, padding: 12 },
  waitingText: { fontFamily: "DmSans_400Regular", fontSize: 13, flex: 1 },
  tieBanner: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 14, padding: 14, borderWidth: 1 },
  tieBannerTitle: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  tieBannerSub: { fontFamily: "DmSans_400Regular", fontSize: 13 },
  tieActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  tieActionText: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },
  aiChoiceBanner: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 14, padding: 15, borderWidth: 1 },
  aiChoiceIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#7E57C224" },
  aiChoiceCopy: { flex: 1, gap: 3 },
  aiChoiceEyebrow: { fontFamily: "DmSans_700Bold", fontSize: 10, letterSpacing: 1.3, color: "#7E57C2" },
  aiChoiceName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22 },
  aiChoiceReason: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 19, marginTop: 2 },
  continueWishlistBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 15,
  },
  continueWishlistEyebrow: { fontFamily: "DmSans_700Bold", fontSize: 10, letterSpacing: 1.4, color: "#FFFFFFCC", marginBottom: 2 },
  continueWishlistText: { fontFamily: "DmSans_700Bold", fontSize: 16, color: "#fff" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  inviteSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 48, gap: 14 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22 },
  sheetLabel: { fontFamily: "DmSans_500Medium", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" },
  sheetLinkRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, gap: 10 },
  sheetLinkText: { flex: 1, fontFamily: "DmSans_400Regular", fontSize: 13 },
  inviteCode: { flex: 1, fontFamily: "DmSans_700Bold", fontSize: 20, letterSpacing: 2 },
  copyBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
