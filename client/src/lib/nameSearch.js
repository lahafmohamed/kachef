/**
 * Name search that reads across scripts and word order.
 *
 * A قائد types «mohamed lahaf» and expects محمد علي الحاف: the name written in Arabic,
 * the father's name left out, the words in any order. So a query is cut into words,
 * and every word has to find a word of the name that it can be read as:
 *
 * - same script: as a prefix, with the spellings that hide the same name folded
 *   together (أحمد / احمد, مروة / مروه, باجوق / باجوك, Mohamed / Mohammad);
 * - Latin against Arabic (or the reverse): by walking the Arabic word letter by
 *   letter and asking what each letter may be written as in Latin. ح is «h» or «7»,
 *   ش is «sh» or «ch», a written long vowel must show up as a vowel, and the short
 *   vowels Arabic leaves out may appear as at most one vowel between two letters.
 *   That last rule is what keeps «hassan» off حسين and «mohamed» off محمود: the ي and
 *   the و are written, so the Latin must say them.
 *
 * A word still being typed is read as a prefix, but only once it holds two consonants
 * of the name: «moh» already finds محمد, while «ali» does not pull in every الحاف.
 * Each match is scored, so a list can put the people named exactly that first and
 * those only starting like it after.
 *
 * Twin of server/nameSearch.js — the عناصر list searches on the server, the other
 * lists in the browser, and both must find the same people. Change both together.
 */

const ARABIC = /[\u0600-\u06FF]/;
// Harakat, shadda, sukun, dagger alif, tatweel: none of them is a letter
const TASHKIL = /[\u064B-\u0652\u0670\u0640]/g;

// ---------- What an Arabic letter may be written as in Latin ----------
// Each spelling is [latin, cost]: a cost of 1 marks a reading that is allowed but
// less likely, and ranks the person after those read without it.

const opts = (list, cost = 0) => list.map((o) => (Array.isArray(o) ? o : [o, cost]));

// A short vowel Arabic does not write, after any letter: nothing, or one vowel.
// «ou» is French for a short u, but only after the first consonant (Moustafa,
// Houssein, Joumana); further in, it is a written و — «mahmoud» is not محمد.
const SLOT = opts(['', 'a', 'e', 'i', 'o', 'u']);
const FIRST_SLOT = [...SLOT, ['ou', 1]];
const LONG_A = opts(['a', 'aa', ['e', 1]]);
const YA = opts(['i', 'y', 'ee', 'ei', 'ey', 'ai', 'ay', 'ie', 'ii', 'iy', ['e', 1]]);
const WAW = opts(['w', 'ou', 'o', 'u', 'oo', 'uu', 'ow', 'aw', 'au', 'ew', 'v']);
const AYN = opts(['', 'a', 'e', 'i', 'o', 'u', 'aa', 'ou', '3']);
const HAMZA = opts(['', 'a', 'e', 'i', 'o', 'u', '2']);
// The vowel a word opens on: أحمد, إبراهيم, أسامة
const ONSET = opts(['a', 'e', 'i', 'o', 'u', 'ou', 'aa', '2']);
// The same, merged with the long vowel after it: إيهاب «ihab», أيمن «ayman», أيوب «ayoub»
const ONSET_YA = opts(['i', 'e', 'y', 'ei', 'ey', 'ai', 'ay', 'ee', 'ii', 'iy', 'ie', 'iya']);
const ONSET_WAW = opts(['o', 'ou', 'u', 'aw', 'au', 'ow', 'oo']);
// ال: «al», «el», «l», nothing at all, or only its vowel before a doubled sun letter
// («eddine», «assayed»). «la» covers the families written «Lahaf».
const ARTICLE = opts(['', 'l', 'a', 'e', 'i', 'o', 'u', 'al', 'el', 'il', 'ol', 'ul', 'la', 'le']);
const TA_MARBUTA = opts(['', 'a', 'e', 'ah', 'eh', 'at', 'et']);

const CONSONANTS = {
  'ب': ['b', 'p'], 'پ': ['p', 'b'], 'ت': ['t', 'th'], 'ط': ['t', '6'], 'ث': ['th', 't', 's'],
  'ج': ['j', 'g', 'dj'], 'ح': ['h', '7'], 'ه': ['h'], 'خ': ['kh', 'x', '5'],
  'د': ['d'], 'ذ': ['dh', 'd', 'z', 'th'], 'ر': ['r'], 'ز': ['z'], 'س': ['s', 'c'],
  'ش': ['sh', 'ch', 'sch'], 'ص': ['s', 'c'], 'ض': ['d', 'dh'], 'ظ': ['z', 'dh', 'd'],
  'غ': ['gh', 'g', '8'], 'ف': ['f', 'ph', 'v'], 'ق': ['k', 'q', 'c', 'ck', '9', 'g'],
  'ك': ['k', 'c', 'ck', 'q'], 'ل': ['l'], 'م': ['m'], 'ن': ['n'], 'گ': ['g'],
  'چ': ['ch', 'tch', 'j'], 'ڤ': ['v', 'f'],
};

