import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Label,
  Badge,
  Dialog,
  IconPlus,
  IconTrash,
} from '../components/ui';

const EMPTY_BRANCH = { name_fr: '', name_ar: '', min_age: '', max_age: '', total_requirements: '' };

export default function Settings() {
  const { t } = useTranslation();
  const [branches, setBranches] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState(EMPTY_BRANCH);
  const [createError, setCreateError] = useState(null);

  function load() {
    api.get('/branches').then(setBranches).catch(console.error);
  }

  useEffect(load, []);

  function setField(id, field, value) {
    setSaved(false);
    setBranches((bs) => bs.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  }

  async function save() {
    setError(null);
    setSaved(false);
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
      setSaved(true);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createBranch(e) {
    e.preventDefault();
    setCreateError(null);
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
      load();
    } catch (err) {
      setCreateError(err.message);
    }
  }

  async function removeBranch(b) {
    setError(null);
    if (!confirm(t('settings.confirmDeleteBranch'))) return;
    try {
      await api.del(`/branches/${b.id}`);
      load();
    } catch (err) {
      setError(err.message === 'branch_in_use' ? t('settings.branchInUse') : err.message);
    }
  }

  const setNew = (field) => (e) => setNewBranch((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
        <Button onClick={() => setCreating(true)}>
          <IconPlus />
          {t('settings.newBranch')}
        </Button>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{t('settings.ageRanges')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('settings.noLimit')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {branches.map((b) => (
            <div key={b.id} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-40 flex-1 space-y-1.5">
                  <Label htmlFor={`fr-${b.id}`}>{t('settings.nameFr')}</Label>
                  <Input
                    id={`fr-${b.id}`}
                    value={b.name_fr}
                    onChange={(e) => setField(b.id, 'name_fr', e.target.value)}
                  />
                </div>
                <div className="min-w-40 flex-1 space-y-1.5">
                  <Label htmlFor={`ar-${b.id}`}>{t('settings.nameAr')}</Label>
                  <Input
                    id={`ar-${b.id}`}
                    dir="rtl"
                    value={b.name_ar}
                    onChange={(e) => setField(b.id, 'name_ar', e.target.value)}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeBranch(b)}
                  aria-label={t('common.delete')}
                >
                  <IconTrash />
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`min-${b.id}`}>{t('settings.minAge')}</Label>
                  <Input
                    id={`min-${b.id}`}
                    type="number"
                    min="0"
                    className="w-24"
                    value={b.min_age}
                    onChange={(e) => setField(b.id, 'min_age', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`max-${b.id}`}>{t('settings.maxAge')}</Label>
                  <Input
                    id={`max-${b.id}`}
                    type="number"
                    min="0"
                    className="w-24"
                    value={b.max_age ?? ''}
                    onChange={(e) => setField(b.id, 'max_age', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`reqs-${b.id}`}>{t('settings.totalRequirements')}</Label>
                  <Input
                    id={`reqs-${b.id}`}
                    type="number"
                    min="0"
                    className="w-28"
                    value={b.total_requirements}
                    onChange={(e) => setField(b.id, 'total_requirements', e.target.value)}
                  />
                </div>
                <div className="pb-2 text-xs text-muted-foreground">
                  {b.member_count} {t('settings.members')}
                </div>
              </div>
            </div>
          ))}

          <p className="text-sm text-muted-foreground">{t('settings.hint')}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-3">
            <Button onClick={save}>{t('common.save')}</Button>
            {saved && <Badge variant="success">{t('common.saved')}</Badge>}
          </div>
        </CardContent>
      </Card>

      <Dialog open={creating} onClose={() => setCreating(false)} title={t('settings.newBranch')}>
        <form onSubmit={createBranch} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nb_fr">{t('settings.nameFr')}</Label>
              <Input id="nb_fr" required value={newBranch.name_fr} onChange={setNew('name_fr')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb_ar">{t('settings.nameAr')}</Label>
              <Input id="nb_ar" dir="rtl" required value={newBranch.name_ar} onChange={setNew('name_ar')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb_min">{t('settings.minAge')}</Label>
              <Input id="nb_min" type="number" min="0" required value={newBranch.min_age} onChange={setNew('min_age')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb_max">{t('settings.maxAge')}</Label>
              <Input id="nb_max" type="number" min="0" value={newBranch.max_age} onChange={setNew('max_age')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb_reqs">{t('settings.totalRequirements')}</Label>
              <Input
                id="nb_reqs"
                type="number"
                min="0"
                required
                value={newBranch.total_requirements}
                onChange={setNew('total_requirements')}
              />
            </div>
          </div>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
