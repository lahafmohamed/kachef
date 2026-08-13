import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import { fmtDate, branchName } from '../utils';
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
  ProgressBar,
  SegmentedControl,
  Select,
  SkeletonPage,
  useConfirm,
  useToast,
  IconAlert,
  IconBack,
  IconCheckAll,
  IconTrash,
  IconUsers,
} from '../components/ui';

const MEMBER_STATUSES = [
  { value: 'present', key: 'session.present', tone: 'success' },
  { value: 'absent', key: 'session.absent', tone: 'destructive' },
  { value: 'excused', key: 'session.excused', tone: 'warning' },
];
const ANIMATOR_STATUSES = MEMBER_STATUSES.filter((s) => s.value !== 'excused');

/** Read-only rendering of a présence status for view-only accounts. */
function StatusBadge({ status, t }) {
  const s = MEMBER_STATUSES.find((x) => x.value === status);
  if (!s) return <Badge variant="outline">{t('session.unmarked')}</Badge>;
  return <Badge variant={s.tone}>{t(s.key)}</Badge>;
}

export default function SessionDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const back = useBack('/sessions');
  const toast = useToast();
  const confirm = useConfirm();

  // View-only: présence is displayed as badges, never as tappable controls
  const { canEdit } = usePerms();
  const editable = canEdit('sessions');
  const { data: session, setData: setSession, loading, error, reload } = useFetch(`/sessions/${id}`);
  const leaders = useFetch('/leaders');
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
      toast.error(err.message);
    }
  }

  async function markAllPresent() {
    const unmarked = session.roster.filter((m) => !m.status);
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
    setSession((s) => ({
      ...s,
      roster: s.roster.map((m) => (m.status ? m : { ...m, status: 'present' })),
    }));
    try {
      for (const m of unmarked) {
        await api.post(`/sessions/${id}/attendance`, { member_id: m.id, status: 'present' });
      }
      toast.success(t('session.markedCount', { count: unmarked.length }));
      reload({ quiet: true });
    } catch (err) {
      setSession(prev);
      toast.error(err.message);
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
      toast.error(err.message);
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
    if (!(await confirm(t('session.confirmRemoveHelper', { name: `${a.first_name} ${a.last_name}` }))))
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
          {session.branch_id ? (
            <Badge>{branchName(session, i18n.language)}</Badge>
          ) : (
            <Badge variant="secondary">{t('session.kindLeaders')}</Badge>
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
            {editable && marked < totalRoster && (
              <Button
                variant="outline"
                size="sm"
                loading={bulkBusy}
                onClick={markAllPresent}
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
                  {l.first_name} {l.last_name}
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
                  <Avatar photo={a.photo} name={`${a.first_name} ${a.last_name}`} />
                  <div className="min-w-32 flex-1">
                    <Link
                      to={`/leaders/${a.leader_id}`}
                      className="focus-ring rounded font-medium hover:text-primary hover:underline"
                    >
                      {a.first_name} {a.last_name}
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
                          label={`${a.first_name} ${a.last_name}`}
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
      {/* نشاط قادة has no عناصر at all: présence is marked on the animators card above */}
      {session.kind !== 'leaders' && (
      <Card>
        <CardHeader>
          <CardTitle>
            {t(session.kind === 'visit' ? 'session.visitedMembers' : 'session.roster')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {totalRoster === 0 ? (
            <EmptyState icon={<IconUsers className="h-6 w-6" />} title={t('session.emptyRoster')} />
          ) : (
            <ul className="divide-y divide-border">
              {session.roster.map((m) => (
                <li
                  key={m.id}
                  className={cnRow(m.status)}
                >
                  <Avatar photo={m.photo} name={`${m.first_name} ${m.last_name}`} />
                  <div className="min-w-32 flex-1">
                    <Link
                      to={`/members/${m.id}`}
                      className="focus-ring rounded font-medium hover:text-primary hover:underline"
                    >
                      {m.first_name} {m.last_name}
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
                        label={`${m.first_name} ${m.last_name}`}
                        value={m.status}
                        onChange={(v) => mark(m.id, v)}
                        options={MEMBER_STATUSES.map((s) => ({ ...s, label: t(s.key) }))}
                      />
                    ) : (
                      <StatusBadge status={m.status} t={t} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      )}
    </div>
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
