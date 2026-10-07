import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useFetch } from '../hooks';
import { EVAL_KIND_KEYS, EVAL_KINDS, evalText, groupByAxis } from '../lib/evaluations';
import {
  Badge,
  Button,
  CardContent,
  cn,
  Dialog,
  ErrorState,
  Input,
  Label,
  Select,
  Skeleton,
  useConfirm,
  useToast,
  IconChevronDown,
  IconLink,
  IconPencil,
  IconPlus,
  IconTrash,
} from './ui';

const ITEM_TYPES = ['axis', 'score', 'text'];
const TYPE_KEYS = { axis: 'eval.typeAxis', score: 'eval.typeScore', text: 'eval.typeText' };

let tmpKey = 0;
const nextKey = () => `n${++tmpKey}`;

// A form or a preset as the editor holds it: every row keyed, so React keeps a row's
// inputs with it when it moves up or down
const toDraft = (src, { id = null, preset = null, kinds = [] } = {}) => ({
  id,
  preset,
  name_ar: src.name_ar || '',
  name_fr: src.name_fr || '',
  kinds,
  items: src.items.map((it) => ({
    key: it.id ? `i${it.id}` : nextKey(),
    id: it.id ?? null,
    type: it.type,
    label_ar: it.label_ar || '',
    label_fr: it.label_fr || '',
    answered: it.answered || 0,
  })),
});

const errorText = (t, err) =>
  ({
    eval_needs_score: t('eval.errorNeedsScore'),
    eval_item_type_locked: t('eval.errorTypeLocked'),
    'invalid name': t('eval.errorName'),
    'invalid item label': t('eval.errorLabel'),
  })[err.message] || err.message;

/**
 * Paramètres → «Grilles d'évaluation». The admin decides what the قادة rate a نشاط on:
 * a ready form from منتدى مهدي الكشفي, adjusted or not, or one of his own; and which
 * form each kind of نشاط uses (one per kind).
 */
