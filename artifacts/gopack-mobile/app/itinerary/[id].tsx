import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Calendar from "expo-calendar";
import * as Haptics from "expo-haptics";
import { File, Paths } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import React, { useState, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { PackingListContent } from "../packing/[id]";
import { apiFetch } from "@/lib/api-client";
import { resolveTripDays } from "@/lib/trip-dates";
import {
  Activity,
  ItineraryDay,
  TripMember,
  Wish,
  addActivity,
  updateActivity,
  deleteActivity,
  incrementAiUsage,
  savePack,
  useTrip,
  useWishes,
} from "@/hooks/useFirebase";
import { Mascot } from "@/components/Mascot";
import { WikiImage } from "@/components/WikiImage";
import { TripExpenses } from "@/components/TripExpenses";
import { TripOverview } from "@/components/TripOverview";
import { activityTimeLabel } from "@/lib/activity-time";
import { ItineraryPaywall } from "@/components/ItineraryPaywall";
import { useItineraryAccess } from "@/hooks/useItineraryAccess";

const MEMBER_COLORS = ["#F15A3A", "#F4BC55", "#A77BD6", "#68B7A0", "#EE9D54", "#6EA6D8"];

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
  accommodation: "#7E57C2",
  hotel: "#7E57C2",
  relax: "#AB7ACA",
  wellness: "#AB7ACA",
  nightlife: "#FF7043",
  shopping: "#FFB300",
  beach: "#26C6DA",
};

function getTagColor(tag: string) {
  return TAG_COLORS[tag?.toLowerCase() ?? ""] ?? "#9E9E9E";
}

function getDayDateLabel(startDate: string | null | undefined, dayNumber: number): string {
  if (!startDate) return "";
  try {
    const d = new Date(startDate + "T00:00:00");
    d.setDate(d.getDate() + dayNumber - 1);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function getTripEndDateTime(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  days: number | undefined,
): Date | null {
  const end = endDate
    ? new Date(`${endDate}T23:59:59.999`)
    : startDate
      ? new Date(`${startDate}T00:00:00`)
      : null;
  if (!end || Number.isNaN(end.getTime())) return null;
  if (!endDate) {
    end.setDate(end.getDate() + Math.max(Number(days) || 1, 1) - 1);
  }
  end.setHours(23, 59, 59, 999);
  return end;
}

function parseActivityTime(timeStr: string): { hours: number; minutes: number } | null {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

function getDayDateTime(
  startDate: string | null | undefined,
  dayNumber: number,
  timeStr: string,
): { start: string; end: string } | null {
  if (!startDate) return null;
  try {
    const pad = (n: number) => n.toString().padStart(2, "0");
    const base = new Date(startDate + "T00:00:00");
    base.setDate(base.getDate() + dayNumber - 1);
    const time = parseActivityTime(timeStr);
    if (!time) return null;
    const start = new Date(base);
    start.setHours(time.hours, time.minutes, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 1); // 1-hour event
    const fmt = (d: Date) =>
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    return { start: fmt(start), end: fmt(end) };
  } catch {
    return null;
  }
}

function escapeIcsText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");
}

function formatIcsDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error("The itinerary date is invalid.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function safeExportFileName(value: string | undefined, extension: string): string {
  const stem = (value || "trip")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "trip";
  return `${stem}-itinerary.${extension}`;
}

function printItineraryHtmlOnWeb(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      frame.remove();
      resolve();
    };

    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    frame.style.opacity = "0";

    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) {
        frame.remove();
        reject(new Error("The itinerary print window could not be opened."));
        return;
      }

      printWindow.addEventListener("afterprint", finish, { once: true });
      printWindow.focus();
      printWindow.print();

      // Some browsers do not dispatch afterprint when the dialog is cancelled.
      setTimeout(finish, 60_000);
    };

    document.body.appendChild(frame);
    frame.srcdoc = html;
  });
}

function foldIcsLine(line: string): string[] {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75));
    remaining = remaining.slice(75);
  }
  chunks.push(remaining);
  return chunks.map((chunk, index) => index === 0 ? chunk : ` ${chunk}`);
}

/* ── PDF HTML builder ────────────────────────────────────────────────── */

interface AccomSummary {
  name: string;
  location: string;
  costPerPerson: number;
  type?: string;
}


