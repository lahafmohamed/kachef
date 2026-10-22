import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SECTIONS, api } from '../api';
import { usePerms } from '../auth';
import { useFetch } from '../hooks';
import { avatarName, branchName, fmtDate, memberName } from '../utils';
import ExportPdfButton from '../components/ExportPdfButton';
import FilterSelect from '../components/FilterSelect';
import { AdmissionQueue, MissingBirthDates } from '../components/Admission';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Label,
  SegmentedControl,
  Textarea,
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
  IconAlert,
  IconArchive,
  IconArchiveRestore,
  IconArrow,
  IconAward,
  IconCalendar,
  IconShield,
  IconTrendingUp,
  IconUserCheck,
  IconUsers,
  IconX,
} from '../components/ui';

const today = () => new Date().toISOString().slice(0, 10);

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
  // ترفيع fin d'année : les âges au 31 août de l'année scoute en cours. Ceux qui ne
  // seront éligibles que d'ici là s'affichent sans case — le serveur revalide à la date du jour.
  const [asOf, setAsOf] = useState('today'); // 'today' | 'yearEnd'
  const yearEnd = `${scoutYearOf(today()).slice(5)}-08-31`;
  const pending = useFetch(`/promotions/pending${asOf === 'yearEnd' ? `?ref=${yearEnd}` : ''}`);
  const history = useFetch('/promotions/history');
  // Bug 20 : طلائع d'âge qui ne correspondent plus à l'âge de leurs عناصر
  const realign = useFetch('/promotions/group-realign');
  const branches = useFetch('/branches');
  const [busy, setBusy] = useState(null); // null | 'all' | 'picked' | member id
  // '' = كل الفرق. الفلترة على الفرقة التي يخرج منها العنصر، كما يفعل الخادم حين
  // يحصر قائدًا في فرقه: الترفيع يخصّ الفرقة التي يغادرها صاحبه.
  const [branch, setBranch] = useState('');
  // Les عناصر hors tranche d'âge de leur فرقة — un lien vers la liste, à corriger à la main
  const canReadMembers = has('members.read');
  const anomalies = useFetch(`/members?missing=age_range&status=active${branch ? `&branch=${branch}` : ''}`, {
    skip: !canReadMembers,
  });
  const anomalyCount = anomalies.data?.length || 0;
  // العناصر المؤشَّرون للترفيع دفعةً واحدة
  const [picked, setPicked] = useState(() => new Set());

  // السجل يكبر كل سنة كشفية: السنة تحصره في دفعة واحدة. لا يُعرض الاختيار إلا حين
  // يضمّ السجل أكثر من سنة — قبل ذلك لا شيء يُفرَز.
  const [season, setSeason] = useState('');
  // جاهزون (بلغوا عتبة مطالب فرقتهم) أو دون العتبة: '' = الكل
  const [readiness, setReadiness] = useState('');
  // نافذة الترفيع: تاريخه (اليوم افتراضيًا، أو تاريخ سابق لترفيعٍ متأخّر)، و تحت العتبة
  // استثناء يُكتب سببه قبل الإرسال
  const [override, setOverride] = useState(null); // { ids, key, below, reason, date }
  // إلغاء ترفيع: يعود العنصر إلى فرقته السابقة
  const [reversing, setReversing] = useState(null); // { h, reason }

  const sameBranch = (id) => !branch || String(id) === String(branch);
  const inBranch = (pending.data || []).filter((p) => sameBranch(p.current_branch.id));
  const readyCount = inBranch.filter((p) => p.ready).length;
  const pendingList = inBranch.filter((p) => !readiness || (readiness === 'ready') === !!p.ready);
  // «Éligible le …» : affiché, jamais coché — la validation compte l'âge d'aujourd'hui
  const pickable = pendingList.filter((p) => !p.upcoming);
  const readyIds = pickable.filter((p) => p.ready).map((p) => p.id);
  // Bug 20 : la فرقة d'arrivée voit aussi ses ترفيعات entrants
  const branchHistory = (history.data || []).filter((h) => sameBranch(h.old_branch_id) || sameBranch(h.new_branch_id));
  const realignList = (realign.data?.branches || []).filter((r) => sameBranch(r.branch_id));
  // The years of what the فرقة filter leaves: a year from another فرقة would only
  // empty the list. A year picked under another فرقة falls back to «all» — the
  // select may be hidden by then, and the list must not stay filtered out of sight.
  const seasons = [...new Set(branchHistory.map((h) => scoutYearOf(h.promoted_at)))].sort().reverse();
  const shownSeason = seasons.includes(season) ? season : '';
  const historyList = branchHistory.filter((h) => !shownSeason || scoutYearOf(h.promoted_at) === shownSeason);
  const branchList = branches.data || [];
  const pickedIds = pickable.filter((p) => picked.has(p.id)).map((p) => p.id);
  const allPicked = pickable.length > 0 && pickedIds.length === pickable.length;

  // One heading per passage instead of the same two فرق repeated on every row,
  // in the فوج's order, then by name. The ids break ties so a passage never splits.
  const groups = [];
  const byLadder = [...pendingList].sort(
    (a, b) =>
      rung(a.current_branch) - rung(b.current_branch) ||
      a.current_branch.id - b.current_branch.id ||
      rung(a.target_branch) - rung(b.target_branch) ||
      a.target_branch.id - b.target_branch.id ||
      // الجاهزون أولًا في كل عبور، ثم من لم يبلغ العتبة
      Number(!!b.ready) - Number(!!a.ready) ||
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
    setPicked(allPicked ? new Set() : new Set(pickable.map((p) => p.id)));
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
      : t('session.matalibCount', { count: h.matalib.length });
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

  function promote(ids, key) {
    const below = pendingList.filter((p) => ids.includes(p.id) && !p.ready);
    setOverride({ ids, key, below, reason: '', date: today() });
  }

  const promoteError = (code) =>
    ({
      promotion_below_threshold: t('matalib.reasonRequired'),
      promotion_date_in_future: t('promotion.dateInFuture'),
      promotion_date_before_last_move: t('promotion.dateBeforeLastMove'),
    })[code] || code;

  async function send(ids, key, overrides, date) {
    setBusy(key);
    try {
      await api.post('/promotions/validate', { member_ids: ids, overrides, promoted_at: date });
      setPicked((sel) => {
        const next = new Set(sel);
        for (const id of ids) next.delete(id);
        return next;
      });
      pending.reload({ quiet: true });
      history.reload({ quiet: true });
      realign.reload({ quiet: true });
      toast.success(t('promotion.promoted', { count: ids.length }));
    } catch (err) {
      toast.error(promoteError(err.message));
    } finally {
      setBusy(null);
    }
  }

  function confirmOverride(e) {
    e.preventDefault();
    const reason = override.reason.trim();
    if (override.below.length && !reason) return;
    if (!override.date || override.date > today()) return;
    const overrides = override.below.length
      ? Object.fromEntries(override.below.map((p) => [p.id, reason]))
      : undefined;
    const { ids, key, date } = override;
    setOverride(null);
    send(ids, key, overrides, date);
  }

  async function reverse(e) {
    e.preventDefault();
    const { h, reason } = reversing;
    setBusy(`reverse-${h.id}`);
    try {
      await api.post(`/promotions/${h.id}/reverse`, { reason: reason.trim() || undefined });
      setReversing(null);
      pending.reload({ quiet: true });
      history.reload({ quiet: true });
      realign.reload({ quiet: true });
      toast.success(t('promotion.reversedToast'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function applyRealign(r) {
    setBusy(`realign-${r.branch_id}`);
    try {
      const res = await api.post(`/branches/${r.branch_id}/groups/by-age`, { member_ids: r.moves.map((m) => m.id) });
      realign.reload({ quiet: true });
      toast.success(t('promotion.realigned', { count: res.moved }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  // Une promotion annulée reste visible, barrée et marquée « annulée »
  const reversedBadge = (h) =>
    h.reversed_at ? (
      <Badge
        variant="destructive"
        title={[t('promotion.reversedOn', { date: fmtDate(h.reversed_at.slice(0, 10)) }), h.reversal_reason]
          .filter(Boolean)
          .join(' · ')}
      >
        {t('promotion.reversed')}
      </Badge>
    ) : null;
  const reverseButton = (h, className) =>
    editable && h.reversible ? (
      <Button
        size="sm"
        variant="ghost"
        className={cn('text-muted-foreground', className)}
        disabled={!!busy}
        onClick={() => setReversing({ h, reason: '' })}
        aria-label={t('promotion.reverseOne', { name: memberName(h) })}
      >
        <IconArchiveRestore />
        {t('promotion.reverse')}
      </Button>
    ) : null;
  const anyReversible = editable && historyList.some((h) => h.reversible);

  // «مطالب X/Y (Z %)» — the badge says whether the فرقة's threshold is reached
  const progressOf = (p) =>
    p.total ? (
      <Badge variant={p.ready ? 'success' : 'warning'} title={t('matalib.thresholdOf', { pct: p.threshold })}>
        {t('matalib.progress', { earned: p.earned_count, total: p.total, pct: p.pct })}
      </Badge>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('promotion.title')} description={t('promotion.subtitle')}>
        {pendingList.length > 0 && (
          // الفرقة رقمًا في الرابط، و 0 تعني كل الفرق — الورقة تُبنى من نفس
          // القائمة المعروضة هنا، بنفس الفلتر
          <ExportPdfButton kind="promotions" id={branch || 0} compact />
        )}
      </PageHeader>

      {/* فلتر واحد: الفرقة التي يغادرها العنصر — يحكم القائمتين معًا، الانتظار و السجل.
          On a phone the reset is a bare ✕ beside the select: with its full label it
          wrapped to a line of its own, under a select that already fills the width. */}
      <div className="flex items-center gap-2">
        <FilterSelect
          value={branch}
          onChange={pickBranch}
          allLabel={t('member.allBranches')}
          ariaLabel={t('member.branch')}
          className="min-w-0 flex-1 sm:w-auto sm:min-w-48 sm:flex-none"
          icon={<IconShield className="opacity-60" />}
          options={branchList.map((b) => ({ value: b.id, label: branchName(b, lang) }))}
        />
        {branch && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => pickBranch('')}
            aria-label={t('common.clearFilters')}
            className="w-11 px-0 sm:w-auto sm:px-3"
          >
            <IconX />
            <span className="hidden sm:inline">{t('common.clearFilters')}</span>
          </Button>
        )}
      </div>

      {/* Âge compté aujourd'hui, ou au 31 août : préparer les ترفيعات de la rentrée */}
      <div className="space-y-1.5">
        <SegmentedControl
          label={t('promotion.asOf')}
          className="flex w-full sm:w-auto"
          value={asOf}
          onChange={(v) => {
            setAsOf(v);
            setPicked(new Set());
          }}
          options={[
            { value: 'today', label: t('promotion.asOfToday') },
            { value: 'yearEnd', label: t('promotion.asOfYearEnd') },
          ]}
        />
        {asOf === 'yearEnd' && (
          <p className="text-xs text-muted-foreground">{t('promotion.asOfYearEndHint', { date: fmtDate(yearEnd) })}</p>
        )}
      </div>

      {/* Les عناصر déjà hors de la tranche d'âge de leur فرقة : la liste, à corriger */}
      {anomalyCount > 0 && (
        <Card className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
          <IconAlert className="h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-40 flex-1">
            <p className="text-sm font-medium">{t('promotion.anomaliesTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('promotion.anomaliesHint', { count: anomalyCount })}</p>
          </div>
          <Link
            to={`/members?missing=age_range${branch ? `&branch=${branch}` : ''}`}
            className="focus-ring inline-flex h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground sm:h-8"
          >
            {t('promotion.anomaliesLink')}
          </Link>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          {canPick && pickable.length > 1 && (
            <PickBox
              checked={allPicked}
              indeterminate={pickedIds.length > 0 && !allPicked}
              onChange={toggleAll}
              label={t('promotion.selectAll', { count: pickable.length })}
            />
          )}
          <h2 className="text-base font-semibold">{t('promotion.pending')}</h2>
          {pendingList.length > 0 && <Count value={pendingList.length} />}
          {/* A selection brings its own bar to the bottom: two «promote» buttons on
              screen at once would compete for the same tap. A phone has no room for it
              beside the title: it takes a full line of its own rather than floating
              at the end of a half-empty one. */}
          {editable && readyIds.length > 0 && pickedIds.length === 0 && (
            <Button
              variant="brand"
              size="sm"
              loading={busy === 'all'}
              disabled={!!busy}
              onClick={() => promote(readyIds, 'all')}
              className="w-full sm:ms-auto sm:w-auto"
            >
              {busy !== 'all' && <IconTrendingUp />}
              {readyIds.length === pendingList.length
                ? t('promotion.promoteAll', { count: readyIds.length })
                : t('matalib.promoteReady', { count: readyIds.length })}
            </Button>
          )}
          {inBranch.length > 0 && readyCount < inBranch.length && (
            <SegmentedControl
              label={t('matalib.readiness')}
              size="sm"
              className="flex w-full"
              columns={3}
              value={readiness}
              onChange={(v) => {
                setReadiness(v);
                setPicked(new Set());
              }}
              options={[
                { value: '', label: `${t('matalib.all')} · ${inBranch.length}` },
                { value: 'ready', label: `${t('matalib.ready')} · ${readyCount}` },
                { value: 'below', label: `${t('matalib.below')} · ${inBranch.length - readyCount}` },
              ]}
            />
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
                {/* The box the loaded row will have, so the names do not shift when it lands */}
                {canPick && <Skeleton className="mx-px h-4.5 w-4.5 shrink-0 rounded-sm" />}
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
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
                    // Éligible d'ici la fin d'année seulement : visible, pas sélectionnable
                    const rowPick = canPick && !p.upcoming;
                    return (
                      <li
                        key={p.id}
                        // The whole row ticks the box; the name still opens the profile
                        // and the buttons keep their own action
                        onClick={
                          rowPick
                            ? (e) => {
                                if (e.target.closest('a, button, label') || window.getSelection()?.toString())
                                  return;
                                togglePick(p.id);
                              }
                            : undefined
                        }
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 transition-colors sm:px-5',
                          rowPick && 'cursor-pointer',
                          on && rowPick ? 'bg-accent/60' : rowPick && 'hover:bg-accent/40'
                        )}
                      >
                        {rowPick && (
                          <PickBox
                            checked={on}
                            onChange={() => togglePick(p.id)}
                            label={t('promotion.selectOne', { name })}
                          />
                        )}
                        {/* The box's room, kept empty: the names stay in one column */}
                        {canPick && !rowPick && <span aria-hidden="true" className="-m-3 h-11 w-11 shrink-0" />}
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
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
                            {t('common.age', { count: p.age })}
                            {progressOf(p)}
                            {p.upcoming && p.eligible_on && (
                              <Badge variant="secondary">
                                <IconCalendar className="h-3 w-3" />
                                {t('promotion.eligibleOn', { date: fmtDate(p.eligible_on) })}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {/* Phones act through the selection bar: two buttons on every row
                            left the names a few letters wide */}
                        {rowPick && (
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
          <div className="glass animate-fade-up sticky bottom-[var(--bottomnav-h)] z-10 flex items-center gap-1.5 rounded-b-2xl border-t border-border py-2 ps-1 pe-4 shadow-top sm:gap-2 sm:ps-3 sm:pe-5 lg:bottom-0">
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

      {/* Bug 8 : ceux que la liste ci-dessus ne peut pas voir */}
      <MissingBirthDates branch={branch} />

      {/* B1 : فترة التجربة et تكريس, filtrés par la même فرقة */}
      {has('members.read') && <AdmissionQueue branch={branch} />}

      {/* Bug 20 : طليعة d'âge à réajuster quand l'élément a vieilli */}
      {realignList.length > 0 && (
        <Card>
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <IconUsers className="h-4 w-4 text-muted-foreground" />
              {t('promotion.realignTitle')}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('promotion.realignHint')}</p>
          </div>
          <div className="divide-y divide-border">
            {realignList.map((r) => (
              <div key={r.branch_id}>
                <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-4 py-2 sm:px-5">
                  <bdi className="text-sm font-medium">{lang === 'ar' ? r.branch_name_ar : r.branch_name_fr}</bdi>
                  <Count value={r.moves.length} />
                  {realign.data?.can_apply && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ms-auto"
                      loading={busy === `realign-${r.branch_id}`}
                      disabled={!!busy}
                      onClick={() => applyRealign(r)}
                      aria-label={t('promotion.realignOne', {
                        branch: lang === 'ar' ? r.branch_name_ar : r.branch_name_fr,
                      })}
                    >
                      {t('promotion.realignApply', { count: r.moves.length })}
                    </Button>
                  )}
                </div>
                <ul className="divide-y divide-border border-t border-border">
                  {r.moves.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                      <Avatar
                        photo={m.photo}
                        name={avatarName(m)}
                        className="h-8 w-8 bg-secondary text-secondary-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/members/${m.id}`}
                          dir="auto"
                          className="focus-ring line-clamp-1 w-fit max-w-full rounded-sm text-sm font-medium hover:text-primary hover:underline"
                        >
                          {memberName(m)}
                        </Link>
                        <div className="mt-0.5 flex min-w-0 text-xs text-muted-foreground">
                          <Transition from={m.from_group_name || t('branch.groupNone')} to={m.to_group_name} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

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
          <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('promotion.noHistory')}>
            {t('promotion.noHistoryHint')}
          </EmptyState>
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
                    <span
                      className={cn('shrink-0 text-xs tabular-nums text-muted-foreground', h.reversed_at && 'line-through')}
                    >
                      {fmtDate(h.promoted_at)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <Transition from={oldName(h)} to={newName(h)} />
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums" title={h.matalib.join(', ')}>
                      {matalibOf(h)}
                    </span>
                    {!!h.override && (
                      <Badge variant="warning" title={h.override_reason || undefined}>
                        {t('matalib.override')}
                      </Badge>
                    )}
                    {reversedBadge(h)}
                  </div>
                  {!!h.override && h.override_reason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('matalib.overrideReason')}: <bdi>{h.override_reason}</bdi>
                    </p>
                  )}
                  {reverseButton(h, '-ms-2 mt-1')}
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
                  <Th className={cn('text-end', !anyReversible && 'pe-4 sm:pe-5')}>{t('session.requirementsShort')}</Th>
                  {anyReversible && (
                    <Th className="pe-4 sm:pe-5">
                      <span className="sr-only">{t('promotion.reverse')}</span>
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {historyList.map((h) => {
                  const total = totals.get(h.old_branch_id);
                  return (
                    <tr key={h.id} className="transition-colors hover:bg-accent/40">
                      <Td
                        className={cn(
                          'whitespace-nowrap ps-4 tabular-nums text-muted-foreground sm:ps-5',
                          h.reversed_at && 'line-through'
                        )}
                      >
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
                        className={cn('whitespace-nowrap text-end tabular-nums', !anyReversible && 'pe-4 sm:pe-5')}
                        title={h.matalib.join(', ')}
                      >
                        {h.reversed_at && <span className="me-2">{reversedBadge(h)}</span>}
                        {!!h.override && (
                          <Badge variant="warning" className="me-2" title={h.override_reason || undefined}>
                            {t('matalib.override')}
                          </Badge>
                        )}
                        {h.matalib.length}
                        {total ? <span className="text-muted-foreground"> / {total}</span> : null}
                      </Td>
                      {anyReversible && <Td className="pe-4 text-end sm:pe-5">{reverseButton(h)}</Td>}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </>
        )}
      </Card>

      <Dialog
        open={!!override}
        onClose={() => setOverride(null)}
        title={override?.below.length ? t('matalib.overrideTitle') : t('promotion.promote')}
        description={
          override?.below.length
            ? t('matalib.overrideHint', { count: override.below.length })
            : t(override?.ids.length > 1 ? 'promotion.confirmAll' : 'promotion.confirmOne', {
                count: override?.ids.length || 0,
              })
        }
      >
        {override && (
          <form onSubmit={confirmOverride} className="space-y-4">
            {override.below.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {override.below.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <bdi className="min-w-0 truncate font-medium">{memberName(p)}</bdi>
                  {progressOf(p)}
                </li>
              ))}
            </ul>
            )}
            {override.below.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="override-reason">{t('matalib.overrideReason')}</Label>
                <Textarea
                  id="override-reason"
                  rows={3}
                  required
                  value={override.reason}
                  onChange={(e) => setOverride((o) => ({ ...o, reason: e.target.value }))}
                />
              </div>
            )}
            <Field
              label={t('promotion.effectiveDate')}
              hint={t('promotion.effectiveDateHint')}
              error={override.date > today() ? t('promotion.dateInFuture') : null}
            >
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  required
                  max={today()}
                  value={override.date}
                  onChange={(e) => setOverride((o) => ({ ...o, date: e.target.value }))}
                />
              )}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setOverride(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="brand"
                disabled={
                  (override.below.length > 0 && !override.reason.trim()) || !override.date || override.date > today()
                }
              >
                <IconTrendingUp />
                {override.below.length
                  ? t('matalib.overrideConfirm', { count: override.ids.length })
                  : t('promotion.promote')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={!!reversing}
        onClose={() => setReversing(null)}
        title={t('promotion.reverseTitle')}
        description={
          reversing ? t('promotion.reverseHint', { name: memberName(reversing.h), branch: oldName(reversing.h) }) : ''
        }
      >
        {reversing && (
          <form onSubmit={reverse} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reverse-reason">{t('promotion.reverseReason')}</Label>
              <Textarea
                id="reverse-reason"
                rows={2}
                value={reversing.reason}
                onChange={(e) => setReversing((r) => ({ ...r, reason: e.target.value }))}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setReversing(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="destructive" loading={busy === `reverse-${reversing.h.id}`}>
                {t('promotion.reverseConfirm')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
