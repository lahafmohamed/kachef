import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { Button, IconCalendar, IconX, Skeleton, cn } from './ui';
import { fmtDate } from '../utils';

const CalendarPanel = lazy(() => import('./CalendarPanel'));

/* ISO <-> Date, anchored at local noon so a timezone offset can never shift
   the calendar by a day. */
const toDate = (iso) => (iso ? new Date(`${iso}T12:00:00`) : undefined);
const toISO = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

function shiftDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Range date filter: shadcn Popover + react-day-picker range calendar,
 * with quick presets because "last 7 / 30 days" is what leaders actually want.
 *
 * @param value {{from: string, to: string}} ISO dates ('' = open ended)
 * @param onChange called with the same shape
 */
export default function DateRangePicker({ value, onChange, className }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const isAr = i18n.language === 'ar';

  const selected = { from: toDate(value.from), to: toDate(value.to) };
  const hasRange = !!(value.from || value.to);

  function apply(range) {
    onChange({ from: toISO(range?.from), to: toISO(range?.to) });
  }

  function preset(from, to) {
    onChange({ from: toISO(from), to: toISO(to) });
    setOpen(false);
  }

  const label = !hasRange
    ? t('session.anyDate')
    : value.from && value.to
      ? `${fmtDate(value.from)} → ${fmtDate(value.to)}`
      : value.from
        ? `${t('session.dateFrom')} ${fmtDate(value.from)}`
        : `${t('session.dateTo')} ${fmtDate(value.to)}`;

  const presets = [
    { key: 'last7', from: shiftDays(-6), to: new Date() },
    { key: 'last30', from: shiftDays(-29), to: new Date() },
    {
      key: 'thisMonth',
      from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      to: new Date(),
    },
  ];

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn('w-full justify-start gap-2 font-normal sm:w-auto', !hasRange && 'text-muted-foreground')}
            aria-label={t('session.dateRange')}
          >
            <IconCalendar />
            <span className="truncate" dir={hasRange ? 'ltr' : undefined}>
              {label}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <div className="flex flex-wrap gap-1.5 border-b border-border p-2">
            {presets.map((p) => (
              <Button key={p.key} variant="secondary" size="sm" onClick={() => preset(p.from, p.to)}>
                {t(`session.${p.key}`)}
              </Button>
            ))}
            {hasRange && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange({ from: '', to: '' });
                  setOpen(false);
                }}
              >
                {t('session.anyDate')}
              </Button>
            )}
          </div>
          <div className="p-3">
            <Suspense fallback={<Skeleton className="h-72 w-72" />}>
              <CalendarPanel
                mode="range"
                isAr={isAr}
                defaultMonth={selected.from || new Date()}
                selected={hasRange ? selected : undefined}
                onSelect={apply}
              />
            </Suspense>
          </div>
        </PopoverContent>
      </Popover>

      {hasRange && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onChange({ from: '', to: '' })}
          aria-label={t('common.clear')}
        >
          <IconX />
        </Button>
      )}
    </div>
  );
}
