import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { Button, IconCalendar, IconX, Select, Skeleton, cn, fieldBase } from './ui';
import { monthNames, toDate, toISO } from '../lib/date';
import { fmtDate } from '../utils';

const CalendarPanel = lazy(() => import('./CalendarPanel'));

/**
 * Single date field: shadcn Popover + react-day-picker, with month/year
 * dropdowns because birth dates are decades back and arrow-stepping is cruel.
 *
 * Speaks the native input API — `value` is an ISO date ('' = empty) and
 * `onChange` gets `{ target: { value } }` — so it drops into existing forms.
 */
export default function DatePicker({
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  className,
  clearable = true,
  fromYear,
  toYear,
  ...props
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [open, setOpen] = useState(false);
  const thisYear = new Date().getFullYear();
  const first = fromYear ?? thisYear - 90;
  const last = toYear ?? thisYear + 5;

  const selected = toDate(value);
  const [month, setMonth] = useState(() => selected || new Date());
  // Follow the field when it is set from outside (edit form loading a record)
  useEffect(() => {
    const d = toDate(value);
    if (d) setMonth(d);
  }, [value]);

  const emit = (iso) => onChange?.({ target: { value: iso, name, id } });
  const months = monthNames(isAr);
  const years = Array.from({ length: last - first + 1 }, (_, i) => last - i);

  /* The month/year listboxes portal outside the popover, so their clicks read as
     "outside" and would close it. Keep the popover open for those. */
  function keepOpenForSelect(e) {
    const target = e.detail?.originalEvent?.target ?? e.target;
    if (target instanceof Element && target.closest('[data-radix-select-viewport]')) e.preventDefault();
  }

  function pick(d) {
    if (!d) return;
    emit(toISO(d));
    setOpen(false);
  }

  return (
    <div className={cn('relative', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            className={cn(
              fieldBase,
              'items-center justify-between gap-2 text-start',
              !value && 'text-muted-foreground'
            )}
            {...props}
          >
            <span className="flex min-w-0 items-center gap-2">
              <IconCalendar className="text-muted-foreground" />
              <span className="truncate" dir={value ? 'ltr' : undefined}>
                {value ? fmtDate(value) : t('common.pickDate')}
              </span>
            </span>
            {clearable && value && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={t('common.clear')}
                className="-me-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground sm:h-8 sm:w-8"
                onPointerDown={(e) => {
                  // Stop the popover from opening — this click only clears
                  e.preventDefault();
                  e.stopPropagation();
                  emit('');
                }}
              >
                <IconX />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0"
          onPointerDownOutside={keepOpenForSelect}
          onFocusOutside={keepOpenForSelect}
          onInteractOutside={keepOpenForSelect}
        >
          <div className="flex items-center gap-2 border-b border-border p-2">
            <Select
              value={String(month.getMonth())}
              onChange={(e) => setMonth(new Date(month.getFullYear(), Number(e.target.value), 1))}
              aria-label={t('common.month')}
              className="h-10 flex-1 sm:h-9"
            >
              {months.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </Select>
            <Select
              value={String(month.getFullYear())}
              onChange={(e) => setMonth(new Date(Number(e.target.value), month.getMonth(), 1))}
              aria-label={t('common.year')}
              className="h-10 w-24 sm:h-9 sm:w-28"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div className="p-2 sm:p-3">
            <Suspense fallback={<Skeleton className="h-72 w-full min-w-60" />}>
              <CalendarPanel
                mode="single"
                isAr={isAr}
                month={month}
                onMonthChange={setMonth}
                selected={selected}
                onSelect={pick}
                startMonth={new Date(first, 0, 1)}
                endMonth={new Date(last, 11, 31)}
              />
            </Suspense>
          </div>
          <div className="flex justify-between gap-2 border-t border-border p-2">
            <Button variant="secondary" size="sm" onClick={() => pick(new Date())}>
              {t('common.today')}
            </Button>
            {clearable && value && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  emit('');
                  setOpen(false);
                }}
              >
                {t('common.clear')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Keeps native form validation working — the trigger is a button, not a field */}
      {required && (
        <input
          tabIndex={-1}
          required
          aria-hidden="true"
          value={value || ''}
          onChange={() => {}}
          className="pointer-events-none absolute bottom-0 start-3 h-0 w-0 opacity-0"
        />
      )}
    </div>
  );
}
