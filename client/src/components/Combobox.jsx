import { useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from './shadcn/popover';
import { Input, cn } from './ui';

/**
 * Free-text field with a suggestion list — the shadcn replacement for
 * `<input list>` + `<datalist>`. Typing is never constrained to the list;
 * the suggestions only save keystrokes.
 *
 * An option is a plain string, or `{ value, label, hint, badge }` when the row
 * needs more than its text — `onPick` then receives the whole option, which is
 * how a caller recovers the id behind the label.
 */
export default function Combobox({
  id,
  name,
  value,
  onChange,
  onPick,
  options = [],
  required,
  placeholder,
  className,
  ...props
}) {
  const [open, setOpen] = useState(false);

  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const query = String(value ?? '').trim().toLowerCase();
  // Once the field holds an option verbatim the query would narrow the list to
  // that single row — show everything instead, so switching stays one tap away.
  const exact = items.some((o) => String(o.label).toLowerCase() === query);
  const matches =
    !query || exact
      ? items
      : items.filter((o) =>
          [o.label, o.hint].some((v) => String(v ?? '').toLowerCase().includes(query))
        );

  const emit = (v) => onChange?.({ target: { value: v, name, id } });

  function keepOpenOnField(e) {
    const target = e.detail?.originalEvent?.target ?? e.target;
    if (target instanceof Element && target.closest('[role="combobox"]')) e.preventDefault();
  }

  return (
    <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          name={name}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          className={className}
          value={value ?? ''}
          onChange={(e) => {
            emit(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          {...props}
        />
      </PopoverAnchor>
      <PopoverContent
        className="max-h-64 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"
        // Focus stays in the input so typing keeps filtering
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Clicking the field opens the list on focus, and that same click then reads
        // as an interaction outside the freshly mounted content — which would shut it
        // again. Events coming from the field itself are not a dismissal.
        onPointerDownOutside={keepOpenOnField}
        onFocusOutside={keepOpenOnField}
        onInteractOutside={keepOpenOnField}
      >
        {matches.map((o, i) => (
          <button
            key={o.key ?? `${o.value}-${i}`}
            type="button"
            onClick={() => {
              emit(o.value);
              onPick?.(o);
              setOpen(false);
            }}
            className={cn(
              'focus-ring flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm sm:min-h-9',
              'hover:bg-accent hover:text-accent-foreground',
              o.value === value && 'font-medium'
            )}
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.badge && (
              <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">
                {o.badge}
              </span>
            )}
            {o.hint && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.hint}</span>
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
