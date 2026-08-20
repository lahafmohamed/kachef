import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useDebounced, useFetch, useLocalStorage } from '../hooks';
import { ACTIVITY_TYPES, activityTypeKey, branchName, fmtDate, fmtTime, memberName, todayISO } from '../utils';
import Combobox from '../components/Combobox';
import DatePicker from '../components/DatePicker';
import DateRangePicker from '../components/DateRangePicker';
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
  Table,
  Td,
  Th,
  useToast,
  IconCalendar,
  IconCheck,
  IconFilter,
  IconPlus,
  IconShield,
  IconSort,
  IconX,
} from '../components/ui';

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
  helper_ids: [],
  member_ids: [],
  fee: '',
  matalib: [],
  // نشاط عام للفوج: { [branch_id]: عدد الحضور } as typed, plus عدد القادة
  branch_counts: {},
  leaders_count: '',
};

/** فرق النشاط — واحدة أو أكثر — أو نوعه حين يكون نشاطًا فوجيًا بلا فرقة */
function ScopeBadge({ s, lang, t, branchList = [] }) {
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
  return (
    <Badge variant="secondary">
      {t(s.kind === 'group' ? 'session.kindGroup' : 'session.kindLeaders')}
    </Badge>
  );
}

function AttendanceChips({ s, t }) {
  // A نشاط عام للفوج is recorded by counts, so there is no present/absent to show
  if (s.kind === 'group')
    return (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="success">
          {s.branch_counts_total ?? 0} {t('session.present')}
        </Badge>
        {s.leaders_count !== null && s.leaders_count !== undefined && (
          <Badge variant="secondary">
            {s.leaders_count} {t('leader.leadersList')}
          </Badge>
        )}
      </div>
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="success">
        {s.present_count} {t('session.present')}
      </Badge>
      <Badge variant="destructive">
        {s.absent_count} {t('session.absent')}
      </Badge>
      {s.excused_count > 0 && (
        <Badge variant="warning">
          {s.excused_count} {t('session.excused')}
        </Badge>
      )}
    </div>
  );
}

