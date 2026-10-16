// كتالوج مطالب الفرقة: ما يعنيه كل رقم، مجاله من المجالات العشرة، و نوعه (قبول / تقدم).
// The numbers stay the key everywhere (sessions, بطاقات, member_matalib): the catalogue only
// names them, so a number without a line is still valid, just bare.
import { useFetch } from '../hooks';

// Same order and keys as MAJALAT in server/index.js
export const MAJALAT = [
  'religious',
  'civic',
  'national',
  'scouting',
  'arts',
  'health',
  'sports',
  'social',
  'environment',
  'science',
];
export const MATLAB_KINDS = ['admission', 'progress'];

/** The catalogue of one فرقة, `{ total, items }`, plus a number → line map. */
export function useMatalibCatalog(branchId) {
  const { data, loading, error, reload, setData } = useFetch(branchId ? `/branches/${branchId}/matalib` : null, {
    skip: !branchId,
  });
  const items = data?.items || [];
  return { data, items, byNumber: catalogMap(items), total: data?.total ?? null, loading, error, reload, setData };
}

export const catalogMap = (items = []) => new Map(items.map((it) => [it.number, it]));

/**
 * Per مجال: how many of the catalogued مطالب of that مجال are earned. Numbers without a
 * مجال are left out — a فرقة whose catalogue is still empty gets no rows at all.
 */
export function majalStats(items = [], earned = []) {
  const got = new Set(earned);
  const rows = [];
  for (const key of MAJALAT) {
    const of = items.filter((it) => it.majal === key);
    if (!of.length) continue;
    const done = of.filter((it) => got.has(it.number)).length;
    rows.push({ majal: key, total: of.length, earned: done, pct: Math.round((done / of.length) * 100) });
  }
  return rows;
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ًͯ-ْ]/g, '')
    .replace(/^ال/, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .trim();

/** A مجال typed by hand («الدينية», «ديني», «Religieux», «religious») → its key, or null. */
export function parseMajal(raw, t) {
  const v = norm(raw);
  if (!v) return null;
  for (const key of MAJALAT) {
    const names = [key, t(`matalib.majal.${key}`, { lng: 'ar' }), t(`matalib.majal.${key}`, { lng: 'fr' })].map(norm);
    if (names.some((n) => n && (n === v || n.startsWith(v) || v.startsWith(n)))) return key;
  }
  return null;
}

const parseKind = (raw) => (/قبول|admission|adm/i.test(String(raw || '')) ? 'admission' : 'progress');

/**
 * Lines pasted from a spreadsheet. Each line is either «رقم ⇥ نص ⇥ مجال ⇥ نوع» (tab, ; or |
 * separated, the last two optional) or the text alone, numbered by its line.
 * Returns the parsed lines and how many were left out (beyond the فرقة's total).
 */
export function parsePastedMatalib(text, total, t) {
  const out = [];
  let skipped = 0;
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  lines.forEach((line, i) => {
    const cols = line.split(/\t|;|\|/).map((c) => c.trim());
    let number;
    let rest;
    if (cols.length >= 2 && /^\d+$/.test(cols[0])) {
      number = Number(cols[0]);
      rest = cols.slice(1);
    } else {
      number = i + 1;
      rest = cols;
    }
    const label = rest[0];
    if (!label) return;
    if (number < 1 || (total && number > total)) {
      skipped += 1;
      return;
    }
    out.push({ number, label, majal: parseMajal(rest[1], t), kind: parseKind(rest[2]) });
  });
  return { items: out, skipped };
}
