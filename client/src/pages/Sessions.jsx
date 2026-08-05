import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { fmtDate, todayISO, branchName } from '../utils';
import {
  cn,
  Button,
  Card,
  Input,
  Select,
  Label,
  Badge,
  Dialog,
  Table,
  Th,
  Td,
  EmptyState,
  IconPlus,
} from '../components/ui';

export default function Sessions() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [branches, setBranches] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: '',
    date: todayISO(),
    branch_id: '',
    leader: '',
    fee: '',
    matalib: [],
  });
  const [error, setError] = useState(null);

  const selectedBranch = branches.find((b) => b.id === Number(form.branch_id));

  function toggleMatalib(n) {
    setForm((f) => ({
      ...f,
      matalib: f.matalib.includes(n) ? f.matalib.filter((x) => x !== n) : [...f.matalib, n],
    }));
  }

  function load() {
    api.get('/sessions').then(setSessions).catch(console.error);
  }

  useEffect(() => {
    load();
    api.get('/branches').then((bs) => {
      setBranches(bs);
      setForm((f) => ({ ...f, branch_id: bs[0]?.id || '' }));
    });
  }, []);

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      const s = await api.post('/sessions', {
        ...form,
        branch_id: Number(form.branch_id),
        leader: form.leader || null,
        fee: form.fee === '' ? null : Number(form.fee),
        matalib: form.matalib,
      });
      setCreating(false);
      navigate(`/sessions/${s.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('session.title')}</h1>
        <Button onClick={() => setCreating(true)}>
          <IconPlus />
          {t('session.newSession')}
        </Button>
      </div>

      <Card>
        {sessions.length === 0 ? (
          <EmptyState>{t('session.noSessions')}</EmptyState>
        ) : (
          <Table>
            <thead className="border-b border-border">
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>{t('session.sessionTitle')}</Th>
                <Th>{t('member.branch')}</Th>
                <Th className="hidden md:table-cell">{t('session.leader')}</Th>
                <Th>{t('session.requirementsShort')}</Th>
                <Th>{t('session.attendance')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                  onClick={() => navigate(`/sessions/${s.id}`)}
                >
                  <Td>{fmtDate(s.date)}</Td>
                  <Td className="font-medium">{s.title}</Td>
                  <Td>
                    <Badge>{branchName(s, i18n.language)}</Badge>
                  </Td>
                  <Td className="hidden md:table-cell">{s.leader}</Td>
                  <Td>
                    <Badge variant="warning">{s.matalib.length}</Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="success">
                        {s.present_count} {t('session.present')}
                      </Badge>
                      <Badge variant="destructive">
                        {s.absent_count} {t('session.absent')}
                      </Badge>
                      <Badge variant="warning">
                        {s.excused_count} {t('session.excused')}
                      </Badge>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog open={creating} onClose={() => setCreating(false)} title={t('session.newSession')}>
        <form onSubmit={create} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="s_title">{t('session.sessionTitle')}</Label>
            <Input
              id="s_title"
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
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
          <div className="space-y-1.5">
            <Label htmlFor="s_branch">{t('session.branch')}</Label>
            <Select
              id="s_branch"
              required
              value={form.branch_id}
              onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value, matalib: [] }))}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {branchName(b, i18n.language)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s_leader">{t('session.leader')}</Label>
            <Input
              id="s_leader"
              required
              value={form.leader}
              onChange={(e) => setForm((f) => ({ ...f, leader: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s_fee">{t('session.fee')}</Label>
            <Input
              id="s_fee"
              type="number"
              min="0"
              step="0.01"
              value={form.fee}
              onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
            />
          </div>
          {selectedBranch?.total_requirements > 0 && (
            <div className="space-y-1.5">
              <Label>
                {t('session.requirements')} — {t('session.selectedCount', { count: form.matalib.length })}
              </Label>
              <div className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1 overflow-y-auto rounded-md border border-border p-2">
                {Array.from({ length: selectedBranch.total_requirements }, (_, i) => {
                  const n = i + 1;
                  const selected = form.matalib.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggleMatalib(n)}
                      className={cn(
                        'flex h-8 items-center justify-center rounded border text-[0.65rem] font-medium transition-colors cursor-pointer',
                        selected
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
