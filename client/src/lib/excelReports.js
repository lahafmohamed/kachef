import { api } from '../api';
import { phoneNumbers } from '../components/MemberParts';
import { workbookBlob } from './excel';
import { gendered, isOverdue, timeRange } from './meetings';
import { FLOWS, INCOME_SOURCES, OUT_CATEGORIES, OUT_FIGURES, boxName, ledgerView, rowText } from './treasury';
import {
  LEADER_FILTER_KEYS,
  activityTypeKey,
  branchName,
  filterLeaders,
  fmtAmount,
  fmtDate,
  fmtPhone,
  fmtTime,
  memberName,
  todayISO,
} from '../utils';

/**
 * The Excel twin of every PDF sheet (pages/PrintReport.jsx): the same kinds, the same
 * ids and query strings, read from the same API under the same session — so a file
 * holds what its PDF holds, as cells to sort and filter. A list gets the columns a
 * spreadsheet wants (dates of birth, phones, figures) where the paper only had room
 * for a few; a card becomes a summary sheet, then one sheet per table.
 */

const LABELS = {
  sessions: 'print.reportSession',
  members: 'print.reportMember',
  leaders: 'print.reportLeader',
  branches: 'print.reportBranch',
  promotions: 'print.reportPromotions',
  'members-list': 'print.reportMembersList',
  'leaders-list': 'print.reportLeadersList',
  'sessions-list': 'print.reportSessionsList',
  'prep-list': 'print.reportPrepList',
  plan: 'print.reportPlan',
  prep: 'print.reportPrep',
  treasury: 'print.reportTreasury',
  'branch-money': 'print.reportBranchMoney',
  meeting: 'print.reportMeeting',
  'meetings-list': 'print.reportMeetingsList',
  'meeting-decisions': 'print.reportMeetingDecisions',
};

const SESSION_KIND_KEYS = {
  activity: 'session.kindActivity',
  visit: 'session.kindVisit',
  leaders: 'session.kindLeaders',
  group: 'session.kindGroup',
};

const STATUS_KEYS = { present: 'session.present', absent: 'session.absent', excused: 'session.excused' };

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const rate = (num, den) => (den ? Math.round((num / den) * 100) : null);
const sum = (list, of) => list.reduce((n, x) => n + (Number(of(x)) || 0), 0);

/**
 * A table from a list: each column says how to read a row. A falsy column is left
 * out, so a column that only some files carry is a plain condition. `total`: a last
 * row adding up the columns marked `sum`, labelled in the column marked `labelled`, else
 * the first text column. `empty`:
 * what the sheet says when there is no row, as the page would.
 */
function table(items, columns, { heading, total, empty } = {}) {
  const cols = columns.filter(Boolean);
  const marked = cols.findIndex((c) => c.labelled);
  const labelAt = marked >= 0 ? marked : cols.findIndex((c) => !c.type || c.type === 'text');
  return {
    heading,
    empty,
    columns: cols.map(({ label, type }) => ({ label, type })),
    rows: items.map((x, i) => cols.map((c) => c.value(x, i))),
    ...(total &&
      items.length > 0 && {
        total: cols.map((c, i) => (c.sum ? sum(items, (x) => c.value(x)) : i === labelAt ? total : null)),
      }),
  };
}

/** What every builder reads its words and numbers with */
function tools({ t, lng }) {
  const sep = t('member.listSep');
  return {
    sep,
    list: (values) => values.filter(Boolean).join(sep) || null,
    num: { label: t('excel.number'), type: 'int', value: (_, i) => i + 1 },
    status: (st) => t(STATUS_KEYS[st] || 'session.unmarked'),
    active: (st) => t(st === 'active' ? 'member.active' : 'member.inactive'),
    sex: (sex) => (sex ? t(sex === 'M' ? 'member.male' : 'member.female') : null),
    role: (role) => (role ? t(role === 'main' ? 'session.mainAnimator' : 'session.helper') : null),
    kind: (kind) => t(SESSION_KIND_KEYS[kind] || SESSION_KIND_KEYS.activity),
    branch: (obj) => branchName(obj, lng) || null,
    // Every number of a field, each in pairs: a cell may hold two
    phones: (raw) =>
      phoneNumbers(raw)
        .map((n) => fmtPhone(n))
        .join(' / ') || null,
  };
}

/** Present / absent / excused / untouched counts of a roster, with its rate */
function countStatuses(list) {
  const c = { present: 0, absent: 0, excused: 0, unmarked: 0 };
  for (const p of list) c[p.status && c[p.status] !== undefined ? p.status : 'unmarked']++;
  const marked = c.present + c.absent + c.excused;
  return { ...c, marked, rate: rate(c.present, marked) };
}

/** The فرقة a list is about: id 0 means all of them */
async function listBranch(id, { t, lng }) {
  const branches = await api.get('/branches');
  const all = id === '0';
  const b = branches.find((x) => String(x.id) === id);
  if (!all && !b) throw notFound();
  return { all, branches, name: all ? t('member.allBranches') : branchName(b, lng) };
}

/* ============================================================
   Lists
   ============================================================ */

