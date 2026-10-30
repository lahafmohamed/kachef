import { displayError } from '../lib/errors';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useFetch } from '../hooks';
import { fmtAmount } from '../utils';
import { useAuth } from '../auth';
import NewBranchDialog, { AllAgesToggle } from '../components/NewBranchDialog';
import EvalFormsPanel from '../components/EvalForms';
import SectionField from '../components/SectionField';
import MatalibCatalogDialog from '../components/MatalibCatalog';
import {
  cn,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  useConfirm,
  useTheme,
  useToast,
  IconChevronDown,
  IconClipboard,
  IconLanguages,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSettings,
  IconSun,
  IconTrash,
} from '../components/ui';

/**
 * A settings card that folds down to its title. Every section starts closed, so
 * the page opens as a short list of what can be configured instead of a wall of
 * forms. The body stays mounted while folded — its data loads once and a
 * half-typed value survives — and `inert` keeps it out of the tab order and
 * away from screen readers until it is opened again.
 */
function SettingsSection({ title, badge, open: openProp, onOpenChange, children }) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const bodyId = useId();

  return (
    <Card className="max-w-3xl">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className={cn(
            'focus-ring group flex w-full cursor-pointer items-center gap-3 rounded-2xl p-4 text-start transition-colors sm:p-5',
            // Folded, the whole card is the target; open, a tint would butt
            // straight into the first row of the body, so only the chevron reacts.
            open ? 'rounded-b-none' : 'hover:bg-accent/50'
          )}
        >
          {/* Wraps so a badge drops under the title on a phone instead of
              squeezing it to one word per line */}
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-base font-semibold leading-tight tracking-tight">{title}</span>
            {badge}
          </span>
          <IconChevronDown
            className={cn(
              'text-muted-foreground transition-[color,rotate] duration-200 ease-(--ease-out-soft) group-hover:text-foreground',
              open && 'rotate-180'
            )}
          />
        </button>
      </h2>
      {/* 0fr → 1fr folds to the body's real height without measuring it.
          Clipped with overflow: clip where supported — hidden would turn this
          wrapper into a scroll container and trap the branches' sticky Save
          bar inside it. Safari < 16 falls back to hidden. `relative` makes it
          the containing block of absolutely placed descendants (sr-only
          labels): otherwise they escape the clip and keep a folded page
          scrolling into blank space. */}
      <div
        id={bodyId}
        className={cn(
          'grid grid-cols-1 transition-[grid-template-rows] duration-200 ease-(--ease-out-soft)',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div inert={!open} className="relative min-h-0 overflow-hidden supports-[overflow:clip]:overflow-clip">
          {children}
        </div>
      </div>
    </Card>
  );
}

/**
 * لائحة مطالب فرقة القادة — the one followed on بطاقة تقدم القائد, year after year.
 * It lives in the base because its content is agreed with السيد علي and will change.
 */
function LeaderMatalibCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch('/leader-matalib');
  const [form, setForm] = useState({ number: '', label: '' });
  const [saving, setSaving] = useState(false);

  const list = data || [];
  const nextNumber = list.reduce((n, m) => Math.max(n, m.number), 0) + 1;

  async function add(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/leader-matalib', {
        number: Number(form.number || nextNumber),
        label: form.label,
      });
      setForm({ number: '', label: '' });
      reload({ quiet: true });
      toast.success(t('settings.matlabCreated'));
    } catch (err) {
      toast.error(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(m) {
    if (!(await confirm({ confirmLabel: t('common.delete'), title: t('common.delete'), message: t('settings.confirmDeleteMatlab') }))) return;
    try {
      await api.del(`/leader-matalib/${m.id}`);
      reload({ quiet: true });
      toast.success(t('settings.matlabDeleted'));
    } catch (err) {
      toast.error(displayError(err));
    }
  }

  return (
    <SettingsSection title={t('settings.leaderMatalib')}>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('settings.leaderMatalibHint')}</p>
        {error ? (
          <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
        ) : loading ? (
          <Skeleton className="h-24" />
        ) : list.length === 0 ? (
          <EmptyState
            title={t('settings.noLeaderMatalib')}
            className="gap-1 rounded-lg border border-dashed border-border px-4 py-6"
          >
            {t('settings.noLeaderMatalibHint')}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                <Badge variant="outline">{m.number}</Badge>
                <span className="flex-1 text-sm">{m.label}</span>
                <Button
                  variant="destructive-ghost"
                  size="icon-sm"
                  onClick={() => remove(m)}
                  aria-label={t('common.delete')}
                >
                  <IconTrash />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="w-20 space-y-1.5">
            <Label htmlFor="lm_number">{t('settings.matlabNumber')}</Label>
            <Input
              id="lm_number"
              type="number"
              inputMode="numeric"
              min="1"
              placeholder={String(nextNumber)}
              value={form.number}
              onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
            />
          </div>
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="lm_label">{t('settings.matlabLabel')}</Label>
            <Input
              id="lm_label"
              required
              autoComplete="off"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <Button type="submit" loading={saving}>
            <IconPlus />
            {t('settings.newMatlab')}
          </Button>
        </form>
      </CardContent>
    </SettingsSection>
  );
}

/**
 * لوائح مكان السكن والمدارس — the values registration picks from. They live here
 * because a quartier typed by hand ends up spelled three ways, and each spelling
 * becomes its own filter entry holding a third of the people who live there.
 */
const LOOKUP_KINDS = [
  { key: 'residence_abidjan', label: 'settings.lookupAbidjan' },
  { key: 'residence_lebanon', label: 'settings.lookupLebanon' },
  { key: 'school', label: 'settings.lookupSchool' },
];

function LookupListsCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch('/lookups');
  const [kind, setKind] = useState(LOOKUP_KINDS[0].key);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  // id of the row being renamed, plus its draft text
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  const list = data?.[kind] || [];

  async function add(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/lookups', { kind, label });
      setLabel('');
      reload({ quiet: true });
      toast.success(t('settings.lookupCreated'));
    } catch (err) {
      toast.error(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  async function rename(v) {
    if (!draft.trim() || draft.trim() === v.label) return setEditing(null);
    try {
      await api.put(`/lookups/${v.id}`, { label: draft.trim() });
      setEditing(null);
      reload({ quiet: true });
      toast.success(t('settings.lookupRenamed'));
    } catch (err) {
      toast.error(displayError(err));
    }
  }

  async function remove(v) {
    const message = v.usage_count
      ? t('settings.confirmDeleteLookupInUse', { count: v.usage_count })
      : t('settings.confirmDeleteLookup');
    if (!(await confirm({ confirmLabel: t('common.delete'), title: t('common.delete'), message }))) return;
    try {
      await api.del(`/lookups/${v.id}`);
      reload({ quiet: true });
      toast.success(t('settings.lookupDeleted'));
    } catch (err) {
      toast.error(displayError(err));
    }
  }

  return (
    <SettingsSection title={t('settings.lookups')}>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('settings.lookupsHint')}</p>
        <div className="flex flex-wrap gap-2">
          {LOOKUP_KINDS.map((k) => (
            <Button
              key={k.key}
              size="sm"
              variant={k.key === kind ? 'brand' : 'outline'}
              onClick={() => {
                setKind(k.key);
                setEditing(null);
              }}
            >
              {t(k.label)}
              <Badge
                variant="outline"
                className={
                  k.key === kind ? 'border-primary-foreground/35 text-primary-foreground' : undefined
                }
              >
                {(data?.[k.key] || []).length}
              </Badge>
            </Button>
          ))}
        </div>

        {error ? (
          <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
        ) : loading ? (
          <Skeleton className="h-24" />
        ) : list.length === 0 ? (
          <EmptyState
            title={t('settings.noLookup')}
            className="gap-1 rounded-lg border border-dashed border-border px-4 py-6"
          >
            {t('settings.noLookupHint')}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                {editing === v.id ? (
                  <>
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rename(v);
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      aria-label={t('settings.lookupLabel')}
                      className="min-w-40 flex-1 sm:h-9"
                    />
                    <Button size="sm" onClick={() => rename(v)}>
                      {t('common.save')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t('common.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    {/* A long school name wraps instead of losing its end */}
                    <span className="min-w-0 flex-1 break-words text-sm">{v.label}</span>
                    {/* Says what a delete would leave behind, before it is clicked */}
                    {v.usage_count > 0 && <Badge variant="outline">{v.usage_count}</Badge>}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditing(v.id);
                        setDraft(v.label);
                      }}
                      aria-label={t('common.edit')}
                    >
                      <IconPencil />
                    </Button>
                    <Button
                      variant="destructive-ghost"
                      size="icon-sm"
                      onClick={() => remove(v)}
                      aria-label={t('common.delete')}
                    >
                      <IconTrash />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="lookup_label">{t('settings.lookupLabel')}</Label>
            <Input
              id="lookup_label"
              required
              autoComplete="off"
              placeholder={t('settings.lookupPlaceholder')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <Button type="submit" loading={saving}>
            <IconPlus />
            {t('settings.newLookup')}
          </Button>
        </form>
      </CardContent>
    </SettingsSection>
  );
}

/**
 * Suivi des absences (A2) : la série d'absences qui met un عنصر «للمتابعة» et envoie
 * l'alerte aux قادة de sa فرقة (deux fois la série : l'admin aussi).
 */
function AbsenceFollowupCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, updateUser } = useAuth();
  const { data, loading, error, reload } = useFetch('/settings/followup');
  const [value, setValue] = useState(null);
  const [saving, setSaving] = useState(false);
  const current = value ?? data?.absence_threshold ?? '';

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put('/settings/followup', { absence_threshold: Number(current) });
      setValue(null);
      reload({ quiet: true });
      // Every badge of this session follows at once
      if (user) updateUser({ ...user, absence_threshold: res.absence_threshold });
      toast.success(t('followup.settingsSaved'));
    } catch (err) {
      toast.error(err.message === 'invalid_threshold' ? t('followup.settingsInvalid') : displayError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection title={t('followup.settingsTitle')}>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('followup.settingsHint')}</p>
        {loading ? (
          <Skeleton className="h-10 w-40" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="absence_threshold">{t('followup.settingsLabel')}</Label>
              <Input
                id="absence_threshold"
                type="number"
                inputMode="numeric"
                min={2}
                max={10}
                required
                className="w-28 tabular-nums"
                value={current}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <Button type="submit" variant="brand" loading={saving} disabled={value === null}>
              {t('common.save')}
            </Button>
          </form>
        )}
      </CardContent>
    </SettingsSection>
  );
}

/**
 * Tarifs des cotisations (G1), datés : un tarif vaut à partir de son mois jusqu'au
 * suivant, si bien qu'un changement ne touche jamais les mois déjà passés. Un pour les
 * عناصر, un pour les قادة ; le dernier d'un genre ne se supprime pas.
 */
function DuesRatesCard() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload, setData } = useFetch('/due-rates');
  const [kind, setKind] = useState('member');
  const [amount, setAmount] = useState('');
  const [month, setMonth] = useState('');
  const [saving, setSaving] = useState(false);
  const fmtMonth = (m) =>
    new Intl.DateTimeFormat(lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR', { month: 'long', year: 'numeric' }).format(
      new Date(`${m}-01T12:00:00`)
    );
  const effective = month || data?.current_month || '';

  async function add(e) {
    e.preventDefault();
    setSaving(true);
    try {
      setData(await api.post('/due-rates', { kind, amount: Number(amount), effective_month: effective }));
      setAmount('');
      setMonth('');
      toast.success(t('arrears.rateAdded'));
    } catch (err) {
      toast.error(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(r) {
    const ok = await confirm({
      title: t('arrears.rateDeleteTitle'),
      message: t('arrears.rateDeleteBody', { amount: fmtAmount(r.amount), month: fmtMonth(r.effective_month) }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      setData(await api.del(`/due-rates/${r.id}`));
    } catch (err) {
      toast.error(err.message === 'last_rate' ? t('arrears.lastRate') : displayError(err));
    }
  }

  const list = (k) => {
    const rows = data?.[k] || [];
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">{t(k === 'member' ? 'arrears.kindMember' : 'arrears.kindLeader')}</p>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {[...rows].reverse().map((r) => {
            const current = r.amount === data.current[k] && r.effective_month <= data.current_month &&
              !rows.some((x) => x.effective_month > r.effective_month && x.effective_month <= data.current_month);
            return (
              <li key={r.id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold tabular-nums">{fmtAmount(r.amount)}</span>
                  <span className="text-muted-foreground"> · {t('arrears.rateFrom', { month: fmtMonth(r.effective_month) })}</span>
                </span>
                {current && <Badge variant="success">{t('arrears.rateCurrent')}</Badge>}
                {r.effective_month > data.current_month && <Badge variant="info">{t('arrears.rateUpcoming')}</Badge>}
                {rows.length > 1 && (
                  <Button
                    variant="destructive-ghost"
                    size="icon-sm"
                    aria-label={t('common.delete')}
                    onClick={() => remove(r)}
                  >
                    <IconTrash />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <SettingsSection title={t('arrears.ratesTitle')}>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('arrears.ratesHint')}</p>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {list('member')}
              {list('leader')}
            </div>
            <form onSubmit={add} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="rate_kind">{t('arrears.rateKind')}</Label>
                <Select id="rate_kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-40">
                  <option value="member">{t('arrears.kindMember')}</option>
                  <option value="leader">{t('arrears.kindLeader')}</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate_amount">{t('arrears.amountLabel')}</Label>
                <Input
                  id="rate_amount"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={500}
                  required
                  className="w-32 tabular-nums"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate_month">{t('arrears.fromLabel')}</Label>
                <Input
                  id="rate_month"
                  type="month"
                  required
                  className="w-44"
                  value={effective}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </div>
              <Button type="submit" variant="brand" loading={saving}>
                <IconPlus />
                {t('arrears.rateAdd')}
              </Button>
            </form>
            {effective && data && effective < data.current_month && (
              <p className="text-xs font-medium text-warning">{t('arrears.pastWarning')}</p>
            )}
          </>
        )}
      </CardContent>
    </SettingsSection>
  );
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const { theme, setTheme } = useTheme();

  const { data, loading, error, reload, setData } = useFetch('/branches');
  const branches = data || [];

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Held here, not in the section: creating a branch opens it on the new one.
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // كتالوج المطالب: the فرقة whose list is open
  const [catalogOf, setCatalogOf] = useState(null);

  function setField(id, field, value) {
    setDirty(true);
    setData((bs) => bs.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  }

  async function save() {
    setSaving(true);
    try {
      for (const b of branches) {
        await api.put(`/branches/${b.id}`, {
          name_fr: b.name_fr,
          name_ar: b.name_ar,
          min_age: Number(b.min_age),
          max_age: b.max_age === '' || b.max_age === null ? null : Number(b.max_age),
          total_requirements: Number(b.total_requirements) || 0,
          all_ages: !!b.all_ages,
          section: b.section,
          ...(b.promotion_threshold === '' || b.promotion_threshold === null || b.promotion_threshold === undefined
            ? {}
            : { promotion_threshold: Math.min(100, Math.max(0, Math.round(Number(b.promotion_threshold)) || 0)) }),
        });
      }
      setDirty(false);
      reload({ quiet: true });
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err.message === 'branch_section_in_use' ? t('section.branchInUse') : displayError(err));
    } finally {
      setSaving(false);
    }
  }

  function branchCreated() {
    setCreating(false);
    setBranchesOpen(true);
    reload({ quiet: true });
  }

  async function removeBranch(b) {
    const name = i18n.language === 'ar' ? b.name_ar : b.name_fr;
    if (
      !(await confirm({ confirmLabel: t('common.delete'),
        title: t('common.delete'),
        message: `${t('settings.confirmDeleteBranch')} (${name})`,
      }))
    )
      return;
    try {
      await api.del(`/branches/${b.id}`);
      reload({ quiet: true });
      toast.success(t('settings.branchDeleted'));
    } catch (err) {
      toast.error(err.message === 'branch_in_use' ? t('settings.branchInUse') : displayError(err));
    }
  }

  return (
    // The header's action lines up with the sections' edge, not the far side of the page
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')}>
        <Button variant="brand" onClick={() => setCreating(true)}>
          <IconPlus />
          {t('settings.newBranch')}
        </Button>
      </PageHeader>

      {/* ---------- Appearance & language ---------- */}
      <SettingsSection title={t('settings.appearance')}>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label>{t('settings.theme')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.themeHint')}</p>
            </div>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {[
                { v: 'light', Icon: IconSun, key: 'nav.lightMode' },
                { v: 'dark', Icon: IconMoon, key: 'nav.darkMode' },
              ].map(({ v, Icon, key }, i) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={theme === v}
                  onClick={() => setTheme(v)}
                  className={`focus-ring inline-flex h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium transition-colors sm:h-9 ${
                    i > 0 ? 'border-s border-border' : ''
                  } ${
                    theme === v
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  <Icon />
                  {t(key)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <Label>{t('settings.language')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.languageHint')}</p>
            </div>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {[
                { v: 'fr', label: 'Français' },
                { v: 'ar', label: 'العربية' },
              ].map(({ v, label }, i) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={i18n.language === v}
                  onClick={() => i18n.changeLanguage(v)}
                  className={`focus-ring inline-flex h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium transition-colors sm:h-9 ${
                    i > 0 ? 'border-s border-border' : ''
                  } ${
                    i18n.language === v
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  {i === 0 && <IconLanguages />}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </SettingsSection>

      {/* ---------- Branches ---------- */}
      <SettingsSection
        title={t('settings.ageRanges')}
        open={branchesOpen}
        onOpenChange={setBranchesOpen}
        // Folding the section must not hide that there is something to save
        badge={dirty && !saving && <Badge variant="warning">{t('settings.unsaved')}</Badge>}
      >
        <CardContent className="space-y-4">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t('settings.noLimit')}</p>
            <p>{t('section.branchHint')}</p>
            <p>{t('settings.allAgesHint')}</p>
            <p>{t('matalib.thresholdHint')}</p>
          </div>
          {error ? (
            <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
          ) : loading ? (
            <>
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </>
          ) : branches.length === 0 ? (
            <EmptyState
              icon={<IconSettings className="h-6 w-6" />}
              title={t('settings.noBranches')}
              action={
                <Button variant="brand" onClick={() => setCreating(true)}>
                  <IconPlus />
                  {t('settings.newBranch')}
                </Button>
              }
            />
          ) : (
            branches.map((b) => (
              <div key={b.id} className="space-y-3 rounded-lg border border-border p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">
                    {i18n.language === 'ar' ? b.name_ar : b.name_fr}
                    <span className="ms-2 whitespace-nowrap text-xs font-normal tabular-nums text-muted-foreground">
                      {t('member.rosterCount', { count: b.member_count })}
                    </span>
                  </h3>
                  <Button
                    variant="destructive-ghost"
                    size="icon-sm"
                    onClick={() => removeBranch(b)}
                    aria-label={t('common.delete')}
                  >
                    <IconTrash />
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`fr-${b.id}`}>{t('settings.nameFr')}</Label>
                    <Input
                      id={`fr-${b.id}`}
                      dir="ltr"
                      value={b.name_fr}
                      onChange={(e) => setField(b.id, 'name_fr', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ar-${b.id}`}>{t('settings.nameAr')}</Label>
                    <Input
                      id={`ar-${b.id}`}
                      dir="rtl"
                      value={b.name_ar}
                      onChange={(e) => setField(b.id, 'name_ar', e.target.value)}
                    />
                  </div>
                </div>
                {/* The section rule is said once, above the list, not in every card */}
                <SectionField value={b.section} onChange={(v) => setField(b.id, 'section', v)} />
                <AllAgesToggle
                  hint={false}
                  checked={!!b.all_ages}
                  onChange={(v) => setField(b.id, 'all_ages', v ? 1 : 0)}
                />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                  {!b.all_ages && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor={`min-${b.id}`}>{t('settings.minAge')}</Label>
                        <Input
                          id={`min-${b.id}`}
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={b.min_age}
                          onChange={(e) => setField(b.id, 'min_age', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`max-${b.id}`}>{t('settings.maxAge')}</Label>
                        <Input
                          id={`max-${b.id}`}
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={b.max_age ?? ''}
                          onChange={(e) => setField(b.id, 'max_age', e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor={`reqs-${b.id}`}>{t('settings.totalRequirements')}</Label>
                    <Input
                      id={`reqs-${b.id}`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={b.total_requirements}
                      onChange={(e) => setField(b.id, 'total_requirements', e.target.value)}
                    />
                  </div>
                  {!b.all_ages && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`thr-${b.id}`}>{t('matalib.threshold')}</Label>
                      <Input
                        id={`thr-${b.id}`}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="100"
                        value={b.promotion_threshold ?? ''}
                        onChange={(e) => setField(b.id, 'promotion_threshold', e.target.value)}
                      />
                    </div>
                  )}
                </div>
                {Number(b.total_requirements) > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setCatalogOf(b)} disabled={dirty}>
                    <IconClipboard />
                    {t('matalib.editCatalog')}
                  </Button>
                )}
              </div>
            ))
          )}

          {branches.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">{t('settings.hint')}</p>
              {/* Sticky on mobile so Save stays reachable while editing a long list */}
              <div className="sticky bottom-[calc(var(--bottomnav-h)+0.5rem)] z-10 flex items-center gap-3 rounded-lg border border-border bg-card/95 p-2 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
                <Button onClick={save} loading={saving} disabled={!dirty} className="flex-1 sm:flex-none">
                  {t('common.save')}
                </Button>
                {dirty && !saving && (
                  <Badge variant="warning" role="status">
                    {t('settings.unsaved')}
                  </Badge>
                )}
              </div>
            </>
          )}
        </CardContent>
      </SettingsSection>

      {/* ---------- استمارات تقييم الأنشطة ---------- */}
      <SettingsSection title={t('eval.settingsTitle')}>
        <EvalFormsPanel />
      </SettingsSection>

      {/* ---------- متابعة الغياب: عتبة الغيابات المتتالية ---------- */}
      <AbsenceFollowupCard />

      {/* ---------- tarifs des cotisations (G1) ---------- */}
      <DuesRatesCard />

      {/* ---------- لوائح مكان السكن والمدارس ---------- */}
      <LookupListsCard />

      {/* ---------- مطالب القادة (بطاقة تقدم القائد) ---------- */}
      <LeaderMatalibCard />

      <MatalibCatalogDialog
        open={!!catalogOf}
        branch={catalogOf}
        branches={branches}
        onClose={() => setCatalogOf(null)}
      />

      <NewBranchDialog open={creating} onClose={() => setCreating(false)} onCreated={branchCreated} />
    </div>
  );
}
