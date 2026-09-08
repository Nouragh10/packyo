import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { deleteTrip, leaveTrip, useTrips, type Trip } from "@/hooks/useFirebase";

// Some mock thumbnails for trips to match wireframe style
const TRIP_IMAGES = [
  "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=400&q=80&auto=format&fit=crop", // Bali
  "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=400&q=80&auto=format&fit=crop", // Lisbon
  "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=400&q=80&auto=format&fit=crop", // Japan
];

function hasTripEnded(trip: Trip, now = Date.now()): boolean {
  let end: Date | null = null;

  if (trip.endDate) {
    end = new Date(`${trip.endDate}T23:59:59.999`);
  } else if (trip.startDate) {
    end = new Date(`${trip.startDate}T23:59:59.999`);
    end.setDate(end.getDate() + Math.max(Number(trip.days) || 1, 1) - 1);
  }

  return !!end && !Number.isNaN(end.getTime()) && end.getTime() < now;
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { trips, refetch } = useTrips(user?.uid);
  const router = useRouter();
  const [tripToRemove, setTripToRemove] = React.useState<{
    id: string;
    destination: string;
    action: "delete" | "leave";
  } | null>(null);
  const [removingTrip, setRemovingTrip] = React.useState(false);
  const [removeError, setRemoveError] = React.useState("");

  const displayName = user?.displayName ?? (user?.isAnonymous ? "Traveler" : "Explorer");
  const firstName = displayName.split(" ")[0];
  const initial = firstName[0]?.toUpperCase() || "T";
  
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 84 : insets.bottom + 80;

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const confirmTripRemoval = async () => {
    if (!tripToRemove || !user) return;
    setRemovingTrip(true);
    setRemoveError("");
    try {
      if (tripToRemove.action === "delete") {
        await deleteTrip(tripToRemove.id, user.uid);
      } else {
        await leaveTrip(tripToRemove.id, user.uid);
      }
      setTripToRemove(null);
      refetch();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Could not update this trip.");
    } finally {
      setRemovingTrip(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <Text style={[styles.greeting, { color: colors.foreground }]}>Hi, {firstName}</Text>
        <View style={styles.headerRight}>
          <Pressable onPress={() => router.push("/(tabs)/notifications")} style={styles.bellBtn}>
            <Feather name="bell" size={24} color={colors.foreground} />
            <View style={[styles.badge, { backgroundColor: colors.primary }]} />
          </Pressable>
          <Pressable onPress={() => router.push("/(tabs)/profile")} style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomInset }}
      >
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your trips</Text>
          <Text style={[styles.seeAll, { color: colors.mutedForeground }]}>See all</Text>
        </View>

        <View style={styles.tripsList}>
          {trips.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No trips yet.</Text>
          ) : (
            trips.map((trip, i) => {
              const tripEnded = hasTripEnded(trip);
              const hasReview = !!user && !!(
                trip.memberReviews?.[user.uid] ||
                (trip.review as { reviewedBy?: string } | undefined)?.reviewedBy === user.uid
              );

              return (
              <Pressable
                key={trip.id}
                style={[styles.tripCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() =>
                  trip.itinerary
                    ? router.push({
                        pathname: "/itinerary/[id]",
                        params: { id: trip.id, returnTo: "tripHub" },
                      } as any)
                    : router.push(`/trip/${trip.id}` as any)
                }
              >
                <Image
                  source={{ uri: TRIP_IMAGES[i % TRIP_IMAGES.length] }}
                  style={styles.tripImage}
                  contentFit="cover"
                />
                <View style={styles.tripInfo}>
                  <Text style={[styles.tripName, { color: colors.foreground }]} numberOfLines={1}>
                    {trip.destination || "Deciding destination"}
                  </Text>
                  <Text style={[styles.tripDate, { color: colors.mutedForeground }]}>
                    {trip.days} days
                  </Text>
                  <View style={styles.tripMembers}>
                    <Feather name="user" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.tripMembersText, { color: colors.mutedForeground }]}>
                      {Object.keys(trip.members ?? {}).length} members
                    </Text>
                  </View>
                  {tripEnded && !hasReview ? (
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation?.();
                        router.push(`/review/${trip.id}` as any);
                      }}
                      style={[styles.reviewButton, { backgroundColor: colors.primary }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Review ${trip.destination || "trip"}`}
                    >
                      <Feather name="star" size={13} color="#fff" />
                      <Text style={styles.reviewButtonText}>Review</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  testID={`remove-trip-${trip.id}`}
                  hitSlop={10}
                  onPress={(event) => {
                    event.stopPropagation?.();
                    setRemoveError("");
                    setTripToRemove({
                      id: trip.id,
                      destination: trip.destination || "this trip",
                      action: trip.hostMemberId === user?.uid ? "delete" : "leave",
                    });
                  }}
                  style={[styles.removeTripBtn, { backgroundColor: colors.muted }]}
                >
                  <Feather
                    name="trash-2"
                    size={16}
                    color={trip.hostMemberId === user?.uid ? colors.destructive : colors.mutedForeground}
                  />
                </Pressable>
              </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.actionContainer}>
          <Pressable
            onPress={() => router.push("/(tabs)/create")}
            style={[styles.createBtn, { borderColor: colors.border }]}
          >
            <Feather name="plus" size={18} color={colors.primary} />
            <Text style={[styles.createBtnText, { color: colors.primary }]}>Create a new trip</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/join")}
            style={[styles.joinBtn, { backgroundColor: colors.primary }]}
          >
            <Feather name="user-plus" size={18} color="#fff" />
            <Text style={styles.joinBtnText}>Join a trip</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={tripToRemove !== null}
        transparent
        animationType="slide"
        onRequestClose={() => !removingTrip && setTripToRemove(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => !removingTrip && setTripToRemove(null)}
        >
          <Pressable style={[styles.removeSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={[styles.removeIcon, { backgroundColor: colors.destructive + "15" }]}>
              <Feather name="trash-2" size={22} color={colors.destructive} />
            </View>
            <Text style={[styles.removeTitle, { color: colors.foreground }]}>
              {tripToRemove?.action === "delete" ? "Delete this trip?" : "Leave this trip?"}
            </Text>
            <Text style={[styles.removeBody, { color: colors.mutedForeground }]}>
              {tripToRemove?.action === "delete"
                ? `“${tripToRemove?.destination}” and all its planning data will be permanently deleted for everyone.`
                : `Remove “${tripToRemove?.destination}” from your trips? Other members will keep access.`}
            </Text>
            {!!removeError && <Text style={[styles.removeError, { color: colors.destructive }]}>{removeError}</Text>}
            <Pressable
              disabled={removingTrip}
              onPress={confirmTripRemoval}
              style={[styles.removeConfirmBtn, { backgroundColor: colors.destructive, opacity: removingTrip ? 0.6 : 1 }]}
            >
              {removingTrip
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.removeConfirmText}>
                    {tripToRemove?.action === "delete" ? "Delete trip" : "Leave trip"}
                  </Text>}
            </Pressable>
            <Pressable
              disabled={removingTrip}
              onPress={() => setTripToRemove(null)}
              style={[styles.removeCancelBtn, { backgroundColor: colors.muted }]}
            >
              <Text style={[styles.removeCancelText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  greeting: {
    fontFamily: "PlayfairDisplay_700Bold",
    fontSize: 28,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  bellBtn: {
    padding: 4,
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F6F1EA",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "DmSans_700Bold",
    fontSize: 16,
    color: "#241F1B",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    marginTop: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: "DmSans_700Bold",
    fontSize: 18,
  },
  seeAll: {
    fontFamily: "DmSans_500Medium",
    fontSize: 14,
  },
  tripsList: {
    paddingHorizontal: 24,
    gap: 16,
  },
  emptyText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 15,
  },
  tripCard: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 16,
    alignItems: "center",
  },
  tripImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: "#E8E1D9",
  },
  tripInfo: {
    flex: 1,
    gap: 4,
  },
  removeTripBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  tripName: {
    fontFamily: "DmSans_700Bold",
    fontSize: 16,
  },
  tripDate: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
  },
  tripMembers: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  tripMembersText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 13,
  },
  reviewButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
  reviewButtonText: {
    color: "#fff",
    fontFamily: "DmSans_600SemiBold",
    fontSize: 12,
  },
  actionContainer: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 16,
    backgroundColor: "#FFFFFF",
  },
  createBtnText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 16,
  },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 24,
    paddingVertical: 16,
    marginTop: 12,
  },
  joinBtnText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  removeSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 38, alignItems: "center" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, marginBottom: 20 },
  removeIcon: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  removeTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22, textAlign: "center", marginBottom: 8 },
  removeBody: { fontFamily: "DmSans_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 16 },
  removeError: { fontFamily: "DmSans_400Regular", fontSize: 13, textAlign: "center", marginBottom: 12 },
  removeConfirmBtn: { width: "100%", borderRadius: 14, paddingVertical: 15, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  removeConfirmText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
  removeCancelBtn: { width: "100%", borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  removeCancelText: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
});
