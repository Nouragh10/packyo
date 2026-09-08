import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { deletePack, usePacks, renamePack, removePackMember, useTrips } from "@/hooks/useFirebase";

function packCreatedLabel(ts: number) {
  if (!ts) return "Recently";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function tripIsPast(startDate: string | null | undefined, days: number) {
  if (!startDate) return false;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(start.getTime() + Math.max(days || 1, 1) * 86400000);
  return end < new Date();
}

function tripDateLabel(startDate: string | null | undefined, endDate: string | null | undefined, days: number) {
  if (!startDate) return "Dates pending";
  const start = new Date(`${startDate}T00:00:00`);
  const end = endDate
    ? new Date(`${endDate}T00:00:00`)
    : new Date(start.getTime() + Math.max((days || 1) - 1, 0) * 86400000);
  const format = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${format(start)} – ${format(end)}`;
}

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { packs, loading } = usePacks(user?.uid);
  const { trips, loading: tripsLoading } = useTrips(user?.uid);

  const pack = packs.find((p) => p.id === id) ?? null;

  const [editing, setEditing] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const isHost = pack?.hostUid === user?.uid;
  const memberList = Object.entries(pack?.members ?? {});
  const tripRows = trips
    .filter((trip) => !!pack?.tripIds?.[trip.id])
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  const firstTripId = tripRows[0]?.id ?? Object.keys(pack?.tripIds ?? {})[0];

  const handleRename = async () => {
    if (!pack || !newName.trim()) { setEditing(false); return; }
    setRenaming(true);
    try {
      await renamePack(pack.id, newName.trim());
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    setRenaming(false);
    setEditingName(false);
  };

  const handleRemoveMember = (uid: string, name: string) => {
    if (!pack) return;
    Alert.alert(
      `Remove ${name}?`,
      "They'll be removed from this pack. Past trips together are unchanged.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removePackMember(pack.id, uid);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {}
          },
        },
      ],
    );
  };

  const handleDeletePack = () => {
    if (!pack || !user || deleting) return;
    Alert.alert(
      `Delete ${pack.name}?`,
      "This pack and its saved trip links will be permanently removed. Past trips will not be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete pack",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await deletePack(pack.id, user.uid);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setEditing(false);
              router.replace("/(tabs)/profile" as any);
            } catch (error) {
              Alert.alert(
                "Delete failed",
                error instanceof Error ? error.message : "We couldn't delete this pack. Please try again.",
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const openPackChat = () => {
    if (firstTripId) {
      router.push(`/chat/${firstTripId}` as any);
    } else {
      Alert.alert("No trip chat yet", "Message features become available after this pack has a trip.");
    }
  };

  const openInvite = () => {
    if (firstTripId) {
      router.push(`/trip/${firstTripId}` as any);
    } else {
      Alert.alert("No trip to invite to", "Create a trip first, then invite your pack from the trip hub.");
    }
  };

  const openShare = () => {
    Alert.alert("Share link", "Open a trip in this pack to share its invite link with friends.");
  };

  const openPackSettings = () => {
    if (isHost && pack) {
      setNewName(pack.name);
      setEditingName(false);
      setEditing(true);
      Haptics.selectionAsync();
    } else {
      Alert.alert("Pack settings", "Only the pack host can change these settings.");
    }
  };

  if (loading || !pack) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topInset + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.headerSideButton}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={styles.center}>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[{ fontFamily: "DmSans_400Regular", fontSize: 15 }, { color: colors.mutedForeground }]}>
              Pack not found.
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerSideButton} accessibilityLabel="Go back">
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Pack</Text>
        <Pressable onPress={openPackSettings} style={styles.headerSideButton} accessibilityLabel="Open pack settings">
          <Feather name="more-horizontal" size={21} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}
      >
        <View style={styles.packHero}>
          <View style={styles.heroAvatarRow}>
            {memberList.slice(0, 4).map(([uid], index) => (
              <View
                key={uid}
                style={[
                  styles.heroAvatar,
                  {
                    marginLeft: index === 0 ? 0 : -8,
                    backgroundColor: colors.muted,
                    borderColor: colors.background,
                  },
                ]}
              >
                <Feather name="user" size={23} color={colors.mutedForeground} />
              </View>
            ))}
            {memberList.length > 4 ? (
              <View style={[styles.heroMore, { backgroundColor: colors.primary + "14", borderColor: colors.background }]}>
                <Text style={[styles.heroMoreText, { color: colors.primary }]}>+{memberList.length - 4}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.packTitleRow}>
            <Text style={[styles.packTitle, { color: colors.foreground }]} numberOfLines={1}>{pack.name}</Text>
            {isHost ? (
              <Pressable onPress={openPackSettings} hitSlop={8} accessibilityLabel="Rename pack">
                <Feather name="edit-2" size={16} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.packSubtitle, { color: colors.mutedForeground }]}>
            {memberList.length} members <Text style={[styles.dot, { color: colors.mutedForeground }]}>·</Text> Created {packCreatedLabel(pack.createdAt)}
          </Text>
        </View>

        <View style={styles.actionRow}>
          {[
            { icon: "message-square", label: "Message", onPress: openPackChat },
            { icon: "user-plus", label: "Invite", onPress: openInvite },
            { icon: "link", label: "Share link", onPress: openShare },
            { icon: "settings", label: "Pack settings", onPress: openPackSettings },
          ].map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              style={({ pressed }) => [
                styles.actionButton,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <Feather name={action.icon as any} size={16} color={colors.primary} />
              <Text style={[styles.actionLabel, { color: colors.foreground }]} numberOfLines={1}>{action.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Members</Text>
          <View style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {memberList.map(([uid, member]) => (
              <View key={uid} style={[styles.memberRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.memberAvatar, { backgroundColor: colors.muted }]}>
                  <Feather name="user" size={19} color={colors.mutedForeground} />
                </View>
                <View style={styles.memberCopy}>
                  <Text style={[styles.memberName, { color: colors.foreground }]} numberOfLines={1}>
                    {member.name || "Member"}{uid === user?.uid ? " (You)" : ""}
                  </Text>
                  <Text style={[styles.memberRole, { color: colors.mutedForeground }]}>
                    {uid === pack.hostUid ? "Host" : "Member"}
                  </Text>
                </View>
                {isHost && uid !== user?.uid ? (
                  <Pressable
                    onPress={() => handleRemoveMember(uid, member.name || "Member")}
                    style={styles.memberAction}
                    accessibilityLabel={`Remove ${member.name || "member"}`}
                  >
                    <Feather name="x" size={15} color={colors.mutedForeground} />
                  </Pressable>
                ) : (
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                )}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Pack trips</Text>
            {tripRows.length > 0 ? <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text> : null}
          </View>
          {tripsLoading ? (
            <View style={styles.loadingTrips}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : tripRows.length === 0 ? (
            <View style={[styles.emptyTrips, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="map" size={19} color={colors.mutedForeground} />
              <Text style={[styles.emptyTripsText, { color: colors.mutedForeground }]}>No trips in this pack yet.</Text>
            </View>
          ) : (
            <View style={[styles.tripCardGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {tripRows.map((trip, index) => {
                const past = tripIsPast(trip.startDate, trip.days);
                return (
                  <Pressable
                    key={trip.id}
                    onPress={() => trip.itinerary
                      ? router.push({ pathname: "/itinerary/[id]", params: { id: trip.id, returnTo: "tripHub" } } as any)
                      : router.push(`/trip/${trip.id}` as any)}
                    style={({ pressed }) => [styles.tripRow, { borderBottomColor: colors.border, opacity: pressed ? 0.72 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${trip.destination || "trip"}`}
                  >
                    <View style={[styles.tripThumb, { backgroundColor: colors.muted }]}>
                      <Feather name={index % 2 === 0 ? "map-pin" : "image"} size={21} color={colors.mutedForeground} />
                    </View>
                    <View style={styles.tripCopy}>
                      <View style={styles.tripTitleRow}>
                        <Text style={[styles.tripName, { color: colors.foreground }]} numberOfLines={1}>
                          {trip.destination || "Destination TBD"}
                        </Text>
                        <View style={[styles.statusPill, { backgroundColor: past ? colors.muted : colors.primary + "14" }]}>
                          <Text style={[styles.statusText, { color: past ? colors.mutedForeground : colors.primary }]}>
                            {past ? "Past" : "Active"}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.tripDate, { color: colors.mutedForeground }]}>
                        {tripDateLabel(trip.startDate, trip.endDate, trip.days)}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Rename modal */}

      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
          <Pressable
            style={styles.overlay}
            onPress={() => {
              Keyboard.dismiss();
              setEditing(false);
            }}
          >
            <Pressable
              style={[styles.renameSheet, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => {}}
            >
              <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Pack settings</Text>
              {editingName ? (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PACK NAME</Text>
                  <TextInput
                    style={[styles.renameInput, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="e.g. College Friends, Family, Work Squad"
                    placeholderTextColor={colors.mutedForeground}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleRename}
                  />
                  <View style={styles.sheetBtns}>
                    <Pressable
                      onPress={() => {
                        Keyboard.dismiss();
                        setNewName(pack.name);
                        setEditingName(false);
                      }}
                      disabled={renaming}
                      style={[styles.cancelBtn, { borderColor: colors.border, opacity: renaming ? 0.6 : 1 }]}
                    >
                      <Text style={[styles.cancelText, { color: colors.foreground }]}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleRename}
                      disabled={renaming}
                      style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: renaming ? 0.6 : 1 }]}
                    >
                      {renaming
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.saveBtnText}>Save name</Text>}
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  onPress={() => setEditingName(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Edit pack name"
                  style={[styles.settingRow, { backgroundColor: colors.muted, borderColor: colors.border }]}
                >
                  <View style={styles.settingRowCopy}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>PACK NAME</Text>
                    <Text style={[styles.settingValue, { color: colors.foreground }]} numberOfLines={1}>{pack.name}</Text>
                  </View>
                  <View style={[styles.editNameButton, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Feather name="edit-2" size={14} color={colors.primary} />
                    <Text style={[styles.editNameButtonText, { color: colors.primary }]}>Edit name</Text>
                  </View>
                </Pressable>
              )}
              {isHost && !editingName ? (
                <Pressable
                  onPress={handleDeletePack}
                  disabled={renaming || deleting}
                  testID="delete-pack"
                  accessibilityRole="button"
                  accessibilityLabel="Delete pack"
                  style={[styles.deleteBtn, { borderColor: colors.destructive, opacity: deleting ? 0.6 : 1 }]}
                >
                  {deleting
                    ? <ActivityIndicator color={colors.destructive} size="small" />
                    : <Text style={[styles.deleteBtnText, { color: colors.destructive }]}>Delete pack</Text>}
                </Pressable>
              ) : null}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSideButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "DmSans_700Bold", fontSize: 16 },
  packHero: { alignItems: "center", paddingHorizontal: 20, paddingTop: 22, paddingBottom: 17 },
  heroAvatarRow: { flexDirection: "row", alignItems: "center", marginBottom: 13 },
  heroAvatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  heroMore: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  heroMoreText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  packTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, maxWidth: "90%" },
  packTitle: { fontFamily: "DmSans_700Bold", fontSize: 20 },
  packSubtitle: { fontFamily: "DmSans_400Regular", fontSize: 11, marginTop: 4 },
  dot: {},
  actionRow: { flexDirection: "row", gap: 7, paddingHorizontal: 18, paddingBottom: 22 },
  actionButton: { flex: 1, minHeight: 52, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  actionLabel: { fontFamily: "DmSans_500Medium", fontSize: 8, marginTop: 6, textAlign: "center" },
  section: { paddingHorizontal: 18, paddingTop: 7, marginBottom: 17 },
  sectionTitle: {
    fontFamily: "DmSans_700Bold", fontSize: 11,
    textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 9,
  },
  memberCard: { borderRadius: 13, borderWidth: 1, overflow: "hidden" },
  memberRow: {
    flexDirection: "row", alignItems: "center", minHeight: 57,
    paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginRight: 10 },
  memberCopy: { flex: 1 },
  memberName: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  memberRole: { fontFamily: "DmSans_400Regular", fontSize: 10, marginTop: 2 },
  memberAction: { padding: 8 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 9 },
  seeAll: { fontFamily: "DmSans_600SemiBold", fontSize: 10 },
  loadingTrips: { alignItems: "center", paddingVertical: 24 },
  emptyTrips: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, borderWidth: 1, paddingVertical: 19 },
  emptyTripsText: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  tripCardGroup: { borderRadius: 13, borderWidth: 1, overflow: "hidden" },
  tripRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 75, paddingHorizontal: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  tripThumb: { width: 54, height: 54, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tripCopy: { flex: 1 },
  tripTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  tripName: { fontFamily: "DmSans_600SemiBold", fontSize: 13, flex: 1 },
  statusPill: { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3 },
  statusText: { fontFamily: "DmSans_600SemiBold", fontSize: 8 },
  tripDate: { fontFamily: "DmSans_400Regular", fontSize: 10, marginTop: 6 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  renameSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 24, paddingBottom: 40, gap: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  sheetTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20 },
  fieldLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 10, letterSpacing: 1.1 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  settingRowCopy: { flex: 1, gap: 4 },
  settingValue: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  editNameButton: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  editNameButtonText: { fontFamily: "DmSans_600SemiBold", fontSize: 12 },
  renameInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontFamily: "DmSans_400Regular", fontSize: 15 },
  sheetBtns: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderRadius: 12, paddingVertical: 13 },
  cancelText: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  saveBtn: { flex: 1, alignItems: "center", borderRadius: 12, paddingVertical: 13 },
  saveBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
  deleteBtn: { alignItems: "center", borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  deleteBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },
});
