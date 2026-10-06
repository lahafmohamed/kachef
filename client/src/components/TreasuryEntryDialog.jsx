import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { fmtAmount, fmtDate, todayISO } from '../utils';
import { IN_CATEGORIES, OUT_CATEGORIES, boxName } from '../lib/treasury';
import AmountInput from './AmountInput';
import DatePicker from './DatePicker';
import { Button, Dialog, Input, Label, SegmentedControl, Select, useConfirm, useToast, IconTrash } from './ui';

const EMPTY = {
  category: '',
  label: '',
  amount: '',
  date: '',
  box: '',
  paid: true,
  paid_on: '',
  owed_to: '',
};

/**
 * One line of the الصندوق: a مصروف (what it is, how much, which kind, which day) or an
 * تبرّع / مدخول آخر (how much, which day, a note). Opened from the الصندوق page
 * (`endpoint` = /treasury/entries) and from a نشاط's expenses card (`endpoint` =
 * /sessions/:id/expenses, the day defaulting to the نشاط's). `onSaved(response, toastKey)`.
 *
 * `boxes` (the الصندوق page only): the caisses the line can go in — the فوج's and the
 * فرق's the قائد holds — `defaultBox` the one on screen. A نشاط's مصروف needs no such
 * question: it goes out of its نشاط's فرقة's. `openings` ({ box: day }): a day before
 * the box's opening is kept but not counted — said before saving.
 *
 * `donationOnly`: a نشاط's donations card (`endpoint` = /sessions/:id/donations) — an
 * تبرّع, so no question of its kind, and it is named a don throughout.
 *
 * A مصروف is paid, or not yet: a قائد advanced it or a shop gave credit, and the box
 * only goes down the day it is settled. Once it has been owed, it keeps who it was
 * owed to and says on which day it was paid.
 */