async function membersList(ctx) {
  const { id, sp, t, can, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const { all, name } = await listBranch(id, ctx);
  const qs = new URLSearchParams(sp);
  if (!all) qs.set('branch', id);
  const list = await api.get(`/members?${qs}`);
  // Contacts reach only an account allowed to read them: without it, no empty columns
  const contact = can('members.contact');
  return {
    title: name,
    sheets: [
      {
        name: t('member.title'),
        title: name,
        lines: [`${kindLabel} · ${t('print.membersInGroup', { count: list.length })}`, stamp],
        blocks: [
          table(
            list,
            [
              x.num,
              { label: t('member.name'), value: memberName },
              { label: t('member.birthDate'), type: 'date', value: (m) => m.birth_date },
              { label: t('member.age'), type: 'int', value: (m) => m.age },
              { label: t('member.sex'), value: (m) => x.sex(m.sex) },
              all && { label: t('member.branch'), value: x.branch },
              { label: t('member.group'), value: (m) => m.group_name },
              { label: t('member.status'), value: (m) => x.active(m.status) },
              { label: t('member.joinDate'), type: 'date', value: (m) => m.join_date },
              contact && { label: t('member.fatherPhone'), value: (m) => x.phones(m.father_phone) },
              contact && { label: t('member.motherPhone'), value: (m) => x.phones(m.mother_phone) },
              contact && { label: t('excel.memberPhone'), value: (m) => x.phones(m.member_phone) },
              contact && { label: t('member.addressAbidjan'), value: (m) => m.address_abidjan },
              contact && { label: t('member.addressLebanon'), value: (m) => m.address_lebanon },
              { label: t('member.school'), value: (m) => m.school },
              { label: t('member.bloodType'), value: (m) => m.blood_type },
              { label: t('member.birthPlace'), value: (m) => m.birth_place },
              { label: t('member.motherName'), value: (m) => m.mother_name },
              { label: t('member.attendanceRate'), type: 'percent', value: (m) => m.attendance?.rate },
              { label: t('print.presences'), type: 'int', value: (m) => m.attendance?.present },
              { label: t('excel.marked'), type: 'int', value: (m) => m.attendance?.total },
              { label: t('print.consecutive'), type: 'int', value: (m) => m.attendance?.absences },
            ],
            { empty: t('member.noMembers') }
          ),
        ],
      },
    ],
  };
}

async function leadersList(ctx) {
  const { sp, t, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const all = await api.get('/leaders');
  // The page's filters came along in the query: the file keeps the same قادة
  const list = filterLeaders(all, Object.fromEntries(LEADER_FILTER_KEYS.map((k) => [k, sp.get(k) || ''])));
  const title = t('leader.leadersList');
  // Only an admin receives the account fields
  const accounts = list.some((l) => 'account_username' in l);
  return {
    title,
    sheets: [
      {
        name: title,
        title,
        lines: [`${kindLabel} · ${t('leader.totalShort', { count: list.length })}`, stamp],
        blocks: [
          table(
            list,
            [
              x.num,
              { label: t('member.name'), value: memberName },
              {
                label: t('leader.colRoles'),
                value: (l) =>
                  (l.roles || [])
                    .map((r) => [r.title, r.branch_id && x.branch(r)].filter(Boolean).join(' · '))
                    .join(' / ') || null,
              },
              { label: t('leader.phone'), value: (l) => x.phones(l.phone) },
              { label: t('member.status'), value: (l) => x.active(l.status) },
              { label: t('member.birthDate'), type: 'date', value: (l) => l.birth_date },
              {
                label: t('leader.maritalStatus'),
                value: (l) =>
                  l.marital_status && t(l.marital_status === 'married' ? 'leader.married' : 'leader.single'),
              },
              { label: t('member.addressAbidjan'), value: (l) => l.address_abidjan },
              { label: t('member.addressLebanon'), value: (l) => l.address_lebanon },
              { label: t('leader.joinYear'), value: (l) => l.join_year },
              { label: t('leader.yearsGhadir'), type: 'int', value: (l) => l.years_ghadir },
              { label: t('leader.yearsTotal'), type: 'int', value: (l) => l.years_total },
              {
                label: t('leader.trainingLevel'),
                value: (l) => x.list((l.training_level || []).map((c) => t(`leader.courseShort.${c}`))),
              },
              { label: t('leader.education'), value: (l) => l.education },
              { label: t('leader.activitiesLed'), type: 'int', value: (l) => l.sessions_count },
              { label: t('print.presentCount'), type: 'int', value: (l) => l.present_count },
              { label: t('print.absentCount'), type: 'int', value: (l) => l.absent_count },
              { label: t('session.familyVisits'), type: 'int', value: (l) => l.visits_count },
              {
                label: t('leader.colCard'),
                value: (l) => (l.card?.total ? `${l.card.done_count}/${l.card.total}` : null),
              },
              accounts && { label: t('leader.accountUsername'), value: (l) => l.account_username },
            ],
            { empty: t('leader.noLeaders') }
          ),
        ],
      },
    ],
  };
}

async function sessionsList(ctx) {
  const { id, sp, t, lng, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const { all, name, branches } = await listBranch(id, ctx);
  const qs = new URLSearchParams(sp);
  if (!all) qs.set('branch', id);
  const list = await api.get(`/sessions?${qs}`);
  const byId = new Map(branches.map((b) => [b.id, b]));
  // A joint نشاط names each of its فرق; a نشاط قادة, the فرق it invited
  const branchesOf = (s) =>
    x.list((s.branch_ids?.length ? s.branch_ids : [s.branch_id]).map((bid) => branchName(byId.get(bid), lng)));
  // Money columns only for an account that sees a نشاط's money
  const money = list.some((s) => s.money);
  const fees = list.some((s) => s.fee !== null && s.fee !== undefined);
  return {
    title: name,
    sheets: [
      {
        name: t('print.activities'),
        title: name,
        lines: [`${kindLabel} · ${t('session.resultCount', { count: list.length })}`, stamp],
        blocks: [
          table(
            list,
            [
              x.num,
              { label: t('common.date'), type: 'date', value: (s) => s.date },
              { label: t('session.time'), value: (s) => fmtTime(s.start_time) },
              { label: t('session.sessionTitle'), labelled: true, value: (s) => s.title },
              { label: t('session.kind'), value: (s) => x.kind(s.kind) },
              {
                label: t('session.nature'),
                value: (s) => activityTypeKey(s.activity_type) && t(activityTypeKey(s.activity_type)),
              },
              { label: t('member.branch'), value: branchesOf },
              { label: t('session.leader'), value: (s) => s.leader },
              { label: t('session.place'), value: (s) => s.place },
              {
                label: t('print.presentCount'),
                type: 'int',
                sum: true,
                // A نشاط عام للفوج is counted per فرقة, not marked by name
                value: (s) => (s.kind === 'group' ? s.branch_counts_total : s.present_count),
              },
              {
                label: t('print.absentCount'),
                type: 'int',
                sum: true,
                value: (s) => (s.kind === 'group' ? null : s.absent_count),
              },
              {
                label: t('print.excusedCount'),
                type: 'int',
                sum: true,
                value: (s) => (s.kind === 'group' ? null : s.excused_count),
              },
              { label: t('print.rate'), type: 'percent', value: (s) => s.rate },
              { label: t('branch.matalib'), value: (s) => (s.matalib?.length ? s.matalib.join(' ') : null) },
              fees && { label: t('session.fee'), type: 'amount', value: (s) => s.fee },
              money && {
                label: t('session.subscriptions'),
                type: 'amount',
                sum: true,
                value: (s) => s.money?.collected,
              },
              money && {
                label: t('treasury.sessionDonations'),
                type: 'amount',
                sum: true,
                value: (s) => s.money?.donations,
              },
              money && { label: t('treasury.expenses'), type: 'amount', sum: true, value: (s) => s.money?.expenses },
              money && { label: t('session.moneyResult'), type: 'signed', sum: true, value: (s) => s.money?.result },
            ],
            { total: t('print.total'), empty: t('session.noSessions') }
          ),
        ],
      },
    ],
  };
}

async function prepList(ctx) {
  const { id, sp, t, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const qs = new URLSearchParams(sp);
  if (id !== '0') qs.set('branch', id);
  const list = await api.get(`/prep-cards?${qs}`);
  const title = t('prep.title');
  return {
    title,
    sheets: [
      {
        name: title,
        title,
        lines: [`${kindLabel} · ${t('prep.resultCount', { count: list.length })}`, stamp],
        blocks: [
          table(
            list,
            [
              x.num,
              { label: t('common.date'), type: 'date', value: (c) => c.date },
              { label: t('session.time'), value: (c) => fmtTime(c.start_time) },
              { label: t('session.sessionTitle'), value: (c) => c.title },
              { label: t('member.branch'), value: x.branch },
              { label: t('prep.author'), value: (c) => c.leader },
              { label: t('session.place'), value: (c) => c.place },
              { label: t('prep.matalib'), value: (c) => (c.matalib?.length ? c.matalib.join(' ') : null) },
              { label: t('prep.session'), value: (c) => c.session_title },
            ],
            { empty: t('prep.noCards') }
          ),
        ],
      },
    ],
  };
}

async function promotionsList(ctx) {
  const { id, t, lng, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const [pending, branches] = await Promise.all([api.get('/promotions/pending'), api.get('/branches')]);
  const all = id === '0';
  const b = branches.find((y) => String(y.id) === id);
  if (!all && !b) throw notFound();
  const name = all ? t('promotion.allBranches') : branchName(b, lng);
  // The فوج's order: the فرق as they rank, then the names within each
  const rank = new Map(branches.map((y, i) => [String(y.id), i]));
  const list = pending
    .filter((p) => all || String(p.current_branch.id) === id)
    .sort(
      (p, q) =>
        (rank.get(String(p.current_branch.id)) ?? 0) - (rank.get(String(q.current_branch.id)) ?? 0) ||
        memberName(p).localeCompare(memberName(q), lng)
    );
  return {
    title: name,
    sheets: [
      {
        name: t('promotion.pending'),
        title: name,
        lines: [`${kindLabel} · ${t('promotion.pendingCount', { count: list.length })}`, stamp],
        blocks: [
          table(
            list,
            [
              x.num,
              { label: t('promotion.member'), value: memberName },
              { label: t('member.age'), type: 'int', value: (p) => p.age },
              all && { label: t('promotion.oldBranch'), value: (p) => x.branch(p.current_branch) },
              { label: t('promotion.newBranch'), value: (p) => x.branch(p.target_branch) },
            ],
            { empty: t('promotion.noPending') }
          ),
        ],
      },
    ],
  };
}

async function planList(ctx) {
  const { id, sp, t, lng, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const year = sp.get('year');
  const [plan, branches] = await Promise.all([
    api.get(`/branches/${id}/plan${year ? `?year=${encodeURIComponent(year)}` : ''}`),
    api.get('/branches'),
  ]);
  const b = branches.find((y) => String(y.id) === id);
  if (!b || !plan) throw notFound();
  const title = `${branchName(b, lng)} — ${plan.year}`;
  // Items removed after the plan was validated print on their day, as «Retiré»
  const rows = [
    ...plan.items.map((item) => ({ item, date: item.date })),
    ...(plan.removed || []).map((base) => ({ base, date: base.date })),
  ].sort((p, q) => p.date.localeCompare(q.date));
  const progress = [
    t('branch.planProgress', { done: plan.done_count, total: plan.total }),
    plan.rate !== null && `${plan.rate}%`,
    plan.validation ? `${t('branch.planRespect')} ${plan.summary?.respect ?? 0}%` : t('branch.planDraftShort'),
  ];
  return {
    title,
    sheets: [
      {
        name: t('branch.planTitle'),
        title,
        lines: [`${kindLabel} · ${progress.filter(Boolean).join(' · ')}`, stamp],
        blocks: [
          table(
            rows,
            [
              { label: t('excel.number'), type: 'int', value: (r) => (r.item ? plan.items.indexOf(r.item) + 1 : null) },
              { label: t('common.date'), type: 'date', value: (r) => r.date },
              { label: t('branch.planActivity'), value: (r) => (r.item || r.base).title },
              {
                label: t('branch.planState'),
                value: (r) =>
                  r.base && !r.item
                    ? t('branch.planRemoved')
                    : t(r.item.session ? 'excel.planDone' : 'branch.planNotDone'),
              },
              { label: t('excel.doneOn'), type: 'date', value: (r) => r.item?.session?.date },
              {
                label: t('excel.note'),
                value: (r) =>
                  !r.item
                    ? null
                    : r.item.changed
                      ? `${t('branch.planWas')} ${r.item.base.title}${
                          r.item.base.date !== r.item.date ? ` · ${fmtDate(r.item.base.date)}` : ''
                        }`
                      : plan.validation && !r.item.base
                        ? t('branch.planAdded')
                        : null,
              },
            ],
            { empty: t('branch.planFree') }
          ),
        ],
      },
    ],
  };
}

/* ============================================================
   Cards
   ============================================================ */

async function prepCard(ctx) {
  const { id, t, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const c = await api.get(`/prep-cards/${id}`);
  return {
    title: c.title,
    sheets: [
      {
        name: t('prep.cardLabel'),
        title: c.title,
        lines: [kindLabel, stamp],
        blocks: [
          {
            facts: [
              [t('member.branch'), x.branch(c)],
              [t('common.date'), c.date, 'date'],
              [t('session.time'), fmtTime(c.start_time)],
              [t('session.place'), c.place],
              [t('prep.author'), c.leader],
              [t('prep.matalib'), c.matalib?.length ? c.matalib.join(' ') : null],
              [t('prep.session'), c.session_title],
            ],
          },
          {
            facts: [
              [t('prep.goals'), c.goals],
              [t('prep.segments'), c.segments],
              [t('prep.tools'), c.tools],
              [t('prep.notes'), c.notes],
            ].map(([label, v]) => [label, v && String(v).trim()]),
          },
        ],
      },
    ],
  };
}

async function sessionCard(ctx) {
  const { id, t, lng, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const [s, branches] = await Promise.all([api.get(`/sessions/${id}`), api.get('/branches')]);
  const nameOf = (bid) => branchName(branches.find((b) => b.id === bid) || s, lng);
  const isLeaders = s.kind === 'leaders';
  const isGroup = s.kind === 'group';
  const isVisit = s.kind === 'visit';
  const roster = s.roster || [];
  const animators = s.animators || [];
  const guests = s.guests || [];
  const counts = countStatuses(isLeaders ? animators : roster);
  const paid = roster.filter((m) => m.paid !== null && m.paid !== undefined);
  const showPaid = paid.length > 0;
  const branchIds = s.branch_ids?.length ? s.branch_ids : [s.branch_id].filter(Boolean);
  const multiBranch = new Set(roster.map((m) => m.branch_id)).size > 1;
  const nature = activityTypeKey(s.activity_type);
  const lines = [kindLabel, stamp];
  const sheet = (name, heading, blocks) => ({ name, title: s.title, lines: [heading, stamp], blocks });

  const facts = {
    facts: [
      [t('common.date'), s.date, 'date'],
      [t('session.time'), fmtTime(s.start_time)],
      [t('session.place'), s.place],
      [t(branchIds.length > 1 ? 'session.branches' : 'member.branch'), x.list(branchIds.map(nameOf))],
      [t('session.kind'), x.kind(s.kind)],
      [t('session.nature'), nature && t(nature)],
      [t('session.groups'), x.list((s.groups || []).map((g) => g.name))],
      [t('session.leader'), s.leader],
      [t('session.fee'), s.fee, 'amount'],
      [t('branch.matalib'), s.matalib?.length ? s.matalib.join(' ') : null],
      [t('print.linkedPrepCards'), x.list((s.prep_cards || []).map((c) => c.title))],
      [
        t('session.attendance'),
        s.attendance_finalized_at &&
          t('print.finalized', { date: fmtDate(s.attendance_finalized_at), name: s.attendance_finalized_by || '—' }),
      ],
    ],
  };
  const groupTotal = sum(s.branch_counts || [], (c) => c.count);
  const summary = {
    heading: t('print.summary'),
    facts: isGroup
      ? [
          [t('session.totalAttendance'), groupTotal, 'int'],
          [t('session.leadersCount'), s.leaders_count, 'int'],
        ]
      : [
          [t('print.presentCount'), counts.present, 'int'],
          [t('print.absentCount'), counts.absent, 'int'],
          [t('print.excusedCount'), isLeaders ? null : counts.excused, 'int'],
          [t('print.unmarkedCount'), counts.unmarked, 'int'],
          [t('print.rate'), counts.rate, 'percent'],
          [t('session.subscriptions'), showPaid ? sum(paid, (m) => m.paid) : null, 'amount'],
          [t('excel.payers'), showPaid ? paid.length : null, 'int'],
        ],
  };

  const sheets = [{ name: t('print.summary'), title: s.title, lines, blocks: [facts, summary] }];

  if (isGroup)
    sheets.push(
      sheet(t('session.branchCounts'), t('session.branchCounts'), [
        table(
          [
            ...(s.branch_counts || []).map((c) => ({ label: nameOf(c.branch_id), count: c.count })),
            ...(s.leaders_count !== null && s.leaders_count !== undefined
              ? [{ label: t('session.leadersCount'), count: s.leaders_count }]
              : []),
          ],
          [
            { label: t('member.branch'), value: (r) => r.label },
            { label: t('print.presentCount'), type: 'int', sum: true, value: (r) => r.count },
          ],
          { total: t('print.total') }
        ),
      ])
    );

  // قادة النشاط — or, in a نشاط قادة, the قادة's own présence
  if (animators.length > 0) {
    const label = t(
      isLeaders ? 'session.leadersAttendance' : isVisit ? 'session.visitParticipants' : 'session.animators'
    );
    sheets.push(
      sheet(label, label, [
        table(animators, [
          x.num,
          { label: t('member.name'), value: memberName },
          { label: t('session.role'), value: (a) => x.role(a.role) },
          { label: t('session.myPresence'), value: (a) => x.status(a.status) },
        ]),
      ])
    );
  }

  if (isLeaders && guests.length > 0)
    sheets.push(
      sheet(t('session.guests'), t('session.guests'), [
        table(guests, [x.num, { label: t('member.name'), value: (g) => g.name }]),
      ])
    );

  // The عناصر — in a نشاط قادة, those of the فرق it invited
  if (!isGroup && (!isLeaders || roster.length > 0)) {
    const label = t(isVisit ? 'session.visitedMembers' : isLeaders ? 'session.invitedRoster' : 'session.roster');
    sheets.push(
      sheet(isVisit || isLeaders ? label : t('session.tabAttendance'), label, [
        table(
          roster,
          [
            x.num,
            { label: t('member.name'), value: memberName },
            multiBranch && { label: t('member.branch'), value: (m) => nameOf(m.branch_id) },
            { label: t('member.group'), value: (m) => m.group_name },
            showPaid && { label: t('session.subscriptions'), type: 'amount', sum: true, value: (m) => m.paid },
            { label: t('member.status'), value: (m) => x.status(m.status) },
            { label: t('print.consecutive'), type: 'int', value: (m) => m.consecutive_absences || null },
          ],
          { total: showPaid ? t('print.total') : null, empty: t('session.emptyRoster') }
        ),
      ])
    );
  }
  return { title: s.title, sheets };
}

async function memberCard(ctx) {
  const { id, t, lng, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const m = await api.get(`/members/${id}`);
  const name = memberName(m);
  const { stats } = m;
  const total = m.branch_total_requirements || 0;
  const earned = Math.min(stats.requirements_earned, total);
  const sheet = (sheetName, heading, blocks) => ({ name: sheetName, title: name, lines: [heading, stamp], blocks });

  const sheets = [
    {
      name: t('member.profile'),
      title: name,
      lines: [kindLabel, stamp],
      blocks: [
        {
          facts: [
            [t('member.branch'), x.branch(m)],
            [t('member.group'), m.group_name],
            [t('member.status'), x.active(m.status)],
            [t('member.sex'), x.sex(m.sex)],
            [t('member.age'), m.age, 'int'],
          ],
        },
        {
          heading: t('print.identity'),
          facts: [
            [t('member.birthDate'), m.birth_date, 'date'],
            [t('member.birthPlace'), m.birth_place],
            [t('member.joinDate'), m.join_date, 'date'],
            [t('member.school'), m.school],
            [t('member.bloodType'), m.blood_type],
            [t('member.fatherName'), m.father_name],
            [t('member.motherName'), m.mother_name],
          ],
        },
        // Withheld from an account without the contact right: never sent, so never written
        {
          heading: t('print.contacts'),
          facts: [
            [t('member.addressAbidjan'), m.address_abidjan],
            [t('member.addressLebanon'), m.address_lebanon],
            [t('excel.memberPhone'), x.phones(m.member_phone)],
            [t('member.fatherPhone'), x.phones(m.father_phone)],
            [t('member.motherPhone'), x.phones(m.mother_phone)],
          ],
        },
        {
          heading: t('print.summary'),
          facts: [
            [t('member.attendanceRate'), stats.rate, 'percent'],
            [t('print.presences'), stats.present, 'int'],
            [t('excel.marked'), stats.total, 'int'],
            [t('print.consecutive'), stats.consecutive_absences, 'int'],
            [t('member.subscriptionsPaid'), m.subscriptions?.total, 'amount'],
          ],
        },
        total > 0 && {
          heading: t('member.requirementsProgress'),
          facts: [
            [t('branch.matalib'), t('member.requirementsOf', { earned, total })],
            [t('excel.numbers'), stats.earned_numbers?.length ? stats.earned_numbers.join(' ') : null],
            [
              t('member.matalibManual'),
              x.list(
                (m.manual_matalib || []).map(
                  (r) =>
                    `${r.number} ${t(r.state === 'granted' ? 'member.matalibGranted' : 'member.matalibRevoked')}${
                      r.updated_by ? ` (${t('member.matalibBy', { name: r.updated_by })})` : ''
                    }`
                )
              ),
            ],
          ],
        },
      ].filter(Boolean),
    },
  ];

  // The current فرقة first, then each former one, its rows named after it
  const history = [
    ...stats.history.map((h) => ({ ...h, branch: x.branch(m) })),
    ...(m.former_attendance || []).flatMap((f) =>
      f.history.map((h) => ({
        ...h,
        branch: branchName({ name_fr: f.branch_name_fr, name_ar: f.branch_name_ar }, lng),
      }))
    ),
  ];
  sheets.push(
    sheet(
      t('member.attendanceHistory'),
      stats.total > 0
        ? `${t('member.attendanceHistory')} · ${t('member.sessionsAttended', { present: stats.present, total: stats.total })}`
        : t('member.attendanceHistory'),
      [
        table(
          history,
          [
            { label: t('common.date'), type: 'date', value: (h) => h.date },
            { label: t('session.sessionTitle'), value: (h) => h.title },
            { label: t('member.status'), value: (h) => x.status(h.status) },
            { label: t('member.branch'), value: (h) => h.branch },
          ],
          { empty: t('member.noAttendance') }
        ),
      ]
    )
  );

  if (m.subscriptions?.count > 0)
    sheets.push(
      sheet(t('member.subscriptions'), t('member.subscriptions'), [
        table(
          m.subscriptions.history,
          [
            { label: t('common.date'), type: 'date', value: (r) => r.date },
            { label: t('session.sessionTitle'), value: (r) => r.title },
            { label: t('member.amount'), type: 'amount', sum: true, value: (r) => r.amount },
          ],
          { total: t('member.subscriptionsTotal') }
        ),
      ])
    );

  if (m.promotions?.length > 0)
    sheets.push(
      sheet(t('promotion.title'), t('promotion.history'), [
        table(m.promotions, [
          { label: t('common.date'), type: 'date', value: (p) => p.promoted_at },
          { label: t('promotion.oldBranch'), value: (p) => (lng === 'ar' ? p.old_name_ar : p.old_name_fr) },
          { label: t('promotion.newBranch'), value: (p) => (lng === 'ar' ? p.new_name_ar : p.new_name_fr) },
          {
            label: t('branch.matalib'),
            value: (p) => t('member.requirementsOf', { earned: p.matalib.length, total: p.old_total_requirements }),
          },
        ]),
      ])
    );

  if (m.visits?.length > 0)
    sheets.push(
      sheet(t('session.familyVisits'), t('session.familyVisits'), [
        table(m.visits, [
          { label: t('common.date'), type: 'date', value: (v) => v.date },
          { label: t('session.sessionTitle'), value: (v) => v.title },
          { label: t('session.visitParticipants'), value: (v) => v.leaders },
        ]),
      ])
    );

  return { title: name, sheets };
}

async function leaderCard(ctx) {
  const { id, t, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const l = await api.get(`/leaders/${id}`);
  const name = memberName(l);
  const card = l.card || { year: '', total: 0, done_count: 0, items: [] };
  const sessions = l.sessions || [];
  const present = l.attendance?.present ?? 0;
  const absent = l.attendance?.absent ?? 0;
  const sheet = (sheetName, heading, blocks) => ({ name: sheetName, title: name, lines: [heading, stamp], blocks });

  const sheets = [
    {
      name: t('member.profile'),
      title: name,
      lines: [kindLabel, stamp],
      blocks: [
        {
          facts: [
            [t('member.status'), x.active(l.status)],
            [t('leader.currentRoles'), x.list((l.current_roles || []).map((r) => r.title))],
            [t('leader.year'), l.year],
          ],
        },
        {
          heading: t('leader.profile'),
          facts: [
            [t('leader.phone'), x.phones(l.phone)],
            [t('member.birthDate'), l.birth_date, 'date'],
            [
              t('leader.maritalStatus'),
              l.marital_status && t(l.marital_status === 'married' ? 'leader.married' : 'leader.single'),
            ],
            [t('member.addressAbidjan'), l.address_abidjan],
            [t('member.addressLebanon'), l.address_lebanon],
            [t('leader.joinYear'), l.join_year],
            [t('leader.yearsGhadir'), l.years_ghadir, 'int'],
            [t('leader.yearsTotal'), l.years_total, 'int'],
            [t('leader.trainingLevel'), x.list((l.training_level || []).map((c) => t(`leader.course_${c}`)))],
            [t('leader.education'), l.education],
          ],
        },
        {
          heading: t('print.summary'),
          facts: [
            [t('leader.activitiesLed'), sessions.length, 'int'],
            [t('print.presentCount'), present, 'int'],
            [t('print.absentCount'), absent, 'int'],
            [t('print.rate'), rate(present, present + absent), 'percent'],
          ],
        },
      ],
    },
  ];

  if (card.total > 0)
    sheets.push(
      sheet(
        t('leader.colCard'),
        `${t('leader.card')}${card.year ? ` · ${card.year}` : ''} · ${t('leader.cardProgress', {
          done: card.done_count,
          total: card.total,
        })}`,
        [
          table(card.items, [
            { label: t('excel.number'), type: 'int', value: (item) => item.number },
            { label: t('branch.matalib'), value: (item) => item.label },
            { label: t('branch.planState'), value: (item) => t(item.done ? 'leader.cardDone' : 'leader.cardNotDone') },
            { label: t('common.date'), type: 'date', value: (item) => item.achieved_at },
          ]),
        ]
      )
    );

  if (l.assignments?.length > 0)
    sheets.push(
      sheet(t('leader.colRoles'), t('leader.rolesHistory'), [
        table(l.assignments, [
          { label: t('leader.year'), value: (a) => a.year },
          { label: t('leader.role'), value: (a) => a.title },
          { label: t('member.branch'), value: (a) => (a.branch_id ? x.branch(a) : null) },
        ]),
      ])
    );

  if (l.prep_cards?.length > 0)
    sheets.push(
      sheet(t('prep.title'), t('prep.leaderSection'), [
        table(l.prep_cards, [
          { label: t('common.date'), type: 'date', value: (c) => c.date },
          { label: t('session.sessionTitle'), value: (c) => c.title },
          { label: t('member.branch'), value: x.branch },
        ]),
      ])
    );

  if (l.visits?.length > 0)
    sheets.push(
      sheet(t('session.familyVisits'), t('session.familyVisits'), [
        table(l.visits, [
          { label: t('common.date'), type: 'date', value: (v) => v.date },
          { label: t('session.sessionTitle'), value: (v) => v.title },
          { label: t('member.branch'), value: x.branch },
          { label: t('session.role'), value: (v) => x.role(v.role) },
          { label: t('session.visitedMembers'), value: (v) => x.list((v.members || []).map(memberName)) },
        ]),
      ])
    );

  sheets.push(
    sheet(t('leader.activitiesLed'), t('leader.activitiesLed'), [
      table(
        sessions,
        [
          { label: t('common.date'), type: 'date', value: (s) => s.date },
          { label: t('session.sessionTitle'), value: (s) => s.title },
          { label: t('member.branch'), value: (s) => (s.branch_id ? x.branch(s) : t('session.kindLeaders')) },
          { label: t('session.role'), value: (s) => x.role(s.role) },
          { label: t('session.myPresence'), value: (s) => (s.my_status ? x.status(s.my_status) : null) },
          { label: t('print.presentCount'), type: 'int', value: (s) => s.present_count },
        ],
        { empty: t('leader.noActivities') }
      ),
    ])
  );
  return { title: name, sheets };
}

async function branchCard(ctx) {
  const { id, t, lng, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  // The roster and the plan are extras: an account allowed to read الفرق but not
  // العناصر still gets the rest, without those two sheets — as on paper
  const [overview, sessions, members, plan] = await Promise.all([
    api.get('/branches/overview'),
    api.get(`/branches/${id}/sessions`),
    api.get(`/members?branch=${encodeURIComponent(id)}`).catch(() => null),
    api.get(`/branches/${id}/plan`).catch(() => null),
  ]);
  const b = overview.find((y) => String(y.id) === id);
  if (!b) throw notFound();
  const name = branchName(b, lng);
  const today = todayISO();
  const sheet = (sheetName, heading, blocks) => ({ name: sheetName, title: name, lines: [heading, stamp], blocks });

  // Présence per عنصر from the participant lists, the same rows the عنصر page counts
  const perMember = new Map();
  for (const s of sessions) {
    if (s.kind !== 'activity' || s.date > today) continue;
    for (const k of ['present', 'absent', 'excused'])
      for (const m of s[k] || []) {
        const st = perMember.get(m.id) || { present: 0, absent: 0, excused: 0 };
        st[k]++;
        perMember.set(m.id, st);
      }
  }
  const statsOf = (m) => {
    const st = perMember.get(m.id) || { present: 0, absent: 0, excused: 0 };
    return { ...st, marked: st.present + st.absent + st.excused };
  };
  const leaders = (b.leaders || []).filter((l) => l.leader_id);
  const ages = b.all_ages
    ? t('branch.allAges')
    : b.max_age
      ? `${b.min_age}–${b.max_age} ${t('branch.years')}`
      : `${b.min_age}+`;
  const activities = sessions.filter((s) => s.kind !== 'visit');
  const visits = sessions.filter((s) => s.kind === 'visit');

  const sheets = [
    {
      name: t('print.summary'),
      title: name,
      lines: [kindLabel, stamp],
      blocks: [
        {
          facts: [
            [t('member.age'), ages],
            [t('leader.year'), b.year],
            [t('branch.lastSession'), b.last_session?.date, 'date'],
          ],
        },
        {
          heading: t('print.summary'),
          facts: [
            [t('branch.members'), b.members.active, 'int'],
            [t('member.male'), b.members.male, 'int'],
            [t('member.female'), b.members.female, 'int'],
            [t('branch.activities'), b.sessions_count, 'int'],
            [t('session.thisMonth'), b.sessions_month, 'int'],
            [t('branch.attendanceRate'), b.attendance.rate, 'percent'],
            [t('print.presentCount'), b.attendance.present, 'int'],
            [t('print.absentCount'), b.attendance.absent, 'int'],
          ],
        },
        b.matalib.total > 0 && {
          heading: t('print.matalibCovered'),
          facts: [
            [t('branch.matalib'), `${b.matalib.covered_count}/${b.matalib.total}`],
            [t('excel.numbers'), b.matalib.covered?.length ? b.matalib.covered.join(' ') : null],
          ],
        },
      ].filter(Boolean),
    },
    sheet(t('branch.leaders'), t('branch.leaders'), [
      table(
        leaders,
        [
          { label: t('member.name'), value: memberName },
          { label: t('leader.role'), value: (l) => l.title },
        ],
        { empty: t('branch.noLeaders') }
      ),
    ]),
  ];

  if (members) {
    // Active first, as on paper; the inactive after them, said so
    const list = [...members.filter((m) => m.status === 'active'), ...members.filter((m) => m.status !== 'active')];
    sheets.push(
      sheet(t('branch.members'), `${t('branch.members')} · ${t('print.membersInGroup', { count: list.length })}`, [
        table(
          list,
          [
            { label: t('excel.number'), type: 'int', value: (_, i) => i + 1 },
            { label: t('member.name'), value: memberName },
            { label: t('member.age'), type: 'int', value: (m) => m.age },
            { label: t('member.sex'), value: (m) => x.sex(m.sex) },
            { label: t('member.group'), value: (m) => m.group_name },
            { label: t('member.joinDate'), type: 'date', value: (m) => m.join_date },
            { label: t('print.presences'), type: 'int', value: (m) => statsOf(m).present },
            { label: t('excel.marked'), type: 'int', value: (m) => statsOf(m).marked },
            { label: t('print.rate'), type: 'percent', value: (m) => rate(statsOf(m).present, statsOf(m).marked) },
            { label: t('member.status'), value: (m) => x.active(m.status) },
          ],
          { empty: t('member.noMembers') }
        ),
      ])
    );
  }

  if (plan && plan.total > 0)
    sheets.push(
      sheet(
        t('branch.planTitle'),
        `${t('branch.planTitle')} · ${plan.year} · ${t('branch.planProgress', { done: plan.done_count, total: plan.total })}`,
        [
          table(plan.items, [
            { label: t('common.date'), type: 'date', value: (item) => item.date },
            { label: t('branch.planActivity'), value: (item) => item.title },
            {
              label: t('branch.planState'),
              value: (item) => t(item.session ? 'excel.planDone' : 'branch.planNotDone'),
            },
            { label: t('excel.doneOn'), type: 'date', value: (item) => item.session?.date },
          ]),
        ]
      )
    );

  sheets.push(
    sheet(t('print.activities'), t('print.activities'), [
      table(
        activities,
        [
          { label: t('common.date'), type: 'date', value: (s) => s.date },
          { label: t('session.sessionTitle'), value: (s) => s.title },
          {
            label: t('session.animators'),
            value: (s) => (s.animators?.length ? x.list(s.animators.map(memberName)) : s.leader),
          },
          { label: t('branch.matalib'), value: (s) => (s.matalib?.length ? s.matalib.join(' ') : null) },
          { label: t('print.presentCount'), type: 'int', sum: true, value: (s) => s.present.length },
          { label: t('print.absentCount'), type: 'int', sum: true, value: (s) => s.absent.length },
          { label: t('print.excusedCount'), type: 'int', sum: true, value: (s) => s.excused.length },
        ],
        { total: t('print.total'), empty: t('branch.noParticipants') }
      ),
    ])
  );

  if (visits.length > 0)
    sheets.push(
      sheet(t('session.familyVisits'), t('session.familyVisits'), [
        table(visits, [
          { label: t('common.date'), type: 'date', value: (s) => s.date },
          { label: t('session.sessionTitle'), value: (s) => s.title },
          { label: t('session.visitedMembers'), value: (s) => x.list(s.present.map(memberName)) },
        ]),
      ])
    );

  return { title: name, sheets };
}

/* ============================================================
   الصناديق و مالية الفرقة
   ============================================================ */

/**
 * الصناديق, as the page shows them (?box=, ?flow=): the figures and where the money came
 * from and went, each caisse when all are together, what is still owed, then every
 * movement on its own row — a نشاط's lines each with its نشاط named, so a filter or a
 * pivot can gather them again. A مصروف still owed has not left its caisse: it is on
 * the «À payer» sheet, not among the movements.
 */
async function treasuryCard(ctx) {
  const { sp, t, lng, section, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const data = await api.get('/treasury');
  const flow = FLOWS.includes(sp.get('flow')) ? sp.get('flow') : '';
  const { byKey, held, multi, sel, owed, rows, fig } = ledgerView(data, { box: sp.get('box') || '', flow });
  const both = !section;
  const names = {
    short: (key) => boxName(byKey[key], t, lng, { both, short: true }),
    inline: (key) => boxName(byKey[key], t, lng, { both, inline: true }),
  };
  const flowLabel = flow ? t(flow === 'in' ? 'treasury.filterIn' : 'treasury.filterOut') : '';
  const name = sel ? boxName(sel, t, lng, { both }) : t('print.treasuryAll');
  const title = flowLabel ? `${name} · ${flowLabel}` : name;
  const startOf = (box) =>
    box.start &&
    (box.start.inherited
      ? t('treasury.startedWithGroup', { date: fmtDate(box.start.date) })
      : t('treasury.openedOn', { date: fmtDate(box.start.date), amount: fmtAmount(box.start.amount) }));
  const head = [
    flowLabel ? `${kindLabel} · ${t('print.treasuryOnly', { what: flowLabel })}` : kindLabel,
    sel && startOf(sel),
    stamp,
  ];
  const sheet = (sheetName, heading, blocks) => ({ name: sheetName, title: name, lines: [heading, stamp], blocks });

  if (sel ? !sel.start : !held.some((b) => b.start))
    return {
      title,
      sheets: [{ name: t('print.summary'), title: name, lines: [...head, t('treasury.notOpenReadonly')], blocks: [] }],
    };

  const showIn = flow !== 'out';
  const showOut = flow !== 'in';
  const spent = OUT_FIGURES.map((k) => [t(`treasury.cat_${k}`), fig.expenses[k], 'amount'])
    .filter(([, n]) => n > 0)
    .sort((p, q) => q[1] - p[1]);
  const sheets = [
    {
      name: t('print.summary'),
      title: name,
      lines: head,
      blocks: [
        {
          facts: [
            [t('treasury.balance'), fig.balance, 'amount'],
            [t('treasury.income'), showIn ? fig.income.total : null, 'amount'],
            [t('treasury.expenses'), showOut ? fig.expenses.total : null, 'amount'],
            [t('treasury.owedTitle'), showOut && fig.owed > 0 ? fig.owed : null, 'amount'],
            [t('excel.afterOwed'), showOut && fig.owed > 0 ? fig.balance - fig.owed : null, 'amount'],
          ],
        },
        showIn && {
          heading: t('treasury.income'),
          facts: INCOME_SOURCES.map((k) => [t(`treasury.in_${k}`), fig.income[k] || null, 'amount']),
        },
        showOut && { heading: t('treasury.expenses'), facts: spent },
      ].filter(Boolean),
    },
  ];

  if (!sel && multi)
    sheets.push(
      sheet(t('print.treasuryBoxes'), t('print.treasuryBoxes'), [
        table(
          held,
          [
            { label: t('treasury.box'), value: (b) => names.short(b.key) },
            { label: t('print.treasuryStart'), type: 'date', value: (b) => b.start?.date || t('treasury.boxNotOpen') },
            {
              label: t('excel.openingAmount'),
              type: 'amount',
              sum: true,
              value: (b) => (b.start && !b.start.inherited ? b.start.amount : null),
            },
            {
              label: t('treasury.owedTitle'),
              type: 'amount',
              sum: true,
              value: (b) => (b.start && b.owed > 0 ? b.owed : null),
            },
            { label: t('treasury.balance'), type: 'amount', sum: true, value: (b) => (b.start ? b.balance : null) },
          ],
          { total: t('print.total') }
        ),
      ])
    );

  if (showOut && owed.length > 0)
    sheets.push(
      sheet(t('treasury.owedTitle'), t('treasury.owedSubtitle'), [
        table(
          owed,
          [
            { label: t('common.date'), type: 'date', value: (r) => r.spent_on },
            { label: t('print.treasuryExpense'), value: (r) => r.label },
            { label: t('treasury.category'), value: (r) => t(`treasury.cat_${r.category}`) },
            { label: t('excel.session'), value: (r) => r.session_title },
            { label: t('treasury.owedTo'), value: (r) => r.owed_to },
            !sel && multi && { label: t('treasury.box'), value: (r) => names.short(r.box) },
            { label: t('treasury.amount'), type: 'amount', sum: true, value: (r) => r.amount },
          ],
          { total: t('print.total') }
        ),
      ])
    );

  const typeOf = (r) => {
    if (r.direction === 'move') return t('excel.internalTransfer');
    const key = r.source === 'entry' ? r.category : r.source === 'session' ? 'sessions' : r.source;
    return t(r.direction === 'in' ? `treasury.in_${key}` : `treasury.cat_${key}`);
  };
  // A line's words as the page says them; the day, the kind and the نشاط have their own columns
  const line = (r, nested, session) => {
    const it = rowText(r, { t, lng, names, nested });
    const type = typeOf(r);
    const activity = session ?? r.session_title ?? null;
    const drop = new Set([type, activity && t('treasury.forSession', { title: activity })]);
    const details = x.list((nested ? it.meta : it.meta.slice(1)).filter((m) => !drop.has(m)));
    return { r, type, title: it.title, details, activity };
  };
  // One row per movement: a نشاط's own lines come out of it, named after it
  const lines = [];
  for (const r of rows) {
    if (r.source !== 'session_group') lines.push(line(r, false));
    else
      for (const item of r.items)
        if (!(item.source === 'entry' && item.direction === 'out' && item.paid_on === null))
          lines.push(line(item, true, r.session_title));
  }
  const moves = lines.some(({ r }) => r.direction === 'move');
  sheets.push(
    sheet(t('treasury.journal'), t('treasury.movementCount', { count: lines.length }), [
      table(
        lines,
        [
          { label: t('common.date'), type: 'date', value: ({ r }) => r.date },
          { label: t('treasury.incomeType'), value: (l) => l.type },
          { label: t('print.treasuryMovement'), value: (l) => l.title },
          { label: t('excel.details'), value: (l) => l.details },
          { label: t('excel.session'), value: (l) => l.activity },
          !sel &&
            multi && {
              label: t('treasury.box'),
              value: ({ r }) => (r.direction === 'move' ? null : names.short(r.box)),
            },
          showIn && {
            label: t('excel.inflow'),
            type: 'amount',
            sum: true,
            value: ({ r }) => (r.direction === 'in' ? r.amount : null),
          },
          showOut && {
            label: t('excel.outflow'),
            type: 'amount',
            sum: true,
            value: ({ r }) => (r.direction === 'out' ? r.amount : null),
          },
          moves && {
            label: t('excel.internalTransfer'),
            type: 'amount',
            sum: true,
            value: ({ r }) => (r.direction === 'move' ? r.amount : null),
          },
        ],
        {
          total: t('print.total'),
          empty: t(
            flow === 'in'
              ? 'treasury.emptyFilterIn'
              : flow === 'out'
                ? 'treasury.emptyFilterOut'
                : 'treasury.emptyJournal'
          ),
        }
      ),
    ])
  );
  return { title, sheets };
}

async function branchMoneyCard(ctx) {
  const { id, t, lng, kindLabel, stamp } = ctx;
  const [money, branches] = await Promise.all([api.get(`/branches/${id}/money`), api.get('/branches')]);
  const b = branches.find((y) => String(y.id) === id);
  if (!b) throw notFound();
  const name = branchName(b, lng);
  const { expenses, donations, summary, caisse } = money;
  const given = sum(donations, (d) => d.amount);
  const sheet = (sheetName, heading, blocks) => ({ name: sheetName, title: name, lines: [heading, stamp], blocks });
  const sheets = [
    {
      name: t('print.summary'),
      title: name,
      lines: [kindLabel, stamp],
      blocks: [
        {
          facts: [
            caisse?.opened
              ? [t('branch.caisse'), caisse.balance, 'amount']
              : [t('branch.caisse'), caisse ? t('branch.caisseNotOpen') : null],
            [t('branch.donations'), given, 'amount'],
            [t('branch.expensesTotal'), summary.total, 'amount'],
            [t('treasury.owedTitle'), summary.owed > 0 ? summary.owed : null, 'amount'],
          ],
        },
        {
          heading: t('branch.expensesByCategory'),
          facts: OUT_CATEGORIES.map((k) => [t(`treasury.cat_${k}`), summary.by_category[k], 'amount'])
            .filter(([, n]) => n > 0)
            .sort((p, q) => q[1] - p[1]),
        },
      ],
    },
  ];
  if (donations.length > 0)
    sheets.push(
      sheet(t('branch.donations'), t('branch.donations'), [
        table(
          donations,
          [
            { label: t('common.date'), type: 'date', value: (d) => d.date },
            { label: t('treasury.donation'), value: (d) => d.label || t('treasury.donation') },
            { label: t('excel.session'), value: (d) => d.session_title },
            { label: t('treasury.amount'), type: 'amount', sum: true, value: (d) => d.amount },
          ],
          { total: t('print.total') }
        ),
      ])
    );
  if (expenses.length > 0)
    sheets.push(
      sheet(t('treasury.expenses'), t('branch.expensesCount', { count: expenses.length }), [
        table(
          expenses,
          [
            { label: t('common.date'), type: 'date', value: (e) => e.spent_on },
            { label: t('print.treasuryExpense'), value: (e) => e.label },
            { label: t('treasury.category'), value: (e) => t(`treasury.cat_${e.category}`) },
            { label: t('excel.session'), value: (e) => e.session_title },
            {
              label: t('treasury.paymentStatus'),
              value: (e) => t(e.paid_on ? 'treasury.statusPaid' : 'treasury.statusOwed'),
            },
            { label: t('treasury.paidOn'), type: 'date', value: (e) => e.paid_on },
            { label: t('excel.payee'), value: (e) => e.owed_to },
            { label: t('treasury.amount'), type: 'amount', sum: true, value: (e) => e.amount },
          ],
          { total: t('print.total') }
        ),
      ])
    );
  return { title: name, sheets };
}

/* ============================================================
   الاجتماعات
   ============================================================ */

/** Where a decision stands, in the words of the page */
function decisionState(d, t, today) {
  if (d.status === 'done') return t('meeting.status_done');
  if (d.status === 'dropped') return t('meeting.status_dropped');
  return isOverdue(d, today) ? t('meeting.overdue') : t('meeting.status_open');
}

// The columns every decision table shares; `from`: the meeting it was taken in
const decisionColumns = (ctx, today, from) => {
  const { t } = ctx;
  const x = tools(ctx);
  return [
    x.num,
    { label: t('meeting.decisionText'), value: (d) => d.text },
    { label: t('meeting.owner'), value: (d) => d.owner },
    { label: t('meeting.dueDate'), type: 'date', value: (d) => d.due_date },
    { label: t('meeting.status'), value: (d) => decisionState(d, t, today) },
    { label: t('excel.doneOn'), type: 'date', value: (d) => (d.status === 'done' ? d.status_at : null) },
    from && { label: t('meeting.meetingCol'), value: (d) => d.meeting_title },
    from && { label: t('common.date'), type: 'date', value: (d) => d.meeting_date },
  ];
};

async function meetingCard(ctx) {
  const { id, t, lng, kindLabel, stamp } = ctx;
  const m = await api.get(`/meetings/${id}`);
  const today = todayISO();
  const people = (status, guest = false) =>
    m.attendees
      .filter((a) => a.guest === guest && (guest || a.status === status))
      .map((a) => a.name)
      .join(t('member.listSep')) || null;
  const title = `${m.title} — ${m.date}`;
  const sheets = [
    {
      name: t('meeting.minutes'),
      title: m.title,
      lines: [kindLabel, stamp],
      blocks: [
        {
          facts: [
            [t('meeting.kind'), t(`meeting.kind_${m.kind}`)],
            [t('meeting.purpose'), m.purpose],
            [t('common.date'), m.date, 'date'],
            [t('session.time'), timeRange(m)],
            [t('session.place'), m.place],
            [t('meeting.scope'), m.branch_id ? branchName(m, lng) : t('meeting.wholeGroup')],
            [gendered(t, 'meeting.chair', m.section), m.chair],
            [gendered(t, 'meeting.secretary', m.section), m.secretary],
          ],
        },
        {
          heading: t('meeting.attendance'),
          // A group nobody is in says nothing: the block goes with its last fact
          facts: [
            [gendered(t, 'meeting.groupPresent', m.section), people('present')],
            [gendered(t, 'meeting.groupExcused', m.section), people('excused')],
            [gendered(t, 'meeting.groupAbsent', m.section), people('absent')],
            [t('meeting.groupGuests'), people(null, true)],
          ].filter(([, v]) => v),
        },
        {
          heading: t('meeting.agenda'),
          facts: m.items.map((it, i) => [`${i + 1}. ${it.title}`, it.discussion || t('meeting.noDiscussion')]),
        },
        {
          facts: [
            [t('meeting.notes'), m.notes],
            [t('meeting.nextDate'), m.next_date, 'date'],
          ].filter(([, v]) => v),
        },
      ],
    },
    {
      name: t('meeting.decisions'),
      title: t('meeting.decisions'),
      lines: [m.title, stamp],
      blocks: [table(m.decisions, decisionColumns(ctx, today, false), { empty: t('meeting.decisionsEmpty') })],
    },
  ];
  if (m.followups.length > 0)
    sheets.push({
      name: t('meeting.followups'),
      title: t('meeting.followups'),
      lines: [m.title, stamp],
      blocks: [table(m.followups, decisionColumns(ctx, today, true))],
    });
  return { title, sheets };
}

async function meetingsList(ctx) {
  const { sp, t, lng, kindLabel, stamp } = ctx;
  const x = tools(ctx);
  const list = await api.get(`/meetings?${sp}`);
  const title = t('meeting.title');
  return {
    title,
    sheets: [
      {
        name: title,
        title,
        lines: [`${kindLabel} · ${t('meeting.resultCount', { count: list.length })}`, stamp],
        blocks: [
          table(
            list,
            [
              x.num,
              { label: t('common.date'), type: 'date', value: (m) => m.date },
              { label: t('meeting.startTime'), value: (m) => fmtTime(m.start_time) },
              { label: t('meeting.endTime'), value: (m) => fmtTime(m.end_time) },
              { label: t('meeting.subject'), value: (m) => m.title },
              { label: t('meeting.kind'), value: (m) => t(`meeting.kind_${m.kind}`) },
              { label: t('meeting.scope'), value: (m) => (m.branch_id ? branchName(m, lng) : t('meeting.wholeGroup')) },
              { label: t('session.place'), value: (m) => m.place },
              { label: t('meeting.chair'), value: (m) => m.chair },
              { label: t('meeting.secretary'), value: (m) => m.secretary },
              { label: t('meeting.groupPresent'), type: 'int', value: (m) => m.present_count },
              { label: t('meeting.groupExcused'), type: 'int', value: (m) => m.excused_count },
              { label: t('meeting.groupAbsent'), type: 'int', value: (m) => m.absent_count },
              { label: t('meeting.groupGuests'), type: 'int', value: (m) => m.guest_count },
              { label: t('meeting.agenda'), type: 'int', value: (m) => m.item_count },
              { label: t('meeting.decisions'), type: 'int', value: (m) => m.decision_count },
              { label: t('meeting.overdue'), type: 'int', value: (m) => m.overdue_count },
            ],
            { empty: t('meeting.empty') }
          ),
        ],
      },
    ],
  };
}

async function meetingDecisionsList(ctx) {
  const { sp, t, lng, kindLabel, stamp } = ctx;
  const list = await api.get(`/meeting-decisions?${sp}`);
  const status = ['open', 'done'].includes(sp.get('status')) ? sp.get('status') : 'all';
  const title = t(`meeting.listTitle_${status}`);
  const today = todayISO();
  return {
    title,
    sheets: [
      {
        name: t('meeting.decisions'),
        title,
        lines: [`${kindLabel} · ${t('meeting.decisionCount', { count: list.length })}`, stamp],
        blocks: [
          table(
            list,
            [
              ...decisionColumns(ctx, today, true),
              { label: t('meeting.scope'), value: (d) => (d.branch_id ? branchName(d, lng) : t('meeting.wholeGroup')) },
            ],
            { empty: t(`meeting.noDecisions_${status}`) }
          ),
        ],
      },
    ],
  };
}

const BUILDERS = {
  sessions: sessionCard,
  members: memberCard,
  leaders: leaderCard,
  branches: branchCard,
  promotions: promotionsList,
  'members-list': membersList,
  'leaders-list': leadersList,
  'sessions-list': sessionsList,
  'prep-list': prepList,
  plan: planList,
  prep: prepCard,
  treasury: treasuryCard,
  'branch-money': branchMoneyCard,
  meeting: meetingCard,
  'meetings-list': meetingsList,
  'meeting-decisions': meetingDecisionsList,
};

// Named as the PDF is: «Fiche du membre — Ali Ahmad.xlsx»
const fileName = (s) =>
  `${s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)}.xlsx`;

/**
 * The Excel file of one export: `kind` and `id` as for the PDF, `query` the page's
 * filters (no leading «?»). `ctx`: { t, lng, can, user, section } from the page.
 */
export async function excelFile(kind, id, query, ctx) {
  const build = BUILDERS[kind];
  if (!build) throw notFound();
  const { t, user } = ctx;
  const kindLabel = t(LABELS[kind]);
  const stamp = [
    t('app.name'),
    `${t('print.generatedOn', { date: fmtDate(todayISO()) })}${
      user ? ` ${t('print.generatedBy', { name: user.display_name || user.username })}` : ''
    }`,
  ].join(' · ');
  const { title, sheets } = await build({ ...ctx, id: String(id), sp: new URLSearchParams(query), kindLabel, stamp });
  const blob = await workbookBlob({ sheets, rtl: ctx.lng === 'ar' });
  return { blob, filename: fileName(`${kindLabel} — ${title}`) };
}
