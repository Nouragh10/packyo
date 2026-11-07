import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { WikiImage } from "@/components/WikiImage";

const TAG_COLORS: Record<string, string> = {
  food: "#F15A3A",
  dining: "#F15A3A",
  culture: "#9C5544",
  museum: "#9C5544",
  art: "#9C5544",
  adventure: "#4CAF50",
  outdoor: "#4CAF50",
  nature: "#26A69A",
  transport: "#42A5F5",
  relaxation: "#7E6FCF",
  wellness: "#7E6FCF",
  nightlife: "#EC4899",
  shopping: "#F59E0B",
  beach: "#06B6D4",
};

export default function ActivityDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const params = useLocalSearchParams<{
    name: string;
    description: string;
    time: string;
    tag: string;
    estimatedCost: string;
    photoQuery: string;
    lat: string;
    lng: string;
    city: string;
    fromWish: string;
    suggester: string;
    matchedVibe: string;
    labels: string;
    fallbackIndex: string;
  }>();

  const {
    name = "",
    description = "",
    time = "",
    tag = "",
    photoQuery = "",
    city = "",
    fromWish,
    suggester = "",
    matchedVibe = "",
  } = params;

  const fallbackIndex = Number.isFinite(Number(params.fallbackIndex))
    ? Number(params.fallbackIndex)
    : 0;
  const cost = parseFloat(params.estimatedCost ?? "0");
  const labels: string[] = JSON.parse(params.labels ?? "[]");
  const isFromWish = fromWish === "true";
  const latNum = parseFloat(params.lat ?? "");
  const lngNum = parseFloat(params.lng ?? "");
  const hasCoords = !isNaN(latNum) && !isNaN(lngNum) && latNum !== 0;

  const tagColor = TAG_COLORS[tag.toLowerCase()] ?? colors.primary;

  const openInMaps = async () => {
    await Haptics.selectionAsync();
    const nameQuery = encodeURIComponent(`${name}${city ? ` ${city}` : ""}`);
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${nameQuery}`;
    if (Platform.OS === "web") {
      window.open(webUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const googleUrl = hasCoords
      ? `comgooglemaps://?q=${encodeURIComponent(name)}&center=${latNum},${lngNum}`
      : `comgooglemaps://?q=${nameQuery}`;
    const canOpenGoogle = await Linking.canOpenURL(googleUrl).catch(() => false);
    await Linking.openURL(canOpenGoogle ? googleUrl : webUrl).catch(() => undefined);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Hero photo */}
      <View style={styles.heroContainer}>
        <WikiImage
          name={name}
          context={city}
          query={photoQuery || `${name} ${city}`.trim()}
          fallbackCategory={tag}
          fallbackIndex={fallbackIndex}
          style={styles.heroImage}
          resizeMode="cover"
          placeholderColor="#D1D5DB"
        />
        {/* Gradient overlay so back button is always readable */}
        <View style={styles.heroOverlay} />

        {/* Back button */}
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { top: insets.top + 8 }]}
        >
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>

        {/* Time pill */}
        <View style={[styles.timePill, { bottom: 16, left: 20 }]}>
          <Feather name="clock" size={12} color="#fff" />
          <Text style={styles.timePillText}>{time}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Info card */}
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Title row */}
          <View style={styles.titleRow}>
            <Text style={[styles.activityName, { color: colors.foreground }]}>{name}</Text>
            {labels.length > 0 && (
              <View style={[styles.labelChip, { backgroundColor: tagColor + "20" }]}>
                <Text style={[styles.labelChipText, { color: tagColor }]}>{labels[0]}</Text>
              </View>
            )}
          </View>

          {/* Attribution */}
          {isFromWish ? (
            <View style={styles.badge}>
              <Feather name="star" size={12} color="#F59E0B" />
              <Text style={styles.badgeText}>{suggester}'s wish</Text>
            </View>
          ) : (
            <View style={[styles.badge, styles.aiBadge]}>
              <Feather name="zap" size={12} color="#6B7280" />
              <Text style={[styles.badgeText, { color: "#6B7280" }]}>Packyo AI pick</Text>
            </View>
          )}

          {/* Description */}
          <Text style={[styles.description, { color: colors.foreground }]}>{description}</Text>

          {/* Chips row */}
          <View style={styles.chipsRow}>
            <View style={[styles.chip, { backgroundColor: tagColor + "15", borderColor: tagColor + "40" }]}>
              <Feather name="tag" size={12} color={tagColor} />
              <Text style={[styles.chipText, { color: tagColor }]}>{tag}</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="dollar-sign" size={12} color={colors.foreground} />
              <Text style={[styles.chipText, { color: colors.foreground }]}>
                {!Number.isFinite(cost) ? "Estimate unavailable" : cost === 0 ? "No entry fee" : `~$${cost} / person`}
              </Text>
            </View>
            {matchedVibe ? (
              <View style={[styles.chip, { backgroundColor: "#7E6FCF20", borderColor: "#7E6FCF40" }]}>
                <Feather name="heart" size={12} color="#7E6FCF" />
                <Text style={[styles.chipText, { color: "#7E6FCF" }]}>{matchedVibe}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Map card */}
        <Pressable
          onPress={openInMaps}
          style={({ pressed }) => [
            styles.mapCard,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.88 : 1 },
          ]}
        >
          <View style={styles.mapHeader}>
            <Feather name="map-pin" size={15} color={colors.primary} />
            <Text style={[styles.mapHeaderText, { color: colors.foreground }]}>Location</Text>
          </View>

          {/* Decorative map preview */}
          <View style={[styles.mapCanvas, { backgroundColor: colors.muted }]}>
            {/* Grid lines */}
            {[0.25, 0.5, 0.75].map((f) => (
              <View key={`h${f}`} style={[styles.gridH, { top: `${f * 100}%` as any, backgroundColor: colors.border }]} />
            ))}
            {[0.25, 0.5, 0.75].map((f) => (
              <View key={`v${f}`} style={[styles.gridV, { left: `${f * 100}%` as any, backgroundColor: colors.border }]} />
            ))}
            {/* Street-like blobs */}
            <View style={[styles.streetH, { top: "50%", backgroundColor: colors.background, opacity: 0.7 }]} />
            <View style={[styles.streetV, { left: "40%", backgroundColor: colors.background, opacity: 0.7 }]} />
            {/* Pin */}
            <View style={styles.pinContainer}>
              <View style={[styles.pinDot, { backgroundColor: colors.primary }]} />
              <View style={[styles.pinShadow, { backgroundColor: colors.primary }]} />
            </View>
          </View>

          <View style={[styles.mapFooter, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.mapPlaceName, { color: colors.foreground }]}>{name}</Text>
              <Text style={[styles.mapCityText, { color: colors.mutedForeground }]}>{city}</Text>
            </View>
            <View style={[styles.openMapsBtn, { backgroundColor: colors.primary + "15" }]}>
              <Text style={[styles.openMapsText, { color: colors.primary }]}>Open in Maps</Text>
              <Feather name="external-link" size={12} color={colors.primary} />
            </View>
          </View>
        </Pressable>

        {/* AI tip card */}
        <View style={[styles.tipCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.tipHeader}>
            <View style={[styles.tipIconBg, { backgroundColor: "#E85D3A20" }]}>
              <Feather name="zap" size={14} color="#E85D3A" />
            </View>
            <Text style={[styles.tipTitle, { color: colors.foreground }]}>Packyo tip</Text>
          </View>
          <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
            {!Number.isFinite(cost)
              ? "Check the venue for its current per-person cost before you go."
              : cost === 0
              ? `${name} has no entry fee — no booking needed. Just show up and enjoy!`
              : `Budget around $${cost} per person. Book in advance when possible to avoid waiting.`}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* Hero */
  heroContainer: { width: "100%", height: 280, position: "relative" },
  heroImage: { width: "100%", height: "100%" },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  backBtn: {
    position: "absolute",
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  timePill: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  timePillText: { fontFamily: "DmSans_600SemiBold", fontSize: 12, color: "#fff" },

  /* Scroll */
  scrollContent: { padding: 16, gap: 14 },

  /* Info card */
  infoCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 10,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  activityName: { fontFamily: "DmSans_700Bold", fontSize: 22, flex: 1, lineHeight: 28 },
  labelChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  labelChipText: { fontFamily: "DmSans_600SemiBold", fontSize: 11 },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: "#F59E0B20",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  aiBadge: { backgroundColor: "#6B728015" },
  badgeText: { fontFamily: "DmSans_600SemiBold", fontSize: 12, color: "#F59E0B" },

  description: { fontFamily: "DmSans_400Regular", fontSize: 15, lineHeight: 22 },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { fontFamily: "DmSans_500Medium", fontSize: 12 },

  /* Map card */
  mapCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  mapHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  mapHeaderText: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },
  mapCanvas: { height: 140, position: "relative", overflow: "hidden" },
  gridH: { position: "absolute", left: 0, right: 0, height: 1 },
  gridV: { position: "absolute", top: 0, bottom: 0, width: 1 },
  streetH: { position: "absolute", left: 0, right: 0, height: 10, marginTop: -5 },
  streetV: { position: "absolute", top: 0, bottom: 0, width: 10, marginLeft: -5 },
  pinContainer: {
    position: "absolute",
    top: "50%",
    left: "40%",
    marginTop: -20,
    marginLeft: -8,
    alignItems: "center",
  },
  pinDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: "#fff" },
  pinShadow: { width: 6, height: 4, borderRadius: 3, marginTop: 2, opacity: 0.3 },

  mapFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  mapPlaceName: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },
  mapCityText: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 2 },
  openMapsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
  },
  openMapsText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },

  /* Tip card */
  tipCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  tipHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  tipIconBg: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tipTitle: { fontFamily: "DmSans_700Bold", fontSize: 15 },
  tipText: { fontFamily: "DmSans_400Regular", fontSize: 14, lineHeight: 20 },
});
