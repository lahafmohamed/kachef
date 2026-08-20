import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { cn, IconCheck, IconChevronDown, IconPlus, IconSearch, Input, Spinner } from './ui';

/**
 * Dropdown constrained to a curated list, with a search box — for lists too long
 * to scan (quartiers, écoles). Unlike `Combobox`, typing filters the list but
 * never becomes the value: that is the point, a مكان السكن spelled two ways
 * splits the same people across two filters.
 *
 * `options` is either a flat array of strings or `{value, label}` objects — the
 * second form is what a picker over ids (a قائد, a فرقة) needs. `onChange` receives
 * a native-looking event so call sites keep their `set('field')` handlers.
 *
 * `onCreate` turns the list into a curated-but-extensible one: when what was typed
 * is nowhere in it, a last row offers to add it. The list stays the authority on
 * spelling — the new entry joins it instead of becoming loose free text.
 */
export default function SearchSelect({
  id,
  name,
  value,
  onChange,
  options = [],
  placeholder,
  searchPlaceholder,
  emptyLabel,
  // When set, a first row clears the field (form) or drops the filter (list)
  clearLabel,
  // async (label) => the stored label, or null when it could not be created
  onCreate,
  // string, or (typed) => string
  createLabel,
  icon,
  className,
  disabled,
  required,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const listRef = useRef(null);

  const current = value == null ? '' : String(value);

  const normalized = useMemo(
    () => options.map((o) => (typeof o === 'object' && o !== null ? { value: String(o.value), label: o.label } : { value: o, label: o })),
    [options]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? normalized.filter((o) => String(o.label).toLowerCase().includes(q)) : normalized;
    // The clear row is an escape hatch, not a search result: it hides while filtering
    const head = clearLabel && !q ? [{ value: '', label: clearLabel }] : [];
    return [...head, ...matches];
  }, [normalized, query, clearLabel]);

  // An id shown raw means nothing: fall back to the value itself only when it is
  // its own label (a school, a quartier) or no longer in the list
  const currentLabel = normalized.find((o) => o.value === current)?.label ?? current;

  // A fresh search starts on the first row; reopening starts from a clean query
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => {
    setActive(0);
  }, [query, open]);

  // Keyboard navigation is useless if the highlighted row is off-screen
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, rows.length]);

  // Adding is offered only for something the list does not already hold, whatever
  // the casing — otherwise "Zone 4" and "zone 4" would both look creatable.
  const typed = query.trim();
  const canCreate =
    !!onCreate &&
    !!typed &&
    !normalized.some((o) => String(o.label).toLowerCase() === typed.toLowerCase());

  function select(v) {
    onChange?.({ target: { value: v, name, id } });
    setOpen(false);
  }

  // The new entry is picked straight away: the قائد typed it to use it
  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const label = await onCreate(typed);
      if (label) select(label);
      else setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Nothing matched what was typed: Enter is the shortcut for adding it
      if (rows[active]) select(rows[active].value);
      else if (canCreate) create();
    } else if (e.key === 'Escape') {
      // Stop here or the surrounding Dialog closes with the popover
      e.stopPropagation();
      setOpen(false);
    }
  }

  const trigger = (
    <PopoverTrigger
      id={id}
      type="button"
      disabled={disabled}
      role="combobox"
      aria-expanded={open}
      aria-label={ariaLabel}
      className={cn(
        'focus-ring flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3.5 text-sm shadow-xs',
        'transition-colors hover:border-input/70 hover:bg-card disabled:cursor-not-allowed disabled:opacity-50 sm:h-10',
        className
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className={cn('truncate', !current && 'text-muted-foreground')}>
          {current ? currentLabel : placeholder}
        </span>
      </span>
      <IconChevronDown className="shrink-0 opacity-50" />
    </PopoverTrigger>
  );

  return (
    <div className={cn('relative', required && 'w-full')}>
      <Popover open={open} onOpenChange={setOpen}>
        {trigger}
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-56 p-2"
          onOpenAutoFocus={(e) => {
            // Land in the search box, not on the first row
            e.preventDefault();
            e.currentTarget.querySelector('input')?.focus();
          }}
        >
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              autoComplete="off"
              className="h-10 ps-9"
            />
          </div>
          <div ref={listRef} role="listbox" className="mt-1.5 max-h-60 overflow-y-auto">
            {rows.length === 0 ? (
              !canCreate && (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
              )
            ) : (
              rows.map((r, i) => (
                <button
                  key={r.value || '__clear__'}
                  type="button"
                  role="option"
                  aria-selected={r.value === current}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => select(r.value)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-start text-sm sm:min-h-9',
                    i === active && 'bg-accent text-accent-foreground',
                    !r.value && 'text-muted-foreground'
                  )}
                >
                  <span className="truncate">{r.label}</span>
                  {r.value === current && r.value !== '' && (
                    <IconCheck className="shrink-0 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>

          {canCreate && (
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className={cn(
                'focus-ring mt-1.5 flex min-h-11 w-full items-center gap-2 rounded-md border-t border-border px-2.5 py-2',
                'text-start text-sm font-medium text-primary hover:bg-accent disabled:opacity-60 sm:min-h-9'
              )}
            >
              {creating ? <Spinner className="shrink-0" /> : <IconPlus className="shrink-0" />}
              <span className="truncate">
                {typeof createLabel === 'function' ? createLabel(typed) : createLabel}
              </span>
            </button>
          )}
        </PopoverContent>
      </Popover>

      {/* Required needs a real control the browser can point its message at */}
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
