import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SECTIONS, api } from '../api';
import { usePerms } from '../auth';
import { useFetch } from '../hooks';
import { avatarName, branchName, fmtDate, memberName } from '../utils';
import ExportPdfButton from '../components/ExportPdfButton';
import FilterSelect from '../components/FilterSelect';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  cn,
  useConfirm,
  useToast,
  IconArchive,
  IconArrow,
  IconAward,
  IconCalendar,
  IconShield,
  IconTrendingUp,
  IconUserCheck,
  IconX,
} from '../components/ui';

// A scout year "2025-2026" runs September 1st to August 31st, as on the server
function scoutYearOf(iso) {
  const y = Number(String(iso).slice(0, 4));
  const start = Number(String(iso).slice(5, 7)) >= 9 ? y : y - 1;
  return `${start}-${start + 1}`;
}

// The فوج's own order, as the branches endpoint sorts it: قسم by قسم (الفتيان first), then the ladder
const rung = (b) => Math.max(0, SECTIONS.indexOf(b.section)) * 1000 + (b.sort_order ?? 0);
// By family name, as the عناصر list sorts
const familyName = (m) => `${m.last_name || ''} ${m.first_name || ''}`;

/** A section's count, in the same pill as the tab counts. */
function Count({ value }) {
  return (
    <span className="min-w-6 rounded-full bg-secondary px-1.5 py-px text-center text-xs font-medium tabular-nums text-muted-foreground">
      {value}
    </span>
  );
}

/**
 * The native box in a 44px hit area — at 18px it is no target for a thumb. The
 * negative margin hands the extra room back, so the row keeps its rhythm.
 */
