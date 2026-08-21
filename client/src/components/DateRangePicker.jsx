import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { Button, IconArrow, IconCalendar, IconX, Skeleton, cn } from './ui';
import { fmtDate } from '../utils';
import { monthEnd, monthNames as monthNamesFor, monthStart, toDate, toISO } from '../lib/date';

const CalendarPanel = lazy(() => import('./CalendarPanel'));

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
  // Year the month grid is showing — starts on the year already filtered, else this one
  const [year, setYear] = useState(() =>
    value.from ? Number(value.from.slice(0, 4)) : new Date().getFullYear()
  );

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
      ? `${fmtDate(value.from)} – ${fmtDate(value.to)}`
      : value.from
        ? `${t('session.dateFrom')} ${fmtDate(value.from)}`
        : `${t('session.dateTo')} ${fmtDate(value.to)}`;

  const monthNames = monthNamesFor(isAr);

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
          {/* Month picker — "show me every نشاط of June" is one click, not two dates */}
          <div className="space-y-2 border-b border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t('session.byMonth')}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setYear((y) => y - 1)}
                  aria-label={t('session.previousYear')}
                >
                  <IconArrow className="rotate-180 rtl:rotate-0" />
                </Button>
                <span className="tabular-nums text-sm font-semibold" dir="ltr">
                  {year}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setYear((y) => y + 1)}
                  aria-label={t('session.nextYear')}
                >
                  <IconArrow className="rtl:rotate-180" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
              {Array.from({ length: 12 }, (_, m) => {
                const from = toISO(monthStart(year, m));
                const to = toISO(monthEnd(year, m));
                const active = value.from === from && value.to === to;
                return (
                  <Button
                    key={m}
                    variant={active ? 'brand' : 'ghost'}
                    size="sm"
                    className="px-1"
                    onClick={() => preset(monthStart(year, m), monthEnd(year, m))}
                  >
                    {monthNames[m]}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="p-2 sm:p-3">
            <Suspense fallback={<Skeleton className="h-72 w-full min-w-60" />}>
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
