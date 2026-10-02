import { useTranslation } from 'react-i18next';
import { Button, IconX } from './ui';

/**
 * Every active filter of a list as a removable chip, so a filtered list never looks
 * like a bug to whoever opens the page next. A chip is `{ key, label?, value, clear,
 * isolate? }`: `label` names the filter, `value` is what the قائد picked, and
 * `isolate` keeps a Latin value (O+, a school, a number) in its own direction inside
 * an Arabic chip — ranges stay in the line's flow so they read low-to-high.
 */
export default function FilterChips({ chips, onClearAll }) {
  const { t } = useTranslation();
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          aria-label={t('common.removeFilter', { label: c.label ? `${c.label}: ${c.value}` : c.value })}
          className="focus-ring inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 ps-3 pe-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 sm:h-8"
        >
          <span className="max-w-72 truncate">
            {c.label && <span className="opacity-75">{c.label}: </span>}
            {c.isolate ? <bdi>{c.value}</bdi> : c.value}
          </span>
          <IconX className="h-3.5 w-3.5 opacity-70" />
        </button>
      ))}
      {chips.length > 1 && onClearAll && (
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          {t('common.clearFilters')}
        </Button>
      )}
    </div>
  );
}
