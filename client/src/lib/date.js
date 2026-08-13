/**
 * ISO <-> Date helpers shared by every date control.
 * Dates are anchored at local noon so a timezone offset can never shift the
 * calendar by a day.
 */
export const toDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`) : undefined);

export const toISO = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

/** Whole month, from the 1st to the last day — day 0 of the next month is that last day. */
export const monthStart = (year, month) => new Date(year, month, 1);
export const monthEnd = (year, month) => new Date(year, month + 1, 0);

/** Short month names in the active language (يناير…, janv.…) */
export const monthNames = (isAr) =>
  Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat(isAr ? 'ar' : 'fr', { month: 'short' }).format(new Date(2000, m, 1))
  );
