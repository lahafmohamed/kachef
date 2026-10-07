import { isFeminine } from '../api';
import { fmtTime } from '../utils';
import { toDate } from './date';

/**
 * الاجتماعات — the lists both pages and the exports share. The server accepts the same
 * slugs (MEETING_KINDS / DECISION_STATUSES in server/index.js). The kinds carry the
 * association's own names (montadamahdi.net): مجلس قيادة الفوج، الجلسات الاختصاصية
 * للأمانات، جلسة تحضيرية، جلسة تقييمية…
 */
export const MEETING_KINDS = ['leaders', 'branch', 'amana', 'prep', 'review', 'parents', 'other'];
export const DECISION_STATUSES = ['open', 'done', 'dropped'];

// A tint per kind, so a meeting with the parents reads apart from the leaders' own
export const MEETING_KIND_BADGE = {
  leaders: 'default',
  branch: 'secondary',
  amana: 'secondary',
  prep: 'info',
  review: 'warning',
  parents: 'success',
  other: 'outline',
};

export const DECISION_BADGE = { open: 'outline', done: 'success', dropped: 'secondary' };

/** قسم الفتيات says it in the feminine (رئيسة الاجتماع، الحاضرات); a key without its …F twin falls back */
export const gendered = (t, key, section, opts) => t(isFeminine(section) ? [`${key}F`, key] : key, opts);

/** «18:00 – 19:30», «18:00», or '' when the hour was not written */
export const timeRange = (m) =>
  m.start_time && m.end_time ? `${fmtTime(m.start_time)} – ${fmtTime(m.end_time)}` : fmtTime(m.start_time);

/**
 * «samedi 3 octobre 2026» / «السبت، 3 تشرين الأول 2026»: minutes say the day in full.
 * ar-LB for the Levantine month names the فوج uses, Latin digits as everywhere else.
 */
export const fmtLongDate = (iso, lng) =>
  new Intl.DateTimeFormat(lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(toDate(iso));

/**
 * What a قائد typed, ready to show. An amount written the French way, «15 000», is two
 * numbers to the bidi algorithm once it sits in Arabic text — the line then reads «000
 * 15». A no-break space between the groups keeps it one number, as fmtAmount does.
 */
export const userText = (s) => (s ? String(s).replace(/(\d) (?=\d{3}(?!\d))/g, '$1 ') : s);

/** An open decision whose deadline has passed */
export const isOverdue = (d, today) => d.status === 'open' && !!d.due_date && d.due_date < today;

/** How many قادة came, missed it, or sent word — and the guests, who are always there */
export function attendanceCounts(attendees = []) {
  const c = { present: 0, absent: 0, excused: 0, guests: 0 };
  for (const a of attendees) {
    if (a.guest) c.guests++;
    else if (c[a.status] !== undefined) c[a.status]++;
  }
  return c;
}

/** The attendees of one state, guests apart: { present, absent, excused, guests } */
export function attendeesByStatus(attendees = []) {
  const out = { present: [], absent: [], excused: [], guests: [] };
  for (const a of attendees) (a.guest ? out.guests : out[a.status] || out.present).push(a);
  return out;
}

/** Decision counts of a meeting: how many, how many still to do, how many late */
export function decisionCounts(decisions = [], today) {
  return {
    total: decisions.length,
    open: decisions.filter((d) => d.status === 'open').length,
    overdue: decisions.filter((d) => isOverdue(d, today)).length,
    done: decisions.filter((d) => d.status === 'done').length,
  };
}
