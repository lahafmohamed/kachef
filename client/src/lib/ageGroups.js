/**
 * الطلائع حسب السنّ — توأم ageGroupFor في server/index.js، و يجب أن يبقيا متطابقين:
 * المعاينة و الاقتراح هنا، و القرار في الخادم.
 *
 * سنّ السنة: ما يبلغه العنصر في السنة الميلادية التي بدأت فيها السنة الكشفية (أيلول)،
 * أي سنة ميلاده. «من ٥ إلى ٦» = مواليد السنة التي يبلغون فيها الخامسة، طوال السنة.
 */

/** The calendar year the current scout year started in: September onwards, this year. */
export function ageYear(now = new Date()) {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

export const isAgeGroup = (g) => Number.isInteger(g?.age_from) && Number.isInteger(g?.age_to);

/**
 * The age group a birth date belongs to among a فرقة's groups, or null (no date, or no
 * group with an age range). Outside every range it takes the nearest one, so nobody
 * with a birth date is left without a group.
 */
export function ageGroupFor(birthDate, groups, year = ageYear()) {
  const born = Number(String(birthDate || '').slice(0, 4));
  if (!born) return null;
  const age = year - born;
  let best = null;
  let bestGap = Infinity;
  for (const g of groups.filter(isAgeGroup).sort((a, b) => a.age_from - b.age_from)) {
    const gap = age < g.age_from ? g.age_from - age : age >= g.age_to ? age - g.age_to + 1 : 0;
    if (gap < bestGap) {
      best = g;
      bestGap = gap;
    }
  }
  return best;
}

/** «2021» or «2020–2021»: the birth years a range takes in the given scout year. */
export function bornIn(group, year = ageYear()) {
  if (!isAgeGroup(group)) return '';
  const last = year - group.age_from;
  const first = year - group.age_to + 1;
  return first === last ? String(last) : `${first}–${last}`;
}