export default function TreasuryEntryDialog({
  open,
  onClose,
  onSaved,
  direction,
  entry = null,
  endpoint,
  defaultDate,
  openings = null,
  boxes = null,
  defaultBox = null,
  bothSections = false,
  donationOnly = false,
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Owed at some point: who to pay stays on screen, and paying it asks on which day
  const [wasOwed, setWasOwed] = useState(false);
  const out = direction === 'out';
  // How the line is named in its title, toasts and confirmation
  const noun = out ? 'expense' : donationOnly ? 'donation' : 'income';
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setWasOwed(!!entry?.owed_to);
    setForm(
      entry
        ? {
            category: entry.category,
            label: entry.label || '',
            amount: String(entry.amount),
            date: entry.spent_on ?? entry.date,
            box: entry.box || '',
            paid: !!entry.paid_on,
            paid_on: entry.paid_on || '',
            owed_to: entry.owed_to || '',
          }
        : { ...EMPTY, category: out ? 'other' : 'donation', date: defaultDate || todayISO(), box: defaultBox || '' }
    );
  }, [open, entry, out, defaultDate, defaultBox]);

  const donation = !out && form.category === 'donation';
  const showOwedTo = out && (!form.paid || wasOwed);
  const showPaidOn = out && form.paid && wasOwed;
  // The day the money leaves (or enters) the box — none while it is still owed
  const cashDate = !out ? form.date : !form.paid ? null : showPaidOn ? form.paid_on : form.date;
  const openingDate = openings?.[form.box] ?? null;
  // Which caisse: asked when there is a choice; a نشاط's مصروف is already its فرقة's
  const boxChoices = boxes && boxes.length > 1 && !entry?.session_id ? boxes : null;
  const beforeOpening = openingDate && cashDate && cashDate < openingDate;

  function setPaid(v) {
    const paid = v === 'paid';
    if (!paid) setWasOwed(true);
    // Settling a debt: paid today unless told otherwise
    setForm((f) => ({ ...f, paid, paid_on: paid && !f.paid_on ? todayISO() : f.paid_on }));
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        direction,
        category: form.category,
        label: form.label.trim() || null,
        amount: Number(form.amount),
        date: form.date,
        ...(out
          ? {
              paid: form.paid,
              paid_on: showPaidOn ? form.paid_on : null,
              owed_to: showOwedTo ? form.owed_to.trim() || null : null,
            }
          : {}),
        ...(boxes && !entry?.session_id ? { box: form.box } : {}),
      };
      const res = entry ? await api.put(`${endpoint}/${entry.id}`, body) : await api.post(endpoint, body);
      onSaved(res, `treasury.${noun}${entry ? 'Updated' : 'Added'}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const amount = fmtAmount(entry.amount);
    if (
      !(await confirm({
        title: t(out ? 'treasury.editExpense' : donationOnly ? 'treasury.editDonation' : 'treasury.editIncome'),
        message: out
          ? t('treasury.deleteExpenseConfirm', { label: entry.label, amount })
          : t(donationOnly ? 'treasury.deleteDonationConfirm' : 'treasury.deleteIncomeConfirm', { amount }),
        confirmLabel: t('common.delete'),
      }))
    )
      return;
    try {
      onSaved(await api.del(`${endpoint}/${entry.id}`), `treasury.${noun}Deleted`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const title = out
    ? t(entry ? 'treasury.editExpense' : 'treasury.addExpense')
    : donationOnly
      ? t(entry ? 'treasury.editDonation' : 'treasury.addDonation')
      : t(entry ? 'treasury.editIncome' : 'treasury.newIncome');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex items-center justify-between gap-2">
          {entry ? (
            <Button variant="destructive-ghost" onClick={remove}>
              <IconTrash />
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="treasury-entry-form" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="treasury-entry-form" onSubmit={save} className="space-y-4">
        {boxChoices && (
          <div className="space-y-1.5">
            <Label htmlFor="tx_box">{t('treasury.box')}</Label>
            <Select id="tx_box" value={form.box} onChange={set('box')}>
              {boxChoices.map((b) => (
                <option key={b.key} value={b.key}>
                  {boxName(b, t, i18n.language, { both: bothSections, short: true })}
                </option>
              ))}
            </Select>
          </div>
        )}
        {!out && !donationOnly && (
          <div className="space-y-1.5">
            <Label>{t('treasury.incomeType')}</Label>
            <SegmentedControl
              label={t('treasury.incomeType')}
              value={form.category}
              onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              options={IN_CATEGORIES.map((c) => ({ value: c, label: t(`treasury.type_${c}`) }))}
              className="flex w-full"
            />
          </div>
        )}
        {/* What a مصروف is comes first: it is the one thing the قائد is asked to say */}
        {out && (
          <div className="space-y-1.5">
            <Label htmlFor="tx_label">{t('treasury.expenseLabel')}</Label>
            <Input
              id="tx_label"
              required
              maxLength={200}
              autoComplete="off"
              placeholder={t('treasury.expenseLabelHint')}
              value={form.label}
              onChange={set('label')}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="tx_amount">{t('treasury.amount')}</Label>
            <AmountInput
              id="tx_amount"
              required
              value={form.amount}
              onChange={set('amount')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx_date">{t('common.date')}</Label>
            <DatePicker id="tx_date" required clearable={false} value={form.date} onChange={set('date')} />
          </div>
          {out && (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="tx_cat">{t('treasury.category')}</Label>
              <Select id="tx_cat" value={form.category} onChange={set('category')}>
                {OUT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`treasury.cat_${c}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {out && (
            <div className="col-span-2 space-y-1.5">
              <Label>{t('treasury.paymentStatus')}</Label>
              <SegmentedControl
                label={t('treasury.paymentStatus')}
                value={form.paid ? 'paid' : 'owed'}
                onChange={setPaid}
                options={[
                  { value: 'paid', label: t('treasury.statusPaid') },
                  { value: 'owed', label: t('treasury.statusOwed') },
                ]}
                className="flex w-full"
              />
            </div>
          )}
          {showOwedTo && (
            <div className={showPaidOn ? 'space-y-1.5' : 'col-span-2 space-y-1.5'}>
              <Label htmlFor="tx_owed">{t(form.paid ? 'treasury.paidTo' : 'treasury.owedTo')}</Label>
              <Input
                id="tx_owed"
                required={!form.paid}
                maxLength={120}
                autoComplete="off"
                placeholder={t('treasury.owedToHint')}
                value={form.owed_to}
                onChange={set('owed_to')}
              />
            </div>
          )}
          {showPaidOn && (
            <div className="space-y-1.5">
              <Label htmlFor="tx_paid_on">{t('treasury.paidOn')}</Label>
              <DatePicker id="tx_paid_on" required clearable={false} value={form.paid_on} onChange={set('paid_on')} />
            </div>
          )}
        </div>
        {out && !form.paid && <p className="text-xs text-muted-foreground">{t('treasury.owedHint')}</p>}
        {!out && (
          <div className="space-y-1.5">
            <Label htmlFor="tx_label">{t(donation ? 'treasury.donationNote' : 'treasury.incomeLabel')}</Label>
            <Input
              id="tx_label"
              required={!donation}
              maxLength={200}
              autoComplete="off"
              placeholder={t(donation ? 'treasury.donationNoteHint' : 'treasury.incomeLabelHint')}
              value={form.label}
              onChange={set('label')}
            />
          </div>
        )}
        {donation && <p className="text-xs text-muted-foreground">{t('treasury.donationAnon')}</p>}
        {beforeOpening && (
          <p className="text-sm font-medium text-warning">
            {t('treasury.beforeOpening', { date: fmtDate(openingDate) })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
