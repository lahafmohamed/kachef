import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { Button, IconClock, IconX, cn, fieldBase } from './ui';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Time field: shadcn Popover with two scroll columns (hours / minutes).
 * Two columns of buttons rather than nested listboxes — one tap per unit and
 * nothing portals on top of the popover.
 *
 * Speaks the native input API — `value` is 'HH:MM' ('' = empty) and `onChange`
 * gets `{ target: { value } }`.
 */
export default function TimePicker({
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  className,
  minuteStep = 5,
  ...props
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const current = value ? String(value).slice(0, 5) : '';
  const [h, m] = current ? current.split(':') : ['', ''];

  const hours = Array.from({ length: 24 }, (_, i) => pad(i));
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => pad(i * minuteStep));
  // An odd minute coming from the server still needs a row of its own
  if (m && !minutes.includes(m)) minutes.push(m);
  minutes.sort();

  const emit = (v) => onChange?.({ target: { value: v, name, id } });
  const setHour = (nh) => emit(`${nh}:${m || '00'}`);
  const setMinute = (nm) => emit(`${h || '00'}:${nm}`);

  const column = (items, selectedValue, onPick, label) => (
    <div className="flex max-h-56 flex-col gap-1 overflow-y-auto p-1" role="listbox" aria-label={label}>
      {items.map((v) => (
        <button
          key={v}
          type="button"
          role="option"
          aria-selected={v === selectedValue}
          onClick={() => onPick(v)}
          className={cn(
            'focus-ring flex h-9 w-14 shrink-0 items-center justify-center rounded-md text-sm tabular-nums transition-colors',
            v === selectedValue
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent hover:text-accent-foreground'
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );

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
              !current && 'text-muted-foreground'
            )}
            {...props}
          >
            <span className="flex min-w-0 items-center gap-2">
              <IconClock className="text-muted-foreground" />
              <span className="truncate tabular-nums" dir={current ? 'ltr' : undefined}>
                {current || t('common.pickTime')}
              </span>
            </span>
            {current && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={t('common.clear')}
                className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
                onPointerDown={(e) => {
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
        <PopoverContent className="w-auto p-0">
          <div className="flex divide-x divide-border rtl:divide-x-reverse">
            {column(hours, h, setHour, t('common.hour'))}
            {column(minutes, m, setMinute, t('common.minute'))}
          </div>
          <div className="flex justify-end border-t border-border p-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('common.done')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {required && (
        <input
          tabIndex={-1}
          required
          aria-hidden="true"
          value={current}
          onChange={() => {}}
          className="pointer-events-none absolute bottom-0 start-3 h-0 w-0 opacity-0"
        />
      )}
    </div>
  );
}
