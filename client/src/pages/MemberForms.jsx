import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch, useUrlFilters } from '../hooks';
import { avatarName, branchName, fmtDate, fmtPhone, memberName } from '../utils';
import DatePicker from '../components/DatePicker';
import FilterSelect from '../components/FilterSelect';
import SearchInput from '../components/SearchInput';
import { copyText } from '../components/MemberBulkBar';
import { UnderlineTabs, phoneNumbers, waHref } from '../components/MemberParts';
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
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  cn,
  useConfirm,
  useToast,
  IconCheckAll,
  IconInbox,
  IconLink,
  IconWhatsApp,
} from '../components/ui';

/*
 * Fiches à compléter (server/memberForms.js). «À compléter»: each active عنصر (or, for the
 * admin, each قائد) whose file lacks something, with what was last sent; one tap prepares
 * the personal link and hands it to WhatsApp. «Réponses à valider»: what came back, field
 * by field, to correct, keep or leave out before it lands on the file.
 */

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const PHONE_KEYS = ['member_phone', 'father_phone', 'mother_phone', 'emergency_phone', 'phone'];
const NUMBER_KEYS = ['join_year', 'years_ghadir', 'years_total'];
// The two kinds of file: an عنصر's (his family answers) and a قائد's (he answers himself,
// the admin reviews — the قادة's files are the admin's alone)
const KINDS = {
  members: {
    api: '/member-forms',
    fk: 'member_id',
    profile: (id) => `/members/${id}`,
    recipients: [
      ['father', 'recipientFather'],
      ['mother', 'recipientMother'],
      ['member', 'recipientMember'],
    ],
    message: 'memberForms.waMessage',
    sendTitle: 'memberForms.sendTitle',
  },
  leaders: {
    api: '/leader-forms',
    fk: 'leader_id',
    profile: (id) => `/leaders/${id}`,
    recipients: [['self', 'recipientSelf']],
    message: 'memberForms.waMessageLeader',
    sendTitle: 'memberForms.sendTitleLeader',
  },
};
const LIVE = ['draft', 'sent', 'opened'];

const statusTone = { draft: 'outline', sent: 'info', opened: 'info', submitted: 'warning', expired: 'secondary', revoked: 'secondary', applied: 'success', confirmed: 'success', rejected: 'secondary' };

function StatusBadge({ form }) {
  const { t } = useTranslation();
  if (!form) return null;
  const when = { opened: form.opened_at, applied: form.reviewed_at, confirmed: form.reviewed_at }[form.status] ?? form.sent_at;
  const date = fmtDate(when?.slice(0, 10));
  return <Badge variant={statusTone[form.status]}>{t(`memberForms.status.${form.status}`, { date })}</Badge>;
}

export default function MemberForms() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [sp, patch] = useUrlFilters();
  const isAdmin = user?.role === 'admin';
  const who = isAdmin && sp.get('who') === 'leaders' ? 'leaders' : 'members';
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('memberForms.title')}
        description={t(who === 'leaders' ? 'memberForms.descriptionLeaders' : 'memberForms.description')}
      >
        {isAdmin && (
          <SegmentedControl
            label={t('memberForms.whoLabel')}
            options={[
              { value: 'members', label: t('memberForms.whoMembers') },
              { value: 'leaders', label: t('memberForms.whoLeaders') },
            ]}
            value={who}
            onChange={(v) => patch({ who: v === 'leaders' ? 'leaders' : '', tab: '', branch: '', show: '' })}
          />
        )}
      </PageHeader>
      {/* Keyed: each kind fetches its own lists */}
      <FormsPanel key={who} kind={KINDS[who]} who={who} />
    </div>
  );
}

function FormsPanel({ kind, who }) {
  const { t } = useTranslation();
  const [sp, patch] = useUrlFilters();
  const tab = sp.get('tab') === 'review' ? 'review' : 'send';
  const overview = useFetch(kind.api);
  const pending = useFetch(`${kind.api}/pending`);

  const reloadAll = () => {
    overview.reload({ quiet: true });
    pending.reload({ quiet: true });
  };

  const tabs = [
    { id: 'send', label: t('memberForms.tabSend'), count: overview.data?.people.filter((m) => m.missing.length).length },
    { id: 'review', label: t('memberForms.tabReview'), count: pending.data?.length ?? overview.data?.pending },
  ];

  return (
    <div className="space-y-4">
        <UnderlineTabs
          items={tabs}
          value={tab}
          onChange={(id) => patch({ tab: id === 'review' ? 'review' : '' })}
          label={t('memberForms.title')}
          idPrefix="mf-tab"
          panelId="mf-panel"
        />
        <div id="mf-panel" role="tabpanel" aria-labelledby={`mf-tab-${tab}`}>
          {tab === 'send' ? (
            <SendList kind={kind} who={who} overview={overview} onChanged={reloadAll} onReview={() => patch({ tab: 'review' })} />
          ) : (
            <ReviewList kind={kind} pending={pending} onChanged={reloadAll} />
          )}
        </div>
    </div>
  );
}

