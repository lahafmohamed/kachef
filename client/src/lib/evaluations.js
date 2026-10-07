// Évaluation des séances: what the séance tab, the list, the dashboard and the settings
// card share. The forms and their wording come from the server (server/evalPresets.js).

// Kinds of نشاط a form can be used for, in the order the settings list them
export const EVAL_KINDS = ['activity', 'leaders', 'group', 'visit'];
export const EVAL_KIND_KEYS = {
  activity: 'session.kindActivity',
  leaders: 'session.kindLeaders',
  group: 'session.kindGroup',
  visit: 'session.kindVisit',
};

// The association's marks: «تُعطى العلامة الكاملة إذا تحقّق المؤشر بالكامل، و تتناقص حسب
// مستوى تحقيقه» — 1 ضعيف … 5 ممتاز
export const SCALE = [1, 2, 3, 4, 5];
export const scaleKey = (n) => `eval.scale.${n}`;

/**
 * A form, an item or a preset in the reader's language, falling back to the other one:
 * an admin may write a criterion in one language only.
 */
export function evalText(obj, field, lng) {
  if (!obj) return '';
  const ar = obj[`${field}_ar`];
  const fr = obj[`${field}_fr`];
  return (lng === 'ar' ? ar || fr : fr || ar) || '';
}

/** 4.25 → «4,3» in French, «4.3» in Arabic (Latin digits, as everywhere in the app). */
export function fmtScore(v, lng) {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat(lng === 'ar' ? 'en-US' : 'fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(v);
}

/** The scale word an average rounds to — 4.3 reads «جيد جدًا / Très bien». */
export const gradeOf = (v) => (v === null || v === undefined ? null : Math.min(5, Math.max(1, Math.round(v))));

/**
 * Colour of a mark, repeating its word (never alone): good marks green, the middle
 * neutral, weak ones amber, and red for «ضعيف».
 */
export function scoreTone(v) {
  if (v === null || v === undefined) return { badge: 'outline', text: 'text-muted-foreground', bar: 'bg-muted-foreground/40' };
  if (v >= 3.5) return { badge: 'success', text: 'text-success', bar: 'bg-success' };
  if (v >= 2.5) return { badge: 'secondary', text: 'text-foreground', bar: 'bg-primary' };
  if (v >= 1.5) return { badge: 'warning', text: 'text-warning', bar: 'bg-warning' };
  return { badge: 'destructive', text: 'text-destructive', bar: 'bg-destructive' };
}

/**
 * The form's flat list cut into its محاور: an «axis» row opens a group, the rows after it
 * belong to it. Rows before the first axis form a group without a heading.
 */
export function groupByAxis(items) {
  const groups = [];
  for (const it of items) {
    if (it.type === 'axis') groups.push({ axis: it, items: [] });
    else {
      if (!groups.length) groups.push({ axis: null, items: [] });
      groups[groups.length - 1].items.push(it);
    }
  }
  return groups.filter((g) => g.items.length > 0);
}
