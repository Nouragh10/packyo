import assert from "node:assert/strict";
import test from "node:test";
import type { ExpenseInput, ExpenseRecord } from "@workspace/api-zod";
import { buildLedger, equalShares, normalizeExpense, validCurrency, validDate, validId, type PrivateLedger } from "./expenses";
import { accommodationRanking } from "./accommodation-votes";

const members = { a: { name: "A" }, b: { name: "B" }, c: { name: "C" } };
const input: ExpenseInput = {
  title: "Museum tickets", amountMinor: 1000, currency: "USD", category: "Activities",
  date: "2026-10-27", payerId: "a", participantIds: ["a", "b", "c"], splitMethod: "equal",
};
function expense(overrides: Partial<ExpenseInput> = {}): ExpenseRecord {
  return { ...normalizeExpense({ ...input, ...overrides }, members, "USD"), id: "e", tripId: "t",
    creatorId: "a", editorId: "a", createdAt: "2026-10-27", updatedAt: "2026-10-27", revision: 1 };
}
test("equal splits allocate every minor unit deterministically", () => {
  assert.deepEqual(equalShares(1000, ["c", "b", "a"]), { a: 334, b: 333, c: 333 });
  assert.deepEqual(equalShares(1, ["a", "b", "c"]), { a: 1, b: 0, c: 0 });
});
test("net balances reflect payer credit and allocated shares", () => {
  const ledger = buildLedger({ currency: "USD", expenses: { e: expense() } }, members);
  assert.equal(ledger.totalMinor, 1000);
  assert.deepEqual(ledger.members.map(m => m.balanceMinor), [666, -333, -333]);
  assert.equal(ledger.members.reduce((sum, m) => sum + m.balanceMinor, 0), 0);
  assert.equal(ledger.repayments.reduce((sum, s) => sum + s.amountMinor, 0), 666);
});
test("completed settlements credit debtor and debit creditor", () => {
  const raw: PrivateLedger = { currency: "USD", expenses: { e: expense() }, settlements: {
    s: { id: "s", tripId: "t", creatorId: "b", createdAt: "2026-10-27", status: "completed",
      date: "2026-10-27", currency: "USD", fromId: "b", toId: "a", amountMinor: 333 },
  } };
  const ledger = buildLedger(raw, members);
  assert.deepEqual(ledger.members.map(m => m.balanceMinor), [333, 0, -333]);
  assert.deepEqual(ledger.repayments, [{ fromId: "c", toId: "a", amountMinor: 333 }]);
});
test("leaving trip preserves the member's outstanding obligation", () => {
  const ledger = buildLedger({ currency: "USD", expenses: { e: expense() }, memberNames: { b: "B" } }, { a: members.a, c: members.c });
  assert.equal(ledger.members.find(m => m.id === "b")?.balanceMinor, -333);
  assert.equal(ledger.members.find(m => m.id === "b")?.isCurrentMember, false);
});
test("deleted expenses do not affect balances; edit/deletion history can remain", () => {
  const ledger = buildLedger({ currency: "USD", expenses: { e: { ...expense(), deletedAt: "2026-10-28" } } }, members);
  assert.equal(ledger.totalMinor, 0);
  assert.equal(ledger.expenses.length, 0);
  assert.equal(ledger.repayments.length, 0);
});
test("custom split must allocate precisely the expense total", () => {
  const custom = { ...input, splitMethod: "custom" as const, shares: { a: 0, b: 500, c: 500 } };
  assert.deepEqual(normalizeExpense(custom, members, "USD").shares, custom.shares);
  assert.throws(() => normalizeExpense({ ...custom, shares: { a: 0, b: 500, c: 499 } }, members, "USD"));
  assert.throws(() => normalizeExpense({ ...custom, shares: { a: -1, b: 501, c: 500 } }, members, "USD"));
  assert.throws(() => normalizeExpense({ ...custom, shares: { a: 0, b: 500, c: 500, d: 0 } }, members, "USD"));
});
test("invalid amounts and mixed currencies are rejected", () => {
  for (const amountMinor of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => normalizeExpense({ ...input, amountMinor }, members, "USD"));
  }
  assert.throws(() => normalizeExpense({ ...input, currency: "EUR" }, members, "USD"));
  assert.throws(() => validCurrency("ZZZ"));
  for (const currency of ["USD", "SAR", "JPY", "KWD", "CLF"]) assert.equal(validCurrency(currency), currency);
});
test("invalid members, duplicates and empty splits rejected", () => {
  for (const participantIds of [[], ["b", "b"], ["stranger"], ["a/b"]]) {
    assert.throws(() => normalizeExpense({ ...input, participantIds }, members, "USD"));
  }
  assert.throws(() => normalizeExpense({ ...input, payerId: "stranger" }, members, "USD"));
});
test("editing retains a departed participant without allowing an unknown person", () => {
  const old = expense();
  assert.doesNotThrow(() => normalizeExpense(input, { a: members.a }, "USD", old));
  assert.throws(() => normalizeExpense({ ...input, participantIds: ["a", "stranger"] }, { a: members.a }, "USD", old));
});
test("date and firebase path validation are strict", () => {
  assert.equal(validDate("2028-02-29"), "2028-02-29");
  for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "bad", "2026-1-1"]) assert.throws(() => validDate(value));
  for (const value of ["a/b", "a.b", "$bad", "", "a[0]"]) assert.equal(validId(value), false);
  assert.equal(validId("abc_123-foo"), true);
});
test("a tied accommodation ballot keeps all leaders; ignores departed voters", () => {
  const result = accommodationRanking({ members, accommodationSuggestions: [{ id: "s1", name: "First" }, { id: "s2", name: "Second" }],
    accommodationVotes: { 0: { a: "up", removed: "up" }, 1: { b: "up" } }, accommodationLockedBy: { a: true, b: true } });
  assert.equal(result.hasQuorum, true);
  assert.deepEqual(result.tiedIndices, [0, 1]);
  assert.deepEqual(result.scores, [1, 1]);
});
test("any vote or lock change invalidates the AI decision's ballot key", () => {
  const trip = { members, accommodationSuggestions: [{ id: "s1", name: "First" }, { id: "s2", name: "Second" }],
    accommodationVotes: { 0: { a: "up" }, 1: { b: "up" } }, accommodationLockedBy: { a: true, b: true } };
  const before = accommodationRanking(trip);
  assert.notEqual(accommodationRanking({ ...trip, accommodationLockedBy: { a: true, b: false } }).ballotKey, before.ballotKey);
  assert.notEqual(accommodationRanking({ ...trip, accommodationVotes: { ...trip.accommodationVotes, 0: { a: "down" } } }).ballotKey, before.ballotKey);
});
