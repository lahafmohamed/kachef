import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useNavigationType } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePerms } from '../auth';
import { useDebounced, useFetch, useLocalStorage, useUrlField, useUrlFilters } from '../hooks';
import { avatarName, birthdayWhen, branchName, fmtDate, fmtPhone, memberName } from '../utils';
import DateRangePicker from '../components/DateRangePicker';
import ExportPdfButton from '../components/ExportPdfButton';
import FilterChips from '../components/FilterChips';
import FilterSelect from '../components/FilterSelect';
import MemberFormDialog from '../components/MemberForm';
import {
  AttendanceStrip,
  RateValue,
  UnderlineTabs,
  callLabel,
  contactsOf,
  telHref,
  whoLabel,
} from '../components/MemberParts';
import SearchInput from '../components/SearchInput';
import SearchSelect from '../components/SearchSelect';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Th,
  cn,
  IconAlert,
  IconCake,
  IconFilter,
  IconPencil,
  IconPhone,
  IconPin,
  IconPlus,
  IconSchool,
  IconSort,
  IconUsers,
} from '../components/ui';

// Filters the server applies, named as the API names them: the page URL and the
// request share one vocabulary, and the PDF export takes the same query as is.
const SERVER_FILTERS = [
  'school',
  'residence',
  'residence_lebanon',
  'blood',
  'age_min',
  'age_max',
  'parent_phone',
  'joined_from',
  'joined_to',
  // ما ينقص الملفّ: 'any' (ما يعدّه الملفّ «بيانات ناقصة») أو حقل بعينه
  'missing',
  // '1' = للمتابعة: ثلاث غيابات متتالية أو أكثر
  'follow',
];
// Everything the page keeps in its URL — so «back» from a profile lands on the
// same فرقة, طليعة and search instead of the whole فوج.
const URL_KEYS = ['branch', 'group', 'status', 'q', ...SERVER_FILTERS];

// The fields a قائد goes looking for when completing files: the profile's own
// «بيانات ناقصة» list, then فصيلة الدم. Contact fields only for who may read them.
const MISSING_FIELDS = [
  { value: 'birth_date', key: 'member.birthDate' },
  { value: 'father_name', key: 'member.fatherName' },
  { value: 'school', key: 'member.school' },
  { value: 'parent_phone', key: 'member.parentPhone', contact: true },
  { value: 'residence', key: 'member.residence', contact: true },
  { value: 'blood', key: 'member.bloodType' },
];

const SCROLL_KEY = 'members.scroll';

// The leaders endpoint has no age; the list sorts and shows one
const yearsSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 31557600000) : null);

/** Mixed scripts in one line («13 سنة · برية · Alghadir»): each part keeps its own direction. */
// A short part stays whole: on two lines, «طليعة / الذئاب» read as two facts. A long
// free-text one (a school, an address) may still break, rather than run off the row.
function Parts({ parts }) {
  return parts.filter(Boolean).map((p, i) => (
    <span key={i}>
      {i > 0 && ' · '}
      <bdi className={String(p).length <= 24 ? 'whitespace-nowrap' : undefined}>{p}</bdi>
    </span>
  ));
}

/**
 * One line of the register. The whole row opens the profile; the name is the real
 * link (keyboard, screen readers, open-in-new-tab) and the phone and pencil keep
 * their own clicks. Columns appear with the card's width, not the viewport's.
 */
