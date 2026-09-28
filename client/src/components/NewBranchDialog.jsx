import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Button, Dialog, Input, Label, useToast } from './ui';

const EMPTY_BRANCH = {
  name_fr: '',
  name_ar: '',
  min_age: '',
  max_age: '',
  total_requirements: '',
  all_ages: false,
};

/**
 * «كل الأعمار» — a فرقة outside the age ladder (الفرنكوفونية): no range to type, and
 * the server keeps its عناصر out of every ترفيع. Shared with the فرق cards in الإعدادات.
 */
export function AllAgesToggle({ checked, onChange }) {
  const { t } = useTranslation();
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-accent/40">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{t('branch.allAges')}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{t('settings.allAgesHint')}</span>
      </span>
    </label>
  );
}

/**
 * Creating a فرقة — admin only, like the endpoint behind it. Shared by the الفرق page,
 * where one looks for it first, and الإعدادات, where the فرق are configured.
 * `onCreated` receives the new row so the caller can open straight on it.
 */
export default function NewBranchDialog({ open, onClose, onCreated }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_BRANCH);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // A half-typed form survives a cancel; last attempt's error does not
  function close() {
    setError(null);
    onClose();
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await api.post('/branches', {
        name_fr: form.name_fr,
        name_ar: form.name_ar,
        min_age: form.all_ages ? 0 : Number(form.min_age),
        max_age: form.all_ages || form.max_age === '' ? null : Number(form.max_age),
        total_requirements: Number(form.total_requirements) || 0,
        all_ages: form.all_ages,
      });
      setForm(EMPTY_BRANCH);
      toast.success(t('settings.branchCreated'));
      onCreated(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={t('settings.newBranch')}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nb_fr">{t('settings.nameFr')}</Label>
            <Input id="nb_fr" dir="ltr" required value={form.name_fr} onChange={set('name_fr')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nb_ar">{t('settings.nameAr')}</Label>
            <Input id="nb_ar" dir="rtl" required value={form.name_ar} onChange={set('name_ar')} />
          </div>
        </div>
        <AllAgesToggle checked={form.all_ages} onChange={(v) => setForm((f) => ({ ...f, all_ages: v }))} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
          {/* Unmounted, not hidden: a hidden required field would block the submit */}
          {!form.all_ages && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="nb_min">{t('settings.minAge')}</Label>
                <Input
                  id="nb_min"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  required
                  value={form.min_age}
                  onChange={set('min_age')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nb_max">{t('settings.maxAge')}</Label>
                {/* The server refuses a max under the min: say so before the round trip */}
                <Input
                  id="nb_max"
                  type="number"
                  inputMode="numeric"
                  min={form.min_age || 0}
                  value={form.max_age}
                  onChange={set('max_age')}
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="nb_reqs">{t('settings.totalRequirements')}</Label>
            <Input
              id="nb_reqs"
              type="number"
              inputMode="numeric"
              min="0"
              required
              value={form.total_requirements}
              onChange={set('total_requirements')}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
