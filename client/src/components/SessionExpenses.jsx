import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtAmount, fmtDate } from '../utils';
import TreasuryEntryDialog from './TreasuryEntryDialog';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useToast,
  IconHandHeart,
  IconPlus,
  IconReceipt,
} from './ui';

/**
 * The frame both money cards of a نشاط share: a title with the total, a hint while
 * empty, the add button, then one line per entry — a button that opens it for
 * correction when the قائد writes here.
 */
function EntriesCard({ title, total, hint, empty, note, addLabel, canWrite, onAdd, children }) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle>
            {title}
            {!empty && <span className="ms-2 font-normal tabular-nums text-muted-foreground">{fmtAmount(total)}</span>}
          </CardTitle>
          {empty && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
          {note}
        </div>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={onAdd} className="w-full sm:w-auto">
            <IconPlus />
            {addLabel}
          </Button>
        )}
      </CardHeader>
      {!empty && (
        <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
          <ul className="divide-y divide-border border-t border-border">{children}</ul>
        </CardContent>
      )}
    </Card>
  );
}

function EntryLine({ canWrite, onOpen, label, children }) {
  return (
    <li>
      {canWrite ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={label}
          className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/40 focus-visible:[outline-offset:-2px]! sm:px-5"
        >
          {children}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{children}</div>
      )}
    </li>
  );
}

/**
 * مصاريف النشاط: what was bought for this نشاط (ضيافة، مواد…). Each line goes out of
 * the الصندوق of the نشاط's قسم. Shown to whoever sees amounts; written by whoever
 * records payments here, or by the أمين المال. Quiet while empty: one line and a
 * button, at the foot of the page, out of the way of the présence. A مصروف not paid
 * yet (advanced by a قائد, bought on credit) counts in the نشاط's cost, not in the box.
 */
export default function SessionExpenses({ session, onChange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  const list = session.expenses || [];
  const canWrite = !!session.can_write_expenses;
  const total = list.reduce((n, x) => n + x.amount, 0);
  const owed = list.reduce((n, x) => n + (x.paid_on ? 0 : x.amount), 0);

  return (
    <>
      <EntriesCard
        title={t('treasury.sessionExpenses')}
        total={total}
        empty={list.length === 0}
        hint={t('treasury.sessionExpensesHint')}
        note={
          owed > 0 && (
            <p className="mt-1 text-sm font-medium text-warning">{t('treasury.sessionOwed', { amount: fmtAmount(owed) })}</p>
          )
        }
        addLabel={t('treasury.addExpense')}
        canWrite={canWrite}
        onAdd={() => setDialog({ entry: null })}
      >
        {list.map((x) => {
          // The day only when it is not the نشاط's own: bought ahead, or paid later
          const meta = [
            x.owed_to && t(x.paid_on ? 'treasury.paidRowTo' : 'treasury.owedRowTo', { name: x.owed_to }),
            t(`treasury.cat_${x.category}`),
            x.spent_on !== session.date && fmtDate(x.spent_on),
            x.created_by && t('treasury.recordedBy', { name: x.created_by }),
          ].filter(Boolean);
          return (
            <EntryLine
              key={x.id}
              canWrite={canWrite}
              onOpen={() => setDialog({ entry: x })}
              label={`${t('common.edit')} — ${x.label} ${fmtAmount(x.amount)}`}
            >
              <IconReceipt className={x.paid_on ? 'text-muted-foreground' : 'text-warning'} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{x.label}</span>
                  {!x.paid_on && <Badge variant="warning">{t('treasury.statusOwed')}</Badge>}
                </span>
                <span className="block text-xs text-muted-foreground">{meta.join(' · ')}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{fmtAmount(x.amount)}</span>
            </EntryLine>
          );
        })}
      </EntriesCard>
      {canWrite && (
        <TreasuryEntryDialog
          open={!!dialog}
          onClose={() => setDialog(null)}
          direction="out"
          entry={dialog?.entry ?? null}
          endpoint={`/sessions/${session.id}/expenses`}
          defaultDate={session.date}
          onSaved={(res, key) => {
            setDialog(null);
            onChange(res.expenses);
            toast.success(t(key));
          }}
        />
      )}
    </>
  );
}

/**
 * التبرعات: what someone gave during this نشاط. It goes into the box of the نشاط's
 * فرقة, as its expenses come out of it — without the donor's name, as on a camp. Same
 * readers and writers as the expenses.
 */
export function SessionDonations({ session, onChange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  const list = session.donations || [];
  const canWrite = !!session.can_write_expenses;
  const total = list.reduce((n, x) => n + x.amount, 0);

  return (
    <>
      <EntriesCard
        title={t('treasury.sessionDonations')}
        total={total}
        empty={list.length === 0}
        hint={t('treasury.sessionDonationsHint')}
        addLabel={t('treasury.addDonation')}
        canWrite={canWrite}
        onAdd={() => setDialog({ entry: null })}
      >
        {list.map((x) => {
          // A note says what the don was for; without one, the line is simply «Don»
          const title = x.label || t(x.category === 'donation' ? 'treasury.donation' : 'treasury.otherIncome');
          const meta = [
            x.label && t(`treasury.type_${x.category}`),
            x.date !== session.date && fmtDate(x.date),
            x.created_by && t('treasury.recordedBy', { name: x.created_by }),
          ].filter(Boolean);
          return (
            <EntryLine
              key={x.id}
              canWrite={canWrite}
              onOpen={() => setDialog({ entry: x })}
              label={`${t('common.edit')} — ${title} ${fmtAmount(x.amount)}`}
            >
              <IconHandHeart className="text-success" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{title}</span>
                {meta.length > 0 && <span className="block text-xs text-muted-foreground">{meta.join(' · ')}</span>}
              </span>
              <span dir="ltr" className="shrink-0 font-semibold tabular-nums text-success">
                +{fmtAmount(x.amount)}
              </span>
            </EntryLine>
          );
        })}
      </EntriesCard>
      {canWrite && (
        <TreasuryEntryDialog
          open={!!dialog}
          onClose={() => setDialog(null)}
          direction="in"
          donationOnly
          entry={dialog?.entry ?? null}
          endpoint={`/sessions/${session.id}/donations`}
          defaultDate={session.date}
          onSaved={(res, key) => {
            setDialog(null);
            onChange(res.donations);
            toast.success(t(key));
          }}
        />
      )}
    </>
  );
}
