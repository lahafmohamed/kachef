import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useFetch } from '../hooks';
import { displayError } from '../lib/errors';
import { fmtLongDate, gendered } from '../lib/meetings';
import { avatarName, fmtDate, memberName } from '../utils';
import DatePicker from './DatePicker';
import ExportPdfButton from './ExportPdfButton';
import { RateValue } from './MemberParts';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  ProgressBar,
  SegmentedControl,
  Select,
  Skeleton,
  cn,
  useConfirm,
  useToast,
  IconBack,
  IconCalendar,
  IconCheck,
  IconCheckAll,
  IconLock,
  IconTrash,
  IconUsers,
} from './ui';

/*
 * حضور الأمانة. The team of an أمانة — its أمين and his مساعدون — runs no نشاط: it goes
 * along with the فرق on Saturdays. Its أمين takes the team's présence here, one sheet a
 * day: the footer of its card in the التشكيلة, then a dialog with the team's figures
 * and past sheets, or one sheet to mark.
 */

// The server's lists (AMANA_ROLL_REASONS); the wording is سجل المتابعة's
export const AMANA_ROLL_REASONS = ['work', 'illness', 'travel', 'study', 'family', 'other'];

const STATUSES = [
  { value: 'present', key: 'session.present', tone: 'success', badge: 'success' },
  { value: 'absent', key: 'session.absent', tone: 'destructive-soft', badge: 'destructive' },
  { value: 'excused', key: 'session.excused', tone: 'warning-soft', badge: 'warning' },
];

// Refusals the chef can put right himself
const ERRORS = {
  roll_finalized: 'amanaRoll.errFinalized',
  empty_team: 'amanaRoll.errEmptyTeam',
  future_date: 'amanaRoll.errFuture',
  invalid_date: 'amanaRoll.errFuture',
  unmarked_left: 'amanaRoll.finalizeHint',
};
const errText = (t, err) => (ERRORS[err?.code] ? t(ERRORS[err.code]) : displayError(err));

const rateOf = (present, marked) => (marked ? Math.round((present / marked) * 100) : null);

/**
 * The foot of an أمانة's card: its team's présence over the year, and the way to the
 * sheet. For the أمين himself, before today's sheet exists, the button is the day's task.
 */
export function AmanaPresenceFooter({ summary, mine, onOpen }) {
  const { t } = useTranslation();
  const rate = summary ? rateOf(summary.present, summary.marked) : null;
  const takenToday = !!summary?.today_id;
  const todo = mine && !takenToday;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{t('leader.colPresence')}</p>
        {summary?.rolls ? (
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <RateValue rate={rate} />
            <span className="text-xs text-muted-foreground">{t('amanaRoll.days', { count: summary.rolls })}</span>
            {takenToday && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <IconCheck className="h-3 w-3" />
                {t('amanaRoll.takenToday')}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('amanaRoll.none')}</p>
        )}
      </div>
      <Button variant={todo ? 'brand' : 'outline'} size="sm" onClick={onOpen} className="shrink-0">
        {todo ? <IconCheck /> : <IconUsers />}
        {todo ? t('amanaRoll.take') : t('amanaRoll.open')}
      </Button>
    </div>
  );
}

function StatusBadge({ status, t }) {
  const s = STATUSES.find((x) => x.value === status);
  return s ? <Badge variant={s.badge}>{t(s.key)}</Badge> : <Badge variant="outline">{t('session.unmarked')}</Badge>;
}

