import { toDate } from './date';

/**
 * الصندوق — the lists both the page and a نشاط's expenses card share. The server
 * accepts the same slugs (TREASURY_OUT / TREASURY_IN in server/index.js).
 */
export const OUT_CATEGORIES = ['gear', 'food', 'transport', 'venue', 'uniform', 'other'];
export const IN_CATEGORIES = ['donation', 'other'];

// Where the money came from, in the order the income figure lists it
export const INCOME_SOURCES = ['sessions', 'dues', 'donation', 'other'];

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
    m[r.direction] += r.amount;
  }
  return months;
}
