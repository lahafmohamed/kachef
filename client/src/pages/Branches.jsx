import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import { useFetch, useLocalStorage } from '../hooks';
import { useSection } from '../section';
import { toDate, toISO } from '../lib/date';
import { avatarName, branchName, fmtDate, memberName } from '../utils';
import SearchInput from '../components/SearchInput';
import ExportPdfButton from '../components/ExportPdfButton';
import NewBranchDialog from '../components/NewBranchDialog';
import { RateValue, UnderlineTabs } from '../components/MemberParts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  ProgressBar,
  RequirementGrid,
  Select,
  Skeleton,
  cn,
  useConfirm,
  useToast,
  IconAward,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconInbox,
  IconLink,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUnlink,
  IconUsers,
} from '../components/ui';

// Scout-year order: أيلول opens the year, آب closes it
const SCOUT_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

const TABS = ['plan', 'sessions', 'groups', 'matalib'];

// ar-LB gives the Levantine month names (أيلول، تشرين...) the فوج actually uses
const monthName = (m, lng) =>
  new Intl.DateTimeFormat(lng === 'ar' ? 'ar-LB' : 'fr-FR', { month: 'long' }).format(
    new Date(2000, m - 1, 1)
  );

// "2025-2026" + شهر 9 → "2025-09"، و شهر 3 → "2026-03": أيلول..كانون الأول من السنة
// الأولى، و الباقي من الثانية.
const monthKey = (year, month) =>
  `${month >= 9 ? year.slice(0, 4) : year.slice(5)}-${String(month).padStart(2, '0')}`;

/** كل أيام الشهر، من الأول إلى الآخر. */
function daysOf(key) {
  const [y, m] = key.split('-').map(Number);
  const out = [];
  for (const d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1))
    out.push(toISO(d));
  return out;
}

// كل سبوت الشهر — the plan's default rows: normally every سبت carries a نشاط
const saturdaysOf = (key) => daysOf(key).filter((d) => toDate(d).getDay() === 6);

/** صفوف الشهر للتحرير: كل سبت و لو فارغًا، و الأيام المحفوظة معها، مرتّبة بالتاريخ. */
function monthRows(items, key) {
  const byDate = new Map(
    items
      .filter((i) => i.date.startsWith(key))
      .map((i) => [i.date, { ...i, extra: toDate(i.date).getDay() !== 6 }])
  );
  for (const d of saturdaysOf(key))
    if (!byDate.has(d)) byDate.set(d, { id: null, date: d, title: '', session: null, extra: false });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Same rule as the server: trimmed, case-folded
const titleKey = (v) => String(v || '').trim().toLowerCase();

// بند تغيّر منذ اعتماد الخطة — يُحسب من المسودّة، فيظهر قبل الحفظ
const differsFromBase = (row) =>
  !!row.base && (row.date !== row.base.date || titleKey(row.title) !== titleKey(row.base.title));

// A branch plan item carries its نشاط; an overview item only says whether it has one
const isDone = (i) => !!(i.session || i.done);

/** المبرمج و المنجز في كل شهر من السنة الكشفية — ما يُرسم على شريط الأشهر. */
function monthStats(items, year) {
  return SCOUT_MONTHS.map((m) => {
    const key = monthKey(year, m);
    const planned = items.filter((i) => i.date.startsWith(key) && String(i.title || '').trim());
    return { month: m, key, planned: planned.length, done: planned.filter(isDone).length };
  });
}

const intlLocale = (lng) => (lng === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR');

// "sam. 06/09" — weekday and day, latin digits in both locales
const dayLabelFormats = {};
function fmtDay(iso, lng) {
  const locale = lng === 'ar' ? 'ar-u-nu-latn' : 'fr-FR';
  const f = (dayLabelFormats[locale] ??= new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }));
  return f.format(toDate(iso)).replace(/[‎‏؜]/g, '');
}

const weekdayFormats = {};
const fmtWeekday = (iso, lng) =>
  (weekdayFormats[lng] ??= new Intl.DateTimeFormat(intlLocale(lng), { weekday: 'long' })).format(toDate(iso));

// "05/09" — day first, as on the paper plan
const fmtDayMonth = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const shortMonthFormats = {};
const fmtShortMonth = (iso, lng) =>
  (shortMonthFormats[lng] ??= new Intl.DateTimeFormat(intlLocale(lng), { month: 'short' }))
    .format(toDate(iso))
    .replace(/\.$/, '');

function agesLabel(b, t) {
  if (b.all_ages) return t('branch.allAges');
  return b.max_age ? `${b.min_age}–${b.max_age} ${t('branch.years')}` : `${b.min_age}+`;
}

/* ============================================================
   Shared pieces
   ============================================================ */

