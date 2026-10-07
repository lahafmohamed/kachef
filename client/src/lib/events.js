import { fmtAmount, fmtDate, memberName } from '../utils';
import { toDate } from './date';
import { isFeminine } from '../api';

/**
 * المخيمات و الدورات — the lists and rules both pages share. The server accepts the
 * same slugs (EVENT_KINDS / EXPENSE_CATEGORIES in server/index.js) and counts the
 * payment states the same way in eventSummary.
 */
export const EVENT_KINDS = ['camp', 'course', 'trip', 'other'];
export const EXPENSE_CATEGORIES = ['transport', 'food', 'gear', 'venue', 'other'];

/**
 * الهيئة القيادية: the posts of a camp or course, in the order they are listed — as the
 * association's own course team (المدرّبون، المعاونون، أمين الإعلام، أمين السر، قائد
 * التجمع، أمين الصندوق). قائد المخيم himself is the event's leader_id. The first four
 * show as empty slots until someone holds them; the others are added when needed.
 */
export const STAFF_ROLES = ['gathering', 'secretary', 'media', 'treasurer', 'gear', 'trainer', 'assistant', 'medic', 'other'];
export const CORE_STAFF = ['gathering', 'secretary', 'media', 'treasurer'];

// قسم الفتيات says it in the feminine (قائدة التجمع، أمينة السر); French falls back to the plain key
const gendered = (t, key, section) => t(isFeminine(section) ? [`${key}F`, key] : key);

/** «قائد المخيم», «قائد الدورة», «قائد الرحلة» — by the kind of event */
export const chiefLabel = (t, kind, section) => gendered(t, `event.chief_${kind}`, section);

/** A post's name: from the list, or its own title for «مسؤولية أخرى» */
export const staffRoleLabel = (t, role, title, section) =>
  role === 'other' ? title : gendered(t, `event.role_${role}`, section);

// A tint per kind, so a دورة reads apart from a مخيم down the list
export const KIND_BADGE = { camp: 'default', course: 'info', trip: 'warning', other: 'secondary' };

/** What a participant is asked for: his own amount when set (0 = معفى), else the event's fee. */
export const dueOf = (p, ev) => p.amount_due ?? ev.fee ?? 0;

/** 'exempt' | 'free' | 'paid' | 'partial' | 'unpaid' */
export function payState(p, ev) {
  if (p.amount_due === 0) return 'exempt';
  const due = dueOf(p, ev);
  const paid = p.paid ?? 0;
  if (due === 0) return paid > 0 ? 'paid' : 'free';
  if (paid >= due) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

/** A balance carries its sign — «−2 500» reads as a deficit with or without colour. Show it in a dir="ltr" box. */
export const signed = (n) => (n > 0 ? `+${fmtAmount(n)}` : n < 0 ? `−${fmtAmount(-n)}` : fmtAmount(0));

export const PAY_BADGE ={ paid: 'success', partial: 'warning', unpaid: 'outline', exempt: 'info', free: 'outline' };

/** 'ongoing' | 'upcoming' | 'past', by the event's own days */
export function eventPhase(ev, today) {
  if (ev.end_date < today) return 'past';
  if (ev.start_date > today) return 'upcoming';
  return 'ongoing';
}

/**
 * «10/10/2026 – 12/10/2026», or a single date. No dir="ltr" island on purpose: in
 * Arabic the bidi algorithm already sets the first date on the right, where an
 * Arabic reader starts.
 */
export const fmtDateRange = (from, to) => (from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`);

// ar-LB: the Levantine month names (أيلول، تشرين…) the فوج uses, Latin digits
export const fmtMonthShort = (iso, lng) =>
  new Intl.DateTimeFormat(lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR', { month: 'short' }).format(toDate(iso));

/** 1-based day of `iso` inside the event: its first day is day 1 */
export const dayNumber = (ev, iso) => Math.round((toDate(iso) - toDate(ev.start_date)) / 86_400_000) + 1;

export const participantKind = (p) => (p.member_id ? 'member' : p.leader_id ? 'leader' : 'guest');
export const participantName = (p) => p.guest_name || memberName(p);