const consonant = (list) => ({ cons: true, opts: opts(list) });
const vowel = (list) => ({ cons: false, opts: list });
const ARTICLE_UNIT = { cons: false, opts: ARTICLE, noSlot: true };

/** An Arabic word as the list of letters to read, each with its Latin spellings. */
function arabicUnits(word) {
  const ch = [...word.replace(TASHKIL, '').replace(/ٱ/g, 'ا')];
  const units = [];
  let i = 0;
  if (ch.length >= 4 && ch[0] === 'ا' && ch[1] === 'ل') {
    units.push(ARTICLE_UNIT);
    i = 2;
  }
  for (; i < ch.length; i++) {
    const c = ch[i];
    const next = ch[i + 1];
    // An article inside the word: عبدالله, عزالدين, ناصرالدين — never خالد or بلال,
    // where the ال sits too early or ends the word
    if (i >= 2 && c === 'ا' && next === 'ل' && ch.length - i - 2 >= 2) {
      units.push(ARTICLE_UNIT);
      i++;
      continue;
    }
    if (i === 0 && 'اأإآ'.includes(c)) {
      if (next === 'ي') { units.push(vowel(ONSET_YA)); i++; continue; }
      if (next === 'و') { units.push(vowel(ONSET_WAW)); i++; continue; }
      units.push(vowel(ONSET));
      continue;
    }
    let u;
    // ه for ة (مروه, حمزه) — but always heard: الله is not «ali»
    if (c === 'ه' && i === ch.length - 1) u = consonant(['h', 'a', 'e', 'ah', 'eh']);
    else if (CONSONANTS[c]) u = consonant(CONSONANTS[c]);
    else if (c === 'ا' || c === 'آ') u = vowel(LONG_A);
    else if (c === 'ى') u = vowel([...LONG_A, ...YA]);
    else if (c === 'ي') u = vowel(YA);
    else if (c === 'و') u = vowel(WAW);
    // A last ع is often written «h»: ربيع «Rabih»
    else if (c === 'ع') u = vowel(i === ch.length - 1 ? [...AYN, ['h', 1], ['eh', 1]] : AYN);
    else if ('ءأإؤئ'.includes(c)) u = vowel(HAMZA);
    else if (c === 'ة') u = vowel(TA_MARBUTA);
    else continue;
    // A doubled letter may be heard once: الله «allah», داوود «daoud»
    if (c === ch[i - 1]) u = { ...u, opts: [['', 0], ...u.opts] };
    units.push(u);
  }
  return units;
}

const MAX_COST = 3;

/**
 * Reads `latin` along `units` from their first letter, every way it can. Returns the
 * cheapest reading of each kind (Infinity: none):
 * - exact: both read to the end
 * - latinDone: the Latin read to its end after two consonants or more, the Arabic not
 *   necessarily — a Latin word still being typed
 * - unitsDone: the Arabic read to its end, after two consonants or more or with the
 *   Latin read to its end too — an Arabic word still being typed
 */
