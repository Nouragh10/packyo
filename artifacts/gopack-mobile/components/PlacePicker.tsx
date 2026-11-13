import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { flagEmoji, kindLabel, MAX_TRIP_PLACES, searchPlaces, type TripPlace } from "@/lib/places";

type Props = {
  places: TripPlace[];
  onChange: (places: TripPlace[]) => void;
  placeholder?: string;
};

/**
 * Type a place, pick it from the list of real countries/cities/towns. Several
 * places can be added; each shows as a removable chip.
 */
export function PlacePicker({ places, onChange, placeholder }: Props) {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TripPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const full = places.length >= MAX_TRIP_PLACES;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      searchPlaces(q)
        .then((found) => {
          if (id !== requestId.current) return;
          const chosen = new Set(places.map((p) => p.id));
          setResults(found.filter((p) => !chosen.has(p.id)));
          setError(found.length === 0 ? "No places found. Check the spelling." : "");
        })
        .catch((e: unknown) => {
          if (id !== requestId.current) return;
          setResults([]);
          setError(e instanceof Error ? e.message : "Couldn't search places right now.");
        })
        .finally(() => { if (id === requestId.current) setLoading(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, places]);

  const add = (place: TripPlace) => {
    void Haptics.selectionAsync().catch(() => undefined);
    onChange([...places, place]);
    setQuery("");
    setResults([]);
  };

  const remove = (id: string) => onChange(places.filter((p) => p.id !== id));

  return (
    <View style={styles.root}>
      {places.length > 0 && (
        <View style={styles.chips}>
          {places.map((p) => (
            <View key={p.id} style={[styles.chip, { backgroundColor: colors.primary + "14", borderColor: colors.primary }]}>
              <Text style={styles.chipFlag}>{flagEmoji(p.countryCode)}</Text>
              <Text style={[styles.chipText, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
              <Pressable onPress={() => remove(p.id)} hitSlop={10} accessibilityLabel={`Remove ${p.name}`}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {!full && (
        <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: results.length ? colors.primary : colors.border }]}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder={places.length ? "Add another place" : placeholder ?? "Search a country, city or town"}
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
          />
          {loading && <ActivityIndicator size="small" color={colors.primary} />}
          {!loading && query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
              <Feather name="x-circle" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      )}

      {results.length > 0 && (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {results.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => add(p)}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                pressed && { backgroundColor: colors.primary + "10" },
              ]}
            >
              <Text style={styles.rowFlag}>{flagEmoji(p.countryCode)}</Text>
              <View style={styles.rowText}>
                <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {[kindLabel(p.kind), p.label.startsWith(`${p.name}, `) ? p.label.slice(p.name.length + 2) : p.label === p.name ? "" : p.label].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Feather name="plus" size={16} color={colors.primary} />
            </Pressable>
          ))}
        </View>
      )}

      {!!error && results.length === 0 && query.trim().length >= 2 && !loading && (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{error}</Text>
      )}
      {full && (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>Up to {MAX_TRIP_PLACES} places per trip.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%" },
  chipFlag: { fontSize: 14 },
  chipText: { fontFamily: "DmSans_500Medium", fontSize: 14, flexShrink: 1 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 16 },
  input: { flex: 1, fontFamily: "DmSans_400Regular", fontSize: 16 },
  dropdown: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowFlag: { fontSize: 20 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontFamily: "DmSans_500Medium", fontSize: 15 },
  rowSub: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  hint: { fontFamily: "DmSans_400Regular", fontSize: 13 },
});
