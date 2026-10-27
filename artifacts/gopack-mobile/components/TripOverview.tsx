import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { Activity, Trip, TripMember, Wish } from "@/hooks/useFirebase";

const MEMBER_COLORS = ["#F15A3A", "#F4BC55", "#A77BD6", "#68B7A0", "#EE9D54", "#6EA6D8"];

type MemberWithPhoto = TripMember & { photoURL?: string | null };

function parseTime(t: string): { h: number; m: number } | null {
  const m = t?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3]?.toUpperCase();
  if (min > 59 || h > (ap ? 12 : 23) || (ap && h < 1)) return null;
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { h, m: min };
}

function dayDate(start: string, dayNumber: number): Date {
  const d = new Date(`${start}T00:00:00`);
  d.setDate(d.getDate() + dayNumber - 1);
  return d;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function MemberAvatar({ name, photoURL, index, size = 36 }: { name: string; photoURL?: string | null; index: number; size?: number }) {
  const initials = (name || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  if (photoURL) {
    return <Image source={{ uri: photoURL }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: MEMBER_COLORS[index % MEMBER_COLORS.length], alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#FFFFFF", fontFamily: "DmSans_700Bold", fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

interface Props {
  trip: Trip;
  wishes: Wish[];
  currentUid?: string;
  onOpen: (tab: "itinerary") => void;
}

export function TripOverview({ trip, wishes, currentUid, onOpen }: Props) {
  const colors = useColors();
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const members = useMemo(
    () => Object.entries(trip.members ?? {}).map(([id, m], i) => ({ id, ...(m as MemberWithPhoto), index: i })),
    [trip.members],
  );
  const days = trip.itinerary?.days ?? [];
  // A partially generated itinerary must not shorten the actual booked trip.
  const dayCount = trip.startDate && trip.endDate
    ? Math.max(1, Math.round((new Date(`${trip.endDate}T00:00:00`).getTime() - new Date(`${trip.startDate}T00:00:00`).getTime()) / 86400000) + 1)
    : trip.days || days.length || 0;

  const range = useMemo(() => {
    if (!trip.startDate) return null;
    const start = new Date(`${trip.startDate}T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;
    const end = trip.endDate ? new Date(`${trip.endDate}T23:59:59`) : dayDate(trip.startDate, Math.max(dayCount, 1));
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [trip.startDate, trip.endDate, dayCount]);

  const timeline = useMemo(() => {
    const now = new Date(clock);
    const all = days.flatMap((d) => (d.activities ?? []).map((a) => {
      let at: Date | null = null;
      if (trip.startDate) {
        const base = dayDate(trip.startDate, d.dayNumber);
        const t = parseTime(a.time);
        if (t) { base.setHours(t.h, t.m, 0, 0); at = base; }
        else at = null;
      }
      return { day: d.dayNumber, activity: a, at };
    })).sort((a, b) => a.day - b.day || (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity));
    if (!range) return { status: "undated" as const, items: all.slice(0, 3), now };
    if (now < range.start) return { status: "pre" as const, items: all.slice(0, 3), now };
    if (now > range.end) return { status: "ended" as const, items: [], now };
    const upcoming = all.filter((x) => (x.at ? x.at >= now : dayDate(trip.startDate!, x.day) >= new Date(now.toDateString())));
    return { status: "live" as const, items: upcoming.slice(0, 3), now };
  }, [days, trip.startDate, range, clock]);

  const suggested = useMemo(() => {
    const list: { activity: Activity; day: number; who: string; kind: "wish" | "added" }[] = [];
    days.forEach((d) => (d.activities ?? []).forEach((a) => {
      const provenance = a as Activity & { wishId?: string; wishText?: string };
      const matchedWish = wishes.find(w => (provenance.wishId && w.id === provenance.wishId) ||
        (provenance.wishText && w.text.trim().toLowerCase() === provenance.wishText.trim().toLowerCase()));
      if (a.fromWish) list.push({ activity: a, day: d.dayNumber, who: matchedWish?.authorName || a.suggester || "A pack member", kind: "wish" });
      else if (a.suggester && !/^(ai|ai pick|packyo)$/i.test(a.suggester.trim())) list.push({ activity: a, day: d.dayNumber, who: a.suggester, kind: "added" });
    }));
    return list;
  }, [days, wishes]);

  const totalActivities = days.reduce((s, d) => s + (d.activities?.length ?? 0), 0);
  const daysUntil = range ? Math.ceil((range.start.getTime() - timeline.now.getTime()) / 86400000) : null;

  const statusLine =
    timeline.status === "undated" ? "Dates not set yet"
    : timeline.status === "pre" ? `Starts in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
    : timeline.status === "ended" ? `Wrapped ${fmtDate(range!.end)}`
    : "Happening now";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 14 }} showsVerticalScrollIndicator={false}>
      <View style={[s.hero, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
        <View style={[s.statusPill, { backgroundColor: timeline.status === "live" ? colors.primary : colors.card }]}>
          <Text style={[s.statusText, { color: timeline.status === "live" ? colors.primaryForeground : colors.foreground }]}>{statusLine}</Text>
        </View>
        <Text style={[s.dest, { color: colors.foreground }]} numberOfLines={2}>{trip.destination || "Destination pending"}</Text>
        {trip.itinerary?.title ? <Text style={[s.sub, { color: colors.mutedForeground }]}>{trip.itinerary.title}</Text> : null}
        <View style={s.statsRow}>
          <Stat label="Duration" value={dayCount ? `${dayCount} day${dayCount === 1 ? "" : "s"}` : "Open"} />
          <Stat label="Dates" value={range ? `${range.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${range.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "To confirm"} />
          <Stat label="Budget / person" value={trip.budget ? trip.budget.charAt(0).toUpperCase() + trip.budget.slice(1) : "Not set"} />
        </View>
      </View>

      <Section title="The pack" meta={`${members.length} traveller${members.length === 1 ? "" : "s"}`}>
        {members.map((m) => (
          <View key={m.id} style={[s.row, { borderBottomColor: colors.border }]}>
            <MemberAvatar name={m.name} photoURL={m.photoURL} index={m.index} />
            <Text style={[s.rowTitle, { color: colors.foreground, flex: 1 }]}>{m.name}{m.id === currentUid ? " (You)" : ""}</Text>
            {m.isHost || m.id === trip.hostMemberId ? <Text style={[s.badge, { color: colors.primary, borderColor: colors.primary }]}>Host</Text> : null}
          </View>
        ))}
      </Section>

      {trip.vibes?.length ? (
        <Section title="Vibes">
          <View style={s.chips}>
            {trip.vibes.map((v) => (
              <View key={v} style={[s.chip, { backgroundColor: colors.muted }]}>
                <Text style={[s.chipText, { color: colors.foreground }]}>{v}</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title={timeline.status === "ended" ? "Trip finished" : "Up next"} actionLabel="Full itinerary" onAction={() => onOpen("itinerary")}>
        {timeline.status === "ended" ? (
          <Text style={[s.note, { color: colors.mutedForeground }]}>This trip ended on {fmtDate(range!.end)}. There are no upcoming activities.</Text>
        ) : timeline.items.length === 0 ? (
          <Text style={[s.note, { color: colors.mutedForeground }]}>{totalActivities ? "Nothing else scheduled for the rest of the trip." : "No activities planned yet."}</Text>
        ) : (
          <>
            {timeline.status === "undated" ? <Text style={[s.note, { color: colors.mutedForeground }]}>Showing the start of the plan. Set trip dates to see real times.</Text> : null}
            {timeline.items.map(({ day, activity, at }, i) => (
              <View key={`${day}-${i}`} style={[s.row, { borderBottomColor: colors.border }]}>
                <View style={[s.iconBox, { backgroundColor: colors.muted }]}>
                  <Feather name="clock" size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{activity.name}</Text>
                  <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
                    Day {day}{at ? ` · ${at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}` : ""}{activity.time ? ` · ${activity.time}` : ""}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </Section>

      <Section title="Who suggested what" meta={`${suggested.length} of ${totalActivities}`}>
        {suggested.length === 0 ? (
          <Text style={[s.note, { color: colors.mutedForeground }]}>Every activity so far came from the planner. Add wishes to put your mark on the trip.</Text>
        ) : suggested.slice(0, 8).map(({ activity, day, who, kind }, i) => (
          <View key={`${day}-${i}`} style={[s.row, { borderBottomColor: colors.border }]}>
            <View style={[s.iconBox, { backgroundColor: kind === "wish" ? "#FFF3D6" : colors.muted }]}>
              <Feather name={kind === "wish" ? "star" : "plus"} size={16} color={kind === "wish" ? "#C98A12" : colors.foreground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{activity.name}</Text>
              <Text style={[s.rowSub, { color: colors.mutedForeground }]}>{kind === "wish" ? `${who}'s wish` : `Added by ${who}`} · Day {day}</Text>
            </View>
          </View>
        ))}
        {wishes.length ? (
          <Text style={[s.note, { color: colors.mutedForeground, marginTop: 8 }]}>
            {wishes.length} wish{wishes.length === 1 ? "" : "es"} on the board from {new Set(wishes.map((w) => w.authorId)).size} member{new Set(wishes.map((w) => w.authorId)).size === 1 ? "" : "s"}.
          </Text>
        ) : null}
      </Section>

    </ScrollView>
  );

  function Stat({ label, value }: { label: string; value: string }) {
    return (
      <View style={{ flex: 1 }}>
        <Text style={[s.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[s.statValue, { color: colors.foreground }]} numberOfLines={2}>{value}</Text>
      </View>
    );
  }

  function Section({ title, meta, actionLabel, onAction, children }: { title: string; meta?: string; actionLabel?: string; onAction?: () => void; children: React.ReactNode }) {
    return (
      <View style={[s.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={s.sectionHead}>
          <Text style={[s.sectionTitle, { color: colors.foreground }]}>{title}</Text>
          {meta ? <Text style={[s.rowSub, { color: colors.mutedForeground }]}>{meta}</Text> : null}
          {actionLabel ? (
            <Pressable onPress={onAction} hitSlop={8}>
              <Text style={[s.action, { color: colors.primary }]}>{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
        {children}
      </View>
    );
  }
}

const s = StyleSheet.create({
  hero: { borderRadius: 20, padding: 18, borderWidth: 1, gap: 6 },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontFamily: "DmSans_600SemiBold", fontSize: 12 },
  dest: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 28, marginTop: 4 },
  sub: { fontFamily: "DmSans_400Regular", fontSize: 14 },
  statsRow: { flexDirection: "row", gap: 12, marginTop: 12 },
  statLabel: { fontFamily: "DmSans_500Medium", fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase" },
  statValue: { fontFamily: "DmSans_600SemiBold", fontSize: 14, marginTop: 2 },
  section: { borderRadius: 18, borderWidth: 1, padding: 16 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 },
  sectionTitle: { fontFamily: "DmSans_700Bold", fontSize: 17, flex: 1 },
  action: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  rowSub: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 2 },
  badge: { fontFamily: "DmSans_600SemiBold", fontSize: 11, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontFamily: "DmSans_500Medium", fontSize: 13, textTransform: "capitalize" },
  note: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 19 },
  iconBox: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