export default function Sessions() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { has } = usePerms();
  const editable = has('sessions.create');

  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [leaderFilter, setLeaderFilter] = useState('');
  const [activityType, setActivityType] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  // Sorting is a preference, not a filter: it survives from one visit to the next
  const [sort, setSort] = useLocalStorage('sessions.sort', 'date_desc');
  const [showFilters, setShowFilters] = useState(false);

  const dq = useDebounced(q, 250);
  const params = new URLSearchParams();
  if (dq) params.set('q', dq);
  if (branch) params.set('branch', branch);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (leaderFilter) params.set('leader', leaderFilter);
  if (activityType) params.set('activity_type', activityType);
  if (kindFilter) params.set('kind', kindFilter);
  if (sort && sort !== 'date_desc') params.set('sort', sort);

  const sessions = useFetch(`/sessions?${params}`);
  const branches = useFetch('/branches');
  const leaders = useFetch('/leaders');
  // Visit picker needs the roster; without members.read the fetch would 403
  const members = useFetch('/members', { skip: !has('members.read') });

  const activeFilters = [branch, from, to, leaderFilter, activityType, kindFilter].filter(Boolean).length;
  const filtering = activeFilters > 0 || !!q;

  function clearFilters() {
    setQ('');
    setBranch('');
    setFrom('');
    setTo('');
    setLeaderFilter('');
    setActivityType('');
    setKindFilter('');
  }

  const [creating, setCreating] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [helperQuery, setHelperQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

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

  const branchList = branches.data || [];
  const leaderList = leaders.data || [];
  const list = sessions.data || [];
  const selectedBranch = branchList.find((b) => b.id === Number(primaryBranchId));

  // Pre-select the first branch and its current تشكيلة leader once branches load
  useEffect(() => {
    if (!branchList.length || form.branch_ids.length) return;
    setForm((f) => ({ ...f, branch_ids: [branchList[0].id], leader_id: branchList[0].leader_id || '' }));
  }, [branchList, form.branch_ids.length]);

  function toggleMatalib(n) {
    setForm((f) => ({
      ...f,
      matalib: f.matalib.includes(n) ? f.matalib.filter((x) => x !== n) : [...f.matalib, n],
    }));
  }

  // إضافة فرقة أو إزالتها. النشاط بلا فرقة لا معنى له، فآخر فرقة لا تُنزع.
  // تغيّر الفرقة الرئيسية يُسقط المطالب و بند الخطة: كلاهما يخصّ فرقة بعينها.
  function toggleBranch(branchId) {
    const id = Number(branchId);
    setForm((f) => {
      const has = f.branch_ids.includes(id);
      if (has && f.branch_ids.length === 1) return f;
      const next = has ? f.branch_ids.filter((x) => x !== id) : [...f.branch_ids, id];
      const primaryChanged = next[0] !== f.branch_ids[0];
      const b = branchList.find((x) => x.id === next[0]);
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
        ...(primaryChanged
          ? { matalib: [], plan_item_id: '', leader_id: b?.leader_id || f.leader_id }
          : {}),
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
      group_ids: kind === 'activity' ? f.group_ids : [],
      matalib: [],
      member_ids: [],
      fee: kind === 'visit' || kind === 'group' ? '' : f.fee,
      branch_counts: kind === 'group' ? f.branch_counts : {},
      leaders_count: kind === 'group' ? f.leaders_count : '',
    }));
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
    setError(null);
    setSaving(true);
    try {
      const s = await api.post('/sessions', {
        ...form,
        branch_ids: ['leaders', 'group'].includes(form.kind) ? [] : form.branch_ids.map(Number),
        group_ids: form.kind === 'activity' ? form.group_ids.map(Number) : [],
        leader_id: form.leader_id === '' ? null : Number(form.leader_id),
        helper_ids: form.helper_ids.filter((h) => h !== Number(form.leader_id)),
        member_ids: form.kind === 'visit' ? form.member_ids : [],
        fee: form.fee === '' ? null : Number(form.fee),
        matalib: form.kind === 'visit' ? [] : form.matalib,
        plan_item_id: form.kind === 'activity' && form.plan_item_id ? Number(form.plan_item_id) : null,
        activity_type: form.activity_type || null,
        start_time: form.start_time || null,
        place: form.place || null,
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
      setForm({ ...EMPTY, branch_ids: form.branch_ids, leader_id: form.leader_id });
      toast.success(t('session.created'));
      navigate(`/sessions/${s.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // الفرق المختارة التي قُسِّمت إلى مجموعات — وحدها تعرض حقل المجموعات
  const groupedBranches = branchList.filter(
    (b) => form.branch_ids.includes(b.id) && (b.groups || []).length > 0
  );
  const availableHelpers = leaderList.filter(
    (l) => l.status === 'active' && l.id !== Number(form.leader_id)
  );
  const isVisit = form.kind === 'visit';
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('session.title')}
        description={
          filtering ? t('session.resultCount', { count: list.length }) : t('session.subtitle')
        }
      >
        {editable && (
          <Button variant="brand" onClick={() => setCreating(true)}>
            <IconPlus />
            {t('session.newSession')}
          </Button>
        )}
      </PageHeader>

      {/* Search always visible; the rest folds away on phones to keep the list
          near the top, and is permanently open from sm up. */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder={t('session.searchPlaceholder')} />
          <Button
            variant="outline"
            size="icon"
            className="relative sm:hidden"
            aria-expanded={showFilters}
            aria-label={t('session.filters')}
            onClick={() => setShowFilters((v) => !v)}
          >
            <IconFilter />
            {activeFilters > 0 && (
              <span className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-bold text-primary-foreground">
                {activeFilters}
              </span>
            )}
          </Button>
        </div>

        <div
          className={cn(
            'flex-col gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center',
            showFilters ? 'flex' : 'hidden'
          )}
        >
          <FilterSelect
            value={branch}
            onChange={setBranch}
            allLabel={t('member.allBranches')}
            ariaLabel={t('member.branch')}
            className="sm:w-auto sm:min-w-44"
            icon={<IconShield className="opacity-60" />}
            options={branchList.map((b) => ({
              value: b.id,
              label: branchName(b, i18n.language),
            }))}
          />
          <DateRangePicker
            value={{ from, to }}
            onChange={({ from: f, to: tt }) => {
              setFrom(f);
              setTo(tt);
            }}
          />
          {/* Searchable: the قادة list runs to 40+ names, and this is the "what did
              he actually run this year" question — it matches مساعدين too. */}
          <SearchSelect
            value={leaderFilter}
            onChange={(e) => setLeaderFilter(e.target.value)}
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
            onChange={setActivityType}
            allLabel={t('session.allNatures')}
            ariaLabel={t('session.nature')}
            className="sm:w-auto sm:min-w-44"
            options={ACTIVITY_TYPES.map((a) => ({ value: a.value, label: t(a.key) }))}
          />
          <FilterSelect
            value={kindFilter}
            onChange={setKindFilter}
            allLabel={t('session.allKinds')}
            ariaLabel={t('session.kind')}
            className="sm:w-auto sm:min-w-40"
            options={[
              { value: 'activity', label: t('session.kindActivity') },
              { value: 'visit', label: t('session.kindVisit') },
              { value: 'leaders', label: t('session.kindLeaders') },
              { value: 'group', label: t('session.kindGroup') },
            ]}
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
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <IconX />
              {t('common.clearFilters')}
            </Button>
          )}
        </div>
      </div>

      {sessions.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={sessions.reload} retryLabel={t('error.retry')} />
      ) : sessions.loading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-2 p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </Card>
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
      ) : (
        <>
          {/* Mobile cards */}
          <Card className="md:hidden">
            <ul className="divide-y divide-border">
              {list.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/sessions/${s.id}`}
                    className="focus-ring block px-4 py-3 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{s.title}</span>
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {fmtDate(s.date)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <ScopeBadge s={s} lang={i18n.language} t={t} branchList={branchList} />
                      {s.plan_item_id && <Badge variant="success">{t('session.fromPlan')}</Badge>}
                      {s.kind === 'visit' && <Badge variant="warning">{t('session.kindVisit')}</Badge>}
                      {activityTypeKey(s.activity_type) && (
                        <Badge variant="outline">{t(activityTypeKey(s.activity_type))}</Badge>
                      )}
                      {s.matalib.length > 0 && (
                        <Badge variant="warning">
                          {s.matalib.length} {t('session.requirementsShort')}
                        </Badge>
                      )}
                      {(s.start_time || s.place) && (
                        <span className="truncate text-xs text-muted-foreground">
                          {[fmtTime(s.start_time), s.place].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {s.leader && (
                        <span className="truncate text-xs text-muted-foreground">{s.leader}</span>
                      )}
                    </div>
                    <div className="mt-2">
                      <AttendanceChips s={s} t={t} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {/* Desktop table */}
          <Card className="hidden md:block">
            <Table>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('session.sessionTitle')}</Th>
                  <Th>{t('member.branch')}</Th>
                  <Th>{t('session.leader')}</Th>
                  <Th>{t('session.requirementsShort')}</Th>
                  <Th>{t('session.attendance')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((s) => (
                  <tr key={s.id} className="group transition-colors hover:bg-accent/40">
                    <Td className="tabular-nums">{fmtDate(s.date)}</Td>
                    <Td>
                      <Link
                        to={`/sessions/${s.id}`}
                        className="focus-ring rounded font-medium group-hover:text-primary"
                      >
                        {s.title}
                      </Link>
                      {s.kind === 'visit' && (
                        <Badge variant="warning" className="ms-2">
                          {t('session.kindVisit')}
                        </Badge>
                      )}
                      {s.plan_item_id && (
                        <Badge variant="success" className="ms-2">
                          {t('session.fromPlan')}
                        </Badge>
                      )}
                      {(s.start_time || s.place || s.activity_type) && (
                        <span className="block text-xs text-muted-foreground">
                          {[
                            fmtTime(s.start_time),
                            s.place,
                            activityTypeKey(s.activity_type) && t(activityTypeKey(s.activity_type)),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <ScopeBadge s={s} lang={i18n.language} t={t} branchList={branchList} />
                    </Td>
                    <Td className="text-muted-foreground">{s.leader || '—'}</Td>
                    <Td>
                      <Badge variant={s.matalib.length ? 'warning' : 'outline'}>{s.matalib.length}</Badge>
                    </Td>
                    <Td>
                      <AttendanceChips s={s} t={t} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
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
            {!isVisit && <p className="text-xs text-muted-foreground">{t('session.sessionTitleHint')}</p>}
          </div>

          {/* ما تقوله الخطة عن هذا اليوم: يُعرض بمجرد اختيار التاريخ، و ينتقل إلى العنوان بنقرة */}
          {usesPlan && linkedItem && (
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
          )}
          {/* Still shown next to the green chip when the قائد moved the date onto a day
              carrying another بند — switching to it stays one tap away. */}
          {usesPlan && plannedThisDay && plannedThisDay.id !== linkedItem?.id && (
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
          )}

          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="space-y-1.5">
              <Label htmlFor="s_time">{t('session.time')}</Label>
              <TimePicker
                id="s_time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s_place">{t('session.place')}</Label>
              <Input
                id="s_place"
                autoComplete="off"
                value={form.place}
                onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
              />
            </div>
            {!isVisit && (
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
            )}
            {!isVisit && !isGroup && (
              <div className="space-y-1.5">
                <Label htmlFor="s_fee">{t('session.fee')}</Label>
                <Input
                  id="s_fee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="—"
                  value={form.fee}
                  onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
                />
              </div>
            )}
            {!isLeadersOnly && !isGroup && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t('session.branches')}</Label>
                {/* حصّة واحدة قد تجمع فرقتين: تُختار كل فرقة معنيّة، و تبقى واحدة
                    على الأقل. الأولى المختارة هي الرئيسية (الخطة و المطالب). */}
                <div className="flex flex-wrap gap-2" role="group" aria-label={t('session.branches')}>
                  {branchList.map((b) => {
                    const on = form.branch_ids.includes(b.id);
                    const primary = form.branch_ids[0] === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleBranch(b.id)}
                        className={cn(
                          'focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                          on
                            ? 'border-primary bg-primary/10 font-medium text-primary'
                            : 'border-input bg-card text-muted-foreground hover:bg-accent'
                        )}
                      >
                        {on && <IconCheck className="h-3.5 w-3.5" />}
                        {branchName(b, i18n.language)}
                        {primary && form.branch_ids.length > 1 && (
                          <span className="text-[0.65rem] uppercase opacity-70">
                            {t('session.branchPrimary')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {form.branch_ids.length > 1 && (
                  <p className="text-xs text-muted-foreground">{t('session.branchesHint')}</p>
                )}
              </div>
            )}
            {/* المجموعات: تظهر فقط للفرق المقسَّمة، و لنشاط الفرقة وحده. لا اختيار
                = الفرقة كاملةً، فالفرقة غير المقسَّمة لا ترى هذا الحقل أصلًا. */}
            {form.kind === 'activity' && groupedBranches.length > 0 && (
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
                                'focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                                on
                                  ? 'border-primary bg-primary/10 font-medium text-primary'
                                  : 'border-input bg-card text-muted-foreground hover:bg-accent'
                              )}
                            >
                              {on && <IconCheck className="h-3.5 w-3.5" />}
                              {g.name}
                              <span className="text-[0.65rem] opacity-70">{g.member_count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('session.groupsHint')}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="s_leader">
                {t(isVisit || isLeadersOnly ? 'session.visitMainLeader' : 'session.leader')}
              </Label>
              <Select
                id="s_leader"
                required
                value={form.leader_id}
                onChange={(e) => setForm((f) => ({ ...f, leader_id: e.target.value }))}
              >
                <option value="" disabled>
                  {t('leader.selectLeader')}
                </option>
                {leaderList
                  .filter((l) => l.status === 'active' || l.id === Number(form.leader_id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {memberName(l)}
                    </option>
                  ))}
              </Select>
            </div>
          </div>

          {/* زيارة الأهل: pick the عناصر whose families were visited — each one gets the
              visit recorded in their file the moment the نشاط is saved */}
          {isVisit && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <Label>
                  {t('session.visitedMembers')}
                  <span className="ms-2 font-normal text-muted-foreground">
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
                <div className="max-h-52 overflow-y-auto rounded-md border border-border p-1.5">
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
          )}

          {/* نشاط عام للفوج: عدد الحضور لكل فرقة بالتفصيل + عدد حضور القادة */}
          {isGroup && (
            <div className="space-y-1.5">
              <Label className="block">{t('session.branchCounts')}</Label>
              <div className="space-y-2 rounded-md border border-border p-3">
                {branchList.map((b) => (
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
          )}

          {!isGroup && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-2">
              <Label>
                {t(isVisit || isLeadersOnly ? 'session.visitParticipants' : 'session.helpers')}
                <span className="ms-2 font-normal text-muted-foreground">
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
              <div className="max-h-52 overflow-y-auto rounded-md border border-border p-1.5">
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
          )}

          {!isVisit && !isLeadersOnly && !isGroup && selectedBranch?.total_requirements > 0 && (
            <div className="space-y-1.5">
              <Label>
                {t('session.requirements')}
                <span className="ms-2 font-normal text-muted-foreground">
                  {t('session.selectedCount', { count: form.matalib.length })}
                </span>
              </Label>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border p-2">
                <RequirementGrid
                  total={selectedBranch.total_requirements}
                  selected={form.matalib}
                  onToggle={toggleMatalib}
                  label={t('session.requirements')}
                />
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
        )}
      </Dialog>
    </div>
  );
}
