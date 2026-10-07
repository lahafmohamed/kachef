import ExportPdfButton from '../components/ExportPdfButton';
import { Fragment, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch, useLocalStorage, useUrlField, useUrlFilters } from '../hooks';
import { isFeminine, useSection } from '../section';
import SectionField from '../components/SectionField';
import { ACTIVITY_TYPES, activityTypeKey, branchName, fmtDate, fmtTime, memberName, todayISO } from '../utils';
import { toDate } from '../lib/date';
import { signed } from '../lib/events';
import { resultTone } from '../lib/treasury';
import { fmtScore, scoreTone } from '../lib/evaluations';
import AmountInput from '../components/AmountInput';
import Combobox from '../components/Combobox';
import DatePicker from '../components/DatePicker';
import DateRangePicker from '../components/DateRangePicker';
import FilterChips from '../components/FilterChips';
import FilterSelect from '../components/FilterSelect';
import TimePicker from '../components/TimePicker';
import SearchInput from '../components/SearchInput';
import SearchSelect from '../components/SearchSelect';
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  RequirementGrid,
  Select,
  Skeleton,
  useToast,
  IconCalendar,
  IconCheck,
  IconCoins,
  IconFilter,
  IconPlus,
  IconShield,
  IconSort,
  IconStar,
  IconSwap,
  IconX,
} from '../components/ui';

// The journal's filters, as the URL and the API both name them
const FILTER_KEYS = ['q', 'branch', 'group', 'from', 'to', 'leader', 'activity_type', 'kind'];

const EMPTY = {
  kind: 'activity',
  // بند الخطة السنوية الذي ينفّذه النشاط — '' يعني نشاط خارج الخطة
  plan_item_id: '',
  title: '',
  date: todayISO(),
  start_time: '',
  place: '',
  activity_type: '',
  // الفرق التي يشملها النشاط: نفس الحصّة قد تُعطى لفرقتين معًا. الأولى هي الرئيسية،
  // و هي صاحبة الخطة و المطالب المعروضة.
  branch_ids: [],
  // مجموعات الفرق المشاركة. فارغة = كل فرقة تشارك كاملةً، و هو الحال حين لا مجموعات
  // أصلًا. فرقةٌ اختيرت لها مجموعة أو أكثر لا يشارك منها إلا عناصرها.
  group_ids: [],
  leader_id: '',
  // بطاقة التحضير التي كُتبت لهذا النشاط — تُربط به عند الحفظ
  prep_card_id: '',
  helper_ids: [],
  member_ids: [],
  fee: '',
  matalib: [],
  // نشاط عام للفوج: { [branch_id]: عدد الحضور } as typed, plus عدد القادة
  branch_counts: {},
  leaders_count: '',
  // نشاط قادة: ضيوف من خارج البرنامج، بأسمائهم فقط
  guest_names: [],
  // القسم، حين يُرى القسمان معًا — '' = لم يُختر بعد (الفتيان). فرق النشاط تغلبه متى اختيرت.
  section: '',
};

/** فرق النشاط — واحدة أو أكثر — أو نوعه حين يكون نشاطًا فوجيًا بلا فرقة */
function ScopeBadge({ s, lang, t, branchList = [], bothSections = false }) {
  if (s.branch_id) {
    // النشاط المشترك يعرض كل فرقه: القائد يعرف من حضر الحصّة معه
    const ids = s.branch_ids?.length ? s.branch_ids : [s.branch_id];
    const named = ids.map((id) => branchList.find((b) => b.id === id)).filter(Boolean);
    // النشاط المحصور بمجموعات: أسماؤها تُذكر بعد الفرقة، فحصّتان لفرقة واحدة في
    // اليوم نفسه يُميَّز بينهما من القائمة مباشرة
    const groups = (s.group_ids || [])
      .map((gid) => branchList.flatMap((b) => b.groups || []).find((g) => g.id === gid))
      .filter(Boolean);
    return (
      <>
        {named.length <= 1 ? (
          <Badge>{branchName(named[0] || s, lang)}</Badge>
        ) : (
          named.map((b) => <Badge key={b.id}>{branchName(b, lang)}</Badge>)
        )}
        {groups.map((g) => (
          <Badge key={g.id} variant="outline">
            {g.name}
          </Badge>
        ))}
      </>
    );
  }
  // نشاط قادة يبقى للفوج، و فرقه المدعوّة تُذكر بعده
  const invited = (s.branch_ids || []).map((id) => branchList.find((b) => b.id === id)).filter(Boolean);
  return (
    <>
      <Badge variant="secondary">
        {t(s.kind === 'group' ? 'session.kindGroup' : 'session.kindLeaders')}
      </Badge>
      {/* No فرقة to tell them apart: with both أقسام listed, the نشاط names its own */}
      {bothSections && <Badge variant={isFeminine(s.section) ? 'info' : 'outline'}>{t(`section.${s.section}`)}</Badge>}
      {invited.map((b) => (
        <Badge key={b.id} variant="outline">
          {branchName(b, lang)}
        </Badge>
      ))}
    </>
  );
}

// ar-LB gives the Levantine month names (أيلول، تشرين...) the فوج actually uses;
// Latin digits keep days and years aligned with the rest of the app
const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');
const fmtMonth = (key, lng) =>
  new Intl.DateTimeFormat(intlLocale(lng), { month: 'long', year: 'numeric' }).format(toDate(`${key}-01`));
const fmtWeekday = (iso, lng) =>
  new Intl.DateTimeFormat(intlLocale(lng), { weekday: 'short' }).format(toDate(iso));
const fmtMonthShort = (iso, lng) =>
  new Intl.DateTimeFormat(intlLocale(lng), { month: 'short' }).format(toDate(iso));

/** Present / absent / excused as marked; a نشاط with nobody marked yet has no rate. */
function tally(s) {
  const marked = (s.present_count || 0) + (s.absent_count || 0) + (s.excused_count || 0);
  return { marked, rate: marked ? Math.round((100 * (s.present_count || 0)) / marked) : null };
}

/**
 * Every عنصر starts out غائب when the نشاط is created: today's or an upcoming one with
 * nobody marked present or excused has simply not been taken yet — it is not a 0%.
 */
const untaken = (s) => s.date >= todayISO() && !s.present_count && !s.excused_count;

/** Rate across a month: every marked عنصر weighs the same, so a big نشاط counts for more. */
function monthRate(rows) {
  let present = 0;
  let marked = 0;
  for (const s of rows) {
    // زيارة is 100% by nature and نشاط عام للفوج has counts, not a roll call
    if (s.kind === 'visit' || s.kind === 'group' || untaken(s)) continue;
    present += s.present_count || 0;
    marked += tally(s).marked;
  }
  return marked ? Math.round((100 * present) / marked) : null;
}

