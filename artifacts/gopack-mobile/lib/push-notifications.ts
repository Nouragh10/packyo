import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiFetch } from "@/lib/api-client";
import { auth, db, ref, set } from "@/lib/firebase";

const TOKEN_CACHE_KEY = "packyo:expo-push-token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function tokenKey(token: string): string {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(index)) | 0;
  }
  return `expo_${Math.abs(hash)}`;
}

export async function registerForPushNotifications(uid: string): Promise<{
  granted: boolean;
  reason?: string;
}> {
  if (Platform.OS === "web") {
    return { granted: false, reason: "Push notifications are available in the Packyo mobile app." };
  }
  if (!Device.isDevice) {
    return { granted: false, reason: "Push notifications require a physical device." };
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === "granted"
    ? current
    : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") {
    return { granted: false, reason: "Notifications are disabled. You can enable them in iPhone Settings." };
  }

  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  if (!projectId) {
    return { granted: false, reason: "This build is missing its notification project ID." };
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await set(ref(db, `userTrips/${uid}/pushTokens/${tokenKey(token)}`), {
    token,
    platform: Platform.OS,
    updatedAt: Date.now(),
  });
  await AsyncStorage.setItem(TOKEN_CACHE_KEY, token);
  return { granted: true };
}

export async function hasRegisteredPushToken(): Promise<boolean> {
  if (Platform.OS === "web" || !Device.isDevice) return false;

  const [cachedToken, permission] = await Promise.all([
    AsyncStorage.getItem(TOKEN_CACHE_KEY),
    Notifications.getPermissionsAsync(),
  ]);

  return !!cachedToken && permission.status === "granted";
}

export async function sendTripPush(
  tripId: string,
  title: string,
  body: string,
  path: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const idToken = await user.getIdToken();
  await apiFetch("/api/send-trip-push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ tripId, title, body, path }),
  }).catch(() => undefined);
}