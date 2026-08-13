import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useDebounced, useFetch } from '../hooks';
import { fmtDate, todayISO, branchName } from '../utils';
import DateRangePicker from '../components/DateRangePicker';
import FilterSelect from '../components/FilterSelect';
import SearchInput from '../components/SearchInput';
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  RequirementGrid,
  SegmentedControl,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  useToast,
  IconCalendar,
  IconFilter,
  IconPlus,
  IconShield,
  IconX,
} from '../components/ui';

const EMPTY = {
  kind: 'activity',
  title: '',
  date: todayISO(),
  branch_id: '',
  leader_id: '',
  helper_ids: [],
  member_ids: [],
  fee: '',
  matalib: [],
};

function AttendanceChips({ s, t }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="success">
        {s.present_count} {t('session.present')}
      </Badge>
      <Badge variant="destructive">
        {s.absent_count} {t('session.absent')}
      </Badge>
      {s.excused_count > 0 && (
        <Badge variant="warning">
          {s.excused_count} {t('session.excused')}
        </Badge>
      )}
    </div>
  );
}

export default function Sessions() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { canEdit } = usePerms();
  const editable = canEdit('sessions');

  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const dq = useDebounced(q, 250);
  const params = new URLSearchParams();
  if (dq) params.set('q', dq);
  if (branch) params.set('branch', branch);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const sessions = useFetch(`/sessions?${params}`);
  const branches = useFetch('/branches');
  const leaders = useFetch('/leaders');
  const members = useFetch('/members');

  const activeFilters = [branch, from, to].filter(Boolean).length;
  const filtering = activeFilters > 0 || !!q;

  function clearFilters() {
    setQ('');
    setBranch('');
    setFrom('');
    setTo('');
  }

  const [creating, setCreating] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [helperQuery, setHelperQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  const branchList = branches.data || [];
  const leaderList = leaders.data || [];
  const list = sessions.data || [];
  const selectedBranch = branchList.find((b) => b.id === Number(form.branch_id));

  // Pre-select the first branch and its current تشكيلة leader once branches load
  useEffect(() => {
    if (!branchList.length || form.branch_id) return;
    setForm((f) => ({ ...f, branch_id: branchList[0].id, leader_id: branchList[0].leader_id || '' }));
  }, [branchList, form.branch_id]);

  function toggleMatalib(n) {
    setForm((f) => ({
      ...f,
      matalib: f.matalib.includes(n) ? f.matalib.filter((x) => x !== n) : [...f.matalib, n],
    }));
  }

  // Selecting a branch auto-picks its leader from the current تشكيلة (still changeable)
  function pickBranch(branchId) {
    const b = branchList.find((x) => x.id === Number(branchId));
    setForm((f) => ({
      ...f,
      branch_id: branchId,
      matalib: [],
      // عناصر of the previous فرقة are no longer visitable
      member_ids: [],
      leader_id: b?.leader_id || f.leader_id,
    }));
  }

  // Switching type resets what no longer applies: مطالب and عناصر belong to a فرقة نشاط only
  function pickKind(kind) {
    setForm((f) => ({
      ...f,
      kind,
      title: kind === 'visit' ? t('session.familyVisit') : f.title === t('session.familyVisit') ? '' : f.title,
      matalib: [],
      member_ids: [],
      fee: kind === 'visit' ? '' : f.fee,
    }));
  }

  function toggleVisited(id) {
    setForm((f) => ({
      ...f,
      member_ids: f.member_ids.includes(id)
        ? f.member_ids.filter((x) => x !== id)
        : [...f.member_ids, id],
    }));
  }

  function toggleHelper(id) {
    setForm((f) => ({
      ...f,
      helper_ids: f.helper_ids.includes(id)
        ? f.helper_ids.filter((x) => x !== id)
        : [...f.helper_ids, id],
    }));
  }

  async function create(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const s = await api.post('/sessions', {
        ...form,
        branch_id: form.kind === 'leaders' ? null : Number(form.branch_id),
        leader_id: form.leader_id === '' ? null : Number(form.leader_id),
        helper_ids: form.helper_ids.filter((h) => h !== Number(form.leader_id)),
        member_ids: form.kind === 'visit' ? form.member_ids : [],
        fee: form.fee === '' ? null : Number(form.fee),
        matalib: form.kind === 'visit' ? [] : form.matalib,
      });
      setCreating(false);
      setForm({ ...EMPTY, branch_id: form.branch_id, leader_id: form.leader_id });
      toast.success(t('session.created'));
      navigate(`/sessions/${s.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const availableHelpers = leaderList.filter(
    (l) => l.status === 'active' && l.id !== Number(form.leader_id)
  );
  const isVisit = form.kind === 'visit';
  // نشاط قادة: no فرقة, no عناصر, no مطالب — only the قادة who take part
  const isLeadersOnly = form.kind === 'leaders';
  // Both pickers stay usable with 40+ names: filter on the full name, and never
  // hide an already-ticked row — otherwise a search makes selections look lost.
  const matches = (person, query) =>
    `${person.first_name} ${person.last_name}`.toLowerCase().includes(query.trim().toLowerCase());

  // A زيارة is recorded inside a فرقة, so only its active عناصر can be visited
  const visitableMembers = (members.data || []).filter(
    (m) =>
      m.status === 'active' &&
      m.branch_id === Number(form.branch_id) &&
      (!memberQuery || form.member_ids.includes(m.id) || matches(m, memberQuery))
  );
  const shownHelpers = availableHelpers.filter(
    (l) => !helperQuery || form.helper_ids.includes(l.id) || matches(l, helperQuery)
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('session.title')}
        description={
          filtering ? t('session.resultCount', { count: list.length }) : t('session.subtitle')
        }
      >
        {editable && (
          <Button variant="brand" onClick={() => setCreating(true)}>
            <IconPlus />
            {t('session.newSession')}
          </Button>
        )}
      </PageHeader>

      {/* Search always visible; the rest folds away on phones to keep the list
          near the top, and is permanently open from sm up. */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder={t('session.searchPlaceholder')} />
          <Button
            variant="outline"
            size="icon"
            className="relative sm:hidden"
            aria-expanded={showFilters}
            aria-label={t('session.filters')}
            onClick={() => setShowFilters((v) => !v)}
          >
            <IconFilter />
            {activeFilters > 0 && (
              <span className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[0.6rem] font-bold text-primary-foreground">
                {activeFilters}
              </span>
            )}
          </Button>
        </div>

        <div
          className={cn(
            'flex-col gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center',
            showFilters ? 'flex' : 'hidden'
          )}
        >
          <FilterSelect
            value={branch}
            onChange={setBranch}
            allLabel={t('member.allBranches')}
            ariaLabel={t('member.branch')}
            className="sm:w-auto sm:min-w-44"
            icon={<IconShield className="opacity-60" />}
            options={branchList.map((b) => ({
              value: b.id,
              label: branchName(b, i18n.language),
            }))}
          />
          <DateRangePicker
            value={{ from, to }}
            onChange={({ from: f, to: tt }) => {
              setFrom(f);
              setTo(tt);
            }}
          />
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <IconX />
              {t('common.clearFilters')}
            </Button>
          )}
        </div>
      </div>

      {sessions.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={sessions.reload} retryLabel={t('error.retry')} />
      ) : sessions.loading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-2 p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconCalendar className="h-6 w-6" />}
            title={t(filtering ? 'common.noResults' : 'session.noSessions')}
            action={
              filtering ? (
                <Button variant="outline" onClick={clearFilters}>
                  {t('common.clearFilters')}
                </Button>
              ) : editable ? (
                <Button variant="brand" onClick={() => setCreating(true)}>
                  <IconPlus />
                  {t('session.newSession')}
                </Button>
              ) : null
            }
          >
            {t(filtering ? 'common.noResultsHint' : 'session.noSessionsHint')}
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <Card className="md:hidden">
            <ul className="divide-y divide-border">
              {list.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/sessions/${s.id}`}
                    className="focus-ring block px-4 py-3 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{s.title}</span>
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {fmtDate(s.date)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {s.branch_id ? (
                        <Badge>{branchName(s, i18n.language)}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('session.kindLeaders')}</Badge>
                      )}
                      {s.kind === 'visit' && <Badge variant="warning">{t('session.kindVisit')}</Badge>}
                      {s.matalib.length > 0 && (
                        <Badge variant="warning">
                          {s.matalib.length} {t('session.requirementsShort')}
                        </Badge>
                      )}
                      {s.leader && (
                        <span className="truncate text-xs text-muted-foreground">{s.leader}</span>
                      )}
                    </div>
                    <div className="mt-2">
                      <AttendanceChips s={s} t={t} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {/* Desktop table */}
          <Card className="hidden md:block">
            <Table>
              <thead className="border-b border-border">
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('session.sessionTitle')}</Th>
                  <Th>{t('member.branch')}</Th>
                  <Th>{t('session.leader')}</Th>
                  <Th>{t('session.requirementsShort')}</Th>
                  <Th>{t('session.attendance')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((s) => (
                  <tr key={s.id} className="group transition-colors hover:bg-accent/40">
                    <Td className="tabular-nums">{fmtDate(s.date)}</Td>
                    <Td>
                      <Link
                        to={`/sessions/${s.id}`}
                        className="focus-ring rounded font-medium group-hover:text-primary"
                      >
                        {s.title}
                      </Link>
                      {s.kind === 'visit' && (
                        <Badge variant="warning" className="ms-2">
                          {t('session.kindVisit')}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      {s.branch_id ? (
                        <Badge>{branchName(s, i18n.language)}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('session.kindLeaders')}</Badge>
                      )}
                    </Td>
                    <Td className="text-muted-foreground">{s.leader || '—'}</Td>
                    <Td>
                      <Badge variant={s.matalib.length ? 'warning' : 'outline'}>{s.matalib.length}</Badge>
                    </Td>
                    <Td>
                      <AttendanceChips s={s} t={t} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={t(isVisit ? 'session.newVisit' : isLeadersOnly ? 'session.newLeadersSession' : 'session.newSession')}
      >
        <form onSubmit={create} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="block">{t('session.kind')}</Label>
            <SegmentedControl
              className="w-full"
              options={[
                { value: 'activity', label: t('session.kindActivity') },
                { value: 'visit', label: t('session.kindVisit') },
                { value: 'leaders', label: t('session.kindLeaders') },
              ]}
              value={form.kind}
              onChange={pickKind}
              label={t('session.kind')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s_title">{t('session.sessionTitle')}</Label>
            <Input
              id="s_title"
              required
              autoComplete="off"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s_date">{t('common.date')}</Label>
              <Input
                id="s_date"
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            {!isVisit && (
              <div className="space-y-1.5">
                <Label htmlFor="s_fee">{t('session.fee')}</Label>
                <Input
                  id="s_fee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="—"
                  value={form.fee}
                  onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
                />
              </div>
            )}
            {!isLeadersOnly && (
              <div className="space-y-1.5">
                <Label htmlFor="s_branch">{t('session.branch')}</Label>
                <Select id="s_branch" required value={form.branch_id} onChange={(e) => pickBranch(e.target.value)}>
                  {branchList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {branchName(b, i18n.language)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="s_leader">
                {t(isVisit || isLeadersOnly ? 'session.visitMainLeader' : 'session.leader')}
              </Label>
              <Select
                id="s_leader"
                required
                value={form.leader_id}
                onChange={(e) => setForm((f) => ({ ...f, leader_id: e.target.value }))}
              >
                <option value="" disabled>
                  {t('leader.selectLeader')}
                </option>
                {leaderList
                  .filter((l) => l.status === 'active' || l.id === Number(form.leader_id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.first_name} {l.last_name}
                    </option>
                  ))}
              </Select>
            </div>
          </div>

          {/* زيارة الأهل: pick the عناصر whose families were visited — each one gets the
              visit recorded in their file the moment the نشاط is saved */}
          {isVisit && (
            <div className="space-y-1.5">
              <Label>
                {t('session.visitedMembers')}
                <span className="ms-2 font-normal text-muted-foreground">
                  {t('session.selectedCount', { count: form.member_ids.length })}
                </span>
              </Label>
              <SearchInput
                value={memberQuery}
                onChange={setMemberQuery}
                autoFocusHotkey={false}
                placeholder={t('session.searchMember')}
              />
              {visitableMembers.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {t(memberQuery ? 'common.noResults' : 'member.noMembers')}
                </p>
              ) : (
                <div className="max-h-52 overflow-y-auto rounded-md border border-border p-1.5">
                  {visitableMembers.map((m) => (
                    <label
                      key={m.id}
                      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-accent/60 sm:min-h-9"
                    >
                      <input
                        type="checkbox"
                        checked={form.member_ids.includes(m.id)}
                        onChange={() => toggleVisited(m.id)}
                      />
                      {m.first_name} {m.last_name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              {t(isVisit || isLeadersOnly ? 'session.visitParticipants' : 'session.helpers')}
              <span className="ms-2 font-normal text-muted-foreground">
                {t('session.selectedCount', { count: form.helper_ids.length })}
              </span>
            </Label>
            {availableHelpers.length > 0 && (
              <SearchInput
                value={helperQuery}
                onChange={setHelperQuery}
                autoFocusHotkey={false}
                placeholder={t('session.searchLeader')}
              />
            )}
            {shownHelpers.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t(availableHelpers.length === 0 ? 'session.noHelpersAvailable' : 'common.noResults')}
              </p>
            ) : (
              <div className="max-h-52 overflow-y-auto rounded-md border border-border p-1.5">
                {shownHelpers.map((l) => (
                  <label
                    key={l.id}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-accent/60 sm:min-h-9"
                  >
                    <input
                      type="checkbox"
                      checked={form.helper_ids.includes(l.id)}
                      onChange={() => toggleHelper(l.id)}
                    />
                    {l.first_name} {l.last_name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {!isVisit && !isLeadersOnly && selectedBranch?.total_requirements > 0 && (
            <div className="space-y-1.5">
              <Label>
                {t('session.requirements')}
                <span className="ms-2 font-normal text-muted-foreground">
                  {t('session.selectedCount', { count: form.matalib.length })}
                </span>
              </Label>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border p-2">
                <RequirementGrid
                  total={selectedBranch.total_requirements}
                  selected={form.matalib}
                  onToggle={toggleMatalib}
                  label={t('session.requirements')}
                />
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
