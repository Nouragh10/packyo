import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api-client";

type Result = { checked: number; verified: number; unavailable: number; remaining: number; nextCursor: number | null; busy?: boolean };
const MAX_BATCHES = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives the server-side price verification cursor loop. Results are written to
 * Firebase by the server; the realtime listeners pick them up, so this hook only
 * reports progress. `autoKey` starts one background pass per itinerary load.
 */
export function useActivityPrices(kind: "trip" | "review", targetId: string | undefined, autoKey: string | null) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const genRef = useRef(0);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const autoStartedRef = useRef<Set<string>>(new Set());
  const ctxRef = useRef({ uid, targetId });
  ctxRef.current = { uid, targetId };
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; genRef.current++; };
  }, []);

  // Identity or target changed: abandon any in-flight sequence.
  useEffect(() => {
    genRef.current++;
    runningRef.current = false;
    setRunning(false);
    setError(null);
    setProgress(null);
  }, [uid, targetId]);

  const run = useCallback(async (force: boolean) => {
    const u = userRef.current;
    const id = ctxRef.current.targetId;
    if (!u || !id || runningRef.current) return;
    const gen = ++genRef.current;
    const startUid = u.uid;
    const alive = () => mountedRef.current && genRef.current === gen && ctxRef.current.uid === startUid && ctxRef.current.targetId === id;
    runningRef.current = true;
    setRunning(true); setError(null); setProgress("Checking source prices…");
    const path = kind === "trip" ? `/api/trips/${encodeURIComponent(id)}/activity-prices` : `/api/reviews/${encodeURIComponent(id)}/activity-prices`;
    let cursor: number | undefined;
    let finished = false;
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const token = await u.getIdToken();
        if (!alive()) return;
        const res = await apiFetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(cursor === undefined ? { force } : { force, cursor }),
        }, 180000);
        if (!alive()) return;
        if (!res.ok) throw new Error(`Price check failed (${res.status})`);
        const data = (await res.json()) as Result;
        if (!alive()) return;
        if (data.busy) { await sleep(2000); if (!alive()) return; continue; }
        setProgress(data.remaining > 0 ? `Checking… ${data.remaining} left` : "Finishing…");
        if (data.nextCursor === null || data.nextCursor === undefined) { finished = true; break; }
        cursor = data.nextCursor;
      }
      if (!finished && alive()) setError("Price check stopped before finishing. Tap Verify prices to retry.");
    } catch {
      if (alive()) setError("Couldn't verify prices right now. Try again.");
    } finally {
      if (genRef.current === gen) {
        runningRef.current = false;
        if (mountedRef.current) { setRunning(false); setProgress(null); }
      }
    }
  }, [kind]);

  useEffect(() => {
    if (!autoKey || !uid || !targetId) return;
    const key = `${uid}:${targetId}:${autoKey}`;
    if (autoStartedRef.current.has(key)) return;
    // Defer while a pass is running; this effect reruns when running flips false.
    if (runningRef.current || running) return;
    autoStartedRef.current.add(key);
    void run(false);
  }, [autoKey, uid, targetId, run, running]);

  const verifyNow = useCallback(() => {
    if (!userRef.current) { setError("Sign in to verify prices."); return; }
    if (runningRef.current) {
      // A background pass is running; replace it with a forced manual pass.
      genRef.current++;
      runningRef.current = false;
    }
    void run(true);
  }, [run]);

  return { running, error, progress, verifyNow };
}
