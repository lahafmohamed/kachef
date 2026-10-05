import { toDate } from './date';
import { branchName } from '../utils';

/**
 * الصناديق — the lists both the page and a نشاط's expenses card share. The server
 * accepts the same slugs (TREASURY_OUT / TREASURY_IN in server/index.js).
 */
export const OUT_CATEGORIES = ['gear', 'food', 'transport', 'venue', 'uniform', 'other'];
export const IN_CATEGORIES = ['donation', 'other'];

// Where a box's money came from and went, in the order its figures list them: a
// transfer from or to another box, and money given to or back from a camp, are one
// more line of each
export const INCOME_SOURCES = ['sessions', 'dues', 'donation', 'other', 'transfer', 'event'];
export const OUT_FIGURES = [...OUT_CATEGORIES, 'transfer', 'event'];

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
