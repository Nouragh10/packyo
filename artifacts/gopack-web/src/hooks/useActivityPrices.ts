import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";

type BatchResponse = {
  checked: number;
  verified: number;
  unavailable: number;
  remaining: number;
  nextCursor: number | null;
  busy?: boolean;
};

export type PriceCheckState = {
  running: boolean;
  manual: boolean;
  error: string | null;
  checked: number;
  verified: number;
  unavailable: number;
  remaining: number | null;
};

const MAX_BATCHES = 100;
const BUSY_RETRY_MS = 2000;
const IDLE: PriceCheckState = { running: false, manual: false, error: null, checked: 0, verified: 0, unavailable: 0, remaining: null };

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/**
 * Runs the source-backed activity price check for a trip itinerary or a public
 * review snapshot. Results land in Firebase; realtime listeners pick them up.
 * Auto-starts once per `autoKey` (e.g. an itinerary load), never blocks rendering.
 */
export function useActivityPrices(opts: {
  kind: "trip" | "review";
  id: string;
  user: User | null;
  autoKey?: string | null;
}) {
  const { kind, id, user, autoKey } = opts;
  const [state, setState] = useState<PriceCheckState>(IDLE);
  const runIdRef = useRef(0);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const autoStartedRef = useRef<string | null>(null);
  const scopeRef = useRef(`${kind}:${id}:${user?.uid ?? ""}`);
  scopeRef.current = `${kind}:${id}:${user?.uid ?? ""}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; runIdRef.current++; activeRef.current = false; };
  }, []);

  // Auth or target change: cancel any in-flight sequence.
  useEffect(() => {
    runIdRef.current++;
    activeRef.current = false;
    setState(IDLE);
  }, [kind, id, user?.uid]);

  const run = useCallback(async (manual: boolean) => {
    if (!user || !id) return;
    if (activeRef.current) {
      if (!manual) return;
      runIdRef.current++; // manual supersedes a background run
    }
    const runId = ++runIdRef.current;
    const scope = scopeRef.current;
    activeRef.current = true;
    const alive = () => mountedRef.current && runIdRef.current === runId && scopeRef.current === scope;
    setState({ ...IDLE, running: true, manual });
    const path = kind === "trip" ? `/api/trips/${encodeURIComponent(id)}/activity-prices` : `/api/reviews/${encodeURIComponent(id)}/activity-prices`;
    let cursor: number | undefined;
    let done = false;
    let totals = { checked: 0, verified: 0, unavailable: 0 };
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        if (!alive()) return;
        const token = await user.getIdToken();
        if (!alive()) return;
        const resp = await fetch(path, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...(manual ? { force: true } : {}), ...(cursor !== undefined ? { cursor } : {}) }),
        });
        if (!alive()) return;
        if (!resp.ok) {
          const err = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `Price check failed (${resp.status})`);
        }
        const data = (await resp.json()) as BatchResponse;
        if (!alive()) return;
        if (data.busy) {
          await sleep(BUSY_RETRY_MS);
          continue; // retry same cursor
        }
        totals = {
          checked: totals.checked + (data.checked || 0),
          verified: totals.verified + (data.verified || 0),
          unavailable: totals.unavailable + (data.unavailable || 0),
        };
        setState(s => ({ ...s, ...totals, remaining: data.remaining ?? null }));
        if (data.nextCursor === null || data.nextCursor === undefined) { done = true; break; }
        cursor = data.nextCursor;
      }
      if (!done) throw new Error("Price check stopped after too many batches. Try Verify prices again.");
      if (alive()) setState(s => ({ ...s, running: false }));
    } catch (e) {
      if (alive()) setState(s => ({ ...s, running: false, error: e instanceof Error ? e.message : "Price check failed" }));
    } finally {
      if (runIdRef.current === runId) activeRef.current = false;
    }
  }, [kind, id, user]);

  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!autoKey || !user || !id) return;
    const key = `${kind}:${id}:${user.uid}:${autoKey}`;
    if (autoStartedRef.current === key) return;
    // Defer a new venue key until the current lookup finishes; the effect
    // re-runs when `running` flips false.
    if (activeRef.current || state.running) return;
    autoStartedRef.current = key;
    void runRef.current(false);
  }, [autoKey, kind, id, user, state.running]);

  const verify = useCallback(() => { void runRef.current(true); }, []);

  return { ...state, verify };
}
