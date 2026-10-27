import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useRef } from "react";

import type {
  ExpenseInput,
  ExpenseLedger,
  SettlementInput,
} from "../../../lib/api-client-react/src/generated/api.schemas";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api-client";

export type {
  ExpenseInput,
  ExpenseLedger,
  ExpenseRecord,
  SettlementInput,
  SettlementRecord,
  ExpenseMemberBalance,
  ExpenseRepayment,
} from "../../../lib/api-client-react/src/generated/api.schemas";

export class ExpenseApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type TokenUser = { getIdToken: () => Promise<string> };

function newIdempotencyKey(): string {
  try { return Crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}

async function ledgerRequest(user: TokenUser | null, path: string, init?: RequestInit, idempotencyKey?: string): Promise<ExpenseLedger> {
  if (!user) throw new ExpenseApiError("Sign in to see shared expenses.", 401);
  // Fresh ID token per call; the server enforces membership, not this UI.
  const token = await user.getIdToken();
  const res = await apiFetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : `Request failed (${res.status}).`;
    throw new ExpenseApiError(message, res.status);
  }
  return body as ExpenseLedger;
}

export function expensesQueryKey(tripId: string | undefined) {
  return ["trip-expenses", tripId ?? ""] as const;
}

export function useTripExpenses(tripId: string | undefined, visible: boolean) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = expensesQueryKey(tripId);
  const base = `/api/trips/${encodeURIComponent(tripId ?? "")}`;
  const inFlight = useRef(false);

  const query = useQuery({
    queryKey: [...key, user?.uid ?? ""],
    queryFn: () => ledgerRequest(user, `${base}/expenses`),
    enabled: !!tripId && !!user && visible,
    refetchInterval: visible ? 10_000 : false,
    refetchIntervalInBackground: false,
    retry: (count, err) => !(err instanceof ExpenseApiError && err.status < 500) && count < 2,
  });

  const settle = async (ledger: ExpenseLedger) => {
    // Apply the authoritative ledger immediately, scoped to the signed-in uid.
    if (ledger && typeof ledger === "object") qc.setQueryData([...key, user?.uid ?? ""], ledger);
    await qc.invalidateQueries({ queryKey: key });
  };

  const guard = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (inFlight.current) throw new ExpenseApiError("Still saving the previous change.", 429);
    inFlight.current = true;
    try { return await fn(); } finally { inFlight.current = false; }
  };

  const onError = () => { qc.invalidateQueries({ queryKey: key }); };

  const create = useMutation({
    mutationFn: ({ input, key: k }: { input: ExpenseInput; key: string }) => guard(() => ledgerRequest(user, `${base}/expenses`, { method: "POST", body: JSON.stringify(input) }, k)),
    onSuccess: settle,
    onError,
  });
  const update = useMutation({
    mutationFn: ({ expenseId, input, key: k }: { expenseId: string; input: ExpenseInput; key: string }) =>
      guard(() => ledgerRequest(user, `${base}/expenses/${encodeURIComponent(expenseId)}`, { method: "PUT", body: JSON.stringify(input) }, k)),
    onSuccess: settle,
    onError,
  });
  const remove = useMutation({
    mutationFn: ({ expenseId, revision, key: k }: { expenseId: string; revision: number; key: string }) =>
      guard(() => ledgerRequest(user, `${base}/expenses/${encodeURIComponent(expenseId)}`, { method: "DELETE", body: JSON.stringify({ revision }) }, k)),
    onSuccess: settle,
    onError,
  });
  const recordSettlement = useMutation({
    mutationFn: ({ input, key: k }: { input: SettlementInput; key: string }) =>
      guard(() => ledgerRequest(user, `${base}/settlements`, { method: "POST", body: JSON.stringify(input) }, k)),
    onSuccess: settle,
    onError,
  });

  // One idempotency key per user action; React Query retries reuse the same variables/key.
  const createExpense = (input: ExpenseInput) => create.mutateAsync({ input, key: newIdempotencyKey() });
  const updateExpense = (expenseId: string, input: ExpenseInput) => update.mutateAsync({ expenseId, input, key: newIdempotencyKey() });
  const deleteExpense = (expenseId: string, revision: number) => remove.mutateAsync({ expenseId, revision, key: newIdempotencyKey() });
  const addSettlement = (input: SettlementInput) => recordSettlement.mutateAsync({ input, key: newIdempotencyKey() });

  return {
    ...query, ledger: query.data, create, update, remove, recordSettlement,
    createExpense, updateExpense, deleteExpense, addSettlement, currentUid: user?.uid,
  };
}
