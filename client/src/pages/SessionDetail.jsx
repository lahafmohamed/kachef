import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import ExportPdfButton from '../components/ExportPdfButton';
import SessionEditDialog from '../components/SessionEditDialog';
import SearchInput from '../components/SearchInput';
import { activityTypeKey, avatarName, branchName, fmtAmount, fmtDate, fmtTime, memberName } from '../utils';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  ProgressBar,
  SegmentedControl,
  Select,
  SkeletonPage,
  useConfirm,
  useToast,
  IconAlert,
  IconBack,
  IconCalendar,
  IconCheckAll,
  IconClipboard,
  IconClock,
  IconCoins,
  IconPencil,
  IconPin,
  IconPlus,
  IconSearch,
  IconTag,
  IconTrash,
  IconUsers,
} from '../components/ui';

// Absent is where every row starts, so it is selected quietly; présence — the
// mark the leader actually makes — keeps the solid fill and stands out
const MEMBER_STATUSES = [
  { value: 'present', key: 'session.present', tone: 'success', badge: 'success' },
  { value: 'absent', key: 'session.absent', tone: 'destructive-soft', badge: 'destructive' },
  { value: 'excused', key: 'session.excused', tone: 'warning-soft', badge: 'warning' },
];
const ANIMATOR_STATUSES = MEMBER_STATUSES.filter((s) => s.value !== 'excused');

// What the roster can be narrowed to: each mark, nobody marked yet, and — on a paid
// نشاط — who came without paying
const ROSTER_FILTERS = ['present', 'absent', 'excused', 'unmarked', 'unpaid'];
const isPaid = (m) => m.paid !== null && m.paid !== undefined;
const matchStatus = (m, f) =>
  !f ||
  (f === 'unmarked' ? !m.status : f === 'unpaid' ? m.status === 'present' && !isPaid(m) : m.status === f);

// رفض السيرفر لفرقة ليست للمستخدم يُقرأ كرسالة، لا كرمز خام
const attendanceError = (t, err) =>
  err.message === 'forbidden_branch'
    ? t('session.forbiddenBranch')
    : err.message === 'forbidden_fees'
      ? t('session.forbiddenFees')
      : err.message;

/** Read-only rendering of a présence status for view-only accounts. */
function StatusBadge({ status, t }) {
  const s = MEMBER_STATUSES.find((x) => x.value === status);
  if (!s) return <Badge variant="outline">{t('session.unmarked')}</Badge>;
  return <Badge variant={s.badge}>{t(s.key)}</Badge>;
}

/**
 * نشاط عام للفوج: الحضور مسجّل بالأعداد — عدد لكل فرقة بالتفصيل + عدد القادة.
 * Editable by the same permission that marks présence on the other kinds of نشاط.
 */
