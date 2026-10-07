import { toDate } from './date';
import { branchName, fmtAmount, fmtDate } from '../utils';

/**
 * الصناديق — the lists both the page and a نشاط's expenses card share. The server
 * accepts the same slugs (TREASURY_OUT / TREASURY_IN in server/index.js).
 */
export const OUT_CATEGORIES = ['gear', 'food', 'transport', 'venue', 'uniform', 'other'];
export const IN_CATEGORIES = ['donation', 'other'];

// Where a box's money came from and went, in the order its figures list them: a
// transfer from or to another box, money given to or back from a camp, and what a
// count found more or less than the book are one more line of each. The عناصر' monthly
// dues come right after the نشاط fees, the قادة's after them.
export const INCOME_SOURCES = ['sessions', 'member_dues', 'dues', 'donation', 'other', 'transfer', 'event', 'count'];
export const OUT_FIGURES = [...OUT_CATEGORIES, 'transfer', 'event', 'count'];

/**
 * What the book says a caisse held at the end of a day — its start and its lines up to
 * then — as the server reckons it before a count. Redoing count `redo`, it and any later
 * count of that day are left out. null: the caisse had not started.
 */
export function bookBalanceOn(box, rows, date, redo = null) {
  if (!box?.start || !date || date < box.start.date) return null;
  let n = box.start.amount;
  for (const r of rows) {
    if (r.box !== box.key || r.date > date) continue;
    if (redo && r.source === 'count' && r.date === date && r.id >= redo.id) continue;
    n += r.direction === 'in' ? r.amount : -r.amount;
  }
  return Math.round(n * 100) / 100;
}

/**
 * A caisse's name: the فوج's — with its قسم when both are on screen — or its فرقة's.
 * `short`: «Groupe», for a tile, a tag or a list; `inline`: «la caisse du groupe», inside
 * a sentence; otherwise «Caisse du groupe».
 */
export function boxName(box, t, lng, { both = false, short = false, inline = false } = {}) {
  if (!box) return '';
  if (box.branch_id) return branchName(box, lng);
  const name = t(short ? 'treasury.groupShort' : inline ? 'treasury.groupBoxInline' : 'treasury.groupBox');
  return both ? `${name} · ${t(`section.${box.section}`)}` : name;
}

// ar-LB: the Levantine month names (أيلول، تشرين…) the فوج uses, Latin digits
const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');

/** «تشرين الأول 2026», «Octobre 2026» — a journal's month heading */
export function fmtMonth(iso, lng) {
  const s = new Intl.DateTimeFormat(intlLocale(lng), { month: 'long', year: 'numeric' })
    .format(toDate(`${iso.slice(0, 7)}-01`))
    .replace(/[‎‏؜]/g, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A نشاط's own money in a caisse: its اشتراكات, and what was given or spent for it. The
// monthly dues taken during it pay the month, not the نشاط: they keep their own line.
const ofSession = (r) => r.session_id && (r.source === 'session' || r.source === 'entry');

// Within a نشاط: its اشتراكات, its تبرعات, then its مصاريف — those still owed last
const itemOrder = (r) => (r.source === 'session' ? 0 : r.direction === 'in' ? 1 : r.paid_on === null ? 3 : 2);

/**
 * Each نشاط as one line, on its day: what came in, what went out and what it left — as
 * its own page reckons it, a مصروف still owed counted with the others (`owed`: those of
 * the نشاط, from the «À payer» list). `items`: its movements, opened on demand. A مصروف
 * paid later stays with its نشاط; `in` / `out` are what moved the caisse, for the
 * month's figures. Every other line stays as it is.
 */
export function bySession(rows, owed = []) {
  const groups = new Map();
  const out = [];
  for (const r of rows) {
    if (!ofSession(r)) {
      out.push(r);
      continue;
    }
    let g = groups.get(r.session_id);
    if (!g) {
      g = {
        key: `x${r.session_id}`,
        source: 'session_group',
        section: r.section,
        box: r.box,
        session_id: r.session_id,
        session_title: r.session_title ?? r.label,
        in: 0,
        out: 0,
        owed: 0,
        items: [],
      };
      groups.set(r.session_id, g);
      out.push(g);
    }
    g.items.push(r);
    g[r.direction] += r.amount;
  }
  for (const x of owed) {
    const g = groups.get(x.session_id);
    if (!g) continue;
    g.items.push(x);
    g.owed += x.amount;
  }
  for (const g of groups.values()) {
    // Its day: that of its اشتراكات, else the earliest one written for it
    const fees = g.items.find((r) => r.source === 'session');
    g.date = fees ? fees.date : g.items.map((r) => r.spent_on ?? r.date).sort()[0];
    g.result = g.in - g.out - g.owed;
    g.items.sort((a, b) => itemOrder(a) - itemOrder(b));
  }
  // Latest day first, a نشاط in its day's place; within a day its count still on top,
  // the rest as they came
  return out.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.source === 'count') - (a.source === 'count')
  );
}

