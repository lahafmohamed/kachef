import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import { useFetch } from '../hooks';
import { branchName, todayISO } from '../utils';
import { monthRange, periodLabel, previousMonth, quarterRange, recentQuarters } from '../lib/periodReport';
import ExportPdfButton from './ExportPdfButton';
import DatePicker from './DatePicker';
import { Button, Dialog, Field, Input, SegmentedControl, Select, cn, useToast, IconFileText } from './ui';

const RECIPIENT_KEY = 'periodReport.recipient';
const readRecipient = () => {
  try {
    return localStorage.getItem(RECIPIENT_KEY);
  } catch {
    return null;
  }
};

/**
 * I1 : le rapport périodique à la قيادة. Un bouton qui ouvre le choix de la période (mois,
 * trimestre ou dates libres), de la فرقة (ou tout le فوج) et du destinataire, puis le
 * même «Télécharger ▾ PDF | Excel» que partout. `branchId` : la فرقة est fixée (fiche فرقة).
 * `month` : ouvre directement sur ce mois (lien du rappel du 1er du mois).
 */
export default function PeriodReportButton({ branchId = null, month = null, compact = false, className }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = usePerms();
  const [open, setOpen] = useState(!!month);
  const [mode, setMode] = useState('month');
  const [monthValue, setMonthValue] = useState(month || previousMonth());
  const quarters = recentQuarters();
  const [quarter, setQuarter] = useState(quarters[1]);
  const [custom, setCustom] = useState({ from: monthRange(previousMonth()).from, to: todayISO() });
  const [branch, setBranch] = useState(branchId ? String(branchId) : '0');
  const [recipient, setRecipient] = useState(() => readRecipient() ?? '');
  const branches = useFetch('/branches', { skip: !open || !!branchId });
  const setting = useFetch('/settings/report', { skip: !open });

  useEffect(() => {
    if (month) {
      setMonthValue(month);
      setMode('month');
      setOpen(true);
    }
  }, [month]);
  // Personne n'a encore écrit de destinataire ici : celui de l'admin
  useEffect(() => {
    if (readRecipient() === null && setting.data?.recipient) setRecipient(setting.data.recipient);
  }, [setting.data]);
  useEffect(() => {
    try {
      if (recipient) localStorage.setItem(RECIPIENT_KEY, recipient);
    } catch {
      /* the page works without it */
    }
  }, [recipient]);

  if (!can('branches.read')) return null;

  const range =
    mode === 'month'
      ? /^\d{4}-\d{2}$/.test(monthValue)
        ? monthRange(monthValue)
        : null
      : mode === 'quarter'
        ? quarterRange(quarter)
        : custom.from && custom.to && custom.from <= custom.to
          ? custom
          : null;
  const q = new URLSearchParams();
  if (range) {
    q.set('from', range.from);
    q.set('to', range.to);
  }
  if (recipient.trim()) q.set('recipient', recipient.trim().slice(0, 120));
  const query = q.toString();
  const id = branchId || Number(branch) || 0;

  async function saveDefault() {
    try {
      await api.put('/settings/report', { recipient: recipient.trim() });
      setting.reload?.();
      toast.success(t('periodReport.recipientSaved'));
    } catch {
      toast.error(t('periodReport.saveFailed'));
    }
  }

  const list = (branches.data || []).slice();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(compact && 'w-11 px-0 sm:w-auto sm:px-3', className)}
      >
        <IconFileText />
        {compact ? <span className="sr-only sm:not-sr-only">{t('periodReport.button')}</span> : t('periodReport.button')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('periodReport.title')}
        description={t('periodReport.description')}
        size="sm"
      >
        <div className="space-y-4">
          <Field label={t('periodReport.period')}>
            {() => (
              <SegmentedControl
                className="w-full"
                columns={3}
                label={t('periodReport.period')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'month', label: t('periodReport.month') },
                  { value: 'quarter', label: t('periodReport.quarter') },
                  { value: 'custom', label: t('periodReport.custom') },
                ]}
              />
            )}
          </Field>
          {mode === 'month' && (
            <Field label={t('periodReport.month')}>
              {(p) => (
                <Input
                  {...p}
                  type="month"
                  max={todayISO().slice(0, 7)}
                  value={monthValue}
                  onChange={(e) => setMonthValue(e.target.value)}
                />
              )}
            </Field>
          )}
          {mode === 'quarter' && (
            <Field label={t('periodReport.quarter')}>
              {(p) => (
                <Select {...p} value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                  {quarters.map((x) => {
                    const r = quarterRange(x);
                    return (
                      <option key={x} value={x}>
                        {periodLabel(r.from, r.to, t, lng)}
                      </option>
                    );
                  })}
                </Select>
              )}
            </Field>
          )}
          {mode === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('periodReport.from')}>
                {(p) => (
                  <DatePicker
                    {...p}
                    value={custom.from}
                    clearable={false}
                    onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                  />
                )}
              </Field>
              <Field label={t('periodReport.to')}>
                {(p) => (
                  <DatePicker
                    {...p}
                    value={custom.to}
                    clearable={false}
                    onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                  />
                )}
              </Field>
            </div>
          )}
          {!branchId && (
            <Field label={t('periodReport.scope')}>
              {(p) => (
                <Select {...p} value={branch} onChange={(e) => setBranch(e.target.value)}>
                  <option value="0">{t('periodReport.wholeGroup')}</option>
                  {list.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {branchName(b, lng)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={t('periodReport.recipient')} hint={t('periodReport.recipientHint')}>
            {(p) => (
              <Input
                {...p}
                maxLength={120}
                value={recipient}
                placeholder={t('campFile.toValue')}
                onChange={(e) => setRecipient(e.target.value)}
              />
            )}
          </Field>
          {user?.role === 'admin' && recipient.trim() && recipient.trim() !== (setting.data?.recipient || '') && (
            <Button type="button" variant="ghost" size="sm" onClick={saveDefault} className="-mt-2">
              {t('periodReport.saveDefault')}
            </Button>
          )}
          {!range && <p className="text-sm text-destructive">{t('periodReport.invalidPeriod')}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {range && (
              <Button variant="ghost" onClick={() => navigate(`/print/period/${id}?${query}`)}>
                {t('periodReport.preview')}
              </Button>
            )}
            {range && <ExportPdfButton kind="period" id={id} query={query} variant="brand" size="default" />}
          </div>
        </div>
      </Dialog>
    </>
  );
}
