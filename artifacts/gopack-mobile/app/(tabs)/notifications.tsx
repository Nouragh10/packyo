import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { useNotifications, AppNotification } from "@/hooks/useFirebase";
import {
  hasRegisteredPushToken,
  registerForPushNotifications,
} from "@/lib/push-notifications";
import { apiFetch } from "@/lib/api-client";

/* ── Icon config per notification type ─────────────────────────── */
const TYPE_META: Record<
  AppNotification["type"],
  { icon: string; bg: string; label: string }
> = {
  itinerary_ready:  { icon: "map",           bg: "#4CAF50", label: "Trips" },
  accom_vote:       { icon: "home",           bg: "#E85D3A", label: "Trips" },
  dest_vote:        { icon: "navigation",     bg: "#7E57C2", label: "Trips" },
  votes_complete:   { icon: "check-circle",   bg: "#4CAF50", label: "Trips" },
  dest_confirmed:   { icon: "flag",           bg: "#F59E0B", label: "Trips" },
  new_member:       { icon: "user-plus",      bg: "#2196F3", label: "Trips" },
  chat:             { icon: "message-circle", bg: "#7E57C2", label: "Mentions" },
  invite:           { icon: "user-plus",      bg: "#E85D3A", label: "Trips" },
  trip_invite:      { icon: "user-plus",      bg: "#E85D3A", label: "Trips" },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

const TABS = ["All", "Trips", "Mentions"] as const;
type Tab = (typeof TABS)[number];

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const [serverInvites, setServerInvites] = useState<AppNotification[]>([]);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 84 : insets.bottom + 80;

  const { notifications, loading } = useNotifications(user?.uid);

  useEffect(() => {
    hasRegisteredPushToken().then(setPushEnabled).catch(() => setPushEnabled(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setServerInvites([]);
      return;
    }
    let active = true;
    user.getIdToken().then((token) =>
      apiFetch("/api/my-notifications", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).then((response) => response.ok ? response.json() : { notifications: [] })
      .then((result: any) => {
        if (!active) return;
        setServerInvites((result.notifications ?? [])
          .filter((item: any) => item.type === "trip_invite")
          .map((item: any) => ({
            id: `server-${item.id}`,
            serverNotificationId: item.id,
            type: "trip_invite" as const,
            text: `${item.fromName ?? "A traveler"} invited you`,
            subtext: `Join ${item.tripName ?? "a trip"} with ${item.packName ?? "your pack"}.`,
            tripId: item.tripId,
            tripName: item.tripName ?? "Trip",
            timestamp: item.createdAt ?? Date.now(),
            actionable: true,
          })));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [user?.uid]);

  const enablePush = async () => {
    if (!user || enablingPush) return;
    setEnablingPush(true);
    setPushMessage("");
    try {
      const result = await registerForPushNotifications(user.uid);
      setPushEnabled(result.granted);
      setPushMessage(result.granted ? "Trip alerts are on." : (result.reason ?? "Notifications could not be enabled."));
    } catch {
      setPushMessage("Notifications could not be enabled on this build.");
    } finally {
      setEnablingPush(false);
    }
  };

  const combined = [...serverInvites, ...notifications]
    .sort((a, b) => b.timestamp - a.timestamp);
  const visible =
    activeTab === "All"
      ? combined
      : combined.filter(
          (n) => TYPE_META[n.type]?.label === activeTab
        );

  async function handlePress(n: AppNotification) {
    if (n.type === "trip_invite" && user && n.serverNotificationId) {
      const token = await user.getIdToken();
      const response = await apiFetch("/api/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          notifId: n.serverNotificationId,
          tripId: n.tripId,
          displayName: user.displayName ?? "Traveler",
        }),
      });
      if (response.ok) {
        setServerInvites((current) => current.filter((item) => item.id !== n.id));
        router.push({ pathname: "/trip/[id]", params: { id: n.tripId } } as any);
      }
    } else if (n.type === "accom_vote") {
      router.push({ pathname: "/accommodation-vote/[id]", params: { id: n.tripId } } as any);
    } else if (n.type === "dest_vote") {
      router.push({ pathname: "/destination-vote/[id]", params: { id: n.tripId } } as any);
    } else if (n.type === "itinerary_ready") {
      router.push({ pathname: "/itinerary/[id]", params: { id: n.tripId } } as any);
    } else if (n.type === "chat") {
      router.push({ pathname: "/chat/[id]", params: { id: n.tripId } } as any);
    } else {
      router.push({ pathname: "/trip/[id]", params: { id: n.tripId } } as any);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
      </View>

      {/* Tabs */}
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {TABS.map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[
              styles.tab,
              activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === tab ? colors.foreground : colors.mutedForeground },
                activeTab === tab && { fontFamily: "DmSans_700Bold" },
              ]}
            >
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      {user ? (
        <View style={[styles.pushBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.pushIcon, { backgroundColor: colors.primary + "14" }]}>
            <Feather name={pushEnabled ? "bell" : "bell-off"} size={17} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pushTitle, { color: colors.foreground }]}>
              {pushEnabled ? "Trip alerts are on" : "Get trip alerts"}
            </Text>
            <Text style={[styles.pushBody, { color: colors.mutedForeground }]}>
              {pushEnabled
                ? "Packyo can notify you about voting, itinerary, and chat updates."
                : "See voting, itinerary, and chat updates even when Packyo is closed."}
            </Text>
            {!!pushMessage && <Text style={[styles.pushMessage, { color: colors.mutedForeground }]}>{pushMessage}</Text>}
          </View>
          <Pressable
            onPress={enablePush}
            disabled={enablingPush || pushEnabled}
            style={[
              styles.pushButton,
              { backgroundColor: colors.primary, opacity: pushEnabled ? 0.65 : 1 },
            ]}
          >
            {enablingPush
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.pushButtonText}>{pushEnabled ? "On" : "Enable"}</Text>}
          </Pressable>
        </View>
      ) : null}

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#E85D3A" />
        </View>
      ) : !user ? (
        <View style={styles.center}>
          <Feather name="bell-off" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Sign in to see notifications</Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.center}>
          <Feather name="bell" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All caught up</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            No notifications yet — join or create a trip to get started.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomInset, paddingTop: 4 }}
        >
          {visible.map((n) => {
            const meta = TYPE_META[n.type];
            return (
              <Pressable
                key={n.id}
                onPress={() => handlePress(n)}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: colors.border },
                  pressed && { opacity: 0.7 },
                ]}
              >
                {/* Icon */}
                <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}>
                  <Feather name={meta.icon as any} size={16} color="#fff" />
                </View>

                {/* Content */}
                <View style={styles.content}>
                  <View style={styles.topRow}>
                    <Text style={[styles.noteTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {n.text}
                    </Text>
                    <Text style={[styles.time, { color: colors.mutedForeground }]}>
                      {timeAgo(n.timestamp)}
                    </Text>
                  </View>
                  {n.subtext ? (
                    <Text style={[styles.subtext, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {n.subtext}
                    </Text>
                  ) : null}
                  {/* Trip label chip */}
                  <View style={[styles.tripChip, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.tripChipText, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {n.tripName}
                    </Text>
                  </View>
                  {/* CTA for actionable items */}
                  {n.actionable && (
                    <View style={styles.actions}>
                      <Pressable
                        onPress={() => handlePress(n)}
                        style={[styles.solidBtn, { backgroundColor: colors.primary }]}
                      >
                         <Text style={styles.solidBtnText}>{n.type === "trip_invite" ? "Join trip" : "Vote now"}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>

                {/* Chevron */}
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 16 },
  title: { fontFamily: "DmSans_700Bold", fontSize: 28 },

  tabs: {
    flexDirection: "row",
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pushBanner: { margin: 16, marginBottom: 8, borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: "row", gap: 11, alignItems: "center" },
  pushIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  pushTitle: { fontFamily: "DmSans_700Bold", fontSize: 14 },
  pushBody: { fontFamily: "DmSans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 2 },
  pushMessage: { fontFamily: "DmSans_500Medium", fontSize: 11, marginTop: 4 },
  pushButton: { minWidth: 68, minHeight: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  pushButtonText: { color: "#fff", fontFamily: "DmSans_700Bold", fontSize: 12 },
  tab: { marginRight: 24, paddingVertical: 12 },
  tabText: { fontFamily: "DmSans_500Medium", fontSize: 15 },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: { fontFamily: "DmSans_700Bold", fontSize: 18 },
  emptyBody: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  content: { flex: 1 },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 4,
  },
  noteTitle: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 15,
    flex: 1,
  },
  time: { fontFamily: "DmSans_400Regular", fontSize: 12, flexShrink: 0, paddingTop: 2 },
  subtext: {
    fontFamily: "DmSans_400Regular",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  tripChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
  },
  tripChipText: { fontFamily: "DmSans_500Medium", fontSize: 11 },
  actions: { marginTop: 8 },
  solidBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  solidBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 13, color: "#fff" },
});
