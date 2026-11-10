import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { displayError } from '../lib/errors';
import { avatarName, memberName } from '../utils';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  Field,
  Textarea,
  useToast,
  IconCheck,
  IconHome,
  IconPencil,
  IconPlus,
  IconSwap,
} from './ui';

// زيارة الأهل : qui a reçu les قادة, et de quoi on a parlé — mêmes listes que le serveur
export const VISIT_MET = ['father', 'mother', 'parents', 'guardian', 'other'];
export const VISIT_TOPICS = ['attendance', 'behavior', 'studies', 'health', 'dues', 'activities', 'family', 'other'];

export const hasVisitDetails = (v) =>
  !!(v && (v.visit_met || v.visit_topics?.length || v.visit_note || v.visit_followup));

/** A round pill that toggles, as the فرق picker of the séance form. */
function ChoiceChip({ on, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-[color,background-color,border-color,scale] active:scale-[0.97] sm:min-h-9',
        on
          ? 'border-primary bg-primary-soft font-medium text-primary'
          : 'border-input bg-card text-muted-foreground hover:bg-accent'
      )}
    >
      <IconSwap on={on} onIcon={<IconCheck className="h-3.5 w-3.5" />} className="h-3.5 w-3.5" collapse />
      {children}
    </button>
  );
}

/**
 * What happened at one family's, as it reads on the visit's page, in the member's file
 * and in his follow-up thread. Nothing when nothing was written.
 */
export function VisitDetails({ v, className }) {
  const { t } = useTranslation();
  if (!hasVisitDetails(v)) return null;
  return (
    <div className={cn('space-y-1.5 text-sm', className)}>
      {(v.visit_met || v.visit_topics?.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {v.visit_met && (
            <span className="me-1 text-muted-foreground">
              {t('visit.metBy', { who: t(`visit.met.${v.visit_met}`) })}
            </span>
          )}
          {(v.visit_topics || []).map((k) => (
            <Badge key={k} variant="secondary">
              {t(`visit.topic.${k}`)}
            </Badge>
          ))}
        </div>
      )}
      {v.visit_note && <p dir="auto" className="whitespace-pre-line text-start [overflow-wrap:anywhere]">{v.visit_note}</p>}
      {v.visit_followup && (
        <p dir="auto" className="rounded-lg border border-warning-line bg-warning-soft px-3 py-2 whitespace-pre-line text-start text-foreground [overflow-wrap:anywhere]">
          <span className="font-medium text-warning">{t('visit.followup')}</span>
          {' — '}
          {v.visit_followup}
        </p>
      )}
    </div>
  );
}