// ---------- À compléter ----------

function SendList({ kind, who, overview, onChanged, onReview }) {
  const { t, i18n } = useTranslation();
  const [sp, patch] = useUrlFilters();
  // قادة have no فرقة: the filter is for عناصر only
  const branches = useFetch('/branches', { skip: who === 'leaders' });
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(null);
  const branch = sp.get('branch') || '';
  const show = ['todo', 'waiting', 'all'].includes(sp.get('show')) ? sp.get('show') : 'todo';

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // «Tous» takes in complete files too: a family can still check and correct them
    return (overview.data?.people || []).filter((m) => {
      if (branch && String(m.branch_id) !== branch) return false;
      if (needle && !memberName(m).toLowerCase().includes(needle)) return false;
      const live = m.form && LIVE.includes(m.form.status) && m.form.status !== 'draft';
      if (show === 'todo') return m.missing.length > 0 && !live && m.form?.status !== 'submitted';
      if (show === 'waiting') return live || m.form?.status === 'submitted';
      return true;
    });
  }, [overview.data, branch, show, q]);

  const branchById = useMemo(() => new Map((branches.data || []).map((b) => [b.id, b])), [branches.data]);

  if (overview.error) return <ErrorState message={overview.error} onRetry={() => overview.reload()} retryLabel={t('error.retry')} />;
  if (!overview.data)
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );

  const anyMissing = overview.data.people.some((m) => m.missing.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder={t('member.name')} className="min-w-48 flex-1" autoFocusHotkey={false} />
        {who === 'members' && (branches.data?.length || 0) > 1 && (
          <FilterSelect
            value={branch}
            onChange={(v) => patch({ branch: v })}
            allLabel={t('member.allBranches')}
            ariaLabel={t('member.branch')}
            options={branches.data.map((b) => ({ value: String(b.id), label: branchName(b, i18n.language) }))}
            className="w-auto"
          />
        )}
        <SegmentedControl
          label={t('memberForms.show')}
          size="sm"
          options={[
            { value: 'todo', label: t('memberForms.showTodo') },
            { value: 'waiting', label: t('memberForms.showWaiting') },
            { value: 'all', label: t('memberForms.showAll') },
          ]}
          value={show}
          onChange={(v) => patch({ show: v === 'todo' ? '' : v })}
        />
      </div>

      {!anyMissing && show === 'todo' ? (
        <EmptyState icon={<IconCheckAll className="h-6 w-6" />} title={t('memberForms.noneMissingTitle')}>
          {t(who === 'leaders' ? 'memberForms.noneMissingBodyLeaders' : 'memberForms.noneMissingBody')}
        </EmptyState>
      ) : !rows.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('memberForms.noMatch')}</p>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {rows.map((m) => (
            <MemberRow
              key={m.id}
              kind={kind}
              m={m}
              branch={branchById.get(m.branch_id)}
              onSend={() => setSending(m)}
              onReview={onReview}
            />
          ))}
        </Card>
      )}

      <SendDialog
        kind={kind}
        member={sending}
        onClose={() => setSending(null)}
        onChanged={onChanged}
      />
    </div>
  );
}

function MemberRow({ kind, m, branch, onSend, onReview }) {
  const { t, i18n } = useTranslation();
  const labels = m.missing.map((k) => t(`fiche.fields.${k}`));
  const submitted = m.form?.status === 'submitted';
  const live = m.form && LIVE.includes(m.form.status) && m.form.status !== 'draft';
  return (
    <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <Avatar photo={m.photo} name={avatarName(m)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={kind.profile(m.id)} className="focus-ring truncate rounded font-medium hover:underline">
            {memberName(m)}
          </Link>
          <StatusBadge form={m.form} />
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[branch && branchName(branch, i18n.language), m.missing.length ? t('memberForms.missingCount', { count: m.missing.length }) : t('memberForms.complete')]
            .filter(Boolean)
            .join(' · ')}
          {labels.length > 0 && <span className="max-sm:hidden"> — {labels.join(i18n.language === 'ar' ? '، ' : ', ')}</span>}
        </p>
      </div>
      {submitted ? (
        <Button size="sm" variant="outline" onClick={onReview}>
          {t('memberForms.review')}
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onSend}>
          <IconWhatsApp className={cn('h-4 w-4', !live && 'text-[#1a7f45]')} />
          {t(live ? 'memberForms.resend' : 'memberForms.send')}
        </Button>
      )}
    </div>
  );
}