function align(units, latin) {
  const seen = new Set();
  const stack = [[0, 0, 0, 0]];
  const res = { exact: Infinity, latinDone: Infinity, unitsDone: Infinity };
  const n = units.length;
  const m = latin.length;
  while (stack.length) {
    const [i, j, k, cost] = stack.pop();
    const key = ((i * 256 + j) * 3 + k) * (MAX_COST + 1) + cost;
    if (seen.has(key)) continue;
    seen.add(key);
    if (j === m && i === n) res.exact = Math.min(res.exact, cost);
    if (j === m && k >= 2) res.latinDone = Math.min(res.latinDone, cost);
    if (i === n) {
      if (j === m || k >= 2) res.unitsDone = Math.min(res.unitsDone, cost);
      continue;
    }
    const u = units[i];
    for (const [o, oc] of u.opts) {
      if (!latin.startsWith(o, j)) {
        // The Latin stops partway through this letter («k» of «kh»): still a prefix
        if (k >= 2 && m - j < o.length && o.startsWith(latin.slice(j))) res.latinDone = Math.min(res.latinDone, cost);
        continue;
      }
      const k2 = u.cons && o ? Math.min(k + 1, 2) : k;
      const ends = [j + o.length];
      // A doubled Latin consonant: «abbas», «hussein», «mohammed», «fayyad»
      const last = o[o.length - 1];
      if (last && !'aeiou'.includes(last) && latin[j + o.length] === last) ends.push(j + o.length + 1);
      for (const e of ends) {
        if (u.noSlot) {
          if (cost + oc <= MAX_COST) stack.push([i + 1, e, k2, cost + oc]);
          continue;
        }
        for (const [s, sc] of u.cons && k === 0 ? FIRST_SLOT : SLOT) {
          const c2 = cost + oc + sc;
          if (c2 <= MAX_COST && latin.startsWith(s, e)) stack.push([i + 1, e + s.length, k2, c2]);
        }
      }
    }
  }
  return res;
}

// ---------- Folding each script on its own ----------