/** Rows (latest first) cut into months, each with what came in and went out */
export function byMonth(rows) {
  const months = [];
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    let m = months[months.length - 1];
    if (!m || m.key !== key) {
      m = { key, rows: [], in: 0, out: 0 };
      months.push(m);
    }
    m.rows.push(r);
    // A transfer between two boxes on screen moves nothing: neither in nor out. A نشاط
    // brings what moved the caisse both ways.
    if (r.source === 'session_group') {
      m.in += r.in;
      m.out += r.out;
    } else if (r.direction === 'in' || r.direction === 'out') m[r.direction] += r.amount;
  }
  return months;
}

export const FLOWS = ['in', 'out'];

/**
 * What the الصناديق page shows for the caisse picked in its address (`box`; none: all of
 * them together, or the only one there is) and a direction (`flow`: 'in', 'out' or ''):
 * the page and its PDF read the same lines. All together, a transfer between two of
 * them is one line that moves nothing; each نشاط is one line, its مصاريف still owed
 * counted in its result — not once only one direction is shown.
 */
export function ledgerView(data, { box = '', flow = '' } = {}) {
  const boxes = data?.boxes || [];
  const byKey = Object.fromEntries(boxes.map((b) => [b.key, b]));
  const held = boxes.filter((b) => b.visible);
  const multi = held.length > 1;
  const sel = byKey[box]?.visible ? byKey[box] : multi ? null : held[0] || null;
  const viewRows = (data?.rows || [])
    .filter((r) => (sel ? r.box === sel.key : !(r.internal && r.direction === 'in')))
    .map((r) => (!sel && r.internal ? { ...r, direction: 'move' } : r));
  const owed = (data?.owed || []).filter((x) => !sel || x.box === sel.key);
  const rows = bySession(
    viewRows.filter((r) => !flow || r.direction === flow),
    flow ? [] : owed
  );
  return { boxes, byKey, held, multi, sel, owed, rows, months: byMonth(rows), fig: sel || data?.summary };
}

/**
 * What one journal line says — its title and its facts — and how it moves its caisse;
 * the page and the PDF word it the same. `names.short(key)` / `names.inline(key)` name a
 * caisse. `nested`: a line opened under its نشاط, which already says the day and the
 * نشاط. A مصروف still owed has not left its caisse.
 */