/** The attendance column: one bar + the counts it is made of, never colour alone. */
function AttendanceMeter({ s, t }) {
  // A نشاط عام للفوج is recorded by counts, so there is no present/absent to show
  if (s.kind === 'group')
    return (
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{s.branch_counts_total ?? 0}</span>{' '}
        <span className="text-muted-foreground">{t('session.present')}</span>
        {s.leaders_count !== null && s.leaders_count !== undefined && (
          <span className="text-muted-foreground">
            {' · '}
            <span className="tabular-nums">{s.leaders_count}</span> {t('leader.leadersList')}
          </span>
        )}
      </p>
    );
  if (s.kind === 'visit')
    return <p className="text-sm text-muted-foreground">{t('session.visitedCount', { count: s.present_count || 0 })}</p>;

  const { marked, rate } = tally(s);
  if (!marked || untaken(s))
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{t('session.notMarked')}</p>
        <div className="h-1.5 rounded-full border border-dashed border-border" />
      </div>
    );
  const pct = (n) => `${(100 * (n || 0)) / marked}%`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        {/* Wraps rather than cutting «1 excusé» off on a 320px screen — between two
            counts, never inside «1 غائب بعذر» */}
        <p className="min-w-0 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">
            <span className="tabular-nums">{s.present_count}</span> {t('session.present')}
          </span>
          {' · '}
          <span className="whitespace-nowrap">
            <span className="tabular-nums">{s.absent_count}</span> {t('session.absent')}
          </span>
          {s.excused_count > 0 && (
            <>
              {' · '}
              <span className="whitespace-nowrap">
                <span className="tabular-nums">{s.excused_count}</span> {t('session.excused')}
              </span>
            </>
          )}
        </p>
        <span className="text-sm font-semibold tabular-nums" aria-label={`${t('session.rateLabel')} ${rate}%`}>
          {rate}%
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="bg-success" style={{ width: pct(s.present_count) }} />
        <span className="bg-warning" style={{ width: pct(s.excused_count) }} />
        <span className="bg-destructive/70" style={{ width: pct(s.absent_count) }} />
      </div>
    </div>
  );
}

/**
 * Won or lost, before the نشاط is opened: cotisations and dons less its dépenses, the
 * word first — the colour only repeats it. Nothing while no money moved in it, and
 * nothing for who may not see amounts (the server sends no `money` then).
 */
function MoneyLine({ s, t }) {
  const m = s.money;
  if (!m || !(m.collected || m.donations || m.expenses)) return null;
  const tone = resultTone(m.result);
  return (
    <p className="mt-2 flex items-baseline justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <IconCoins className="h-3.5 w-3.5 self-center" />
        {t(tone.key)}
      </span>
      <span dir="ltr" className={cn('text-sm font-semibold tabular-nums', tone.className)}>
        {signed(m.result)}
      </span>
    </p>
  );
}

/**
 * The قادة's mark, under the money line: «Évaluation (3) 4,3/5». For a قائد who led the
 * نشاط and has not rated it yet, «À évaluer» instead — the server hides the others'
 * average from him until he has.
 */
function EvalLine({ s, t, lng }) {
  const e = s.eval;
  if (!e) return null;
  if (e.pending)
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary">
        <IconStar className="h-3.5 w-3.5" />
        {t('eval.toDo')}
      </p>
    );
  if (!e.count || e.average === null) return null;
  return (
    <p className="mt-2 flex items-baseline justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <IconStar className="h-3.5 w-3.5 self-center" />
        {t('eval.listLabel', { count: e.count })}
      </span>
      <span dir="ltr" className={cn('text-sm font-semibold tabular-nums', scoreTone(e.average).text)}>
        {fmtScore(e.average, lng)}
        <span className="text-xs font-normal text-muted-foreground">/5</span>
      </span>
    </p>
  );
}

const KIND_TAG = {
  visit: { key: 'session.kindVisit', variant: 'warning' },
  leaders: { key: 'session.kindLeaders', variant: 'info' },
  group: { key: 'session.kindGroup', variant: 'info' },
};

/**
 * One line of the journal. The date block shows only on the first نشاط of a day,
 * so two حصص on the same Saturday read as one day with two entries.
 */
