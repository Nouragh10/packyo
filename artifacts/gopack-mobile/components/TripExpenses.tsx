import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { MemberAvatar } from "@/components/TripOverview";
import { useColors } from "@/hooks/useColors";
import type { Trip, TripMember } from "@/hooks/useFirebase";
import {
  ExpenseInput,
  ExpenseLedger,
  ExpenseRecord,
  useTripExpenses,
} from "@/hooks/useTripExpenses";
import {
  COMMON_CURRENCIES,
  formatMoney,
  formatShortDate,
  isValidCurrencyCode,
  isValidISODate,
  minorToInput,
  parseMoneyInput,
  todayISO,
} from "@/lib/expense-money";

const CATEGORIES = ["Food", "Accommodation", "Transportation", "Activities", "Shopping", "Other"] as const;
type Category = (typeof CATEGORIES)[number];
const CAT_ICON: Record<Category, keyof typeof Feather.glyphMap> = {
  Food: "coffee", Accommodation: "home", Transportation: "navigation", Activities: "tag", Shopping: "shopping-bag", Other: "more-horizontal",
};
const CAT_TINT: Record<Category, string> = {
  Food: "#FDE6DF", Accommodation: "#FDF0D8", Transportation: "#E1ECF8", Activities: "#FBE4DC", Shopping: "#EDE4F7", Other: "#ECE7E1",
};
const POS = "#2E9B63";

type MemberInfo = { id: string; name: string; photoURL?: string | null; index: number; current: boolean };

function confirmAction(title: string, message: string, onYes: () => void) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onYes },
  ]);
}

