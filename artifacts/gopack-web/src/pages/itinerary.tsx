import { useEffect, useState, useRef } from "react";
import { useRoute, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Clock, Sparkles, AlertCircle, Star, Loader2,
  FileDown, CalendarPlus, Edit2, Plus, Check, X, MapPin, Users, Eye,
  RotateCcw, Trash2, Lock, Zap
} from "lucide-react";
import { ref, onValue, set, runTransaction } from "firebase/database";
import { db } from "@/lib/firebase";
import { incrementAiUsage } from "@/hooks/useFirebase";
import { useAuth } from "@/hooks/useAuth";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ActivityPrice, ActivityPricePrint } from "@/components/ActivityPrice";

/* ─── constants ─────────────────────────────────────────────── */
const TAG_COLORS: Record<string, string> = {
  food:        "bg-amber-100 text-amber-700 border-amber-200",
  culture:     "bg-violet-100 text-violet-700 border-violet-200",
  adventure:   "bg-green-100 text-green-700 border-green-200",
  relaxation:  "bg-blue-100 text-blue-700 border-blue-200",
  nightlife:   "bg-pink-100 text-pink-700 border-pink-200",
  shopping:    "bg-orange-100 text-orange-700 border-orange-200",
  travel:      "bg-gray-100 text-gray-600 border-gray-200",
};

const TAG_LEFT_BORDER: Record<string, string> = {
  food:        "#f59e0b",
  culture:     "#7c3aed",
  adventure:   "#16a34a",
  relaxation:  "#2563eb",
  nightlife:   "#db2777",
  shopping:    "#ea580c",
  travel:      "#9ca3af",
};

const TAG_BG: Record<string, string> = {
  food:        "#fef3c7",
  culture:     "#ede9fe",
  adventure:   "#dcfce7",
  relaxation:  "#dbeafe",
  nightlife:   "#fce7f3",
  shopping:    "#ffedd5",
  travel:      "#f3f4f6",
};

const TAG_OPTIONS = ["food","culture","adventure","relaxation","nightlife","shopping","travel"];

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

