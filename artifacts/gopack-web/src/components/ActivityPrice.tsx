import { BadgeCheck, CircleHelp, ExternalLink, PenLine } from "lucide-react";
import { activityPricePresentation, type ActivityPricing } from "@workspace/activity-pricing";

type Priced = { name?: string; estimatedCost?: number | null; pricing?: ActivityPricing | null };

export function formatCheckedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

/** Plain-text price line safe for print, share, and exports. */
export function activityPriceText(activity: Priced): string {
  const p = activityPricePresentation(activity);
  const checked = formatCheckedDate(p.checkedAt);
  const parts = [p.label];
  if (p.verified && p.sourceUrl) parts.push(`Source: ${p.sourceTitle} (${p.sourceUrl})${checked ? `, checked ${checked}` : ""}`);
  return parts.join(" · ");
}

export function ActivityPrice({ activity, compact = false, testId }: { activity: Priced; compact?: boolean; testId?: string }) {
  const p = activityPricePresentation(activity);
  const userEntered = !p.verified && activity.pricing?.status === "user_entered" && p.label.endsWith("user-entered");
  const checked = formatCheckedDate(p.checkedAt);
  const tone = p.verified
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : userEntered
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-border/60 bg-muted/60 text-foreground/55";
  const Icon = p.verified ? BadgeCheck : userEntered ? PenLine : CircleHelp;
  const tip = [p.note, checked ? `Checked ${checked}` : null].filter(Boolean).join(" ");

  return (
    <span className="inline-flex items-center gap-1" data-testid={testId}>
      <span title={tip} className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${tone}`}>
        <Icon size={11} /> {p.label}
      </span>
      {!compact && p.verified && p.sourceUrl && (
        <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" title={`${p.sourceTitle}${checked ? ` · checked ${checked}` : ""}. ${p.note}`}
          className="flex items-center gap-0.5 text-[11px] text-emerald-700 hover:underline whitespace-nowrap">
          Source <ExternalLink size={10} />
        </a>
      )}
    </span>
  );
}

/** Print-friendly block: label, scope note, source and check date. */
export function ActivityPricePrint({ activity }: { activity: Priced }) {
  const p = activityPricePresentation(activity);
  const checked = formatCheckedDate(p.checkedAt);
  return (
    <span style={{ display: "block" }}>
      <span style={{ display: "block", fontWeight: 600 }}>{p.label}</span>
      {p.verified && p.sourceUrl ? (
        <span style={{ display: "block", fontSize: 10, color: "#6b7280", fontWeight: 400 }}>
          {p.sourceTitle}{checked ? ` · checked ${checked}` : ""}<br />{p.sourceUrl}<br />{p.note}
        </span>
      ) : (
        <span style={{ display: "block", fontSize: 10, color: "#9ca3af", fontWeight: 400 }}>{p.note}</span>
      )}
    </span>
  );
}