function GroupCountsCard({ session, editable, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const branches = useFetch('/branches');
  const [counts, setCounts] = useState(() =>
    Object.fromEntries((session.branch_counts || []).map((c) => [c.branch_id, String(c.count)]))
  );
  const [leadersCount, setLeadersCount] = useState(session.leaders_count ?? '');
  const [saving, setSaving] = useState(false);

  // The نشاط's own قسم: its counts are for its فرق only
  const list = (branches.data || []).filter((b) => b.section === session.section);
  const membersTotal = Object.values(counts).reduce((n, v) => n + (Number(v) || 0), 0);

  async function save() {
    setSaving(true);
    try {
      await api.post(`/sessions/${session.id}/counts`, {
        branch_counts: Object.entries(counts)
          .filter(([, v]) => v !== '' && v !== null)
          .map(([branchId, v]) => ({ branch_id: Number(branchId), count: Number(v) })),
        leaders_count: leadersCount === '' ? null : Number(leadersCount),
      });
      toast.success(t('session.countsSaved'));
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>{t('session.branchCounts')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('session.groupHint')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {(editable ? list : session.branch_counts || []).map((b) => {
          const id = editable ? b.id : b.branch_id;
          return (
            <div key={id} className="flex items-center justify-between gap-3">
              <Label htmlFor={`c_${id}`} className="flex-1">
                {branchName(b, i18n.language)}
              </Label>
              {editable ? (
                <Input
                  id={`c_${id}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  className="w-24"
                  value={counts[id] ?? ''}
                  onChange={(e) => setCounts((c) => ({ ...c, [id]: e.target.value }))}
                />
              ) : (
                <Badge variant="success">{b.count}</Badge>
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <Label htmlFor="c_leaders" className="flex-1">
            {t('session.leadersCount')}
          </Label>
          {editable ? (
            <Input
              id="c_leaders"
              type="number"
              inputMode="numeric"
              min="0"
              placeholder="0"
              className="w-24"
              value={leadersCount}
              onChange={(e) => setLeadersCount(e.target.value)}
            />
          ) : (
            <Badge variant="secondary">{session.leaders_count ?? '—'}</Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-sm font-medium">
            {t('session.totalAttendance')} :{' '}
            <span className="tabular-nums">{membersTotal + (Number(leadersCount) || 0)}</span>
          </span>
          {editable && (
            <Button size="sm" loading={saving} onClick={save}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * ضيوف نشاط القادة: أسماء حرّة لمن حضر من خارج البرنامج. لا حالة حضور لهم —
 * وجود الاسم هو الحضور — و لا يدخلون أي معدّل.
 */
function GuestsCard({ session, editable, onChange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const guests = session.guests || [];

  async function add(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setSaving(true);
    try {
      const r = await api.post(`/sessions/${session.id}/guests`, { name: clean });
      onChange(r.guests);
      setName('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(g) {
    if (!(await confirm(t('session.confirmRemoveGuest', { name: g.name })))) return;
    try {
      const r = await api.del(`/sessions/${session.id}/guests/${g.id}`);
      onChange(r.guests);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>
          {t('session.guests')}
          <span className="ms-2 font-normal tabular-nums text-muted-foreground">{guests.length}</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('session.guestsHint')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {editable && (
          <form onSubmit={add} className="flex gap-2">
            <Input
              autoComplete="off"
              maxLength={120}
              aria-label={t('session.guestPlaceholder')}
              placeholder={t('session.guestPlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" variant="outline" loading={saving} disabled={!name.trim()}>
              <IconPlus />
              {t('session.addGuest')}
            </Button>
          </form>
        )}
        {guests.length === 0 ? (
          !editable && <p className="text-sm text-muted-foreground">{t('session.noGuests')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {guests.map((g) => (
              <li key={g.id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                <Badge variant="outline">{t('session.guest')}</Badge>
                {editable && (
                  <Button
                    variant="destructive-ghost"
                    size="icon"
                    onClick={() => remove(g)}
                    aria-label={`${t('common.delete')} — ${g.name}`}
                  >
                    <IconTrash />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function SessionDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const back = useBack('/sessions');
  const toast = useToast();
  const confirm = useConfirm();

  // View-only: présence is displayed as badges, never as tappable controls
  const { has } = usePerms();
  const { user } = useAuth();
  const editable = has('sessions.attendance');
  // الاشتراك المالي صلاحية قائمة بذاتها: من لا يرى المبالغ لا تظهر له الخانة أصلًا،
  // و تسجيل الدفع يحتاج الصلاحيتين معًا (وضع الحضور + رؤية المبالغ)
  const canSeeFees = has('sessions.read.fees');
  const payEditable = editable && canSeeFees;
  const isAdmin = user?.role === 'admin';
  const { data: session, setData: setSession, loading, error, reload } = useFetch(`/sessions/${id}`);
  const leaders = useFetch('/leaders');
  // أسماء الفرق: النشاط المشترك يعرض فرقه في الترويسة و يقسّم لائحته عليها
  const branches = useFetch('/branches');
  const [bulkBusy, setBulkBusy] = useState(false);
  // تعديل تفاصيل النشاط بعد إنشائه — لمن يُنشئ الأنشطة
  const canEditSession = has('sessions.create');
  const [editingSession, setEditingSession] = useState(false);
  // فلترة عرض اللائحة (لا تمسّ الحضور المسجّل، عرضٌ فقط)
  const [filterBranch, setFilterBranch] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  // بحث بالاسم داخل اللائحة: اللوائح الطويلة تُطال بالكتابة لا بالتمرير
  const [rosterQuery, setRosterQuery] = useState('');
  // حالة الحضور: من غاب (للاتصال بأهله)، من لم يُؤشَّر بعد، من حضر و لم يدفع (للتحصيل).
  // في الرابط، فتفتح لوحة القيادة النشاطَ على ما يُطلب فيه مباشرة.
  const [sp, setSp] = useSearchParams();
  const statusFilter = ROSTER_FILTERS.includes(sp.get('status')) ? sp.get('status') : '';
  const setStatusFilter = (v) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        v ? n.set('status', v) : n.delete('status');
        return n;
      },
      { replace: true }
    );

  /**
   * Attendance is the hot path — a leader taps through 20+ children in a row.
   * Update the UI first and reconcile in the background so there is no
   * per-tap spinner or list re-render flash.
   */
  async function mark(memberId, status) {
    const prev = session;
    setSession((s) => ({
      ...s,
      roster: s.roster.map((m) => (m.id === memberId ? { ...m, status } : m)),
    }));
    try {
      await api.post(`/sessions/${id}/attendance`, { member_id: memberId, status });
    } catch (err) {
      setSession(prev);
      toast.error(attendanceError(t, err));
    }
  }

  /**
   * تسجيل اشتراك عنصر في هذا النشاط. amount = null معناه «لم يدفع» (يمسح المبلغ).
   * كالحضور: الشاشة تسبق السيرفر و ترجع إن رُفض الحفظ.
   */
  async function setPaid(memberId, amount) {
    const prev = session;
    setSession((s) => ({
      ...s,
      roster: s.roster.map((m) => (m.id === memberId ? { ...m, paid: amount } : m)),
    }));
    try {
      await api.post(`/sessions/${id}/attendance`, { member_id: memberId, paid: amount });
    } catch (err) {
      setSession(prev);
      toast.error(attendanceError(t, err));
    }
  }

  // inScope حين يُمرَّر: الزرّ لا يتجاوز ما يراه القائد — فرقته بعد الفلاتر و البحث.
  // الغياب هو الافتراضي منذ الإنشاء، فالزرّ يقلب غير الحاضرين — عدا المعذورين،
  // فعذرهم وُضع قصدًا و لا يُمسح جملةً.
  async function markAllPresent(inScope = null) {
    const unmarked = session.roster.filter(
      (m) => (!m.status || m.status === 'absent') && (!inScope || inScope(m))
    );
    if (unmarked.length === 0) return;
    if (
      !(await confirm({
        title: t('session.markAllPresent'),
        message: t('session.markAllConfirm', { count: unmarked.length }),
        destructive: false,
        confirmLabel: t('session.markAllPresent'),
      }))
    )
      return;

    setBulkBusy(true);
    const prev = session;
    const ids = new Set(unmarked.map((m) => m.id));
    setSession((s) => ({
      ...s,
      roster: s.roster.map((m) => (ids.has(m.id) ? { ...m, status: 'present' } : m)),
    }));
    try {
      for (const m of unmarked) {
        await api.post(`/sessions/${id}/attendance`, { member_id: m.id, status: 'present' });
      }
      toast.success(t('session.markedCount', { count: unmarked.length }));
      reload({ quiet: true });
    } catch (err) {
      setSession(prev);
      toast.error(attendanceError(t, err));
    } finally {
      setBulkBusy(false);
    }
  }

  // العناصر غير المعلَّمين (unmarked) لا يُحسبون في المعدّل. حين يُنهي القائد التنقيط
  // يعلّم الباقين غيابًا بضغطة: من لم يُلمس فقط يصير غائبًا — الحاضر و المعذور لا يُمسّان.
  async function markAllAbsent(inScope = null) {
    const untouched = session.roster.filter((m) => !m.status && (!inScope || inScope(m)));
    if (untouched.length === 0) return;
    if (
      !(await confirm({
        title: t('session.markRestAbsentTitle'),
        message: t('session.markAllAbsentConfirm', { count: untouched.length }),
        destructive: false,
        confirmLabel: t('session.markRestAbsentTitle'),
      }))
    )
      return;
    setBulkBusy(true);
    const prev = session;
    const ids = new Set(untouched.map((m) => m.id));
    setSession((s) => ({
      ...s,
      roster: s.roster.map((m) => (ids.has(m.id) ? { ...m, status: 'absent' } : m)),
    }));
    try {
      for (const m of untouched) {
        await api.post(`/sessions/${id}/attendance`, { member_id: m.id, status: 'absent' });
      }
      toast.success(t('session.markedAbsentCount', { count: untouched.length }));
      reload({ quiet: true });
    } catch (err) {
      setSession(prev);
      toast.error(attendanceError(t, err));
    } finally {
      setBulkBusy(false);
    }
  }

  // نشاط قادة: زرّ يقلب غير المعلَّمين حاضرين — الغياب الموضوع قصدًا لا يُمسّ
  async function markAllLeadersPresent() {
    const unmarked = (session.animators || []).filter((a) => !a.status);
    if (unmarked.length === 0) return;
    if (
      !(await confirm({
        title: t('session.markAllPresent'),
        message: t('session.markAllConfirm', { count: unmarked.length }),
        destructive: false,
        confirmLabel: t('session.markAllPresent'),
      }))
    )
      return;
    setBulkBusy(true);
    const prev = session;
    const ids = new Set(unmarked.map((a) => a.leader_id));
    setSession((s) => ({
      ...s,
      animators: s.animators.map((a) => (ids.has(a.leader_id) ? { ...a, status: 'present' } : a)),
    }));
    try {
      for (const a of unmarked) {
        await api.post(`/sessions/${id}/animators`, { leader_id: a.leader_id, status: 'present' });
      }
      toast.success(t('session.markedCount', { count: unmarked.length }));
      reload({ quiet: true });
    } catch (err) {
      setSession(prev);
      toast.error(attendanceError(t, err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function markAnimator(leaderId, status) {
    const prev = session;
    setSession((s) => ({
      ...s,
      animators: s.animators.map((a) => (a.leader_id === leaderId ? { ...a, status } : a)),
    }));
    try {
      await api.post(`/sessions/${id}/animators`, { leader_id: leaderId, status });
    } catch (err) {
      setSession(prev);
      toast.error(attendanceError(t, err));
    }
  }

  async function addHelper(leaderId) {
    if (!leaderId) return;
    try {
      await api.post(`/sessions/${id}/animators`, { leader_id: Number(leaderId), status: null });
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeSession() {
    if (
      !(await confirm({
        title: t('session.deleteTitle'),
        message: t('session.deleteConfirm', { title: session.title }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      await api.del(`/sessions/${id}`);
      toast.success(t('session.deleted'));
      back();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeHelper(a) {
    if (!(await confirm(t('session.confirmRemoveHelper', { name: memberName(a) }))))
      return;
    try {
      await api.post(`/sessions/${id}/animators`, { leader_id: a.leader_id, remove: true });
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) return <SkeletonPage rows={6} />;
  if (error)
    return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  // الغياب هو الافتراضي: «المُنجَز» هو من قُلب حاضرًا أو عُذر، و الباقي بانتظار القائد
  const marked = session.roster.filter((m) => m.status === 'present' || m.status === 'excused').length;
  const totalRoster = session.roster.length;
  const pct = totalRoster ? Math.round((marked / totalRoster) * 100) : 0;
  const counts = {
    present: session.roster.filter((m) => m.status === 'present').length,
    absent: session.roster.filter((m) => m.status === 'absent').length,
    excused: session.roster.filter((m) => m.status === 'excused').length,
  };
  // حصيلة الاشتراكات: يجمعها البرنامج من خانات اللائحة المعروضة — فالقائد لا يجمع
  // بيده، و النشاط المشترك يُظهر لكل قائد حصيلة فرقه التي يراها.
  const payers = session.roster.filter((m) => m.paid !== null && m.paid !== undefined);
  const collected = payers.reduce((n, m) => n + m.paid, 0);
  // نشاط قادة: لائحته هي القادة أنفسهم — تقدّمه و أزراره تُبنى من animators
  const isLeadersSession = session.kind === 'leaders';
  const leaderRoster = session.animators || [];
  const leaderMarked = leaderRoster.filter((a) => a.status).length;
  const leaderCounts = {
    present: leaderRoster.filter((a) => a.status === 'present').length,
    absent: leaderRoster.filter((a) => a.status === 'absent').length,
  };
  // قادة قسم النشاط وحدهم: قائدة لا تُضاف إلى نشاط الفتيان، و العكس
  const availableHelpers = (leaders.data || []).filter(
    (l) =>
      l.status === 'active' &&
      l.section === session.section &&
      !session.animators?.some((a) => a.leader_id === l.id)
  );
  // فرق النشاط بأسمائها، و الفرق التي تظهر فعلًا في اللائحة (فرق المستخدم منها)
  const branchList = branches.data || [];
  const sessionBranches = (session.branch_ids?.length ? session.branch_ids : [session.branch_id])
    .map((bid) => branchList.find((b) => b.id === bid))
    .filter(Boolean);
  // اللائحة مقسّمة على الفرق حين يشمل النشاط أكثر من واحدة: كل قائد يملأ قسم فرقته
  const rosterBranchIds = [...new Set(session.roster.map((m) => m.branch_id))];
  const splitRoster = rosterBranchIds.length > 1;
  // فلاتر اللائحة: بالفرقة (إن تعدّدت) و بالمجموعة الفرعية. تُبنى المجموعات من اللائحة
  // نفسها، و تُقصر على الفرقة المختارة إن وُجدت، فلا تظهر مجموعة لا عنصر منها معروض.
  const rosterGroups = [
    ...new Map(
      session.roster
        .filter((m) => m.group_id && (!filterBranch || m.branch_id === Number(filterBranch)))
        .map((m) => [m.group_id, { id: m.group_id, name: m.group_name }])
    ).values(),
  ];
  // البحث يقبل أجزاء الاسم بأيّ ترتيب، فـ«سالم محمد» تجد «محمد سالم»
  const queryWords = rosterQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchQuery = (m) => {
    if (queryWords.length === 0) return true;
    const name = memberName(m).toLowerCase();
    return queryWords.every((w) => name.includes(w));
  };
  // Each status says how many it holds. An empty one is left out — unless it is the
  // one asked for (a dashboard link to a نشاط everyone has since paid for), so the
  // empty list still shows which filter emptied it.
  const statusOptions = [
    { value: 'present', label: t('session.tallyPresent') },
    { value: 'absent', label: t('session.tallyAbsent') },
    { value: 'excused', label: t('session.tallyExcused') },
    { value: 'unmarked', label: t('session.tallyUnmarked') },
    // Only where an amount is asked, and for who may see amounts
    ...(canSeeFees && session.fee > 0 ? [{ value: 'unpaid', label: t('session.tallyUnpaid') }] : []),
  ]
    .map((o) => ({ ...o, count: session.roster.filter((m) => matchStatus(m, o.value)).length }))
    .filter((o) => o.count > 0 || o.value === statusFilter);
  // A زيارة has no status control, so a status carried in its address is ignored
  const rosterStatus =
    session.kind !== 'visit' && statusOptions.some((o) => o.value === statusFilter) ? statusFilter : '';
  const matchFilters = (m) =>
    (!filterBranch || m.branch_id === Number(filterBranch)) &&
    (!filterGroup || m.group_id === Number(filterGroup)) &&
    matchStatus(m, rosterStatus) &&
    matchQuery(m);
  const branchIdsToShow = filterBranch ? [Number(filterBranch)] : rosterBranchIds;
  // ما تُظهره اللائحة بعد الفلاتر و البحث — يميّز «لا نتائج» من لائحة فارغة،
  // و يضبط أزرار الجملة: عددها و أثرها على ما يراه القائد وحده، لا على مخفيّ اللائحة
  const visible = session.roster.filter(matchFilters);
  const visibleRoster = visible.length;
  const visibleLeft = visible.filter((m) => !m.status || m.status === 'absent').length;
  const visibleUntouched = visible.filter((m) => !m.status).length;

  // تقدّم الحضور و أزرار الجملة. في نشاط القادة يأتي بعد القادة، فوق لائحة الفرق المدعوّة.
  const rosterProgress = totalRoster > 0 && (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* À côté du compteur des قادة, celui-ci doit dire de qui il parle */}
        {isLeadersSession && <p className="text-sm font-semibold">{t('session.invitedRoster')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium tabular-nums">
            {t('session.marked', { marked, total: totalRoster })}
          </div>
          {/* Named, not just coloured: the colour repeats the word */}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="success">
              {t('session.tallyPresent')} <span className="tabular-nums">{counts.present}</span>
            </Badge>
            <Badge variant="destructive">
              {t('session.tallyAbsent')} <span className="tabular-nums">{counts.absent}</span>
            </Badge>
            <Badge variant="warning">
              {t('session.tallyExcused')} <span className="tabular-nums">{counts.excused}</span>
            </Badge>
          </div>
        </div>
        <ProgressBar value={pct} label={t('session.attendance')} />
        {/* ---------- حصيلة الاشتراكات، محسوبة تلقائيًا من خانات اللائحة ---------- */}
        {canSeeFees && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <IconCoins className="h-4 w-4 text-muted-foreground" />
              {t('session.subscriptions')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={collected > 0 ? 'success' : 'outline'}>{fmtAmount(collected)}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('session.paidCount', { paid: payers.length, total: totalRoster })}
              </span>
              {session.fee > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  · {t('session.expectedTotal', { amount: fmtAmount(session.fee * totalRoster) })}
                </span>
              )}
            </div>
          </div>
        )}
        {/* اللائحة المقسّمة لها زرّ لكل فرقة، فالزرّ الجامع هنا يصير تكرارًا */}
        {editable && !splitRoster && visibleLeft > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={bulkBusy}
              onClick={() => markAllPresent(matchFilters)}
              className="w-full sm:w-auto"
            >
              <IconCheckAll />
              {t('session.markRestPresent', { count: visibleLeft })}
            </Button>
            {visibleUntouched > 0 && (
              <Button
                variant="outline"
                size="sm"
                loading={bulkBusy}
                onClick={() => markAllAbsent(matchFilters)}
                className="w-full sm:w-auto"
              >
                {t('session.markRestAbsent', { count: visibleUntouched })}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Icon-only actions on phones, as on a عنصر's page: four labelled buttons ran
          120px past a 360px screen in French */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
          <IconBack className="rtl:rotate-180" />
          {t('common.back')}
        </Button>
        <div className="flex items-center gap-2">
          {canEditSession && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingSession(true)}
              aria-label={t('common.edit')}
              className="w-11 px-0 sm:w-auto sm:px-3"
            >
              <IconPencil />
              <span className="sr-only sm:not-sr-only">{t('common.edit')}</span>
            </Button>
          )}
          <ExportPdfButton kind="sessions" id={session.id} compact />
          {isAdmin && (
            <Button
              variant="destructive-ghost"
              size="sm"
              onClick={removeSession}
              aria-label={t('common.delete')}
              className="w-11 px-0 sm:w-auto sm:px-3"
            >
              <IconTrash />
              <span className="sr-only sm:not-sr-only">{t('common.delete')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Three short lines instead of one long one: when and where, who it is
          for, then who leads it and what it costs */}
      <div className="space-y-3">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{session.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5 tabular-nums">
            <IconCalendar className="h-3.5 w-3.5" />
            {fmtDate(session.date)}
          </span>
          {session.start_time && (
            <span className="flex items-center gap-1.5 tabular-nums">
              <IconClock className="h-3.5 w-3.5" />
              {fmtTime(session.start_time)}
            </span>
          )}
          {session.place && (
            <span className="flex items-center gap-1.5">
              <IconPin className="h-3.5 w-3.5" />
              {session.place}
            </span>
          )}
          {activityTypeKey(session.activity_type) && (
            <span className="flex items-center gap-1.5">
              <IconTag className="h-3.5 w-3.5" />
              {t(activityTypeKey(session.activity_type))}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {session.branch_id ? (
            // النشاط المشترك يحمل شارة لكل فرقة يشملها
            sessionBranches.length > 1 ? (
              sessionBranches.map((b) => <Badge key={b.id}>{branchName(b, i18n.language)}</Badge>)
            ) : (
              // فرقة واحدة مرئية: اسمها هو المعروض، لا اسم الفرقة الرئيسية التي قد
              // تكون خارج نطاق المستخدم
              <Badge>{branchName(sessionBranches[0] || session, i18n.language)}</Badge>
            )
          ) : (
            <>
              <Badge variant="secondary">
                {t(session.kind === 'group' ? 'session.kindGroup' : 'session.kindLeaders')}
              </Badge>
              {/* نشاط القادة: فرقه المدعوّة بعد نوعه */}
              {sessionBranches.map((b) => (
                <Badge key={b.id} variant="outline">
                  {branchName(b, i18n.language)}
                </Badge>
              ))}
            </>
          )}
          {/* النشاط المحصور بمجموعات: أسماؤها بعد الفرقة، فاللائحة أقصر من الفرقة
              كاملةً و القائد يعرف لِمَ */}
          {(session.groups || []).map((g) => (
            <Badge key={g.id} variant="outline">
              {g.name}
            </Badge>
          ))}
          {session.matalib.length > 0 && (
            <Badge variant="warning">
              {t('session.requirementsShort')} : {session.matalib.join('، ')}
            </Badge>
          )}
        </div>
        {(session.leader || session.fee !== null) && (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {session.leader && (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t('session.leader')}</dt>
                <dd>
                  {session.leader_id ? (
                    <Link
                      to={`/leaders/${session.leader_id}`}
                      className="focus-ring rounded font-medium hover:text-primary hover:underline"
                    >
                      {session.leader}
                    </Link>
                  ) : (
                    <span className="font-medium">{session.leader}</span>
                  )}
                </dd>
              </div>
            )}
            {session.fee !== null && (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t('session.fee')}</dt>
                <dd className="font-medium tabular-nums">{fmtAmount(session.fee)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* ---------- بطاقات التحضير المربوطة بهذا النشاط ---------- */}
      {session.prep_cards?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {session.prep_cards.map((c) => (
            <Link
              key={c.id}
              to={`/prep-cards/${c.id}`}
              className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-3.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 sm:min-h-10"
            >
              <IconClipboard className="h-3.5 w-3.5" />
              {t('prep.cardLabel')} : {c.title}
            </Link>
          ))}
        </div>
      )}

      {/* ---------- نشاط عام للفوج: عدد الحضور لكل فرقة ---------- */}
      {session.kind === 'group' && (
        <GroupCountsCard
          session={session}
          editable={editable}
          onSaved={() => reload({ quiet: true })}
        />
      )}

      {/* ---------- Attendance progress + bulk action ---------- */}
      {!isLeadersSession && rosterProgress}

      {/* ---------- تقدّم حضور القادة في نشاط قادة ---------- */}
      {isLeadersSession && leaderRoster.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium tabular-nums">
                {t('session.marked', { marked: leaderMarked, total: leaderRoster.length })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="success">
                  {t('session.tallyPresent')} <span className="tabular-nums">{leaderCounts.present}</span>
                </Badge>
                <Badge variant="destructive">
                  {t('session.tallyAbsent')} <span className="tabular-nums">{leaderCounts.absent}</span>
                </Badge>
              </div>
            </div>
            <ProgressBar
              value={leaderRoster.length ? Math.round((leaderMarked / leaderRoster.length) * 100) : 0}
              label={t('session.attendance')}
            />
            {editable && leaderMarked < leaderRoster.length && (
              <Button
                variant="outline"
                size="sm"
                loading={bulkBusy}
                onClick={markAllLeadersPresent}
                className="w-full sm:w-auto"
              >
                <IconCheckAll />
                {t('session.markRestPresent', { count: leaderRoster.length - leaderMarked })}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- Animateurs / حضور القادة ---------- */}
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t(isLeadersSession ? 'session.leadersAttendance' : 'session.animators')}</CardTitle>
          {!isLeadersSession && editable && availableHelpers.length > 0 && (
            <Select
              className="sm:w-auto"
              value=""
              onChange={(e) => addHelper(e.target.value)}
              aria-label={t('session.addHelper')}
            >
              <option value="">{t('session.addHelper')}</option>
              {availableHelpers.map((l) => (
                <option key={l.id} value={l.id}>
                  {memberName(l)}
                </option>
              ))}
            </Select>
          )}
        </CardHeader>
        <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
          {(session.animators || []).length === 0 ? (
            <EmptyState icon={<IconUsers className="h-6 w-6" />} title={t('session.noAnimators')} />
          ) : (
            <ul className="divide-y divide-border">
              {session.animators.map((a) => (
                <li key={a.leader_id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <Avatar photo={a.photo} name={avatarName(a)} />
                  <div className="min-w-32 flex-1">
                    <Link
                      to={`/leaders/${a.leader_id}`}
                      className="focus-ring rounded font-medium hover:text-primary hover:underline"
                    >
                      {memberName(a)}
                    </Link>
                    {/* في نشاط القادة الكل حاضرون بصفتهم قادة: لا معنى لشارة «مساعد» */}
                    {(!isLeadersSession || a.role === 'main') && (
                      <div className="mt-0.5">
                        <Badge variant={a.role === 'main' ? 'default' : 'secondary'}>
                          {t(a.role === 'main' ? 'session.mainAnimator' : 'session.helper')}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="flex w-full items-center gap-1.5 sm:w-auto sm:shrink-0">
                    {editable ? (
                      <>
                        <SegmentedControl
                          className="w-full sm:w-auto sm:[&>button]:whitespace-nowrap"
                          label={memberName(a)}
                          value={a.status}
                          onChange={(v) => markAnimator(a.leader_id, v)}
                          options={ANIMATOR_STATUSES.map((s) => ({ ...s, label: t(s.key) }))}
                        />
                        {!isLeadersSession &&
                          (a.role === 'helper' ? (
                            <Button
                              variant="destructive-ghost"
                              size="icon"
                              onClick={() => removeHelper(a)}
                              aria-label={`${t('common.delete')} — ${memberName(a)}`}
                              // The full-width control beside it squeezed it to 37px
                              className="shrink-0"
                            >
                              <IconTrash />
                            </Button>
                          ) : (
                            // The main leader can't be removed: an empty slot of the
                            // same width keeps every row's control in one column
                            <span aria-hidden="true" className="w-11 shrink-0 sm:w-9" />
                          ))}
                      </>
                    ) : (
                      <StatusBadge status={a.status} t={t} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---------- ضيوف نشاط القادة ---------- */}
      {isLeadersSession && (
        <GuestsCard
          session={session}
          editable={editable}
          onChange={(guests) => setSession((s) => ({ ...s, guests }))}
        />
      )}

      {isLeadersSession && rosterProgress}

      {/* ---------- Roster ---------- */}
      {/* نشاط قادة lists only the عناصر of its invited فرق (présence of the قادة is on
          the animators card above), and a نشاط عام للفوج counts its حضور instead of
          listing names */}
      {session.kind !== 'group' && (!isLeadersSession || totalRoster > 0) && (
      <Card>
        {/* الترويسة تلتصق أثناء التمرير: لائحة من ستين عنصرًا تدفع البحث خارج الشاشة،
            فيعود القائد للأعلى ليكتب اسمًا. الإزاحة هي ارتفاع شريط الهاتف
            مع حافة الشاشة (safe-t)، و lg:top-0 على الشاشات التي لا شريط فيها */}
        <CardHeader className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top,0px))] z-10 gap-3 rounded-t-2xl border-b border-border bg-card pb-3 sm:flex-row sm:items-center sm:justify-between sm:pb-3 lg:top-0">
          <CardTitle>
            {t(
              session.kind === 'visit'
                ? 'session.visitedMembers'
                : isLeadersSession
                  ? 'session.invitedRoster'
                  : 'session.roster'
            )}
          </CardTitle>
          {/* البحث بالاسم دائمًا، ثم الفلاتر: بالفرقة إن تعدّدت، و بالمجموعة الفرعية إن وُجدت */}
          {totalRoster > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <SearchInput
                value={rosterQuery}
                onChange={setRosterQuery}
                autoFocusHotkey={false}
                placeholder={t('session.searchMember')}
                className="sm:w-72 sm:flex-none"
              />
              {rosterBranchIds.length > 1 && (
                <Select
                  className="sm:w-auto"
                  value={filterBranch}
                  onChange={(e) => {
                    setFilterBranch(e.target.value);
                    setFilterGroup('');
                  }}
                  aria-label={t('session.filterByBranch')}
                >
                  <option value="">{t('session.allBranches')}</option>
                  {rosterBranchIds.map((bid) => (
                    <option key={bid} value={bid}>
                      {branchName(branchList.find((x) => x.id === bid), i18n.language)}
                    </option>
                  ))}
                </Select>
              )}
              {rosterGroups.length > 0 && (
                <Select
                  className="sm:w-auto"
                  value={filterGroup}
                  onChange={(e) => setFilterGroup(e.target.value)}
                  aria-label={t('session.filterByGroup')}
                >
                  <option value="">{t('session.allGroups')}</option>
                  {rosterGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
              {/* A زيارة lists who was visited, not marks: nothing to narrow there */}
              {session.kind !== 'visit' && statusOptions.length > 0 && (
                <Select
                  className="sm:w-auto"
                  value={rosterStatus}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label={t('member.status')}
                >
                  <option value="">{t('member.allStatuses')}</option>
                  {statusOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {`${o.label} · ${o.count}`}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
          {totalRoster === 0 ? (
            <EmptyState icon={<IconUsers className="h-6 w-6" />} title={t('session.emptyRoster')} />
          ) : visibleRoster === 0 ? (
            <EmptyState icon={<IconSearch className="h-6 w-6" />} title={t('common.noResults')} />
          ) : splitRoster ? (
            // نشاط مشترك: قسم لكل فرقة، يملأه قائدها أو مساعده — لا شخص واحد للجميع.
            // الفلاتر تقصر الفرق المعروضة و العناصر داخل كل قسم على المطابق وحده.
            branchIdsToShow
              .map((bid) => {
              const rows = session.roster.filter((m) => m.branch_id === bid && matchFilters(m));
              if (rows.length === 0) return null;
              const left = rows.filter((m) => !m.status || m.status === 'absent').length;
              const rowsUntouched = rows.filter((m) => !m.status).length;
              const rowsCollected = rows.reduce((n, m) => n + (m.paid || 0), 0);
              const b = branchList.find((x) => x.id === bid);
              return (
                <section key={bid}>
                  <div className="flex flex-wrap items-center gap-2 border-y border-border bg-muted/30 px-4 py-2 sm:px-5">
                    <span className="text-sm font-semibold">{branchName(b, i18n.language)}</span>
                    <Badge variant={left === 0 ? 'success' : 'outline'}>
                      {t('session.marked', { marked: rows.length - left, total: rows.length })}
                    </Badge>
                    {/* حصيلة اشتراكات هذه الفرقة وحدها — كل قائد يرى جمع لائحته */}
                    {canSeeFees && rowsCollected > 0 && (
                      <Badge variant="success">
                        <IconCoins className="h-3 w-3" />
                        {fmtAmount(rowsCollected)}
                      </Badge>
                    )}
                    <span className="grow" />
                    {editable && left > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={bulkBusy}
                        onClick={() => markAllPresent((m) => m.branch_id === bid && matchFilters(m))}
                      >
                        <IconCheckAll />
                        {t('session.markRestPresent', { count: left })}
                      </Button>
                    )}
                    {editable && rowsUntouched > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={bulkBusy}
                        onClick={() => markAllAbsent((m) => m.branch_id === bid && matchFilters(m))}
                      >
                        {t('session.markRestAbsent', { count: rowsUntouched })}
                      </Button>
                    )}
                  </div>
                  <ul className="divide-y divide-border">
                    {rows.map((m) => (
                      <RosterRow
                        key={m.id}
                        m={m}
                        editable={editable}
                        mark={mark}
                        t={t}
                        canSeeFees={canSeeFees}
                        payEditable={payEditable}
                        fee={session.fee}
                        setPaid={setPaid}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          ) : (
            <ul className="divide-y divide-border">
              {session.roster.filter(matchFilters).map((m) => (
                <RosterRow
                  key={m.id}
                  m={m}
                  editable={editable}
                  mark={mark}
                  t={t}
                  canSeeFees={canSeeFees}
                  payEditable={payEditable}
                  fee={session.fee}
                  setPaid={setPaid}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      )}

      {canEditSession && (
        <SessionEditDialog
          session={session}
          branches={branches.data || []}
          open={editingSession}
          onClose={() => setEditingSession(false)}
          onSaved={() => {
            setEditingSession(false);
            // Leader, matalib and fee feed several blocks of the page: read it back whole
            reload({ quiet: true });
            toast.success(t('session.updated'));
          }}
        />
      )}
    </div>
  );
}

/**
 * سطر عنصر في لائحة الحضور: الاسم، تنبيه الغيابات المتتالية، خانة الاشتراك، و أزرار الحالة.
 */
function RosterRow({ m, editable, mark, t, canSeeFees, payEditable, fee, setPaid }) {
  return (
    <li className={cnRow(m.status)}>
      <Avatar photo={m.photo} name={avatarName(m)} />
      <div className="min-w-32 flex-1">
        <Link
          to={`/members/${m.id}`}
          className="focus-ring rounded font-medium hover:text-primary hover:underline"
        >
          {memberName(m)}
        </Link>
        {m.consecutive_absences >= 3 && (
          <div className="mt-0.5">
            <Badge variant="destructive">
              <IconAlert className="h-3 w-3" />
              {t('member.consecutiveAbsences', { count: m.consecutive_absences })}
            </Badge>
          </div>
        )}
      </div>
      {/* خانة الاشتراك بجانب الاسم — تبقى على سطر الاسم في الهاتف، فلا يطول السطر */}
      {canSeeFees && (
        <div className="shrink-0">
          {payEditable ? (
            <PaidCell m={m} fee={fee} t={t} onSave={(v) => setPaid(m.id, v)} />
          ) : m.paid !== null && m.paid !== undefined ? (
            <Badge variant="success">
              <IconCoins className="h-3 w-3" />
              {fmtAmount(m.paid)}
            </Badge>
          ) : m.status === 'present' ? (
            <Badge variant="outline">{t('session.notPaid')}</Badge>
          ) : null}
        </div>
      )}
      {/* Natural width and one-line labels from sm up: squeezed, «غائب بعذر» wrapped
          onto two lines. Phones keep the full-width control, where wrapping is the fallback */}
      <div className="w-full sm:w-auto sm:shrink-0">
        {editable ? (
          <SegmentedControl
            className="w-full sm:w-auto sm:[&>button]:whitespace-nowrap"
            label={memberName(m)}
            value={m.status}
            onChange={(v) => mark(m.id, v)}
            options={MEMBER_STATUSES.map((s) => ({ ...s, label: t(s.key) }))}
          />
        ) : (
          <StatusBadge status={m.status} t={t} />
        )}
      </div>
    </li>
  );
}

/**
 * خانة الاشتراك: زرّ يعرض المبلغ المدفوع، و ضغطه يفتح حقل رقم لتعديله.
 *
 * الضغطة الأولى تملأ الحقل بأجرة النشاط (sessions.fee) فالأغلب يدفعها كاملة و لا
 * يبقى إلا التأكيد؛ و من دفع مبلغًا آخر يكتبه. إفراغ الحقل يعيده «لم يدفع».
 */
function PaidCell({ m, fee, t, onSave }) {
  const paid = m.paid !== null && m.paid !== undefined;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  // الهروب (Escape) يغلق الحقل بلا حفظ — و إغلاقه يطلق blur، فيُتخطّى مرّة واحدة
  const skipCommit = useRef(false);

  function open() {
    setValue(paid ? String(m.paid) : fee !== null && fee !== undefined ? String(fee) : '');
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const raw = value.trim();
    const next = raw === '' ? null : Number(raw);
    // رقم غير صالح: يُترك المبلغ كما كان بدل كتابة NaN
    if (raw !== '' && (!Number.isFinite(next) || next < 0)) return;
    if ((paid ? m.paid : null) === next) return;
    onSave(next);
  }

  if (editing)
    return (
      <Input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        autoFocus
        dir="ltr"
        className="h-11 w-24 text-center tabular-nums sm:h-9"
        aria-label={t('session.subscriptionOf', { name: memberName(m) })}
        placeholder={t('session.notPaid')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (skipCommit.current) {
            skipCommit.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            skipCommit.current = true;
            setEditing(false);
          }
        }}
      />
    );

  // Nothing paid by someone not marked present: still recordable, but a bare
  // coin rather than forty «Non payé» buttons down a list of absences
  if (!paid && m.status !== 'present')
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={open}
        className="text-muted-foreground"
        aria-label={t('session.subscriptionOf', { name: memberName(m) })}
        title={t('session.notPaid')}
      >
        <IconCoins className="h-4 w-4" />
      </Button>
    );

  return (
    <Button
      variant={paid ? 'secondary' : 'outline'}
      size="sm"
      onClick={open}
      className={paid ? 'gap-1.5 tabular-nums text-success' : 'gap-1.5 text-muted-foreground'}
      aria-label={t('session.subscriptionOf', { name: memberName(m) })}
    >
      <IconCoins className="h-3.5 w-3.5" />
      {paid ? fmtAmount(m.paid) : t('session.notPaid')}
    </Button>
  );
}

/* Unmarked children keep a faint highlight so the leader can see what's left. */
function cnRow(status) {
  return [
    'flex flex-wrap items-center gap-3 px-4 py-3 transition-colors sm:px-5',
    status ? '' : 'bg-warning/5',
  ]
    .filter(Boolean)
    .join(' ');
}