export function TripExpenses({ trip, tripId }: { trip: Trip; tripId: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const exp = useTripExpenses(tripId, true);
  const { ledger, currentUid } = exp;

  const [filter, setFilter] = useState<Category | "All">("All");
  const [filterOpen, setFilterOpen] = useState(false);
  const [form, setForm] = useState<{ editing: ExpenseRecord | null } | null>(null);
  const [detail, setDetail] = useState<ExpenseRecord | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [balancesOpen, setBalancesOpen] = useState(false);

  const members = useMemo<MemberInfo[]>(() => {
    const tripMembers = Object.entries(trip.members ?? {}) as [string, TripMember & { photoURL?: string | null }][];
    const map = new Map<string, MemberInfo>();
    tripMembers.forEach(([id, m], i) => map.set(id, { id, name: m.name, photoURL: m.photoURL, index: i, current: true }));
    (ledger?.members ?? []).forEach((m) => {
      if (!map.has(m.id)) map.set(m.id, { id: m.id, name: m.name, index: map.size, current: m.isCurrentMember });
    });
    return [...map.values()];
  }, [trip.members, ledger?.members]);

  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    if (!m) return "Former member";
    return id === currentUid ? `${m.name} (You)` : m.name;
  };

  if (exp.isLoading || (!ledger && !exp.error)) {
    return (
      <View style={{ padding: 16, gap: 12 }}>
        {[90, 220, 260].map((h, i) => <View key={i} style={{ height: h, borderRadius: 18, backgroundColor: colors.muted, opacity: 0.7 }} />)}
      </View>
    );
  }
  if (!ledger) {
    return (
      <View style={st.center}>
        <Feather name="alert-circle" size={28} color={colors.destructive} />
        <Text style={[st.title, { color: colors.foreground, marginTop: 10 }]}>Could not load expenses</Text>
        <Text style={[st.muted, { color: colors.mutedForeground, textAlign: "center" }]}>{(exp.error as Error)?.message}</Text>
        <Pressable onPress={() => exp.refetch()} style={[st.outlineBtn, { borderColor: colors.primary, marginTop: 14 }]}>
          <Text style={[st.btnText, { color: colors.primary }]}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const cur = ledger.currency;
  const me = ledger.members.find((m) => m.id === currentUid);
  const myBalance = me?.balanceMinor ?? 0;
  const visible = ledger.expenses
    .filter((e) => !e.deletedAt && (filter === "All" || e.category === filter))
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const balanceLabel = (v: number, self: boolean) =>
    v > 0 ? (self ? "Others owe you" : "Is owed") : v < 0 ? (self ? "You owe" : "Owes") : "Settled";

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 18 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={() => setBalancesOpen(true)} style={[st.summary, { backgroundColor: "#FDEEE8" }]}>
            <View style={[st.sumIcon, { backgroundColor: "#FBD9CD" }]}><Feather name="credit-card" size={18} color={colors.primary} /></View>
            <Text style={[st.sumLabel, { color: "#66564E" }]}>Total expenses</Text>
            <Text style={[st.sumValue, { color: "#28221E" }]} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(ledger.totalMinor, cur)}</Text>
          </Pressable>
          <Pressable onPress={() => setBalancesOpen(true)} style={[st.summary, { backgroundColor: myBalance >= 0 ? "#E7F4EA" : "#FDEEE8" }]}>
            <View style={[st.sumIcon, { backgroundColor: myBalance >= 0 ? "#CDE9D5" : "#FBD9CD" }]}><Feather name="user" size={18} color={myBalance >= 0 ? POS : colors.primary} /></View>
            <Text style={[st.sumLabel, { color: "#4C6252" }]}>Your balance</Text>
            <Text style={[st.sumValue, { color: myBalance > 0 ? "#247343" : myBalance < 0 ? "#B53720" : "#28221E" }]} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(myBalance, cur, { signed: true })}</Text>
            <Text style={[st.sumSub, { color: "#4C6252" }]}>{balanceLabel(myBalance, true)}</Text>
          </Pressable>
        </View>
        {me ? (
          <View style={[st.miniRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Mini label="You paid" value={formatMoney(me.paidMinor, cur)} />
            <Mini label="Your share" value={formatMoney(me.shareMinor, cur)} />
            <Mini label="Net" value={formatMoney(me.balanceMinor, cur, { signed: true })} />
          </View>
        ) : null}

        <View>
          <View style={st.head}>
            <Text style={[st.title, { color: colors.foreground }]}>Member balances</Text>
            <Pressable onPress={() => setBalancesOpen(true)} hitSlop={8}><Text style={[st.link, { color: colors.primary }]}>See all</Text></Pressable>
          </View>
          {ledger.members.slice(0, 5).map((m) => (
            <Pressable key={m.id} onPress={() => setBalancesOpen(true)} style={[st.row, { borderBottomColor: colors.border }]}>
              <MemberAvatar name={m.name} photoURL={members.find((x) => x.id === m.id)?.photoURL} index={members.find((x) => x.id === m.id)?.index ?? 0} />
              <Text style={[st.rowName, { color: colors.foreground }]} numberOfLines={1}>{nameOf(m.id)}{!m.isCurrentMember ? " · left" : ""}</Text>
              <Text style={[st.amt, { color: m.balanceMinor > 0 ? POS : m.balanceMinor < 0 ? colors.primary : colors.mutedForeground }]}>{formatMoney(m.balanceMinor, cur, { signed: true })}</Text>
              <Text style={[st.rowMeta, { color: colors.mutedForeground }]}>{balanceLabel(m.balanceMinor, m.id === currentUid)}</Text>
            </Pressable>
          ))}
        </View>

        <View>
          <View style={st.head}>
            <Text style={[st.title, { color: colors.foreground }]}>Recent expenses</Text>
            <Pressable onPress={() => setFilterOpen((v) => !v)} style={[st.filterBtn, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[st.filterText, { color: colors.foreground }]}>{filter === "All" ? "All categories" : filter}</Text>
              <Feather name={filterOpen ? "chevron-up" : "chevron-down"} size={14} color={colors.foreground} />
            </Pressable>
          </View>
          {filterOpen ? (
            <View style={[st.chips, { marginBottom: 8 }]}>
              {(["All", ...CATEGORIES] as const).map((c) => (
                <Chip key={c} label={c === "All" ? "All categories" : c} active={filter === c} onPress={() => { setFilter(c); setFilterOpen(false); }} />
              ))}
            </View>
          ) : null}
          {visible.length === 0 ? (
            <View style={[st.empty, { borderColor: colors.border }]}>
              <Feather name="file-text" size={22} color={colors.mutedForeground} />
              <Text style={[st.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
                {filter === "All" ? "No shared expenses yet. Log the first dinner, taxi or ticket." : `No ${filter.toLowerCase()} expenses yet.`}
              </Text>
            </View>
          ) : visible.slice(0, 30).map((e) => (
            <Pressable key={e.id} onPress={() => setDetail(e)} style={[st.row, { borderBottomColor: colors.border }]}>
              <View style={[st.catIcon, { backgroundColor: CAT_TINT[e.category as Category] ?? colors.muted }]}>
                <Feather name={CAT_ICON[e.category as Category] ?? "circle"} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.rowName, { color: colors.foreground }]} numberOfLines={1}>{e.title}</Text>
                <Text style={[st.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>Paid by {nameOf(e.payerId)} · {formatShortDate(e.date)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[st.amt, { color: colors.foreground }]}>{formatMoney(e.amountMinor, e.currency)}</Text>
                <Text style={[st.rowMeta, { color: colors.mutedForeground }]}>Split {e.participantIds.length} way{e.participantIds.length === 1 ? "" : "s"}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>

        {ledger.settlements.length ? (
          <View>
            <Text style={[st.title, { color: colors.foreground, marginBottom: 6 }]}>Recorded repayments</Text>
            {[...ledger.settlements].sort((a, b) => b.date.localeCompare(a.date)).map((x) => (
              <View key={x.id} style={[st.row, { borderBottomColor: colors.border }]}>
                <Feather name="check-circle" size={18} color={POS} />
                <Text style={[st.rowName, { color: colors.foreground }]} numberOfLines={2}>{nameOf(x.fromId)} paid {nameOf(x.toId)}</Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[st.amt, { color: colors.foreground }]}>{formatMoney(x.amountMinor, x.currency)}</Text>
                  <Text style={[st.rowMeta, { color: colors.mutedForeground }]}>{formatShortDate(x.date)}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={[st.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
          Packyo keeps a shared record. No money moves through the app.
        </Text>
      </ScrollView>

      <View style={[st.footer, { paddingBottom: Math.max(insets.bottom, Platform.OS === "web" ? 34 : 12), backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <Pressable onPress={() => setSettleOpen(true)} style={[st.outlineBtn, { borderColor: colors.primary, flex: 1 }]}>
          <Feather name="repeat" size={16} color={colors.primary} />
          <Text style={[st.btnText, { color: colors.primary }]}>Settle up</Text>
        </Pressable>
        <Pressable onPress={() => setForm({ editing: null })} style={[st.solidBtn, { backgroundColor: colors.primary, flex: 1.3 }]}>
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[st.btnText, { color: colors.primaryForeground }]}>Add expense</Text>
        </Pressable>
      </View>

      {form ? (
        <ExpenseForm
          ledger={ledger}
          members={members}
          currentUid={currentUid}
          editing={form.editing}
          onClose={() => setForm(null)}
          submit={async (input, editing) => {
            if (editing) await exp.updateExpense(editing.id, input);
            else await exp.createExpense(input);
          }}
        />
      ) : null}

      <Modal visible={!!detail} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetail(null)}>
        {detail ? (
          <ExpenseDetail
            expense={ledger.expenses.find((e) => e.id === detail.id) ?? detail}
            nameOf={nameOf}
            deleting={exp.remove.isPending}
            onClose={() => setDetail(null)}
            onEdit={(e) => { setDetail(null); setForm({ editing: e }); }}
            onDelete={(e) => confirmAction("Delete expense?", `"${e.title}" will be removed from everyone's balances.`, async () => {
              try {
                await exp.deleteExpense(e.id, e.revision);
                setDetail(null);
              } catch (err) {
                Alert.alert("Could not delete", (err as Error).message);
              }
            })}
          />
        ) : null}
      </Modal>

      <Modal visible={balancesOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setBalancesOpen(false)}>
        <Sheet title="Balances" onClose={() => setBalancesOpen(false)}>
          {ledger.members.map((m) => (
            <View key={m.id} style={[st.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <MemberAvatar name={m.name} photoURL={members.find((x) => x.id === m.id)?.photoURL} index={members.find((x) => x.id === m.id)?.index ?? 0} />
                <Text style={[st.rowName, { color: colors.foreground }]}>{nameOf(m.id)}{!m.isCurrentMember ? " · left trip" : ""}</Text>
              </View>
              <View style={[st.miniRow, { borderWidth: 0, padding: 0, marginTop: 10 }]}>
                <Mini label="Paid" value={formatMoney(m.paidMinor, cur)} />
                <Mini label="Share" value={formatMoney(m.shareMinor, cur)} />
                <Mini label="Net" value={formatMoney(m.balanceMinor, cur, { signed: true })} />
              </View>
            </View>
          ))}
          <Text style={[st.muted, { color: colors.mutedForeground }]}>Net is what each person paid minus their share, adjusted for recorded repayments. Positive means the group owes them.</Text>
        </Sheet>
      </Modal>

      {settleOpen ? (
        <SettleSheet
          ledger={ledger}
          members={members}
          nameOf={nameOf}
          currentUid={currentUid}
          onClose={() => setSettleOpen(false)}
          submit={(input) => exp.addSettlement(input).then(() => undefined)}
        />
      ) : null}
    </View>
  );

  function Mini({ label, value }: { label: string; value: string }) {
    return (
      <View style={{ flex: 1 }}>
        <Text style={[st.sumLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[st.amt, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      </View>
    );
  }
}

/* ── shared bits ─────────────────────────────────────────────────── */

function Chip({ label, active, onPress, disabled }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      disabled={disabled}
      style={[st.chip, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[st.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === "web" ? 24 : 0 }}>
      <View style={[st.sheetHead, { borderBottomColor: colors.border }]}>
        <Text style={[st.title, { color: colors.foreground, flex: 1 }]}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Feather name="x" size={22} color={colors.foreground} /></Pressable>
      </View>
      <KeyboardAwareScrollViewCompat bottomOffset={40} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        {children}
      </KeyboardAwareScrollViewCompat>
      {footer ? <View style={[st.footer, { position: "relative", paddingBottom: Math.max(insets.bottom, 16), borderTopColor: colors.border }]}>{footer}</View> : null}
    </View>
  );
}

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[st.label, { color: colors.mutedForeground }]}>{label}</Text>
      {children}
      {error ? <Text style={[st.err, { color: colors.destructive }]}>{error}</Text> : null}
    </View>
  );
}

function useInputStyle() {
  const colors = useColors();
  return [st.input, { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground }];
}

/* ── expense form ───────────────────────────────────────────────── */

function ExpenseForm({
  ledger, members, currentUid, editing, onClose, submit,
}: {
  ledger: ExpenseLedger;
  members: MemberInfo[];
  currentUid?: string;
  editing: ExpenseRecord | null;
  onClose: () => void;
  submit: (input: ExpenseInput, editing: ExpenseRecord | null) => Promise<void>;
}) {
  const colors = useColors();
  const inputStyle = useInputStyle();
  const currencyLocked = ledger.currencyLocked || ledger.expenses.length > 0 || ledger.settlements.length > 0;
  const [currency, setCurrency] = useState(editing?.currency ?? ledger.currency);
  const [customCur, setCustomCur] = useState("");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [amount, setAmount] = useState(editing ? minorToInput(editing.amountMinor, editing.currency) : "");
  const [category, setCategory] = useState<Category>((editing?.category as Category) ?? "Food");
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const current = members.filter((m) => m.current);
  const [payerId, setPayerId] = useState(editing?.payerId ?? (currentUid && current.some((m) => m.id === currentUid) ? currentUid : current[0]?.id ?? ""));
  const [participants, setParticipants] = useState<string[]>(editing?.participantIds ?? current.map((m) => m.id));
  const [split, setSplit] = useState<"equal" | "custom">(editing?.splitMethod ?? "equal");
  const [shares, setShares] = useState<Record<string, string>>(() => {
    if (!editing) return {};
    const out: Record<string, string> = {};
    Object.entries(editing.shares ?? {}).forEach(([k, v]) => { out[k] = minorToInput(v, editing.currency); });
    return out;
  });
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);

  // Keep members who left but were part of the edited expense selectable.
  const selectable = members.filter((m) => m.current || editing?.participantIds.includes(m.id) || editing?.payerId === m.id);

  const parsedAmount = parseMoneyInput(amount, currency);
  const customSum = participants.reduce((s, id) => {
    const p = parseMoneyInput(shares[id] ?? "", currency);
    return s + (p.ok ? p.minor : 0);
  }, 0);

  const toggle = (id: string) => setParticipants((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const onSave = async () => {
    if (busy) return;
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Give it a short name.";
    if (!isValidCurrencyCode(currency)) e.currency = "Pick a valid ISO currency code.";
    if (!parsedAmount.ok) e.amount = parsedAmount.error;
    else if (parsedAmount.minor <= 0) e.amount = "Amount must be more than zero.";
    if (!isValidISODate(date)) e.date = "Use YYYY-MM-DD.";
    if (!payerId) e.payer = "Choose who paid.";
    if (participants.length === 0) e.participants = "Pick at least one person.";
    let shareMap: Record<string, number> | undefined;
    if (split === "custom" && parsedAmount.ok) {
      shareMap = {};
      for (const id of participants) {
        const p = parseMoneyInput(shares[id] ?? "0", currency);
        if (!p.ok) { e.shares = `${members.find((m) => m.id === id)?.name ?? "Share"}: ${p.error}`; break; }
        shareMap[id] = p.minor;
      }
      if (!e.shares && customSum !== parsedAmount.minor) e.shares = `Shares add up to ${formatMoney(customSum, currency)}, not ${formatMoney(parsedAmount.minor, currency)}.`;
    }
    setErrors(e);
    if (Object.keys(e).length || !parsedAmount.ok) return;
    const input: ExpenseInput = {
      title: title.trim(),
      amountMinor: parsedAmount.minor,
      currency,
      category,
      date,
      payerId,
      participantIds: participants,
      splitMethod: split,
      ...(shareMap ? { shares: shareMap } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(editing ? { revision: editing.revision } : {}),
    };
    setBusy(true);
    setServerError("");
    try {
      await submit(input, editing);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
    } catch (err) {
      setServerError((err as Error).message || "Could not save this expense.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Sheet
        title={editing ? "Edit expense" : "Add expense"}
        onClose={onClose}
        footer={
          <Pressable onPress={onSave} disabled={busy} style={[st.solidBtn, { backgroundColor: colors.primary, flex: 1, opacity: busy ? 0.6 : 1 }]}>
            {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[st.btnText, { color: colors.primaryForeground }]}>{editing ? "Save changes" : "Add expense"}</Text>}
          </Pressable>
        }
      >
        {serverError ? <View style={[st.banner, { backgroundColor: "#FDECEC" }]}><Text style={[st.err, { color: colors.destructive }]}>{serverError}</Text></View> : null}
        <Field label="Title" error={errors.title}>
          <TextInput value={title} onChangeText={setTitle} placeholder="Dinner, taxi, tickets" placeholderTextColor={colors.mutedForeground} style={inputStyle} maxLength={80} />
        </Field>
        <Field label={`Amount (${currency})`} error={errors.amount}>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={minorToInput(0, currency)} placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        </Field>
        <Field label="Currency" error={errors.currency}>
          {currencyLocked || editing ? (
            <Text style={[st.muted, { color: colors.mutedForeground }]}>{currency} · fixed for this trip once the first entry is saved.</Text>
          ) : (
            <>
              <View style={st.chips}>
                {COMMON_CURRENCIES.map((c) => <Chip key={c} label={c} active={currency === c} onPress={() => { setCurrency(c); setCustomCur(""); }} />)}
              </View>
              <TextInput value={customCur} onChangeText={(t) => { const v = t.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3); setCustomCur(v); if (v.length === 3) setCurrency(v); }} placeholder="Other ISO code" autoCapitalize="characters" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
              <Text style={[st.muted, { color: colors.mutedForeground }]}>Choose carefully. The trip currency cannot change after the first entry.</Text>
            </>
          )}
        </Field>
        <Field label="Category">
          <View style={st.chips}>{CATEGORIES.map((c) => <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />)}</View>
        </Field>
        <Field label="Date" error={errors.date}>
          <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        </Field>
        <Field label="Paid by" error={errors.payer}>
          <View style={st.chips}>{selectable.map((m) => <Chip key={m.id} label={m.name + (m.current ? "" : " (left)")} active={payerId === m.id} onPress={() => setPayerId(m.id)} />)}</View>
        </Field>
        <Field label="Split between" error={errors.participants}>
          <View style={st.chips}>{selectable.map((m) => <Chip key={m.id} label={m.name + (m.current ? "" : " (left)")} active={participants.includes(m.id)} onPress={() => toggle(m.id)} />)}</View>
        </Field>
        <Field label="Split method" error={errors.shares}>
          <View style={st.chips}>
            <Chip label="Equal" active={split === "equal"} onPress={() => setSplit("equal")} />
            <Chip label="Custom amounts" active={split === "custom"} onPress={() => setSplit("custom")} />
          </View>
          {split === "equal" && parsedAmount.ok && participants.length ? (
            <Text style={[st.muted, { color: colors.mutedForeground }]}>About {formatMoney(Math.floor(parsedAmount.minor / participants.length), currency)} each. Any leftover minor unit is assigned by the server.</Text>
          ) : null}
          {split === "custom" ? (
            <View style={{ gap: 8 }}>
              {participants.map((id) => (
                <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={[st.rowName, { color: colors.foreground }]} numberOfLines={1}>{members.find((m) => m.id === id)?.name ?? "Member"}</Text>
                  <TextInput value={shares[id] ?? ""} onChangeText={(t) => setShares((s) => ({ ...s, [id]: t }))} keyboardType="decimal-pad" placeholder={minorToInput(0, currency)} placeholderTextColor={colors.mutedForeground} style={[inputStyle, { width: 120, textAlign: "right" }]} />
                </View>
              ))}
              {parsedAmount.ok ? (
                <Text style={[st.muted, { color: customSum === parsedAmount.minor ? POS : colors.mutedForeground }]}>
                  {customSum === parsedAmount.minor ? "Shares match the total." : `${formatMoney(parsedAmount.minor - customSum, currency, { signed: true })} left to assign.`}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Field>
        <Field label="Notes (optional)">
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Receipt number, what it covered" placeholderTextColor={colors.mutedForeground} style={[inputStyle, { minHeight: 80, textAlignVertical: "top" }]} maxLength={500} />
        </Field>
      </Sheet>
    </Modal>
  );
}

/* ── expense detail ─────────────────────────────────────────────── */

function ExpenseDetail({
  expense, nameOf, deleting, onClose, onEdit, onDelete,
}: {
  expense: ExpenseRecord;
  nameOf: (id: string) => string;
  deleting: boolean;
  onClose: () => void;
  onEdit: (e: ExpenseRecord) => void;
  onDelete: (e: ExpenseRecord) => void;
}) {
  const colors = useColors();
  return (
    <Sheet
      title={expense.title}
      onClose={onClose}
      footer={
        <>
          <Pressable onPress={() => onDelete(expense)} disabled={deleting} style={[st.outlineBtn, { borderColor: colors.destructive, flex: 1, opacity: deleting ? 0.5 : 1 }]}>
            <Feather name="trash-2" size={16} color={colors.destructive} />
            <Text style={[st.btnText, { color: colors.destructive }]}>{deleting ? "Deleting" : "Delete"}</Text>
          </Pressable>
          <Pressable onPress={() => onEdit(expense)} style={[st.solidBtn, { backgroundColor: colors.primary, flex: 1.3 }]}>
            <Feather name="edit-2" size={16} color={colors.primaryForeground} />
            <Text style={[st.btnText, { color: colors.primaryForeground }]}>Edit</Text>
          </Pressable>
        </>
      }
    >
      <Text style={[st.big, { color: colors.foreground }]}>{formatMoney(expense.amountMinor, expense.currency)}</Text>
      <Text style={[st.muted, { color: colors.mutedForeground }]}>{expense.category} · {formatShortDate(expense.date)} · {expense.splitMethod === "equal" ? "Equal split" : "Custom split"}</Text>
      <View style={[st.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[st.label, { color: colors.mutedForeground }]}>Paid by</Text>
        <Text style={[st.rowName, { color: colors.foreground }]}>{nameOf(expense.payerId)}</Text>
      </View>
      <View style={[st.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[st.label, { color: colors.mutedForeground, marginBottom: 4 }]}>Shares</Text>
        {expense.participantIds.map((id) => (
          <View key={id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
            <Text style={[st.rowMeta, { color: colors.foreground, fontSize: 14 }]}>{nameOf(id)}</Text>
            <Text style={[st.amt, { color: colors.foreground }]}>{formatMoney(expense.shares?.[id] ?? 0, expense.currency)}</Text>
          </View>
        ))}
      </View>
      {expense.notes ? (
        <View style={[st.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[st.label, { color: colors.mutedForeground }]}>Notes</Text>
          <Text style={[st.muted, { color: colors.foreground }]}>{expense.notes}</Text>
        </View>
      ) : null}
      <Text style={[st.muted, { color: colors.mutedForeground }]}>
        Added by {nameOf(expense.creatorId)} on {formatShortDate(expense.createdAt)}
        {expense.revision > 1 || expense.editorId !== expense.creatorId ? `. Last edited by ${nameOf(expense.editorId)} on ${formatShortDate(expense.updatedAt)}` : ""}.
      </Text>
    </Sheet>
  );
}

/* ── settle up ──────────────────────────────────────────────────── */

function SettleSheet({
  ledger, members, nameOf, currentUid, onClose, submit,
}: {
  ledger: ExpenseLedger;
  members: MemberInfo[];
  nameOf: (id: string) => string;
  currentUid?: string;
  onClose: () => void;
  submit: (input: { fromId: string; toId: string; amountMinor: number; currency: string; date: string }) => Promise<void>;
}) {
  const colors = useColors();
  const inputStyle = useInputStyle();
  const cur = ledger.currency;
  const bal = (id: string) => ledger.members.find((b) => b.id === id)?.balanceMinor ?? 0;
  const debtors = members.filter((m) => bal(m.id) < 0);
  const creditors = members.filter((m) => bal(m.id) > 0);
  const [fromId, setFromId] = useState(currentUid && bal(currentUid) < 0 ? currentUid : "");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const pick = (r: { fromId: string; toId: string; amountMinor: number }) => {
    setFromId(r.fromId); setToId(r.toId); setAmount(minorToInput(r.amountMinor, cur)); setDone(false);
  };

  const onRecord = async () => {
    if (busy) return;
    const p = parseMoneyInput(amount, cur);
    if (!fromId || !toId) return setError("Choose who paid and who received.");
    if (fromId === toId) return setError("Payer and receiver must be different people.");
    if (!p.ok) return setError(p.error);
    if (p.minor <= 0) return setError("Amount must be more than zero.");
    if (p.minor > Math.min(-bal(fromId), bal(toId))) return setError(`That is more than is outstanding (${formatMoney(Math.min(-bal(fromId), bal(toId)), cur)}).`);
    if (!isValidISODate(date)) return setError("Use YYYY-MM-DD for the date.");
    setError(""); setBusy(true);
    try {
      await submit({ fromId, toId, amountMinor: p.minor, currency: cur, date });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(true); setAmount(""); setToId("");
    } catch (err) {
      setError((err as Error).message || "Could not record the repayment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Sheet
        title="Settle up"
        onClose={onClose}
        footer={
          <Pressable onPress={onRecord} disabled={busy} style={[st.solidBtn, { backgroundColor: colors.primary, flex: 1, opacity: busy ? 0.6 : 1 }]}>
            {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[st.btnText, { color: colors.primaryForeground }]}>Record as paid</Text>}
          </Pressable>
        }
      >
        <View style={[st.banner, { backgroundColor: colors.secondary }]}>
          <Text style={[st.muted, { color: colors.foreground }]}>Pay each other however you like, then record it here. Only the payer, the recipient or the trip host can record a repayment. Packyo does not transfer money.</Text>
        </View>
        {done ? <View style={[st.banner, { backgroundColor: "#E7F4EA" }]}><Text style={[st.muted, { color: POS }]}>Repayment recorded. Balances updated.</Text></View> : null}
        <Text style={[st.title, { color: colors.foreground }]}>Suggested repayments</Text>
        {ledger.repayments.length === 0 ? (
          <Text style={[st.muted, { color: colors.mutedForeground }]}>Everyone is square. Nothing to settle.</Text>
        ) : ledger.repayments.map((r, i) => (
          <Pressable key={`${r.fromId}-${r.toId}-${i}`} onPress={() => pick(r)} style={[st.card, { borderColor: fromId === r.fromId && toId === r.toId ? colors.primary : colors.border, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[st.rowName, { color: colors.foreground }]}>{nameOf(r.fromId)} pays {nameOf(r.toId)}</Text>
              <Text style={[st.rowMeta, { color: colors.mutedForeground }]}>Suggestion · not yet paid</Text>
            </View>
            <Text style={[st.amt, { color: colors.primary }]}>{formatMoney(r.amountMinor, cur)}</Text>
          </Pressable>
        ))}
        <Field label="Who paid">
          <View style={st.chips}>{debtors.length ? debtors.map((m) => <Chip key={m.id} label={`${m.name} owes ${formatMoney(-bal(m.id), cur)}`} active={fromId === m.id} onPress={() => setFromId(m.id)} />) : <Text style={[st.muted, { color: colors.mutedForeground }]}>Nobody owes money right now.</Text>}</View>
        </Field>
        <Field label="Who received">
          <View style={st.chips}>{creditors.map((m) => <Chip key={m.id} label={`${m.name} is owed ${formatMoney(bal(m.id), cur)}`} active={toId === m.id} disabled={m.id === fromId} onPress={() => setToId(m.id)} />)}</View>
        </Field>
        <Field label={`Amount (${cur})`}>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={minorToInput(0, cur)} placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        </Field>
        <Field label="Date paid">
          <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        </Field>
        {error ? <Text style={[st.err, { color: colors.destructive }]}>{error}</Text> : null}
        {ledger.settlements.length ? (
          <>
            <Text style={[st.title, { color: colors.foreground, marginTop: 6 }]}>History</Text>
            {[...ledger.settlements].sort((a, b) => b.date.localeCompare(a.date)).map((x) => (
              <View key={x.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                <Text style={[st.rowMeta, { color: colors.foreground, fontSize: 14, flex: 1 }]}>{nameOf(x.fromId)} paid {nameOf(x.toId)} · {formatShortDate(x.date)} · recorded by {nameOf(x.creatorId)}</Text>
                <Text style={[st.amt, { color: colors.foreground }]}>{formatMoney(x.amountMinor, x.currency)}</Text>
              </View>
            ))}
          </>
        ) : null}
      </Sheet>
    </Modal>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 4 },
  title: { fontFamily: "DmSans_700Bold", fontSize: 17 },
  big: { fontFamily: "PlayfairDisplay_700Bold", fontSize: 34 },
  muted: { fontFamily: "DmSans_400Regular", fontSize: 13, lineHeight: 19 },
  link: { fontFamily: "DmSans_600SemiBold", fontSize: 13 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  summary: { flex: 1, borderRadius: 18, padding: 14, gap: 2 },
  sumIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  sumLabel: { fontFamily: "DmSans_500Medium", fontSize: 12 },
  sumValue: { fontFamily: "DmSans_700Bold", fontSize: 24 },
  sumSub: { fontFamily: "DmSans_400Regular", fontSize: 12 },
  miniRow: { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  rowName: { fontFamily: "DmSans_600SemiBold", fontSize: 15, flex: 1 },
  rowMeta: { fontFamily: "DmSans_400Regular", fontSize: 12, marginTop: 2 },
  amt: { fontFamily: "DmSans_700Bold", fontSize: 15 },
  catIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
  filterText: { fontFamily: "DmSans_500Medium", fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontFamily: "DmSans_500Medium", fontSize: 13 },
  empty: { borderWidth: 1, borderStyle: "dashed", borderRadius: 16, padding: 22, alignItems: "center", gap: 8, marginTop: 6 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  solidBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16 },
  btnText: { fontFamily: "DmSans_600SemiBold", fontSize: 15 },
  sheetHead: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  label: { fontFamily: "DmSans_600SemiBold", fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "DmSans_400Regular", fontSize: 15 },
  err: { fontFamily: "DmSans_500Medium", fontSize: 12 },
  banner: { borderRadius: 12, padding: 12 },
});
