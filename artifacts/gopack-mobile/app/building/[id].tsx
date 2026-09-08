import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-client";
import { resolveTripDays } from "@/lib/trip-dates";
import { saveItinerary, useTrip, useWishes } from "@/hooks/useFirebase";
import { isWishEligible } from "@/lib/wish-eligibility";
import { sendTripPush } from "@/lib/push-notifications";

const MESSAGES = [
  "Packing your adventure...",
  "Consulting the travel spirits...",
  "Arranging the perfect days...",
  "Almost ready for takeoff...",
];

export default function BuildingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const colors = useColors();
  const { trip } = useTrip(id);
  const wishes = useWishes(id);

  const [msgIndex, setMsgIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: 0.85,
      duration: 8000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % MESSAGES.length);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!trip || hasStarted.current) return;
    hasStarted.current = true;

    const run = async () => {
      try {
        const memberPrefs = Object.values((trip as any).memberPreferences ?? {}) as Array<Record<string, unknown>>;

        const prefDays = memberPrefs.map(p => Number(p.days)).filter(d => d > 0);
        const preferenceFallbackDays = prefDays.length > 0
          ? Math.round(prefDays.reduce((sum, days) => sum + days, 0) / prefDays.length)
          : 5;
        const resolvedDays = resolveTripDays(
          trip.startDate,
          trip.endDate,
          trip.days,
          preferenceFallbackDays,
        );

        const memberCount = Object.keys(trip.members ?? {}).length;
        const includedWishes = [...wishes]
          .filter(w => isWishEligible(w, memberCount))
          .sort((a, b) => b.score - a.score);

        const toPayload = (w: typeof includedWishes[0]) => ({
          id: w.id,
          text: w.text,
          author: w.authorName,
          votes: w.score,
        });

        const prefVibes = memberPrefs.flatMap(p => (p.vibes as string[] | undefined) ?? []);
        const resolvedVibes = prefVibes.length > 0
          ? [...new Set(prefVibes)]
          : (trip.vibes?.length ? trip.vibes : ["culture", "food"]);

        const paceVotes: Record<string, number> = {};
        for (const pref of memberPrefs) {
          const p = (pref.pace as string) ?? "balanced";
          paceVotes[p] = (paceVotes[p] ?? 0) + 1;
        }
        const resolvedPace = Object.entries(paceVotes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "balanced";

        const res = await apiFetch("/api/itinerary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: trip.destination,
            days: resolvedDays,
            vibes: resolvedVibes,
            budget: trip.budget ?? "midrange",
            startDate: trip.startDate ?? null,
            // Every non-negative wish was included in the voted outcome. The
            // API is allowed to add supporting activities, never drop these.
            guaranteed: includedWishes.map(toPayload),
            candidates: [],
            pace: resolvedPace,
            userId: user?.uid,
            isPlusUser: false,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "Generation failed. Please try again.");
        }
        const result = await res.json();

        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: false,
        }).start();

        await saveItinerary(id!, result);
        await sendTripPush(
          id!,
          `${trip.destination || "Your trip"} itinerary is ready`,
          "The pack's plan is ready to explore.",
          `/itinerary/${id}`,
        );
        setTimeout(() => router.replace(`/itinerary/${id}`), 800);
      } catch (err) {
        setError((err as Error).message || "Something went wrong. Please try again.");
      }
    };

    run();
  }, [trip]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {!error && <ActivityIndicator size="large" color={colors.primary} style={{ transform: [{ scale: 1.2 }] }} />}
      
      <Text style={[styles.message, { color: colors.foreground }]}>{error ? "Something went wrong." : MESSAGES[msgIndex]}</Text>

      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: colors.primary,
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>

      {error && (
        <>
          <Text style={[styles.errorHint, { color: colors.mutedForeground }]}>{error}</Text>
          <Pressable onPress={() => router.back()} style={[styles.backBtn, { borderColor: colors.border }]}>
            <Text style={[styles.backBtnText, { color: colors.foreground }]}>Go back</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    paddingHorizontal: 40,
  },
  message: {
    fontFamily: "DmSans_500Medium",
    fontSize: 20,
    textAlign: "center",
    lineHeight: 28,
  },
  progressTrack: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  errorHint: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  backBtn: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 24,
    borderWidth: 1,
  },
  backBtnText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 15,
  },
});
