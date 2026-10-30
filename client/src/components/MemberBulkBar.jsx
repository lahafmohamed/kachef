import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import {
  Button,
  cn,
  useConfirm,
  useToast,
  IconArchive,
  IconChevronDown,
  IconClipboard,
  IconTrash,
  IconUsers,
  IconX,
} from './ui';

/**
 * The native box in a 44px hit area — at 18px it is no target for a thumb. The
 * negative margin hands the extra room back, so the row keeps its rhythm.
 * (Same box as the ترفيعات list.)
 */
export function PickBox({ checked, indeterminate = false, onChange, label, className }) {
  return (
    <label className={cn('-m-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center', className)}>
      <input
        type="checkbox"
        checked={checked}
        // «Some picked» exists only as a DOM property, never as an attribute
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        onChange={onChange}
        aria-label={label}
      />
    </label>
  );
}

// Copy, with the old textarea trick where the Clipboard API is missing (plain http, old WebView)
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy');
}

/**
 * العناصر المؤشَّرون في القائمة: شريط يلتصق بالأسفل، فوق شريط التنقّل في الهاتف — كشريط
 * الترفيعات. Each action shows only for who may do it:
 * - `groups` (the one filtered فرقة's طلائع) + `branchId`: «Affecter à une طليعة», or none
 * - `canArchive`: archive, after a confirm
 * - `canPurge` (admin): when every one picked is already archived, archiving gives way to
 *   deleting for good — after typing how many
 * - `canCopy`: the parents' numbers, one per line, to paste in a WhatsApp group
 * `onDone(kind)` runs after a change on the server, so the page reloads quietly.
 */
export default function MemberBulkBar({ members, branchId, groups, canArchive, canPurge, canCopy, onClear, onDone }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null); // null | 'assign' | 'archive' | 'purge'
  const [menuOpen, setMenuOpen] = useState(false);
  const ids = members.map((m) => m.id);
  const count = ids.length;
  const allArchived = count > 0 && members.every((m) => m.status !== 'active');

  async function assign(groupId) {
    setMenuOpen(false);
    setBusy('assign');
    try {
      const res = await api.post(`/branches/${branchId}/groups/assign`, { member_ids: ids, group_id: groupId });
      toast.success(t('member.bulkAssigned', { count: res.assigned }));
      onDone('assign');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    if (
      !(await confirm({
        title: t('member.bulkArchive'),
        message: t('member.bulkArchiveConfirm', { count }),
        confirmLabel: t('member.bulkArchive'),
      }))
    )
      return;
    setBusy('archive');
    try {
      const res = await api.post('/members/archive', { member_ids: ids });
      toast.success(t('member.bulkArchived', { count: res.archived }));
      onDone('archive');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function purge() {
    const ok = await confirm({
      title: t('member.purge'),
      message: t('member.bulkPurgeConfirm', { count }),
      typeToConfirm: String(count),
      typeLabel: t('member.bulkPurgeType', { count }),
      confirmLabel: t('member.purge'),
    });
    if (!ok) return;
    setBusy('purge');
    try {
      const res = await api.post('/members/purge', { member_ids: ids });
      toast.success(t('member.purged', { count: res.deleted }));
      onDone('purge');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function copyPhones() {
    // Le même numéro pour deux frères n'est copié qu'une fois
    const numbers = [
      ...new Set(
        members.flatMap((m) => [m.father_phone, m.mother_phone]).map((p) => String(p || '').trim()).filter(Boolean)
      ),
    ];
    if (!numbers.length) {
      toast.error(t('member.bulkNoPhones'));
      return;
    }
    try {
      await copyText(numbers.join('\n'));
      toast.success(t('member.bulkCopied', { count: numbers.length }));
    } catch {
      toast.error(t('member.bulkCopyFailed'));
    }
  }

  const canAssign = !!branchId && groups?.length > 0;

  return (
    <div className="glass animate-fade-up sticky bottom-[var(--bottomnav-h)] z-10 flex items-center gap-1.5 rounded-2xl border border-border py-2 ps-1 pe-2 shadow-top sm:gap-2 sm:ps-3 sm:pe-3 lg:bottom-0">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!!busy}
        onClick={onClear}
        aria-label={t('common.clearSelection')}
        title={t('common.clearSelection')}
      >
        <IconX />
      </Button>
      <span role="status" className="min-w-0 flex-1 truncate text-sm font-medium">
        {t('promotion.selected', { count })}
      </span>
      {/* Short labels on a phone, so the three share one line; full names for screen readers */}
      {canCopy && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!!busy || !count}
          onClick={copyPhones}
          aria-label={t('member.bulkCopyPhones')}
          title={t('member.bulkCopyPhones')}
        >
          <IconClipboard />
          <span className="hidden sm:inline">{t('member.bulkCopyPhonesShort')}</span>
        </Button>
      )}
      {canPurge && allArchived ? (
        <Button
          size="sm"
          variant="destructive"
          loading={busy === 'purge'}
          disabled={!!busy}
          onClick={purge}
          aria-label={t('member.purge')}
        >
          {busy !== 'purge' && <IconTrash className="hidden sm:block" />}
          {t('member.purgeShort')}
        </Button>
      ) : canArchive && (
        <Button
          size="sm"
          variant="outline"
          loading={busy === 'archive'}
          disabled={!!busy || !count}
          onClick={archive}
          aria-label={t('member.bulkArchive')}
        >
          {busy !== 'archive' && <IconArchive className="hidden sm:block" />}
          {t('member.bulkArchive')}
        </Button>
      )}
      {canAssign && (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="brand"
              loading={busy === 'assign'}
              disabled={!!busy || !count}
              aria-label={t('member.bulkAssignTo')}
              className="group"
            >
              {busy !== 'assign' && <IconUsers className="hidden sm:block" />}
              {t('member.bulkAssign')}
              <IconChevronDown className="opacity-70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" aria-label={t('member.bulkAssignTo')} className="w-60 p-1.5">
            <p className="px-2.5 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">{t('member.bulkAssignTo')}</p>
            <div className="flex max-h-[50vh] flex-col overflow-y-auto">
              {[...groups.map((g) => ({ id: g.id, name: g.name })), { id: null, name: t('member.noGroup') }].map((g) => (
                <button
                  key={g.id ?? 'none'}
                  type="button"
                  onClick={() => assign(g.id)}
                  className={cn(
                    'focus-ring flex min-h-11 w-full cursor-pointer items-center rounded-lg px-2.5 py-2 text-start text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    g.id === null && 'text-muted-foreground'
                  )}
                >
                  <bdi className="min-w-0 truncate">{g.name}</bdi>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
