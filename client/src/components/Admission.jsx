import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch } from '../hooks';
import { avatarName, branchName, fmtDate, memberName } from '../utils';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ProgressBar,
  Skeleton,
  cn,
  useConfirm,
  useToast,
  IconAward,
  IconCheck,
  IconUserCheck,
  IconX,
} from './ui';

// القبول (B1): فترة التجربة، مطالب القبول الستة، التكريس. Server: /members/:id/admission,
// /members/investiture, /admissions/pending.

const today = () => new Date().toISOString().slice(0, 10);
const day = (v) => (v ? fmtDate(String(v).slice(0, 10)) : '');

/** «في فترة التجربة» beside the name: only while it lasts. */
export function AdmissionBadge({ member }) {
  const { t } = useTranslation();
  if (member?.admission_status !== 'trial' || member.status !== 'active') return null;
  return <Badge variant="warning">{t('admission.trial')}</Badge>;
}

/** The date of the تكريس, asked once for one عنصر or several (حفل القبول). */
function InvestDialog({ open, count, onClose, onConfirm, busy }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(today());
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admission.investTitle')}
      description={count > 1 ? t('admission.investMany', { count }) : t('admission.investHint')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="brand" loading={busy} disabled={!date || date > today()} onClick={() => onConfirm(date)}>
            {t('admission.invest')}
          </Button>
        </>
      }
    >
      <Field label={t('admission.investDate')}>
        {(p) => <Input {...p} type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

/** A number the قائد raises or lowers: بنود القانون learnt, صرخات known. */
function Stepper({ value, max, onChange, disabled, label }) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={label}>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={disabled || value <= 0}
        onClick={() => onChange(value - 1)}
        aria-label={t('admission.less')}
      >
        −
      </Button>
      <span className="min-w-12 text-center text-sm font-medium tabular-nums" dir="ltr">
        {value} / {max}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={t('admission.more')}
      >
        +
      </Button>
    </div>
  );
}