/* ─── helpers ────────────────────────────────────────────────── */
function parseActivityTime(baseDate: Date, dayOffset: number, timeStr: string) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + dayOffset);
  const match = timeStr?.match(/(\d+):(\d+)\s*(am|pm)?/i);
  if (match) {
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const period = match[3]?.toLowerCase();
    if (period === "pm" && h < 12) h += 12;
    if (period === "am" && h === 12) h = 0;
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

function toGCalDate(d: Date) {
  return d.toISOString().replace(/[-:.]/g, "").slice(0, 15);
}

function parseTripStartDate(value: unknown): Date {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallback = new Date();
  fallback.setHours(9, 0, 0, 0);
  return fallback;
}

function escapeIcsText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function formatIcsDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function toSafeDownloadName(value: unknown): string {
  return String(value || "trip")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "trip";
}


function buildActivityMapsUrl(act: any, day: any, trip: any): string {
  const q = `${act.name || ""}, ${day.city || trip?.destination || ""}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function buildAllMapsUrl(itinerary: any, trip: any): string {
  const dest = trip?.destination || "";
  const places: string[] = [];
  (itinerary.days || []).forEach((day: any) =>
    (day.activities || []).forEach((act: any) => {
      if (act.name) places.push(`${act.name}, ${day.city || dest}`);
    })
  );
  if (places.length === 0) return `https://www.google.com/maps/search/${encodeURIComponent(dest)}`;
  if (places.length === 1) return `https://www.google.com/maps/search/${encodeURIComponent(places[0])}`;
  const origin = encodeURIComponent(places[0]);
  const destination = encodeURIComponent(places[places.length - 1]);
  const waypoints = places.slice(1, -1).map(encodeURIComponent).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ""}`;
}

function buildFullICS(itinerary: any, trip: any): string {
  const base = parseTripStartDate(trip?.startDate);
  const stamp = formatIcsDateTime(new Date());
  const lines = [
    "BEGIN:VCALENDAR","VERSION:2.0",
    "PRODID:-//Packyo//AI Travel Planner//EN",
    "CALSCALE:GREGORIAN","METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(itinerary.title || trip?.destination || "Trip")}`,
  ];
  (itinerary.days || []).forEach((day: any, di: number) => {
    (day.activities || []).forEach((act: any, ai: number) => {
      const start = parseActivityTime(base, di, act.time || "9:00am");
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const uid = `${toSafeDownloadName(trip?.destination || "trip")}-${di + 1}-${ai + 1}@packyo`;
      lines.push("BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${formatIcsDateTime(start)}`,
        `DTEND:${formatIcsDateTime(end)}`,
        `SUMMARY:${escapeIcsText(act.name || "Activity")}`,
        `DESCRIPTION:${escapeIcsText(act.description || "")}`,
        `LOCATION:${escapeIcsText(day.city || trip?.destination || "")}`,
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
        "END:VEVENT");
    });
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

/* ─── manual price helpers ───────────────────────────────────── */
function initialPriceFields(activity: any, tripCurrency: string | null) {
  return { estimatedCost: Number(activity?.estimatedCost) || 0 };
}

/** Keep the original editable per-person activity estimate. */
function applyManualPrice(original: any, form: any) {
  return { ...form, estimatedCost: Number(form.estimatedCost) || 0 };
}

function PriceFields({ form, set_, tripCurrency }: { form: any; set_: (k: string, v: any) => void; tripCurrency: string | null }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Est. cost ($)</label>
        <input type="number" min={0} step="any" inputMode="decimal" value={form.estimatedCost ?? 0} onChange={e=>set_("estimatedCost",Number(e.target.value))} placeholder="0"
          className="w-full min-w-0 border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" data-testid="input-price-amount"/>
    </div>
  );
}

function priceFieldsInvalid(form: any) {
  return form.estimatedCost != null && (!Number.isFinite(Number(form.estimatedCost)) || Number(form.estimatedCost) < 0);
}

/* ─── ActivityEditor ─────────────────────────────────────────── */
function ActivityEditor({ activity, onSave, onCancel, tripCurrency }: { activity: any; onSave: (u: any) => void; onCancel: () => void; tripCurrency: string | null }) {
  const [form, setForm] = useState({ ...activity, ...initialPriceFields(activity, tripCurrency) });
  const set_ = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <div className="border-2 border-primary/30 rounded-2xl p-5 bg-primary/5 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Name</label>
          <input value={form.name||""} onChange={e=>set_("name",e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"/></div>
        <div><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Time</label>
          <input value={form.time||""} onChange={e=>set_("time",e.target.value)} placeholder="e.g. 10:00am" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"/></div>
      </div>
      <div><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Description</label>
        <textarea value={form.description||""} onChange={e=>set_("description",e.target.value)} rows={3} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"/></div>
      <div className="grid grid-cols-2 gap-3">
        <PriceFields form={form} set_={set_} tripCurrency={tripCurrency}/>
        <div><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Category</label>
          <select value={form.tag||"travel"} onChange={e=>set_("tag",e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
            {TAG_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="flex items-center gap-1.5 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted/50 transition-colors"><X size={14}/> Cancel</button>
        <button onClick={()=>onSave(applyManualPrice(activity, form))} disabled={priceFieldsInvalid(form)} className="disabled:opacity-40 flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"><Check size={14}/> Save</button>
      </div>
    </div>
  );
}

/* ─── AddActivityForm ────────────────────────────────────────── */
function AddActivityForm({ dayIndex, onAdd, onCancel, userName, tripCurrency }: { dayIndex: number; onAdd: (di: number, a: any) => void; onCancel: () => void; userName: string; tripCurrency: string | null }) {
  const [form, setForm] = useState<any>({ name:"", time:"", description:"", tag:"travel", labels:[], fromWish:false, suggester: userName || "Member", estimatedCost:0 });
  const set_ = (k: string, v: any) => setForm((f: any)=>({ ...f, [k]: v }));
  return (
    <div className="border-2 border-dashed border-primary/40 rounded-2xl p-5 bg-primary/5 flex flex-col gap-3">
      <p className="text-sm font-medium text-primary">New activity</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Name *</label>
          <input value={form.name} onChange={e=>set_("name",e.target.value)} placeholder="e.g. Louvre Museum" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"/></div>
        <div><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Time</label>
          <input value={form.time} onChange={e=>set_("time",e.target.value)} placeholder="e.g. 10:00am" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"/></div>
      </div>
      <div><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Description</label>
        <textarea value={form.description} onChange={e=>set_("description",e.target.value)} rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" placeholder="What to expect…"/></div>
      <div className="grid grid-cols-2 gap-3">
        <PriceFields form={form} set_={set_} tripCurrency={tripCurrency}/>
        <div><label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Category</label>
          <select value={form.tag} onChange={e=>set_("tag",e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
            {TAG_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="flex items-center gap-1.5 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted/50 transition-colors"><X size={14}/> Cancel</button>
        <button onClick={()=>{ if(form.name.trim() && !priceFieldsInvalid(form)) onAdd(dayIndex,applyManualPrice({}, form)); }} disabled={!form.name.trim() || priceFieldsInvalid(form)} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40"><Plus size={14}/> Add activity</button>
      </div>
    </div>
  );
}

function PackyoPrintReport({ itinerary, trip }: { itinerary: any; trip: any }) {
  const days = itinerary?.days || [];
  const members = Object.values(trip?.members || {}).filter(Boolean) as any[];
  const activityTags = Array.from(
    new Set(days.flatMap((day: any) => (day.activities || []).map((activity: any) => activity.tag).filter(Boolean)))
  ) as string[];
  const vibes = Array.isArray(trip?.vibes) && trip.vibes.length ? trip.vibes : activityTags;
  const totalCost = days.flatMap((day: any) => day.activities || [])
    .reduce((sum: number, activity: any) => sum + (Number(activity.estimatedCost) || 0), 0);
  const activityCount = days.reduce((sum: number, day: any) => sum + (day.activities?.length || 0), 0);
  const destination = trip?.destination || "Your destination";
  const generatedOn = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  return (
    <section className="print-only packyo-print-report">
      <header className="packyo-cover">
        <div className="packyo-cover-orb packyo-cover-orb-top" />
        <div className="packyo-cover-orb packyo-cover-orb-bottom" />
        <div className="packyo-cover-brand"><span /> PACKYO</div>
        <div className="packyo-cover-main">
          <p>GROUP TRAVEL ITINERARY</p>
          <h1>{itinerary?.title || `${destination} itinerary`}</h1>
          <div className="packyo-cover-destination">{destination}</div>
        </div>
        <div className="packyo-cover-stats">
          <div><span>DURATION</span><strong>{days.length} {days.length === 1 ? "day" : "days"}</strong></div>
          <div><span>BUDGET</span><strong>{trip?.budget || "Flexible"}</strong></div>
          <div><span>PACK SIZE</span><strong>{members.length || 1} {(members.length || 1) === 1 ? "person" : "people"}</strong></div>
        </div>
      </header>

      <section className="packyo-report-body">
        <section className="packyo-pack-section">
          <p className="packyo-eyebrow">THE PACK</p>
          <h2>Who&apos;s coming</h2>
          <div className="packyo-member-list">
            {(members.length ? members : [{ name: "Your pack" }]).map((member: any, index: number) => {
              const name = member?.name || member?.displayName || "Pack member";
              return (
                <div className="packyo-member" key={`${name}-${index}`}>
                  <span>{name.slice(0, 1).toUpperCase()}</span>
                  {name}
                </div>
              );
            })}
          </div>
        </section>

        {vibes.length > 0 && (
          <section className="packyo-vibes-section">
            <p className="packyo-eyebrow">TRIP VIBES</p>
            <div className="packyo-vibes">
              {vibes.map((vibe: string) => <span key={vibe}>{vibe}</span>)}
            </div>
          </section>
        )}

        <section className="packyo-days">
          {days.map((day: any, dayIndex: number) => (
            <article className="packyo-day" key={`${day.dayNumber || dayIndex + 1}-${day.city || destination}`}>
              <header className="packyo-day-header">
                <div>
                  <span>DAY {day.dayNumber || dayIndex + 1}</span>
                  <h2>{day.city || destination}</h2>
                </div>
                {day.theme && <em>{day.theme}</em>}
              </header>
              <div className="packyo-activity-list">
                {(day.activities || []).map((activity: any, activityIndex: number) => {
                  const tag = activity.tag || "travel";
                  const isWish = Boolean(activity.fromWish);
                  const source = isWish
                    ? `✦ ${activity.suggester || "A pack member"}'s wish`
                    : `✦ AI pick${tag ? ` · ${tag}` : ""}`;
                  return (
                    <article
                      className="packyo-activity-card"
                      key={`${activity.name || "activity"}-${activityIndex}`}
                      style={{ borderLeftColor: TAG_LEFT_BORDER[tag] || TAG_LEFT_BORDER.travel }}
                    >
                      <div className="packyo-activity-time">
                        {activity.time || "9:00 AM"} {isWish && <b>★ Wish</b>}
                      </div>
                      <h3>{activity.name || "Activity"}</h3>
                      <p className="packyo-activity-source">{source}</p>
                      {activity.description && <p className="packyo-activity-description">{activity.description}</p>}
                      <div className="packyo-activity-cost"><ActivityPricePrint activity={activity}/></div>
                    </article>
                  );
                })}
              </div>
            </article>
          ))}
        </section>

        <footer className="packyo-report-total">
          <p>ESTIMATED TOTAL · ALL {days.length} {days.length === 1 ? "DAY" : "DAYS"}</p>
          <strong>~${totalCost.toLocaleString()}</strong>
          <span>per person · {activityCount} {activityCount === 1 ? "activity" : "activities"}</span>
          <div className="packyo-report-footer">
            <b>Packyo</b>
            <span>Plan trips together ✦</span>
            <span>Generated {generatedOn}</span>
          </div>
        </footer>
      </section>
    </section>
  );
}

/** Auto-check key from server-persisted venue identities only (never pricing, never drafts). */
function canShowItineraryKey(trip: any, itinerary: any): string | null {
  if (!trip?.destination || !Array.isArray(itinerary?.days) || itinerary.days.length === 0) return null;
  const venues = itinerary.days.map((d: any, di: number) =>
    (d?.activities || []).map((a: any, ai: number) => `${di}.${ai}:${a?.id ?? ""}:${String(a?.name ?? "").trim().toLowerCase()}`).join("|")
  ).join("/");
  let h = 5381;
  for (let i = 0; i < venues.length; i++) h = ((h * 33) ^ venues.charCodeAt(i)) >>> 0;
  return `${itinerary.generatedAt || itinerary.createdAt || ""}:${h.toString(36)}`;
}

/** Find counterpart: stable id anywhere, else same day+index with exact same name (legacy). */
function findCounterpart(itin: any, act: any, di: number, ai: number): any {
  if (!itin?.days) return undefined;
  if (act?.id != null) {
    for (const d of itin.days) for (const a of d?.activities || []) if (a?.id === act.id) return a;
    return undefined;
  }
  const c = itin.days[di]?.activities?.[ai];
  return c && c.id == null && c.name === act?.name ? c : undefined;
}

/**
 * Keep the user's unsaved draft (content, additions, removals) but adopt new
 * server pricing for activities whose venue and price the user has not touched.
 * Locally changed venues/prices keep their local (already invalidated) pricing.
 */
function mergeServerPricing(local: any, prevBaseline: any, server: any): any {
  const next = JSON.parse(JSON.stringify(local));
  (next.days || []).forEach((day: any, di: number) => {
    (day?.activities || []).forEach((act: any, ai: number) => {
      const before = findCounterpart(prevBaseline, act, di, ai);
      const after = findCounterpart(server, act, di, ai);
      if (!before || !after) return;
      const untouched = before.name === act.name && after.name === act.name &&
        before.estimatedCost === act.estimatedCost &&
        JSON.stringify(before.pricing ?? null) === JSON.stringify(act.pricing ?? null);
      if (!untouched) return;
      act.pricing = after.pricing ?? null;
      act.estimatedCost = after.estimatedCost ?? null;
    });
  });
  return next;
}

/* ─── main page ──────────────────────────────────────────────── */
export default function Itinerary() {
  const [, params] = useRoute("/trip/:tripId/itinerary");
  const tripId = params?.tripId || "";
  const { user } = useAuth();
  const [itinerary, setItinerary] = useState<any>(null);
  const [localItinerary, setLocalItinerary] = useState<any>(null);
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [permissionError, setPermissionError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addingToDayIndex, setAddingToDayIndex] = useState<number | null>(null);
  const [printPreview, setPrintPreview] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const [redoPanel, setRedoPanel] = useState<{ di: number; ai: number; act: any } | null>(null);
  const [redoLoading, setRedoLoading] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState("");

  const baselineRef = useRef<any>(null);
  const localRef = useRef<any>(null);
  localRef.current = localItinerary;

  useEffect(() => {
    if (!tripId) return;
    baselineRef.current = null;
    localRef.current = null;
    const unsub = onValue(
      ref(db, `trips/${tripId}`),
      snap => {
        const data = snap.val();
        if (data) {
          setTrip(data);
          const itin = data.itinerary || null;
          const prevBaseline = baselineRef.current;
          const local = localRef.current;
          baselineRef.current = itin;
          setItinerary(itin);
          const dirty = local && JSON.stringify(local) !== JSON.stringify(prevBaseline);
          setLocalItinerary(
            itin && dirty ? mergeServerPricing(local, prevBaseline, itin)
              : itin ? JSON.parse(JSON.stringify(itin)) : null
          );
        }
        setLoading(false);
      },
      (err) => {
        console.error("itinerary read error:", err);
        setPermissionError(true);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tripId]);

  const tripCurrency = null;
  const estimatedTotal = (localItinerary?.days || []).flatMap((d: any) => d.activities || [])
    .reduce((sum: number, activity: any) => sum + (Number(activity.estimatedCost) || 0), 0);

  const isDirty = JSON.stringify(localItinerary) !== JSON.stringify(itinerary);

  /* ── premium / tier ── */
  const isPremium = trip?.isPremium ?? false;
  const activityRedosUsed = trip?.aiUsage?.activityRedos ?? 0;
  const STARTER_REDO_LIMIT = 1;
  const PREMIUM_REDO_LIMIT = 20;
  const canRedo = isPremium ? activityRedosUsed < PREMIUM_REDO_LIMIT : activityRedosUsed < STARTER_REDO_LIMIT;

  /* ── page-level guard: never expose itinerary data/controls for an undecided trip ── */
  const canShowItinerary = !!trip?.destination && !!localItinerary;

  /* ── day locking ── */
  const totalDays = localItinerary?.days?.length ?? 0;
  const freeDayCount = totalDays <= 1 ? totalDays : Math.floor(totalDays / 2);
  const isDayLocked = (dayNumber: number) => !isPremium && dayNumber > freeDayCount;

  const saveChanges = async () => {
    if (!localItinerary || !tripId) return;
    setSaving(true);
    setSaveError(null);
    const draft = JSON.parse(JSON.stringify(localItinerary));
    const capturedBaseline = baselineRef.current ? JSON.parse(JSON.stringify(baselineRef.current)) : null;
    try {
      const result = await runTransaction(ref(db, `trips/${tripId}/itinerary`), (current: any) => {
        if (current === null || current === undefined) {
          // Itinerary deleted elsewhere: abort rather than resurrect it.
          return capturedBaseline === null ? draft : undefined;
        }
        return mergeServerPricing(draft, capturedBaseline, current);
      });
      if (!result.committed) throw new Error("This itinerary was removed by someone else, so your changes were not saved.");
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      // Draft stays in local state; nothing is discarded.
      setSaveError(e instanceof Error ? e.message : "Could not save changes. Your edits are still here; try again.");
    } finally { setSaving(false); }
  };

  const handleEditSave = (di: number, ai: number, updated: any) => {
    const next = JSON.parse(JSON.stringify(localItinerary));
    next.days[di].activities[ai] = updated;
    setLocalItinerary(next);
    setEditingKey(null);
  };

  const handleAddActivity = async (di: number, activity: any) => {
    const next = JSON.parse(JSON.stringify(localItinerary));
    next.days[di].activities.push(activity);
    setLocalItinerary(next);
    setAddingToDayIndex(null);
    try {
      await set(ref(db, `trips/${tripId}/itinerary`), next);
    } catch (err) {
      console.error("Failed to sync activity to Firebase:", err);
    }
  };

  const handleExportPDF = () => {
    setPrintPreview(false);
    setTimeout(() => window.print(), 50);
  };
  const togglePrintPreview = () => setPrintPreview(p => !p);

  const handleExportAllCalendar = () => {
    if (!localItinerary) return;
    downloadFile(buildFullICS(localItinerary, trip), `${(trip?.destination||"trip").replace(/\s+/g,"-").toLowerCase()}-itinerary.ics`, "text/calendar;charset=utf-8");
  };

  const handleOpenAllMaps = () => {
    if (!localItinerary) return;
    window.open(buildAllMapsUrl(localItinerary, trip), "_blank", "noopener,noreferrer");
  };

  const handleDeleteActivity = (di: number, ai: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    setRedoPanel(null);
    const next = JSON.parse(JSON.stringify(localItinerary));
    next.days[di].activities.splice(ai, 1);
    setLocalItinerary(next);
  };

  const handleRedo = async (di: number, ai: number, act: any, redoType: "same_type" | "whole") => {
    if (!canRedo) {
      setUpgradeReason(isPremium ? "You've reached the premium redo limit (20)" : "You've used your activity redo limit");
      setShowUpgrade(true);
      return;
    }
    const key = `${di}-${ai}`;
    setRedoPanel(null);
    setRedoLoading(key);
    const day = localItinerary.days[di];
    const otherActivities = day.activities.filter((_: any, i: number) => i !== ai).map((a: any) => a.name);
    const allTripActivities = (localItinerary?.days || [])
      .flatMap((d: any) => d.activities || [])
      .map((a: any) => a.name)
      .filter((n: string) => n !== act.name);
    try {
      const resp = await fetch("/api/redo-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity: act,
          city: day.city,
          theme: day.theme,
          destination: trip?.destination,
          budget: trip?.budget || "midrange",
          redoType,
          otherActivities,
          allTripActivities,
        }),
      });
      if (resp.ok) {
        const { activity: newAct } = await resp.json();
        const next = JSON.parse(JSON.stringify(localItinerary));
        next.days[di].activities[ai] = { ...newAct, time: act.time };
        setLocalItinerary(next);
        // Save to Firebase BEFORE incrementing usage — incrementAiUsage triggers
        // onValue which resets localItinerary to server state if we haven't saved yet
        await set(ref(db, `trips/${tripId}/itinerary`), next);
        await incrementAiUsage(tripId, "activityRedos");
      }
    } finally {
      setRedoLoading(null);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-primary"/>
    </div>
  );

  if (permissionError) return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-lg w-full">
        <Link href={`/trip/${tripId}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 text-sm">
          <ArrowLeft size={16}/> Back to trip
        </Link>
        <div className="bg-destructive/5 border border-destructive/20 rounded-2xl p-8">
          <h2 className="font-serif text-2xl font-bold mb-2">Firebase rules need updating</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Your Firebase Realtime Database rules are blocking reads. Paste the rules below into your{" "}
            <a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Firebase Console
            </a>
            {" "}→ Realtime Database → Rules tab, then publish.
          </p>
          <pre className="bg-muted/60 rounded-xl p-4 text-xs overflow-x-auto leading-relaxed select-all">{`{
  "rules": {
    "trips": {
      "$tripId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "userTrips": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}`}</pre>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ── print + screen styles ── */}
      <style>{`
        @media screen {
          .print-only { display: none !important; }
          .print-legacy { display: none !important; }
        }

        @media print {
          @page { size: letter; margin: 0; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .print-legacy { display: none !important; }

          body { margin: 0; background: #fff !important; font-family: Georgia, serif; }

          .print-header {
            background: #1a1a1a !important;
            color: #fff !important;
            padding: 48px 48px 40px;
            display: flex !important;
            align-items: flex-end;
            justify-content: space-between;
          }
          .print-header-logo { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; opacity: 0.6; font-family: sans-serif; }
          .print-header-logo span { color: #E85D3A; }
          .print-header-title { font-size: 38px; font-weight: 700; line-height: 1.15; margin: 16px 0 8px; }
          .print-header-sub { font-size: 15px; opacity: 0.6; }

          .print-content { padding: 40px 48px; }

          .print-day { margin-bottom: 40px; break-inside: avoid-page; }
          .print-day-header {
            display: flex !important;
            align-items: center;
            gap: 16px;
            padding: 14px 20px;
            background: #E85D3A !important;
            color: #fff !important;
            border-radius: 12px;
            margin-bottom: 16px;
          }
          .print-day-number {
            width: 36px; height: 36px;
            background: rgba(255,255,255,0.2) !important;
            border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; font-weight: 700;
          }
          .print-day-city { font-size: 20px; font-weight: 700; }
          .print-day-theme { font-size: 13px; opacity: 0.8; margin-top: 2px; }

          .print-activity {
            border: 1px solid #e5e7eb !important;
            border-radius: 12px;
            padding: 16px 20px;
            margin-bottom: 12px;
            break-inside: avoid;
            display: flex !important;
            gap: 16px;
            position: relative;
            border-left-width: 4px !important;
          }
          .print-activity-time { font-size: 12px; color: #6b7280; margin-bottom: 4px; font-family: sans-serif; }
          .print-activity-name { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
          .print-activity-desc { font-size: 13px; color: #4b5563; line-height: 1.6; }
          .print-activity-meta { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
          .print-tag { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; font-family: sans-serif; border: 1px solid; }
          .print-tag-food       { background: #fef3c7 !important; color: #92400e !important; border-color: #fde68a !important; }
          .print-tag-culture    { background: #ede9fe !important; color: #5b21b6 !important; border-color: #c4b5fd !important; }
          .print-tag-adventure  { background: #dcfce7 !important; color: #14532d !important; border-color: #86efac !important; }
          .print-tag-relaxation { background: #dbeafe !important; color: #1e3a8a !important; border-color: #93c5fd !important; }
          .print-tag-nightlife  { background: #fce7f3 !important; color: #831843 !important; border-color: #f9a8d4 !important; }
          .print-tag-shopping   { background: #ffedd5 !important; color: #7c2d12 !important; border-color: #fdba74 !important; }
          .print-tag-travel     { background: #f3f4f6 !important; color: #374151 !important; border-color: #d1d5db !important; }
          .print-wish-badge     { background: #fef2f2 !important; color: #E85D3A !important; border: 1px solid #fecaca !important; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
          .print-cost { font-size: 14px; color: #374151; font-weight: 600; font-family: sans-serif; white-space: nowrap; }
          .print-activity-right { margin-left: auto; text-align: right; min-width: 72px; }
          .print-footer { text-align: center; color: #9ca3af; font-size: 11px; font-family: sans-serif; padding: 24px 0; border-top: 1px solid #f3f4f6; }

          nav, .print-screen-only { display: none !important; }
          .print-page { padding: 0 !important; max-width: 100% !important; }

          .packyo-print-report {
            display: block !important;
            color: #1f1e1b !important;
            background: #fff !important;
            font-family: Arial, Helvetica, sans-serif !important;
          }
          .packyo-cover {
            position: relative;
            min-height: 61vh;
            overflow: hidden;
            box-sizing: border-box;
            padding: 50px 50px 52px;
            display: flex !important;
            flex-direction: column;
            color: #fff !important;
            background: #191a17 !important;
            page-break-after: always;
            break-after: page;
          }
          .packyo-cover-orb { position: absolute; border-radius: 999px; background: #2a1c16 !important; opacity: 0.8; }
          .packyo-cover-orb-top { width: 250px; height: 250px; top: -105px; right: -38px; }
          .packyo-cover-orb-bottom { width: 190px; height: 190px; bottom: -108px; left: -62px; }
          .packyo-cover-brand {
            position: relative;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 3px;
            color: #ef6949 !important;
          }
          .packyo-cover-brand span {
            width: 10px;
            height: 10px;
            display: inline-block;
            margin-right: 10px;
            border-radius: 999px;
            background: #ef6949 !important;
          }
          .packyo-cover-main { position: relative; margin-top: 60px; max-width: 540px; }
          .packyo-cover-main p,
          .packyo-eyebrow {
            margin: 0;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 2.6px;
            color: #ef6949 !important;
          }
          .packyo-cover-main p { color: #96938d !important; }
          .packyo-cover h1 {
            margin: 18px 0 12px;
            font-family: Georgia, "Times New Roman", serif !important;
            font-size: 39px;
            line-height: 1.12;
            color: #fff !important;
          }
          .packyo-cover-destination { font-size: 16px; color: #b8b5af !important; }
          .packyo-cover-stats {
            position: relative;
            margin-top: auto;
            padding-top: 30px;
            display: grid !important;
            grid-template-columns: repeat(3, 1fr);
            border-top: 1px solid #3d3e39;
          }
          .packyo-cover-stats > div { padding: 0 24px; border-left: 1px solid #343531; }
          .packyo-cover-stats > div:first-child { padding-left: 0; border-left: 0; }
          .packyo-cover-stats span { display: block; margin-bottom: 10px; font-size: 10px; font-weight: 700; letter-spacing: 1.7px; color: #95928d !important; }
          .packyo-cover-stats strong { display: block; font-family: Georgia, "Times New Roman", serif !important; font-size: 18px; color: #fff !important; text-transform: capitalize; }

          .packyo-report-body { display: block !important; background: #fff !important; }
          .packyo-pack-section { padding: 48px 50px 42px; }
          .packyo-pack-section h2,
          .packyo-day-header h2 {
            margin: 12px 0 22px;
            font-family: Georgia, "Times New Roman", serif !important;
            font-size: 27px;
            color: #181816 !important;
          }
          .packyo-member-list { display: flex !important; flex-wrap: wrap; gap: 10px; }
          .packyo-member {
            display: inline-flex !important;
            align-items: center;
            gap: 8px;
            padding: 5px 13px 5px 6px;
            border-radius: 999px;
            background: #f4f1eb !important;
            font-size: 13px;
            font-weight: 600;
          }
          .packyo-member span {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            color: #fff !important;
            background: #ef6949 !important;
            font-size: 12px;
          }
          .packyo-vibes-section {
            display: flex !important;
            align-items: center;
            gap: 20px;
            padding: 28px 50px;
            border-top: 1px solid #ece8df;
            border-bottom: 1px solid #ece8df;
          }
          .packyo-vibes-section .packyo-eyebrow { flex: none; }
          .packyo-vibes { display: flex !important; flex-wrap: wrap; gap: 8px; }
          .packyo-vibes span {
            display: inline-block;
            padding: 7px 13px;
            border-radius: 999px;
            color: #393834 !important;
            background: #f4f1eb !important;
            font-size: 12px;
            text-transform: capitalize;
          }

          .packyo-days { padding: 40px 50px 0; }
          .packyo-day { margin: 0 0 42px; break-inside: auto; }
          .packyo-day-header {
            display: flex !important;
            align-items: end;
            justify-content: space-between;
            gap: 18px;
            padding: 0 0 17px;
            margin-bottom: 26px;
            border-bottom: 2px solid #ef6949;
          }
          .packyo-day-header > div { display: flex !important; align-items: baseline; gap: 16px; }
          .packyo-day-header span {
            color: #ef6949 !important;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 2.5px;
            white-space: nowrap;
          }
          .packyo-day-header h2 { margin: 0; }
          .packyo-day-header em { color: #77736c !important; font-family: Georgia, "Times New Roman", serif !important; font-size: 14px; text-align: right; }
          .packyo-activity-list { display: block !important; }
          .packyo-activity-card {
            display: block !important;
            box-sizing: border-box;
            break-inside: avoid;
            margin-bottom: 14px;
            padding: 18px 20px;
            border: 1px solid #e9e5dc;
            border-left: 4px solid #ef6949;
            border-left-color: #ef6949;
            border-radius: 12px;
            background: #fcfbf8 !important;
          }
          .packyo-activity-time { margin-bottom: 8px; color: #99958e !important; font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; }
          .packyo-activity-time b { display: inline-block; margin-left: 12px; padding: 3px 7px; border-radius: 999px; color: #ef6949 !important; background: #fff0eb !important; font-size: 10px; letter-spacing: 0; text-transform: none; }
          .packyo-activity-card h3 { margin: 0 0 7px; color: #1c1b18 !important; font-size: 16px; line-height: 1.3; }
          .packyo-activity-source { margin: 0 0 9px; color: #ef6949 !important; font-size: 12px; font-weight: 600; text-transform: capitalize; }
          .packyo-activity-description { margin: 0; color: #5d5a54 !important; font-size: 13px; line-height: 1.55; }
          .packyo-activity-cost { margin: 10px 0 0; color: #5d5a54 !important; font-size: 12px; font-weight: 600; }

          .packyo-report-total {
            box-sizing: border-box;
            min-height: 250px;
            margin-top: 42px;
            padding: 54px 50px 0;
            border-top: 1px solid #ece8df;
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .packyo-report-total > p { margin: 0 0 12px; color: #5f5c56 !important; font-size: 11px; font-weight: 700; letter-spacing: 2.5px; }
          .packyo-report-total > strong { display: block; color: #191816 !important; font-family: Georgia, "Times New Roman", serif !important; font-size: 34px; }
          .packyo-report-total > span { display: block; margin-top: 6px; color: #77736c !important; font-size: 13px; }
          .packyo-report-footer {
            display: flex !important;
            justify-content: space-between;
            gap: 16px;
            margin-top: 65px;
            padding: 16px 0;
            border-top: 1px solid #ece8df;
            color: #77736c !important;
            font-size: 11px;
          }
          .packyo-report-footer b { color: #181816 !important; font-family: Georgia, "Times New Roman", serif !important; font-size: 14px; }
        }
      `}</style>

      <div className="min-h-screen bg-background text-foreground">
        {/* nav */}
        <nav className="no-print flex items-center justify-between px-8 py-5 border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-10">
          <div className="flex items-center gap-4">
            <Link href={`/trip/${tripId}`} className="text-muted-foreground hover:text-foreground" data-testid="link-back">
              <ArrowLeft size={20}/>
            </Link>
            <Link href="/" className="font-display font-bold text-xl" data-testid="link-logo">
              Packyo
            </Link>
          </div>
          {canShowItinerary && isDirty && (
            <button onClick={saveChanges} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50"
              data-testid="button-save-changes">
              {saving ? <Loader2 size={14} className="animate-spin"/> : saveSuccess ? <Check size={14}/> : null}
              {saving ? "Saving…" : saveSuccess ? "Saved!" : "Save changes"}
            </button>
          )}
        </nav>
        {saveError && (
          <div className="no-print flex items-center justify-center gap-2 px-6 py-2 text-sm bg-destructive/10 text-destructive border-b border-destructive/20" role="alert" data-testid="text-save-error">
            <AlertCircle size={14}/> {saveError}
            <button onClick={() => setSaveError(null)} className="ml-2 underline" data-testid="button-dismiss-save-error">Dismiss</button>
          </div>
        )}

        {/* print header */}
        {canShowItinerary && (
          <div className="print-legacy print-header">
            <div>
              <div className="print-header-logo">Packyo</div>
              <div className="print-header-title">{localItinerary.title}</div>
              <div className="print-header-sub">{localItinerary.days?.length} days · {trip?.destination}</div>
            </div>
            <div style={{textAlign:"right",opacity:0.5,fontSize:13}}>
              AI-generated itinerary<br/>Packyo
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto px-6 py-12 print-page print-content" ref={printRef}>
          {!canShowItinerary ? (
            <div className="text-center py-20 text-muted-foreground">
              <Sparkles size={32} className="mx-auto mb-4 opacity-30"/>
              <p className="font-medium mb-2">No itinerary yet</p>
              <p className="text-sm mb-6">
                {!trip?.destination
                  ? "This trip doesn't have a destination set yet. Head back to the trip hub to finish planning."
                  : "Go back to the trip hub and generate one."}
              </p>
              <Link href={`/trip/${tripId}`} className="bg-primary text-white font-medium px-6 py-3 rounded-full hover:bg-primary/90 transition-colors" data-testid="link-go-back">
                Back to trip
              </Link>
            </div>
          ) : (
            <>
              {/* screen title */}
              <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} className="print-screen-only no-print mb-10">
                <p className="text-sm text-muted-foreground font-medium tracking-wide uppercase mb-2">{trip?.destination}</p>
                <h1 className="font-serif text-4xl sm:text-5xl font-bold mb-3 leading-tight">{localItinerary.title}</h1>
                <p className="text-muted-foreground mb-3">{localItinerary.days?.length} days planned by AI from your group&apos;s wishes</p>
                {trip?.members && Object.keys(trip.members).length > 0 && (
                  <div className="flex items-center gap-2 mb-6">
                    <Users size={13} className="text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      {(Object.values(trip.members) as any[]).map((m: any) => m.name).filter(Boolean).join(" · ")}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={isPremium ? handleExportAllCalendar : () => { setUpgradeReason("Calendar export is a Pack Plus feature"); setShowUpgrade(true); }}
                    className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-full hover:bg-muted/50 transition-colors"
                    title={isPremium ? "Export all to Calendar" : "Pack Plus — Export to Calendar"}>
                    <CalendarPlus size={14}/> Add all to Calendar
                  </button>
                  <button
                    onClick={isPremium ? handleOpenAllMaps : () => { setUpgradeReason("Full route in Maps is a Pack Plus feature"); setShowUpgrade(true); }}
                    className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-full hover:bg-muted/50 transition-colors"
                    title={isPremium ? "Full route in Google Maps" : "Pack Plus — Full route in Maps"}>
                    <MapPin size={14}/> Full route in Maps
                  </button>
                  <button
                    onClick={isPremium ? handleExportPDF : () => { setUpgradeReason("PDF export is a Pack Plus feature"); setShowUpgrade(true); }}
                    className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-full hover:bg-muted/50 transition-colors"
                    title={isPremium ? "Export as PDF" : "Pack Plus — Export PDF"}>
                    <FileDown size={14}/> Export PDF
                  </button>
                </div>
                <div className="mt-4 text-xs text-muted-foreground" data-testid="status-activity-estimates">
                  Estimated total: <span className="font-semibold text-foreground/80">~${estimatedTotal}</span> per person
                </div>
              </motion.div>

              {/* days */}
              <div className="flex flex-col gap-10">
                {(localItinerary.days || []).map((day: any, di: number) => (
                  <motion.div key={di} initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{delay:di*0.07}} data-testid={`day-${di+1}`}>

                    {/* screen day header */}
                    <div className="no-print flex items-center gap-0 mb-6">
                      <div
                        className="flex items-center gap-4 flex-1 px-5 py-4 rounded-2xl"
                        style={{ background: `linear-gradient(135deg, rgba(232,93,58,0.12) 0%, rgba(232,93,58,0.04) 100%)`, borderLeft: "4px solid #E85D3A" }}
                      >
                        <div className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-primary text-white font-display font-bold shrink-0">
                          <span className="text-[10px] font-medium opacity-70 leading-none uppercase tracking-wider">Day</span>
                          <span className="text-xl leading-none font-bold">{day.dayNumber}</span>
                        </div>
                        <div>
                          <h2 className="font-serif text-xl font-bold text-foreground">{day.city}</h2>
                          <p className="text-sm text-muted-foreground mt-0.5">{day.theme}</p>
                        </div>
                      </div>
                    </div>

                    {/* print day header */}
                    <div className="print-legacy print-day-header">
                      <div className="print-day-number">{day.dayNumber}</div>
                      <div>
                        <div className="print-day-city">{day.city}</div>
                        <div className="print-day-theme">{day.theme}</div>
                      </div>
                    </div>

                    {/* activities */}
                    {isDayLocked(day.dayNumber) ? (
                      <div className="relative rounded-2xl border border-border overflow-hidden min-h-[220px]">
                        <div className="blur-sm pointer-events-none select-none opacity-25 p-5 flex flex-col gap-3">
                          {[1,2,3].map(i => (
                            <div key={i} className="h-20 bg-muted rounded-2xl"/>
                          ))}
                        </div>
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                            <Lock size={22} className="text-primary"/>
                          </div>
                          <p className="font-serif text-xl font-bold mb-1">Day {day.dayNumber} is locked</p>
                          <p className="text-sm text-muted-foreground mb-1">Subscribe to unlock all days for the group</p>
                          <p className="text-xs font-semibold text-primary mb-4">🎉 One purchase unlocks for everyone</p>
                          <div className="flex flex-col gap-2 w-full items-center">
                            <button
                              onClick={() => { setUpgradeReason(`Unlock all ${totalDays} days`); setShowUpgrade(true); }}
                              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors">
                              <Zap size={14}/> Subscribe · from $9.99/mo
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                    <div className="flex flex-col gap-3 pl-0 sm:pl-4">
                      <AnimatePresence>
                        {(day.activities||[]).map((act: any, ai: number) => {
                          const key = `${di}-${ai}`;
                          const isEditing = editingKey === key;
                          const borderColor = TAG_LEFT_BORDER[act.tag] || TAG_LEFT_BORDER.travel;
                          const tagBg = TAG_BG[act.tag] || TAG_BG.travel;
                          return (
                            <motion.div key={ai} layout initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} data-testid={`activity-${di+1}-${ai+1}`}>
                              {isEditing ? (
                                <ActivityEditor activity={act} onSave={u=>handleEditSave(di,ai,u)} onCancel={()=>setEditingKey(null)} tripCurrency={tripCurrency}/>
                              ) : (
                                <>
                                  {/* screen card */}
                                  <div className="no-print group relative bg-background border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200"
                                    style={{borderLeft:`4px solid ${borderColor}`}}>

                                    {/* action buttons */}
                                    <div className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all z-10">
                                      <button
                                        onClick={()=>{setAddingToDayIndex(null);setEditingKey(key);setRedoPanel(null);}}
                                        className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground"
                                        title="Edit activity" data-testid={`button-edit-activity-${di+1}-${ai+1}`}>
                                        <Edit2 size={14}/>
                                      </button>
                                      <button
                                        onClick={()=>setRedoPanel(redoPanel?.di===di&&redoPanel?.ai===ai?null:{di,ai,act})}
                                        className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground"
                                        title="Redo activity">
                                        <RotateCcw size={14}/>
                                      </button>
                                      <button
                                        onClick={()=>handleDeleteActivity(di,ai,act.name)}
                                        className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-400 transition-colors text-muted-foreground"
                                        title="Delete activity">
                                        <Trash2 size={14}/>
                                      </button>
                                    </div>

                                    {/* redo loading overlay */}
                                    {redoLoading===key&&(
                                      <div className="absolute inset-0 bg-background/80 backdrop-blur-[1px] rounded-2xl flex items-center justify-center z-20">
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                          <Loader2 size={16} className="animate-spin text-primary"/>
                                          <span>Finding a new activity…</span>
                                        </div>
                                      </div>
                                    )}

                                    <div className="p-5">
                                      {/* time row */}
                                      <div className="flex items-center gap-3 mb-3">
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                                          style={{ background: tagBg, color: borderColor }}>
                                          <Clock size={11}/>
                                          <span>{act.time}</span>
                                        </div>
                                        {act.fromWish && (
                                          <span className="flex items-center gap-1 text-xs text-primary font-medium">
                                            <Star size={11} className="fill-primary/30"/> From a wish
                                          </span>
                                        )}
                                      </div>

                                      {/* title row */}
                                      <h3 className="font-semibold text-base mb-2 pr-20">{act.name}</h3>

                                      {/* description */}
                                      <p className="text-sm text-muted-foreground leading-relaxed mb-4">{act.description}</p>

                                      {/* footer row */}
                                      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60">
                                        <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium capitalize ${TAG_COLORS[act.tag]||TAG_COLORS.travel}`}>
                                          {act.tag}
                                        </span>
                                        {(act.labels||[]).map((l: string, li: number) => (
                                          <span key={li} className="text-xs px-2.5 py-0.5 rounded-full border border-border text-muted-foreground">{l}</span>
                                        ))}
                                        {act.suggester && act.suggester !== "AI pick" && (
                                          <span className="text-xs text-muted-foreground/70 italic ml-1">by {act.suggester}</span>
                                        )}
                                        {!act.fromWish && act.matchedVibe && (
                                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">✦ {act.matchedVibe}</span>
                                        )}
                                        <div className="ml-auto flex items-center gap-1.5">
                                          {/* Cost — sits in the action row, same line as Reserve/Calendar/Maps */}
                                          <ActivityPrice activity={act} testId={`text-act-price-${di+1}-${ai+1}`}/>
                                          <a href={`https://www.viator.com/searchResults/all?text=${encodeURIComponent(`${act.name} ${day.city || trip?.destination || ""}`)}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-amber-200 text-amber-600 bg-amber-50 hover:bg-amber-100 transition-colors"
                                            title="Reserve on Viator" data-testid={`button-act-viator-${di+1}-${ai+1}`}>
                                            <Star size={11}/> Reserve
                                          </a>
                                          <a href={buildActivityMapsUrl(act, day, trip)} target="_blank" rel="noopener noreferrer"
                                            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                                            title="Open in Google Maps" data-testid={`button-act-maps-${di+1}-${ai+1}`}>
                                            <MapPin size={11}/> Maps
                                          </a>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* redo panel */}
                                  {redoPanel?.di===di&&redoPanel?.ai===ai&&(
                                    <motion.div initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}} className="no-print mt-1.5 border border-primary/20 rounded-xl p-3 bg-primary/5">
                                      <p className="text-xs font-medium text-muted-foreground mb-2">What would you like to change?</p>
                                      <div className="flex gap-2 flex-wrap">
                                        {getRedoOptions(act.tag).map(({label,redoType:rt},oi)=>(
                                          <button key={oi} onClick={()=>handleRedo(di,ai,act,rt)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors">
                                            <RotateCcw size={11}/>{label}
                                          </button>
                                        ))}
                                        <button onClick={()=>setRedoPanel(null)}
                                          className="px-3 py-1.5 text-xs text-muted-foreground rounded-lg border border-border hover:bg-muted/50 transition-colors">
                                          Cancel
                                        </button>
                                      </div>
                                    </motion.div>
                                  )}

                                  {/* print card */}
                                  <div className="print-legacy print-activity" style={{borderLeftColor:borderColor}}>
                                    <div style={{flex:1}}>
                                      <div className="print-activity-time">{act.time}{act.fromWish ? " · ★ From a wish" : ""}</div>
                                      <div className="print-activity-name">{act.name}</div>
                                      <div className="print-activity-desc">{act.description}</div>
                                      <div className="print-activity-meta">
                                        <span className={`print-tag print-tag-${act.tag||"travel"}`}>{act.tag||"travel"}</span>
                                        {(act.labels||[]).map((l: string, li: number) => (
                                          <span key={li} className="print-tag print-tag-travel">{l}</span>
                                        ))}
                                        {act.suggester && act.suggester !== "AI pick" && (
                                          <span style={{fontSize:11,color:"#9ca3af"}}>by {act.suggester}</span>
                                        )}
                                        {!act.fromWish && act.matchedVibe && (
                                          <span style={{fontSize:11,color:"#E85D3A",fontWeight:500}}>✦ {act.matchedVibe}</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="print-activity-right">
                                      <div className="print-cost"><ActivityPricePrint activity={act}/></div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>

                      {/* add activity */}
                      {addingToDayIndex === di ? (
                        <AddActivityForm dayIndex={di} onAdd={handleAddActivity} onCancel={()=>setAddingToDayIndex(null)} userName={user?.displayName || (trip?.members?.[user?.uid || ""]?.name) || "Member"} tripCurrency={tripCurrency}/>
                      ) : (
                        <button
                          onClick={()=>{setEditingKey(null);setAddingToDayIndex(di);}}
                          className="no-print flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-2.5 px-4 border border-dashed border-border rounded-xl hover:border-primary/40 hover:text-primary transition-colors"
                          data-testid={`button-add-activity-day-${di+1}`}>
                          <Plus size={15}/> Add activity to Day {day.dayNumber}
                        </button>
                      )}
                    </div>
                    )}
                  </motion.div>
                ))}
              </div>

              {/* print footer */}
              <div className="print-legacy print-footer">
                Packyo · AI-powered group travel planning · Itinerary generated for {trip?.destination}
              </div>

              {/* save bar */}
              {isDirty && (
                <div className="no-print mt-12 pt-6 border-t border-border flex justify-end">
                  <button onClick={saveChanges} disabled={saving}
                    className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50">
                    {saving ? <Loader2 size={16} className="animate-spin"/> : saveSuccess ? <Check size={16}/> : null}
                    {saving ? "Saving…" : saveSuccess ? "Saved!" : "Save changes"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {canShowItinerary && <PackyoPrintReport itinerary={localItinerary} trip={trip} />}
      </div>

      {/* ── Print preview overlay ── */}
      <AnimatePresence>
        {printPreview && canShowItinerary && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-gray-200 overflow-y-auto"
          >
            {/* Preview toolbar */}
            <div className="sticky top-0 z-10 bg-gray-800 text-white flex items-center justify-between px-6 py-3 shadow-lg">
              <div className="flex items-center gap-3">
                <Eye size={16} className="text-gray-400" />
                <span className="text-sm font-medium">PDF Preview</span>
                <span className="text-xs text-gray-400">This is exactly what your PDF will look like</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportPDF}
                  className="flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-primary/90 transition-colors"
                >
                  <FileDown size={14} /> Print / Save PDF
                </button>
                <button
                  onClick={() => setPrintPreview(false)}
                  className="flex items-center gap-1.5 text-gray-300 hover:text-white text-sm px-3 py-2 rounded-full hover:bg-gray-700 transition-colors"
                >
                  <X size={14} /> Close preview
                </button>
              </div>
            </div>

            {/* Simulated PDF page */}
            <div className="py-8 flex justify-center">
              <div className="w-[850px] max-w-full bg-white shadow-2xl" style={{fontFamily:"Georgia, serif"}}>

                {/* PDF Header (dark) */}
                <div style={{background:"#1a1a1a",color:"#fff",padding:"48px 48px 40px",display:"flex",alignItems:"flex-end",justifyContent:"space-between"}}>
                  <div>
                    <div style={{fontSize:22,fontWeight:700,letterSpacing:-0.5,opacity:0.6,fontFamily:"sans-serif"}}>
                      Packyo
                    </div>
                    <div style={{fontSize:38,fontWeight:700,lineHeight:1.15,margin:"16px 0 8px"}}>{localItinerary.title}</div>
                    <div style={{fontSize:15,opacity:0.6}}>{localItinerary.days?.length} days · {trip?.destination}</div>
                  </div>
                  <div style={{textAlign:"right",opacity:0.5,fontSize:13}}>
                    AI-generated itinerary<br/>Packyo
                  </div>
                </div>

                {/* PDF Content */}
                <div style={{padding:"40px 48px"}}>
                  {(localItinerary.days || []).map((day: any, di: number) => (
                    <div key={di} style={{marginBottom:40}}>
                      {/* Day header */}
                      <div style={{display:"flex",alignItems:"center",gap:16,padding:"14px 20px",background:"#E85D3A",color:"#fff",borderRadius:12,marginBottom:16}}>
                        <div style={{width:40,height:40,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:18,flexShrink:0}}>
                          {di+1}
                        </div>
                        <div>
                          <div style={{fontWeight:700,fontSize:18}}>{day.city || trip?.destination}</div>
                          {day.theme && <div style={{fontSize:13,opacity:0.85,marginTop:2}}>{day.theme}</div>}
                        </div>
                      </div>

                      {/* Activities */}
                      {(day.activities || []).map((act: any, ai: number) => {
                        const borderColor = TAG_LEFT_BORDER[act.tag || "travel"] || "#9ca3af";
                        return (
                          <div key={ai} style={{display:"flex",alignItems:"flex-start",gap:16,padding:"14px 16px",borderLeft:`4px solid ${borderColor}`,marginBottom:10,background:"#fafafa",borderRadius:"0 8px 8px 0"}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:12,color:"#9ca3af",marginBottom:4,fontFamily:"sans-serif"}}>{act.time}{act.fromWish ? " · ★ From a wish" : ""}</div>
                              <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>{act.name}</div>
                              <div style={{fontSize:13,color:"#6b7280",lineHeight:1.5,fontFamily:"sans-serif"}}>{act.description}</div>
                            </div>
                            <div style={{minWidth:72,textAlign:"right",fontWeight:600,fontSize:14,fontFamily:"sans-serif",color:"#374151"}}>
                              {act.estimatedCost === 0 ? "No entry fee" : typeof act.estimatedCost === "number" ? `~$${act.estimatedCost}` : "Estimate unavailable"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  {/* Footer */}
                  <div style={{textAlign:"center",color:"#9ca3af",fontSize:11,fontFamily:"sans-serif",paddingTop:24,borderTop:"1px solid #f3f4f6"}}>
                    Packyo · AI-powered group travel planning · Itinerary generated for {trip?.destination}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UpgradeModal
        open={showUpgrade}
        reason={upgradeReason}
        tripId={tripId}
        onClose={() => setShowUpgrade(false)}
      />
    </>
  );
}
