import { todayISO } from '../utils';

/**
 * Does a séance count in the rates? The client copy of countedSessionSQL (server/index.js):
 * its présence was validated, or it is past and someone was marked present or excused.
 * Today's and upcoming séances count only once validated — every عنصر starts «absent», so
 * an untouched roster is a pointage not done, not a فرقة that stayed home.
 * The server sends `counted` on the séance lists; this only fills in where it does not.
 */
export function isCountedSession(s, today = todayISO()) {
  if (typeof s.counted === 'boolean') return s.counted;
  if (s.attendance_finalized_at) return true;
  const marked =
    (s.present_count || 0) + (s.excused_count || 0) + (s.present?.length || 0) + (s.excused?.length || 0);
  return s.date < today && marked > 0;
}

/** «Présence non confirmée»: a past séance to point that does not count. */
export const isUnconfirmedSession = (s, today = todayISO()) =>
  typeof s.unconfirmed === 'boolean'
    ? s.unconfirmed
    : (s.kind === 'activity' || s.kind === 'leaders') && s.date < today && !isCountedSession(s, today);