/** The «القبول» tab of a عنصر's file. */
export function MemberAdmission({ memberId, onStatus }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { has } = usePerms();
  const canEdit = has('members.admission');
  const { data: s, setData, loading, error, reload } = useFetch(`/members/${memberId}/admission`);
  const [busy, setBusy] = useState(null);
  const [investing, setInvesting] = useState(false);

  async function send(body, key) {
    setBusy(key);
    try {
      const next = await api.post(`/members/${memberId}/admission`, body);
      setData((cur) => ({ ...next, catalog: cur?.catalog || [] }));
      if (next.status !== s.status) onStatus?.(next.status);
      return next;
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function invest(date) {
    const next = await send({ status: 'invested', invested_at: date }, 'invest');
    if (next) {
      setInvesting(false);
      toast.success(t('admission.investedToast'));
    }
  }

  async function backToTrial() {
    if (
      !(await confirm({
        title: t('admission.backToTrial'),
        message: t('admission.backToTrialConfirm'),
        confirmLabel: t('admission.backToTrial'),
      }))
    )
      return;
    await send({ status: 'trial' }, 'trial');
  }

  if (loading) return <Skeleton className="h-64" />;
  if (error) return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  const trial = s.status === 'trial';
  const pct = Math.round((s.done_count / s.total) * 100);

  return (
    <>
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{t(trial ? 'admission.trial' : 'admission.invested')}</h2>
              {s.ready && <Badge variant="success">{t('admission.ready')}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {trial
                ? [
                    s.trial_started_at && t('admission.trialSince', { date: day(s.trial_started_at) }),
                    s.trial_days != null && t('admission.trialDay', { count: s.trial_days }),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : s.invested_at
                  ? t('admission.investedOn', { date: day(s.invested_at) })
                  : t('admission.investedUnknown')}
            </p>
            {trial &&
              (s.internal ? (
                <p className="text-sm text-muted-foreground">{t('admission.internal')}</p>
              ) : (
                s.trial_end && (
                  <p className={cn('text-sm', s.duration_ok ? 'text-success' : 'text-muted-foreground')}>
                    {s.duration_ok
                      ? t('admission.durationDone')
                      : t('admission.trialEnds', { date: day(s.trial_end), months: s.rules.trial_months })}
                  </p>
                )
              ))}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {trial ? (
                <Button variant={s.ready ? 'brand' : 'outline'} size="sm" onClick={() => setInvesting(true)}>
                  <IconAward />
                  {t('admission.invest')}
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setInvesting(true)}>
                    {s.invested_at ? t('admission.changeDate') : t('admission.setDate')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === 'trial'}
                    onClick={backToTrial}
                    className="text-muted-foreground"
                  >
                    {t('admission.backToTrial')}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {trial && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{t('admission.checklist')}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t('admission.progress', { done: s.done_count, total: s.total })}
                </span>
              </div>
              <ProgressBar value={pct} label={t('admission.checklist')} className="h-2" />
            </div>
            {!s.ready && canEdit && <p className="text-xs text-muted-foreground">{t('admission.notReadyHint')}</p>}

            <ul className="divide-y divide-border rounded-lg border border-border">
              {s.items.map((it) => {
                const label = t(`admission.item_${it.item}`);
                const counted = it.item === 'law' || it.item === 'cries';
                const trace = it.done_at && !it.waived ? [it.done_by, day(it.done_at)].filter(Boolean).join(' · ') : '';
                return (
                  <li key={it.item} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                        it.done ? 'border-success/30 bg-success/12 text-success' : 'border-border text-muted-foreground'
                      )}
                    >
                      {it.done ? <IconCheck className="h-3.5 w-3.5" /> : <IconX className="h-3 w-3 opacity-50" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {label}
                        <span className="sr-only">
                          {' — '}
                          {t(it.done ? 'admission.done' : 'admission.notDone')}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {it.waived
                          ? t('admission.waived')
                          : it.item === 'meetings'
                            ? [t('admission.meetingsAuto', { value: it.value ?? 0, required: it.required }), !it.auto && trace]
                                .filter(Boolean)
                                .join(' · ')
                            : trace}
                      </p>
                    </div>
                    {canEdit && !it.waived && counted && it.required > 0 && (
                      <Stepper
                        value={it.value}
                        max={it.required}
                        label={label}
                        disabled={!!busy}
                        onChange={(v) => send({ item: it.item, value: v }, it.item)}
                      />
                    )}
                    {canEdit && !it.waived && !counted && !(it.item === 'meetings' && it.auto) && (
                      <Button
                        variant={it.done ? 'ghost' : 'outline'}
                        size="sm"
                        loading={busy === it.item}
                        disabled={!!busy && busy !== it.item}
                        onClick={() => send({ item: it.item, done: !it.done }, it.item)}
                        className={it.done ? 'text-muted-foreground' : ''}
                      >
                        {it.done ? t('admission.undo') : t('admission.validate')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {s.catalog?.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">{t('admission.catalog')}</p>
            <ul className="space-y-1 text-sm">
              {s.catalog.map((k) => (
                <li key={k.id} className="flex items-start gap-2">
                  <span className={cn('tabular-nums', k.earned ? 'text-success' : 'text-muted-foreground')}>
                    {k.earned ? '✓' : '○'}
                  </span>
                  <span className="min-w-0">
                    <span className="tabular-nums text-muted-foreground">{k.number}. </span>
                    <bdi>{k.label}</bdi>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <InvestDialog
        key={investing ? 'open' : 'closed'}
        open={investing}
        count={1}
        busy={busy === 'invest'}
        onClose={() => setInvesting(false)}
        onConfirm={invest}
      />
    </>
  );
}

/**
 * The ترفيع page's admissions card: who is in فترة التجربة, ready first, and the
 * collective تكريس of the ones ticked. `branch` filters like the page's own select.
 */
export function AdmissionQueue({ branch }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { has } = usePerms();
  const canEdit = has('members.admission');
  const { data, loading, error, reload } = useFetch('/admissions/pending');
  const [view, setView] = useState('ready');
  const [picked, setPicked] = useState(new Set());
  const [investing, setInvesting] = useState(false);
  const [busy, setBusy] = useState(false);

  const all = (data || []).filter((a) => !branch || String(a.branch_id) === String(branch));
  const readyList = all.filter((a) => a.ready);
  const list = view === 'ready' ? readyList : all;
  const pickedIds = list.filter((a) => picked.has(a.id)).map((a) => a.id);

  function toggle(id) {
    setPicked((cur) => {
      const n = new Set(cur);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function invest(date) {
    setBusy(true);
    try {
      const res = await api.post('/members/investiture', { member_ids: pickedIds, date });
      toast.success(t('admission.investedMany', { count: res.invested }));
      setInvesting(false);
      setPicked(new Set());
      reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const missingOf = (a) => a.missing.map((m) => t(`admission.item_${m}`)).join('، ');

  return (
    <Card id="admissions">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold">{t('admission.queueTitle')}</h2>
        <div className="ms-auto flex gap-1" role="group" aria-label={t('admission.queueTitle')}>
          {[
            ['ready', t('admission.queueReady'), readyList.length],
            ['all', t('admission.queueTrial'), all.length],
          ].map(([v, label, n]) => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? 'secondary' : 'ghost'}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {label}
              <span className="tabular-nums text-muted-foreground">{n}</span>
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="p-4 sm:p-5">
          <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
        </div>
      ) : loading ? (
        <div className="space-y-2 p-4 sm:p-5">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<IconUserCheck className="h-6 w-6" />}
          title={view === 'ready' ? t('admission.noneReady') : t('admission.queueEmpty')}
        >
          {view === 'ready' && all.length > 0
            ? t('admission.noneReadyHint', { count: all.length })
            : t('admission.queueEmptyHint')}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((a) => {
            const name = memberName(a);
            return (
              <li key={a.id} className={cn('flex items-center gap-3 px-4 py-3 sm:px-5', picked.has(a.id) && 'bg-accent/60')}>
                {canEdit && (
                  <label className="-m-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      checked={picked.has(a.id)}
                      onChange={() => toggle(a.id)}
                      aria-label={t('promotion.selectOne', { name })}
                    />
                  </label>
                )}
                <Avatar photo={a.photo} name={avatarName(a)} className="bg-secondary text-secondary-foreground" />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/members/${a.id}?tab=admission`}
                    dir="auto"
                    className="focus-ring line-clamp-2 w-fit max-w-full rounded-sm text-[0.9375rem] font-medium leading-5 hover:text-primary hover:underline sm:text-sm"
                  >
                    {name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <bdi>{branchName({ name_fr: a.branch_name_fr, name_ar: a.branch_name_ar }, i18n.language)}</bdi>
                    {a.trial_days != null && (
                      <span className="tabular-nums">{t('admission.trialDay', { count: a.trial_days })}</span>
                    )}
                    {a.ready ? (
                      <Badge variant="success">{t('admission.ready')}</Badge>
                    ) : (
                      <span className="tabular-nums">
                        {t('admission.progress', { done: a.done_count, total: a.total })}
                        {a.missing.length > 0 && ` · ${t('admission.missing', { list: missingOf(a) })}`}
                        {!a.duration_ok && ` · ${t('admission.durationRunning', { date: day(a.trial_end) })}`}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && pickedIds.length > 0 && (
        <div className="glass sticky bottom-[var(--bottomnav-h)] z-10 flex items-center gap-2 rounded-b-2xl border-t border-border py-2 ps-1 pe-4 shadow-top sm:ps-3 sm:pe-5 lg:bottom-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPicked(new Set())}
            aria-label={t('common.clearSelection')}
          >
            <IconX />
          </Button>
          <span role="status" className="min-w-0 flex-1 truncate text-sm font-medium">
            {t('promotion.selected', { count: pickedIds.length })}
          </span>
          <Button size="sm" variant="brand" onClick={() => setInvesting(true)}>
            <IconAward className="hidden sm:block" />
            {t('admission.invest')}
          </Button>
        </div>
      )}
      <InvestDialog
        key={investing ? 'open' : 'closed'}
        open={investing}
        count={pickedIds.length}
        busy={busy}
        onClose={() => setInvesting(false)}
        onConfirm={invest}
      />
    </Card>
  );
}

/** Bug 8: the عناصر the ترفيع list cannot see, for want of a birth date. */
export function MissingBirthDates({ branch }) {
  const { t, i18n } = useTranslation();
  const { data } = useFetch('/promotions/missing-birth-date');
  const [open, setOpen] = useState(false);
  const list = (data || []).filter((m) => !branch || String(m.branch_id) === String(branch));
  if (!list.length) return null;
  const shown = open ? list : list.slice(0, 5);
  return (
    <Card id="missing-birth-date">
      <div className="space-y-1 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">{t('admission.missingBirthTitle')}</h2>
          <Badge variant="warning">{list.length}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t('admission.missingBirthHint')}</p>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <Avatar photo={m.photo} name={avatarName(m)} className="h-8 w-8 bg-secondary text-secondary-foreground" />
            <Link
              to={`/members/${m.id}?tab=profile`}
              dir="auto"
              className="focus-ring min-w-0 flex-1 truncate rounded-sm text-sm font-medium hover:text-primary hover:underline"
            >
              {memberName(m)}
            </Link>
            <bdi className="shrink-0 text-xs text-muted-foreground">
              {branchName({ name_fr: m.branch_name_fr, name_ar: m.branch_name_ar }, i18n.language)}
            </bdi>
          </li>
        ))}
      </ul>
      {list.length > 5 && (
        <div className="border-t border-border px-4 py-2 sm:px-5">
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? t('admission.showLess') : t('admission.showAll', { count: list.length })}
          </Button>
        </div>
      )}
    </Card>
  );
}
