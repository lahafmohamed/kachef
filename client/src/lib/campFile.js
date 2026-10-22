import { phoneNumbers } from '../components/MemberParts';
import { toDate } from './date';
import { dueOf, payState } from './events';

/**
 * E2 — le dossier de camp : la liste d'appel par فرقة puis طليعة, le عريف en tête, et les
 * restes à payer. La feuille PDF (PrintReport) et le classeur Excel (excelReports) lisent
 * la même page d'API (/events/:id) et la rangent ici de la même façon.
 */

// Le عريف d'abord : c'est le contact de la طليعة au camp (règlement de camp)
const ROLE_RANK = { arif_awwal: 0, arif: 1, musaid: 2 };

/** Âge en années pleines au premier jour du camp */
export function ageAt(birth, onIso) {
  if (!birth) return null;
  const b = toDate(birth);
  const d = toDate(onIso);
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return null;
  let age = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

/** Les numéros des parents : le père d'abord, puis la mère (marquée). Vide sans members.contact. */
export function parentPhones(p) {
  const out = [];
  for (const n of phoneNumbers(p.father_phone)) out.push({ number: n, mother: false });
  for (const n of phoneNumbers(p.mother_phone)) out.push({ number: n, mother: true });
  return out;
}

/** Les alertes santé d'un عنصر, en courtes lignes — rien quand la fiche n'est pas visible */
export function healthNotes(h, t) {
  if (!h) return [];
  const out = [];
  if (h.allergies) out.push(t('campFile.labelValue', { label: t('safety.allergies'), value: h.allergies }));
  if (h.treatment) out.push(t('campFile.labelValue', { label: t('safety.treatment'), value: h.treatment }));
  if (h.medical_notes) out.push(t('campFile.labelValue', { label: t('safety.medicalNotes'), value: h.medical_notes }));
  if (h.can_swim === false) out.push(t('safety.swimNo'));
  return out;
}

/** Contact d'urgence : «Nom · numéro» */
export function emergencyLine(h) {
  if (!h || (!h.emergency_name && !h.emergency_phone)) return null;
  return [h.emergency_name, h.emergency_phone].filter(Boolean).join(' · ');
}

/**
 * Les عناصر inscrits rangés pour l'appel : par فرقة (dans l'ordre du serveur), puis par طليعة
 * (les sans-طليعة à la fin), le عريف أول puis le عريف et le مساعد en tête, puis par nom.
 * [{ key, branch: p, groups: [{ key, name, people: [p] }] }]
 */
export function rosterByGroup(participants) {
  const branches = new Map();
  for (const p of participants.filter((x) => x.member_id)) {
    const bk = p.branch_id ?? 0;
    if (!branches.has(bk)) branches.set(bk, { key: bk, branch: p, groups: new Map() });
    const groups = branches.get(bk).groups;
    const gk = p.group_id ?? 0;
    if (!groups.has(gk)) groups.set(gk, { key: gk, name: p.group_name || null, people: [] });
    groups.get(gk).people.push(p);
  }
  return [...branches.values()].map((b) => ({
    ...b,
    groups: [...b.groups.values()]
      .sort((x, y) =>
        !x.name ? 1 : !y.name ? -1 : x.name.localeCompare(y.name, undefined, { numeric: true })
      )
      .map((g) => ({
        ...g,
        // Tri stable : à rang égal, l'ordre alphabétique du serveur reste
        people: [...g.people].sort((x, y) => (ROLE_RANK[x.member_role] ?? 9) - (ROLE_RANK[y.member_role] ?? 9)),
      })),
  }));
}

/** Ce qui reste à payer pour un participant (0 quand il est en règle ou exempté) */
export const remainingOf = (p, ev) => Math.max(dueOf(p, ev) - (p.paid ?? 0), 0);

/** Ceux qui doivent encore : non payé ou payé en partie, la plus grosse somme d'abord à rang égal */
export function unpaidOf(ev) {
  return (ev.participants || []).filter((p) => {
    const s = payState(p, ev);
    return (s === 'unpaid' || s === 'partial') && remainingOf(p, ev) > 0;
  });
}

/**
 * Le nombre de familles à appeler : des frères et sœurs partagent le numéro d'un parent,
 * un seul appel suffit. Même règle que le serveur (unpaid_families).
 */
export function familyCount(list) {
  const keys = new Set();
  for (const p of list) {
    const phone = phoneNumbers(p.father_phone)[0] || phoneNumbers(p.mother_phone)[0];
    keys.add(phone ? `t${phone}` : `p${p.id}`);
  }
  return keys.size;
}

/** Les numéros d'un قائد inscrit, sous la même forme que ceux des parents */
export const leaderPhones = (p) => phoneNumbers(p.leader_phone).map((number) => ({ number, mother: false }));

/** Qui appeler pour un participant : les parents d'un عنصر, le قائد lui-même */
export const contactPhones = (p) => (p.member_id ? parentPhones(p) : leaderPhones(p));

/**
 * La relance des impayés, famille par famille : des frères et sœurs partagent le numéro d'un
 * parent, un seul message pour tous (même clé que familyCount). La plus grosse somme d'abord.
 * [{ key, people: [p], phones: [{ number, mother }], amount }]
 */
export function unpaidFamilies(ev) {
  const families = new Map();
  for (const p of unpaidOf(ev)) {
    const phones = contactPhones(p);
    const key = phones[0] ? `t${phones[0].number}` : `p${p.id}`;
    if (!families.has(key)) families.set(key, { key, people: [], phones, amount: 0 });
    const f = families.get(key);
    f.people.push(p);
    f.amount += remainingOf(p, ev);
    // A brother's file may carry the other parent's number
    for (const ph of phones) if (!f.phones.some((x) => x.number === ph.number)) f.phones.push(ph);
  }
  return [...families.values()].sort((a, b) => b.amount - a.amount);
}