/** «3 présences · 1 absence»: what a sheet holds, the empty counts left out */
function Tally({ r, t }) {
  const parts = [
    t('member.presentN', { count: r.present }),
    r.absent > 0 && t('member.absentN', { count: r.absent }),
    r.excused > 0 && t('member.excusedN', { count: r.excused }),
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * One team's présence: its figures and past sheets, or one sheet to mark. `titles`:
 * each قائد's مسؤولية in the التشكيلة (leader_id → title), shown under his name.
 * `canTake`: this account takes the team's présence (its أمين, a delegate, the admin).
 */
export function AmanaPresenceDialog({ root, titles, canTake, open, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  const list = useFetch(root ? `/amanat/${root.id}/rolls` : null, { skip: !open || !root });
  // The sheet on screen; null = the overview
  const [roll, setRoll] = useState(null);
  const [busy, setBusy] = useState(false);
  const [otherDay, setOtherDay] = useState(false);
  const [day, setDay] = useState('');
  // Taps land faster than answers: only the answer to the latest one is kept
  const seq = useRef(0);

  // Each opening starts from the overview
  useEffect(() => {
    if (!open) return;
    setRoll(null);
    setOtherDay(false);
    setDay('');
  }, [open, root?.id]);

  if (!root) return <Dialog open={false} onClose={onClose} title="" />;

  function changed() {
    list.reload({ quiet: true });
    onChanged?.();
  }

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errText(t, err));
    } finally {
      setBusy(false);
    }
  }

  const openRoll = (id) => run(async () => setRoll(await api.get(`/amana-rolls/${id}`)));

  // Today's sheet, or a day gone by: the server hands back the one that exists
  const takeDay = (date) =>
    run(async () => {
      setRoll(await api.post(`/amanat/${root.id}/rolls`, date ? { date } : {}));
      setOtherDay(false);
      setDay('');
      changed();
    });

  // The screen goes first, the server follows; a refusal reloads the sheet as it is
  async function mark(rows) {
    const id = roll.id;
    const n = ++seq.current;
    setRoll((r) => ({
      ...r,
      entries: r.entries.map((e) => {
        const x = rows.find((y) => y.leader_id === e.leader_id);
        if (!x) return e;
        const status = x.status ?? e.status;
        const away = status === 'absent' || status === 'excused';
        return { ...e, status, reason: away ? (x.reason !== undefined ? x.reason : e.reason) : null };
      }),
    }));
    try {
      const next = await api.put(`/amana-rolls/${id}`, { entries: rows });
      if (n === seq.current) setRoll(next);
      changed();
    } catch (err) {
      toast.error(errText(t, err));
      try {
        if (n === seq.current) setRoll(await api.get(`/amana-rolls/${id}`));
      } catch {
        // the toast already says it; the next tap tries again
      }
    }
  }

  const finalize = () =>
    run(async () => {
      setRoll(await api.post(`/amana-rolls/${roll.id}/finalize`, {}));
      toast.success(t('amanaRoll.finalizedToast'));
      changed();
    });

  const reopen = () =>
    run(async () => {
      setRoll(await api.post(`/amana-rolls/${roll.id}/reopen`, {}));
      toast.success(t('amanaRoll.reopenedToast'));
      changed();
    });

  async function remove() {
    const ok = await confirm({
      title: t('amanaRoll.deleteTitle'),
      message: t('amanaRoll.deleteConfirm', { date: fmtLongDate(roll.date, lng) }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    run(async () => {
      await api.del(`/amana-rolls/${roll.id}`);
      setRoll(null);
      toast.success(t('amanaRoll.deletedToast'));
      changed();
    });
  }

  // ---------- One sheet ----------
  if (roll) {
    const editable = roll.can_take && !roll.finalized_at;
    const total = roll.entries.length;
    const count = (st) => roll.entries.filter((e) => e.status === st).length;
    const unmarked = roll.entries.filter((e) => e.status === 'unmarked');
    const marked = total - unmarked.length;
    const finalizedLine = roll.finalized_at && (
      <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <IconLock className="h-4 w-4 shrink-0 text-success" />
        <span className="min-w-0">
          {t('amanaRoll.finalizedBy', { by: roll.finalized_by, date: fmtDate(roll.finalized_at.slice(0, 10)) })}
        </span>
      </p>
    );
    const footer = roll.finalized_at ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {finalizedLine}
        {roll.can_take && (
          <Button variant="outline" loading={busy} onClick={reopen}>
            {t('session.reopen')}
          </Button>
        )}
      </div>
    ) : editable ? (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={remove}
            aria-label={t('amanaRoll.deleteTitle')}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <IconTrash />
            {t('common.delete')}
          </Button>
          <Button variant="brand" loading={busy} disabled={unmarked.length > 0} onClick={finalize}>
            <IconLock />
            {t('session.finalize')}
          </Button>
        </div>
        {unmarked.length > 0 && (
          <p className="text-end text-xs text-muted-foreground">{gendered(t, 'amanaRoll.finalizeHint', root.section)}</p>
        )}
      </div>
    ) : null;

    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={fmtLongDate(roll.date, lng)}
        description={root.title}
        size="lg"
        autoFocus={false}
        footer={footer}
      >
        <Button variant="ghost" size="sm" onClick={() => setRoll(null)} className="-ms-2 -mt-1 mb-2">
          <IconBack className="rtl:rotate-180" />
          {t('amanaRoll.back')}
        </Button>

        <div className="-mx-4 space-y-3 border-b border-border px-4 pb-4 sm:-mx-5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium tabular-nums">{t('session.marked', { marked, total })}</span>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="success">
                {t('session.tallyPresent')} <span className="tabular-nums">{count('present')}</span>
              </Badge>
              <Badge variant="destructive">
                {t('session.tallyAbsent')} <span className="tabular-nums">{count('absent')}</span>
              </Badge>
              <Badge variant="warning">
                {t('session.tallyExcused')} <span className="tabular-nums">{count('excused')}</span>
              </Badge>
            </div>
          </div>
          <ProgressBar value={total ? (100 * marked) / total : 0} label={t('session.attendance')} />
        </div>

        {editable && unmarked.length > 0 && (
          <div className="-mx-4 border-b border-border px-4 py-3 sm:-mx-5 sm:px-5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => mark(unmarked.map((e) => ({ leader_id: e.leader_id, status: 'present' })))}
            >
              <IconCheckAll />
              {t('session.markRestPresent', { count: unmarked.length })}
            </Button>
          </div>
        )}

        <ul className="-mx-4 divide-y divide-border sm:-mx-5">
          {roll.entries.map((e) => {
            const status = e.status === 'unmarked' ? null : e.status;
            const away = status === 'absent' || status === 'excused';
            const name = memberName(e);
            return (
              <li
                key={e.leader_id}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors sm:px-5',
                  !status && 'bg-warning/5'
                )}
              >
                <Avatar photo={e.photo} name={avatarName(e)} className="bg-secondary text-secondary-foreground" />
                <div className="min-w-32 flex-1">
                  <span className="block truncate font-medium">
                    <bdi>{name}</bdi>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {titles?.get(e.leader_id) || t('amanaRoll.formerMember')}
                  </span>
                  {away &&
                    (editable ? (
                      <div className="mt-1 w-40 max-w-full">
                        <Select
                          className="h-11 text-xs sm:h-8"
                          aria-label={`${t('followup.reasonLabel')} — ${name}`}
                          value={e.reason || ''}
                          onChange={(ev) => mark([{ leader_id: e.leader_id, reason: ev.target.value || null }])}
                        >
                          <option value="">{t('followup.reasonNone')}</option>
                          {AMANA_ROLL_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {t(`followup.reason.${r}`)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      e.reason && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('followup.reasonShown', { reason: t(`followup.reason.${e.reason}`) })}
                        </p>
                      )
                    ))}
                </div>
                <div className="w-full sm:w-auto sm:shrink-0">
                  {editable ? (
                    <SegmentedControl
                      className="w-full sm:w-auto sm:[&>button]:whitespace-nowrap"
                      label={name}
                      value={status}
                      onChange={(v) => mark([{ leader_id: e.leader_id, status: v }])}
                      options={STATUSES.map((s) => ({ ...s, label: t(s.key) }))}
                    />
                  ) : (
                    <StatusBadge status={status} t={t} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {/* Read without the right to mark: who validated it, under the list */}
        {!roll.can_take && roll.finalized_at && <div className="pt-4">{finalizedLine}</div>}
      </Dialog>
    );
  }

  // ---------- The overview ----------
  const data = list.data;
  const rolls = data?.rolls || [];
  const members = data?.members || [];
  const todayRoll = data ? rolls.find((r) => r.date === data.today) : null;
  const thisYear = new Date().getFullYear();

  let body;
  if (list.error)
    body = <ErrorState message={t('error.loadFailed')} onRetry={list.reload} retryLabel={t('error.retry')} />;
  else if (!data)
    body = (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-11 w-full rounded-lg sm:w-56" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  else
    body = (
      <div className="space-y-6">
        {canTake ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="brand"
                className="w-full sm:w-auto"
                loading={busy && !otherDay}
                disabled={members.length === 0}
                onClick={() => (todayRoll ? openRoll(todayRoll.id) : takeDay(null))}
              >
                <IconCheck />
                {todayRoll ? t('amanaRoll.openToday') : t('amanaRoll.takeToday')}
              </Button>
              {!otherDay && (
                <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setOtherDay(true)}>
                  <IconCalendar />
                  {t('amanaRoll.otherDay')}
                </Button>
              )}
            </div>
            {otherDay && (
              <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <DatePicker
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                    clearable={false}
                    toYear={thisYear}
                    aria-label={t('amanaRoll.otherDay')}
                    className="min-w-0 flex-1 sm:max-w-56"
                  />
                  <Button variant="outline" disabled={!day} loading={busy} onClick={() => takeDay(day)}>
                    {t('amanaRoll.openDay')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('amanaRoll.otherDayHint')}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{gendered(t, 'amanaRoll.readOnly', root.section)}</p>
        )}

        <section aria-labelledby="amana-team" className="space-y-2">
          <h3 id="amana-team" className="text-sm font-semibold text-muted-foreground">
            {t('amanaRoll.team')}
          </h3>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{gendered(t, 'amanaRoll.errEmptyTeam', root.section)}</p>
          ) : (
            <ul className="-mx-4 divide-y divide-border border-y border-border sm:-mx-5">
              {members.map((m) => {
                const done = m.present + m.absent + m.excused;
                return (
                  <li key={m.leader_id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <Avatar
                      photo={m.photo}
                      name={avatarName(m)}
                      className="h-8 w-8 bg-secondary text-[0.6875rem] text-secondary-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <bdi>{memberName(m)}</bdi>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.role ? titles?.get(m.leader_id) || '' : t('amanaRoll.formerMember')}
                      </p>
                    </div>
                    <div className="shrink-0 text-end leading-tight">
                      <RateValue rate={rateOf(m.present, done)} className="text-sm" />
                      {done > 0 && (
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {t('member.presentOf', { present: m.present, total: done })}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="amana-history" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="amana-history" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              {t('amanaRoll.history')}
              {rolls.length > 0 && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums">{rolls.length}</span>
              )}
            </h3>
            {rolls.length > 0 && <ExportPdfButton kind="amana-presence" id={root.id} compact />}
          </div>
          {rolls.length === 0 ? (
            <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('amanaRoll.emptyTitle')}>
              {gendered(t, 'amanaRoll.emptyHint', root.section)}
            </EmptyState>
          ) : (
            <ul className="-mx-4 divide-y divide-border border-y border-border sm:-mx-5">
              {rolls.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openRoll(r.id)}
                    disabled={busy}
                    className="focus-ring flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-accent/40 disabled:cursor-wait sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{fmtLongDate(r.date, lng)}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        <Tally r={r} t={t} />
                      </span>
                    </span>
                    {r.finalized_at ? (
                      <Badge variant="success" className="shrink-0">
                        <IconLock className="h-3 w-3" />
                        {t('amanaRoll.validated')}
                      </Badge>
                    ) : r.unmarked > 0 ? (
                      <Badge variant="warning" className="shrink-0">
                        {t('session.tallyUnmarked')} <span className="tabular-nums">{r.unmarked}</span>
                      </Badge>
                    ) : (
                      // Everyone marked, not validated yet: the last step is still to do
                      <Badge variant="outline" className="shrink-0">
                        {t('amanaRoll.toValidate')}
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );

  return (
    <Dialog open={open} onClose={onClose} title={t('amanaRoll.title')} description={root.title} size="lg" autoFocus={false}>
      {body}
    </Dialog>
  );
}