export function rowText(r, { t, lng, names, nested = false }) {
  const isIn = r.direction === 'in';
  const move = r.direction === 'move';
  const owed = r.source === 'entry' && !isIn && r.paid_on === null;
  const title =
    r.source === 'transfer'
      ? move
        ? t('treasury.transferRowBetween', { from: names.short(r.from), to: names.short(r.to) })
        : isIn
          ? t('treasury.transferRowFrom', { name: names.inline(r.from) })
          : t('treasury.transferRowTo', { name: names.inline(r.to) })
      : r.source === 'count'
        ? t(isIn ? 'treasury.countRowIn' : 'treasury.countRowOut')
        : r.source === 'event'
          ? r.event_title || t('treasury.eventDeleted')
          : r.source === 'session'
            ? nested
              ? t('treasury.sessionFees')
              : r.label
            : r.source === 'dues'
              ? t('treasury.duesRow')
              : r.source === 'member_dues'
                ? t('treasury.memberDuesRow')
                : r.label || t(r.category === 'donation' ? 'treasury.donation' : 'treasury.otherIncome');
  const meta = nested ? [] : [fmtDate(r.date)];
  if (r.source === 'count') {
    meta.push(r.label, t('treasury.countedRow', { amount: fmtAmount(r.counted) }));
    if (r.created_by) meta.push(t('treasury.recordedBy', { name: r.created_by }));
  } else if (r.source === 'event') {
    if (r.event_kind) meta.push(t(`event.kind_${r.event_kind}`));
    meta.push(t(isIn ? 'treasury.eventIn' : 'treasury.eventOut'));
    if (r.label) meta.push(r.label);
    if (r.created_by) meta.push(t('treasury.recordedBy', { name: r.created_by }));
  } else if (r.source === 'transfer') {
    if (r.label) meta.push(r.label);
    if (r.created_by) meta.push(t('treasury.recordedBy', { name: r.created_by }));
  } else if (r.source === 'session') {
    if (!nested) meta.push(t('treasury.sessionFees'));
    meta.push(t('treasury.payers', { count: r.payers }));
  } else if (r.source === 'dues') {
    // A whole month of اشتراكات can land on one day: three names, then how many more
    const months = r.leaders.reduce((n, l) => n + l.months, 0);
    const who = r.leaders
      .slice(0, 3)
      .map((l) => l.name)
      .join(lng === 'ar' ? '، ' : ', ');
    // «+2» isolated left-to-right: after Arabic names it would otherwise read «2+»
    const more = r.leaders.length - 3;
    meta.push(t('treasury.monthsPaid', { count: months }), more > 0 ? `${who} ⁦+${more}⁩` : who);
  } else if (r.source === 'member_dues') {
    // Taken in a نشاط: its title says where. Then the months it was given for — whole
    // or in part: 500 for October is October's — and who gave it
    if (r.session_title) meta.push(t('treasury.forSession', { title: r.session_title }));
    const months = r.members.reduce((n, m) => n + m.months, 0);
    const named = r.members.filter((m) => m.name);
    const who = named
      .slice(0, 3)
      .map((m) => m.name)
      .join(lng === 'ar' ? '، ' : ', ');
    const more = named.length - 3;
    meta.push(t('treasury.duesMonths', { count: months }));
    if (who) meta.push(more > 0 ? `${who} ⁦+${more}⁩` : who);
  } else {
    // An unnamed تبرّع is already titled «تبرّع»: its kind would only repeat it
    if (!isIn || r.label) meta.push(t(isIn ? `treasury.type_${r.category}` : `treasury.cat_${r.category}`));
    if (r.owed_to) meta.push(t(owed ? 'treasury.owedRowTo' : 'treasury.paidRowTo', { name: r.owed_to }));
    // Under its نشاط, whose day the line already says: the day it was paid, when later
    if (nested) {
      if (r.paid_on && r.paid_on !== r.spent_on) meta.push(t('treasury.paidOnRow', { date: fmtDate(r.paid_on) }));
    } else if (r.spent_on !== r.date) meta.push(t('treasury.spentOn', { date: fmtDate(r.spent_on) }));
    if (r.session_title && !nested) meta.push(t('treasury.forSession', { title: r.session_title }));
    if (r.created_by) meta.push(t('treasury.recordedBy', { name: r.created_by }));
  }
  return { title, meta, isIn, move, owed };
}

/**
 * The facts under a نشاط's line: its day, then what it brought in and spent — or, the
 * journal showing one direction only, that side and how many movements make it.
 */
export function sessionMeta(g, flow, t) {
  const meta = [fmtDate(g.date)];
  if (flow === 'in') meta.push(t('treasury.sessionIncome'), t('treasury.movementCount', { count: g.items.length }));
  else if (flow === 'out') meta.push(t('treasury.sessionExpenses'), t('treasury.expenseCount', { count: g.items.length }));
  else {
    const spent = g.out + g.owed;
    if (g.in > 0) meta.push(t('treasury.sessionInRow', { amount: fmtAmount(g.in) }));
    if (spent > 0) meta.push(t('treasury.sessionOutRow', { amount: fmtAmount(spent) }));
    if (g.owed > 0) meta.push(t('treasury.sessionOwed', { amount: fmtAmount(g.owed) }));
  }
  return meta;
}

/**
 * A نشاط's result named and coloured: «Gain», «Déficit» or «À l'équilibre». The word
 * says it, the colour repeats it — the list and the نشاط's page read it the same way.
 */
export const resultTone = (n) =>
  n > 0
    ? { key: 'session.moneyGain', className: 'text-success' }
    : n < 0
      ? { key: 'session.moneyLoss', className: 'text-destructive' }
      : { key: 'session.moneyEven', className: 'text-muted-foreground' };
