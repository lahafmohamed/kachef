import { toDate } from './date';
import { branchName } from '../utils';

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
    // A transfer between two boxes on screen moves nothing: neither in nor out
    if (r.direction === 'in' || r.direction === 'out') m[r.direction] += r.amount;
  }
  return months;
}
