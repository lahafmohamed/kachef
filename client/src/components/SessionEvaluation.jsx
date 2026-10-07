import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { fmtDate } from '../utils';
import { evalText, fmtScore, gradeOf, groupByAxis, scaleKey, SCALE, scoreTone } from '../lib/evaluations';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  ErrorState,
  Label,
  SegmentedControl,
  Skeleton,
  Textarea,
  useConfirm,
  useToast,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconPencil,
  IconStar,
  IconTrash,
} from './ui';

const TEXT_MAX = 2000;

// What the page's header and tab show, rebuilt from a fresh evaluation payload
export function evalSummary(p) {
  const done = p.participants.filter((x) => x.done).length;
  return {
    count: p.results ? p.results.count : done,
    participants: p.participants.length,
    average: p.results ? p.results.average : null,
    can_evaluate: p.can_evaluate,
    expected: p.expected,
    done: !!p.mine,
    open: p.open,
  };
}

const evalError = (t, err) =>
  ({
    eval_empty: t('eval.errorEmpty'),
    eval_not_open: t('eval.errorNotOpen'),
    not_a_participant: t('eval.errorNotParticipant'),
    no_eval_form: t('eval.noFormTitle'),
  })[err.message] || err.message;

/**
 * Tab «التقييم» of a نشاط. Each قائد who led it rates it on the form the admin chose
 * for its kind — 1 to 5 per مؤشر, plus open questions — and everyone who can see the
 * نشاط reads the averages. A قائد who has not rated it yet sees the form first and the
 * results only once his own marks are in. The admin may rate any نشاط too, on demand.
 */
