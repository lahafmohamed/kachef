import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { MAJALAT, parsePastedMatalib, useMatalibCatalog } from '../lib/matalib';
import {
  cn,
  Badge,
  Button,
  Dialog,
  ErrorState,
  Input,
  Label,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  useConfirm,
  useToast,
  IconClipboard,
  IconPencil,
  MatalibLegend,
  RequirementGrid,
} from './ui';

/**
 * كتالوج مطالب فرقة — admin only, from الإعدادات. One line per number: its text, its مجال
 * and its type. A row opens its own small editor, so a 174-مطلب list is not 348 dropdowns.
 * Bulk entry is a paste from a spreadsheet, or a copy of the twin فرقة (الفتيات، الفرنكوفون).
 * Saving sends the whole list; numbers already ticked in أنشطة or files are never touched.
 */
export default function MatalibCatalogDialog({ branch, branches = [], open, onClose }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useMatalibCatalog(open ? branch?.id : null);
  const total = Number(branch?.total_requirements) || 0;
  const [draft, setDraft] = useState(new Map());
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [saving, setSaving] = useState(false);
  const name = (b) => (i18n.language === 'ar' ? b.name_ar : b.name_fr);

  // The loaded list becomes the draft, each time the dialog opens on a فرقة
  useEffect(() => {
    if (!data) return;
    setDraft(new Map(data.items.map((it) => [it.number, { label: it.label, majal: it.majal, kind: it.kind }])));
    setDirty(false);
  }, [data]);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setPasting(false);
      setPasteText('');
      setCopyFrom('');
    }
  }, [open]);

  function setLine(n, patch) {
    setDirty(true);
    setDraft((d) => {
      const next = new Map(d);
      next.set(n, { label: '', majal: null, kind: 'progress', ...d.get(n), ...patch });
      return next;
    });
  }

  function applyPaste() {
    const { items: lines, skipped } = parsePastedMatalib(pasteText, total, t);
    if (!lines.length) {
      toast.error(t('matalib.pasteEmpty'));
      return;
    }
    setDirty(true);
    setDraft((d) => {
      const next = new Map(d);
      for (const l of lines) next.set(l.number, { label: l.label, majal: l.majal, kind: l.kind });
      return next;
    });
    setPasting(false);
    setPasteText('');
    toast.success(
      skipped ? t('matalib.pastedSkipped', { count: lines.length, skipped }) : t('matalib.pasted', { count: lines.length })
    );
  }

  async function copy() {
    const from = branches.find((b) => String(b.id) === copyFrom);
    if (!from) return;
    if (!(await confirm({ title: t('matalib.copy'), message: t('matalib.copyConfirm', { name: name(from) }) }))) return;
    try {
      const res = await api.post(`/branches/${branch.id}/matalib/copy`, { from_branch_id: from.id });
      reload({ quiet: true });
      setCopyFrom('');
      toast.success(
        res.skipped
          ? t('matalib.pastedSkipped', { count: res.items.length, skipped: res.skipped })
          : t('matalib.pasted', { count: res.items.length })
      );
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const list = [...draft.entries()]
        .filter(([, v]) => v.label?.trim())
        .map(([number, v]) => ({ number, label: v.label.trim(), majal: v.majal || null, kind: v.kind || 'progress' }));
      await api.put(`/branches/${branch.id}/matalib`, { items: list });
      await reload({ quiet: true });
      setDirty(false);
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const named = [...draft.values()].filter((v) => v.label?.trim()).length;
  const others = branches.filter((b) => b.id !== branch?.id && Number(b.total_requirements) > 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={branch ? t('matalib.catalogOf', { name: name(branch) }) : ''}
      description={t('matalib.catalogCount', { named, total })}
      footer={
        <div className="flex w-full items-center gap-3">
          <Button onClick={save} loading={saving} disabled={!dirty} className="flex-1 sm:flex-none">
            {t('common.save')}
          </Button>
          {dirty && !saving && (
            <Badge variant="warning" role="status">
              {t('settings.unsaved')}
            </Badge>
          )}
        </div>
      }
    >
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('matalib.noTotal')}</p>
      ) : error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
      ) : loading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('matalib.hint')}</p>

          <div className="flex flex-wrap items-end gap-2">
            <Button variant="outline" onClick={() => setPasting((v) => !v)} aria-expanded={pasting}>
              <IconClipboard />
              {t('matalib.paste')}
            </Button>
            {others.length > 0 && (
              <div className="flex min-w-0 flex-1 items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="matalib-copy">{t('matalib.copyFrom')}</Label>
                  <Select id="matalib-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                    <option value="" disabled>
                      {t('matalib.pickBranch')}
                    </option>
                    {others.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {name(b)}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button variant="outline" onClick={copy} disabled={!copyFrom}>
                  {t('matalib.copy')}
                </Button>
              </div>
            )}
          </div>

          {pasting && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label htmlFor="matalib-paste">{t('matalib.pasteLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('matalib.pasteHint')}</p>
              <Textarea
                id="matalib-paste"
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                dir="auto"
              />
              <Button onClick={applyPaste} disabled={!pasteText.trim()}>
                {t('matalib.pasteApply')}
              </Button>
            </div>
          )}

          <ol className="divide-y divide-border rounded-lg border border-border">
            {Array.from({ length: total }, (_, i) => {
              const n = i + 1;
              const line = draft.get(n);
              const open = editing === n;
              return (
                <li key={n}>
                  {open ? (
                    <MatlabEditor
                      n={n}
                      line={line}
                      onChange={(patch) => setLine(n, patch)}
                      onDone={() => setEditing(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(n)}
                      className="focus-ring flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2 text-start text-sm transition-colors hover:bg-accent/40"
                    >
                      <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{n}</span>
                      <span
                        className={cn(
                          'min-w-0 flex-1 [overflow-wrap:anywhere]',
                          !line?.label && 'text-muted-foreground italic'
                        )}
                      >
                        {line?.label || t('matalib.noLabel')}
                      </span>
                      {line?.label && (
                        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                          {line.majal && <Badge variant="secondary">{t(`matalib.majal.${line.majal}`)}</Badge>}
                          {line.kind === 'admission' && <Badge variant="outline">{t('matalib.kind.admission')}</Badge>}
                        </span>
                      )}
                      <IconPencil className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Dialog>
  );
}

function MatlabEditor({ n, line, onChange, onDone }) {
  const { t } = useTranslation();
  const id = `matlab-${n}`;
  return (
    <div className="space-y-3 bg-accent/30 p-3">
      <div className="space-y-1.5">
        <Label htmlFor={id}>{t('matalib.labelOf', { n })}</Label>
        <Input
          id={id}
          autoFocus
          dir="auto"
          value={line?.label || ''}
          onChange={(e) => onChange({ label: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onDone())}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-majal`}>{t('matalib.majalLabel')}</Label>
          <Select
            id={`${id}-majal`}
            value={line?.majal || ''}
            onChange={(e) => onChange({ majal: e.target.value || null })}
          >
            <option value="">{t('matalib.noMajal')}</option>
            {MAJALAT.map((k) => (
              <option key={k} value={k}>
                {t(`matalib.majal.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('matalib.kindLabel')}</Label>
          <SegmentedControl
            label={t('matalib.kindLabel')}
            className="flex w-full"
            columns={2}
            value={line?.kind || 'progress'}
            onChange={(v) => onChange({ kind: v })}
            options={[
              { value: 'progress', label: t('matalib.kind.progress') },
              { value: 'admission', label: t('matalib.kind.admission') },
            ]}
          />
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onDone}>
        {t('matalib.done')}
      </Button>
    </div>
  );
}

/**
 * The numbered grid of a فرقة, named by its catalogue: titles on the cells, and under the
 * grid the ticked ones in words (a phone has no hover). `wrapClassName` boxes the grid
 * alone, as the forms scroll it inside a short frame.
 */
export function BranchRequirementGrid({ branchId, total, selected = [], onToggle, label, wrapClassName }) {
  const { t } = useTranslation();
  const { items, byNumber } = useMatalibCatalog(branchId);
  const grid = (
    <RequirementGrid total={total} selected={selected} onToggle={onToggle} label={label} labels={byNumber} />
  );
  return (
    <>
      {wrapClassName ? <div className={wrapClassName}>{grid}</div> : grid}
      {selected.length > 0 && (
        <MatalibLegend
          items={items}
          only={selected}
          selected={selected}
          summary={t('matalib.selectedNamed', { count: selected.filter((n) => byNumber.has(n)).length })}
          majalLabel={(k) => t(`matalib.majal.${k}`)}
        />
      )}
    </>
  );
}

/** The مطالب of a نشاط or a بطاقة, as named chips when the catalogue knows them. */
export function MatalibNamed({ branchId, numbers = [] }) {
  const { t } = useTranslation();
  const { items } = useMatalibCatalog(numbers.length ? branchId : null);
  return (
    <MatalibLegend
      items={items}
      only={numbers}
      summary={t('matalib.selectedNamed', { count: items.filter((it) => numbers.includes(it.number)).length })}
      majalLabel={(k) => t(`matalib.majal.${k}`)}
    />
  );
}
