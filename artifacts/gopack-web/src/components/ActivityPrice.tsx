import { DollarSign } from "lucide-react";

type Priced = { name?: string; estimatedCost?: number | null };

/** Plain-text price line safe for print, share, and exports. */
export function activityPriceText(activity: Priced): string {
  const cost = activity.estimatedCost;
  return typeof cost === "number" && Number.isFinite(cost)
    ? cost === 0 ? "No entry fee" : `~$${cost} / person`
    : "Estimate unavailable";
}

export function ActivityPrice({ activity, compact = false, testId }: { activity: Priced; compact?: boolean; testId?: string }) {
  return (
    <span className="inline-flex items-center gap-1" data-testid={testId}>
      <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border border-border/60 bg-muted/60 text-foreground/55 whitespace-nowrap">
        <DollarSign size={11} /> {activityPriceText(activity)}
      </span>
    </span>
  );
}

/** Print the same activity estimate shown in the app. */
export function ActivityPricePrint({ activity }: { activity: Priced }) {
  return (
    <span style={{ display: "block" }}>
      <span style={{ display: "block", fontWeight: 600 }}>{activityPriceText(activity)}</span>
    </span>
  );
}