function SessionRow({ s, showDate, ranked, lang, t, branchList, bothSections }) {
  const tag = KIND_TAG[s.kind];
  const meta = [
    fmtTime(s.start_time),
    s.place?.trim(),
    s.leader,
    activityTypeKey(s.activity_type) && t(activityTypeKey(s.activity_type)),
  ].filter(Boolean);
  return (
    <li>
      <Link
        to={`/sessions/${s.id}`}
        className="focus-ring group grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-accent/40 sm:grid-cols-[3.25rem_minmax(0,1fr)_15rem] sm:items-center sm:px-5"
      >
        <div className={cn('self-start text-center', !showDate && 'invisible')}>
          <span className="sr-only">{fmtDate(s.date)}</span>
          <span aria-hidden="true" className="block text-2xl font-semibold leading-none tabular-nums">
            {Number(s.date.slice(8, 10))}
          </span>
          <span aria-hidden="true" className="mt-1 block text-xs text-muted-foreground">
            {ranked ? fmtMonthShort(s.date, lang) : fmtWeekday(s.date, lang)}
          </span>
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold group-hover:text-primary">{s.title}</span>
            {tag && <Badge variant={tag.variant}>{t(tag.key)}</Badge>}
          </div>
          {/* Two lines on a phone: cut to one, the قائد and the type were always the
              part that fell off. A short fact stays whole, so the line breaks between
              two — «أحمد / ياسين» read as two people — and each keeps its own
              direction: an Arabic place beside an Arabic name swapped places, and
              their dots, on the French screen. */}
          {meta.length > 0 && (
            <p className="text-sm text-muted-foreground max-sm:line-clamp-2 sm:truncate" title={meta.join(' · ')}>
              {meta.map((m, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  <bdi className={m.length <= 24 ? 'whitespace-nowrap' : undefined}>{m}</bdi>
                </Fragment>
              ))}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <ScopeBadge s={s} lang={lang} t={t} branchList={branchList} bothSections={bothSections} />
            {s.plan_item_id && <Badge variant="success">{t('session.fromPlan')}</Badge>}
            {s.guest_count > 0 && (
              <Badge variant="outline">{t('session.guestCount', { count: s.guest_count })}</Badge>
            )}
            {s.matalib.length > 0 && (
              <Badge variant="outline">
                {s.matalib.length} {t('session.requirementsShort')}
              </Badge>
            )}
          </div>
        </div>

        <div className="col-start-2 sm:col-start-3">
          <AttendanceMeter s={s} t={t} />
          <MoneyLine s={s} t={t} />
          <EvalLine s={s} t={t} lng={lang} />
        </div>
      </Link>
    </li>
  );
}

function SessionList({ rows, ranked, lang, t, branchList }) {
  const { section } = useSection();
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {rows.map((s, i) => (
          <SessionRow
            key={s.id}
            s={s}
            // A ranked list jumps between dates, so every row keeps its own
            showDate={ranked || i === 0 || rows[i - 1].date !== s.date}
            ranked={ranked}
            lang={lang}
            t={t}
            branchList={branchList}
            bothSections={!section}
          />
        ))}
      </ul>
    </Card>
  );
}

export default function Sessions() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { has } = usePerms();
  const editable = has('sessions.create');

  // The filters live in the URL: «back» from a نشاط lands on the same journal, and
  // a link (the dashboard, a فرقة) can open it already filtered. Named as the API
  // names them, so the request and the PDF export take the address as is.
  const [sp, patch] = useUrlFilters();
  const param = (k) => sp.get(k) || '';
  const [q, setQ] = useUrlField(sp, patch, 'q');
  const branch = param('branch');
  // طليعة: only offered once a فرقة divided into طلائع is picked
  const groupFilter = param('group');
  const from = param('from');
  const to = param('to');
  const leaderFilter = param('leader');
  const activityType = param('activity_type');
  const kindFilter = param('kind');
  // Sorting is a preference, not a filter: it survives from one visit to the next
  const [sort, setSort] = useLocalStorage('sessions.sort', 'date_desc');
  const [showFilters, setShowFilters] = useState(false);

  const params = new URLSearchParams();
  for (const k of FILTER_KEYS) if (param(k)) params.set(k, param(k));
  if (sort && sort !== 'date_desc') params.set('sort', sort);

  const sessions = useFetch(`/sessions?${params}`);
  const branches = useFetch('/branches');
  const leaders = useFetch('/leaders');
  // Visit picker needs the roster; without members.read the fetch would 403
  const members = useFetch('/members', { skip: !has('members.read') });

  const activeFilters = [branch, groupFilter, from, to, leaderFilter, activityType, kindFilter].filter(Boolean).length;
  const filtering = activeFilters > 0 || !!q;
  // What hides behind الفلاتر — the badge on the button counts only these
  const moreFilters =
    [leaderFilter, activityType, kindFilter].filter(Boolean).length + (sort !== 'date_desc' ? 1 : 0);

  function clearFilters() {
    setQ('');
    patch(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])));
  }

  const [creating, setCreating] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  // النموذج على ثلاث خطوات: الأساسي ثم التفاصيل ثم المشاركون
  const [step, setStep] = useState(0);
  const [helperQuery, setHelperQuery] = useState('');
  const [guestInput, setGuestInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  // القادم من صفحة بطاقة تحضير: النموذج يُملأ منها و يُفتح فورًا، و تُربط عند الحفظ.
  // The state is cleared straight away so a refresh doesn't reopen the dialog.
  const location = useLocation();
  // Every open starts back at step one, whatever step a cancelled run died on
  useEffect(() => {
    if (creating) setStep(0);
  }, [creating]);
  useEffect(() => {
    const card = location.state?.prepCard;
    if (!card) return;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    setForm({
      ...EMPTY,
      kind: 'activity',
      title: card.title,
      date: card.date,
      start_time: card.start_time || '',
      place: card.place || '',
      branch_ids: [Number(card.branch_id)],
      leader_id: card.leader_id ? String(card.leader_id) : '',
      matalib: card.matalib || [],
      prep_card_id: String(card.id),
    });
    setCreating(true);
  }, [location, navigate]);

  // بنود خطة الفرقة التي لم تُنفَّذ بعد — loaded only while the dialog is open on a
  // نشاط فرقة, so picking one is a one-tap way to fill the title and the date.
  // الفرقة الرئيسية: أولى الفرق المختارة. هي صاحبة الخطة و المطالب المعروضة —
  // بندٌ واحد من خطة واحدة يكفي، فالحصّة المشتركة تُنجز خطة الفرقة التي بُرمجت فيها.
  const primaryBranchId = form.branch_ids[0] ?? '';
  const planScope = creating && form.kind === 'activity' && primaryBranchId ? primaryBranchId : null;
  const planOptions = useFetch(planScope ? `/branches/${planScope}/plan/options` : null, {
    skip: !planScope,
  });
  const planItems = planOptions.data?.items || [];

  // بطاقات تحضير الفرقة الرئيسية غير المربوطة بعد — للربط الاختياري عند الإنشاء
  const prepCards = useFetch(planScope ? `/prep-cards?branch=${planScope}` : null, {
    skip: !planScope,
  });
  const prepCardOptions = (prepCards.data || [])
    .filter((c) => !c.session_id || String(c.id) === String(form.prep_card_id))
    .map((c) => ({ value: c.id, label: `${c.title} — ${fmtDate(c.date)}` }));

  const branchList = branches.data || [];
  const leaderList = leaders.data || [];
  const list = sessions.data || [];
  // قسم النشاط: القسم المعروض، و إلا فقسم فرقته الأولى، و إلا فما اختير في الخطوة
  // الأولى. فرقه و قادته من هذا القسم وحده — الخادم يرفض الخلط على أي حال.
  const { section: onScreen } = useSection();
  const firstBranchSection = branchList.find((b) => b.id === Number(form.branch_ids[0]))?.section;
  const formSection = onScreen || firstBranchSection || form.section || 'M';
  const sectionBranches = branchList.filter((b) => b.section === formSection);
  const sectionLeaders = leaderList.filter((l) => l.section === formSection);
  const selectedBranch = branchList.find((b) => b.id === Number(primaryBranchId));
  // طلائع of the فرقة the journal is filtered on — the طليعة filter exists only then
  const filterGroups = branchList.find((b) => String(b.id) === branch)?.groups || [];

  function toggleMatalib(n) {
    setForm((f) => ({
      ...f,
      matalib: f.matalib.includes(n) ? f.matalib.filter((x) => x !== n) : [...f.matalib, n],
    }));
  }

  // إضافة فرقة أو إزالتها — الحفظ وحده يشترط فرقة واحدة على الأقل.
  // تغيّر الفرقة الرئيسية يُسقط المطالب و بند الخطة: كلاهما يخصّ فرقة بعينها.
  function toggleBranch(branchId) {
    const id = Number(branchId);
    setForm((f) => {
      const has = f.branch_ids.includes(id);
      const next = has ? f.branch_ids.filter((x) => x !== id) : [...f.branch_ids, id];
      const primaryChanged = next[0] !== f.branch_ids[0];
      // مجموعات فرقة خرجت من النشاط لم تعد تشارك فيه
      const liveGroups = new Set(
        branchList.filter((x) => next.includes(x.id)).flatMap((x) => (x.groups || []).map((g) => g.id))
      );
      return {
        ...f,
        branch_ids: next,
        group_ids: f.group_ids.filter((g) => liveGroups.has(g)),
        // عناصر فرقة خرجت من النشاط لم يعد يمكن زيارتهم فيه
        member_ids: f.member_ids.filter((m) =>
          (members.data || []).some((x) => x.id === m && next.includes(x.branch_id))
        ),
        // القائد لا يُملأ تلقائيًا من الفرقة: من يغيّر الفرقة الرئيسية لا يفقد اختياره
        // للمنشّط، و من لم يختر بعد يبقى الحقل فارغًا حتى يختار هو — لا افتراض مفروض
        ...(primaryChanged ? { matalib: [], plan_item_id: '', prep_card_id: '' } : {}),
      };
    });
  }

  // Taking the بند announced by the plan: its name goes into the title and the نشاط
  // is linked to it. The date stays the one the قائد picked — a نشاط held a day late
  // is still that نشاط, and the plan should tick all the same.
  function pickPlanItem(id) {
    const item = planItems.find((i) => String(i.id) === String(id));
    if (!item) return;
    setForm((f) => ({ ...f, title: item.title, plan_item_id: String(item.id) }));
  }

  // Switching type resets what no longer applies: مطالب and عناصر belong to a فرقة نشاط only,
  // and the per-فرقة counts to a نشاط عام للفوج.
  function pickKind(kind) {
    setForm((f) => ({
      ...f,
      kind,
      title: kind === 'visit' ? t('session.familyVisit') : f.title === t('session.familyVisit') ? '' : f.title,
      // Only a نشاط فرقة executes a بند of the plan — و هو وحده الذي يُحصر بمجموعات
      plan_item_id: kind === 'activity' ? f.plan_item_id : '',
      prep_card_id: kind === 'activity' ? f.prep_card_id : '',
      group_ids: kind === 'activity' ? f.group_ids : [],
      matalib: [],
      member_ids: [],
      fee: kind === 'visit' || kind === 'group' ? '' : f.fee,
      branch_counts: kind === 'group' ? f.branch_counts : {},
      leaders_count: kind === 'group' ? f.leaders_count : '',
      // فرق نشاط القادة مدعوّة لا صاحبة النشاط: الاختيار لا يعبر بين المعنيين
      branch_ids: (kind === 'leaders') === (f.kind === 'leaders') ? f.branch_ids : [],
      guest_names: kind === 'leaders' ? f.guest_names : [],
    }));
  }

  // الضيف يُكتب اسمه كما هو؛ الاسم المكرّر لا يُضاف مرّتين
  function addGuest() {
    const name = guestInput.trim().replace(/\s+/g, ' ');
    if (!name) return;
    setForm((f) => (f.guest_names.includes(name) ? f : { ...f, guest_names: [...f.guest_names, name] }));
    setGuestInput('');
  }

  function removeGuest(name) {
    setForm((f) => ({ ...f, guest_names: f.guest_names.filter((g) => g !== name) }));
  }

  // إضافة مجموعة أو إزالتها. نزع آخر مجموعة من فرقة يعيدها إلى المشاركة كاملةً،
  // و هو المعنى نفسه في الخادم: فرقة بلا مجموعة مختارة تشارك بكل عناصرها.
  function toggleGroup(groupId) {
    setForm((f) => ({
      ...f,
      group_ids: f.group_ids.includes(groupId)
        ? f.group_ids.filter((x) => x !== groupId)
        : [...f.group_ids, groupId],
    }));
  }

  function setBranchCount(branchId, value) {
    setForm((f) => ({ ...f, branch_counts: { ...f.branch_counts, [branchId]: value } }));
  }

  // Another قسم: everything picked from the old one goes — its فرق, their عناصر,
  // طلائع, plan and card, and its قادة
  function pickSection(s) {
    if (s === formSection) return;
    setForm((f) => ({
      ...f,
      section: s,
      branch_ids: [],
      group_ids: [],
      member_ids: [],
      plan_item_id: '',
      prep_card_id: '',
      matalib: [],
      branch_counts: {},
      leader_id: '',
      helper_ids: [],
    }));
  }

  function toggleVisited(id) {
    setForm((f) => ({
      ...f,
      member_ids: f.member_ids.includes(id)
        ? f.member_ids.filter((x) => x !== id)
        : [...f.member_ids, id],
    }));
  }

  function toggleHelper(id) {
    setForm((f) => ({
      ...f,
      helper_ids: f.helper_ids.includes(id)
        ? f.helper_ids.filter((x) => x !== id)
        : [...f.helper_ids, id],
    }));
  }

  // اختيار الكل only touches the rows currently on screen, so a search narrows what
  // the button ticks instead of silently selecting names nobody can see.
  function toggleAll(field, ids, allPicked) {
    setForm((f) => ({
      ...f,
      [field]: allPicked
        ? f[field].filter((x) => !ids.includes(x))
        : [...new Set([...f[field], ...ids])],
    }));
  }

  async function create(e) {
    e.preventDefault();
    // Enter on an early step advances instead of submitting
    if (step < 2) {
      nextStep();
      return;
    }
    setError(null);
    // لا فرقة مختارة: نشاط الفرقة و الزيارة بلا فرقة لا معنى لهما
    if (!['leaders', 'group'].includes(form.kind) && form.branch_ids.length === 0) {
      setError(t('session.branchRequired'));
      return;
    }
    setSaving(true);
    try {
      const s = await api.post('/sessions', {
        ...form,
        // نشاط القادة يرسل فرقه المدعوّة — قد لا تكون أيّ فرقة
        branch_ids: form.kind === 'group' ? [] : form.branch_ids.map(Number),
        // اسمٌ كُتب و لم يُضَف بعد يُحفظ معهم، فلا يضيع بنقرة «حفظ» مباشرة
        guest_names:
          form.kind === 'leaders'
            ? [...new Set([...form.guest_names, guestInput.trim().replace(/\s+/g, ' ')].filter(Boolean))]
            : [],
        group_ids: form.kind === 'activity' ? form.group_ids.map(Number) : [],
        leader_id: form.leader_id === '' ? null : Number(form.leader_id),
        helper_ids: form.helper_ids.filter((h) => h !== Number(form.leader_id)),
        member_ids: form.kind === 'visit' ? form.member_ids : [],
        fee: form.fee === '' ? null : Number(form.fee),
        matalib: form.kind === 'visit' ? [] : form.matalib,
        plan_item_id: form.kind === 'activity' && form.plan_item_id ? Number(form.plan_item_id) : null,
        prep_card_id: form.kind === 'activity' && form.prep_card_id ? Number(form.prep_card_id) : null,
        activity_type: form.activity_type || null,
        start_time: form.start_time || null,
        place: form.place || null,
        // Read by the server only when the نشاط has no فرقة to take it from
        section: formSection,
        // Only فرق the قائد actually typed a number for are recorded
        branch_counts:
          form.kind === 'group'
            ? Object.entries(form.branch_counts)
                .filter(([, v]) => v !== '' && v !== null)
                .map(([branchId, v]) => ({ branch_id: Number(branchId), count: Number(v) }))
            : [],
        leaders_count: form.kind === 'group' && form.leaders_count !== '' ? Number(form.leaders_count) : null,
      });
      setCreating(false);
      setForm({ ...EMPTY, date: todayISO() });
      setGuestInput('');
      toast.success(t('session.created'));
      navigate(`/sessions/${s.id}`);
    } catch (err) {
      setError(err.message === 'mixed_sections' ? t('section.mixed') : err.message);
    } finally {
      setSaving(false);
    }
  }

  // الفرق المختارة التي قُسِّمت إلى مجموعات — وحدها تعرض حقل المجموعات
  const groupedBranches = branchList.filter(
    (b) => form.branch_ids.includes(b.id) && (b.groups || []).length > 0
  );
  const availableHelpers = sectionLeaders.filter(
    (l) => l.status === 'active' && l.id !== Number(form.leader_id)
  );
  const isVisit = form.kind === 'visit';
  // كل خطوة تتحقق من حقولها الإلزامية قبل التقدّم — فالخطأ يظهر حيث يُصلح
  function nextStep() {
    setError(null);
    if (step === 0 && (!form.title.trim() || !form.date)) {
      setError(t('common.fillRequired'));
      return;
    }
    if (step === 1) {
      if (!form.leader_id || (form.kind === 'group' && !form.activity_type)) {
        setError(t('common.fillRequired'));
        return;
      }
      if (!['leaders', 'group'].includes(form.kind) && form.branch_ids.length === 0) {
        setError(t('session.branchRequired'));
        return;
      }
    }
    setStep((s) => Math.min(2, s + 1));
  }
  // نشاط قادة: no فرقة, no عناصر, no مطالب — only the قادة who take part
  const isLeadersOnly = form.kind === 'leaders';
  // نشاط عام للفوج: no فرقة either, présence recorded as a count per فرقة
  const isGroup = form.kind === 'group';

  // الخطة السنوية تخصّ نشاط الفرقة وحده
  const usesPlan = !isVisit && !isLeadersOnly && !isGroup;
  // ما هو مبرمج في اليوم المختار بالذات — يُعرض للقائد فور اختياره التاريخ
  const plannedThisDay = planItems.find((i) => i.date === form.date) || null;
  const linkedItem = planItems.find((i) => String(i.id) === String(form.plan_item_id)) || null;
  // اقتراحات العنوان: بنود الخطة غير المنجزة، و ما يوافق اليوم المختار في الأعلى
  const planSuggestions = planItems
    .map((i) => ({
      key: String(i.id),
      id: i.id,
      value: i.title,
      label: i.title,
      hint: fmtDate(i.date),
      badge: i.date === form.date ? t('session.planToday') : null,
    }))
    .sort((a, b) => (a.badge ? 0 : 1) - (b.badge ? 0 : 1));
  // Both pickers stay usable with 40+ names: filter on the full name, and never
  // hide an already-ticked row — otherwise a search makes selections look lost.
  const matches = (person, query) =>
    memberName(person).toLowerCase().includes(query.trim().toLowerCase());

  // A زيارة is recorded inside a فرقة, so only its active عناصر can be visited
  const visitableMembers = (members.data || []).filter(
    (m) =>
      m.status === 'active' &&
      form.branch_ids.includes(m.branch_id) &&
      (!memberQuery || form.member_ids.includes(m.id) || matches(m, memberQuery))
  );
  const shownHelpers = availableHelpers.filter(
    (l) => !helperQuery || form.helper_ids.includes(l.id) || matches(l, helperQuery)
  );
  const allMembersPicked =
    visitableMembers.length > 0 && visitableMembers.every((m) => form.member_ids.includes(m.id));
  const allHelpersPicked =
    shownHelpers.length > 0 && shownHelpers.every((l) => form.helper_ids.includes(l.id));

  const natureOptions = ACTIVITY_TYPES.map((a) => ({ value: a.value, label: t(a.key) }));
  const kindOptions = [
    { value: 'activity', label: t('session.kindActivity') },
    { value: 'visit', label: t('session.kindVisit') },
    { value: 'leaders', label: t('session.kindLeaders') },
    { value: 'group', label: t('session.kindGroup') },
  ];
  const labelOf = (options, v) => options.find((o) => String(o.value) === String(v))?.label;
  // Every active filter as a removable chip — the value is what the قائد picked
  const chips = [
    branch && {
      key: 'branch',
      value: branchName(branchList.find((b) => String(b.id) === String(branch)) || {}, i18n.language),
      clear: () => patch({ branch: '', group: '' }),
    },
    groupFilter && {
      key: 'group',
      value: branchList.flatMap((b) => b.groups || []).find((g) => String(g.id) === groupFilter)?.name,
      isolate: true,
      clear: () => patch({ group: '' }),
    },
    (from || to) && {
      key: 'period',
      value:
        from && to
          ? `${fmtDate(from)} – ${fmtDate(to)}`
          : from
            ? `${t('session.dateFrom')} ${fmtDate(from)}`
            : `${t('session.dateTo')} ${fmtDate(to)}`,
      clear: () => patch({ from: '', to: '' }),
    },
    leaderFilter && {
      key: 'leader',
      value: memberName(leaderList.find((l) => String(l.id) === String(leaderFilter)) || {}),
      clear: () => patch({ leader: '' }),
    },
    activityType && { key: 'nature', value: labelOf(natureOptions, activityType), clear: () => patch({ activity_type: '' }) },
    kindFilter && { key: 'kind', value: labelOf(kindOptions, kindFilter), clear: () => patch({ kind: '' }) },
  ].filter(Boolean);

  // Month headers only make sense in date order; a ranking by attendance is one flat list
  const ranked = sort !== 'date_desc' && sort !== 'date_asc';
  const months = [];
  for (const s of list) {
    const key = s.date.slice(0, 7);
    if (months.at(-1)?.key !== key) months.push({ key, rows: [] });
    months.at(-1).rows.push(s);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('session.title')}
        description={
          filtering ? t('session.resultCount', { count: list.length }) : t('session.subtitle')
        }
      >
        {(() => {
          const q = new URLSearchParams(params);
          q.delete('branch');
          return <ExportPdfButton kind="sessions-list" id={params.get('branch') || 0} query={q.toString()} compact />;
        })()}
        {editable && (
          <Button variant="brand" onClick={() => setCreating(true)}>
            <IconPlus />
            {t('session.newSession')}
          </Button>
        )}
      </PageHeader>

      {/* Toolbar: search + the two filters used every week stay in view; the rest
          folds behind الفلاتر. On phones everything but the search folds. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-0 sm:basis-64">
            <SearchInput value={q} onChange={setQ} placeholder={t('session.searchPlaceholder')} />
          </div>
          <div className={cn('order-last w-full sm:order-none sm:w-auto', showFilters ? 'block' : 'hidden sm:block')}>
            <FilterSelect
              value={branch}
              // A طليعة belongs to its فرقة: changing the فرقة drops it
              onChange={(v) => patch({ branch: v, group: '' })}
              allLabel={t('member.allBranches')}
              ariaLabel={t('member.branch')}
              className="w-full sm:w-auto sm:min-w-44"
              icon={<IconShield className="opacity-60" />}
              options={branchList.map((b) => ({
                value: b.id,
                label: branchName(b, i18n.language),
              }))}
            />
          </div>
          {/* A فرقة split into طلائع runs some حصص for one طليعة only: this narrows the
              journal to what that طليعة took part in, whole-فرقة أنشطة included */}
          {filterGroups.length > 0 && (
            <div className={cn('order-last w-full sm:order-none sm:w-auto', showFilters ? 'block' : 'hidden sm:block')}>
              <FilterSelect
                value={groupFilter}
                onChange={(v) => patch({ group: v })}
                allLabel={t('session.allGroups')}
                ariaLabel={t('session.filterByGroup')}
                className="w-full sm:w-auto sm:min-w-40"
                options={filterGroups.map((g) => ({ value: g.id, label: g.name }))}
              />
            </div>
          )}
          <div className={cn('order-last w-full sm:order-none sm:w-auto', showFilters ? 'block' : 'hidden sm:block')}>
            <DateRangePicker
              value={{ from, to }}
              onChange={({ from: f, to: tt }) => patch({ from: f, to: tt })}
            />
          </div>
          <Button
            variant="outline"
            className="relative"
            aria-expanded={showFilters}
            aria-controls="session-more-filters"
            onClick={() => setShowFilters((v) => !v)}
          >
            <IconFilter />
            {t('session.filters')}
            {moreFilters > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-bold tabular-nums text-primary-foreground">
                {moreFilters}
              </span>
            )}
          </Button>
        </div>

        {showFilters && (
          <div id="session-more-filters" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {/* Searchable: the قادة list runs to 40+ names, and this is the "what did
                he actually run this year" question — it matches مساعدين too. */}
            <SearchSelect
              value={leaderFilter}
              onChange={(e) => patch({ leader: e.target.value })}
              options={leaderList.map((l) => ({ value: l.id, label: memberName(l) }))}
              clearLabel={t('session.allAnimators')}
              placeholder={t('session.allAnimators')}
              searchPlaceholder={t('session.searchLeader')}
              emptyLabel={t('member.noListValue')}
              ariaLabel={t('session.leader')}
              className="sm:w-auto sm:min-w-48"
            />
            <FilterSelect
              value={activityType}
              onChange={(v) => patch({ activity_type: v })}
              allLabel={t('session.allNatures')}
              ariaLabel={t('session.nature')}
              className="sm:w-auto sm:min-w-44"
              options={natureOptions}
            />
            <FilterSelect
              value={kindFilter}
              onChange={(v) => patch({ kind: v })}
              allLabel={t('session.allKinds')}
              ariaLabel={t('session.kind')}
              className="sm:w-auto sm:min-w-40"
              options={kindOptions}
            />
            {/* "Which نشاط did they skip" is a ranking, not a filter — the counts are
                already on every row, so it is one ORDER BY away. */}
            <FilterSelect
              value={sort}
              onChange={setSort}
              ariaLabel={t('member.sortBy')}
              className="sm:w-auto sm:min-w-52"
              icon={<IconSort className="opacity-60" />}
              options={[
                { value: 'date_desc', label: t('session.sortDateDesc') },
                { value: 'date_asc', label: t('session.sortDateAsc') },
                { value: 'absent_desc', label: t('session.sortAbsentDesc') },
                { value: 'present_desc', label: t('session.sortPresentDesc') },
                { value: 'rate_asc', label: t('session.sortRateAsc') },
                { value: 'rate_desc', label: t('session.sortRateDesc') },
              ]}
            />
          </div>
        )}

        {/* What is narrowing the list, each removable on its own */}
        <FilterChips chips={chips} onClearAll={clearFilters} />
      </div>

      {sessions.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={sessions.reload} retryLabel={t('error.retry')} />
      ) : sessions.loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-5 w-40" />
          <Card className="divide-y divide-border">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex gap-4 p-4">
                <Skeleton className="h-10 w-10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </Card>
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconCalendar className="h-6 w-6" />}
            title={t(filtering ? 'common.noResults' : 'session.noSessions')}
            action={
              filtering ? (
                <Button variant="outline" onClick={clearFilters}>
                  {t('common.clearFilters')}
                </Button>
              ) : editable ? (
                <Button variant="brand" onClick={() => setCreating(true)}>
                  <IconPlus />
                  {t('session.newSession')}
                </Button>
              ) : null
            }
          >
            {t(filtering ? 'common.noResultsHint' : 'session.noSessionsHint')}
          </EmptyState>
        </Card>
      ) : ranked ? (
        <SessionList rows={list} ranked lang={i18n.language} t={t} branchList={branchList} />
      ) : (
        <div className="space-y-6">
          {months.map(({ key, rows }) => {
            const rate = monthRate(rows);
            return (
              <section key={key} aria-labelledby={`month-${key}`} className="space-y-2">
                {/* Sticks under the phone top bar (4rem + notch), at the top on desktop */}
                <div className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-10 -mx-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-background px-1 py-2 lg:top-0">
                  <h2 id={`month-${key}`} className="text-base font-semibold">
                    {fmtMonth(key, i18n.language)}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t('session.monthCount', { count: rows.length })}
                    {rate !== null && (
                      <>
                        {' · '}
                        {t('session.monthRate')} <span dir="ltr" className="font-medium tabular-nums text-foreground">{rate}%</span>
                      </>
                    )}
                  </p>
                </div>
                <SessionList rows={rows} lang={i18n.language} t={t} branchList={branchList} />
              </section>
            );
          })}
        </div>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={t(
          isVisit
            ? 'session.newVisit'
            : isLeadersOnly
              ? 'session.newLeadersSession'
              : isGroup
                ? 'session.newGroupSession'
                : 'session.newSession'
        )}
      >
        {branches.error || leaders.error ? (
          <ErrorState
            message={t('error.loadFailed')}
            onRetry={() => {
              if (branches.error) branches.reload();
              if (leaders.error) leaders.reload();
            }}
            retryLabel={t('error.retry')}
          />
        ) : (
        <form onSubmit={create} className="space-y-4">
          {(() => {
          const kindField = (
          <div className="space-y-1.5">
            <Label htmlFor="s_kind">{t('session.kind')}</Label>
            {/* A select, not segments: four kinds no longer fit side by side on a phone */}
            <Select id="s_kind" value={form.kind} onChange={(e) => pickKind(e.target.value)}>
              <option value="activity">{t('session.kindActivity')}</option>
              <option value="visit">{t('session.kindVisit')}</option>
              <option value="leaders">{t('session.kindLeaders')}</option>
              <option value="group">{t('session.kindGroup')}</option>
            </Select>
            {isGroup && <p className="text-xs text-muted-foreground">{t('session.groupHint')}</p>}
          </div>
          );

          const titleField = (
          <div className="space-y-1.5">
            <Label htmlFor="s_title">{t(isGroup ? 'session.occasion' : 'session.sessionTitle')}</Label>
            {/* عنوان النشاط يقترح بنود الخطة السنوية غير المنجزة، و المبرمج في نفس اليوم
                يأتي أولًا. الكتابة حرّة دائمًا: نشاط خارج الخطة يُكتب كما هو. */}
            <Combobox
              id="s_title"
              required
              placeholder={t('session.sessionTitleHint')}
              value={form.title}
              options={usesPlan ? planSuggestions : []}
              onPick={(o) => setForm((f) => ({ ...f, title: o.value, plan_item_id: String(o.id) }))}
              // Typing by hand means "not that plan item any more" — the link only
              // survives while the title is the one that was picked.
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value, plan_item_id: '' }))}
            />
          </div>
          );

          // ما تقوله الخطة عن هذا اليوم: يُعرض بمجرد اختيار التاريخ، و ينتقل إلى العنوان بنقرة
          const planLinked = usesPlan && linkedItem && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-xs">
              <IconCheck className="h-3.5 w-3.5 shrink-0 text-success" />
              <span className="min-w-0 flex-1">
                {t('session.linkedToPlan', { date: fmtDate(linkedItem.date) })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setForm((f) => ({ ...f, plan_item_id: '' }))}
              >
                {t('session.unlinkPlan')}
              </Button>
            </div>
          );
          // Still shown next to the green chip when the قائد moved the date onto a day
          // carrying another بند — switching to it stays one tap away.
          const planDay = usesPlan && plannedThisDay && plannedThisDay.id !== linkedItem?.id && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2 text-xs">
              <IconCalendar className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground">{t('session.plannedThisDay')}</span>{' '}
                <span className="font-medium">{plannedThisDay.title}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => pickPlanItem(plannedThisDay.id)}>
                {t('session.usePlanned')}
              </Button>
            </div>
          );

          const dateField = (
            <div className="space-y-1.5">
              <Label htmlFor="s_date">{t('common.date')}</Label>
              <DatePicker
                id="s_date"
                required
                clearable={false}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
          );
          const timeField = (
            <div className="space-y-1.5">
              <Label htmlFor="s_time">{t('session.time')}</Label>
              <TimePicker
                id="s_time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
              />
            </div>
          );
          const placeField = (
            <div className="space-y-1.5">
              <Label htmlFor="s_place">{t('session.place')}</Label>
              <Input
                id="s_place"
                autoComplete="off"
                value={form.place}
                onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
              />
            </div>
          );
          const natureField = !isVisit && (
              <div className="space-y-1.5">
                <Label htmlFor="s_nature">{t('session.nature')}</Label>
                <Select
                  id="s_nature"
                  required={isGroup}
                  value={form.activity_type}
                  onChange={(e) => setForm((f) => ({ ...f, activity_type: e.target.value }))}
                >
                  <option value="">—</option>
                  {ACTIVITY_TYPES.map((a) => (
                    <option key={a.value} value={a.value}>
                      {t(a.key)}
                    </option>
                  ))}
                </Select>
              </div>
          );
          const feeField = !isVisit && !isGroup && (
              <div className="space-y-1.5">
                <Label htmlFor="s_fee">{t('session.fee')}</Label>
                <AmountInput
                  id="s_fee"
                  placeholder="—"
                  value={form.fee}
                  onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
                />
                {/* المبلغ هنا هو المتوقَّع من كل عنصر: تفتح به خانة الاشتراك في
                    لائحة الحضور، فلا يُكتب رقمًا رقمًا لمن دفعه كاملًا */}
                <p className="text-xs text-muted-foreground">{t('session.feeHint')}</p>
              </div>
          );
          // نشاط القادة: الفرق اختيارية، مدعوّة لا صاحبة النشاط — لا رئيسية بينها
          const branchesLabel = t(isLeadersOnly ? 'session.invitedBranches' : 'session.branches');
          const branchesField = !isGroup && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{branchesLabel}</Label>
                {/* حصّة واحدة قد تجمع فرقتين: تُختار كل فرقة معنيّة، و تبقى واحدة
                    على الأقل. الأولى المختارة هي الرئيسية (الخطة و المطالب). */}
                <div className="flex flex-wrap gap-2" role="group" aria-label={branchesLabel}>
                  {sectionBranches.map((b) => {
                    const on = form.branch_ids.includes(b.id);
                    const primary = form.branch_ids[0] === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleBranch(b.id)}
                        className={cn(
                          'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-[color,background-color,border-color,scale] active:scale-[0.96] sm:min-h-9',
                          on
                            ? 'border-primary bg-primary/10 font-medium text-primary'
                            : 'border-input bg-card text-muted-foreground hover:bg-accent'
                        )}
                      >
                        <IconSwap
                          on={on}
                          onIcon={<IconCheck className="h-3.5 w-3.5" />}
                          className="h-3.5 w-3.5"
                          collapse
                        />
                        {branchName(b, i18n.language)}
                        {primary && !isLeadersOnly && form.branch_ids.length > 1 && (
                          <span className="text-xs uppercase opacity-70">
                            {t('session.branchPrimary')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {isLeadersOnly ? (
                  <p className="text-xs text-muted-foreground">{t('session.invitedBranchesHint')}</p>
                ) : (
                  form.branch_ids.length > 1 && (
                    <p className="text-xs text-muted-foreground">{t('session.branchesHint')}</p>
                  )
                )}
              </div>
          );
          // المجموعات: تظهر فقط للفرق المقسَّمة، و لنشاط الفرقة وحده. لا اختيار
          // = الفرقة كاملةً، فالفرقة غير المقسَّمة لا ترى هذا الحقل أصلًا.
          const groupsField = form.kind === 'activity' && groupedBranches.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t('session.groups')}</Label>
                <div className="space-y-2">
                  {groupedBranches.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center gap-2">
                      {groupedBranches.length > 1 && (
                        <span className="text-xs text-muted-foreground">
                          {branchName(b, i18n.language)}
                        </span>
                      )}
                      <div
                        className="flex flex-wrap gap-2"
                        role="group"
                        aria-label={`${t('session.groups')} — ${branchName(b, i18n.language)}`}
                      >
                        {b.groups.map((g) => {
                          const on = form.group_ids.includes(g.id);
                          return (
                            <button
                              key={g.id}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggleGroup(g.id)}
                              className={cn(
                                'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-[color,background-color,border-color,scale] active:scale-[0.96] sm:min-h-9',
                                on
                                  ? 'border-primary bg-primary/10 font-medium text-primary'
                                  : 'border-input bg-card text-muted-foreground hover:bg-accent'
                              )}
                            >
                              <IconSwap
                                on={on}
                                onIcon={<IconCheck className="h-3.5 w-3.5" />}
                                className="h-3.5 w-3.5"
                                collapse
                              />
                              {g.name}
                              <span className="text-xs opacity-70">{g.member_count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('session.groupsHint')}</p>
              </div>
          );
          const leaderField = (
            <div className="space-y-1.5">
              <Label htmlFor="s_leader">
                {t(isVisit || isLeadersOnly ? 'session.visitMainLeader' : 'session.leader')}
              </Label>
              <SearchSelect
                id="s_leader"
                required
                value={form.leader_id}
                onChange={(e) => setForm((f) => ({ ...f, leader_id: e.target.value }))}
                options={sectionLeaders
                  .filter((l) => l.status === 'active' || l.id === Number(form.leader_id))
                  .map((l) => ({ value: l.id, label: memberName(l) }))}
                placeholder={t('leader.selectLeader')}
                searchPlaceholder={t('session.searchLeader')}
                emptyLabel={t('member.noListValue')}
                ariaLabel={t(isVisit || isLeadersOnly ? 'session.visitMainLeader' : 'session.leader')}
              />
            </div>
          );
          // بطاقة التحضير: تُعرض بطاقات الفرقة الرئيسية غير المربوطة، و الربط اختياري
          const prepField = form.kind === 'activity' && prepCardOptions.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="s_prep">{t('prep.cardLabel')}</Label>
                <SearchSelect
                  id="s_prep"
                  value={form.prep_card_id}
                  onChange={(e) => setForm((f) => ({ ...f, prep_card_id: e.target.value }))}
                  options={prepCardOptions}
                  clearLabel={t('prep.noCard')}
                  placeholder={t('prep.noCard')}
                  searchPlaceholder={t('prep.searchPlaceholder')}
                  emptyLabel={t('common.noResults')}
                  ariaLabel={t('prep.cardLabel')}
                />
                <p className="text-xs text-muted-foreground">{t('session.prepCardHint')}</p>
              </div>
          );

          // زيارة الأهل: pick the عناصر whose families were visited — each one gets the
          // visit recorded in their file the moment the نشاط is saved
          const visitPicker = isVisit && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <Label>
                  {t('session.visitedMembers')}
                  <span className="ms-2 font-normal tabular-nums text-muted-foreground">
                    {t('session.selectedCount', { count: form.member_ids.length })}
                  </span>
                </Label>
                {visitableMembers.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-my-1 px-2 text-primary"
                    aria-pressed={allMembersPicked}
                    onClick={() =>
                      toggleAll(
                        'member_ids',
                        visitableMembers.map((m) => m.id),
                        allMembersPicked
                      )
                    }
                  >
                    {t(allMembersPicked ? 'common.clearSelection' : 'common.selectAll')}
                  </Button>
                )}
              </div>
              <SearchInput
                value={memberQuery}
                onChange={setMemberQuery}
                autoFocusHotkey={false}
                placeholder={t('session.searchMember')}
              />
              {visitableMembers.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {t(memberQuery ? 'common.noResults' : 'member.noMembers')}
                </p>
              ) : (
                <div className="max-h-52 overflow-y-auto rounded-lg border border-border p-1.5">
                  {visitableMembers.map((m) => (
                    <label
                      key={m.id}
                      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-accent/60 sm:min-h-9"
                    >
                      <input
                        type="checkbox"
                        checked={form.member_ids.includes(m.id)}
                        onChange={() => toggleVisited(m.id)}
                      />
                      {memberName(m)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );

          // نشاط عام للفوج: عدد الحضور لكل فرقة بالتفصيل + عدد حضور القادة
          const groupCounts = isGroup && (
            <div className="space-y-1.5">
              <Label>{t('session.branchCounts')}</Label>
              <div className="space-y-2 rounded-xl border border-border p-3">
                {sectionBranches.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`s_count_${b.id}`} className="flex-1">
                      {branchName(b, i18n.language)}
                    </Label>
                    <Input
                      id={`s_count_${b.id}`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      placeholder="0"
                      className="w-24"
                      value={form.branch_counts[b.id] ?? ''}
                      onChange={(e) => setBranchCount(b.id, e.target.value)}
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                  <Label htmlFor="s_leaders_count" className="flex-1">
                    {t('session.leadersCount')}
                  </Label>
                  <Input
                    id="s_leaders_count"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="0"
                    className="w-24"
                    value={form.leaders_count}
                    onChange={(e) => setForm((f) => ({ ...f, leaders_count: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          );

          const helpersPicker = !isGroup && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-2">
              <Label>
                {t(isVisit || isLeadersOnly ? 'session.visitParticipants' : 'session.helpers')}
                <span className="ms-2 font-normal tabular-nums text-muted-foreground">
                  {t('session.selectedCount', { count: form.helper_ids.length })}
                </span>
              </Label>
              {shownHelpers.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-my-1 px-2 text-primary"
                  aria-pressed={allHelpersPicked}
                  onClick={() =>
                    toggleAll(
                      'helper_ids',
                      shownHelpers.map((l) => l.id),
                      allHelpersPicked
                    )
                  }
                >
                  {t(allHelpersPicked ? 'common.clearSelection' : 'common.selectAll')}
                </Button>
              )}
            </div>
            {availableHelpers.length > 0 && (
              <SearchInput
                value={helperQuery}
                onChange={setHelperQuery}
                autoFocusHotkey={false}
                placeholder={t('session.searchLeader')}
              />
            )}
            {shownHelpers.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t(availableHelpers.length === 0 ? 'session.noHelpersAvailable' : 'common.noResults')}
              </p>
            ) : (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border p-1.5">
                {shownHelpers.map((l) => (
                  <label
                    key={l.id}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-accent/60 sm:min-h-9"
                  >
                    <input
                      type="checkbox"
                      checked={form.helper_ids.includes(l.id)}
                      onChange={() => toggleHelper(l.id)}
                    />
                    {memberName(l)}
                  </label>
                ))}
              </div>
            )}
          </div>
          );

          // ضيوف نشاط القادة: من ليس في البرنامج يُكتب اسمه فقط — Enter يضيفه دون إرسال النموذج
          const guestsField = isLeadersOnly && (
            <div className="space-y-1.5">
              <Label htmlFor="s_guest">
                {t('session.guests')}
                {form.guest_names.length > 0 && (
                  <span className="ms-2 font-normal tabular-nums text-muted-foreground">
                    {form.guest_names.length}
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="s_guest"
                  autoComplete="off"
                  maxLength={120}
                  placeholder={t('session.guestPlaceholder')}
                  value={guestInput}
                  onChange={(e) => setGuestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addGuest();
                    }
                  }}
                />
                <Button variant="outline" onClick={addGuest} disabled={!guestInput.trim()}>
                  <IconPlus />
                  {t('session.addGuest')}
                </Button>
              </div>
              {form.guest_names.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {form.guest_names.map((name) => (
                    <li
                      key={name}
                      className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border bg-card ps-3 text-sm"
                    >
                      {name}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full text-muted-foreground"
                        onClick={() => removeGuest(name)}
                        aria-label={`${t('common.delete')} — ${name}`}
                      >
                        <IconX className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t('session.guestsHint')}</p>
              )}
            </div>
          );

          const matalibField = !isVisit && !isLeadersOnly && !isGroup && selectedBranch?.total_requirements > 0 && (
            <div className="space-y-1.5">
              <Label>
                {t('session.requirements')}
                <span className="ms-2 font-normal tabular-nums text-muted-foreground">
                  {t('session.selectedCount', { count: form.matalib.length })}
                </span>
              </Label>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-2">
                <RequirementGrid
                  total={selectedBranch.total_requirements}
                  selected={form.matalib}
                  onToggle={toggleMatalib}
                  label={t('session.requirements')}
                />
              </div>
            </div>
          );

          const errorEl = error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          );

          const steps = [
              t('session.stepEssentials'),
              t('session.stepDetails'),
              t('session.stepParticipants'),
            ];
            return (
              <>
                <ol className="flex items-center gap-2 text-xs">
                  {steps.map((s, i) => (
                    <li
                      key={s}
                      aria-current={i === step ? 'step' : undefined}
                      className={cn('flex items-center gap-1.5', i < steps.length - 1 && 'flex-1')}
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums',
                          i <= step
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className={i === step ? 'font-medium' : 'text-muted-foreground'}>
                        {s}
                      </span>
                      {i < steps.length - 1 && <span className="h-px min-w-3 flex-1 bg-border" />}
                    </li>
                  ))}
                </ol>
                {step === 0 && (
                  <div className="space-y-4">
                    {/* Both أقسام on screen: the first thing to settle, since it decides
                        which فرق and قادة the next steps offer */}
                    {!onScreen && <SectionField value={formSection} onChange={pickSection} />}
                    {kindField}
                    {titleField}
                    {planLinked}
                    {planDay}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {dateField}
                      {timeField}
                    </div>
                  </div>
                )}
                {step === 1 && (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {placeField}
                      {natureField}
                      {feeField}
                      {leaderField}
                    </div>
                    {branchesField}
                    {groupsField}
                    {prepField}
                  </div>
                )}
                {step === 2 && (
                  <div className="space-y-4">
                    {visitPicker}
                    {groupCounts}
                    {helpersPicker}
                    {guestsField}
                    {matalibField}
                  </div>
                )}
                {errorEl}
                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (step === 0) setCreating(false);
                      else {
                        setError(null);
                        setStep(step - 1);
                      }
                    }}
                  >
                    {t(step === 0 ? 'common.cancel' : 'common.back')}
                  </Button>
                  {/* Distinct keys: React would otherwise reuse the «التالي» button and
                      flip it to type=submit mid-click, so the browser submits the form
                      on step two and the مطالب step is never seen */}
                  {step < 2 ? (
                    <Button key="next" type="button" onClick={nextStep}>
                      {t('common.next')}
                    </Button>
                  ) : (
                    <Button key="save" type="submit" loading={saving}>
                      {t('common.save')}
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </form>
        )}
      </Dialog>
    </div>
  );
}
