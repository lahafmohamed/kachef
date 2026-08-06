import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSearch, IconX, cn } from './ui';

/**
 * Search field in the shadcn idiom: leading icon, clear affordance, and a
 * ⌘K / Ctrl+K hint that actually focuses the input — so filtering a long list
 * never requires reaching for the mouse.
 */
export default function SearchInput({ value, onChange, placeholder, className, autoFocusHotkey = true }) {
  const { t } = useTranslation();
  const ref = useRef(null);

  useEffect(() => {
    if (!autoFocusHotkey) return;
    function onKeyDown(e) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [autoFocusHotkey]);

  return (
    <div className={cn('relative flex-1', className)}>
      <IconSearch className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        // Escape clears without leaving the keyboard
        onKeyDown={(e) => e.key === 'Escape' && value && (e.preventDefault(), onChange(''))}
        className={cn(
          'focus-ring h-11 w-full rounded-md border border-input bg-card ps-9 pe-20 text-sm shadow-xs',
          'transition-colors placeholder:text-muted-foreground focus-visible:border-ring sm:h-10',
          '[&::-webkit-search-cancel-button]:hidden'
        )}
      />
      <div className="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('common.clear')}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <IconX />
          </button>
        ) : (
          <kbd className="pointer-events-none hidden select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[0.65rem] font-medium text-muted-foreground sm:flex">
            <span>{/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'}</span>K
          </kbd>
        )}
      </div>
    </div>
  );
}
