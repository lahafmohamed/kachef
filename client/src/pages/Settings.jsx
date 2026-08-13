import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useFetch } from '../hooks';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  useConfirm,
  useTheme,
  useToast,
  IconLanguages,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSun,
  IconTrash,
} from '../components/ui';

const EMPTY_BRANCH = { name_fr: '', name_ar: '', min_age: '', max_age: '', total_requirements: '' };

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
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(m) {
    if (!(await confirm({ title: t('common.delete'), message: t('settings.confirmDeleteMatlab') }))) return;
    try {
      await api.del(`/leader-matalib/${m.id}`);
      reload({ quiet: true });
      toast.success(t('settings.matlabDeleted'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('settings.leaderMatalib')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('settings.leaderMatalibHint')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
        ) : loading ? (
          <Skeleton className="h-24" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settings.noLeaderMatalib')}</p>
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
    </Card>
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
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState(EMPTY_BRANCH);
  const [createError, setCreateError] = useState(null);
  const [createSaving, setCreateSaving] = useState(false);

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
        });
      }
      setDirty(false);
      reload({ quiet: true });
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function createBranch(e) {
    e.preventDefault();
    setCreateError(null);
    setCreateSaving(true);
    try {
      await api.post('/branches', {
        name_fr: newBranch.name_fr,
        name_ar: newBranch.name_ar,
        min_age: Number(newBranch.min_age),
        max_age: newBranch.max_age === '' ? null : Number(newBranch.max_age),
        total_requirements: Number(newBranch.total_requirements) || 0,
      });
      setCreating(false);
      setNewBranch(EMPTY_BRANCH);
      reload({ quiet: true });
      toast.success(t('settings.branchCreated'));
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateSaving(false);
    }
  }

  async function removeBranch(b) {
    const name = i18n.language === 'ar' ? b.name_ar : b.name_fr;
    if (
      !(await confirm({
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
      toast.error(err.message === 'branch_in_use' ? t('settings.branchInUse') : err.message);
    }
  }

  const setNew = (field) => (e) => setNewBranch((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="space-y-4">
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')}>
        <Button variant="brand" onClick={() => setCreating(true)}>
          <IconPlus />
          {t('settings.newBranch')}
        </Button>
      </PageHeader>

      {/* ---------- Appearance & language ---------- */}
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{t('settings.appearance')}</CardTitle>
        </CardHeader>
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
                  className={`focus-ring inline-flex h-10 cursor-pointer items-center gap-2 px-3 text-sm font-medium transition-colors sm:h-9 ${
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
                  className={`focus-ring inline-flex h-10 cursor-pointer items-center gap-2 px-3 text-sm font-medium transition-colors sm:h-9 ${
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
      </Card>

      {/* ---------- Branches ---------- */}
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{t('settings.ageRanges')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('settings.noLimit')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
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
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">
                    {i18n.language === 'ar' ? b.name_ar : b.name_fr}
                    <span className="ms-2 text-xs font-normal tabular-nums text-muted-foreground">
                      {b.member_count} {t('settings.members')}
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
                <div className="grid gap-3 sm:grid-cols-2">
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
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
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
                      placeholder="∞"
                      value={b.max_age ?? ''}
                      onChange={(e) => setField(b.id, 'max_age', e.target.value)}
                    />
                  </div>
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
                </div>
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
      </Card>

      {/* ---------- مطالب القادة (بطاقة تقدم القائد) ---------- */}
      <LeaderMatalibCard />

      <Dialog open={creating} onClose={() => setCreating(false)} title={t('settings.newBranch')}>
        <form onSubmit={createBranch} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nb_fr">{t('settings.nameFr')}</Label>
              <Input id="nb_fr" dir="ltr" required value={newBranch.name_fr} onChange={setNew('name_fr')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb_ar">{t('settings.nameAr')}</Label>
              <Input id="nb_ar" dir="rtl" required value={newBranch.name_ar} onChange={setNew('name_ar')} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="nb_min">{t('settings.minAge')}</Label>
              <Input
                id="nb_min"
                type="number"
                inputMode="numeric"
                min="0"
                required
                value={newBranch.min_age}
                onChange={setNew('min_age')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb_max">{t('settings.maxAge')}</Label>
              <Input
                id="nb_max"
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="∞"
                value={newBranch.max_age}
                onChange={setNew('max_age')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb_reqs">{t('settings.totalRequirements')}</Label>
              <Input
                id="nb_reqs"
                type="number"
                inputMode="numeric"
                min="0"
                required
                value={newBranch.total_requirements}
                onChange={setNew('total_requirements')}
              />
            </div>
          </div>
          {createError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {createError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={createSaving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