export default function SessionEvaluation({ session, onChange }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  const isAdmin = useAuth().user?.role === 'admin';
  const { data, setData, loading, error, reload } = useFetch(`/sessions/${session.id}/evaluation`);
  const [editing, setEditing] = useState(false);

  function apply(payload) {
    setData(payload);
    setEditing(false);
    onChange?.(evalSummary(payload));
  }

  async function withdraw() {
    if (
      !(await confirm({
        title: t('eval.withdraw'),
        message: t('eval.withdrawConfirm'),
        confirmLabel: t('eval.withdraw'),
      }))
    )
      return;
    try {
      apply(await api.del(`/sessions/${session.id}/evaluation`));
      toast.success(t('eval.withdrawn'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeOne(e) {
    if (
      !(await confirm({
        title: t('common.delete'),
        message: t('eval.deleteConfirm', { name: e.leader_name }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      apply(await api.del(`/sessions/${session.id}/evaluations/${e.id}`));
      toast.success(t('eval.deleted'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading)
    return (
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </CardContent>
      </Card>
    );
  if (error) return <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />;

  if (!data.form)
    return (
      <Card>
        <EmptyState icon={<IconStar className="h-6 w-6" />} title={t('eval.noFormTitle')}>
          {isAdmin ? (
            <>
              {t('eval.noFormAdmin')}{' '}
              <Link to="/settings" className="focus-ring rounded font-medium text-primary hover:underline">
                {t('nav.settings')}
              </Link>
            </>
          ) : (
            t('eval.noFormHint')
          )}
        </EmptyState>
      </Card>
    );

  // A قائد who led it gets the form straight away; the admin, who may rate any نشاط
  // without being expected to, reads the results first and opens the form on demand
  const showForm = data.can_evaluate && (editing || (!data.mine && data.expected));
  const offer = data.can_evaluate && !data.mine && !data.expected && !editing;
  return (
    <>
      {!data.open && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm sm:p-5">
            <IconClock className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <span>{t('eval.notOpen', { date: fmtDate(session.date) })}</span>
          </CardContent>
        </Card>
      )}

      {offer && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5">
            <div className="flex min-w-0 grow basis-60 items-center gap-3">
              <span className="bg-brand-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary">
                <IconStar className="h-5 w-5" />
              </span>
              <p className="min-w-0 text-sm">{t('eval.adminOffer')}</p>
            </div>
            <Button size="sm" onClick={() => setEditing(true)} className="w-full sm:w-auto">
              {t('eval.start')}
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <EvaluationForm
          form={data.form}
          mine={data.mine}
          sessionId={session.id}
          onSaved={apply}
          onCancel={data.mine || !data.expected ? () => setEditing(false) : null}
        />
      )}

      {data.mine && !showForm && <MineCard mine={data.mine} onEdit={() => setEditing(true)} onWithdraw={withdraw} />}

      <ResultsCard data={data} />

      {data.results?.by_leader?.length > 0 && (
        <ByLeaderCard form={data.form} list={data.results.by_leader} onDelete={removeOne} />
      )}
    </>
  );
}

/** «1 ضعيف · 2 مقبول · …» once at the top of the form, so each row can show numbers only. */
function ScaleLegend() {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {SCALE.map((n) => (
        <span key={n} className="whitespace-nowrap">
          <span className="font-semibold tabular-nums text-foreground">{n}</span> {t(scaleKey(n))}
        </span>
      ))}
    </p>
  );
}

function EvaluationForm({ form, mine, sessionId, onSaved, onCancel }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  // Archived items stay in the results of the أنشطة that answered them, never in a new form
  const live = form.items.filter((it) => !it.archived);
  const [answers, setAnswers] = useState(() =>
    Object.fromEntries(
      live
        .filter((it) => it.type !== 'axis')
        .map((it) => {
          const a = mine?.answers?.[it.id];
          return [it.id, it.type === 'score' ? (a?.score ?? null) : (a?.text ?? '')];
        })
    )
  );
  const [saving, setSaving] = useState(false);
  const scoreItems = live.filter((it) => it.type === 'score');
  const scored = scoreItems.filter((it) => answers[it.id] !== null).length;
  const set = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));

  async function save(e) {
    e.preventDefault();
    if (!scored) {
      toast.error(t('eval.errorEmpty'));
      return;
    }
    setSaving(true);
    try {
      const payload = await api.put(`/sessions/${sessionId}/evaluation`, {
        answers: live
          .filter((it) => it.type !== 'axis')
          .map((it) =>
            it.type === 'score' ? { item_id: it.id, score: answers[it.id] } : { item_id: it.id, text: answers[it.id] }
          ),
      });
      toast.success(t(mine ? 'eval.updated' : 'eval.saved'));
      onSaved(payload);
    } catch (err) {
      toast.error(evalError(t, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2">
          <IconStar className="h-4 w-4 text-primary" />
          {t(mine ? 'eval.editTitle' : 'eval.formTitle')}
        </CardTitle>
        <CardDescription>
          {t('eval.formIntro')} <bdi className="font-medium text-foreground">{evalText(form, 'name', lng)}</bdi>
        </CardDescription>
        <ScaleLegend />
      </CardHeader>
      <form onSubmit={save}>
        <div className="border-t border-border">
          {groupByAxis(live).map((g, gi) => (
            <section
              key={g.axis?.id ?? `g${gi}`}
              aria-labelledby={g.axis ? `eval-axis-${g.axis.id}` : undefined}
            >
              {g.axis && (
                <h3
                  id={`eval-axis-${g.axis.id}`}
                  dir="auto"
                  className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-semibold sm:px-5"
                >
                  {evalText(g.axis, 'label', lng)}
                </h3>
              )}
              <ul className="divide-y divide-border border-b border-border">
                {g.items.map((it) =>
                  it.type === 'score' ? (
                    <ScoreRow key={it.id} item={it} value={answers[it.id]} onChange={(v) => set(it.id, v)} />
                  ) : (
                    <li key={it.id} className="space-y-2 px-4 py-3.5 sm:px-5">
                      <Label htmlFor={`eval-text-${it.id}`} dir="auto" className="block">
                        {evalText(it, 'label', lng)}
                      </Label>
                      <Textarea
                        id={`eval-text-${it.id}`}
                        dir="auto"
                        rows={2}
                        maxLength={TEXT_MAX}
                        value={answers[it.id]}
                        onChange={(e) => set(it.id, e.target.value)}
                        placeholder={t('eval.textPlaceholder')}
                      />
                    </li>
                  )
                )}
              </ul>
            </section>
          ))}
        </div>
        {/* Sticky on a phone: thirteen indicators push Save a few screens down. One line
            there, so the count shrinks to «2/13» and says the rest to screen readers */}
        <div className="sticky bottom-[calc(var(--bottomnav-h)+0.5rem)] z-10 m-3 flex items-center gap-3 rounded-lg border border-border bg-card/95 p-2 backdrop-blur lg:static lg:m-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-5 lg:py-4 lg:backdrop-blur-none">
          <Button type="submit" loading={saving} disabled={!scored} className="flex-1 sm:flex-none">
            {t(mine ? 'eval.saveChanges' : 'eval.save')}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          )}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums sm:ms-auto" role="status">
            <span aria-hidden="true" className="px-1 sm:hidden" dir="ltr">
              {scored}/{scoreItems.length}
            </span>
            <span className="max-sm:sr-only">{t('eval.progress', { done: scored, total: scoreItems.length })}</span>
          </span>
        </div>
      </form>
    </Card>
  );
}

/**
 * One مؤشر: its wording, the word of the mark given, and 1–5. Tapping the mark again
 * takes it back — «no opinion» on something that did not happen in this نشاط.
 */
function ScoreRow({ item, value, onChange }) {
  const { t, i18n } = useTranslation();
  const label = evalText(item, 'label', i18n.language);
  const word = value ? t(scaleKey(value)) : t('eval.notRated');
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <p className="text-sm" dir="auto">
          {label}
        </p>
        <span
          className={cn(
            'shrink-0 text-xs font-medium sm:w-20 sm:text-end',
            value ? scoreTone(value).text : 'text-muted-foreground'
          )}
          aria-hidden="true"
        >
          {word}
        </span>
      </div>
      <SegmentedControl
        className="flex w-full sm:w-auto sm:[&>button]:w-11"
        label={label}
        value={value}
        onChange={(v) => onChange(v === value ? null : v)}
        options={SCALE.map((n) => ({
          value: n,
          label: (
            <>
              <span className="tabular-nums">{n}</span>
              <span className="sr-only"> — {t(scaleKey(n))}</span>
            </>
          ),
        }))}
      />
    </li>
  );
}

function MineCard({ mine, onEdit, onWithdraw }) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5">
        {/* basis-60: on a phone the buttons go under the sentence instead of
            squeezing it to one word per line */}
        <div className="flex min-w-0 grow basis-60 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/12 text-success">
            <IconCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('eval.mineDone')}</p>
            <p className="text-xs text-muted-foreground">
              {t('eval.mineMeta', { date: fmtDate(mine.updated_at) })}{' '}
              <span dir="ltr" className="font-medium tabular-nums text-foreground">
                {fmtScore(mine.average, i18n.language)}/5
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <IconPencil />
            {t('eval.edit')}
          </Button>
          <Button
            variant="destructive-ghost"
            size="sm"
            onClick={onWithdraw}
            aria-label={t('eval.withdraw')}
            className="w-11 px-0 sm:w-auto sm:px-3"
          >
            <IconTrash />
            <span className="sr-only sm:not-sr-only">{t('eval.withdraw')}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** «4.3 /5  جيد جدًا» — the number reads left-to-right on an Arabic screen too. */
function ScoreBig({ value }) {
  const { t, i18n } = useTranslation();
  const tone = scoreTone(value);
  return (
    <div className="flex items-center gap-2.5">
      <span dir="ltr" className="flex items-baseline gap-1">
        <span className={cn('text-4xl font-bold leading-none tracking-tight tabular-nums', tone.text)}>
          {fmtScore(value, i18n.language)}
        </span>
        <span className="text-sm text-muted-foreground">/5</span>
      </span>
      <Badge variant={tone.badge}>{t(scaleKey(gradeOf(value)))}</Badge>
    </div>
  );
}

function Participants({ list }) {
  const { t } = useTranslation();
  const done = list.filter((p) => p.done).length;
  if (list.length === 0) return <p className="text-sm text-muted-foreground">{t('eval.noParticipants')}</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium tabular-nums">{t('eval.participation', { done, total: list.length })}</p>
      <ul className="flex flex-wrap gap-1.5">
        {list.map((p, i) => (
          <li
            key={p.leader_id ?? `x${i}`}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
              p.done ? 'border-border bg-card' : 'border-dashed border-border text-muted-foreground'
            )}
          >
            {p.done ? (
              <IconCheck className="h-3.5 w-3.5 text-success" />
            ) : (
              <IconClock className="h-3.5 w-3.5" />
            )}
            <bdi>{p.name}</bdi>
            <span className="sr-only">— {t(p.done ? 'eval.didEvaluate' : 'eval.notYet')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultsCard({ data }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const r = data.results;
  const stat = (id) => r?.items.find((x) => x.item_id === id);
  const groups = groupByAxis(data.form.items)
    .map((g) => ({ ...g, items: g.items.filter((it) => it.type === 'score' && stat(it.id)?.count > 0) }))
    .filter((g) => g.items.length > 0);
  const texts = data.form.items.filter((it) => it.type === 'text' && stat(it.id)?.texts?.length > 0);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>{t('eval.resultsTitle')}</CardTitle>
          <CardDescription>
            <bdi>{evalText(data.form, 'name', lng)}</bdi>
          </CardDescription>
        </div>
        {r?.count > 0 && r.average !== null && <ScoreBig value={r.average} />}
      </CardHeader>
      <CardContent className="space-y-5">
        <Participants list={data.participants} />

        {data.results_hidden ? (
          <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            <IconStar className="mt-0.5 h-4 w-4 shrink-0" />
            {t('eval.hiddenUntilYours')}
          </p>
        ) : !r?.count ? (
          <p className="text-sm text-muted-foreground">{t('eval.noneYet')}</p>
        ) : (
          <>
            {groups.map((g, gi) => {
              const axisAvg = mean(g.items.map((it) => stat(it.id).average));
              return (
                <section key={g.axis?.id ?? `g${gi}`} className="space-y-1">
                  {g.axis && (
                    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
                      <h3 className="text-sm font-semibold" dir="auto">
                        {evalText(g.axis, 'label', lng)}
                      </h3>
                      <span className={cn('text-sm font-semibold tabular-nums', scoreTone(axisAvg).text)}>
                        {fmtScore(axisAvg, lng)}
                      </span>
                    </div>
                  )}
                  <ul>
                    {g.items.map((it) => (
                      <ResultRow key={it.id} item={it} stat={stat(it.id)} total={r.count} />
                    ))}
                  </ul>
                </section>
              );
            })}

            {texts.length > 0 && (
              <section className="space-y-4 border-t border-border pt-4">
                {texts.map((it) => (
                  <div key={it.id} className="space-y-2">
                    <h3 className="text-sm font-semibold" dir="auto">
                      {evalText(it, 'label', lng)}
                    </h3>
                    <ul className="space-y-2">
                      {stat(it.id).texts.map((x, i) => (
                        <li
                          key={i}
                          dir="auto"
                          className="whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-sm [overflow-wrap:anywhere]"
                        >
                          {x.text}
                          {x.leader_name && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              — <bdi>{x.leader_name}</bdi>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}
          </>
        )}

        {!data.can_evaluate && data.open && !data.mine && (
          <p className="text-xs text-muted-foreground">{t('eval.whoEvaluates')}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One مؤشر's average: the wording, then a bar on a phone (the number beside the
 * wording), or wording | bar | number on one line from sm up.
 */
function ResultRow({ item, stat, total }) {
  const { t, i18n } = useTranslation();
  const tone = scoreTone(stat.average);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_10rem_2.5rem]">
      <p className="text-sm" dir="auto">
        {evalText(item, 'label', i18n.language)}
        {!!item.archived && (
          <Badge variant="outline" className="ms-2 align-middle">
            {t('eval.archivedItem')}
          </Badge>
        )}
      </p>
      <span className={cn('text-end text-sm font-semibold tabular-nums sm:col-start-3 sm:row-start-1', tone.text)}>
        {fmtScore(stat.average, i18n.language)}
      </span>
      <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${(stat.average / 5) * 100}%` }} />
        </div>
        {/* Some left it blank: say on how many marks the average stands */}
        {stat.count < total && (
          <span className="text-xs text-muted-foreground tabular-nums">{t('eval.answeredBy', { count: stat.count })}</span>
        )}
      </div>
    </li>
  );
}

/** Admin only: each قائد's own marks, named, with a way to delete one. */
function ByLeaderCard({ form, list, onDelete }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('eval.byLeader')}</CardTitle>
        <CardDescription>{t('eval.byLeaderHint')}</CardDescription>
      </CardHeader>
      <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
        <ul className="divide-y divide-border border-t border-border">
          {list.map((e) => (
            <ByLeaderRow key={e.id} e={e} form={form} onDelete={() => onDelete(e)} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ByLeaderRow({ e, form, onDelete }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [open, setOpen] = useState(false);
  const tone = scoreTone(e.average);
  const answered = form.items.filter((it) => it.type !== 'axis' && e.answers[it.id]);
  return (
    <li>
      <div className="flex items-center gap-2 px-4 py-2 sm:px-5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="focus-ring flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-start"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              <bdi>{e.leader_name}</bdi>
            </span>
            <span className="block text-xs text-muted-foreground">{fmtDate(e.updated_at)}</span>
          </span>
          <span dir="ltr" className={cn('text-sm font-semibold tabular-nums', tone.text)}>
            {fmtScore(e.average, lng)}
          </span>
          <IconChevronDown
            className={cn('text-muted-foreground transition-[rotate] duration-200', open && 'rotate-180')}
          />
        </button>
        <Button
          variant="destructive-ghost"
          size="icon"
          onClick={onDelete}
          aria-label={`${t('common.delete')} — ${e.leader_name}`}
        >
          <IconTrash />
        </Button>
      </div>
      {open && (
        <ul className="space-y-1.5 px-4 pb-3 sm:px-5">
          {answered.map((it) => {
            const a = e.answers[it.id];
            return (
              <li key={it.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 text-muted-foreground" dir="auto">
                  {evalText(it, 'label', lng)}
                </span>
                {it.type === 'score' ? (
                  <span className={cn('shrink-0 font-medium tabular-nums', scoreTone(a.score).text)}>
                    {a.score} · {t(scaleKey(a.score))}
                  </span>
                ) : (
                  <span className="max-w-[60%] whitespace-pre-wrap text-end [overflow-wrap:anywhere]" dir="auto">
                    {a.text}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
