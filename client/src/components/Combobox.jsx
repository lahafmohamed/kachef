import { useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from './shadcn/popover';
import { Input, cn } from './ui';

/**
 * Free-text field with a suggestion list — the shadcn replacement for
 * `<input list>` + `<datalist>`. Typing is never constrained to the list;
 * the suggestions only save keystrokes.
 */
export default function Combobox({ id, name, value, onChange, options = [], required, placeholder, className, ...props }) {
  const [open, setOpen] = useState(false);

  const query = String(value ?? '').trim().toLowerCase();
  const matches = options.filter((o) => !query || o.toLowerCase().includes(query));

  const emit = (v) => onChange?.({ target: { value: v, name, id } });

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
      >
        {matches.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => {
              emit(o);
              setOpen(false);
            }}
            className={cn(
              'focus-ring flex min-h-11 w-full items-center rounded-md px-2.5 py-2 text-start text-sm sm:min-h-9',
              'hover:bg-accent hover:text-accent-foreground',
              o === value && 'font-medium'
            )}
          >
            {o}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
