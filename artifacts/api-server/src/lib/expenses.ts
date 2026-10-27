import type { ExpenseInput, ExpenseLedger, ExpenseRecord, SettlementRecord } from "@workspace/api-zod";

export class ExpenseError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface PrivateLedger {
  currency: string;
  expenses?: Record<string, ExpenseRecord>;
  settlements?: Record<string, SettlementRecord>;
  memberNames?: Record<string, string>;
  history?: Record<string, { action: string; actorId: string; at: string; recordId: string; before?: unknown; after?: unknown }>;
  requests?: Record<string, string>;
}
export type Members = Record<string, { name: string }>;
const MAX_AMOUNT = 1_000_000_000_000;

export function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[.#$[\]/\u0000-\u001f\u007f]/.test(value);
}
export function validCurrency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) throw new ExpenseError("Choose a valid currency.");
  // Intl accepts arbitrary three-letter strings; use its ISO currency registry too.
  if (!Intl.supportedValuesOf("currency").includes(value) && !["CLF", "UYW"].includes(value)) throw new ExpenseError("Unsupported currency.");
  return value;
}
export function positiveMoney(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_AMOUNT) {
    throw new ExpenseError("Enter a positive amount within the supported range.");
  }
  return value as number;
}
export function validDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new ExpenseError("Enter a valid date.");
  }
  return value;
}
export function equalShares(amount: number, ids: string[]): Record<string, number> {
  const sorted = [...ids].sort();
  const base = Math.floor(amount / sorted.length), remainder = amount % sorted.length;
  return Object.fromEntries(sorted.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
}
export function normalizeExpense(
  input: ExpenseInput, members: Members, currency: string, old?: ExpenseRecord,
): ExpenseInput & { shares: Record<string, number> } {
  const amountMinor = positiveMoney(input.amountMinor);
  if (validCurrency(input.currency) !== currency) throw new ExpenseError(`Use the trip currency: ${currency}.`);
  if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 160) {
    throw new ExpenseError("Enter a title of up to 160 characters.");
  }
  if (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 2000)) throw new ExpenseError("Notes must be under 2,000 characters.");
  if (!["Food", "Accommodation", "Transportation", "Activities", "Shopping", "Other"].includes(input.category)) throw new ExpenseError("Choose an expense category.");
  const allowed = new Set([...Object.keys(members), ...(old?.participantIds ?? []), ...(old ? [old.payerId] : [])]);
  const ids = input.participantIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length ||
      ids.some(id => !validId(id) || !allowed.has(id))) throw new ExpenseError("Select valid trip members to split between.");
  if (!validId(input.payerId) || !allowed.has(input.payerId)) throw new ExpenseError("Choose a valid payer.");
  let shares: Record<string, number>;
  if (input.splitMethod === "equal") {
    shares = equalShares(amountMinor, ids);
  } else if (input.splitMethod === "custom") {
    shares = input.shares ?? {};
    if (Object.keys(shares).length !== ids.length || Object.keys(shares).some(id => !ids.includes(id)) ||
        ids.some(id => !Number.isSafeInteger(shares[id]) || shares[id] < 0 || shares[id] > MAX_AMOUNT) ||
        ids.reduce((sum, id) => sum + shares[id], 0) !== amountMinor) {
      throw new ExpenseError("Custom shares must equal the expense total exactly.");
    }
  } else throw new ExpenseError("Choose an equal or custom split.");
  return {
    title: input.title.trim(), amountMinor, currency, category: input.category,
    date: validDate(input.date), payerId: input.payerId, participantIds: ids,
    splitMethod: input.splitMethod, shares, notes: input.notes?.trim() ?? "",
  };
}
function safeSum(a: number, b: number) {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new ExpenseError("The trip ledger exceeds the supported total.");
  return value;
}
export function buildLedger(raw: PrivateLedger, currentMembers: Members, fixedTripCurrency = false): ExpenseLedger {
  const expenses = Object.values(raw.expenses ?? {}).filter(e => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const settlements = Object.values(raw.settlements ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const balances = new Map<string, ExpenseLedger["members"][number]>();
  for (const [id, name] of Object.entries(raw.memberNames ?? {})) {
    balances.set(id, { id, name, paidMinor: 0, shareMinor: 0, balanceMinor: 0, isCurrentMember: !!currentMembers[id] });
  }
  for (const [id, member] of Object.entries(currentMembers)) {
    balances.set(id, { id, name: member.name, paidMinor: 0, shareMinor: 0, balanceMinor: 0, isCurrentMember: true });
  }
  const member = (id: string) => {
    if (!balances.has(id)) balances.set(id, { id, name: "Former member", paidMinor: 0, shareMinor: 0, balanceMinor: 0, isCurrentMember: false });
    return balances.get(id)!;
  };
  let totalMinor = 0;
  for (const expense of expenses) {
    totalMinor = safeSum(totalMinor, expense.amountMinor);
    const payer = member(expense.payerId);
    payer.paidMinor = safeSum(payer.paidMinor, expense.amountMinor);
    payer.balanceMinor = safeSum(payer.balanceMinor, expense.amountMinor);
    for (const [id, amount] of Object.entries(expense.shares)) {
      const person = member(id);
      person.shareMinor = safeSum(person.shareMinor, amount);
      person.balanceMinor = safeSum(person.balanceMinor, -amount);
    }
  }
  for (const settlement of settlements) {
    member(settlement.fromId).balanceMinor = safeSum(member(settlement.fromId).balanceMinor, settlement.amountMinor);
    member(settlement.toId).balanceMinor = safeSum(member(settlement.toId).balanceMinor, -settlement.amountMinor);
  }
  const members = [...balances.values()];
  const creditors = members.filter(m => m.balanceMinor > 0).map(m => ({ id: m.id, amount: m.balanceMinor }));
  const debtors = members.filter(m => m.balanceMinor < 0).map(m => ({ id: m.id, amount: -m.balanceMinor }));
  const repayments: ExpenseLedger["repayments"] = [];
  let c = 0, d = 0;
  while (c < creditors.length && d < debtors.length) {
    const amountMinor = Math.min(creditors[c].amount, debtors[d].amount);
    repayments.push({ fromId: debtors[d].id, toId: creditors[c].id, amountMinor });
    creditors[c].amount -= amountMinor; debtors[d].amount -= amountMinor;
    if (!creditors[c].amount) c++;
    if (!debtors[d].amount) d++;
  }
  return { currency: raw.currency,
    currencyLocked: fixedTripCurrency || Object.keys(raw.expenses ?? {}).length > 0 || Object.keys(raw.settlements ?? {}).length > 0,
    expenses, settlements, members, totalMinor, repayments };
}