export default function EvalFormsPanel() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  const { data, setData, loading, error, reload } = useFetch('/eval-forms');
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(null);

  async function remove(f) {
    const name = evalText(f, 'name', lng);
    if (
      !(await confirm({
        title: t('common.delete'),
        message: f.evaluations ? t('eval.deleteFormUsed', { name }) : t('eval.deleteFormConfirm', { name }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      const res = await api.del(`/eval-forms/${f.id}`);
      setData(res);
      toast.success(t(res.archived ? 'eval.formArchived' : 'eval.formDeleted'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading)
    return (
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    );
  if (error)
    return (
      <CardContent>
        <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
      </CardContent>
    );

  const formOfKind = (kind) => data.forms.find((f) => f.kinds.includes(kind));
  return (
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('eval.settingsHint')}</p>

      {/* Which form each kind of نشاط is rated with, at a glance */}
      <div className="rounded-lg border border-border">
        <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          {t('eval.kindsTitle')}
        </p>
        <dl className="divide-y divide-border">
          {EVAL_KINDS.map((kind) => {
            const f = formOfKind(kind);
            return (
              <div key={kind} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                <dt className="text-muted-foreground">{t(EVAL_KIND_KEYS[kind])}</dt>
                <dd className={cn('font-medium', !f && 'font-normal text-muted-foreground')}>
                  {f ? <bdi>{evalText(f, 'name', lng)}</bdi> : t('eval.noEval')}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      {data.forms.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.forms.map((f) => {
            const scores = f.items.filter((it) => it.type === 'score').length;
            const texts = f.items.filter((it) => it.type === 'text').length;
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                {/* basis-64: on a phone the buttons go under the form's facts instead of
                    squeezing its badges to one per line */}
                <div className="min-w-0 grow basis-64 space-y-1.5">
                  <p className="font-medium" dir="auto">
                    {evalText(f, 'name', lng)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="whitespace-nowrap">{t('eval.formCounts', { scores, texts })}</span>
                    {' · '}
                    <span className="whitespace-nowrap">
                      {f.evaluations ? t('eval.usedIn', { count: f.sessions }) : t('eval.unused')}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {f.kinds.length ? (
                      EVAL_KINDS.filter((k) => f.kinds.includes(k)).map((k) => (
                        <Badge key={k} variant="secondary">
                          {t(EVAL_KIND_KEYS[k])}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline">{t('eval.noKind')}</Badge>
                    )}
                    {f.preset && <Badge variant="outline">{t('eval.fromPreset')}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft(toDraft(f, { id: f.id, preset: f.preset, kinds: f.kinds }))}
                  >
                    <IconPencil />
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="destructive-ghost"
                    size="icon"
                    onClick={() => remove(f)}
                    aria-label={`${t('common.delete')} — ${evalText(f, 'name', lng)}`}
                  >
                    <IconTrash />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Button onClick={() => setPicking(true)} className="w-full sm:w-auto">
        <IconPlus />
        {t('eval.addForm')}
      </Button>

      <PresetPicker
        open={picking}
        presets={data.presets}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false);
          setDraft(toDraft(p, { preset: p.key }));
        }}
        onBlank={() => {
          setPicking(false);
          setDraft(toDraft({ items: [{ type: 'score' }] }));
        }}
      />

      <FormEditor
        draft={draft}
        forms={data.forms}
        onClose={() => setDraft(null)}
        onSaved={(res) => {
          setData(res);
          setDraft(null);
          toast.success(t('eval.formSaved'));
        }}
      />
    </CardContent>
  );
}

/** The presets, each with its source on montadamahdi.net and a look at its indicators. */
function PresetPicker({ open, presets, onClose, onPick, onBlank }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('eval.pickTitle')}
      description={t('eval.pickHint')}
      size="lg"
      autoFocus={false}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={onBlank}>
            <IconPlus />
            {t('eval.blankForm')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <ul className="space-y-3">
        {presets.map((p) => (
          <PresetOption key={p.key} preset={p} onPick={() => onPick(p)} />
        ))}
      </ul>
    </Dialog>
  );
}

function PresetOption({ preset, onPick }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const scores = preset.items.filter((it) => it.type === 'score').length;
  const texts = preset.items.filter((it) => it.type === 'text').length;
  return (
    <li className="rounded-xl border border-border p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold leading-snug" dir="auto">
            {evalText(preset, 'name', lng)}
          </p>
          <p className="text-xs text-muted-foreground">{t('eval.formCounts', { scores, texts })}</p>
          <a
            href={preset.source.url}
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex items-center gap-1 rounded text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
          >
            <IconLink className="h-3.5 w-3.5" />
            {t('eval.source')} : <bdi>{preset.source.title}</bdi>
          </a>
        </div>
        <Button size="sm" onClick={onPick}>
          {t('eval.usePreset')}
        </Button>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        className="focus-ring mt-2 inline-flex min-h-9 cursor-pointer items-center gap-1 rounded text-xs font-medium text-primary"
      >
        {t(open ? 'eval.hidePreview' : 'eval.previewItems')}
        <IconChevronDown className={cn('h-3.5 w-3.5 transition-[rotate] duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={listId} className="mt-1 space-y-2">
          {groupByAxis(preset.items).map((g, gi) => (
            <div key={gi}>
              {g.axis && (
                <p className="text-xs font-semibold" dir="auto">
                  {evalText(g.axis, 'label', lng)}
                </p>
              )}
              <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">
                {g.items.map((it, i) => (
                  <li key={i} dir="auto">
                    {evalText(it, 'label', lng)}
                    {it.type === 'text' && <span className="text-muted-foreground/80"> — {t('eval.typeText')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function FormEditor({ draft, forms, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  const formId = useId();
  // The draft lives here while the dialog is open; a new one arrives with each opening
  const [state, setState] = useState(draft);
  const [shown, setShown] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  if (draft !== shown) {
    setShown(draft);
    setState(draft);
    setShowErrors(false);
  }
  const d = state;

  const patch = (p) => setState((s) => ({ ...s, ...p }));
  const patchItem = (key, p) =>
    setState((s) => ({ ...s, items: s.items.map((it) => (it.key === key ? { ...it, ...p } : it)) }));
  const move = (index, step) =>
    setState((s) => {
      const items = [...s.items];
      const [row] = items.splice(index, 1);
      items.splice(index + step, 0, row);
      return { ...s, items };
    });
  const add = (type) =>
    setState((s) => ({
      ...s,
      items: [...s.items, { key: nextKey(), id: null, type, label_ar: '', label_fr: '', answered: 0 }],
    }));
  async function removeItem(it) {
    if (it.answered > 0 && !(await confirm({ title: t('eval.removeItem'), message: t('eval.removeAnsweredConfirm') })))
      return;
    setState((s) => ({ ...s, items: s.items.filter((x) => x.key !== it.key) }));
  }
  const toggleKind = (k) =>
    patch({ kinds: d.kinds.includes(k) ? d.kinds.filter((x) => x !== k) : [...d.kinds, k] });

  const nameMissing = d && !d.name_ar.trim() && !d.name_fr.trim();
  const labelMissing = (it) => !it.label_ar.trim() && !it.label_fr.trim();
  const noScore = d && !d.items.some((it) => it.type === 'score');
  // Kinds this form would take from another one
  const moves = d
    ? d.kinds
        .map((k) => ({ kind: k, from: forms.find((f) => f.id !== d.id && f.kinds.includes(k)) }))
        .filter((m) => m.from)
    : [];

  async function save(e) {
    e.preventDefault();
    if (nameMissing || noScore || d.items.some(labelMissing)) {
      setShowErrors(true);
      toast.error(t(nameMissing ? 'eval.errorName' : noScore ? 'eval.errorNeedsScore' : 'eval.errorLabel'));
      return;
    }
    setSaving(true);
    const body = {
      name_ar: d.name_ar,
      name_fr: d.name_fr,
      preset: d.preset,
      kinds: d.kinds,
      items: d.items.map(({ id, type, label_ar, label_fr }) => ({ id, type, label_ar, label_fr })),
    };
    try {
      onSaved(d.id ? await api.put(`/eval-forms/${d.id}`, body) : await api.post('/eval-forms', body));
    } catch (err) {
      toast.error(errorText(t, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!draft}
      onClose={onClose}
      title={d?.id ? t('eval.editForm') : t('eval.newForm')}
      size="lg"
      autoFocus={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      {d && (
        <form id={formId} onSubmit={save} className="space-y-5" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-ar`}>{t('eval.nameAr')}</Label>
              <Input
                id={`${formId}-ar`}
                dir="rtl"
                lang="ar"
                value={d.name_ar}
                maxLength={120}
                onChange={(e) => patch({ name_ar: e.target.value })}
                aria-invalid={showErrors && nameMissing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-fr`}>{t('eval.nameFr')}</Label>
              <Input
                id={`${formId}-fr`}
                dir="ltr"
                lang="fr"
                value={d.name_fr}
                maxLength={120}
                onChange={(e) => patch({ name_fr: e.target.value })}
                aria-invalid={showErrors && nameMissing}
              />
            </div>
            {showErrors && nameMissing && (
              <p className="text-xs text-destructive sm:col-span-2">{t('eval.errorName')}</p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('eval.usedFor')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {EVAL_KINDS.map((k) => {
                const on = d.kinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleKind(k)}
                    className={cn(
                      'focus-ring inline-flex min-h-10 cursor-pointer items-center rounded-full border px-3.5 text-sm transition-colors sm:min-h-9',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    {t(EVAL_KIND_KEYS[k])}
                  </button>
                );
              })}
            </div>
            {moves.map((m) => (
              <p key={m.kind} className="text-xs text-warning">
                {t('eval.kindMoves', { kind: t(EVAL_KIND_KEYS[m.kind]), form: evalText(m.from, 'name', lng) })}
              </p>
            ))}
          </fieldset>

          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">{t('eval.items')}</p>
              <p className="text-xs text-muted-foreground">{t('eval.itemsHint')}</p>
            </div>
            <ol className="space-y-2">
              {d.items.map((it, i) => (
                <ItemRow
                  key={it.key}
                  it={it}
                  index={i}
                  last={i === d.items.length - 1}
                  invalid={showErrors && labelMissing(it)}
                  onPatch={(p) => patchItem(it.key, p)}
                  onMove={(step) => move(i, step)}
                  onRemove={() => removeItem(it)}
                />
              ))}
            </ol>
            {showErrors && noScore && <p className="text-xs text-destructive">{t('eval.errorNeedsScore')}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {ITEM_TYPES.map((type) => (
                <Button key={type} type="button" variant="outline" size="sm" onClick={() => add(type)}>
                  <IconPlus />
                  {t(`eval.add.${type}`)}
                </Button>
              ))}
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/**
 * A row of the form: its type, its wording in Arabic and in French, and its place.
 * An axis reads as a heading (tinted), so the structure shows while editing.
 */
function ItemRow({ it, index, last, invalid, onPatch, onMove, onRemove }) {
  const { t } = useTranslation();
  const base = useId();
  const locked = it.answered > 0;
  return (
    <li
      className={cn(
        'space-y-2 rounded-lg border p-2.5',
        it.type === 'axis' ? 'border-primary/25 bg-primary/5' : 'border-border',
        invalid && 'border-destructive/60'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-6 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{index + 1}</span>
        <Select
          className="min-w-0 flex-1 sm:w-56 sm:flex-none"
          value={it.type}
          onChange={(e) => onPatch({ type: e.target.value })}
          disabled={locked}
          aria-label={t('eval.itemType')}
        >
          {ITEM_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(TYPE_KEYS[type])}
            </option>
          ))}
        </Select>
        <span className="sm:grow" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={t('eval.moveUp')}
        >
          <IconChevronDown className="rotate-180" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onMove(1)}
          disabled={last}
          aria-label={t('eval.moveDown')}
        >
          <IconChevronDown />
        </Button>
        <Button type="button" variant="destructive-ghost" size="icon" onClick={onRemove} aria-label={t('eval.removeItem')}>
          <IconTrash />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          id={`${base}-ar`}
          dir="rtl"
          lang="ar"
          value={it.label_ar}
          maxLength={300}
          placeholder={t('eval.labelAr')}
          aria-label={`${t(TYPE_KEYS[it.type])} ${index + 1} — ${t('eval.labelAr')}`}
          aria-invalid={invalid}
          onChange={(e) => onPatch({ label_ar: e.target.value })}
          className={cn(it.type === 'axis' && 'font-semibold')}
        />
        <Input
          id={`${base}-fr`}
          dir="ltr"
          lang="fr"
          value={it.label_fr}
          maxLength={300}
          placeholder={t('eval.labelFr')}
          aria-label={`${t(TYPE_KEYS[it.type])} ${index + 1} — ${t('eval.labelFr')}`}
          aria-invalid={invalid}
          onChange={(e) => onPatch({ label_fr: e.target.value })}
          className={cn(it.type === 'axis' && 'font-semibold')}
        />
      </div>
      {locked && <p className="text-xs text-muted-foreground">{t('eval.itemAnswered', { count: it.answered })}</p>}
    </li>
  );
}