/** Lowercase, no diacritics, no hamza seat, one form of ة / ى — for plain comparison. */
function plain(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(TASHKIL, '')
    .replace(/ٱ/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

/** Latin letters and Arabizi digits only: «N'Diaye» → «ndiaye», «Élie» → «elie». */
const latinLetters = (s) => plain(String(s).replace(/ç/gi, 's')).replace(/[^a-z0-9]/g, '');

// Letters people swap when they spell the same family: باجوق / باجوك, قانصو / قانسو
const ARABIC_LOOSE = { 'ص': 'س', 'ط': 'ت', 'ض': 'د', 'ظ': 'ز', 'ذ': 'ز', 'ث': 'ت', 'ق': 'ك' };
const arabicLoose = (word) =>
  plain(word)
    .replace(/[صطضظذثق]/g, (c) => ARABIC_LOOSE[c])
    .replace(/وا$/, 'و')
    .replace(/^ال(?=..)/, '');

// Each run of Latin vowels read as one of three: «i» if it holds an i or y, «u» if
// an o, u or w, else «a» — so Hussein «husin» stays apart from Hassan «hasan», while
// Mehdi is Mahdi
const vowelRun = (run) => (/[iy]/.test(run) ? 'i' : /[ouw]/.test(run) ? 'u' : 'a');

// A Latin spelling with its letters folded: Mohamed, Mohammad, Muhamad → «muhamad»;
// Hage → «haja», Haj → «haj»
function latinKey(s) {
  return s
    .replace(/sch|ch|sh/g, 'S').replace(/kh/g, 'x').replace(/gh/g, 'G').replace(/ph/g, 'f')
    .replace(/dj/g, 'j').replace(/th/g, 't').replace(/dh/g, 'd').replace(/ck/g, 'k')
    .replace(/g(?=[eiy])/g, 'j').replace(/G/g, 'g')
    .replace(/q/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/v/g, 'f')
    .replace(/p/g, 'b').replace(/7/g, 'h').replace(/5/g, 'x').replace(/6/g, 't')
    .replace(/8/g, 'g').replace(/9/g, 'k').replace(/[23]/g, 'a')
    .replace(/([^aeiouyw])\1+/g, '$1')
    .replace(/[aeiouyw]+/g, vowelRun);
}
const consonantCount = (key) => key.replace(/[aiu]/g, '').length;
// A last vowel, or vowel and «h», comes and goes: Fatima / Fatimah, Hage / Haj
const latinStem = (key) => key.replace(/[aiu]h?$/, '');

// ---------- Word against word ----------
// How well a query word reads as a name word, 0 (not at all) to 10 (the same word)

const EXACT = 9;
const PREFIX = 6;

const unitsCache = new Map();
function unitsOf(word) {
  let u = unitsCache.get(word);
  if (!u) {
    if (unitsCache.size > 5000) unitsCache.clear();
    u = arabicUnits(word);
    unitsCache.set(word, u);
  }
  return u;
}

function latinScore(tok, word) {
  const a = latinKey(tok);
  const words = [word];
  // «Elhaj» is also «haj»
  if (/^[ae]l[^aeiou]/.test(word) && word.length >= 5) words.push(word.slice(2));
  let best = 0;
  for (const w of words) {
    const b = latinKey(w);
    if (b === a || (latinStem(a) === latinStem(b) && consonantCount(latinStem(a)) >= 2)) return EXACT;
    if (b.startsWith(a) && consonantCount(a) >= 2) best = PREFIX;
  }
  return best;
}

const fromCost = (base, cost) => (cost === Infinity ? 0 : base - cost);

function wordScore(tok, word) {
  const tokAr = ARABIC.test(tok);
  const wordAr = ARABIC.test(word);
  if (tokAr && wordAr) {
    const a = arabicLoose(tok);
    const b = arabicLoose(word);
    if (!a) return 0;
    return a === b ? EXACT : b.startsWith(a) ? PREFIX + 1 : 0;
  }
  if (!tokAr && wordAr) {
    const latin = latinLetters(tok);
    if (latin.length < 2 || !/[a-z]/.test(latin)) return 0;
    const r = align(unitsOf(word), latin);
    return Math.max(fromCost(EXACT, r.exact), fromCost(PREFIX, r.latinDone));
  }
  if (tokAr && !wordAr) {
    const latin = latinLetters(word);
    if (!latin) return 0;
    const r = align(unitsOf(tok), latin);
    return Math.max(fromCost(EXACT, r.exact), fromCost(PREFIX, r.unitsDone));
  }
  const a = latinLetters(tok);
  const b = latinLetters(word);
  return a.length < 2 || !b ? 0 : latinScore(a, b);
}

const scoreCache = new Map();
function wordScoreCached(tok, word) {
  const key = `${tok}\u0000${word}`;
  let r = scoreCache.get(key);
  if (r === undefined) {
    if (scoreCache.size > 50000) scoreCache.clear();
    r = wordScore(tok, word);
    scoreCache.set(key, r);
  }
  return r;
}

// ---------- Query against name ----------

const SPLIT = /[\s\-_.,\u060C/()]+/;
// An article on its own («el hajj», «ال حاف») says nothing about who is meant
const ARTICLES = new Set(['ال', 'al', 'el', 'il', 'ul', 'l']);

function queryWords(query) {
  const all = String(query ?? '').trim().split(SPLIT).filter(Boolean);
  const kept = all.filter((w) => !ARTICLES.has(plain(w)));
  return (kept.length ? kept : all).slice(0, 8);
}

// Ways to glue neighbouring query words: «عبد الله» may be stored «Abdallah». The words
// as typed come first; with more than five, only those.
function* segmentations(words) {
  yield words;
  if (words.length < 2 || words.length > 5) return;
  for (let mask = 1; mask < 1 << (words.length - 1); mask++) {
    const out = [words[0]];
    for (let i = 1; i < words.length; i++) {
      if (mask & (1 << (i - 1))) out[out.length - 1] += words[i];
      else out.push(words[i]);
    }
    yield out;
  }
}

/**
 * How well `query` finds the person whose name is made of `parts` (first, father,
 * family — any may be empty): 0 when it does not, higher the closer it reads.
 *
 * Every query word must find something: a word of the name it reads as (or two
 * neighbouring ones glued, for عبد الله ↔ Abdallah), or else a plain piece of it, as
 * the old search did. An empty query finds everyone.
 */
export function nameScore(query, parts) {
  const words = queryWords(query);
  if (!words.length) return 1;
  const nameWords = parts.flatMap((p) => String(p ?? '').split(SPLIT)).filter(Boolean);
  if (!nameWords.length) return 0;
  const glued = nameWords.slice(1).map((w, i) => nameWords[i] + w);
  const candidates = [...nameWords, ...glued];
  const plainWords = nameWords.map(plain);
  const full = plainWords.join(' ');
  const tokenScore = (tok) => {
    const p = plain(tok);
    let best = plainWords.includes(p) ? 10 : plainWords.some((w) => w.startsWith(p)) ? 8 : full.includes(p) ? 3 : 0;
    for (const w of candidates) if (best < EXACT) best = Math.max(best, wordScoreCached(tok, w));
    return best;
  };
  let best = 0;
  for (const seg of segmentations(words)) {
    let total = 0;
    for (const tok of seg) {
      const s = tokenScore(tok);
      if (!s) {
        total = 0;
        break;
      }
      total += s;
    }
    // A glued reading counts as many words as were typed, so it does not lose to a split one
    if (total) best = Math.max(best, (total * words.length) / seg.length);
  }
  return best;
}

export const nameMatches = (query, parts) => nameScore(query, parts) > 0;

/** The same for a record carrying first_name / father_name / last_name. */
export const personScore = (query, p) => (p ? nameScore(query, [p.first_name, p.father_name, p.last_name]) : 0);
export const personMatches = (query, p) => personScore(query, p) > 0;
