import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-client";
import {
  addPackItem,
  savePackingList,
  togglePackItem,
  usePackingList,
  useTrip,
} from "@/hooks/useFirebase";

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  essentials: { label: "Essentials", color: "#F15A3A" },
  clothing: { label: "Clothing", color: "#68B7A0" },
  toiletries: { label: "Toiletries", color: "#A77BD6" },
  tech: { label: "Tech & Gadgets", color: "#F4BC55" },
  activities: { label: "Activity Gear", color: "#EE9D54" },
  tips: { label: "Pro Tips", color: "#6EA6D8" },
};

const CATEGORY_ORDER = ["essentials", "clothing", "toiletries", "tech", "activities", "tips"];

export default function PackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <PackingListContent id={id} />;
}

interface PackingListContentProps {
  id?: string;
  embedded?: boolean;
}

export function PackingListContent({ id, embedded = false }: PackingListContentProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { trip } = useTrip(id);
  const { packingList, loading } = usePackingList(id);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");
  const [savingItem, setSavingItem] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const handleGenerate = async () => {
    if (!trip || !id) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await apiFetch("/api/packing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: trip.destination,
          days: trip.days,
          vibes: trip.vibes ?? [],
          budget: trip.budget ?? "midrange",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Generation failed. Please try again.");
      }
      const data = await res.json() as { list?: Record<string, unknown> };
      if (!data.list || typeof data.list !== "object" || Object.keys(data.list).length === 0) {
        throw new Error("AI returned an incomplete packing list. Please try again.");
      }
      const cleanList = Object.fromEntries(
        Object.entries(data.list).filter(
          (entry): entry is [string, string[]] =>
            Array.isArray(entry[1]) && entry[1].every((item) => typeof item === "string"),
        ),
      );
      if (Object.keys(cleanList).length === 0) {
        throw new Error("AI returned an incomplete packing list. Please try again.");
      }
      await savePackingList(id, cleanList);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setGenError((e as Error).message || "Failed to generate packing list.");
    } finally {
      setGenerating(false);
    }
  };

  const handleToggle = async (category: string, index: number, checked: boolean) => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await togglePackItem(id, category, index, checked);
  };

  const openAddItem = (category: string) => {
    setAddingToCategory((current) => current === category ? null : category);
    setNewItem("");
    setAddError(null);
  };

  const handleAddItem = async (category: string) => {
    const text = newItem.trim();
    if (!id || !text || savingItem) return;

    setSavingItem(true);
    setAddError(null);
    try {
      await addPackItem(id, category, text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNewItem("");
      setAddingToCategory(null);
    } catch {
      setAddError("Couldn’t add that item. Please try again.");
    } finally {
      setSavingItem(false);
    }
  };

  const totalItems = packingList
    ? Object.entries(packingList)
        .filter(([cat]) => cat !== "tips")
        .reduce((sum, [, items]) => sum + (items?.length ?? 0), 0)
    : 0;

  const checkedItems = packingList
    ? Object.entries(packingList)
        .filter(([cat]) => cat !== "tips")
        .reduce((sum, [, items]) => sum + (items?.filter((i) => i.checked)?.length ?? 0), 0)
    : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {!embedded && (
        <View style={[styles.header, { paddingTop: topInset + 12, backgroundColor: colors.background }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Packing List</Text>
        </View>
      )}
      
      <View style={styles.subHeader}>
        <Text style={[styles.headerDest, { color: colors.foreground }]} numberOfLines={1}>
          {trip?.destination ?? "…"}
        </Text>
        <Text style={[styles.headerMeta, { color: colors.mutedForeground }]}>
          {trip?.days ?? 0} days • {trip?.startDate ? new Date(trip.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : "Dates pending"}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : !packingList ? (
        <View style={styles.center}>
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="package" size={40} color={colors.primary} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No packing list yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Let AI build a smart packing list tailored to {trip?.destination ?? "your trip"} and your vibes.
            </Text>
            {genError && (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{genError}</Text>
            )}
            <Pressable
              onPress={handleGenerate}
              disabled={generating}
              style={[styles.genBtn, { backgroundColor: colors.primary }]}
            >
              {generating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.genBtnText}>Generate packing list</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomInset + (embedded ? 24 : 100) }}
          >
            {CATEGORY_ORDER.filter((cat) => packingList[cat]?.length > 0).map((cat) => {
              const meta = CATEGORY_META[cat] ?? { label: cat, color: colors.mutedForeground };
              const items = packingList[cat] ?? [];
              const isTips = cat === "tips";

              return (
                <View key={cat} style={styles.section}>
                  <View style={[styles.sectionHeader, { backgroundColor: meta.color }]}>
                    <Text style={styles.sectionTitle}>{meta.label}</Text>
                  </View>

                  {items.map((item, idx) => (
                    isTips ? (
                      <View key={idx} style={styles.tipRow}>
                        <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
                          • {typeof item === "string" ? item : item.text}
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        key={idx}
                        onPress={() => handleToggle(cat, idx, !item.checked)}
                        style={styles.itemRow}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            item.checked 
                              ? { backgroundColor: colors.primary, borderColor: colors.primary } 
                              : { borderColor: colors.border },
                          ]}
                        >
                          {item.checked && <Feather name="check" size={14} color="#fff" />}
                        </View>
                        <Text
                          style={[
                            styles.itemText,
                            {
                              color: item.checked ? colors.mutedForeground : colors.foreground,
                              textDecorationLine: item.checked ? "line-through" : "none",
                            },
                          ]}
                        >
                          {item.text}
                        </Text>
                      </Pressable>
                    )
                  ))}

                  {addingToCategory === cat ? (
                    <View style={styles.addItemForm}>
                      <TextInput
                        value={newItem}
                        onChangeText={setNewItem}
                        placeholder={`Add to ${meta.label.toLowerCase()}…`}
                        placeholderTextColor={colors.mutedForeground}
                        style={[styles.addItemInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={() => handleAddItem(cat)}
                        editable={!savingItem}
                      />
                      <Pressable
                        onPress={() => handleAddItem(cat)}
                        disabled={!newItem.trim() || savingItem}
                        style={[styles.addItemConfirm, { backgroundColor: colors.primary, opacity: !newItem.trim() || savingItem ? 0.5 : 1 }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Add item to ${meta.label}`}
                      >
                        {savingItem ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Feather name="check" size={17} color="#fff" />
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => openAddItem(cat)}
                      style={({ pressed }) => [styles.addItemButton, { borderColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Add an item to ${meta.label}`}
                    >
                      <Feather name="plus" size={16} color={colors.primary} />
                      <Text style={[styles.addItemButtonText, { color: colors.primary }]}>Add item</Text>
                    </Pressable>
                  )}
                  {addingToCategory === cat && addError ? (
                    <Text style={[styles.addError, { color: colors.destructive }]}>{addError}</Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {!embedded && (
            <View style={[styles.bottomCta, { paddingBottom: bottomInset + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
              <Pressable onPress={handleGenerate} disabled={generating} style={[styles.fullBtn, { backgroundColor: colors.primary }]}>
                {generating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.fullBtnText}>View full checklist</Text>
                )}
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 16,
  },
  backBtn: { padding: 4, marginLeft: -4 },
  headerTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 16, flex: 1, textAlign: "center", marginRight: 24 },
  subHeader: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 4,
  },
  headerDest: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 28, letterSpacing: -0.5 },
  headerMeta: { fontFamily: "DmSans_500Medium", fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyCard: {
    width: "100%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 18, marginBottom: 4 },
  emptyText: {
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  errorText: { fontFamily: "DmSans_400Regular", fontSize: 13, textAlign: "center" },
  genBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  genBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
  section: { marginTop: 24 },
  sectionHeader: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 12,
  },
  sectionTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 13, color: "#fff", textTransform: "uppercase", letterSpacing: 1 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  itemText: { fontFamily: "DmSans_500Medium", fontSize: 16, flex: 1 },
  addItemButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginTop: 4,
  },
  addItemButtonText: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  addItemForm: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  addItemInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: "DmSans_400Regular",
    fontSize: 14,
  },
  addItemConfirm: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addError: {
    fontFamily: "DmSans_400Regular",
    fontSize: 12,
    marginTop: 6,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 4,
  },
  tipText: { fontFamily: "DmSans_400Regular", fontSize: 15, flex: 1, lineHeight: 22 },
  bottomCta: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  fullBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  fullBtnText: {
    fontFamily: "DmSans_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
});
