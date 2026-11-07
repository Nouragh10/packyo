import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  useFonts,
} from "@expo-google-fonts/dm-sans";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getConfiguredApiBaseUrl, setBaseUrl } from "@/lib/api-client";
import { Stack, usePathname, useRootNavigationState, useRouter, useSegments } from "expo-router";
import { trackScreen } from "@/lib/analytics";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";

setBaseUrl(getConfiguredApiBaseUrl());

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) trackScreen(pathname);
  }, [pathname]);
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!navigationState?.key) return;
    const openResponse = (response: Notifications.NotificationResponse | null) => {
      const path = response?.notification.request.content.data?.path;
      if (typeof path === "string" && path.startsWith("/")) {
        router.push(path as never);
      }
    };
    Notifications.getLastNotificationResponseAsync()
      .then(openResponse)
      .catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    return () => subscription.remove();
  }, [navigationState?.key, router]);

  useEffect(() => {
    // Expo Router has to mount its navigator before a redirect can be issued.
    // Without this guard, web preview can attempt navigation during the first
    // render and crash into the error boundary.
    if (loading || !navigationState?.key) return;
    const firstSegment = segments[0] as string;
    // Expo Router represents the initial "/" route as an empty segment while
    // mounting. Treat it as public alongside the explicit sign-in route.
    const inSignIn = !firstSegment || firstSegment === "sign-in" || firstSegment === "index";
    const needsVerification = !!user && !user.isAnonymous && !user.emailVerified;

    if (!user && !inSignIn) {
      // Not logged in — send to sign-in
      router.replace("/sign-in");
    } else if (needsVerification && !inSignIn) {
      // Unverified email user somehow reached the app — send back to sign-in
      router.replace("/sign-in");
    } else if (user && !needsVerification && inSignIn) {
      // Verified (or guest/Google) user on sign-in screen — let them in
      router.replace("/(tabs)");
    }
  }, [user, loading, segments, navigationState?.key]);

  return (
    <>
      {/* The Stack must mount before useRootNavigationState() receives a key.
          Keeping this navigator mounted avoids a web startup deadlock. */}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="trip/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="building/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="itinerary/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="discover-itinerary/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="packing/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="groups/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="memory/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="join" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      {(loading || !navigationState?.key) && (
        <View
          pointerEvents="none"
          style={{
            ...StyleSheet.absoluteFillObject,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#FCFBF8",
          }}
        >
          <ActivityIndicator color="#F15A3A" size="large" />
        </View>
      )}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DmSans_400Regular: DMSans_400Regular,
    DmSans_500Medium: DMSans_500Medium,
    DmSans_600SemiBold: DMSans_600SemiBold,
    DmSans_700Bold: DMSans_700Bold,
    // Keep the legacy style keys while rendering the new packyo sans-serif
    // typography throughout existing screens.
    PlayfairDisplay_400Regular: DMSans_400Regular,
    PlayfairDisplay_700Bold: DMSans_700Bold,
  });
  // Browser previews can render before remote font restoration finishes.
  // Keep native font gating while avoiding a blank/spinner-only web preview.
  const [startupReady, setStartupReady] = useState(Platform.OS === "web");

  useEffect(() => {
    if (fontsLoaded || fontError) setStartupReady(true);

    // A native simulator can occasionally keep a font request pending.
    // Never leave the app behind the splash screen in that case.
    const timeout = setTimeout(() => setStartupReady(true), 4000);
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (startupReady) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [startupReady]);

  if (!startupReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FCFBF8" }}>
        <ActivityIndicator color="#F15A3A" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <RootLayoutNav />
              </GestureHandlerRootView>
          </QueryClientProvider>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
