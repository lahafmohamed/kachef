import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ALL_PERM_KEYS,
  PERM_GROUPS,
  PERM_PRESET_KEYS,
  permHintKey,
  permLabelKey,
  presetPerms,
  withoutPerm,
  withPerm,
} from '../lib/perms';
import { Button, Label, cn, IconChevronDown, IconShield } from './ui';

// The ready-made set these rights are exactly, if any
function presetOf(perms) {
  const has = new Set(perms);
  return PERM_PRESET_KEYS.find((p) => {
    const keys = presetPerms(p);
    return keys.length === has.size && keys.every((k) => has.has(k));
  });
}

// The pages an account reaches: those where it holds at least one right
const grantedGroups = (perms) =>
  new Set(PERM_GROUPS.filter((g) => g.keys.some((k) => perms.includes(k))).map((g) => g.id));

/**
 * The ready-made sets as chips — the one the ticks are exactly is pressed — and what it
 * gives in one sentence, or that the ticks match none of them.
 */
export function PermPresets({ perms, onPick, label }) {
  const { t } = useTranslation();
  const hintId = useId();
  const preset = presetOf(perms);
  return (
    <>
      {/* Same gap and height as the فرق chips: 44px on a phone */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={label} aria-describedby={hintId}>
        {PERM_PRESET_KEYS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={preset === p}
            onClick={() => onPick(p)}
            className={cn(
              'focus-ring inline-flex min-h-11 items-center rounded-full border px-3 py-1.5 text-sm transition-colors sm:min-h-9',
              preset === p
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-input bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {t(`leader.preset_${p}`)}
          </button>
        ))}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t(`leader.presetHint_${preset || 'custom'}`)}
      </p>
    </>
  );
}

/**
 * The rights of an account, page by page: a ready-made set to start from, then each page
 * folded to its count — opened, one line per right with what it opens. A page's header
 * box ticks or unticks it all; the prerequisites follow (perms.js).
 * `presets={false}`: the sets are offered elsewhere in the form (PermPresets).
 * `openGranted` (a قائد's new account, from the قادة page): the pages the account reaches
 * start open, so every right it is given is in sight before saving.
 */
export default function PermsEditor({ perms, onChange, presets = true, openGranted = false }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(() => (openGranted ? grantedGroups(perms) : new Set()));
  const has = new Set(perms);
  const toggle = (key) => onChange(has.has(key) ? withoutPerm(perms, key) : withPerm(perms, key));
  function toggleGroup(g) {
    const all = g.keys.every((k) => has.has(k));
    onChange(all ? g.keys.reduce(withoutPerm, perms) : g.keys.reduce(withPerm, perms));
    // What was just given comes into sight
    if (openGranted && !all) setOpen((s) => new Set(s).add(g.id));
  }
  function applyPreset(p) {
    const keys = presetPerms(p);
    onChange(keys);
    if (openGranted) setOpen(grantedGroups(keys));
  }
  const flip = (id) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allOpen = open.size === PERM_GROUPS.length;

  return (
    <div className="space-y-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label>{t('admin.allowedPages')}</Label>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {t('admin.permCount', { count: has.size, total: ALL_PERM_KEYS.length })}
        </span>
        <p className="w-full text-xs text-muted-foreground">{t('admin.pagesHint')}</p>
      </div>

      {/* Start from a ready-made set, then adjust */}
      {presets && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">{t('admin.permPresets')}</p>
          <PermPresets perms={perms} onPick={applyPreset} label={t('admin.permPresets')} />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex justify-end">
          {/* A 44px target on a phone; the negative margin keeps the words on the cards' edge */}
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(PERM_GROUPS.map((g) => g.id)))}
            className="focus-ring -me-2 inline-flex min-h-11 items-center rounded-md px-2 text-xs font-medium text-primary hover:underline sm:min-h-9"
          >
            {t(allOpen ? 'admin.permCollapseAll' : 'admin.permExpandAll')}
          </button>
        </div>
        {PERM_GROUPS.map((g) => {
          const checked = g.keys.filter((k) => has.has(k)).length;
          const isOpen = open.has(g.id);
          const title = t(`admin.permGroup.${g.id}`);
          return (
            <div key={g.id} className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center gap-1 bg-muted/40 pe-1">
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 ps-3 text-sm font-semibold sm:min-h-10">
                  <input
                    type="checkbox"
                    checked={checked === g.keys.length}
                    ref={(el) => el && (el.indeterminate = checked > 0 && checked < g.keys.length)}
                    onChange={() => toggleGroup(g)}
                  />
                  <span className="min-w-0 flex-1">{title}</span>
                </label>
                <span className={cn('text-xs font-medium tabular-nums', checked ? 'text-primary' : 'text-muted-foreground')}>
                  {checked}/{g.keys.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-expanded={isOpen}
                  aria-controls={`perm-group-${g.id}`}
                  aria-label={t(isOpen ? 'admin.permCollapse' : 'admin.permExpand', { group: title })}
                  onClick={() => flip(g.id)}
                >
                  <IconChevronDown className={cn('transition-[rotate] duration-200', isOpen && 'rotate-180')} />
                </Button>
              </div>
              {/* One line per right, two columns from sm up. The key itself stays out of
                  sight — a hover title for whoever needs it */}
              {isOpen && (
                <div id={`perm-group-${g.id}`} className="grid grid-cols-1 gap-0.5 border-t border-border p-1.5 sm:grid-cols-2">
                  {g.keys.map((key) => {
                    const hint = i18n.exists(permHintKey(key)) ? t(permHintKey(key)) : null;
                    return (
                      <label
                        key={key}
                        title={key}
                        className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent/60 sm:min-h-9"
                      >
                        <input type="checkbox" className="mt-0.5" checked={has.has(key)} onChange={() => toggle(key)} />
                        <span className="min-w-0 flex-1 leading-snug">
                          {t(permLabelKey(key))}
                          {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <IconShield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t('admin.permAdminOnly')}</span>
      </p>
    </div>
  );
}