function buildPremiumItineraryHTML(
  title: string,
  destination: string,
  days: ItineraryDay[],
  members: TripMember[],
  budget: string,
  startDate: string | null | undefined,
  totalCost: number,
  vibes: string[],
  accom?: AccomSummary | null,
): string {
  const escapeHtml = (value: unknown) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  const totalActivities = days.reduce((count, day) => count + day.activities.length, 0);
  const tripTitle = escapeHtml(title || `${destination} itinerary`);
  const tripDestination = escapeHtml(destination || "Your destination");
  const departure = startDate
    ? new Date(`${startDate}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "Dates to be confirmed";
  const generatedOn = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const travelers = members.length ? members : [{ name: "Your Pack" } as TripMember];
  const palette = ["#F45B3D", "#1D9A8A", "#3D6DEB", "#B76E79", "#D89B32", "#7157C8"];

  const memberList = travelers.map((member, index) => {
    const name = escapeHtml(member.name || "Traveller");
    const initial = escapeHtml((member.name || "T").trim().slice(0, 1).toUpperCase());
    return `<div class="traveler">
      <div class="traveler-avatar" style="background:${palette[index % palette.length]}">${initial}</div>
      <span>${name}</span>
    </div>`;
  }).join("");

  const vibeList = (vibes.length ? vibes : ["Shared adventure"]).map((vibe) =>
    `<span class="vibe-chip">${escapeHtml(vibe)}</span>`,
  ).join("");

  const dayPages = days.map((day) => {
    const dayCost = day.activities.reduce((sum, activity) => sum + (activity.estimatedCost ?? 0), 0);
    const activities = day.activities.map((activity, index) => {
      const tag = activity.tag?.trim() || "experience";
      const tagColor = getTagColor(tag);
      const activityNumber = String(index + 1).padStart(2, "0");
      const cost = typeof activity.estimatedCost !== "number" || !Number.isFinite(activity.estimatedCost)
        ? "Estimate unavailable"
        : activity.estimatedCost > 0
        ? `Estimated ${escapeHtml(`$${activity.estimatedCost}`)} per person`
        : "No entry fee";
      return `<article class="activity">
        <div class="activity-index" style="border-color:${tagColor};color:${tagColor}">${activityNumber}</div>
        <div class="activity-main">
          <div class="activity-meta">
            <span class="activity-time">${escapeHtml(activity.time || "Flexible time")}</span>
            <span class="activity-tag">${escapeHtml(tag)}</span>
          </div>
          <h3>${escapeHtml(activity.name || "Activity")}</h3>
          <p>${escapeHtml(activity.description || "A thoughtfully planned stop for your group.")}</p>
        </div>
        <div class="activity-cost">${cost}</div>
      </article>`;
    }).join("");
    return `<section class="day-page">
      <header class="day-heading">
        <div>
          <p class="eyebrow">Day ${String(day.dayNumber).padStart(2, "0")}</p>
          <h2>${escapeHtml(day.city || destination)}</h2>
          <p class="day-theme">${escapeHtml(day.theme || "A day at your own pace")}</p>
        </div>
        <div class="day-total">
          <span>Planned spend</span>
          <strong>${dayCost > 0 ? `~$${dayCost}` : "Flexible"}</strong>
        </div>
      </header>
      <div class="activity-list">${activities || `<p class="empty-day">Space left open for spontaneous discoveries.</p>`}</div>
      <footer class="page-footer">
        <span>PACKYO · ${tripDestination}</span>
        <span>DAY ${String(day.dayNumber).padStart(2, "0")}</span>
      </footer>
    </section>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #F5F2EC; color: #172029; }
body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { position: relative; min-height: 297mm; padding: 20mm; overflow: hidden; background: #172029; color: #F9F7F2; page-break-after: always; }
.cover::before { content: ""; position: absolute; top: -56mm; right: -35mm; width: 160mm; height: 160mm; border-radius: 50%; background: #F45B3D; opacity: .98; }
.cover::after { content: ""; position: absolute; left: -50mm; bottom: -38mm; width: 150mm; height: 150mm; border: 1px solid rgba(255,255,255,.2); border-radius: 50%; }
.cover-grid { position: absolute; inset: 0; opacity: .15; background-image: linear-gradient(rgba(255,255,255,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.25) 1px, transparent 1px); background-size: 16mm 16mm; }
.cover-content { position: relative; z-index: 1; height: 257mm; display: flex; flex-direction: column; }
.wordmark { display: flex; align-items: center; gap: 9px; font-size: 12px; font-weight: 800; letter-spacing: 2.4px; }
.wordmark-mark { width: 12px; height: 12px; border: 3px solid #F45B3D; border-radius: 50%; box-shadow: 8px 0 0 -3px #F45B3D, -8px 0 0 -3px #F45B3D; }
.cover-kicker { margin: auto 0 12px; font-size: 10px; font-weight: 700; letter-spacing: 2.2px; text-transform: uppercase; color: #F6B8A7; }
.cover h1 { max-width: 148mm; margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 48px; line-height: .98; letter-spacing: -1.8px; }
.cover-location { margin-top: 18px; max-width: 100mm; font-size: 17px; color: #C8D1D4; }
.cover-bottom { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,.25); }
.cover-stat span { display: block; font-size: 9px; letter-spacing: 1.6px; text-transform: uppercase; color: #98A9AF; }
.cover-stat strong { display: block; margin-top: 4px; font-size: 20px; color: #FFFDF9; }
.overview { min-height: 297mm; padding: 18mm 20mm; background: #F5F2EC; page-break-after: always; }
.overview-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14mm; border-bottom: 1px solid #D9D3CA; }
.eyebrow { margin: 0 0 5px; color: #F45B3D; font-size: 9px; font-weight: 800; letter-spacing: 1.8px; text-transform: uppercase; }
.overview h2, .day-heading h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 34px; line-height: 1; letter-spacing: -1px; }
.overview-date { max-width: 55mm; padding-top: 3px; color: #5F6A70; font-size: 11px; text-align: right; }
.overview-block { padding: 11mm 0; border-bottom: 1px solid #D9D3CA; }
.overview-label { margin: 0 0 10px; color: #6D777C; font-size: 9px; font-weight: 800; letter-spacing: 1.6px; text-transform: uppercase; }
.travelers { display: flex; flex-wrap: wrap; gap: 10px 20px; }
.traveler { display: flex; align-items: center; gap: 7px; font-weight: 700; }
.traveler-avatar { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; color: white; font-size: 10px; }
.vibe-chip { display: inline-block; margin: 0 7px 7px 0; padding: 7px 11px; border: 1px solid #D9D3CA; border-radius: 999px; color: #344149; font-size: 11px; font-weight: 700; }
.stay-card { display: grid; grid-template-columns: 1fr auto; gap: 12mm; padding: 11mm; background: #E6F1EF; border-left: 4px solid #1D9A8A; }
.stay-card h3 { margin: 3px 0 2px; font-size: 18px; }
.stay-card p { margin: 0; color: #4E6464; }
.stay-price { align-self: center; color: #167B6E; font-size: 17px; font-weight: 800; text-align: right; }
.summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: #D9D3CA; border: 1px solid #D9D3CA; }
.summary-cell { min-height: 34mm; padding: 9mm; background: #FCFBF8; }
.summary-cell span { display: block; color: #6D777C; font-size: 9px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; }
.summary-cell strong { display: block; margin-top: 6px; font-family: Georgia, "Times New Roman", serif; font-size: 28px; }
.day-page { position: relative; min-height: 297mm; padding: 18mm 20mm 18mm; background: #FCFBF8; page-break-after: always; }
.day-heading { display: flex; justify-content: space-between; gap: 12mm; align-items: flex-end; padding-bottom: 10mm; border-bottom: 2px solid #172029; }
.day-theme { margin: 7px 0 0; color: #68747B; font-size: 13px; }
.day-total { min-width: 38mm; padding-bottom: 2px; text-align: right; }
.day-total span { display: block; color: #6D777C; font-size: 8px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; }
.day-total strong { display: block; margin-top: 3px; font-size: 19px; }
.activity-list { padding-top: 6mm; }
.activity { display: grid; grid-template-columns: 15mm 1fr 34mm; gap: 7mm; padding: 8mm 0; border-bottom: 1px solid #E3DED6; page-break-inside: avoid; }
.activity-index { width: 10mm; height: 10mm; display: grid; place-items: center; border: 1.5px solid; border-radius: 50%; font-size: 9px; font-weight: 800; }
.activity-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 3px; }
.activity-time { color: #172029; font-size: 10px; font-weight: 800; }
.activity-tag { color: #6D777C; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
.activity h3 { margin: 0; font-size: 16px; line-height: 1.2; }
.activity p { margin: 4px 0 0; color: #5F6A70; font-size: 11.5px; }
.activity-cost { align-self: center; color: #617177; font-size: 10px; line-height: 1.3; text-align: right; }
.empty-day { padding: 15mm 0; color: #6D777C; font-size: 14px; font-style: italic; }
.page-footer { position: absolute; right: 20mm; bottom: 10mm; left: 20mm; display: flex; justify-content: space-between; color: #879196; font-size: 8px; font-weight: 800; letter-spacing: 1.3px; }
.closing { min-height: 297mm; padding: 20mm; display: flex; flex-direction: column; justify-content: space-between; background: #F45B3D; color: #172029; page-break-after: avoid; }
.closing h2 { max-width: 130mm; margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 42px; line-height: 1; letter-spacing: -1.5px; }
.closing-card { max-width: 110mm; padding-top: 13mm; border-top: 1px solid rgba(23,32,41,.35); }
.closing-card p { margin: 0; font-size: 14px; }
.closing-card strong { display: block; margin-top: 10px; font-size: 22px; }
.closing-footer { display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; letter-spacing: 1.5px; }
</style>
</head>
<body>
  <section class="cover">
    <div class="cover-grid"></div>
    <div class="cover-content">
      <div class="wordmark"><span class="wordmark-mark"></span>PACKYO</div>
      <div>
        <p class="cover-kicker">Group trip field guide</p>
        <h1>${tripTitle}</h1>
        <p class="cover-location">${tripDestination}</p>
      </div>
      <div class="cover-bottom">
        <div class="cover-stat"><span>Departure</span><strong>${escapeHtml(departure)}</strong></div>
        <div class="cover-stat"><span>Duration</span><strong>${days.length} day${days.length === 1 ? "" : "s"}</strong></div>
        <div class="cover-stat"><span>Experiences</span><strong>${totalActivities}</strong></div>
      </div>
    </div>
  </section>
  <section class="overview">
    <header class="overview-header">
      <div><p class="eyebrow">Trip overview</p><h2>${tripDestination}</h2></div>
      <p class="overview-date">${escapeHtml(departure)}</p>
    </header>
    <div class="overview-block"><p class="overview-label">Travelling together</p><div class="travelers">${memberList}</div></div>
    <div class="overview-block"><p class="overview-label">The mood</p><div>${vibeList}</div></div>
    ${accom ? `<div class="overview-block"><p class="overview-label">Home base</p><div class="stay-card"><div><p class="eyebrow">Accommodation</p><h3>${escapeHtml(accom.name)}</h3><p>${escapeHtml(accom.location)}${accom.type ? ` · ${escapeHtml(accom.type)}` : ""}</p></div><div class="stay-price">~$${escapeHtml(accom.costPerPerson)}<br><small>per person</small></div></div></div>` : ""}
    <div class="overview-block"><p class="overview-label">At a glance</p><div class="summary-grid"><div class="summary-cell"><span>Trip budget</span><strong>${escapeHtml(budget)}</strong></div><div class="summary-cell"><span>Estimated plan</span><strong>${totalCost > 0 ? `~$${totalCost}` : "Flexible"}</strong></div></div></div>
  </section>
  ${dayPages}
  <section class="closing">
    <div class="wordmark"><span class="wordmark-mark" style="border-color:#172029;box-shadow:8px 0 0 -3px #172029,-8px 0 0 -3px #172029"></span>PACKYO</div>
    <div><h2>Leave room for the unplanned.</h2><div class="closing-card"><p>This guide is a shared starting point for your ${tripDestination} adventure.</p><strong>Generated ${escapeHtml(generatedOn)}</strong></div></div>
    <div class="closing-footer"><span>PLAN TOGETHER</span><span>PACKYO</span></div>
  </section>
</body>
</html>`;
}

/* ── Activity card ───────────────────────────────────────────────────── */

function getRedoOptions(tag: string): Array<{ label: string; redoType: "same_type" | "whole" }> {
  const sameLabels: Record<string, string> = {
    food: "Change restaurant",
    relaxation: "Change location",
    adventure: "Change location",
    culture: "Change venue",
    nightlife: "Change bar/club",
    shopping: "Change market/shop",
  };
  const opts: Array<{ label: string; redoType: "same_type" | "whole" }> = [];
  if (sameLabels[tag]) opts.push({ label: sameLabels[tag], redoType: "same_type" });
  opts.push({ label: "Redo whole activity", redoType: "whole" });
  return opts;
}

function findRedoActivity(value: unknown, depth = 0): Partial<Activity> | null {
  if (depth > 5 || value === null || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const nestedActivity = findRedoActivity(value[index], depth + 1);
      if (nestedActivity) return nestedActivity;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name === "string" && record.name.trim().length > 0) {
    return record as Partial<Activity>;
  }

  if ("activity" in record) {
    const nestedActivity = findRedoActivity(record.activity, depth + 1);
    if (nestedActivity) return nestedActivity;
  }

  for (const nestedValue of Object.values(record)) {
    const nestedActivity = findRedoActivity(nestedValue, depth + 1);
    if (nestedActivity) return nestedActivity;
  }

  return null;
}

interface ActivityCardProps {
  activity: Activity;
  actIndex: number;
  dayNumber: number;
  dayCity: string;
  destination: string;
  startDate?: string | null;
  colors: any;
  wishes: Wish[];
  onCardPress: () => void;
  onEdit: (act: Activity, idx: number, day: number) => void;
  onRedo: (act: Activity, idx: number, day: number) => void;
  onDelete: (act: Activity, idx: number, day: number) => void;
}

function ActivityCard({
  activity,
  actIndex,
  dayNumber,
  dayCity,
  destination,
  startDate,
  colors,
  wishes,
  onCardPress,
  onEdit,
  onRedo,
  onDelete,
}: ActivityCardProps) {
  // Find the matching wish to get its live vote count
  const matchedWish = activity.fromWish
    ? wishes.find((w) => w.authorName === activity.suggester)
    : null;
  const wishVotes = matchedWish?.score ?? 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.actRow, { opacity: pressed ? 0.85 : 1 }]}
      onPress={onCardPress}
    >
      <Text style={[styles.actTime, { color: colors.foreground }]}>{activityTimeLabel(activity.time)}</Text>
      <View style={styles.actContent}>
        <View style={styles.actHeaderRow}>
          <Text style={[styles.actName, { color: colors.foreground }]}>{activity.name}</Text>
        </View>

        {/* Attribution badge */}
        {activity.fromWish ? (
          <View style={styles.attributionBadge}>
            <Feather name="star" size={11} color="#F59E0B" />
            <Text style={styles.attributionText}>
              {activity.suggester}'s wish
              {wishVotes > 0 ? ` · ↑ ${wishVotes} vote${wishVotes !== 1 ? "s" : ""}` : ""}
            </Text>
          </View>
        ) : activity.suggester && activity.suggester !== "AI pick" ? (
          <View style={[styles.attributionBadge, styles.memberPickBadge]}>
            <Feather name="user" size={11} color="#268B7C" />
            <Text style={[styles.attributionText, { color: "#268B7C" }]}>Added by {activity.suggester}</Text>
          </View>
        ) : (
          <View style={[styles.attributionBadge, styles.aiPickBadge]}>
            <Feather name="zap" size={11} color="#6B7280" />
            <Text style={[styles.attributionText, { color: "#6B7280" }]}>Packyo AI pick</Text>
          </View>
        )}

        <Text style={[styles.actDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
          {activity.description}
        </Text>
        <View style={styles.actActions}>
          <Pressable onPress={(e) => { e.stopPropagation?.(); onEdit(activity, actIndex, dayNumber); }}>
            <Text style={[styles.actionText, { color: colors.mutedForeground }]}>Edit</Text>
          </Pressable>
          <Pressable onPress={(e) => { e.stopPropagation?.(); onRedo(activity, actIndex, dayNumber); }}>
            <Text style={[styles.actionText, { color: colors.mutedForeground }]}>Redo</Text>
          </Pressable>
          <Pressable onPress={(e) => { e.stopPropagation?.(); onDelete(activity, actIndex, dayNumber); }}>
            <Text style={[styles.actionText, { color: colors.destructive }]}>Remove</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

/* ── Edit modal state ────────────────────────────────────────────────── */

interface EditState {
  dayNumber: number;
  actIndex: number | null;
  targetActivity: Activity | null;
  name: string;
  time: string;
  description: string;
  estimatedCost: string;
}

interface MapImportState {
  dayNumber: number;
  link: string;
}

/* ── Screen ──────────────────────────────────────────────────────────── */

export default function ItineraryScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { trip, loading } = useTrip(id);
  const wishes = useWishes(id);
  const unlock = useItineraryAccess(id, user);

  const [activeTab, setActiveTab] = useState<"overview" | "itinerary" | "expenses" | "info" | "map" | "packing">("overview");
  const [editModal, setEditModal] = useState<EditState | null>(null);
  const [addChoiceDay, setAddChoiceDay] = useState<number | null>(null);
  const [mapImport, setMapImport] = useState<MapImportState | null>(null);
  const [mapImporting, setMapImporting] = useState(false);
  const [mapImportError, setMapImportError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [exportingCalendar, setExportingCalendar] = useState(false);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const [pendingExport, setPendingExport] = useState<"calendar" | "pdf" | null>(null);
  const [redoLoading, setRedoLoading] = useState<string | null>(null);
  const [showSavePackModal, setShowSavePackModal] = useState(false);
  const [savePackName, setSavePackName] = useState("");
  const [savePackSaving, setSavePackSaving] = useState(false);
  const [packSavedName, setPackSavedName] = useState<string | null>(null);
  const [savePackError, setSavePackError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareInFlightRef = useRef(false);

  useEffect(() => {
    if (!trip?.itinerary || !user || !id) return;
    const isHost = trip.hostMemberId === user.uid;
    const memberCount = Object.keys(trip.members ?? {}).length;
    if (!isHost || memberCount < 2) return;
    AsyncStorage.getItem(`gopack:packSaved:${id}`).then((val) => {
      if (!val) { setSavePackName(`${trip.destination} Crew`); setShowSavePackModal(true); }
    }).catch(() => {});
  }, [id, user?.uid, !!trip?.itinerary]);

  const handleSavePack = async () => {
    if (!user || !id || !trip) return;
    setSavePackSaving(true);
    setSavePackError(null);
    try {
      const memberObj: Record<string, { name: string }> = {};
      for (const [muid, m] of Object.entries(trip.members ?? {})) {
        memberObj[muid] = { name: (m as any).name ?? "Member" };
      }
      const finalName = savePackName.trim() || `${trip.destination} Crew`;
      await savePack({ hostUid: user.uid, name: finalName, members: memberObj, tripId: id, destination: trip.destination });
      await AsyncStorage.setItem(`gopack:packSaved:${id}`, "1");
      setShowSavePackModal(false);
      setPackSavedName(finalName);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setPackSavedName(null), 3000);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setSavePackError(msg);
      Alert.alert("Save failed", msg);
    }
    setSavePackSaving(false);
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom + 16;
  const tripEnd = getTripEndDateTime(trip?.startDate, trip?.endDate, trip?.days);
  const tripEnded = !!tripEnd && tripEnd.getTime() < Date.now();
  const isMember = !!user && !!trip?.members?.[user.uid];
  const hasReview = !!user && !!(
    trip?.memberReviews?.[user.uid] ||
    (trip?.review as { reviewedBy?: string } | undefined)?.reviewedBy === user.uid
  );

  const handleBack = () => {
    if (returnTo === "tripHub" && id) {
      router.replace({ pathname: "/trip/[id]", params: { id } } as any);
      return;
    }
    router.back();
  };

  const itinerary = trip?.itinerary;
  const selectedTripDays = resolveTripDays(trip?.startDate, trip?.endDate, trip?.days);
  const days = (itinerary?.days ?? []).slice(0, selectedTripDays);
  // Pay-per-itinerary: Day 1 is a free teaser until the group or this member unlocks it.
  const itineraryLocked = !unlock.access?.unlocked;
  const visibleDays = itineraryLocked ? days.slice(0, 1) : days;
  const showEstimatedCosts = trip?.showEstimatedCosts !== false;
  const members = Object.values(trip?.members ?? {});

  const accom = trip?.confirmedAccommodation ?? null;
  const accomCost = accom?.costPerPerson ?? 0;
  const totalCost =
    days.reduce((sum, day) => sum + day.activities.reduce((s, a) => s + (a.estimatedCost ?? 0), 0), 0) +
    accomCost;

  const openGoogleMaps = async (appUrl: string, browserUrl: string) => {
    // comgooglemaps opens the installed Google Maps app. It is deliberately
    // checked first rather than handing every route to the in-app browser.
    try {
      if (Platform.OS !== "web" && await Linking.canOpenURL(appUrl)) {
        await Linking.openURL(appUrl);
        return;
      }
    } catch {
      // Continue to the universally supported browser route below.
    }
    await WebBrowser.openBrowserAsync(browserUrl);
  };

  const handleEdit = (act: Activity, idx: number, dayNum: number) => {
    setEditModal({
      dayNumber: dayNum,
      actIndex: idx,
      targetActivity: act,
      name: act.name,
      time: act.time,
      description: act.description,
      estimatedCost: act.estimatedCost > 0 ? String(act.estimatedCost) : "",
    });
  };

  const handleRedo = async (act: Activity, idx: number, dayNum: number) => {
    const day = days.find((d) => d.dayNumber === dayNum);
    const key = `${dayNum}-${idx}`;
    setRedoLoading(key);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const otherActivities = (day?.activities ?? []).filter((_, i) => i !== idx).map((a) => a.name);
      const allTripActivities = days.flatMap((d) => d.activities.map((a) => a.name)).filter((n) => n !== act.name);
      const redoCity = day?.city?.trim() || trip?.destination?.trim() || "";
      const resp = await apiFetch("/api/redo-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity: act,
          // Older saved itineraries may not have a city on each day. The trip
          // destination remains a reliable fallback and prevents a 400 on iOS.
          city: redoCity,
          theme: day?.theme ?? "",
          destination: trip?.destination ?? "",
          budget: trip?.budget ?? "midrange",
          redoType: "whole",
          otherActivities,
          allTripActivities,
          userId: user?.uid,
          isPlusUser: false,
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(errBody.error ?? "Could not replace activity. Please try again.");
      }
      const responseBody = await resp.json() as unknown;
      // Accept both the current { activity } contract and older nested/array
      // responses during rollout, so TestFlight does not reject a valid redo.
      const newAct = findRedoActivity(responseBody);
      if (!newAct?.name) {
        throw new Error("AI returned an incomplete activity. Please try again.");
      }
      const redoByName = user?.displayName ?? user?.email ?? "A member";
      await updateActivity(id!, dayNum, act, {
        ...newAct,
        time: act.time,
        lastRedoBy: redoByName,
      }, idx);
      incrementAiUsage(id!, "activityRedos").catch(() => {});
    } catch (err) {
      Alert.alert("Could not change activity", (err as Error).message || "Please try again.");
    } finally {
      setRedoLoading(null);
    }
  };

  const handleDelete = async (activity: Activity, activityIndex: number, dayNum: number) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await deleteActivity(id!, dayNum, activity, activityIndex);
    } catch (err) {
      Alert.alert("Delete failed", (err as Error).message || "Could not delete activity. Please try again.");
    }
  };

  const openManualActivity = (dayNumber: number) => {
    setAddChoiceDay(null);
    setEditModal({
      dayNumber,
      actIndex: null,
      targetActivity: null,
      name: "",
      time: "12:00 PM",
      description: "",
      estimatedCost: "",
    });
  };

  const openMapActivity = (dayNumber: number) => {
    setAddChoiceDay(null);
    setMapImportError("");
    setMapImport({ dayNumber, link: "" });
  };

  const handleAddFromMap = async () => {
    if (!mapImport || !id || !trip) return;
    const link = mapImport.link.trim();
    if (!link) {
      setMapImportError("Paste a Google Maps link first.");
      return;
    }
    const day = days.find((item) => item.dayNumber === mapImport.dayNumber);
    setMapImporting(true);
    setMapImportError("");
    try {
      const token = user ? await user.getIdToken() : null;
      if (!token) throw new Error("Sign in before importing a Google Maps place.");
      const response = await apiFetch("/api/parse-map-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tripId: id,
          link,
          destination: trip.destination,
          city: day?.city ?? trip.destination,
          dayNumber: mapImport.dayNumber,
          existingActivities: (day?.activities ?? []).map((activity) => ({
            time: activity.time,
            name: activity.name,
          })),
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        activity?: Partial<Activity>;
        error?: string;
      };
      if (!response.ok || !body.activity?.name) {
        throw new Error(body.error ?? "Packyo could not read that Google Maps place.");
      }
      await addActivity(id, mapImport.dayNumber, {
        ...body.activity,
        fromWish: false,
        suggester: user?.displayName ?? user?.email ?? "Member",
      });
      setMapImport(null);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (caught) {
      setMapImportError(caught instanceof Error ? caught.message : "Could not add that place.");
    } finally {
      setMapImporting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editModal || !id) return;
    if (!editModal.name.trim()) {
      Alert.alert("Name required", "Please enter an activity name.");
      return;
    }
    setSaving(true);
    try {
      const partial: Partial<Activity> = {
        name: editModal.name.trim(),
        time: editModal.time.trim(),
        description: editModal.description.trim(),
        estimatedCost: parseFloat(editModal.estimatedCost) || 0,
      };
      if (editModal.actIndex === null) {
        await addActivity(id, editModal.dayNumber, {
          ...partial,
          suggester: user?.displayName ?? user?.email ?? "Member",
        });
      } else {
        if (!editModal.targetActivity) throw new Error("The selected activity is no longer available.");
        await updateActivity(
          id,
          editModal.dayNumber,
          editModal.targetActivity,
          partial,
          editModal.actIndex,
        );
      }
    } catch (err) {
      Alert.alert("Could not save activity", (err as Error).message || "Please try again.");
    } finally {
      setSaving(false);
      setEditModal(null);
    }
  };

  const handleShare = async () => {
    if (!trip || !itinerary || shareInFlightRef.current) return;
    shareInFlightRef.current = true;
    setSharing(true);
    const lines = [
      itinerary.title,
      `${trip.destination} · ${trip.days} days`,
      "",
      ...visibleDays.flatMap((day) => [
        `── Day ${day.dayNumber}: ${day.city} ──`,
        day.theme,
        ...day.activities.map(
          (a) => `${a.time}  ${a.name}${a.estimatedCost > 0 ? ` (~$${a.estimatedCost})` : ""}`,
        ),
        "",
      ]),
      itineraryLocked && days.length > 1
        ? `+ ${days.length - 1} more day${days.length - 1 === 1 ? "" : "s"}. Unlock the full itinerary in Packyo.`
        : totalCost > 0 ? `Estimated total: ~$${totalCost}/person` : "",
      "Built with packyo ✦",
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join("\n") });
    } catch (caught) {
      const error = caught as Error & { name?: string };
      const isDismissalOrBusy =
        error.name === "AbortError" ||
        error.name === "InvalidStateError" ||
        /earlier share has not yet completed|share canceled|share cancelled/i.test(error.message ?? "");

      if (!isDismissalOrBusy) {
        Alert.alert("Could not share itinerary", error.message || "Please try again.");
      }
    } finally {
      shareInFlightRef.current = false;
      setSharing(false);
    }
  };

  const handleExportCalendar = async () => {
    if (!trip || !itinerary) return;
    setExportingCalendar(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Append T00:00:00 so "YYYY-MM-DD" parses in local time, not UTC —
      // otherwise every event shifts a day earlier in negative-UTC-offset timezones.
      const base = trip.startDate ? new Date(trip.startDate + "T00:00:00") : new Date();

      const parseTime = (dayOffset: number, timeStr: string): Date => {
        const d = new Date(base);
        d.setDate(d.getDate() + dayOffset);
        const match = timeStr?.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (match) {
          let h = parseInt(match[1]);
          const m = parseInt(match[2] ?? "0");
          const period = match[3]?.toLowerCase();
          if (period === "pm" && h < 12) h += 12;
          if (period === "am" && h === 12) h = 0;
          d.setHours(h, m, 0, 0);
        } else {
          d.setHours(9, 0, 0, 0);
        }
        return d;
      };

      const calendarApiAvailable =
        Platform.OS !== "web"
        && typeof Calendar.isAvailableAsync === "function"
        && await Calendar.isAvailableAsync();
      if (
        calendarApiAvailable
        && typeof Calendar.getCalendarPermissionsAsync === "function"
        && typeof Calendar.requestCalendarPermissionsAsync === "function"
        && typeof Calendar.getCalendarsAsync === "function"
        && typeof Calendar.createEventAsync === "function"
      ) {
        let permission = await Calendar.getCalendarPermissionsAsync();
        if (permission.status !== "granted") {
          permission = await Calendar.requestCalendarPermissionsAsync();
        }
        if (permission.status === "granted") {
          const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
          let targetCalendar = calendars.find((item) => item.allowsModifications);
          if (!targetCalendar && typeof Calendar.getDefaultCalendarAsync === "function") {
            const defaultCalendar = await Calendar.getDefaultCalendarAsync();
            if (defaultCalendar?.allowsModifications) targetCalendar = defaultCalendar;
          }
          if (targetCalendar) {
            const createdEventIds: string[] = [];
            try {
              for (let di = 0; di < days.length; di += 1) {
                const day = days[di];
                for (const act of day.activities) {
                  const start = parseTime((day.dayNumber || di + 1) - 1, act.time || "9:00am");
                  const eventId = await Calendar.createEventAsync(targetCalendar.id, {
                    title: act.name || "Activity",
                    startDate: start,
                    endDate: new Date(start.getTime() + 60 * 60 * 1000),
                    notes: act.description || undefined,
                    location: day.city || trip.destination || undefined,
                  });
                  createdEventIds.push(eventId);
                }
              }
              Alert.alert(
                "Added to calendar",
                `${createdEventIds.length} ${createdEventIds.length === 1 ? "activity was" : "activities were"} added to your iPhone calendar.`,
              );
              return;
            } catch (nativeCalendarError) {
              if (typeof Calendar.deleteEventAsync === "function") {
                await Promise.all(
                  createdEventIds.map((eventId) =>
                    Calendar.deleteEventAsync(eventId).catch(() => undefined),
                  ),
                );
              }
              if (createdEventIds.length > 0) {
                throw nativeCalendarError;
              }
              // If no event was created, continue to the .ics fallback below.
            }
          }
        }
      }

      const lines: string[] = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//Packyo//AI Travel Planner//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        `X-WR-CALNAME:${escapeIcsText(itinerary.title || trip.destination || "Trip")}`,
      ];
      const calendarStamp = formatIcsDateTime(new Date());

      days.forEach((day, di) => {
        day.activities.forEach((act, activityIndex) => {
          const start = parseTime((day.dayNumber || di + 1) - 1, act.time || "9:00am");
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          lines.push(
            "BEGIN:VEVENT",
            `UID:${safeExportFileName(trip.destination, "ics").replace(/\.ics$/, "")}-${day.dayNumber || di + 1}-${activityIndex}@packyo`,
            `DTSTAMP:${calendarStamp}`,
            `DTSTART:${formatIcsDateTime(start)}`,
            `DTEND:${formatIcsDateTime(end)}`,
            "STATUS:CONFIRMED",
            `SUMMARY:${escapeIcsText(act.name || "Activity")}`,
            `DESCRIPTION:${escapeIcsText(act.description || "")}`,
            `LOCATION:${escapeIcsText(day.city || trip.destination || "")}`,
            "END:VEVENT",
          );
        });
      });
      lines.push("END:VCALENDAR");
      const icsContent = lines.flatMap(foldIcsLine).join("\r\n") + "\r\n";

      if (Platform.OS === "web") {
        const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(trip.destination || "trip").replace(/\s+/g, "-").toLowerCase()}-itinerary.ics`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const baseFileName = safeExportFileName(trip.destination, "ics").replace(/\.ics$/, "");
        const calendarFile = new File(Paths.cache, `${baseFileName}-${Date.now()}.ics`);
        calendarFile.write(icsContent);
        if (!calendarFile.exists) throw new Error("The calendar file could not be created.");
        const fileUri = calendarFile.uri;

        const canShare = typeof Sharing.isAvailableAsync === "function" && await Sharing.isAvailableAsync();
        if (canShare) {
          const shareOptions = {
            mimeType: "text/calendar",
            dialogTitle: `${trip.destination} Calendar`,
            UTI: "com.apple.ical.ics",
          };
          try {
            await Sharing.shareAsync(fileUri, shareOptions);
          } catch (sharingError) {
            if (Platform.OS !== "ios") throw sharingError;
            // Some iOS share extensions reject calendar UTI declarations.
            // The native Share sheet still exposes Save to Files and open-in
            // options for the verified .ics file.
            await Share.share({ url: fileUri, title: `${trip.destination} Calendar` });
          }
        } else {
          Alert.alert("Calendar file ready", "Your itinerary .ics file is ready. Save it to Files, then tap it to import the events into Calendar.");
        }
      }
    } catch (err) {
      Alert.alert("Calendar export failed", err instanceof Error ? err.message : "Could not generate calendar file. Please try again.");
    } finally {
      setExportingCalendar(false);
    }
  };

  const handleExportPDF = async () => {
    if (!trip || !itinerary) return;
    setExportingPDF(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const html = buildPremiumItineraryHTML(
        itinerary.title,
        trip.destination,
        days,
        members,
        trip.budget ?? "midrange",
        trip.startDate,
        totalCost,
        trip.vibes ?? [],
        accom,
      );
      if (Platform.OS === "web") {
        await printItineraryHtmlOnWeb(html);
        return;
      }
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const baseFileName = safeExportFileName(trip.destination, "pdf").replace(/\.pdf$/, "");
      const exportDirectory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!exportDirectory) throw new Error("No local file directory is available.");
      const fileUri = `${exportDirectory}${baseFileName}-${Date.now()}.pdf`;
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
      await FileSystem.copyAsync({ from: uri, to: fileUri });
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) throw new Error("The PDF file could not be created.");
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        try {
          await Sharing.shareAsync(fileUri, {
            mimeType: "application/pdf",
            dialogTitle: `${trip.destination} Itinerary`,
            UTI: "com.adobe.pdf",
          });
        } catch (sharingError) {
          if (Platform.OS !== "ios") throw sharingError;
          await Share.share({ url: fileUri, title: `${trip.destination} Itinerary` });
        }
      } else {
        await Print.printAsync({ html });
      }
    } catch (err) {
      Alert.alert("PDF export failed", err instanceof Error ? err.message : "Could not generate PDF. Please try again.");
    } finally {
      setExportingPDF(false);
    }
  };

  const handleExportSheetDismiss = () => {
    const exportType = pendingExport;
    if (!exportType) return;
    setPendingExport(null);
    setTimeout(() => {
      if (exportType === "calendar") handleExportCalendar();
      else handleExportPDF();
    }, 50);
  };

  const requestExport = (exportType: "calendar" | "pdf") => {
    setPendingExport(exportType);
    setShowExportSheet(false);

    // React Native's onDismiss is the reliable iOS signal that a native modal
    // has finished closing. React Native Web does not emit it consistently.
    if (Platform.OS === "web") {
      setTimeout(() => {
        setPendingExport(null);
        if (exportType === "calendar") handleExportCalendar();
        else handleExportPDF();
      }, 0);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading itinerary…</Text>
      </View>
    );
  }

  if (!trip || !itinerary) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Mascot name="map-mate" size={130} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground, marginTop: 8 }]}>No itinerary yet.</Text>
        <Pressable onPress={handleBack} style={[styles.backLink, { borderColor: colors.border }]}>
          <Text style={[styles.backLinkText, { color: colors.foreground }]}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={handleBack} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Itinerary</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.headerTabs}
          contentContainerStyle={styles.headerTabsContent}
        >
          {(["overview", "itinerary", "info", "map", "packing", "expenses"] as const).map((t) => {
            const isActive = activeTab === t;
            return (
              <Pressable
                key={t}
                style={[styles.headerTab, isActive && { borderBottomColor: colors.foreground }]}
                onPress={() => setActiveTab(t)}
              >
                <Text style={[
                  styles.headerTabText,
                  isActive
                    ? { color: colors.foreground, fontFamily: "DmSans_600SemiBold" }
                    : { color: colors.mutedForeground },
                ]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.headerTab, sharing && { opacity: 0.5 }]}
            onPress={handleShare}
            disabled={sharing}
          >
            <Text style={[styles.headerTabText, { color: colors.mutedForeground }]}>
              {sharing ? "Sharing…" : "Share"}
            </Text>
          </Pressable>
          <Pressable
            style={styles.headerTab}
            onPress={() => {
              Haptics.selectionAsync();
              // Exports include every day, so they come with the unlock.
              if (itineraryLocked && days.length > 1) { setActiveTab("itinerary"); return; }
              setShowExportSheet(true);
            }}
          >
            <Text style={[styles.headerTabText, { color: colors.mutedForeground }]}>Export</Text>
          </Pressable>
          <Pressable style={styles.headerTab} onPress={() => router.push(`/chat/${id}`)}>
            <Text style={[styles.headerTabText, { color: colors.mutedForeground }]}>Chat</Text>
          </Pressable>
          <Pressable
            style={styles.headerTab}
            onPress={() => {
              setSavePackName(`${trip.destination} Crew`);
              setShowSavePackModal(true);
              Haptics.selectionAsync();
            }}
          >
            <Text style={[styles.headerTabText, { color: colors.primary }]}>Save</Text>
          </Pressable>
        </ScrollView>
      </View>

      {activeTab === "packing" && (
        <View style={{ flex: 1 }}>
          <PackingListContent id={id} embedded />
        </View>
      )}

      {activeTab === "overview" && (
        <TripOverview trip={itineraryLocked && trip.itinerary ? { ...trip, itinerary: { ...trip.itinerary, days: visibleDays } } : trip} wishes={wishes} currentUid={user?.uid} onOpen={(t) => setActiveTab(t)} />
      )}

      {activeTab === "expenses" && id && (
        <TripExpenses trip={trip} tripId={id} />
      )}

      {/* ── INFO TAB ── */}
      {activeTab === "info" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottomInset + 24 }}
        >
          <Text style={[styles.titleDest, { color: colors.foreground, marginBottom: 16 }]}>{trip.destination}</Text>
          {(() => {
            let fallbackIndex = 0;
            return visibleDays.flatMap((day) =>
            day.activities.map((act, i) => {
              const photoQ = act.photoQuery ?? `${act.name} ${trip.destination}`;
              const currentFallbackIndex = fallbackIndex++;
              return (
                <Pressable
                  key={`${day.dayNumber}-${i}`}
                  onPress={() => router.push({
                    pathname: "/activity-detail",
                    params: {
                      name: act.name, description: act.description, time: act.time,
                      tag: act.tag, estimatedCost: String(act.estimatedCost),
                      photoQuery: photoQ, fallbackIndex: String(currentFallbackIndex),
                      lat: String(act.lat ?? ""), lng: String(act.lng ?? ""),
                      city: day.city, fromWish: String(act.fromWish), suggester: act.suggester,
                      matchedVibe: act.matchedVibe ?? "", labels: JSON.stringify(act.labels ?? []),
                    },
                  })}
                  style={({ pressed }) => [styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.88 : 1 }]}
                >
                  <WikiImage
                    name={act.name}
                    context={trip.destination}
                    query={photoQ}
                    fallbackCategory={act.tag}
                    fallbackIndex={currentFallbackIndex}
                    style={styles.infoCardPhoto}
                  />
                  <View style={styles.infoCardBody}>
                    <Text style={[styles.infoCardDay, { color: colors.mutedForeground }]}>Day {day.dayNumber} · {act.time}</Text>
                    <Text style={[styles.infoCardName, { color: colors.foreground }]} numberOfLines={2}>{act.name}</Text>
                    <Text style={[styles.infoCardDesc, { color: colors.mutedForeground }]} numberOfLines={3}>{act.description}</Text>
                    <View style={styles.infoCardFooter}>
                      {showEstimatedCosts ? (
                        <View style={[styles.infoChip, { backgroundColor: colors.muted }]}>
                          <Feather name="dollar-sign" size={11} color={colors.mutedForeground} />
                          <Text style={[styles.infoChipText, { color: colors.mutedForeground }]}>
                            {typeof act.estimatedCost !== "number" || !Number.isFinite(act.estimatedCost) ? "Estimate unavailable" : act.estimatedCost === 0 ? "No entry fee" : `~$${act.estimatedCost}`}
                          </Text>
                        </View>
                      ) : null}
                      {act.fromWish && (
                        <View style={[styles.infoChip, { backgroundColor: "#F59E0B15" }]}>
                          <Feather name="star" size={11} color="#F59E0B" />
                          <Text style={[styles.infoChipText, { color: "#F59E0B" }]}>{act.suggester}'s wish</Text>
                        </View>
                      )}
                      <Feather name="chevron-right" size={14} color={colors.mutedForeground} style={{ marginLeft: "auto" }} />
                    </View>
                  </View>
                </Pressable>
              );
            })
            );
          })()}
          {itineraryLocked && days.length > 1 && (
            <Pressable
              testID="info-locked"
              onPress={() => setActiveTab("itinerary")}
              style={({ pressed }) => [styles.infoCard, { backgroundColor: colors.card, borderColor: colors.primary, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.88 : 1 }]}
            >
              <Feather name="lock" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoCardName, { color: colors.foreground }]}>
                  {days.slice(1).reduce((n, d) => n + d.activities.length, 0)} more activities on Days 2–{days.length}
                </Text>
                <Text style={[styles.infoCardDesc, { color: colors.mutedForeground }]}>Unlock the full trip to see every place, time, and price.</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* ── MAP TAB ── */}
      {activeTab === "map" && (() => {
        const allActs = visibleDays.flatMap((d) => d.activities.map((a) => ({ name: a.name, city: d.city, lat: a.lat, lng: a.lng })));
        const locationText = (place: { name: string; city: string; lat?: number; lng?: number }) =>
          (place.lat && place.lng && place.lat !== 0) ? `${place.lat},${place.lng}` : `${place.name} ${place.city}`;
        const buildRouteUrl = () => {
          if (allActs.length === 0) return `https://maps.google.com/?q=${encodeURIComponent(trip.destination)}`;
          const stops = allActs.map((a) =>
            encodeURIComponent(locationText(a))
          );
          if (stops.length === 1) return `https://www.google.com/maps/search/?api=1&query=${stops[0]}`;
          return `https://www.google.com/maps/dir/${stops.join("/")}`;
        };
        const buildGoogleMapsAppUrl = (places: typeof allActs) => {
          const destinations = places.map(locationText);
          if (!destinations.length) return `comgooglemaps://?q=${encodeURIComponent(trip.destination)}`;
          if (destinations.length === 1) return `comgooglemaps://?q=${encodeURIComponent(destinations[0])}`;
          return `comgooglemaps://?daddr=${encodeURIComponent(destinations.join("+to:"))}&directionsmode=driving`;
        };
        return (
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomInset + 24 }}
          >
            {/* Hero CTA */}
            <Pressable
              onPress={() => openGoogleMaps(buildGoogleMapsAppUrl(allActs), buildRouteUrl())}
              style={[styles.mapHeroCard, { backgroundColor: colors.primary }]}
            >
              <View style={styles.mapHeroIconBg}>
                <Feather name="map" size={36} color="#fff" />
              </View>
              <Text style={styles.mapHeroTitle}>View Full Route</Text>
              <Text style={styles.mapHeroSub}>
                {allActs.length} stops · {days.length} day{days.length !== 1 ? "s" : ""} · {trip.destination}
              </Text>
              <View style={styles.mapHeroBtn}>
                <Feather name="external-link" size={14} color={colors.primary} />
                <Text style={[styles.mapHeroBtnText, { color: colors.primary }]}>Open in Google Maps</Text>
              </View>
            </Pressable>

            {/* Per-day stops */}
            {visibleDays.map((day) => (
              <View key={day.dayNumber} style={[styles.mapDayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.mapDayHeader}>
                  <View style={[styles.mapDayBadge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.mapDayBadgeText}>{day.dayNumber}</Text>
                  </View>
                  <View>
                    <Text style={[styles.mapDayLabel, { color: colors.mutedForeground }]}>Day {day.dayNumber}</Text>
                    <Text style={[styles.mapDayCity, { color: colors.foreground }]}>{day.city}</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      const places = day.activities.map((a) => ({ name: a.name, city: day.city, lat: a.lat, lng: a.lng }));
                      const stops = places.map((place) => encodeURIComponent(locationText(place)));
                      const browserUrl = stops.length <= 1
                        ? `https://www.google.com/maps/search/?api=1&query=${stops[0] ?? encodeURIComponent(day.city)}`
                        : `https://www.google.com/maps/dir/${stops.join("/")}`;
                      void openGoogleMaps(buildGoogleMapsAppUrl(places), browserUrl);
                    }}
                    style={[styles.mapDayOpenBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  >
                    <Feather name="map-pin" size={12} color={colors.primary} />
                    <Text style={[styles.mapDayOpenText, { color: colors.primary }]}>Day route</Text>
                  </Pressable>
                </View>
                {day.activities.map((act, i) => (
                  <View key={i} style={[styles.mapStopRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                    <View style={[styles.mapStopDot, { backgroundColor: i === 0 ? colors.primary : colors.border }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.mapStopTime, { color: colors.mutedForeground }]}>{act.time}</Text>
                      <Text style={[styles.mapStopName, { color: colors.foreground }]}>{act.name}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        );
      })()}

      {/* ── ITINERARY TAB ── */}
      {activeTab === "itinerary" && <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomInset + 24 }}
      >
        <View style={styles.titleRow}>
          <Text style={[styles.titleDest, { color: colors.foreground }]}>{trip.destination}</Text>
        </View>

        {tripEnded && isMember ? (
          <Pressable
            testID="itinerary-memory-guide"
            onPress={() => router.push(hasReview ? `/memory/${id}` : `/review/${id}`)}
            style={[styles.memoryBanner, { backgroundColor: colors.primary }]}
          >
            <Feather name={hasReview ? "book-open" : "camera"} size={17} color="#fff" />
            <Text style={styles.memoryBannerText}>
              {hasReview ? "Open your trip memory guide" : "Rate the trip, add photos, and make a memory guide"}
            </Text>
            <Feather name="chevron-right" size={17} color="#fff" />
          </Pressable>
        ) : null}

        {visibleDays.map((day, dayIndex) => (
          <View key={day.dayNumber} style={styles.dayBlock}>
            <View style={styles.dayHeader}>
              <Text style={[styles.dayMeta, { color: colors.mutedForeground }]}>
                Day {day.dayNumber}{getDayDateLabel(trip.startDate, day.dayNumber) ? ` • ${getDayDateLabel(trip.startDate, day.dayNumber)}` : ""}
              </Text>
              <Text style={[styles.dayCity, { color: colors.foreground }]}>{day.city}</Text>
            </View>

            <View style={styles.dayActivities}>
              {day.activities.map((act, i) => (
                <View key={i}>
                  <ActivityCard
                    activity={act}
                    actIndex={i}
                    dayNumber={day.dayNumber}
                    dayCity={day.city}
                    destination={trip.destination}
                    startDate={trip.startDate}
                    colors={colors}
                    wishes={wishes}
                    onCardPress={() => router.push({
                      pathname: "/activity-detail",
                      params: {
                        name: act.name,
                        description: act.description,
                        time: act.time,
                        tag: act.tag,
                        estimatedCost: String(act.estimatedCost),
                        photoQuery: act.photoQuery ?? `${act.name} ${trip.destination}`,
                         fallbackIndex: String(
                           days.slice(0, dayIndex).reduce((total, priorDay) => total + priorDay.activities.length, 0) + i,
                         ),
                        lat: String(act.lat ?? ""),
                        lng: String(act.lng ?? ""),
                        city: day.city,
                        fromWish: String(act.fromWish),
                        suggester: act.suggester,
                        matchedVibe: act.matchedVibe ?? "",
                        labels: JSON.stringify(act.labels ?? []),
                      },
                    })}
                    onEdit={handleEdit}
                    onRedo={handleRedo}
                    onDelete={handleDelete}
                  />
                  {redoLoading === `${day.dayNumber}-${i}` && (
                    <View style={{ alignItems: "center", padding: 8 }}>
                      <ActivityIndicator color={colors.primary} size="small" />
                    </View>
                  )}
                </View>
              ))}
              <Pressable
                onPress={() => setAddChoiceDay(day.dayNumber)}
                testID={`add-activity-day-${day.dayNumber}`}
                style={styles.addActBtn}
              >
                <Feather name="plus" size={14} color={colors.mutedForeground} />
                <Text style={[styles.addActText, { color: colors.mutedForeground }]}>Add activity</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {itineraryLocked && days.length > 1 && (unlock.access ? (
          <ItineraryPaywall
            lockedDays={days.slice(1).map((d) => ({
              dayNumber: d.dayNumber,
              city: d.city,
              activityCount: d.activities.length,
              dateLabel: getDayDateLabel(trip.startDate, d.dayNumber) || undefined,
            }))}
            totalDays={days.length}
            memberCount={members.length}
            prices={unlock.prices}
            busy={unlock.busy}
            error={unlock.error}
            onUnlock={unlock.unlock}
            onRestore={unlock.restore}
          />
        ) : (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ))}

        {accom && (
          <View style={[styles.accomCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.accomCardHead}>
              <Feather name="home" size={14} color="#26A69A" />
              <Text style={[styles.accomCardLabel, { color: "#26A69A" }]}>ACCOMMODATION</Text>
            </View>
            <Text style={[styles.accomCardName, { color: colors.foreground }]}>{accom.name}</Text>
            <Text style={[styles.accomCardMeta, { color: colors.mutedForeground }]}>
              {accom.location}{accom.type ? ` · ${accom.type}` : ""}
            </Text>
          </View>
        )}

        {/* Not included — excluded wishes */}
        {(() => {
          const excludedWishes = wishes.filter(w => w.score < 0);
          if (excludedWishes.length === 0) return null;
          return (
            <View style={styles.notIncludedBlock}>
              <View style={styles.notIncludedHeader}>
                <Feather name="slash" size={13} color="#9CA3AF" />
                <Text style={[styles.notIncludedTitle, { color: colors.mutedForeground }]}>Not included</Text>
              </View>
              <Text style={[styles.notIncludedSub, { color: colors.mutedForeground }]}>
                These were the pack's lowest-rated wishes and were excluded from the itinerary.
              </Text>
              {excludedWishes.map((w) => {
                const upCount = Object.keys(w.upvoters ?? {}).length;
                const downCount = Object.keys(w.downvoters ?? {}).length;
                return (
                  <View key={w.id} style={[styles.excludedRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.excludedText, { color: colors.mutedForeground }]}>{w.text}</Text>
                      <Text style={[styles.excludedAuthor, { color: colors.mutedForeground }]}>Added by {w.authorName}</Text>
                    </View>
                    <View style={styles.excludedVotes}>
                      <Feather name="thumbs-up" size={11} color="#9CA3AF" />
                      <Text style={styles.excludedVoteNum}>{upCount}</Text>
                      <Feather name="thumbs-down" size={11} color="#9CA3AF" style={{ marginLeft: 6 }} />
                      <Text style={styles.excludedVoteNum}>{downCount}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })()}
      </ScrollView>}

      {/* ── EXPORT SHEET ── */}
      <Modal
        visible={showExportSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowExportSheet(false)}
        onDismiss={handleExportSheetDismiss}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowExportSheet(false)}>
          <Pressable style={[styles.exportSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Export itinerary</Text>
            <Text style={[styles.exportSubtitle, { color: colors.mutedForeground }]}>Choose a format to share or save</Text>

            <Pressable
              style={({ pressed }) => [styles.exportOption, { backgroundColor: pressed ? colors.muted : colors.background, borderColor: colors.border }]}
              onPress={() => requestExport("calendar")}
              testID="export-calendar"
            >
              <View style={[styles.exportOptIcon, { backgroundColor: "#EBF5FB" }]}>
                <Feather name="calendar" size={20} color="#277DA1" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptTitle, { color: colors.foreground }]}>Calendar (.ics)</Text>
                <Text style={[styles.exportOptSub, { color: colors.mutedForeground }]}>Add all activities to your calendar app</Text>
              </View>
              {exportingCalendar
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.exportOption, { backgroundColor: pressed ? colors.muted : colors.background, borderColor: colors.border }]}
              onPress={() => requestExport("pdf")}
              testID="export-pdf"
            >
              <View style={[styles.exportOptIcon, { backgroundColor: "#FDF3EF" }]}>
                <Feather name="file-text" size={20} color="#D4573E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptTitle, { color: colors.foreground }]}>PDF</Text>
                <Text style={[styles.exportOptSub, { color: colors.mutedForeground }]}>Beautiful itinerary document to share</Text>
              </View>
              {exportingPDF
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
            </Pressable>

            <Pressable
              style={[styles.exportCancel, { backgroundColor: colors.muted }]}
              onPress={() => setShowExportSheet(false)}
            >
              <Text style={[styles.exportCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={addChoiceDay !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setAddChoiceDay(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setAddChoiceDay(null)}>
          <Pressable style={[styles.editSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Add to Day {addChoiceDay}</Text>
            <Text style={[styles.exportSubtitle, { color: colors.mutedForeground }]}>
              Enter the details yourself or paste a Google Maps place link.
            </Text>
            <Pressable
              testID="add-activity-manually"
              onPress={() => addChoiceDay && openManualActivity(addChoiceDay)}
              style={({ pressed }) => [
                styles.addMethod,
                { backgroundColor: pressed ? colors.muted : colors.background, borderColor: colors.border },
              ]}
            >
              <View style={[styles.addMethodIcon, { backgroundColor: colors.primary + "14" }]}>
                <Feather name="edit-3" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptTitle, { color: colors.foreground }]}>Type activity details</Text>
                <Text style={[styles.exportOptSub, { color: colors.mutedForeground }]}>Choose the name, time, notes, and cost</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              testID="add-activity-google-maps"
              onPress={() => addChoiceDay && openMapActivity(addChoiceDay)}
              style={({ pressed }) => [
                styles.addMethod,
                { backgroundColor: pressed ? colors.muted : colors.background, borderColor: colors.border },
              ]}
            >
              <View style={[styles.addMethodIcon, { backgroundColor: "#E9F7F2" }]}>
                <Feather name="map-pin" size={20} color="#268B7C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptTitle, { color: colors.foreground }]}>Paste a Google Maps link</Text>
                <Text style={[styles.exportOptSub, { color: colors.mutedForeground }]}>Packyo fills the details and chooses a suitable time</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={mapImport !== null}
        transparent
        animationType="slide"
        onRequestClose={() => !mapImporting && setMapImport(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            if (!mapImporting) {
              Keyboard.dismiss();
              setMapImport(null);
            }
          }}
        >
          <KeyboardAwareScrollViewCompat
            style={{ flex: 1 }}
            contentContainerStyle={styles.keyboardSheetContent}
            bottomOffset={32}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            <Pressable style={[styles.editSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
              <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Add Google Maps place</Text>
              <Text style={[styles.exportSubtitle, { color: colors.mutedForeground }]}>
                This place will be added to Day {mapImport?.dayNumber}.
              </Text>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Google Maps link</Text>
              <TextInput
                testID="google-maps-activity-link"
                style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground }]}
                placeholderTextColor={colors.mutedForeground}
                placeholder="https://maps.app.goo.gl/..."
                value={mapImport?.link ?? ""}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={(link) => setMapImport((current) => current ? { ...current, link } : current)}
              />
              {mapImportError ? (
                <Text style={[styles.mapImportError, { color: colors.destructive }]}>{mapImportError}</Text>
              ) : null}
              <View style={styles.sheetBtns}>
                <Pressable
                  onPress={() => setMapImport(null)}
                  disabled={mapImporting}
                  style={[styles.sheetCancelBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.sheetCancelText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="import-google-maps-activity"
                  onPress={handleAddFromMap}
                  disabled={mapImporting}
                  style={[styles.sheetSaveBtn, { backgroundColor: colors.primary, opacity: mapImporting ? 0.65 : 1 }]}
                >
                  {mapImporting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sheetSaveText}>Add activity</Text>}
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAwareScrollViewCompat>
        </Pressable>
      </Modal>

      <Modal
        visible={editModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModal(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => { Keyboard.dismiss(); setEditModal(null); }}
        >
          <KeyboardAwareScrollViewCompat
            style={{ flex: 1 }}
            contentContainerStyle={styles.keyboardSheetContent}
            bottomOffset={84}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            <Pressable style={[styles.editSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
              <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {editModal?.actIndex === null ? "Add activity" : "Edit activity"}
              </Text>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Activity name</Text>
              <TextInput
                style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground }]}
                placeholderTextColor={colors.mutedForeground}
                placeholder="e.g. Sunset hike"
                value={editModal?.name ?? ""}
                onChangeText={(t) => setEditModal((p) => p ? { ...p, name: t } : p)}
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Time</Text>
              <TextInput
                style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground }]}
                placeholderTextColor={colors.mutedForeground}
                placeholder="e.g. 10:00 AM"
                value={editModal?.time ?? ""}
                onChangeText={(t) => setEditModal((p) => p ? { ...p, time: t } : p)}
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Description</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldMultiline, { backgroundColor: colors.muted, color: colors.foreground }]}
                placeholderTextColor={colors.mutedForeground}
                placeholder="Brief description..."
                value={editModal?.description ?? ""}
                multiline
                numberOfLines={3}
                onChangeText={(t) => setEditModal((p) => p ? { ...p, description: t } : p)}
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Est. cost ($)</Text>
              <TextInput
                style={[styles.fieldInput, { backgroundColor: colors.muted, color: colors.foreground }]}
                placeholderTextColor={colors.mutedForeground}
                placeholder="0"
                keyboardType="numeric"
                value={editModal?.estimatedCost ?? ""}
                onChangeText={(t) => setEditModal((p) => p ? { ...p, estimatedCost: t } : p)}
              />

              <View style={styles.sheetBtns}>
                <Pressable
                  onPress={() => setEditModal(null)}
                  style={[styles.sheetCancelBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.sheetCancelText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveEdit}
                  disabled={saving}
                  style={[styles.sheetSaveBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.sheetSaveText}>{saving ? "Saving…" : "Save"}</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAwareScrollViewCompat>
        </Pressable>
      </Modal>

      {packSavedName ? (
        <View style={[styles.savedToast, { backgroundColor: colors.primary }]} pointerEvents="none">
          <Mascot name="ticket-pal" size={40} style={{ marginRight: -4 }} />
          <Text style={styles.savedToastText}>"{packSavedName}" saved as a Pack!</Text>
        </View>
      ) : null}

      <Modal
        visible={showSavePackModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowSavePackModal(false); AsyncStorage.setItem(`gopack:packSaved:${id ?? ""}`, "1").catch(() => {}); }}
      >
        <Pressable style={styles.packModalOverlay} onPress={() => { setShowSavePackModal(false); AsyncStorage.setItem(`gopack:packSaved:${id ?? ""}`, "1").catch(() => {}); }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={[styles.packModalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.packModalHandle, { backgroundColor: colors.border }]} />
              <View style={[styles.packModalIconWrap, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="users" size={24} color={colors.primary} />
              </View>
              <Text style={[styles.packModalTitle, { color: colors.foreground }]}>Save this group as a Pack?</Text>
              <Text style={[styles.packModalSub, { color: colors.mutedForeground }]}>
                One tap to invite everyone next time.
              </Text>
              {savePackError ? (
                <Text style={{ fontFamily: "DmSans_500Medium", fontSize: 13, color: "#F15A3A", textAlign: "center" }}>
                  {savePackError}
                </Text>
              ) : null}
              <Text style={[styles.packModalLabel, { color: colors.mutedForeground }]}>Pack name</Text>
              <TextInput
                style={[styles.packModalInput, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                value={savePackName}
                onChangeText={setSavePackName}
                placeholder={`${trip?.destination ?? ""} Crew`}
                placeholderTextColor={colors.mutedForeground}
                returnKeyType="done"
              />
              <View style={styles.packModalBtns}>
                <Pressable
                  onPress={() => { setShowSavePackModal(false); AsyncStorage.setItem(`gopack:packSaved:${id ?? ""}`, "1").catch(() => {}); }}
                  style={[styles.packModalCancelBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.packModalCancelText, { color: colors.mutedForeground }]}>Not now</Text>
                </Pressable>
                <Pressable
                  onPress={handleSavePack}
                  disabled={savePackSaving}
                  style={[styles.packModalSaveBtn, { backgroundColor: colors.primary, opacity: savePackSaving ? 0.6 : 1 }]}
                >
                  {savePackSaving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="check" size={15} color="#fff" />
                      <Text style={styles.packModalSaveText}>Save Pack</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  header: { paddingHorizontal: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 12 },
  backBtn: { padding: 4, marginLeft: -4 },
  headerTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 16, flex: 1, textAlign: "center", marginRight: 24 },
  headerTabs: { marginHorizontal: -16 },
  headerTabsContent: { paddingHorizontal: 16 },
  headerTab: { minWidth: 76, paddingHorizontal: 10, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent", alignItems: "center" },
  headerTabText: { fontFamily: "DmSans_500Medium", fontSize: 14 },
  
  titleRow: { paddingVertical: 16, marginTop: 8 },
  memoryBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16,
  },
  memoryBannerText: { fontFamily: "DmSans_600SemiBold", fontSize: 13, color: "#fff", flex: 1 },
  titleDest: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 28 },

  dayBlock: { marginBottom: 32 },
  dayHeader: { marginBottom: 16 },
  dayMeta: { fontFamily: "DmSans_500Medium", fontSize: 13, marginBottom: 4 },
  dayCity: { fontFamily: "DmSans_600SemiBold", fontSize: 18 },
  
  dayActivities: { gap: 16 },
  actRow: { flexDirection: "row", gap: 16 },
  actTime: { width: 44, fontFamily: "DmSans_500Medium", fontSize: 13, marginTop: 2 },
  actContent: { flex: 1, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.05)" },
  actHeaderRow: { flexDirection: "row", alignItems: "center" },
  actName: { fontFamily: "DmSans_600SemiBold", fontSize: 15, lineHeight: 20 },
  actDesc: { fontFamily: "DmSans_400Regular", fontSize: 14, lineHeight: 20, marginTop: 4 },
  actActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  actionText: { fontFamily: "DmSans_500Medium", fontSize: 12 },

  addActBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 60, marginTop: 4 },
  addActText: { fontFamily: "DmSans_500Medium", fontSize: 13 },

  attributionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
    marginBottom: 2,
  },
  attributionText: {
    fontFamily: "DmSans_500Medium",
    fontSize: 11,
    color: "#F59E0B",
  },
  aiPickBadge: {},
  memberPickBadge: {},
  addMethod: {
    minHeight: 78,
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
  },
  addMethodIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  mapImportError: { fontFamily: "DmSans_500Medium", fontSize: 12, marginTop: 8 },

  notIncludedBlock: { marginTop: 24, marginBottom: 12 },
  notIncludedHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  notIncludedTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  notIncludedSub: { fontFamily: "DmSans_400Regular", fontSize: 12, lineHeight: 17, marginBottom: 10 },
  excludedRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    marginBottom: 6,
    gap: 10,
    opacity: 0.7,
  },
  excludedText: { fontFamily: "DmSans_500Medium", fontSize: 13 },
  excludedAuthor: { fontFamily: "DmSans_400Regular", fontSize: 11, marginTop: 2 },
  excludedVotes: { flexDirection: "row", alignItems: "center", gap: 3 },
  excludedVoteNum: { fontFamily: "DmSans_500Medium", fontSize: 11, color: "#9CA3AF" },

  accomCard: { borderRadius: 14, borderWidth: 1.5, padding: 16, marginTop: 12, marginBottom: 24, gap: 4 },
  accomCardHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  accomCardLabel: { fontFamily: "DmSans_600SemiBold", fontSize: 11, letterSpacing: 1.5 },
  accomCardName: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 18 },
  accomCardMeta: { fontFamily: "DmSans_400Regular", fontSize: 14, textTransform: "capitalize" },

  /* Info tab */
  infoCard: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  infoCardPhoto: { width: 100, height: 110 },
  infoCardBody: { flex: 1, padding: 12, gap: 4 },
  infoCardDay: { fontFamily: "DmSans_500Medium", fontSize: 11 },
  infoCardName: { fontFamily: "DmSans_700Bold", fontSize: 14, lineHeight: 18 },
  infoCardDesc: { fontFamily: "DmSans_400Regular", fontSize: 12, lineHeight: 17, flex: 1 },
  infoCardFooter: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  infoChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  infoChipText: { fontFamily: "DmSans_500Medium", fontSize: 11 },

  /* Map tab */
  mapHeroCard: {
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    marginBottom: 20,
    gap: 8,
  },
  mapHeroIconBg: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  mapHeroTitle: { fontFamily: "DmSans_700Bold", fontSize: 22, color: "#fff" },
  mapHeroSub: { fontFamily: "DmSans_400Regular", fontSize: 14, color: "rgba(255,255,255,0.8)", textAlign: "center" },
  mapHeroBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, marginTop: 8 },
  mapHeroBtnText: { fontFamily: "DmSans_600SemiBold", fontSize: 14 },
  mapDayCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
  },
  mapDayHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  mapDayBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  mapDayBadgeText: { fontFamily: "DmSans_700Bold", fontSize: 13, color: "#fff" },
  mapDayLabel: { fontFamily: "DmSans_400Regular", fontSize: 11 },
  mapDayCity: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  mapDayOpenBtn: { marginLeft: "auto" as any, flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  mapDayOpenText: { fontFamily: "DmSans_600SemiBold", fontSize: 12 },
  mapStopRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  mapStopDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  mapStopTime: { fontFamily: "DmSans_400Regular", fontSize: 11, marginBottom: 1 },
  mapStopName: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },

  emptyText: { fontFamily: "DmSans_400Regular", fontSize: 15 },
  backLink: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backLinkText: { fontFamily: "DmSans_500Medium", fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  keyboardSheetContent: { flexGrow: 1, justifyContent: "flex-end" },
  editSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, gap: 8 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  sheetTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 20, marginBottom: 4 },
  exportSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  exportSubtitle: { fontFamily: "DmSans_400Regular", fontSize: 13, marginBottom: 20 },
  exportOption: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10,
  },
  exportOptIcon: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  exportOptTitle: { fontFamily: "DmSans_600SemiBold", fontSize: 15, marginBottom: 2 },
  exportOptSub: { fontFamily: "DmSans_400Regular", fontSize: 12, lineHeight: 17 },
  exportCancel: { borderRadius: 12, padding: 14, alignItems: "center", marginTop: 6 },
  exportCancelText: { fontFamily: "DmSans_500Medium", fontSize: 14 },
  fieldLabel: {
    fontFamily: "DmSans_500Medium",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 4,
  },
  fieldInput: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: "DmSans_400Regular",
    fontSize: 15,
  },
  fieldMultiline: { minHeight: 80, paddingTop: 11, textAlignVertical: "top" },
  sheetBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
  sheetCancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderRadius: 12, paddingVertical: 13 },
  sheetCancelText: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  sheetSaveBtn: { flex: 1, alignItems: "center", borderRadius: 12, paddingVertical: 13 },
  sheetSaveText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
  packModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  packModalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, padding: 24, paddingBottom: 44, gap: 10 },
  packModalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  packModalIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  packModalTitle: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 22, textAlign: "center" },
  packModalSub: { fontFamily: "DmSans_400Regular", fontSize: 14, lineHeight: 20, textAlign: "center" },
  packModalLabel: { fontFamily: "DmSans_500Medium", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  packModalInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontFamily: "DmSans_400Regular", fontSize: 15 },
  packModalBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  packModalCancelBtn: { flex: 1, alignItems: "center", borderWidth: 1, borderRadius: 12, paddingVertical: 13 },
  packModalCancelText: { fontFamily: "DmSans_500Medium", fontSize: 15 },
  packModalSaveBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 13 },
  packModalSaveText: { fontFamily: "DmSans_600SemiBold", fontSize: 15, color: "#fff" },
  savedToast: {
    position: "absolute", bottom: 100, left: 20, right: 20,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  savedToastText: { fontFamily: "DmSans_600SemiBold", fontSize: 14, color: "#fff", flex: 1 },
});