function PickBox({ checked, indeterminate = false, onChange, label }) {
  return (
    <label className="-m-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
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

/**
 * «Louveteaux → Scouts». The arrow is only drawn: a screen reader hears the
 * sentence rather than «right arrow», which in Arabic would point the wrong way.
 */
function Transition({ from, to }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="sr-only">{t('promotion.transition', { from, to })}</span>
      <span aria-hidden="true" className="inline-flex min-w-0 items-center gap-1.5">
        <bdi className="min-w-0 truncate">{from}</bdi>
        <IconArrow className="h-3.5 w-3.5 rtl:rotate-180" />
        <bdi className="min-w-0 truncate font-medium text-foreground">{to}</bdi>
      </span>
    </>
  );
}

export default function Promotions() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const toast = useToast();
  const confirm = useConfirm();
  // View-only accounts see who is due for promotion but cannot apply it
  const { has } = usePerms();
  const editable = has('promotions.apply');
  // جوّالٌ بلغ سنّ الفرقة التالية و توقّف: يُؤرشَف بدل أن يُرفَّع، و يُعاد تفعيله من ملفّه
  const canArchive = has('members.delete');
  const canPick = editable || canArchive;
  const pending = useFetch('/promotions/pending');
  const history = useFetch('/promotions/history');
  const branches = useFetch('/branches');
  const [busy, setBusy] = useState(null); // null | 'all' | 'picked' | member id
  // '' = كل الفرق. الفلترة على الفرقة التي يخرج منها العنصر، كما يفعل الخادم حين
  // يحصر قائدًا في فرقه: الترفيع يخصّ الفرقة التي يغادرها صاحبه.
  const [branch, setBranch] = useState('');
  // العناصر المؤشَّرون للترفيع دفعةً واحدة
  const [picked, setPicked] = useState(() => new Set());

  // السجل يكبر كل سنة كشفية: السنة تحصره في دفعة واحدة. لا يُعرض الاختيار إلا حين
  // يضمّ السجل أكثر من سنة — قبل ذلك لا شيء يُفرَز.
  const [season, setSeason] = useState('');

  const sameBranch = (id) => !branch || String(id) === String(branch);
  const pendingList = (pending.data || []).filter((p) => sameBranch(p.current_branch.id));
  const branchHistory = (history.data || []).filter((h) => sameBranch(h.old_branch_id));
  // The years of what the فرقة filter leaves: a year from another فرقة would only
  // empty the list. A year picked under another فرقة falls back to «all» — the
  // select may be hidden by then, and the list must not stay filtered out of sight.
  const seasons = [...new Set(branchHistory.map((h) => scoutYearOf(h.promoted_at)))].sort().reverse();
  const shownSeason = seasons.includes(season) ? season : '';
  const historyList = branchHistory.filter((h) => !shownSeason || scoutYearOf(h.promoted_at) === shownSeason);
  const branchList = branches.data || [];
  const pickedIds = pendingList.filter((p) => picked.has(p.id)).map((p) => p.id);
  const allPicked = pendingList.length > 0 && pickedIds.length === pendingList.length;

  // One heading per passage instead of the same two فرق repeated on every row,
  // in the فوج's order, then by name. The ids break ties so a passage never splits.
  const groups = [];
  const byLadder = [...pendingList].sort(
    (a, b) =>
      rung(a.current_branch) - rung(b.current_branch) ||
      a.current_branch.id - b.current_branch.id ||
      rung(a.target_branch) - rung(b.target_branch) ||
      a.target_branch.id - b.target_branch.id ||
      familyName(a).localeCompare(familyName(b))
  );
  for (const p of byLadder) {
    const key = `${p.current_branch.id}-${p.target_branch.id}`;
    if (groups[groups.length - 1]?.key !== key)
      groups.push({ key, from: p.current_branch, to: p.target_branch, items: [] });
    groups[groups.length - 1].items.push(p);
  }

  // تغيير الفرقة يمسح التأشير: اسم مؤشَّر ثم مخفيّ بالفلتر لا يُرفَّع من حيث لا يُرى
  function pickBranch(v) {
    setBranch(v);
    setPicked(new Set());
  }

  function togglePick(id) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // «تأشير الكل» يخصّ المعروض وحده، و هو هنا كل ما مرّ من فلتر الفرقة
  function toggleAll() {
    setPicked(allPicked ? new Set() : new Set(pendingList.map((p) => p.id)));
  }
  // الاسم يذهب إلى عنوان الصفحة و منه إلى اسم ملف الـ PDF
  const branchLabel = branchName(
    branchList.find((b) => String(b.id) === String(branch)),
    lang
  );

  const oldName = (h) => (lang === 'ar' ? h.old_name_ar : h.old_name_fr);
  const newName = (h) => (lang === 'ar' ? h.new_name_ar : h.new_name_fr);
  // Earned out of the فرقة's total, as on the profile — the row only carries what was earned
  const totals = new Map(branchList.map((b) => [b.id, b.total_requirements]));
  const matalibOf = (h) => {
    const total = totals.get(h.old_branch_id);
    return total
      ? t('member.requirementsOf', { earned: h.matalib.length, total })
      : `${h.matalib.length} ${t('session.requirementsShort')}`;
  };

  async function archive(ids, key) {
    const many = ids.length > 1;
    if (
      !(await confirm({
        title: t('promotion.archive'),
        message: t(many ? 'promotion.archiveConfirmMany' : 'promotion.archiveConfirmOne', { count: ids.length }),
        confirmLabel: t('promotion.archive'),
      }))
    )
      return;

    setBusy(key);
    try {
      await api.post('/members/archive', { member_ids: ids });
      setPicked((sel) => {
        const next = new Set(sel);
        for (const id of ids) next.delete(id);
        return next;
      });
      pending.reload({ quiet: true });
      toast.success(t('promotion.archived', { count: ids.length }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function promote(ids, key) {
    const many = ids.length > 1;
    if (
      !(await confirm({
        title: t('promotion.promote'),
        message: t(many ? 'promotion.confirmAll' : 'promotion.confirmOne', { count: ids.length }),
        destructive: false,
        confirmLabel: t('promotion.promote'),
      }))
    )
      return;

    setBusy(key);
    try {
      await api.post('/promotions/validate', { member_ids: ids });
      setPicked((sel) => {
        const next = new Set(sel);
        for (const id of ids) next.delete(id);
        return next;
      });
      pending.reload({ quiet: true });
      history.reload({ quiet: true });
      toast.success(t('promotion.promoted', { count: ids.length }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('promotion.title')} description={t('promotion.subtitle')}>
        {pendingList.length > 0 && (
          // الفرقة رقمًا في الرابط، و 0 تعني كل الفرق — الورقة تُبنى من نفس
          // القائمة المعروضة هنا، بنفس الفلتر
          <ExportPdfButton kind="promotions" id={branch || 0} compact />
        )}
      </PageHeader>

      {/* فلتر واحد: الفرقة التي يغادرها العنصر — يحكم القائمتين معًا، الانتظار و السجل */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={branch}
          onChange={pickBranch}
          allLabel={t('member.allBranches')}
          ariaLabel={t('member.branch')}
          className="w-full sm:w-auto sm:min-w-48"
          icon={<IconShield className="opacity-60" />}
          options={branchList.map((b) => ({ value: b.id, label: branchName(b, lang) }))}
        />
        {branch && (
          <Button variant="ghost" size="sm" onClick={() => pickBranch('')}>
            {t('common.clearFilters')}
          </Button>
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          {canPick && pendingList.length > 1 && (
            <PickBox
              checked={allPicked}
              indeterminate={pickedIds.length > 0 && !allPicked}
              onChange={toggleAll}
              label={t('promotion.selectAll', { count: pendingList.length })}
            />
          )}
          <h2 className="text-base font-semibold">{t('promotion.pending')}</h2>
          {pendingList.length > 0 && <Count value={pendingList.length} />}
          {/* A selection brings its own bar to the bottom: two «promote» buttons on
              screen at once would compete for the same tap */}
          {editable && pendingList.length > 0 && pickedIds.length === 0 && (
            <Button
              variant="brand"
              size="sm"
              loading={busy === 'all'}
              disabled={!!busy}
              onClick={() => promote(pendingList.map((p) => p.id), 'all')}
              className="ms-auto"
            >
              {busy !== 'all' && <IconTrendingUp />}
              {t('promotion.promoteAll', { count: pendingList.length })}
            </Button>
          )}
        </div>

        {pending.error ? (
          <div className="p-4 sm:p-5">
            <ErrorState message={t('error.loadFailed')} onRetry={pending.reload} retryLabel={t('error.retry')} />
          </div>
        ) : pending.loading ? (
          <div aria-hidden="true" className="divide-y divide-border">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-14" />
                </div>
              </div>
            ))}
          </div>
        ) : pendingList.length === 0 ? (
          <EmptyState
            icon={<IconUserCheck className="h-6 w-6" />}
            title={branch ? t('promotion.noPendingInBranch', { branch: branchLabel }) : t('promotion.noPending')}
            action={
              branch ? (
                <Button variant="outline" onClick={() => pickBranch('')}>
                  {t('common.clearFilters')}
                </Button>
              ) : null
            }
          >
            {branch ? t('promotion.noPendingInBranchHint') : t('promotion.noPendingHint')}
          </EmptyState>
        ) : (
          <div className="divide-y divide-border">
            {groups.map((g) => (
              <div key={g.key}>
                <h3
                  id={`promo-${g.key}`}
                  className="flex items-center gap-3 bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:px-5"
                >
                  <Transition from={branchName(g.from, lang)} to={branchName(g.to, lang)} />
                  <span className="ms-auto tabular-nums">{g.items.length}</span>
                </h3>
                <ul aria-labelledby={`promo-${g.key}`} className="divide-y divide-border border-t border-border">
                  {g.items.map((p) => {
                    const name = memberName(p);
                    const on = picked.has(p.id);
                    return (
                      <li
                        key={p.id}
                        // The whole row ticks the box; the name still opens the profile
                        // and the buttons keep their own action
                        onClick={
                          canPick
                            ? (e) => {
                                if (e.target.closest('a, button, label') || window.getSelection()?.toString())
                                  return;
                                togglePick(p.id);
                              }
                            : undefined
                        }
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 transition-colors sm:px-5',
                          canPick && 'cursor-pointer',
                          on ? 'bg-accent/60' : canPick && 'hover:bg-accent/40'
                        )}
                      >
                        {canPick && (
                          <PickBox
                            checked={on}
                            onChange={() => togglePick(p.id)}
                            label={t('promotion.selectOne', { name })}
                          />
                        )}
                        <Avatar
                          photo={p.photo}
                          name={avatarName(p)}
                          // Neutral initials, as on the عناصر list
                          className="bg-secondary text-secondary-foreground"
                        />
                        <div className="min-w-0 flex-1">
                          {/* dir="auto": a Latin name in the Arabic UI keeps its own order.
                              w-fit: the empty end of the line still ticks the row */}
                          <Link
                            to={`/members/${p.id}`}
                            dir="auto"
                            className="focus-ring line-clamp-2 w-fit max-w-full rounded-sm text-[0.9375rem] font-medium leading-5 hover:text-primary hover:underline sm:text-sm"
                          >
                            {name}
                          </Link>
                          <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            {p.age} {t('common.years')}
                          </div>
                        </div>
                        {/* Phones act through the selection bar: two buttons on every row
                            left the names a few letters wide */}
                        {canPick && (
                          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                            {canArchive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={busy === `archive-${p.id}`}
                                disabled={!!busy}
                                onClick={() => archive([p.id], `archive-${p.id}`)}
                                aria-label={t('promotion.archiveOne', { name })}
                                className="text-muted-foreground"
                              >
                                {busy !== `archive-${p.id}` && <IconArchive />}
                                {t('promotion.archive')}
                              </Button>
                            )}
                            {editable && (
                              <Button
                                size="sm"
                                variant="outline"
                                loading={busy === p.id}
                                disabled={!!busy}
                                onClick={() => promote([p.id], p.id)}
                                aria-label={t('promotion.promoteOne', { name })}
                              >
                                {t('promotion.promote')}
                              </Button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* شريط التأشير يلتصق بالأسفل، و فوق شريط التنقّل في الهاتف: لولا ذلك لاختفى
            الزرّ تحته، و التأشير بلا زرّ ترفيع لا معنى له */}
        {canPick && pickedIds.length > 0 && (
          <div className="glass animate-fade-up sticky bottom-[var(--bottomnav-h)] z-10 flex items-center gap-1.5 rounded-b-2xl border-t border-border py-2 ps-1 pe-4 shadow-[0_-8px_16px_-12px_hsl(220_25%_12%/0.2)] sm:gap-2 sm:ps-3 sm:pe-5 lg:bottom-0">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!!busy}
              onClick={() => setPicked(new Set())}
              aria-label={t('common.clearSelection')}
              title={t('common.clearSelection')}
            >
              <IconX />
            </Button>
            <span role="status" className="min-w-0 flex-1 truncate text-sm font-medium">
              {t('promotion.selected', { count: pickedIds.length })}
            </span>
            {/* The count is said once, at the start; the buttons stay short enough
                to share one line on a phone. Their full names go to screen readers. */}
            {canArchive && (
              <Button
                size="sm"
                variant="outline"
                loading={busy === 'archive-picked'}
                disabled={!!busy}
                onClick={() => archive(pickedIds, 'archive-picked')}
                aria-label={t('promotion.archiveSelected', { count: pickedIds.length })}
              >
                {busy !== 'archive-picked' && <IconArchive className="hidden sm:block" />}
                {t('promotion.archive')}
              </Button>
            )}
            {editable && (
              <Button
                size="sm"
                variant="brand"
                loading={busy === 'picked'}
                disabled={!!busy}
                onClick={() => promote(pickedIds, 'picked')}
                aria-label={t('promotion.promoteSelected', { count: pickedIds.length })}
              >
                {busy !== 'picked' && <IconTrendingUp className="hidden sm:block" />}
                {t('promotion.promote')}
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card className="@container">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold">{t('promotion.history')}</h2>
          {historyList.length > 0 && <Count value={historyList.length} />}
          {seasons.length > 1 && (
            <FilterSelect
              value={shownSeason}
              onChange={setSeason}
              allLabel={t('promotion.allSeasons')}
              ariaLabel={t('promotion.season')}
              className="w-full sm:ms-auto sm:w-auto sm:min-w-44"
              icon={<IconCalendar className="opacity-60" />}
              options={seasons.map((s) => ({ value: s, label: s }))}
            />
          )}
        </div>

        {history.error ? (
          <div className="p-4 sm:p-5">
            <ErrorState message={t('error.loadFailed')} onRetry={history.reload} retryLabel={t('error.retry')} />
          </div>
        ) : history.loading ? (
          <div aria-hidden="true" className="divide-y divide-border">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 flex-1" />
              </div>
            ))}
          </div>
        ) : historyList.length === 0 ? (
          <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('promotion.noHistory')} />
        ) : (
          <>
            {/* Narrow cards: one stacked row per promotion */}
            <ul className="divide-y divide-border @xl:hidden">
              {historyList.map((h) => (
                <li key={h.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      to={`/members/${h.member_id}`}
                      dir="auto"
                      className="focus-ring min-w-0 rounded-sm font-medium hover:text-primary hover:underline"
                    >
                      {memberName(h)}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtDate(h.promoted_at)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <Transition from={oldName(h)} to={newName(h)} />
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums" title={h.matalib.join(', ')}>
                      {matalibOf(h)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <Table className="hidden @xl:block">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th className="ps-4 sm:ps-5">{t('common.date')}</Th>
                  <Th>{t('promotion.member')}</Th>
                  <Th>{t('promotion.oldBranch')}</Th>
                  <Th>{t('promotion.newBranch')}</Th>
                  <Th className="pe-4 text-end sm:pe-5">{t('session.requirementsShort')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {historyList.map((h) => {
                  const total = totals.get(h.old_branch_id);
                  return (
                    <tr key={h.id} className="transition-colors hover:bg-accent/40">
                      <Td className="whitespace-nowrap ps-4 tabular-nums text-muted-foreground sm:ps-5">
                        {fmtDate(h.promoted_at)}
                      </Td>
                      <Td>
                        <Link
                          to={`/members/${h.member_id}`}
                          dir="auto"
                          className="focus-ring rounded-sm font-medium hover:text-primary hover:underline"
                        >
                          {memberName(h)}
                        </Link>
                      </Td>
                      <Td className="text-muted-foreground">
                        <bdi>{oldName(h)}</bdi>
                      </Td>
                      <Td>
                        <bdi>{newName(h)}</bdi>
                      </Td>
                      <Td
                        className="whitespace-nowrap pe-4 text-end tabular-nums sm:pe-5"
                        title={h.matalib.join(', ')}
                      >
                        {h.matalib.length}
                        {total ? <span className="text-muted-foreground"> / {total}</span> : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
