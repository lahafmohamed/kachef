import { toDate } from './date';

// G1 : ce que la trésorerie, la feuille PDF et le classeur Excel des cotisations en
// retard lisent de la même façon.

// ar-LB gives the Levantine month names the فوج uses (as fmtDueMonth in LeaderDues)
const monthShort = (month, lng) =>
  new Intl.DateTimeFormat(lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR', { month: 'short' }).format(toDate(`${month}-01`));

/** «oct. 2026, nov. 2026» — the months still owed, oldest first */
export const arrearsMonths = (months, lng) =>
  months.map((m) => `${monthShort(m, lng)} ${m.slice(0, 4)}`).join(lng === 'ar' ? '، ' : ', ');

/** «?branch=&year=&current=» of the arrears route, from a sheet's id (فرقة, 0 = all) and query */
export const arrearsQuery = (id, sp) =>
  new URLSearchParams(
    Object.entries({
      branch: Number(id) ? String(id) : '',
      year: /^\d{4}$/.test(sp.get('year') || '') ? sp.get('year') : '',
      current: sp.get('current') === '1' ? '1' : '',
    }).filter(([, v]) => v)
  ).toString();

/** Groups arrears rows by فرقة, in the order the server sent them (فرقة, then debt) */
export function groupArrears(rows) {
  const out = [];
  for (const r of rows) {
    let g = out[out.length - 1];
    if (!g || g.id !== r.branch_id) {
      g = { id: r.branch_id, name_fr: r.branch_name_fr, name_ar: r.branch_name_ar, rows: [], amount: 0 };
      out.push(g);
    }
    g.rows.push(r);
    g.amount += r.owed;
  }
  return out;
}
