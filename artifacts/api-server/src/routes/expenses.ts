import { Router, type IRouter } from "express";
import { getAuth } from "firebase-admin/auth";
import { randomUUID } from "node:crypto";
import { AddTripExpenseBody, RecordTripSettlementBody } from "@workspace/api-zod";
import type { ExpenseInput, SettlementInput } from "@workspace/api-zod";
import { getAdminApp, getAdminDb } from "../lib/firebase-admin";
import { buildLedger, ExpenseError, normalizeExpense, positiveMoney, validCurrency, validDate, validId, type Members, type PrivateLedger } from "../lib/expenses";

const router: IRouter = Router();

// This root has NO client read/write grant in the existing RTDB rules.
// Do not put financial data under trips: that branch permits all signed-in users.
const LEDGER_ROOT = "privateTripExpenseLedgers";

router.all(["/trips/:tripId/expenses", "/trips/:tripId/expenses/:expenseId", "/trips/:tripId/settlements"], async (req, res) => {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new ExpenseError("Sign in to manage trip expenses.", 401);
    let uid: string;
    try {
      uid = (await getAuth(getAdminApp()).verifyIdToken(token, true)).uid;
    } catch { throw new ExpenseError("Your sign-in expired. Please sign in again.", 401); }
    const tripId = String(req.params.tripId), expenseId = req.params.expenseId && String(req.params.expenseId);
    if (!validId(tripId) || (expenseId && !validId(expenseId))) throw new ExpenseError("Invalid trip or expense.", 400);
    const db = getAdminDb();
    const tripSnap = await db.ref(`trips/${tripId}`).get();
    const trip = tripSnap.val() as { members?: Members; hostMemberId?: string; currency?: string } | null;
    if (!trip?.members?.[uid]) throw new ExpenseError("Only current trip members can access these financial records.", 403);
    const members = trip.members;
    const ledgerRef = db.ref(`${LEDGER_ROOT}/${tripId}`);
    if (req.method === "GET" && !expenseId && req.path.endsWith("/expenses")) {
      const snap = await ledgerRef.get();
      const ledger = snap.val() as PrivateLedger | null;
      res.json(buildLedger(ledger ?? { currency: validCurrency(trip.currency ?? "USD") }, members, !!trip.currency));
      return;
    }
    const isSettlement = req.path.endsWith("/settlements");
    if (!(isSettlement ? req.method === "POST" : expenseId ? ["PUT", "DELETE"].includes(req.method) : req.method === "POST")) {
      res.status(405).json({ error: "Method not allowed." }); return;
    }
    let expenseInput: ExpenseInput | undefined, settlementInput: SettlementInput | undefined;
    if (isSettlement) {
      const parsed = RecordTripSettlementBody.safeParse(req.body);
      if (!parsed.success) throw new ExpenseError("Check the settlement fields and try again.");
      settlementInput = parsed.data;
    } else if (req.method !== "DELETE") {
      const parsed = AddTripExpenseBody.safeParse(req.body);
      if (!parsed.success) throw new ExpenseError("Check the expense fields and try again.");
      expenseInput = parsed.data;
    }
    const requestKey = req.get("Idempotency-Key");
    if (requestKey && !/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey)) throw new ExpenseError("Invalid request identifier.");
    const scopedKey = requestKey ? `${uid}_${requestKey}` : null;
    const recordId = expenseId || randomUUID(), historyId = randomUUID(), now = new Date().toISOString();
    let transactionError: ExpenseError | null = null;
    const result = await ledgerRef.transaction((current: PrivateLedger | null) => {
      transactionError = null;
      // The SDK may call the updater with an empty LOCAL cache first. Returning
      // undefined would abort an edit before it ever reads the server ledger.
      // A null CAS retries with the real value when the server has the record.
      if (!current && (expenseId || isSettlement)) {
        transactionError = expenseId
          ? new ExpenseError("This expense no longer exists.", 404)
          : new ExpenseError("There are no outstanding balances to settle.");
        return null;
      }
      try {
        if (scopedKey && current?.requests?.[scopedKey]) return current;
        const currency = current?.currency ?? validCurrency(trip.currency ?? expenseInput?.currency ?? settlementInput?.currency ?? "USD");
        const ledger: PrivateLedger = current ?? { currency };
        ledger.memberNames = { ...ledger.memberNames, ...Object.fromEntries(Object.entries(members).map(([id, m]) => [id, m.name])) };
        ledger.expenses ??= {}; ledger.settlements ??= {}; ledger.history ??= {};
        if (isSettlement && settlementInput) {
          const input = settlementInput;
          if (validCurrency(input.currency) !== currency) throw new ExpenseError(`Use the trip currency: ${currency}.`);
          const amountMinor = positiveMoney(input.amountMinor);
          if (!validId(input.fromId) || !validId(input.toId) || input.fromId === input.toId) throw new ExpenseError("Choose two different members.");
          if (![input.fromId, input.toId].includes(uid) && trip.hostMemberId !== uid) throw new ExpenseError("Only a participant or the trip creator can record this repayment.", 403);
          const summary = buildLedger(ledger, members);
          const from = summary.members.find(m => m.id === input.fromId), to = summary.members.find(m => m.id === input.toId);
          if (!from || !to || from.balanceMinor >= 0 || to.balanceMinor <= 0 ||
              amountMinor > Math.min(-from.balanceMinor, to.balanceMinor)) throw new ExpenseError("The repayment exceeds the outstanding balance.");
          const settlement = {
            id: recordId, tripId, creatorId: uid, createdAt: now, status: "completed" as const,
            fromId: input.fromId, toId: input.toId, amountMinor, currency, date: validDate(input.date),
          };
          ledger.settlements[recordId] = settlement;
          ledger.history[historyId] = { action: "settlement_completed", actorId: uid, at: now, recordId, after: settlement };
        } else {
          const old = ledger.expenses[recordId];
          if (expenseId) {
            if (!old || old.deletedAt) throw new ExpenseError("This expense no longer exists.", 404);
            if (old.creatorId !== uid && trip.hostMemberId !== uid) throw new ExpenseError("Only the expense creator or trip creator can edit or delete it.", 403);
            if (req.body?.revision !== old.revision) throw new ExpenseError("This expense changed. Refresh and try again.", 409);
          }
          if (req.method === "DELETE" && old) {
            const deleted = { ...old, deletedAt: now, updatedAt: now, editorId: uid, revision: old.revision + 1 };
            ledger.expenses[recordId] = deleted;
            ledger.history[historyId] = { action: "expense_deleted", actorId: uid, at: now, recordId, before: old, after: deleted };
          } else if (expenseInput) {
            const normalized = normalizeExpense(expenseInput, members, currency, old);
            const expense = { ...normalized, id: recordId, tripId, creatorId: old?.creatorId ?? uid, editorId: uid,
              createdAt: old?.createdAt ?? now, updatedAt: now, revision: (old?.revision ?? 0) + 1 };
            ledger.expenses[recordId] = expense;
            ledger.history[historyId] = { action: old ? "expense_edited" : "expense_created", actorId: uid, at: now, recordId, ...(old ? { before: old } : {}), after: expense };
          }
        }
        buildLedger(ledger, members); // Reject any unsafe integer aggregation before committing.
        if (scopedKey) { ledger.requests ??= {}; ledger.requests[scopedKey] = recordId; }
        return ledger;
      } catch (err) {
        transactionError = err instanceof ExpenseError ? err : new ExpenseError("Unable to save this ledger.");
        return undefined;
      }
    });
    if (transactionError) throw transactionError;
    if (!result.committed) throw new ExpenseError("The ledger changed. Please retry.", 409);
    res.status(req.method === "POST" ? 201 : 200).json(buildLedger(result.snapshot.val() as PrivateLedger, members, !!trip.currency));
  } catch (err) {
    if (err instanceof ExpenseError) { res.status(err.status).json({ error: err.message }); return; }
    req.log.error({ err }, "Expense request failed");
    res.status(500).json({ error: "Trip expenses are temporarily unavailable. Please try again." });
  }
});

export default router;
