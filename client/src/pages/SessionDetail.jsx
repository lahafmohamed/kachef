import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import { activityTypeKey, avatarName, branchName, fmtDate, fmtTime, memberName } from '../utils';
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
  IconCheckAll,
  IconClock,
  IconPin,
  IconTrash,
  IconUsers,
} from '../components/ui';

const MEMBER_STATUSES = [
  { value: 'present', key: 'session.present', tone: 'success' },
  { value: 'absent', key: 'session.absent', tone: 'destructive' },
  { value: 'excused', key: 'session.excused', tone: 'warning' },
];
const ANIMATOR_STATUSES = MEMBER_STATUSES.filter((s) => s.value !== 'excused');

// رفض السيرفر لفرقة ليست للمستخدم يُقرأ كرسالة، لا كرمز خام
const attendanceError = (t, err) =>
  err.message === 'forbidden_branch' ? t('session.forbiddenBranch') : err.message;

/** Read-only rendering of a présence status for view-only accounts. */
function StatusBadge({ status, t }) {
  const s = MEMBER_STATUSES.find((x) => x.value === status);
  if (!s) return <Badge variant="outline">{t('session.unmarked')}</Badge>;
  return <Badge variant={s.tone}>{t(s.key)}</Badge>;
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

  const list = branches.data || [];
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

export default function SessionDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const back = useBack('/sessions');
  const toast = useToast();
  const confirm = useConfirm();

  // View-only: présence is displayed as badges, never as tappable controls
  const { has } = usePerms();
  const editable = has('sessions.attendance');
  const { data: session, setData: setSession, loading, error, reload } = useFetch(`/sessions/${id}`);
  const leaders = useFetch('/leaders');
  // أسماء الفرق: النشاط المشترك يعرض فرقه في الترويسة و يقسّم لائحته عليها
  const branches = useFetch('/branches');
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // فرقة واحدة حين تُمرَّر: كل قائد يُتمّ لائحة فرقته وحدها في النشاط المشترك
  async function markAllPresent(branchId = null) {
    const unmarked = session.roster.filter(
      (m) => !m.status && (branchId === null || m.branch_id === branchId)
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

  const marked = session.roster.filter((m) => m.status).length;
  const totalRoster = session.roster.length;
  const pct = totalRoster ? Math.round((marked / totalRoster) * 100) : 0;
  const counts = {
    present: session.roster.filter((m) => m.status === 'present').length,
    absent: session.roster.filter((m) => m.status === 'absent').length,
    excused: session.roster.filter((m) => m.status === 'excused').length,
  };
  const availableHelpers = (leaders.data || []).filter(
    (l) => l.status === 'active' && !session.animators?.some((a) => a.leader_id === l.id)
  );
  // فرق النشاط بأسمائها، و الفرق التي تظهر فعلًا في اللائحة (فرق المستخدم منها)
  const branchList = branches.data || [];
  const sessionBranches = (session.branch_ids?.length ? session.branch_ids : [session.branch_id])
    .map((bid) => branchList.find((b) => b.id === bid))
    .filter(Boolean);
  // اللائحة مقسّمة على الفرق حين يشمل النشاط أكثر من واحدة: كل قائد يملأ قسم فرقته
  const rosterBranchIds = [...new Set(session.roster.map((m) => m.branch_id))];
  const splitRoster = rosterBranchIds.length > 1;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={back} className="-ms-2">
        <IconBack className="rtl:rotate-180" />
        {t('common.back')}
      </Button>

      <div className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{session.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">{fmtDate(session.date)}</span>
          {session.start_time && (
            <span className="flex items-center gap-1 tabular-nums">
              <IconClock className="h-3.5 w-3.5" />
              {fmtTime(session.start_time)}
            </span>
          )}
          {session.place && (
            <span className="flex items-center gap-1">
              <IconPin className="h-3.5 w-3.5" />
              {session.place}
            </span>
          )}
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
            <Badge variant="secondary">
              {t(session.kind === 'group' ? 'session.kindGroup' : 'session.kindLeaders')}
            </Badge>
          )}
          {/* النشاط المحصور بمجموعات: أسماؤها بعد الفرقة، فاللائحة أقصر من الفرقة
              كاملةً و القائد يعرف لِمَ */}
          {(session.groups || []).map((g) => (
            <Badge key={g.id} variant="outline">
              {g.name}
            </Badge>
          ))}
          {activityTypeKey(session.activity_type) && (
            <Badge variant="outline">{t(activityTypeKey(session.activity_type))}</Badge>
          )}
          {session.leader && (
            <span>
              {t('session.leader')} :{' '}
              {session.leader_id ? (
                <Link
                  to={`/leaders/${session.leader_id}`}
                  className="focus-ring rounded font-medium text-foreground hover:text-primary hover:underline"
                >
                  {session.leader}
                </Link>
              ) : (
                session.leader
              )}
            </span>
          )}
          {session.fee !== null && (
            <span>
              {t('session.fee')} : <span className="font-medium text-foreground">{session.fee}</span>
            </span>
          )}
          {session.matalib.length > 0 && (
            <Badge variant="warning">
              {t('session.requirementsShort')} : {session.matalib.join('، ')}
            </Badge>
          )}
        </div>
      </div>

      {/* ---------- نشاط عام للفوج: عدد الحضور لكل فرقة ---------- */}
      {session.kind === 'group' && (
        <GroupCountsCard
          session={session}
          editable={editable}
          onSaved={() => reload({ quiet: true })}
        />
      )}

      {/* ---------- Attendance progress + bulk action ---------- */}
      {totalRoster > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium tabular-nums">
                {t('session.marked', { marked, total: totalRoster })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="success">{counts.present}</Badge>
                <Badge variant="destructive">{counts.absent}</Badge>
                <Badge variant="warning">{counts.excused}</Badge>
              </div>
            </div>
            <ProgressBar value={pct} label={t('session.attendance')} />
            {/* اللائحة المقسّمة لها زرّ لكل فرقة، فالزرّ الجامع هنا يصير تكرارًا */}
            {editable && !splitRoster && marked < totalRoster && (
              <Button
                variant="outline"
                size="sm"
                loading={bulkBusy}
                onClick={() => markAllPresent()}
                className="w-full sm:w-auto"
              >
                <IconCheckAll />
                {t('session.markRestPresent', { count: totalRoster - marked })}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- Animateurs ---------- */}
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t('session.animators')}</CardTitle>
          {editable && availableHelpers.length > 0 && (
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
        <CardContent className="p-0 pb-2">
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
                    <div className="mt-0.5">
                      <Badge variant={a.role === 'main' ? 'default' : 'secondary'}>
                        {t(a.role === 'main' ? 'session.mainAnimator' : 'session.helper')}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex w-full items-center gap-1.5 sm:w-auto">
                    {editable ? (
                      <>
                        <SegmentedControl
                          className="w-full sm:w-auto"
                          label={memberName(a)}
                          value={a.status}
                          onChange={(v) => markAnimator(a.leader_id, v)}
                          options={ANIMATOR_STATUSES.map((s) => ({ ...s, label: t(s.key) }))}
                        />
                        {a.role === 'helper' && (
                          <Button
                            variant="destructive-ghost"
                            size="icon"
                            onClick={() => removeHelper(a)}
                            aria-label={t('common.delete')}
                          >
                            <IconTrash />
                          </Button>
                        )}
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

      {/* ---------- Roster ---------- */}
      {/* نشاط قادة has no عناصر at all (présence is marked on the animators card above),
          and a نشاط عام للفوج counts its حضور instead of listing names */}
      {!['leaders', 'group'].includes(session.kind) && (
      <Card>
        <CardHeader>
          <CardTitle>
            {t(session.kind === 'visit' ? 'session.visitedMembers' : 'session.roster')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {totalRoster === 0 ? (
            <EmptyState icon={<IconUsers className="h-6 w-6" />} title={t('session.emptyRoster')} />
          ) : splitRoster ? (
            // نشاط مشترك: قسم لكل فرقة، يملأه قائدها أو مساعده — لا شخص واحد للجميع
            rosterBranchIds.map((bid) => {
              const rows = session.roster.filter((m) => m.branch_id === bid);
              const left = rows.filter((m) => !m.status).length;
              const b = branchList.find((x) => x.id === bid);
              return (
                <section key={bid}>
                  <div className="flex flex-wrap items-center gap-2 border-y border-border bg-muted/30 px-4 py-2 sm:px-5">
                    <span className="text-sm font-semibold">{branchName(b, i18n.language)}</span>
                    <Badge variant={left === 0 ? 'success' : 'outline'}>
                      {t('session.marked', { marked: rows.length - left, total: rows.length })}
                    </Badge>
                    <span className="grow" />
                    {editable && left > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={bulkBusy}
                        onClick={() => markAllPresent(bid)}
                      >
                        <IconCheckAll />
                        {t('session.markRestPresent', { count: left })}
                      </Button>
                    )}
                  </div>
                  <ul className="divide-y divide-border">
                    {rows.map((m) => (
                      <RosterRow key={m.id} m={m} editable={editable} mark={mark} t={t} />
                    ))}
                  </ul>
                </section>
              );
            })
          ) : (
            <ul className="divide-y divide-border">
              {session.roster.map((m) => (
                <RosterRow key={m.id} m={m} editable={editable} mark={mark} t={t} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}

/** سطر عنصر في لائحة الحضور: الاسم، تنبيه الغيابات المتتالية، و أزرار الحالة. */
function RosterRow({ m, editable, mark, t }) {
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
      <div className="w-full sm:w-auto">
        {editable ? (
          <SegmentedControl
            className="w-full sm:w-auto"
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

/* Unmarked children keep a faint highlight so the leader can see what's left. */
function cnRow(status) {
  return [
    'flex flex-wrap items-center gap-3 px-4 py-3 transition-colors sm:px-5',
    status ? '' : 'bg-warning/5',
  ]
    .filter(Boolean)
    .join(' ');
}