/** The recipient the link goes to first: a parent for a child, the عنصر himself from 16. */
function defaultRecipient(m) {
  const has = (k) => phoneNumbers(m.phones[k] || '').length > 0;
  if ('self' in m.phones) return has('self') ? 'self' : null;
  const age = m.birth_date ? (Date.now() - new Date(`${m.birth_date}T00:00:00`)) / 3.15576e10 : null;
  if (age !== null && age >= 16 && has('member')) return 'member';
  return ['father', 'mother', 'member'].find(has) || null;
}

function SendDialog({ kind, member, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [recipient, setRecipient] = useState(null);
  const [lang, setLang] = useState(i18n.language === 'fr' ? 'fr' : 'ar');
  const open = !!member;

  // Opening the dialog prepares the link (or finds the one still valid): the WhatsApp
  // button can then be a plain link, which no popup blocker stops
  useEffect(() => {
    if (!member) return;
    setForm(null);
    setError(null);
    setRecipient(member.form && LIVE.includes(member.form.status) && member.form.recipient ? member.form.recipient : defaultRecipient(member));
    setLang(member.form?.lang || (['FR', 'FRF'].includes(member.section) ? 'fr' : 'ar'));
    let alive = true;
    api
      .post(kind.api, { [kind.fk]: member.id })
      .then((f) => alive && setForm(f))
      .catch((err) => alive && setError(err));
    return () => {
      alive = false;
    };
  }, [member]); // eslint-disable-line react-hooks/exhaustive-deps -- one kind per panel

  if (!member) return <Dialog open={false} onClose={onClose} title="" />;

  const url = form?.token ? `${window.location.origin}/fiche/${form.token}` : '';
  const T = i18n.getFixedT(lang);
  const message = form
    ? T(kind.message, {
        org: T('memberForms.org'),
        name: member.first_name,
        url,
        date: new Intl.DateTimeFormat(lang === 'ar' ? 'ar-LB-u-nu-latn' : 'fr-FR', { day: 'numeric', month: 'long' }).format(new Date(`${form.expires_at.slice(0, 10)}T12:00:00`)),
      })
    : '';
  const phone = recipient ? phoneNumbers(member.phones[recipient] || '')[0] : null;
  const recipients = kind.recipients.filter(([k]) => phoneNumbers(member.phones[k] || '').length);

  const markSent = (via) =>
    api
      .post(`${kind.api}/${form.id}/sent`, { recipient: via === 'whatsapp' ? recipient : null, lang })
      .then(() => onChanged())
      .catch(() => {});

  async function copy() {
    try {
      await copyText(message);
      toast.success(t('memberForms.copied'));
      markSent('copy');
    } catch {
      toast.error(t('memberForms.copyFailed'));
    }
  }

  async function revoke() {
    if (!(await confirm({ title: t('memberForms.revoke'), message: t('memberForms.revokeConfirm'), confirmLabel: t('memberForms.revoke') }))) return;
    try {
      await api.post(`${kind.api}/${form.id}/revoke`);
      toast.success(t('memberForms.revoked'));
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const errorText =
    error?.code === 'pending_review' ? t('memberForms.pendingReview')
      : error?.code === 'nothing_missing' ? t('memberForms.nothingMissing')
        : error ? error.message : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(kind.sendTitle)}
      description={
        // bdi: an Arabic name inside a French line keeps the count where it belongs
        <>
          <bdi>{memberName(member)}</bdi> ·{' '}
          {member.missing.length ? t('memberForms.missingCount', { count: member.missing.length }) : t('memberForms.complete')}
        </>
      }
      footer={
        form && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={copy} className="max-sm:flex-1">
              <IconLink />
              {t('memberForms.copyLink')}
            </Button>
            {phone && (
              <a
                href={`${waHref(phone)}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => markSent('whatsapp')}
                className="focus-ring inline-flex h-11 items-center max-sm:flex-1 justify-center gap-2 rounded-lg bg-[#1a7f45] px-4 text-sm font-medium text-white transition-[background-color,scale] duration-150 hover:bg-[#166b3a] active:scale-[0.96] sm:h-10"
              >
                <IconWhatsApp className="h-4 w-4" />
                {t('memberForms.openWhatsApp')}
              </a>
            )}
          </div>
        )
      }
    >
      {errorText ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3.5 py-3 text-sm font-medium text-destructive">{errorText}</p>
      ) : !form ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>{t('memberForms.recipient')}</Label>
            {recipients.length ? (
              <SegmentedControl
                label={t('memberForms.recipient')}
                options={recipients.map(([k, key]) => ({
                  value: k,
                  label: (
                    <span className="flex flex-col items-center leading-tight">
                      <span>{t(`memberForms.${key}`)}</span>
                      <span dir="ltr" className="text-[0.6875rem] font-normal opacity-80 tabular-nums">
                        {fmtPhone(phoneNumbers(member.phones[k])[0])}
                      </span>
                    </span>
                  ),
                }))}
                value={recipient}
                onChange={setRecipient}
                className="flex w-full"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('memberForms.noPhone')}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t('memberForms.language')}</Label>
            <SegmentedControl
              label={t('memberForms.language')}
              size="sm"
              options={[
                { value: 'ar', label: 'العربية' },
                { value: 'fr', label: 'Français' },
              ]}
              value={lang}
              onChange={setLang}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('memberForms.preview')}</Label>
            <p
              dir={lang === 'ar' ? 'rtl' : 'ltr'}
              lang={lang}
              className="whitespace-pre-line break-words rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-sm"
            >
              {message}
            </p>
            {member.missing.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('memberForms.asked')} : {member.missing.map((k) => t(`fiche.fields.${k}`)).join(i18n.language === 'ar' ? '، ' : ', ')}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>{t('memberForms.validUntil', { date: fmtDate(form.expires_at.slice(0, 10)) })}</span>
            <Button variant="destructive-ghost" size="sm" onClick={revoke}>
              {t('memberForms.revoke')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------- Réponses à valider ----------

function ReviewList({ kind, pending, onChanged }) {
  const { t } = useTranslation();
  if (pending.error) return <ErrorState message={pending.error} onRetry={() => pending.reload()} retryLabel={t('error.retry')} />;
  if (!pending.data) return <Skeleton className="h-64 w-full" />;
  if (!pending.data.length)
    return (
      <EmptyState icon={<IconInbox className="h-6 w-6" />} title={t('memberForms.noPendingTitle')}>
        {t('memberForms.noPendingBody')}
      </EmptyState>
    );
  return (
    <div className="space-y-4">
      {pending.data.map((f) => (
        <ReviewCard key={f.id} kind={kind} f={f} onDone={onChanged} />
      ))}
    </div>
  );
}

const blank = (v) => v === null || v === undefined || v === '';

function ReviewCard({ kind, f, onDone }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  // Everything starts ticked — a correction was asked for on purpose; its current value
  // stands beside it, and unticking keeps the file as it is
  const [picked, setPicked] = useState(() => new Set(f.answers.map((a) => a.key)));
  const [values, setValues] = useState(() => Object.fromEntries(f.answers.map((a) => [a.key, a.value])));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const toggle = (key) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setValue = (key, v) => setValues((s) => ({ ...s, [key]: v }));

  async function apply() {
    if (!picked.size) {
      setError(t('memberForms.pickOne'));
      return;
    }
    setBusy('apply');
    setError(null);
    try {
      const fields = [...picked];
      await api.post(`${kind.api}/${f.id}/apply`,{ fields, values: Object.fromEntries(fields.map((k) => [k, values[k]])) });
      toast.success(t('memberForms.applied'));
      onDone();
    } catch (err) {
      setBusy(null);
      setError(err.code === 'invalid_value' ? `${t(`fiche.fields.${err.body?.field}`)} : ${t('fiche.errInvalid')}` : err.message);
    }
  }

  async function reject() {
    if (!(await confirm({ title: t('memberForms.reject'), message: t('memberForms.rejectConfirm'), confirmLabel: t('memberForms.reject') }))) return;
    setBusy('reject');
    try {
      await api.post(`${kind.api}/${f.id}/reject`);
      toast.success(t('memberForms.rejected'));
      onDone();
    } catch (err) {
      setBusy(null);
      toast.error(err.message);
    }
  }

  const show = (key, v) =>
    key === 'can_swim' ? t(v ? 'fiche.yes' : 'fiche.no')
      : key === 'marital_status' ? t(`leader.${v}`)
        : PHONE_KEYS.includes(key) ? fmtPhone(v)
          : key === 'birth_date' ? fmtDate(v)
            : v;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Avatar photo={f.person.photo} name={avatarName(f.person)} />
        <div className="min-w-0 flex-1">
          <Link to={kind.profile(f.person.id)} className="focus-ring block truncate rounded font-medium hover:underline">
            {memberName(f.person)}
          </Link>
          <p className="text-xs text-muted-foreground">
            {t('memberForms.filledBy', {
              who: t(kind.fk === 'leader_id' ? 'memberForms.who.leader' : `memberForms.who.${f.respondent}`),
              date: fmtDate(f.submitted_at.slice(0, 10)),
            })}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {f.answers.map((a) => {
          const on = picked.has(a.key);
          const id = `mf${f.id}-${a.key}`;
          return (
            <li key={a.key} className={cn('flex gap-3 px-4 py-3 transition-colors', !on && 'bg-muted/30')}>
              <input
                id={`${id}-pick`}
                type="checkbox"
                checked={on}
                onChange={() => toggle(a.key)}
                className="mt-2.5 size-4.5 shrink-0 cursor-pointer accent-[var(--primary)]"
              />
              <div className="min-w-0 max-w-xl flex-1 space-y-1.5">
                <label htmlFor={`${id}-pick`} className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
                  {t(`fiche.fields.${a.key}`)}
                  {!blank(a.current) && <Badge variant="warning">{t('memberForms.correction')}</Badge>}
                </label>
                <ValueEditor id={id} k={a.key} value={values[a.key]} onChange={(v) => setValue(a.key, v)} disabled={!on} />
                {!blank(a.current) && (
                  <p className="text-xs text-muted-foreground">
                    {t('memberForms.current', { value: '' })}
                    <span className="line-through decoration-destructive/60">{show(a.key, a.current)}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {f.hidden > 0 && <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">{t('memberForms.hidden', { count: f.hidden })}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4 py-3">
        {error && (
          <p role="alert" className="me-auto text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button variant="destructive-ghost" onClick={reject} loading={busy === 'reject'} disabled={!!busy}>
          {t('memberForms.reject')}
        </Button>
        <Button variant="brand" onClick={apply} loading={busy === 'apply'} disabled={!!busy}>
          {t('memberForms.apply', { count: picked.size })}
        </Button>
      </div>
    </Card>
  );
}

/** The family's answer, editable by the قائد before it lands (same rules as the server). */
function ValueEditor({ id, k, value, onChange, disabled }) {
  const { t } = useTranslation();
  if (k === 'can_swim')
    return (
      <SegmentedControl
        label={t('fiche.fields.can_swim')}
        size="sm"
        options={[
          { value: 'no', label: t('fiche.no') },
          { value: 'yes', label: t('fiche.yes') },
        ]}
        value={value ? 'yes' : 'no'}
        onChange={(v) => !disabled && onChange(v === 'yes')}
        className={cn(disabled && 'pointer-events-none opacity-60')}
      />
    );
  if (k === 'blood_type')
    return (
      <Select id={id} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="max-w-40">
        {BLOOD_TYPES.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </Select>
    );
  if (k === 'birth_date')
    return <DatePicker id={id} toYear={new Date().getFullYear()} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
  if (k === 'allergies' || k === 'treatment' || k === 'education')
    return <Textarea id={id} rows={1} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} maxLength={1000} />;
  if (k === 'marital_status')
    return (
      <SegmentedControl
        label={t('fiche.fields.marital_status')}
        size="sm"
        options={[
          { value: 'single', label: t('leader.single') },
          { value: 'married', label: t('leader.married') },
        ]}
        value={value || ''}
        onChange={(v) => !disabled && onChange(v)}
        className={cn(disabled && 'pointer-events-none opacity-60')}
      />
    );
  if (NUMBER_KEYS.includes(k))
    return (
      <Input
        id={id}
        inputMode="numeric"
        dir="ltr"
        maxLength={k === 'join_year' ? 4 : 2}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        disabled={disabled}
        className="max-w-32"
      />
    );
  return (
    <Input
      id={id}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      {...(PHONE_KEYS.includes(k) ? { type: 'tel', inputMode: 'tel', dir: 'ltr' } : {})}
    />
  );
}
