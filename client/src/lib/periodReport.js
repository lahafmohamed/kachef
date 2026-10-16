// I1 : le rapport périodique à la قيادة — les périodes qu'on lui choisit et leur nom.
// Lu par le bouton (components/PeriodReport.jsx), la feuille PDF et le classeur Excel.
import { fmtDate, todayISO } from '../utils';
import { fmtMonth } from './treasury';

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** '2026-09' -> { from: '2026-09-01', to: '2026-09-30' } */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

/** '2026-Q3' -> juillet à septembre */
export function quarterRange(q) {
  const [y, n] = q.split('-Q').map(Number);
  const first = (n - 1) * 3 + 1;
  return { from: `${y}-${pad(first)}-01`, to: `${y}-${pad(first + 2)}-${pad(lastDay(y, first + 2))}` };
}

/** The month a report is usually about: the one that just ended */
export function previousMonth(today = todayISO()) {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** The last quarters, the one under way first: ['2026-Q4', '2026-Q3', …] */
export function recentQuarters(count = 5, today = todayISO()) {
  let y = Number(today.slice(0, 4));
  let n = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-Q${n}`);
    n -= 1;
    if (n === 0) {
      n = 4;
      y -= 1;
    }
  }
  return out;
}

/** «أيلول 2026», «T3 2026», or the two dates */
export function periodLabel(from, to, t, lng) {
  if (!from || !to) return '';
  if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && monthRange(from.slice(0, 7)).to === to)
    return fmtMonth(from, lng);
  const m = Number(from.slice(5, 7));
  if (from.endsWith('-01') && (m - 1) % 3 === 0) {
    const q = `${from.slice(0, 4)}-Q${(m - 1) / 3 + 1}`;
    if (quarterRange(q).to === to) return t('periodReport.quarterName', { n: (m - 1) / 3 + 1, year: from.slice(0, 4) });
  }
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

/** The filters the sheet and the workbook read: from, to, recipient */
export function periodQuery(sp) {
  const q = new URLSearchParams();
  for (const k of ['from', 'to']) if (sp.get(k)) q.set(k, sp.get(k));
  return q.toString();
}

/** A rate and how it moved against the period before: «72 % (+5)» */
export const rateDelta = (rate, prev) =>
  rate === null || rate === undefined || prev === null || prev === undefined ? null : rate - prev;