/** One cell of the figures strip — same shape as the عنصر profile's. */
function Stat({ label, children, className }) {
  return (
    <div className={cn('min-w-0 space-y-2 bg-card p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Thin share bar — a part of a whole, drawn without the progressbar semantics. */
function ShareBar({ value, tone = 'primary', className }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <span aria-hidden="true" className={cn('block h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <span
        className={cn('block h-full rounded-full', tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * The twelve months of the scout year, each with what it planned and what got done.
 * One tap opens a month; the bars read as the year at a glance. A row on phones
 * (scrolls sideways), two half-years on wider screens.
 */
function MonthStrip({ stats, value, onChange }) {
  const { t, i18n } = useTranslation();
  const refs = useRef({});
  const todayKey = toISO(new Date()).slice(0, 7);

  // Sideways only, and only when the strip is on screen: opening the page must not
  // drag it down to the strip.
  useEffect(() => {
    const el = refs.current[value];
    const box = el?.parentElement?.getBoundingClientRect();
    if (box && box.top >= 0 && box.bottom <= window.innerHeight)
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  return (
    <div
      role="group"
      aria-label={t('common.month')}
      className="no-scrollbar relative -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5 sm:mx-0 sm:grid sm:grid-cols-6 sm:overflow-visible sm:px-0"
    >
      {stats.map((s) => {
        const on = s.month === value;
        const full = s.planned > 0 && s.done === s.planned;
        return (
          <button
            key={s.month}
            ref={(el) => (refs.current[s.month] = el)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(s.month)}
            className={cn(
              'focus-ring flex min-w-[5.5rem] shrink-0 cursor-pointer flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-start transition-colors sm:min-w-0',
              on
                ? 'border-primary/40 bg-accent text-accent-foreground'
                : 'border-transparent hover:bg-accent/50'
            )}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[0.8125rem] font-medium leading-tight">
              {monthName(s.month, i18n.language)}
              {s.key === todayKey && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary">
                  <span className="sr-only">{t('common.today')}</span>
                </span>
              )}
            </span>
            <span className={cn('text-xs tabular-nums', on ? 'text-accent-foreground/80' : 'text-muted-foreground')}>
              {s.planned ? `${s.done}/${s.planned}` : '—'}
            </span>
            <ShareBar value={s.planned ? (s.done / s.planned) * 100 : 0} tone={full ? 'success' : 'primary'} className="h-1" />
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   Annual plan
   ============================================================ */

/** خانة اليوم: سبوت الشهر ثابتة، و اليوم الإضافي يُختار من أيام الشهر الحرّة. */
function DayCell({ row, index, days, canEdit, onDate }) {
  const { t, i18n } = useTranslation();
  // An extra day stays changeable; the Saturdays of the month are fixed rows
  return row.extra && canEdit ? (
    <Select
      value={row.date}
      onChange={(e) => onDate(index, e.target.value)}
      aria-label={t('common.date')}
      className="h-11 sm:h-9"
    >
      {days.map((d) => (
        <option key={d} value={d}>
          {fmtDay(d, i18n.language)}
        </option>
      ))}
    </Select>
  ) : (
    <span className="flex items-baseline gap-2 leading-tight sm:flex-col sm:gap-0.5">
      <span className="text-sm font-semibold tabular-nums">{fmtDayMonth(row.date)}</span>
      <span className="text-xs text-muted-foreground">{fmtWeekday(row.date, i18n.language)}</span>
    </span>
  );
}

/** سطر تحت بند تغيّر منذ الاعتماد: ما كان في الخطة المعتمدة، و زرّ يعيده كما كان. */
function BaseNote({ base, removed, showDate, canEdit, onRestore, className }) {
  const { t, i18n } = useTranslation();
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', className)}>
      <Badge variant={removed ? 'destructive' : 'warning'}>
        {t(removed ? 'branch.planRemoved' : 'branch.planChanged')}
      </Badge>
      <span className="text-muted-foreground">
        {t('branch.planWas')} <span className="font-medium text-foreground">{base.title}</span>
        {showDate && <span className="tabular-nums"> · {fmtDay(base.date, i18n.language)}</span>}
      </span>
      {canEdit && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onRestore(base.id)}>
          <IconRefresh />
          {t('branch.planRestore')}
        </Button>
      )}
    </div>
  );
}

/**
 * صف واحد من الشهر: يوم + النشاط المبرمج فيه + حالته. على الهاتف اليوم و الحالة
 * في سطر، و العنوان تحتهما بعرض الشاشة كلّه — الخانة الضيّقة تقطع ما يُكتب.
 */
function PlanRow({ row, index, days, canEdit, validated, removedHere, today, onTitle, onDate, onRemove, onLink, onRestore }) {
  const { t } = useTranslation();
  const changed = differsFromBase(row);
  const planned = !!row.title.trim();
  // A past day whose نشاط never happened reads differently from one still ahead
  const late = planned && !row.session && row.date < today;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:px-5 sm:py-2.5">
      <div className="min-w-0 sm:col-start-1 sm:row-start-1">
        <DayCell row={row} index={index} days={days} canEdit={canEdit} onDate={onDate} />
      </div>

      <div className="flex items-center justify-end gap-1.5 sm:col-start-3 sm:row-start-1">
        {/* أُضيف بعد اعتماد الخطة */}
        {validated && !row.base && planned && <Badge variant="info">{t('branch.planAdded')}</Badge>}
        {row.session ? (
          <Link
            to={`/sessions/${row.session.id}`}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/12 px-2.5 py-0.5 text-xs font-medium text-success hover:bg-success/20"
          >
            <IconCheck className="h-3 w-3" />
            {fmtDate(row.session.date)}
          </Link>
        ) : planned ? (
          <span className={cn('inline-flex items-center gap-1 text-xs', late ? 'font-medium text-warning' : 'text-muted-foreground')}>
            <IconClock className="h-3.5 w-3.5" />
            {t('branch.planNotDone')}
          </span>
        ) : (
          !canEdit && <span className="text-xs text-muted-foreground">{t('branch.planFree')}</span>
        )}
        {/* الربط اليدوي: نشاط أُنشئ باسم آخر لا يلتقطه التطابق بالاسم، فيُربط من هنا.
            يحتاج بندًا محفوظًا — صف لم يُحفظ بعد لا id له يُربط به. */}
        {canEdit && row.id && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onLink(row)}
            aria-label={t('branch.planLink')}
            title={t('branch.planLink')}
          >
            <IconLink />
          </Button>
        )}
        {canEdit && row.extra && (
          <Button size="icon-sm" variant="ghost" onClick={() => onRemove(index)} aria-label={t('common.delete')}>
            <IconTrash />
          </Button>
        )}
      </div>

      <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        {canEdit ? (
          <Input
            value={row.title}
            onChange={(e) => onTitle(index, e.target.value)}
            placeholder={t('branch.planActivityHint')}
            autoComplete="off"
            className="h-11 sm:h-9"
            aria-label={`${t('branch.planActivity')} — ${fmtDayMonth(row.date)}`}
          />
        ) : (
          <span className="text-sm">{row.title || <span className="text-muted-foreground">—</span>}</span>
        )}
      </div>

      {changed && (
        <BaseNote
          base={row.base}
          removed={!planned}
          showDate={row.date !== row.base.date}
          canEdit={canEdit}
          onRestore={onRestore}
          className="col-span-2 sm:col-start-2"
        />
      )}
      {!changed && removedHere && (
        <BaseNote
          base={removedHere}
          removed
          canEdit={canEdit}
          onRestore={onRestore}
          className="col-span-2 sm:col-start-2"
        />
      )}
    </li>
  );
}

/**
 * حال اعتماد الخطة: مسودّة، أو معتمدة مع نسبة الالتزام بها و ما تغيّر منذ اعتمادها.
 * الاعتماد و سحبه للمسؤول وحده، كما في الخادم.
 */
function ValidationBar({ plan, isAdmin, busy, onValidate, onUnvalidate }) {
  const { t } = useTranslation();
  const v = plan.validation;
  const sum = plan.summary;
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3',
        v ? 'border-success/25 bg-success/8' : 'border-warning/30 bg-warning/10'
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          v ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
        )}
      >
        {v ? <IconCheck className="h-4 w-4" /> : <IconClock className="h-4 w-4" />}
      </span>
      <div className="min-w-48 flex-1 space-y-2 pt-1">
        <p className="text-sm font-medium leading-snug">
          {v
            ? t('branch.planValidated', { date: fmtDate(v.validated_at.slice(0, 10)), by: v.validated_by || '—' })
            : t('branch.planDraft')}
        </p>
        {v ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={sum.respect === 100 ? 'success' : 'warning'}>
              {t('branch.planRespect')} · {sum.respect ?? 0}%
            </Badge>
            <Badge variant="outline">{t('branch.planCountSame', { count: sum.same, total: sum.validated_total })}</Badge>
            {sum.changed > 0 && <Badge variant="warning">{t('branch.planCountChanged', { count: sum.changed })}</Badge>}
            {sum.removed > 0 && (
              <Badge variant="destructive">{t('branch.planCountRemoved', { count: sum.removed })}</Badge>
            )}
            {sum.added > 0 && <Badge variant="info">{t('branch.planCountAdded', { count: sum.added })}</Badge>}
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">{t('branch.planValidateHint')}</p>
        )}
      </div>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          {v && (
            <Button size="sm" variant="ghost" onClick={onUnvalidate} disabled={busy}>
              {t('branch.planUnvalidate')}
            </Button>
          )}
          <Button
            size="sm"
            variant={v ? 'outline' : 'brand'}
            onClick={onValidate}
            loading={busy}
            disabled={!v && plan.total === 0}
          >
            <IconCheck />
            {t(v ? 'branch.planRevalidate' : 'branch.planValidate')}
          </Button>
        </div>
      )}
    </div>
  );
}

// أخطاء الربط التي لها ترجمة خاصة؛ ما عداها يُعرض كما جاء من السيرفر
const LINK_ERRORS = { session_outside_year: 'branch.planLinkOutsideYear' };

/**
 * اختيار نشاط موجود لربطه ببند من الخطة. القائد أحيانًا يُنشئ النشاط باسم مختلف عن
 * اسم البند، فلا يلتقطه التطابق بالاسم و يبقى البند "لم يُنفَّذ بعد" رغم إنجازه؛ هنا
 * يُربط الاثنان يدويًا بعد إنشائهما، دون تعديل الخطة و لا إعادة تسمية النشاط.
 */
function LinkSessionDialog({ branchId, year, item, onClose, onDone }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const res = useFetch(`/branches/${branchId}/plan/sessions?year=${encodeURIComponent(year)}`);
  // فكّ الربط لا معنى له إلا لبند رُبط عمدًا: المطابق بالاسم ليس مربوطًا أصلًا
  const linked = item.session?.linked ? item.session : null;

  const all = res.data?.sessions || [];
  const needle = q.trim().toLowerCase();
  const list = needle ? all.filter((s) => String(s.title).toLowerCase().includes(needle)) : all;

  async function pick(sessionId) {
    setBusy(sessionId ?? 'none');
    try {
      const fresh = await api.put(`/branches/${branchId}/plan/${item.id}/session`, {
        session_id: sessionId,
      });
      onDone(fresh);
      toast.success(t('common.saved'));
      onClose();
    } catch (err) {
      toast.error(LINK_ERRORS[err.message] ? t(LINK_ERRORS[err.message]) : err.message);
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t('branch.planLinkTitle')}
      description={`${fmtDay(item.date, i18n.language)} — ${item.title}`}
    >
      <div className="space-y-3">
        {linked && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-success/25 bg-success/8 px-3 py-2">
            <div className="min-w-0 text-sm">
              <span className="text-muted-foreground">{t('branch.planLinkCurrent')}</span>{' '}
              <span className="font-medium">{linked.title}</span>{' '}
              <span className="tabular text-muted-foreground">({fmtDate(linked.date)})</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => pick(null)} loading={busy === 'none'}>
              <IconUnlink />
              {t('branch.planUnlink')}
            </Button>
          </div>
        )}

        <SearchInput value={q} onChange={setQ} placeholder={t('branch.planLinkSearch')} autoFocusHotkey={false} />

        {res.loading && <Skeleton className="h-40" />}
        {res.error && (
          <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />
        )}

        {res.data &&
          (list.length === 0 ? (
            <EmptyState icon={<IconCalendar />} title={t('branch.planLinkEmpty')} />
          ) : (
            <ul className="max-h-[45dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {list.map((s) => {
                const current = s.id === linked?.id;
                // مربوط ببند آخر: الاختيار ينقله، فيُعرض بندُه الحالي قبل الضغط
                const elsewhere = s.plan_item_id && s.plan_item_id !== item.id ? s.plan_title : null;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={current || busy !== null}
                      onClick={() => pick(s.id)}
                      className="focus-ring flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent"
                    >
                      <span className="tabular w-16 shrink-0 text-xs text-muted-foreground sm:w-24 sm:text-sm">
                        {fmtDate(s.date)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.title}</span>
                      {current ? (
                        <Badge variant="success">
                          <IconCheck className="h-3 w-3" />
                          {t('branch.planLinkCurrentShort')}
                        </Badge>
                      ) : elsewhere ? (
                        <Badge variant="outline" className="hidden max-w-[10rem] shrink-0 sm:inline-flex">
                          <span className="min-w-0 truncate">
                            {t('branch.planLinkedTo', { title: elsewhere })}
                          </span>
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}

        <p className="text-xs leading-relaxed text-muted-foreground">{t('branch.planLinkHint')}</p>
      </div>
    </Dialog>
  );
}

/**
 * الخطة السنوية لفرقة واحدة، شهرًا بشهر: سبوت الشهر جاهزة كصفوف، القائد يكتب اسم
 * النشاط في كل سطر و يحفظ الشهر دفعة واحدة، و يضيف أي يوم آخر عند الحاجة.
 * التحقيق يُحسب في السيرفر: بند الخطة يخضرّ متى رُبط به نشاط أو أُنشئ نشاط بنفس الاسم.
 * `onChange` يُنبّه الصفحة بعد كل حفظ (حال الخطة على بطاقات الفرق)، و `onDirtyChange`
 * يُعلمها بمسودّة غير محفوظة قبل أن يُنقل القائد إلى فرقة أخرى.
 */
function AnnualPlan({ branchId, onChange, onDirtyChange }) {
  const { t } = useTranslation();
  const { can } = usePerms();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const confirm = useConfirm();
  const [validating, setValidating] = useState(false);
  const toast = useToast();
  const [year, setYear] = useState('');
  // Opens on the month the قائد is living in, not on أيلول
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // البند المفتوح في نافذة الربط — بالـ id لا بالصف، ليبقى مقروءًا من آخر خطة محمّلة
  const [linkId, setLinkId] = useState(null);
  const res = useFetch(`/branches/${branchId}/plan${year ? `?year=${encodeURIComponent(year)}` : ''}`);
  const canEdit = can('branches.plan');
  const today = toISO(new Date());

  const plan = res.data;
  const key = plan ? monthKey(plan.year, month) : null;

  // The draft is rebuilt whenever the month or the saved plan changes: every سبت is
  // offered even when empty, saved days join them, and the whole month sorts by date.
  useEffect(() => {
    if (!plan || !key) return;
    setRows(monthRows(plan.items, key));
    setDirty(false);
  }, [plan, key]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Every server answer is the whole plan: it replaces the local one, and the page
  // refreshes what it shows about it
  function setPlan(fresh) {
    res.setData(fresh);
    onChange?.();
  }

  const edit = (fn) => {
    setRows(fn);
    setDirty(true);
  };
  const setTitle = (i, v) => edit((r) => r.map((x, n) => (n === i ? { ...x, title: v } : x)));
  const setDate = (i, v) => edit((r) => r.map((x, n) => (n === i ? { ...x, date: v } : x)));
  const removeRow = (i) => edit((r) => r.filter((_, n) => n !== i));

  // A new day defaults to the first day of the month nothing is planned on yet
  function addDay() {
    const taken = new Set(rows.map((r) => r.date));
    const free = daysOf(key).find((d) => !taken.has(d));
    if (!free) return;
    edit((r) =>
      [...r, { id: null, date: free, title: '', session: null, extra: true }].sort((a, b) =>
        a.date.localeCompare(b.date)
      )
    );
  }

  async function save() {
    setSaving(true);
    try {
      const fresh = await api.put(`/branches/${branchId}/plan/month`, {
        year: plan.year,
        month: key,
        items: rows
          .filter((r) => r.date && r.title.trim())
          .map((r) => ({ ...(r.id ? { id: r.id } : {}), date: r.date, title: r.title.trim() })),
      });
      setPlan(fresh);
      setDirty(false);
      toast.success(t('common.saved'));
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // الانتقال إلى شهر أو سنة أخرى يعيد بناء الصفوف، فيُحفظ الشهر المعدَّل أولًا —
  // كما في الربط و الإرجاع أدناه — و يبقى القائد مكانه إن فشل الحفظ.
  async function goMonth(m) {
    if (m === month) return;
    if (dirty && !(await save())) return;
    setMonth(m);
  }
  async function goYear(y) {
    if (y === plan.year) return;
    if (dirty && !(await save())) return;
    setYear(y);
  }

  // الربط يعيد الخطة من السيرفر فتُبنى الصفوف من جديد و تضيع التعديلات غير المحفوظة،
  // لذلك يُحفظ الشهر أولًا إن كان معدَّلًا — و لا تُفتح النافذة إن فشل الحفظ.
  async function openLink(row) {
    if (dirty && !(await save())) return;
    setLinkId(row.id);
  }

  // إرجاع بند كما اعتُمد — بعد حفظ المسودّة، للسبب نفسه
  async function restore(baselineId) {
    if (dirty && !(await save())) return;
    try {
      setPlan(await api.post(`/branches/${branchId}/plan/restore`, { baseline_id: baselineId }));
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  // الاعتماد يصوّر الخطة المحفوظة: ما في المسودّة يُحفظ أولًا
  async function validate() {
    if (
      plan.validation &&
      !(await confirm({ title: t('branch.planRevalidate'), message: t('branch.planRevalidateConfirm') }))
    )
      return;
    if (dirty && !(await save())) return;
    setValidating(true);
    try {
      setPlan(await api.post(`/branches/${branchId}/plan/validate`, { year: plan.year }));
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err.message === 'plan_empty' ? t('branch.planEmptyError') : err.message);
    } finally {
      setValidating(false);
    }
  }

  async function unvalidate() {
    if (!(await confirm({ title: t('branch.planUnvalidate'), message: t('branch.planUnvalidateConfirm') })))
      return;
    setValidating(true);
    try {
      setPlan(await api.del(`/branches/${branchId}/plan/validate?year=${encodeURIComponent(plan.year)}`));
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setValidating(false);
    }
  }

  if (res.loading)
    return (
      <Card className="space-y-4 p-4 sm:p-5">
        <Skeleton className="h-10 w-2/5" />
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </Card>
    );
  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;
  if (!plan) return null;

  const linkItem = plan.items.find((i) => i.id === linkId) || null;
  // Days still selectable for an extra row: the free ones, plus the row's own date
  const takenDates = new Set(rows.filter((r) => !r.extra).map((r) => r.date));
  // بنود معتمدة حُذفت هذا الشهر: تحت صف يومها، أو تحت الجدول إن لم يبقَ لها صف
  const removedMonth = (plan.removed || []).filter((b) => key && b.date.startsWith(key));
  const removedAt = (row) => removedMonth.find((b) => b.date === row.date && row.base?.id !== b.id);
  const removedLoose = removedMonth.filter((b) => !rows.some((r) => r.date === b.date));
  // The open month counts from the draft, so a title typed shows on its bar at once
  const stats = monthStats(plan.items, plan.year).map((s) =>
    s.month === month
      ? { ...s, planned: rows.filter((r) => r.title.trim()).length, done: rows.filter((r) => r.title.trim() && r.session).length }
      : s
  );
  const monthFull = key && daysOf(key).every((d) => rows.some((r) => r.date === d));

  return (
    <div className="space-y-3">
      <Card>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{t('branch.planRate')}</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span dir="ltr" className="text-2xl font-bold tabular-nums">
                  {plan.total > 0 ? `${plan.rate}%` : '—'}
                </span>
                {plan.total > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {t('branch.planProgress', { done: plan.done_count, total: plan.total })}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select className="w-auto" value={plan.year} onChange={(e) => goYear(e.target.value)} aria-label={t('common.year')}>
                {plan.years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
              <ExportPdfButton kind="plan" id={branchId} query={`year=${encodeURIComponent(plan.year)}`} compact />
            </div>
          </div>
          {plan.total > 0 && <ProgressBar value={plan.rate} label={t('branch.planRate')} className="h-2" />}

          <ValidationBar
            plan={plan}
            isAdmin={isAdmin}
            busy={validating}
            onValidate={validate}
            onUnvalidate={unvalidate}
          />
        </div>

        <div className="border-t border-border p-3 sm:p-4">
          <MonthStrip stats={stats} value={month} onChange={goMonth} />
        </div>

        {rows.length === 0 ? (
          <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {t('branch.planEmptyMonth')}
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((row, i) => (
              <PlanRow
                key={`${row.id ?? 'new'}-${i}`}
                row={row}
                index={i}
                days={daysOf(key).filter((d) => d === row.date || !takenDates.has(d))}
                canEdit={canEdit}
                validated={!!plan.validation}
                removedHere={removedAt(row)}
                today={today}
                onTitle={setTitle}
                onDate={setDate}
                onRemove={removeRow}
                onLink={openLink}
                onRestore={restore}
              />
            ))}
          </ul>
        )}

        {removedLoose.length > 0 && (
          <ul className="space-y-2 border-t border-dashed border-border px-4 py-3 sm:px-5">
            {removedLoose.map((b) => (
              <li key={b.id}>
                <BaseNote base={b} removed showDate canEdit={canEdit} onRestore={restore} />
              </li>
            ))}
          </ul>
        )}

        {/* Sticks to the screen's bottom edge while a change waits: the save stays
            in reach from any row of a long month */}
        {canEdit && (
          <div
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-border bg-card px-4 py-3 sm:px-5',
              dirty && 'sticky bottom-[calc(var(--bottomnav-h)+0.5rem)] z-10 shadow-[0_-10px_20px_-16px_hsl(220_25%_12%/0.35)] lg:bottom-3'
            )}
          >
            <Button size="sm" variant="outline" onClick={addDay} disabled={monthFull}>
              <IconPlus />
              {t('branch.planAddDay')}
            </Button>
            <span className="grow" />
            {dirty && <span className="text-xs font-medium text-warning">{t('settings.unsaved')}</span>}
            <Button size="sm" variant="brand" onClick={save} loading={saving} disabled={!dirty}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Card>

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t('branch.planHint')}</p>

      {linkItem && (
        <LinkSessionDialog
          key={linkItem.id}
          branchId={branchId}
          year={plan.year}
          item={linkItem}
          onClose={() => setLinkId(null)}
          onDone={setPlan}
        />
      )}
    </div>
  );
}

/**
 * كل الخطط السنوية في صفحة واحدة: لكل فرقة حال اعتمادها و التزامها بها، ثم جدول
 * الشهر فرقةً بجانب فرقة — ما بقي كما اعتُمد، ما عُدِّل (و ماذا كان)، ما حُذف، ما أُضيف.
 */
function PlansOverview({ onOpenBranch }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [year, setYear] = useState('');
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const res = useFetch(`/plans/overview${year ? `?year=${encodeURIComponent(year)}` : ''}`);
  const data = res.data;
  const key = data ? monthKey(data.year, month) : null;

  // الأيام: كل يوم فيه بند أو بند معتمد محذوف عند أي فرقة
  const dates = data
    ? [
        ...new Set(
          data.branches.flatMap((b) => [...b.items, ...b.removed].map((i) => i.date).filter((d) => d.startsWith(key)))
        ),
      ].sort()
    : [];
  const stats = data ? monthStats(data.branches.flatMap((b) => b.items), data.year) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t('branch.planAllSubtitle')}</p>
        {data && (
          <Select className="w-auto" value={data.year} onChange={(e) => setYear(e.target.value)} aria-label={t('common.year')}>
            {data.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        )}
      </div>

      {res.loading && <Skeleton className="h-64 rounded-2xl" />}
      {res.error && <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />}

      {data && (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {data.branches.map((b) => {
                const sum = b.summary;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => onOpenBranch(b.id)}
                      className="focus-ring grid w-full cursor-pointer items-center gap-x-6 gap-y-2 px-4 py-3.5 text-start transition-colors hover:bg-accent/40 sm:grid-cols-[minmax(8rem,1fr)_minmax(10rem,1.4fr)_minmax(0,1.6fr)] sm:px-5"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{branchName(b, lng)}</span>
                        {b.total > 0 && (
                          <Badge variant={b.validation ? 'success' : 'warning'}>
                            {t(b.validation ? 'branch.planValidatedShort' : 'branch.planDraftShort')}
                          </Badge>
                        )}
                      </span>
                      {b.total > 0 ? (
                        <span className="flex items-center gap-3">
                          <ShareBar value={b.rate} className="flex-1" />
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {t('branch.planProgress', { done: b.done_count, total: b.total })}
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t('branch.planFree')}</span>
                      )}
                      <span className="flex flex-wrap gap-1.5 sm:justify-end">
                        {b.validation && (
                          <>
                            <Badge variant={sum.respect === 100 ? 'success' : 'warning'}>
                              {t('branch.planRespect')} · {sum.respect ?? 0}%
                            </Badge>
                            {sum.changed > 0 && (
                              <Badge variant="warning">{t('branch.planCountChanged', { count: sum.changed })}</Badge>
                            )}
                            {sum.removed > 0 && (
                              <Badge variant="destructive">{t('branch.planCountRemoved', { count: sum.removed })}</Badge>
                            )}
                            {sum.added > 0 && <Badge variant="info">{t('branch.planCountAdded', { count: sum.added })}</Badge>}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-3 sm:p-4">
              <MonthStrip stats={stats} value={month} onChange={setMonth} />
            </div>

            {dates.length === 0 ? (
              <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t('branch.planFree')}
              </p>
            ) : (
              // الجدول وحده يمرّ أفقيًا على الهاتف، لا الصفحة؛ عمود التاريخ يبقى ظاهرًا
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[40rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
                      <th scope="col" className="sticky start-0 bg-muted px-4 py-2.5 text-start font-medium sm:px-5">
                        {t('common.date')}
                      </th>
                      {data.branches.map((b) => (
                        <th key={b.id} scope="col" className="px-3 py-2.5 text-start font-medium">
                          {branchName(b, lng)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dates.map((d) => (
                      <tr key={d} className="align-top">
                        <th
                          scope="row"
                          className="sticky start-0 whitespace-nowrap bg-card px-4 py-2.5 text-start font-normal sm:px-5"
                        >
                          <span className="block font-semibold tabular-nums">{fmtDayMonth(d)}</span>
                          <span className="block text-xs text-muted-foreground">{fmtWeekday(d, lng)}</span>
                        </th>
                        {data.branches.map((b) => {
                          const item = b.items.find((i) => i.date === d);
                          const gone = b.removed.find((r) => r.date === d);
                          return (
                            <td key={b.id} className="space-y-1 px-3 py-2.5">
                              {item && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {item.done && <IconCheck className="h-3.5 w-3.5 shrink-0 text-success" />}
                                  <span className="font-medium">{item.title}</span>
                                  {item.changed && <Badge variant="warning">{t('branch.planChanged')}</Badge>}
                                  {b.validation && !item.base && <Badge variant="info">{t('branch.planAdded')}</Badge>}
                                </div>
                              )}
                              {item?.changed && (
                                <div className="text-xs text-muted-foreground">
                                  {t('branch.planWas')} {item.base.title}
                                  {item.base.date !== item.date && ` · ${fmtDay(item.base.date, lng)}`}
                                </div>
                              )}
                              {gone && (
                                <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                                  <span className="line-through">{gone.title}</span>
                                  <Badge variant="destructive">{t('branch.planRemoved')}</Badge>
                                </div>
                              )}
                              {!item && !gone && <span className="text-muted-foreground">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/* ============================================================
   Activities
   ============================================================ */

/** حضور نشاط: النسبة، و «حاضر من مسجَّل»، و شريط يقرأ بلمحة. */
function AttendanceMeter({ present, total }) {
  const { t } = useTranslation();
  if (!total)
    return <span className="max-w-24 shrink-0 text-end text-xs text-muted-foreground">{t('session.notMarked')}</span>;
  const pct = Math.round((present / total) * 100);
  return (
    <span
      role="img"
      aria-label={t('member.presentOf', { present, total })}
      className="flex w-20 shrink-0 flex-col gap-1.5 sm:w-32"
    >
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <RateValue rate={pct} />
        <span className="tabular-nums text-muted-foreground" dir="ltr">
          {present}/{total}
        </span>
      </span>
      <ShareBar value={pct} tone="success" />
    </span>
  );
}

const KIND_BADGE = {
  visit: ['warning', 'session.kindVisit'],
  group: ['info', 'session.kindGroup'],
};

/** A نشاط row: date, title and attendance always visible, participants unfolded on demand. */
function SessionRow({ s }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const excused = s.excused?.length || 0;
  const kind = KIND_BADGE[s.kind];

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/40 sm:gap-4 sm:px-5"
      >
        <span className="flex w-14 shrink-0 flex-col items-center rounded-lg border border-border bg-muted/40 px-1 py-1.5 text-center">
          <span className="text-lg font-bold leading-none tabular-nums">{Number(s.date.slice(8, 10))}</span>
          <span className="mt-1 text-[0.6875rem] leading-tight text-muted-foreground">{fmtShortMonth(s.date, i18n.language)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-medium leading-snug sm:line-clamp-1">{s.title}</span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {kind && <Badge variant={kind[0]}>{t(kind[1])}</Badge>}
            {s.leader && <span className="truncate">{s.leader}</span>}
          </span>
        </span>
        {s.kind === 'visit' ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t('session.visitedCount', { count: s.present.length })}
          </span>
        ) : (
          <AttendanceMeter present={s.present.length} total={s.present.length + s.absent.length + excused} />
        )}
        <IconChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4 sm:pe-5 sm:ps-[5.75rem]">
          {s.matalib.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">{t('branch.matalib')}:</span>{' '}
              <span dir="ltr">{s.matalib.join(' · ')}</span>
            </div>
          )}
          {s.animators.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">{t('branch.animators')}:</span>{' '}
              {s.animators.map(memberName).join(' · ')}
            </div>
          )}
          {s.present.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('branch.noParticipants')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {s.present.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/members/${m.id}`}
                    className="focus-ring flex min-h-10 items-center gap-2 rounded-full border border-border bg-card py-1 pe-3 ps-1 text-xs transition-colors hover:border-primary/35 hover:bg-accent sm:min-h-8"
                  >
                    <Avatar photo={m.photo} name={avatarName(m)} className="h-6 w-6 text-[0.625rem]" />
                    {memberName(m)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {s.absent.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-destructive">{t('session.absent')}:</span>{' '}
              {s.absent.map(memberName).join(' · ')}
            </p>
          )}
          <Link
            to={`/sessions/${s.id}`}
            className="focus-ring inline-block rounded text-xs font-medium text-primary hover:underline"
          >
            {t('branch.openSession')}
          </Link>
        </div>
      )}
    </li>
  );
}

/** أنشطة of the selected فرقة, newest first, paged so a long history stays usable. */
function BranchSessions({ branchId }) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(10);
  const [query, setQuery] = useState('');
  const res = useFetch(`/branches/${branchId}/sessions`);

  if (res.loading)
    return (
      <Card className="space-y-3 p-4 sm:p-5">
        <Skeleton className="h-11" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </Card>
    );
  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;

  const all = res.data || [];
  if (all.length === 0)
    return (
      <Card>
        <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('session.noSessions')} />
      </Card>
    );

  // Search covers what a قائد would look for: the نشاط, its date, its animator,
  // and the names of who took part — so "find the outing Yassine went to" works.
  const q = query.trim().toLowerCase();
  const sessions = !q
    ? all
    : all.filter((s) =>
        [
          s.title,
          s.date,
          s.leader,
          ...s.present.map(memberName),
          ...s.absent.map(memberName),
          ...s.animators.map(memberName),
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-3 sm:p-4">
        <SearchInput
          value={query}
          onChange={(v) => {
            setQuery(v);
            setLimit(10);
          }}
          autoFocusHotkey={false}
          placeholder={t('branch.searchSessions')}
        />
      </div>
      {sessions.length === 0 ? (
        <EmptyState icon={<IconCalendar className="h-6 w-6" />} title={t('common.noResults')} />
      ) : (
        <ul className="divide-y divide-border">
          {sessions.slice(0, limit).map((s) => (
            <SessionRow key={s.id} s={s} />
          ))}
        </ul>
      )}
      {sessions.length > limit && (
        <div className="border-t border-border p-3 text-center sm:p-4">
          <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + 20)}>
            {t('branch.showMore', { count: sessions.length - limit })}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ============================================================
   الطلائع
   ============================================================ */

/**
 * طلائع الفرقة و توزيع عناصرها.
 *
 * الفرقة الكبيرة لا تسعها الحصّة الواحدة، و قد يعطي كل طليعةٍ قائدٌ آخر نشاطًا
 * مختلفًا: فتُقسَّم إلى طلائع يُوزَّع عليها العناصر بالاسم، ثم يختار النشاط
 * طلائعه عند إنشائه. التوزيع يُحفظ فور تغييره — صفّ واحد لكل عنصر، فلا زرّ حفظ
 * ينتظر إلى آخر القائمة و لا خطر ضياع ما وُزِّع قبله.
 */
function BranchGroups({ branchId }) {
  const { t } = useTranslation();
  const { can } = usePerms();
  const toast = useToast();
  const confirm = useConfirm();
  const res = useFetch(`/branches/${branchId}/groups`);
  const canEdit = can('branches.groups');
  // null = مغلق، { id, name } = إعادة تسمية، { name } = طليعة جديدة
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [query, setQuery] = useState('');
  // '' = الكل، 'none' = بلا طليعة، أو رقم طليعة
  const [filter, setFilter] = useState('');
  // العناصر المؤشَّرة، و الطليعة التي سيُنقلون إليها. الاختيار يبقى عبر البحث و
  // الفلترة: القائد يجمع أسماءه من عدّة بحثات ثم ينقلهم دفعة واحدة.
  const [picked, setPicked] = useState(() => new Set());
  const [target, setTarget] = useState('');
  const [moving, setMoving] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // فتح نافذة التوزيع من الصفر: بحث فارغ و لا تأشير، فما بقي من جلسة سابقة لا يفاجئ
  function openAssign(startFilter = '') {
    setQuery('');
    setFilter(startFilter);
    setPicked(new Set());
    setAssigning(true);
  }

  function openEditor(group) {
    setDialogError(null);
    setEditing(group);
  }

  const groups = res.data?.groups || [];
  const members = res.data?.members || [];
  const activeCount = members.filter((m) => m.status === 'active').length;
  const unassigned = members.filter((m) => !m.group_id && m.status === 'active').length;

  async function saveGroup(e) {
    e.preventDefault();
    setDialogError(null);
    setSaving(true);
    try {
      const body = { name: editing.name };
      if (editing.id) await api.put(`/branches/${branchId}/groups/${editing.id}`, body);
      else await api.post(`/branches/${branchId}/groups`, body);
      setEditing(null);
      toast.success(t(editing.id ? 'branch.groupSaved' : 'branch.groupCreated'));
      res.reload({ quiet: true });
    } catch (err) {
      setDialogError(err.message === 'group_exists' ? t('branch.groupExists') : err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeGroup(g) {
    if (!(await confirm({ title: t('branch.groupDelete'), message: t('branch.groupDeleteConfirm', { name: g.name }) })))
      return;
    try {
      await api.del(`/branches/${branchId}/groups/${g.id}`);
      if (String(filter) === String(g.id)) setFilter('');
      if (String(target) === String(g.id)) setTarget('');
      toast.success(t('branch.groupDeleted'));
      res.reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  function togglePick(id) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // «تأشير الكل» لا يمسّ إلا الأسماء المعروضة الآن، فالبحث يضيّق ما يُؤشَّر بدل أن
  // يؤشِّر بصمت أسماءً لا يراها أحد.
  function toggleAllShown(ids, allPicked) {
    setPicked((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (allPicked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  // نقل المؤشَّرين دفعة واحدة. طلب واحد للجميع: توزيع فرقة من تسعين عنصرًا لا يحتمل
  // طلبًا لكل اسم. الردّ يُعيد تحميل القائمة، فالأعداد تُصحَّح من الخادم لا من الظنّ.
  async function moveSelected() {
    // عنصر رُفّع أو حُذف بينما كان مؤشَّرًا يسقط من الدفعة: الخادم يرفض الطلب كلّه
    // إن حوى اسمًا خرج من الفرقة، فلا يُرسَل ما لم يعد في القائمة.
    const ids = [...picked].filter((id) => members.some((m) => m.id === id));
    if (!ids.length) return;
    setMoving(true);
    try {
      await api.post(`/branches/${branchId}/groups/assign`, {
        member_ids: ids,
        group_id: target === '' ? null : Number(target),
      });
      setPicked(new Set());
      toast.success(t('branch.groupMoved', { count: ids.length }));
      res.reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
      res.reload({ quiet: true });
    } finally {
      setMoving(false);
    }
  }

  if (res.loading)
    return (
      <Card className="space-y-3 p-4 sm:p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </Card>
    );
  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;

  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => {
    if (filter === 'none' ? m.group_id : filter && String(m.group_id) !== String(filter)) return false;
    return !q || memberName(m).toLowerCase().includes(q);
  });
  const shownIds = shown.map((m) => m.id);
  const allShownPicked = shownIds.length > 0 && shownIds.every((id) => picked.has(id));
  const share = (n) => (activeCount ? (n / activeCount) * 100 : 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-border p-4 sm:p-5">
        <p className="min-w-60 flex-1 text-sm leading-relaxed text-muted-foreground">{t('branch.groupsHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {groups.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => openAssign()}>
              <IconUsers />
              {t(canEdit ? 'branch.groupAssignOpen' : 'branch.groupAssignView')}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="brand" onClick={() => openEditor({ name: '' })}>
              <IconPlus />
              {t('branch.groupNew')}
            </Button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={<IconUsers className="h-6 w-6" />} title={t('branch.groupsEmpty')}>
          {t('branch.groupsEmptyHint')}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="grid min-w-0 flex-1 items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,20rem)]">
                <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {t('branch.groupMembers', { count: g.member_count })}
                  </p>
                </div>
                <ShareBar value={share(g.member_count)} />
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t('branch.groupRename')} — ${g.name}`}
                    title={t('branch.groupRename')}
                    onClick={() => openEditor({ id: g.id, name: g.name })}
                  >
                    <IconPencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t('branch.groupDelete')} — ${g.name}`}
                    title={t('branch.groupDelete')}
                    onClick={() => removeGroup(g)}
                  >
                    <IconTrash />
                  </Button>
                </div>
              )}
            </li>
          ))}

          {/* بلا طليعة: أول ما يُبحث عنه عند التوزيع، فالسطر يفتح النافذة عليهم وحدهم */}
          <li className="flex items-center gap-3 bg-muted/30 px-4 py-3 sm:px-5">
            {unassigned > 0 ? (
              <>
                <div className="grid min-w-0 flex-1 items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,20rem)]">
                  <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
                    <p className="truncate font-medium text-warning">{t('branch.groupNone')}</p>
                    <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {t('branch.groupMembers', { count: unassigned })}
                    </p>
                  </div>
                  <ShareBar value={share(unassigned)} tone="warning" />
                </div>
                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => openAssign('none')}>
                  {t(canEdit ? 'branch.groupAssignOpen' : 'branch.groupAssignView')}
                </Button>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-success">
                <IconCheck className="h-4 w-4" />
                {t('branch.groupAllAssigned')}
              </p>
            )}
          </li>
        </ul>
      )}

      <Dialog
        open={assigning}
        onClose={() => setAssigning(false)}
        title={t('branch.groupAssignTitle')}
        description={t('branch.groupAssignHint')}
        size="lg"
      >
        {/* البحث و الفلترة يلتصقان بالأعلى، و شريط النقل بالأسفل: الاسم المؤشَّر في
            وسط قائمة طويلة لا يفرض صعودًا و لا نزولًا. */}
        <div className="sticky -top-4 z-10 -mx-4 flex flex-wrap gap-2 bg-card px-4 pb-2 pt-1 sm:-top-5 sm:-mx-5 sm:px-5">
          <SearchInput
            value={query}
            onChange={setQuery}
            autoFocusHotkey={false}
            placeholder={t('branch.groupSearch')}
          />
          <Select
            className="w-auto"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={t('branch.groupsTitle')}
          >
            <option value="">{t('branch.groupAll')}</option>
            <option value="none">{t('branch.groupNone')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>

        {shown.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">{t('common.noResults')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {canEdit && (
              <li>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium sm:min-h-10">
                  <input
                    type="checkbox"
                    checked={allShownPicked}
                    onChange={() => toggleAllShown(shownIds, allShownPicked)}
                  />
                  {t('branch.groupSelectAll', { count: shown.length })}
                </label>
              </li>
            )}
            {shown.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                {canEdit ? (
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={picked.has(m.id)}
                      onChange={() => togglePick(m.id)}
                    />
                    <Avatar photo={m.photo} name={avatarName(m)} className="h-8 w-8" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {memberName(m)}
                      {m.status !== 'active' && (
                        <span className="ms-1.5 text-xs text-muted-foreground">
                          ({t('member.inactive')})
                        </span>
                      )}
                    </span>
                  </label>
                ) : (
                  <>
                    <Avatar photo={m.photo} name={avatarName(m)} className="h-8 w-8" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {memberName(m)}
                    </span>
                  </>
                )}
                <Badge variant="outline" className="max-w-24 shrink">
                  <span className="truncate">
                    {groups.find((g) => g.id === m.group_id)?.name || t('branch.groupNone')}
                  </span>
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {canEdit && picked.size > 0 && (
          <div className="sticky -bottom-4 z-10 -mx-4 mt-2 flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-2.5 sm:-bottom-5 sm:-mx-5 sm:px-5">
            <span className="text-sm font-medium">
              {t('branch.groupSelected', { count: picked.size })}
            </span>
            <span className="hidden grow sm:block" />
            <Select
              className="w-auto"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={t('branch.groupMoveTo')}
            >
              <option value="">{t('branch.groupNone')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="brand" loading={moving} onClick={moveSelected}>
              {t('branch.groupMove')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t(editing?.id ? 'branch.groupRename' : 'branch.groupNew')}
        size="sm"
      >
        <form onSubmit={saveGroup} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group_name">{t('branch.groupName')}</Label>
            <Input
              id="group_name"
              required
              autoFocus
              maxLength={60}
              placeholder={t('branch.groupNamePlaceholder')}
              value={editing?.name || ''}
              onChange={(e) => setEditing((g) => ({ ...g, name: e.target.value }))}
            />
          </div>
          {dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="brand" disabled={saving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

/* ============================================================
   المطالب
   ============================================================ */

/** مطالب الفرقة: ما عمل عليه أيّ نشاط منها، رقمًا رقمًا — و ما لم يُلمس بعد. */
function BranchMatalib({ b }) {
  const { t } = useTranslation();
  const { covered, covered_count: count, total } = b.matalib;
  if (!total)
    return (
      <Card>
        <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('branch.matalibEmpty')} />
      </Card>
    );
  const pct = Math.round((count / total) * 100);
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('branch.matalibHint')}</p>
          <p className="text-sm tabular-nums">
            <span className="font-semibold">
              {count}/{total}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span dir="ltr" className="text-muted-foreground">
              {pct}%
            </span>
          </p>
        </div>
        <ProgressBar value={pct} label={t('branch.matalibProgress')} className="h-2" />
      </div>
      <RequirementGrid total={total} selected={covered} label={t('branch.matalibProgress')} />
    </Card>
  );
}

/* ============================================================
   Page
   ============================================================ */

/** Plan status mark on a فرقة tile: approved, or still a draft. */
function PlanMark({ plan }) {
  const { t } = useTranslation();
  if (!plan?.total) return null;
  const ok = !!plan.validation;
  const label = `${t('branch.planTitle')}: ${t(ok ? 'branch.planValidatedShort' : 'branch.planDraftShort')}`;
  return (
    <span
      title={label}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
        ok ? 'bg-success/12 text-success' : 'bg-warning/15 text-warning'
      )}
    >
      {ok ? <IconCheck className="h-3 w-3" /> : <IconClock className="h-3 w-3" />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

const tileClass = (on) =>
  cn(
    'focus-ring flex min-w-[9rem] flex-1 shrink-0 snap-start cursor-pointer flex-col justify-between gap-4 rounded-xl border p-3 text-start transition-[border-color,background-color,box-shadow] duration-150',
    on
      ? 'border-primary bg-card shadow-sm ring-1 ring-primary'
      : 'border-border bg-card shadow-xs hover:border-primary/35 hover:bg-accent/40'
  );

/** One فرقة in the switcher: it selects, and it compares at a glance. */
function BranchTile({ b, plan, selected, onSelect }) {
  const { t, i18n } = useTranslation();
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={tileClass(selected)}>
      <span className="flex w-full items-center justify-between gap-2">
        <span className={cn('truncate text-sm font-semibold', selected && 'text-primary')}>
          {branchName(b, i18n.language)}
        </span>
        <PlanMark plan={plan} />
      </span>
      <span className="flex w-full items-end justify-between gap-3">
        <span className="leading-none">
          <span className="block text-2xl font-bold leading-none tabular-nums">{b.members.active}</span>
          <span className="mt-1.5 block text-xs text-muted-foreground">{t('settings.members')}</span>
        </span>
        <span className="text-end leading-none">
          <span className="block text-sm leading-none">
            <RateValue rate={b.attendance.rate} />
          </span>
          <span className="mt-1.5 block text-xs text-muted-foreground">{t('member.attendance')}</span>
        </span>
      </span>
    </button>
  );
}

/** Name, ages, last نشاط and the قادة of the selected فرقة. */
function BranchHead({ b }) {
  const { t, i18n } = useTranslation();
  // Empty مسؤوليات are hidden here: this page answers "who leads this فرقة", not "what is missing"
  const leaders = b.leaders.filter((l) => l.leader_id);
  return (
    <section aria-labelledby="branch-name" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="branch-name" className="text-2xl font-bold tracking-tight">
            {branchName(b, i18n.language)}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{agesLabel(b, t)}</span>
            {b.last_session && (
              <>
                <span aria-hidden="true" className="hidden sm:inline">
                  ·
                </span>
                <span className="basis-full sm:basis-auto">
                  {t('branch.lastSession')}:{' '}
                  {/* dir="auto" isolates an Arabic title in the French line, or bidi pulls
                      the date that follows in front of it */}
                  <Link
                    to={`/sessions/${b.last_session.id}`}
                    dir="auto"
                    className="focus-ring rounded font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {b.last_session.title}
                  </Link>{' '}
                  <span className="tabular-nums">({fmtDate(b.last_session.date)})</span>
                </span>
              </>
            )}
          </p>
        </div>
        <ExportPdfButton kind="branches" id={b.id} compact className="shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-xs font-medium text-muted-foreground">
          {t('branch.leaders')}
          {b.year && <span className="tabular-nums"> · {b.year}</span>}
        </span>
        {leaders.length === 0 ? (
          <span className="text-sm text-muted-foreground">{t('branch.noLeaders')}</span>
        ) : (
          leaders.map((l) => (
            <Link
              key={l.id}
              to={`/leaders/${l.leader_id}`}
              className="focus-ring flex min-h-11 items-center gap-2 rounded-full border border-border bg-card py-1 pe-3 ps-1 shadow-xs transition-colors hover:border-primary/35 hover:bg-accent sm:min-h-9"
            >
              <Avatar photo={l.photo} name={avatarName(l)} className="h-7 w-7 text-[0.625rem]" />
              <span className="text-sm font-medium">{memberName(l)}</span>
              {l.title && <span className="text-xs text-muted-foreground">{l.title}</span>}
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

/** The four numbers a قائد checks first — the عنصر profile's figures strip, for a فرقة. */
function BranchFigures({ b }) {
  const { t } = useTranslation();
  const { covered_count: covered, total } = b.matalib;
  return (
    <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
      <Stat label={t('branch.members')}>
        <p className="text-2xl font-bold tabular-nums">{b.members.active}</p>
        <p className="text-xs text-muted-foreground">
          {t('branch.sexSplit', { male: b.members.male, female: b.members.female })}
        </p>
      </Stat>
      <Stat label={t('branch.activities')}>
        <p className="text-2xl font-bold tabular-nums">{b.sessions_count}</p>
        <p className="text-xs text-muted-foreground">{t('branch.thisMonth', { count: b.sessions_month })}</p>
      </Stat>
      <Stat label={t('branch.attendanceRate')}>
        <p>
          <RateValue rate={b.attendance.rate} className="text-2xl font-bold" />
        </p>
        <p className="text-xs text-muted-foreground">
          {t('branch.presentAbsent', { present: b.attendance.present, absent: b.attendance.absent })}
        </p>
      </Stat>
      <Stat label={t('branch.matalib')}>
        <p className="text-2xl font-bold tabular-nums">
          {covered}
          {total > 0 && <span className="text-base font-medium text-muted-foreground"> / {total}</span>}
        </p>
        {total > 0 && <ShareBar value={(covered / total) * 100} className="mt-1" />}
      </Stat>
    </Card>
  );
}

/**
 * Tabs of the selected فرقة. Each panel mounts on its first visit and then stays,
 * hidden: going to the أنشطة and back must not throw away a month typed but not saved.
 */
function BranchPanels({ b, tab, onTab, onPlanChange, onPlanDirty }) {
  const { t, i18n } = useTranslation();
  const seen = useRef(new Set());
  seen.current.add(tab);
  const panel = (id, node) => seen.current.has(id) && <div hidden={tab !== id}>{node}</div>;

  return (
    <div className="space-y-4">
      <UnderlineTabs
        items={[
          { id: 'plan', label: t('branch.planTitle') },
          { id: 'sessions', label: t('branch.activities') },
          { id: 'groups', label: t('branch.groupsTitle') },
          { id: 'matalib', label: t('branch.matalib') },
        ]}
        value={tab}
        onChange={onTab}
        label={branchName(b, i18n.language)}
        idPrefix="branch-tab"
        panelId="branch-panel"
      />
      <div id="branch-panel" role="tabpanel" aria-labelledby={`branch-tab-${tab}`}>
        {panel('plan', <AnnualPlan branchId={b.id} onChange={onPlanChange} onDirtyChange={onPlanDirty} />)}
        {panel('sessions', <BranchSessions branchId={b.id} />)}
        {panel('groups', <BranchGroups branchId={b.id} />)}
        {panel('matalib', <BranchMatalib b={b} />)}
      </div>
    </div>
  );
}

function BranchesSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-9 w-40" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[5.75rem] min-w-[8.75rem] flex-1 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

export default function Branches() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const res = useFetch('/branches/overview');
  // Plan status of every فرقة, for the tiles. Optional: without it the tiles just
  // lose their mark.
  const plans = useFetch('/plans/overview');
  const [selectedId, setSelectedId] = useLocalStorage('branches.selected', null);
  const { view: onScreen, setView } = useSection();
  const [storedTab, setTab] = useLocalStorage('branches.tab', 'plan');
  const tab = TABS.includes(storedTab) ? storedTab : 'plan';
  // فرقة جديدة إعدادٌ بنيوي كالأعمار و المطالب: للأدمن وحده، كما في الخادم
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [creating, setCreating] = useState(false);
  // A month typed but not saved, in the open فرقة's plan: switching فرقة would lose it
  const planDirty = useRef(false);
  // Stable: the plan reports through it from an effect
  const onPlanDirty = useCallback((v) => {
    planDirty.current = v;
  }, []);

  if (res.loading) return <BranchesSkeleton />;
  if (res.error)
    return <ErrorState message={t('error.loadFailed')} onRetry={res.reload} retryLabel={t('error.retry')} />;

  const newBranchButton = isAdmin && (
    <Button variant="brand" onClick={() => setCreating(true)}>
      <IconPlus />
      {t('settings.newBranch')}
    </Button>
  );
  const newBranchDialog = isAdmin && (
    <NewBranchDialog
      open={creating}
      onClose={() => setCreating(false)}
      onCreated={(created) => {
        setCreating(false);
        // Made for the other قسم than the one on screen: follow it there. Switching
        // remounts this page, so the pick goes straight to storage for the new one.
        if (onScreen && created.section !== onScreen) {
          try {
            localStorage.setItem('branches.selected', JSON.stringify(created.id));
          } catch {
            /* the new page just opens on its first فرقة */
          }
          setView(created.section);
          return;
        }
        // Opens on the new فرقة: it is the one about to be set up
        setSelectedId(created.id);
        res.reload({ quiet: true });
        plans.reload({ quiet: true });
      }}
    />
  );

  const branches = res.data || [];
  if (branches.length === 0)
    return (
      <div className="space-y-6">
        <PageHeader title={t('branch.pageTitle')} description={t('branch.pageSubtitle')}>
          {newBranchButton}
        </PageHeader>
        <Card>
          <EmptyState icon={<IconInbox className="h-6 w-6" />} title={t('dashboard.noBranches')} />
        </Card>
        {newBranchDialog}
      </div>
    );

  // One فرقة at a time. A stale saved id (فرقة deleted) falls back to the first one.
  // 'all' = كل الخطط السنوية جنبًا إلى جنب
  const showAll = selectedId === 'all';
  const b = branches.find((x) => x.id === selectedId) || branches[0];
  const planOf = (id) => plans.data?.branches.find((p) => p.id === id);
  const validatedCount = plans.data?.branches.filter((p) => p.validation).length;

  async function select(id) {
    if (id === (showAll ? 'all' : b.id)) return;
    if (
      planDirty.current &&
      !(await confirm({
        title: t('settings.unsaved'),
        message: t('branch.planLeaveConfirm'),
        confirmLabel: t('branch.planLeave'),
      }))
    )
      return;
    planDirty.current = false;
    setSelectedId(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('branch.pageTitle')} description={t('branch.pageSubtitle')}>
        {newBranchButton}
      </PageHeader>

      {/* Swiped sideways on a phone; a grid from tablet up, where a mouse has no swipe
          and a hidden scrollbar would leave the last فرق out of reach */}
      <div
        role="group"
        aria-label={t('branch.pageTitle')}
        className="no-scrollbar relative -mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] sm:overflow-visible sm:p-0"
      >
        {branches.map((x) => (
          <BranchTile
            key={x.id}
            b={x}
            plan={planOf(x.id)}
            selected={!showAll && x.id === b.id}
            onSelect={() => select(x.id)}
          />
        ))}
        <button type="button" aria-pressed={showAll} onClick={() => select('all')} className={tileClass(showAll)}>
          <span className={cn('flex items-center gap-1.5 text-sm font-semibold', showAll && 'text-primary')}>
            <IconCalendar className="h-4 w-4 shrink-0" />
            <span className="truncate">{t('branch.planAll')}</span>
          </span>
          <span className="leading-none">
            <span className="block text-2xl font-bold leading-none tabular-nums">
              {plans.data ? `${validatedCount}/${plans.data.branches.length}` : '—'}
            </span>
            <span className="mt-1.5 block text-xs text-muted-foreground">{t('branch.planValidatedShort')}</span>
          </span>
        </button>
      </div>

      {showAll ? (
        <div className="pt-2">
          <PlansOverview
            onOpenBranch={(id) => {
              setTab('plan');
              select(id);
            }}
          />
        </div>
      ) : (
        <div key={b.id} className="space-y-6 pt-2">
          <BranchHead b={b} />
          <BranchFigures b={b} />
          <BranchPanels
            b={b}
            tab={tab}
            onTab={setTab}
            onPlanChange={() => plans.reload({ quiet: true })}
            onPlanDirty={onPlanDirty}
          />
        </div>
      )}

      {newBranchDialog}
    </div>
  );
}