/** Le récit général de la visite : déroulement, ambiance, ce qui a été convenu. */
export function VisitReportCard({ session, editable, onChange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const report = session.report || '';

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.put(`/sessions/${session.id}/report`, { report: draft });
      onChange(r.report);
      setDraft(null);
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t('visit.report')}</CardTitle>
        {editable && draft === null && report && (
          <Button variant="outline" size="sm" onClick={() => setDraft(report)}>
            <IconPencil />
            {t('common.edit')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {draft !== null ? (
          <form onSubmit={save} className="space-y-3">
            <Field hint={t('visit.reportHint')}>
              {(p) => (
                <Textarea
                  {...p}
                  dir="auto"
                  aria-label={t('visit.report')}
                  rows={5}
                  maxLength={4000}
                  autoFocus
                  value={draft}
                  placeholder={t('visit.reportPlaceholder')}
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={saving}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        ) : report ? (
          <p dir="auto" className="text-sm whitespace-pre-line text-start [overflow-wrap:anywhere]">{report}</p>
        ) : editable ? (
          <button
            type="button"
            onClick={() => setDraft('')}
            className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-primary/40 px-3 py-2.5 text-start text-sm text-primary transition-colors hover:bg-primary/8"
          >
            <IconPlus className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">{t('visit.reportAdd')}</span>
              <span className="block text-xs text-muted-foreground">{t('visit.reportHint')}</span>
            </span>
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('visit.noReport')}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Une famille : qui a reçu, les sujets, ce qui s'est dit, la suite à donner. */
function VisitNoteDialog({ session, member, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    met: member.visit_met || '',
    topics: member.visit_topics || [],
    note: member.visit_note || '',
    followup: member.visit_followup || '',
  }));
  const [saving, setSaving] = useState(false);
  const toggleTopic = (k) =>
    setForm((f) => ({ ...f, topics: f.topics.includes(k) ? f.topics.filter((x) => x !== k) : [...f.topics, k] }));

  async function save(e) {
    e?.preventDefault();
    setSaving(true);
    try {
      const r = await api.put(`/sessions/${session.id}/visit/${member.id}`, form);
      onSaved(r);
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(displayError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('visit.familyOf', { name: memberName(member) })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium" id="visit-met-label">
            {t('visit.metLabel')}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="visit-met-label">
            {VISIT_MET.map((k) => (
              <ChoiceChip
                key={k}
                on={form.met === k}
                onClick={() => setForm((f) => ({ ...f, met: f.met === k ? '' : k }))}
              >
                {t(`visit.met.${k}`)}
              </ChoiceChip>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium" id="visit-topics-label">
            {t('visit.topicsLabel')}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="visit-topics-label">
            {VISIT_TOPICS.map((k) => (
              <ChoiceChip key={k} on={form.topics.includes(k)} onClick={() => toggleTopic(k)}>
                {t(`visit.topic.${k}`)}
              </ChoiceChip>
            ))}
          </div>
        </div>
        <Field label={t('visit.note')}>
          {(p) => (
            <Textarea
              {...p}
              dir="auto"
              rows={4}
              maxLength={2000}
              value={form.note}
              placeholder={t('visit.notePlaceholder')}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          )}
        </Field>
        <Field label={t('visit.followup')} hint={t('visit.followupHint')}>
          {(p) => (
            <Textarea
              {...p}
              dir="auto"
              rows={2}
              maxLength={500}
              value={form.followup}
              onChange={(e) => setForm((f) => ({ ...f, followup: e.target.value }))}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Les familles visitées, chacune avec ce qui s'est passé chez elle. Remplace la liste de
 * présence sur une زيارة : il n'y a rien à pointer, il y a à raconter.
 */
export function VisitFamilies({ session, editable, writableBranchIds, onSaved }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(null);
  const visited = (session.roster || []).filter((m) => m.status === 'present');
  const canWrite = (m) => editable && writableBranchIds.includes(m.branch_id);
  const done = visited.filter(hasVisitDetails).length;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>
          {t('session.visitedMembers')}
          <span className="ms-2 font-normal tabular-nums text-muted-foreground">{visited.length}</span>
        </CardTitle>
        {visited.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('visit.detailsProgress', { done, total: visited.length })}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0 pb-2 sm:p-0 sm:pb-2">
        {visited.length === 0 ? (
          <p className="px-4 pb-2 text-sm text-muted-foreground sm:px-5">{t('session.emptyRoster')}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {visited.map((m) => {
              const filled = hasVisitDetails(m);
              return (
                <li key={m.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <Avatar photo={m.photo} name={avatarName(m)} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        to={`/members/${m.id}`}
                        className="focus-ring min-w-0 flex-1 rounded font-medium hover:text-primary hover:underline"
                      >
                        {memberName(m)}
                      </Link>
                      {canWrite(m) && (
                        <Button
                          variant={filled ? 'ghost' : 'outline'}
                          size="sm"
                          onClick={() => setOpen(m)}
                          aria-label={`${t(filled ? 'common.edit' : 'visit.addDetails')} — ${memberName(m)}`}
                        >
                          {filled ? <IconPencil /> : <IconPlus />}
                          {t(filled ? 'common.edit' : 'visit.addDetails')}
                        </Button>
                      )}
                    </div>
                    {filled ? (
                      <VisitDetails v={m} />
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <IconHome className="h-3.5 w-3.5" />
                        {t('visit.noDetails')}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {open && (
        <VisitNoteDialog
          session={session}
          member={open}
          onClose={() => setOpen(null)}
          onSaved={(r) => {
            onSaved(r);
            setOpen(null);
          }}
        />
      )}
    </Card>
  );
}