function RosterRow({ m, lang, t, whereMode, canModify, onEdit, onOpen }) {
  const isChef = m.kind === 'leader';
  const inactive = m.status !== 'active';
  const href = isChef ? `/leaders/${m.id}` : `/members/${m.id}`;
  const name = memberName(m);
  const a = m.attendance;
  const bday = birthdayWhen(m.birth_date);
  const absences = !isChef && !inactive && a?.absences >= 3 ? a.absences : 0;
  const contacts = contactsOf(m);
  const primary = contacts[0];
  const age = m.age != null ? `${m.age} ${t('common.years')}` : null;
  const branchLabel = isChef ? t('branch.leaders') : branchName(m, lang);
  // What tells two «Ali Ahmad» apart: école and quartier; for a قائد, their roles
  const details = isChef ? (m.roles || []).map((r) => r.title) : [m.school, m.address_abidjan];
  // فرقة / طليعة: a column on wide cards, folded into the line under the name on phones
  const where = whereMode === 'branch' ? [branchLabel, m.group_name] : whereMode === 'group' ? [m.group_name] : [];

  return (
    <tr
      onClick={(e) => {
        if (e.target.closest('a, button') || window.getSelection()?.toString()) return;
        onOpen(href);
      }}
      className="group cursor-pointer transition-colors hover:bg-accent/40"
    >
      {/* w-full + max-w-0: the name column takes what the others leave, and a long
          line truncates inside it instead of widening the whole table */}
      <td className="w-full max-w-0 py-3 ps-4 pe-2 @2xl:py-2.5">
        <div className="flex items-center gap-3">
          <Avatar
            photo={m.photo}
            name={avatarName(m)}
            // Neutral initials: 200 teal discs would outshout the attendance colours
            className={cn(
              'h-10 w-10 bg-secondary text-secondary-foreground @2xl:h-8 @2xl:w-8 @2xl:text-[0.6875rem]',
              inactive && 'opacity-60 grayscale'
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* dir="auto": a Latin name in the Arabic UI keeps its own order */}
              <Link
                to={href}
                dir="auto"
                className={cn(
                  'focus-ring line-clamp-2 rounded-sm text-[0.9375rem] font-medium leading-5 group-hover:text-primary @2xl:text-sm',
                  inactive && 'text-muted-foreground'
                )}
              >
                {name}
              </Link>
              {bday && (
                <Badge variant="warning">
                  <IconCake className="h-3 w-3" />
                  {t(`birthday.${bday}`)}
                </Badge>
              )}
              {inactive && <Badge variant="secondary">{t('member.inactive')}</Badge>}
            </div>
            {/* Phones: age and طليعة fold in here; wider cards give them columns. Two
                lines: on one, a 360px screen cut the طليعة to «طليعة ا…» */}
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground @2xl:hidden">
              <Parts parts={[age, ...where, ...details]} />
            </div>
            {details.some(Boolean) && (
              <div className="mt-0.5 hidden truncate text-xs text-muted-foreground @2xl:block">
                <Parts parts={details} />
              </div>
            )}
          </div>
        </div>
      </td>

      <td className="hidden whitespace-nowrap px-3 text-sm tabular-nums @2xl:table-cell">
        {m.age ?? <span className="text-muted-foreground">—</span>}
      </td>

      {whereMode !== 'none' && (
        <td className="hidden px-3 text-sm @2xl:table-cell">
          {where.filter(Boolean).length ? (
            <div className="min-w-0 leading-tight">
              <bdi className="block whitespace-nowrap">{where[0] || where[1]}</bdi>
              {whereMode === 'branch' && where[1] && (
                <bdi className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground">{where[1]}</bdi>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}

      <td className="px-2 @2xl:px-3">
        {isChef ? null : (
          // Phones: the rate over its marks. Wide: marks then rate on one line.
          <div className="flex flex-col items-end gap-1.5 @2xl:flex-row-reverse @2xl:items-center @2xl:justify-end @2xl:gap-2.5">
            <span className="inline-flex items-center gap-1">
              {/* Three absences in a row: the trailing rings already show it, the
                  mark makes it findable at a glance — a sentence on every such
                  row turned a فرقة at the start of the year into a wall of red */}
              {absences > 0 && (
                <span title={t('member.consecutiveAbsences', { count: absences })} className="text-destructive">
                  <IconAlert className="h-3.5 w-3.5" />
                  <span className="sr-only">{t('member.consecutiveAbsences', { count: absences })}</span>
                </span>
              )}
              <RateValue rate={a?.rate} className="text-sm" />
            </span>
            <AttendanceStrip recent={a?.recent} />
          </div>
        )}
      </td>

      <td className="hidden px-3 @4xl:table-cell">
        {contacts.length ? (
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5 whitespace-nowrap">
            {contacts.slice(0, 2).map((c) => (
              <div key={c.who} className="contents">
                <dt className="text-xs text-muted-foreground">{isChef ? '' : whoLabel(t, c.who)}</dt>
                <dd>
                  <a
                    href={telHref(c.numbers[0])}
                    dir="ltr"
                    aria-label={callLabel(t, c.who, name)}
                    className="focus-ring rounded-sm text-sm tabular-nums hover:text-primary hover:underline"
                  >
                    {fmtPhone(c.numbers[0])}
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Tap to call — the first number a قائد would try. Gone once the card is
          wide enough to list the numbers themselves. */}
      <td className="pe-2 @2xl:pe-1 @4xl:hidden">
        {primary && (
          <a
            href={telHref(primary.numbers[0])}
            aria-label={callLabel(t, primary.who, name)}
            title={
              isChef
                ? fmtPhone(primary.numbers[0])
                : `${whoLabel(t, primary.who)} · ${fmtPhone(primary.numbers[0])}`
            }
            className="focus-ring flex h-11 w-11 items-center justify-center rounded-lg text-primary transition-colors hover:bg-accent @2xl:h-9 @2xl:w-9"
          >
            <IconPhone />
          </a>
        )}
      </td>

      {canModify && (
        <td className="hidden pe-3 @2xl:table-cell">
          {!isChef && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(m)}
              aria-label={`${t('common.edit')} — ${name}`}
              title={t('common.edit')}
              className="text-muted-foreground hover:text-accent-foreground"
            >
              <IconPencil />
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}

function RosterSkeleton() {
  return (
    <div aria-hidden="true" className="divide-y divide-border">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full @2xl:h-8 @2xl:w-8" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export default function Members() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const navType = useNavigationType();
  // View-only accounts get the list without any add/edit affordance
  const { has } = usePerms();
  const canCreate = has('members.create');
  const canModify = has('members.edit');
  const canContact = has('members.contact');
  // Les chefs s'affichent dans la liste comme une branche à part entière
  const canSeeLeaders = has('leaders.read');

  const [sp, patch] = useUrlFilters();
  const param = (k) => sp.get(k) || '';

  const branch = param('branch'); // '' | فرقة id | 'leaders'
  const group = param('group'); // '' | طليعة id | 'none'
  const status = param('status'); // '' = فعّال | 'inactive' | 'all'
  const [q, setQ] = useUrlField(sp, patch, 'q');
  const [ageMin, setAgeMin] = useUrlField(sp, patch, 'age_min');
  const [ageMax, setAgeMax] = useUrlField(sp, patch, 'age_max');
  const [parentPhone, setParentPhone] = useUrlField(sp, patch, 'parent_phone');
  const f = {
    ...Object.fromEntries(SERVER_FILTERS.map((k) => [k, param(k)])),
    age_min: ageMin,
    age_max: ageMax,
    parent_phone: parentPhone,
  };
  const missingOptions = [
    { value: 'any', label: t('member.missingAny') },
    ...MISSING_FIELDS.filter((o) => !o.contact || canContact).map((o) => ({ value: o.value, label: t(o.key) })),
  ];
  // A link carrying a field this account may not read would filter nothing on the
  // server while its chip claimed otherwise: it is dropped here as well
  if (!missingOptions.some((o) => o.value === f.missing)) f.missing = '';
  if (f.follow !== '1') f.follow = '';
  // Sorting is a preference, not a filter: it survives from one visit to the next
  // (and the dashboard presets it before sending a قائد here)
  const [sort, setSort] = useLocalStorage('members.sort', 'name');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formFor, setFormFor] = useState(null); // null | 'new' | member

  const apiParams = new URLSearchParams();
  for (const k of SERVER_FILTERS) if (f[k].trim()) apiParams.set(k, f[k].trim());
  if (q.trim()) apiParams.set('q', q.trim());
  if (sort && sort !== 'name') apiParams.set('sort', sort);
  // فرقة, طليعة and status are cut on this side: one request fills every tab count
  const apiQuery = useDebounced(apiParams.toString(), 250);
  const members = useFetch(`/members?${apiQuery}`);
  const leaders = useFetch('/leaders', { skip: !canSeeLeaders });
  const branches = useFetch('/branches');
  // Distinct مدارس / أماكن سكن actually in the base — the filters only offer real values
  const filterValues = useFetch('/members/filters');

  const branchList = branches.data || [];
  const schools = filterValues.data?.schools || [];
  const residences = filterValues.data?.residences || [];
  const residencesLebanon = filterValues.data?.residencesLebanon || [];
  const bloodTypes = filterValues.data?.bloodTypes || [];

  // A stale or foreign id in the URL falls back to «all» rather than an empty page
  const currentBranch =
    branch === 'leaders'
      ? canSeeLeaders
        ? 'leaders'
        : ''
      : branch && branchList.length && !branchList.some((b) => String(b.id) === branch)
        ? ''
        : branch;
  const branchObj = branchList.find((b) => String(b.id) === currentBranch);
  const groups = branchObj?.groups || [];
  const currentGroup = groups.length ? group : '';

  const statusOk = (m) =>
    status === 'all' ? true : status === 'inactive' ? m.status !== 'active' : m.status === 'active';
  const groupOk = (m) =>
    !currentGroup || (currentGroup === 'none' ? m.group_id == null : String(m.group_id) === currentGroup);

  // What the collapsed panel hides — the button has to say it, or a filtered list
  // looks like a bug to whoever opens the page next
  const advancedCount = [
    f.school,
    f.residence,
    f.residence_lebanon,
    f.blood,
    f.age_min || f.age_max,
    f.parent_phone.trim(),
    f.joined_from || f.joined_to,
    f.missing,
    f.follow,
  ].filter(Boolean).length;
  const filterCount = advancedCount + (status ? 1 : 0);

  const allMembers = members.data || [];
  const inStatus = allMembers.filter(statusOk);

  // Les chefs rejoignent la liste comme une branche à part : même recherche, même
  // statut. Les filtres avancés décrivent des champs de membre — dès qu'un est
  // actif, les chefs sortent.
  const needle = useDebounced(q, 250).trim().toLowerCase();
  const chefRows =
    canSeeLeaders && !advancedCount
      ? (leaders.data || [])
          .filter(statusOk)
          .filter(
            (l) =>
              !needle ||
              [l.first_name, l.father_name, l.last_name].filter(Boolean).join(' ').toLowerCase().includes(needle) ||
              (l.phone || '').includes(needle)
          )
          .map((l) => ({ ...l, kind: 'leader', age: yearsSince(l.birth_date) }))
      : [];

  const perBranch = new Map();
  for (const m of inStatus) perBranch.set(String(m.branch_id), (perBranch.get(String(m.branch_id)) || 0) + 1);
  // Ready once every source has answered (or failed): عناصر landing before the
  // فرق would show a فرقة tab empty for a moment — and restore the scroll against
  // that short page
  const loaded =
    !!members.data &&
    !!(branches.data || branches.error) &&
    (!canSeeLeaders || !!(leaders.data || leaders.error));
  const tabs = [
    { id: '', label: t('member.tabAll'), count: loaded ? inStatus.length + chefRows.length : null },
    ...branchList.map((b) => ({
      id: String(b.id),
      label: branchName(b, lang),
      count: loaded ? perBranch.get(String(b.id)) || 0 : null,
    })),
    ...(canSeeLeaders ? [{ id: 'leaders', label: t('branch.leaders'), count: loaded ? chefRows.length : null }] : []),
  ];

  const inBranch = branchObj ? inStatus.filter((m) => String(m.branch_id) === currentBranch) : [];
  const unassigned = inBranch.filter((m) => m.group_id == null).length;
  const patrols = groups.length
    ? [
        { id: '', label: t('member.tabAll'), count: inBranch.length },
        ...groups.map((g) => ({
          id: String(g.id),
          label: g.name,
          count: inBranch.filter((m) => String(m.group_id) === String(g.id)).length,
        })),
        // «بلا طليعة» is the first thing a قائد looks for while distributing a فرقة
        ...(unassigned || currentGroup === 'none'
          ? [{ id: 'none', label: t('member.noGroup'), count: unassigned }]
          : []),
      ]
    : null;

  let list;
  if (currentBranch === 'leaders') list = chefRows;
  else if (currentBranch) list = inBranch.filter(groupOk);
  else {
    list = [...inStatus, ...chefRows];
    // Le serveur trie les membres ; la fusion ré-trie pour intercaler les chefs —
    // par nom de famille, comme le serveur, sinon l'onglet «Tous» et celui d'une
    // فرقة rangeraient les mêmes personnes dans deux ordres différents
    if (chefRows.length && inStatus.length) {
      const family = (m) => `${m.last_name || ''} ${m.first_name || ''}`;
      if (sort === 'age_desc') list.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
      else if (sort === 'age_asc') list.sort((a, b) => (a.age ?? 999) - (b.age ?? 999));
      else if (sort === 'name' || !sort) list.sort((a, b) => family(a).localeCompare(family(b)));
    }
  }

  // Inactive ones the default view leaves out, in the same فرقة / طليعة
  const hiddenInactive = status
    ? 0
    : allMembers.filter(
        (m) =>
          m.status !== 'active' &&
          (!currentBranch || (currentBranch !== 'leaders' && String(m.branch_id) === currentBranch && groupOk(m)))
      ).length;

  // The roster in one line: how many, how present, how many slipping away
  const kids = list.filter((m) => m.kind !== 'leader');
  const chefCount = list.length - kids.length;
  const presentSum = kids.reduce((s, m) => s + (m.attendance?.present || 0), 0);
  const markedSum = kids.reduce((s, m) => s + (m.attendance?.total || 0), 0);
  const rosterRate = markedSum ? Math.round((100 * presentSum) / markedSum) : null;
  const followCount = kids.filter((m) => m.status === 'active' && m.attendance?.absences >= 3).length;

  const scopeTitle =
    currentBranch === 'leaders'
      ? t('branch.leaders')
      : branchObj
        ? [
            branchName(branchObj, lang),
            currentGroup &&
              (currentGroup === 'none'
                ? t('member.noGroup')
                : groups.find((g) => String(g.id) === currentGroup)?.name),
          ]
            .filter(Boolean)
            .join(' · ')
        : t('member.allBranches');
  // Which «where» column the register needs: فرقة + طليعة across the فوج, the
  // طليعة inside a split فرقة, nothing inside one that is not split
  const whereMode = currentBranch === 'leaders' ? 'none' : !currentBranch ? 'branch' : groups.length ? 'group' : 'none';

  // The typed fields are reset directly too: within their 250ms the URL may not
  // hold what is in the box yet, and clearing an unchanged URL would not reach them
  const clearTyped = (keys) => {
    if (keys.includes('q')) setQ('');
    if (keys.includes('age_min')) setAgeMin('');
    if (keys.includes('age_max')) setAgeMax('');
    if (keys.includes('parent_phone')) setParentPhone('');
    patch(Object.fromEntries(keys.map((k) => [k, ''])));
  };
  const clearAll = () => clearTyped(URL_KEYS.filter((k) => k !== 'branch'));
  const clearAdvanced = () => clearTyped([...SERVER_FILTERS, 'status']);

  // Every active filter as a removable chip — the value is what the قائد picked.
  // `isolate`: a Latin value (O+, a school, a number) keeps its own direction in
  // the Arabic chip; ranges stay in the line's flow so they read low-to-high.
  const range = (a, b) => (a && b ? `${a} – ${b}` : a ? `≥ ${a}` : `≤ ${b}`);
  const chips = [
    status && {
      key: 'status',
      label: t('member.status'),
      value: t(status === 'inactive' ? 'member.inactive' : 'member.statusAll'),
      clear: () => patch({ status: '' }),
    },
    f.follow && {
      key: 'follow',
      label: t('member.attendance'),
      value: t('member.followOnly'),
      clear: () => patch({ follow: '' }),
    },
    f.missing && {
      key: 'missing',
      label: t('member.missingFilter'),
      value: missingOptions.find((o) => o.value === f.missing)?.label,
      clear: () => patch({ missing: '' }),
    },
    (f.age_min || f.age_max) && {
      key: 'age',
      label: t('member.ageRange'),
      value: range(f.age_min, f.age_max),
      clear: () => clearTyped(['age_min', 'age_max']),
    },
    f.blood && { key: 'blood', label: t('member.bloodType'), value: f.blood, isolate: true, clear: () => patch({ blood: '' }) },
    f.school && { key: 'school', label: t('member.school'), value: f.school, isolate: true, clear: () => patch({ school: '' }) },
    f.residence && {
      key: 'residence',
      label: t('member.residence'),
      value: f.residence,
      isolate: true,
      clear: () => patch({ residence: '' }),
    },
    f.residence_lebanon && {
      key: 'residence_lebanon',
      label: t('member.addressLebanon'),
      value: f.residence_lebanon,
      isolate: true,
      clear: () => patch({ residence_lebanon: '' }),
    },
    f.parent_phone.trim() && {
      key: 'parent_phone',
      label: t('member.parentPhone'),
      value: f.parent_phone,
      isolate: true,
      clear: () => clearTyped(['parent_phone']),
    },
    (f.joined_from || f.joined_to) && {
      key: 'joined',
      label: t('member.joinDate'),
      value: range(fmtDate(f.joined_from), fmtDate(f.joined_to)),
      clear: () => patch({ joined_from: '', joined_to: '' }),
    },
  ].filter(Boolean);

  // «Back» from a profile returns to the same row, not to the top of 200 names.
  // The position is tracked while scrolling: by the time the list unmounts, the
  // profile has already replaced it and the page may have clamped its height.
  const lastY = useRef(0);
  useEffect(() => {
    const onScroll = () => (lastY.current = window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      try {
        sessionStorage.setItem(SCROLL_KEY, String(lastY.current));
      } catch {
        /* private mode — the list simply opens at the top */
      }
    };
  }, []);
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !loaded) return;
    restored.current = true;
    if (navType !== 'POP') return;
    let y = 0;
    try {
      y = Number(sessionStorage.getItem(SCROLL_KEY)) || 0;
    } catch {
      /* ignore */
    }
    if (y) window.scrollTo({ top: y, behavior: 'instant' });
  }, [loaded, navType]);

  // Export: the same list as on screen — فرقة as the sheet's id, the rest as query
  const exportQuery = new URLSearchParams(apiParams);
  if (status !== 'all') exportQuery.set('status', status === 'inactive' ? 'inactive' : 'active');
  if (currentGroup) exportQuery.set('group', currentGroup);

  function afterSave() {
    setFormFor(null);
    members.reload({ quiet: true });
    // A new مدرسة / مكان سكن must show up in the filters right away
    filterValues.reload({ quiet: true });
  }

  const searching = !!(q.trim() || advancedCount || status);
  const refreshing = members.loading && !!members.data;

  return (
    <div className="space-y-4">
      <PageHeader title={t('member.title')}>
        {currentBranch === 'leaders' ? (
          <ExportPdfButton kind="leaders-list" id={0} compact />
        ) : (
          <ExportPdfButton
            kind="members-list"
            id={branchObj ? branchObj.id : 0}
            query={exportQuery.toString()}
            compact
          />
        )}
        {canCreate && (
          <Button variant="brand" onClick={() => setFormFor('new')}>
            <IconPlus />
            {t('member.addMember')}
          </Button>
        )}
      </PageHeader>

      <div className="space-y-3">
        <UnderlineTabs
          items={tabs}
          value={currentBranch}
          onChange={(id) => patch({ branch: id, group: '' })}
          label={t('member.branch')}
          idPrefix="members-tab"
          panelId="members-panel"
          // Its wrapper ends with the search row, before the list: it could only
          // stick for the height of the chips
          sticky={false}
        />

        {patrols && (
          <div role="group" aria-label={t('member.groups')} className="flex flex-wrap items-center gap-1.5">
            {patrols.map((c) => {
              const on = c.id === currentGroup;
              return (
                <button
                  key={c.id || 'all'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => patch({ group: c.id })}
                  className={cn(
                    'focus-ring inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors sm:h-8 sm:px-3 sm:text-xs',
                    on
                      ? 'border-primary/30 bg-accent text-accent-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  {c.label}
                  <span className={cn('tabular-nums', !on && 'opacity-70')}>{c.count}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder={t('member.searchAny')} className="min-w-0" />
          <Button
            variant={filtersOpen ? 'secondary' : 'outline'}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls="member-filters"
            aria-label={t('member.moreFilters')}
            className="shrink-0 px-3"
          >
            <IconFilter />
            <span className="hidden min-[400px]:inline">{t('member.moreFilters')}</span>
            {filterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] font-bold tabular-nums text-primary-foreground">
                {filterCount}
              </span>
            )}
          </Button>
          <FilterSelect
            value={sort}
            onChange={setSort}
            ariaLabel={t('member.sortBy')}
            className="hidden w-auto min-w-52 sm:flex"
            icon={<IconSort className="opacity-60" />}
            options={[
              { value: 'name', label: t('member.sortName') },
              { value: 'age_desc', label: t('member.sortAgeDesc') },
              { value: 'age_asc', label: t('member.sortAgeAsc') },
              { value: 'attendance', label: t('member.sortAttendance') },
              ...(schools.length ? [{ value: 'school', label: t('member.sortSchool') }] : []),
              ...(residences.length ? [{ value: 'residence', label: t('member.sortResidence') }] : []),
            ]}
          />
        </div>

        {filtersOpen && (
          <div id="member-filters" className="rounded-2xl border border-border bg-card p-4 shadow-xs">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* On phones the sort moves in here, off the crowded toolbar */}
              <div className="space-y-1.5 sm:hidden">
                <Label>{t('member.sortBy')}</Label>
                <FilterSelect
                  value={sort}
                  onChange={setSort}
                  ariaLabel={t('member.sortBy')}
                  icon={<IconSort className="opacity-60" />}
                  options={[
                    { value: 'name', label: t('member.sortName') },
                    { value: 'age_desc', label: t('member.sortAgeDesc') },
                    { value: 'age_asc', label: t('member.sortAgeAsc') },
                    { value: 'attendance', label: t('member.sortAttendance') },
                    ...(schools.length ? [{ value: 'school', label: t('member.sortSchool') }] : []),
                    ...(residences.length ? [{ value: 'residence', label: t('member.sortResidence') }] : []),
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('member.status')}</Label>
                <SegmentedControl
                  label={t('member.status')}
                  size="sm"
                  value={status || 'active'}
                  onChange={(v) => patch({ status: v === 'active' ? '' : v })}
                  className="flex w-full"
                  options={[
                    { value: 'active', label: t('member.active') },
                    { value: 'inactive', label: t('member.inactive') },
                    { value: 'all', label: t('member.statusAll') },
                  ]}
                />
              </div>
              {/* The dashboard's follow-up as a list: the same three-in-a-row streak,
                  so it can be cut by فرقة and exported as a calling sheet */}
              <div className="space-y-1.5">
                <Label>{t('member.attendance')}</Label>
                <SegmentedControl
                  label={t('member.attendance')}
                  size="sm"
                  value={f.follow ? 'follow' : 'all'}
                  onChange={(v) => patch({ follow: v === 'follow' ? '1' : '' })}
                  className="flex w-full"
                  options={[
                    { value: 'all', label: t('member.statusAll') },
                    { value: 'follow', label: t('member.followOnly') },
                  ]}
                />
                <p className="text-xs text-muted-foreground">{t('member.followHint')}</p>
              </div>
              {/* Files still to complete: what the profile counts as missing, field by field */}
              <div className="space-y-1.5">
                <Label>{t('member.missingFilter')}</Label>
                <FilterSelect
                  value={f.missing}
                  onChange={(v) => patch({ missing: v })}
                  allLabel={t('member.missingNone')}
                  ariaLabel={t('member.missingFilter')}
                  options={missingOptions}
                />
              </div>
              {/* Age is a range, not a value: "les 12-14 ans" is the actual question */}
              <div className="space-y-1.5">
                <Label htmlFor="f_age_min">{t('member.ageRange')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="f_age_min"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="99"
                    placeholder={t('member.ageMin')}
                    aria-label={`${t('member.ageRange')} — ${t('member.ageMin')}`}
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">–</span>
                  <Input
                    id="f_age_max"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="99"
                    placeholder={t('member.ageMax')}
                    aria-label={`${t('member.ageRange')} — ${t('member.ageMax')}`}
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('member.bloodType')}</Label>
                <FilterSelect
                  value={f.blood}
                  onChange={(v) => patch({ blood: v })}
                  allLabel={t('member.allBloodTypes')}
                  ariaLabel={t('member.bloodType')}
                  options={bloodTypes.map((bt) => ({ value: bt, label: bt }))}
                />
              </div>
              {/* Searchable: a فوج ends up with dozens of quartiers and schools */}
              {schools.length > 0 && (
                <div className="space-y-1.5">
                  <Label>{t('member.school')}</Label>
                  <SearchSelect
                    value={f.school}
                    onChange={(e) => patch({ school: e.target.value })}
                    options={schools}
                    clearLabel={t('member.allSchools')}
                    placeholder={t('member.allSchools')}
                    searchPlaceholder={t('common.search')}
                    emptyLabel={t('member.noListValue')}
                    ariaLabel={t('member.school')}
                    icon={<IconSchool className="opacity-60" />}
                  />
                </div>
              )}
              {residences.length > 0 && (
                <div className="space-y-1.5">
                  <Label>{t('member.residence')}</Label>
                  <SearchSelect
                    value={f.residence}
                    onChange={(e) => patch({ residence: e.target.value })}
                    options={residences}
                    clearLabel={t('member.allResidences')}
                    placeholder={t('member.allResidences')}
                    searchPlaceholder={t('common.search')}
                    emptyLabel={t('member.noListValue')}
                    ariaLabel={t('member.residence')}
                    icon={<IconPin className="opacity-60" />}
                  />
                </div>
              )}
              {residencesLebanon.length > 0 && (
                <div className="space-y-1.5">
                  <Label>{t('member.addressLebanon')}</Label>
                  <SearchSelect
                    value={f.residence_lebanon}
                    onChange={(e) => patch({ residence_lebanon: e.target.value })}
                    options={residencesLebanon}
                    clearLabel={t('member.allResidencesLebanon')}
                    placeholder={t('member.allResidencesLebanon')}
                    searchPlaceholder={t('common.search')}
                    emptyLabel={t('member.noListValue')}
                    ariaLabel={t('member.addressLebanon')}
                    icon={<IconPin className="opacity-60" />}
                  />
                </div>
              )}
              {/* The server ignores a phone filter from an account that may not read phones */}
              {canContact && (
                <div className="space-y-1.5">
                  <Label htmlFor="f_phone">{t('member.parentPhone')}</Label>
                  <Input
                    id="f_phone"
                    type="tel"
                    inputMode="tel"
                    // ltr once a number is typed; empty, the hint is a sentence in the page's language
                    dir={parentPhone ? 'ltr' : undefined}
                    placeholder={t('member.phoneFilterHint')}
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t('member.joinedBetween')}</Label>
                <DateRangePicker
                  value={{ from: f.joined_from, to: f.joined_to }}
                  onChange={({ from, to }) => patch({ joined_from: from, joined_to: to })}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
              {filterCount > 0 ? (
                <Button variant="ghost" size="sm" onClick={clearAdvanced} className="-ms-2">
                  {t('common.clearFilters')}
                </Button>
              ) : (
                <span />
              )}
              <Button variant="outline" size="sm" onClick={() => setFiltersOpen(false)}>
                {t('common.done')}
              </Button>
            </div>
          </div>
        )}

        <FilterChips chips={chips} onClearAll={clearAdvanced} />
      </div>

      {members.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={members.reload} retryLabel={t('error.retry')} />
      ) : (
        <Card
          id="members-panel"
          role="tabpanel"
          aria-labelledby={`members-tab-${currentBranch}`}
          aria-busy={members.loading || undefined}
          // relative: the sr-only labels inside are absolutely positioned, and
          // must be clipped here rather than stretch the page
          className="@container relative overflow-hidden"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">{scopeTitle}</h2>
            {loaded && list.length > 0 && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {[
                    kids.length > 0 && t('member.rosterCount', { count: kids.length }),
                    chefCount > 0 && t('member.rosterLeaders', { count: chefCount }),
                  ]
                    .filter(Boolean)
                    .join(t('member.listSep'))}
                </span>
                {rosterRate !== null && (
                  <>
                    {' · '}
                    {t('member.attendance')}{' '}
                    <RateValue rate={rosterRate} />
                  </>
                )}
                {/* The count is also the way in: one tap lists exactly those عناصر */}
                {followCount > 0 && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      aria-pressed={!!f.follow}
                      title={t('member.followHint')}
                      onClick={() => patch({ follow: f.follow ? '' : '1' })}
                      className="focus-ring inline-flex min-h-11 cursor-pointer items-center rounded-sm font-medium text-destructive underline-offset-2 hover:underline sm:min-h-0"
                    >
                      {t('member.rosterFollow', { count: followCount })}
                    </button>
                  </>
                )}
              </p>
            )}
          </div>

          {!loaded ? (
            <RosterSkeleton />
          ) : list.length === 0 ? (
            searching ? (
              <EmptyState
                icon={<IconUsers className="h-6 w-6" />}
                title={t('common.noResults')}
                action={
                  <Button variant="outline" onClick={clearAll}>
                    {t('common.clearFilters')}
                  </Button>
                }
              >
                {t('common.noResultsHint')}
              </EmptyState>
            ) : (
              <EmptyState
                icon={<IconUsers className="h-6 w-6" />}
                title={branchObj ? t('member.emptyIn', { name: scopeTitle }) : t('member.noMembers')}
                action={
                  canCreate && currentBranch !== 'leaders' ? (
                    <Button variant="brand" onClick={() => setFormFor('new')}>
                      <IconPlus />
                      {t('member.addMember')}
                    </Button>
                  ) : null
                }
              >
                {/* «Register the first عنصر of the فوج» only when the فوج is empty */}
                {currentBranch ? null : t('member.noMembersHint')}
              </EmptyState>
            )
          ) : (
            <table className={cn('w-full text-sm transition-opacity', refreshing && 'opacity-60')}>
              <thead className="hidden border-b border-border bg-muted/40 @2xl:table-header-group">
                <tr>
                  <Th className="ps-4">{t('member.name')}</Th>
                  <Th>{t('member.age')}</Th>
                  {whereMode !== 'none' && <Th>{t(whereMode === 'branch' ? 'member.branch' : 'member.group')}</Th>}
                  <Th>{t('member.recentTitle')}</Th>
                  <Th className="hidden @4xl:table-cell">{t('member.phones')}</Th>
                  <Th className="@4xl:hidden">
                    <span className="sr-only">{t('member.call')}</span>
                  </Th>
                  {canModify && (
                    <Th className="pe-3">
                      <span className="sr-only">{t('common.actions')}</span>
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((m) => (
                  // Un chef et un membre peuvent partager le même id numérique
                  <RosterRow
                    key={`${m.kind || 'member'}-${m.id}`}
                    m={m}
                    lang={lang}
                    t={t}
                    whereMode={whereMode}
                    canModify={canModify}
                    onEdit={setFormFor}
                    onOpen={navigate}
                  />
                ))}
              </tbody>
            </table>
          )}

          {loaded && hiddenInactive > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-2 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
              {t('member.inactiveHidden', { count: hiddenInactive })}
              <button
                type="button"
                onClick={() => patch({ status: 'all' })}
                className="focus-ring min-h-11 cursor-pointer rounded px-1 font-medium text-primary hover:underline sm:min-h-0"
              >
                {t('member.showInactive')}
              </button>
            </div>
          )}
        </Card>
      )}

      <MemberFormDialog
        open={formFor !== null}
        member={formFor === 'new' ? null : formFor}
        // A registration from a فرقة tab lands in that فرقة (and طليعة)
        defaults={{
          ...(branchObj && { branch_id: branchObj.id }),
          ...(branchObj && currentGroup && currentGroup !== 'none' && { group_id: currentGroup }),
        }}
        onClose={() => setFormFor(null)}
        onSaved={afterSave}
      />
    </div>
  );
}
