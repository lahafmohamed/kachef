import { displayError } from '../lib/errors';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useBack, useFetch } from '../hooks';
import ExportPdfButton from '../components/ExportPdfButton';
import { branchName, fmtDate, fmtTime, todayISO } from '../utils';
import PrepCardForm from '../components/PrepCardForm';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  EmptyState,
  ErrorState,
  SkeletonPage,
  useConfirm,
  useToast,
  IconBack,
  IconCalendar,
  IconClipboard,
  IconClock,
  IconPencil,
  IconPin,
  IconShield,
  IconTrash,
} from '../components/ui';
import { MatalibNamed } from '../components/MatalibCatalog';

// created_at / updated_at are UTC "YYYY-MM-DD HH:MM:SS" — show the local date
const stampDate = (v) => (v ? fmtDate(v.slice(0, 10)) : '');

// «Label : value» — French puts a no-break space before the colon, Arabic none
const colon = (lng) => (lng === 'fr' ? '\u00a0: ' : ': ');

// «Dupliquer» — two stacked sheets, drawn as the shared icons are (24 grid, 2px stroke)
const IconCopy = ({ className }) => (
  <svg
    className={cn('h-4 w-4 shrink-0', className)}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="8" y="8" width="14" height="14" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

// On a phone, an invisible margin makes a text-sized link a 44px target; pointer
// screens keep the text's own box
const TAP = 'relative max-sm:after:absolute max-sm:after:-inset-x-1 max-sm:after:-inset-y-3';

/**
 * بطاقة تحضير واحدة كما كتبها القائد: الترويسة (العنوان، الزمان، المكان، الفرقة،
 * المُعدّ، المطالب) ثم الأقسام النصية — قسمٌ فارغ لا يُعرض. التعديل مفتوح في أي
 * وقت لمن يملك صلاحية إنشاء الأنشطة، و الحذف للأدمن وحده.
 */
export default function PrepCardDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const navigate = useNavigate();
  const back = useBack('/prep-cards');
  const toast = useToast();
  const confirm = useConfirm();
  const { has } = usePerms();
  const editable = has('prep.manage');
  const canDelete = has('prep.delete');

  const { data: card, setData: setCard, loading, error, errorStatus, reload } = useFetch(`/prep-cards/${id}`);
  const [editing, setEditing] = useState(false);
  const branches = useFetch('/branches', { skip: !editable });
  const leaders = useFetch('/leaders', { skip: !editable });

  async function remove() {
    if (!(await confirm({ confirmLabel: t('prep.delete'), title: t('prep.delete'), message: t('prep.deleteConfirm') }))) return;
    try {
      await api.del(`/prep-cards/${id}`);
      toast.success(t('prep.deleted'));
      navigate('/prep-cards', { replace: true });
    } catch (err) {
      toast.error(displayError(err));
    }
  }

  const backButton = (
    <Button variant="ghost" size="sm" onClick={back} className="-ms-2 me-auto">
      <IconBack className="rtl:rotate-180" />
      {t('common.back')}
    </Button>
  );

  if (loading) return <SkeletonPage rows={4} />;
  // The way back stays above the error: an installed app has no browser «back». A card
  // that is gone says so — «check your connection» and a retry would lead nowhere
  if (error)
    return (
      <div className="space-y-4">
        <div className="flex">{backButton}</div>
        {/* A card deleted since the link was shared, or outside this account's قسم (the
            server's 404 / 403): no retry brings it back */}
        {errorStatus === 404 || errorStatus === 403 ? (
          <Card>
            <EmptyState icon={<IconClipboard className="h-6 w-6" />} title={t('error.notFoundTitle')}>
              {t('error.notFoundBody')}
            </EmptyState>
          </Card>
        ) : (
          <ErrorState message={t('error.loadFailed')} onRetry={reload} retryLabel={t('error.retry')} />
        )}
      </div>
    );

  const sections = [
    ['goals', 'prep.goals'],
    ['segments', 'prep.segments'],
    ['tools', 'prep.tools'],
    ['notes', 'prep.notes'],
  ].filter(([key]) => card[key]);

  // سطر الأرشيف: من أنشأها و متى، و آخر تعديل إن اختلف
  const stamp = [
    card.created_by && t('prep.createdBy', { name: card.created_by, date: stampDate(card.created_at) }),
    card.updated_at !== card.created_at && t('prep.updatedAt', { date: stampDate(card.updated_at) }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-4">
      {/* Phones: back and the icon-only actions share one line, and «create the
          activity» — the card's next step — gets a full-width line of its own under
          them instead of wrapping the header into three ragged rows */}
      <div className="flex flex-wrap items-center gap-2">
        {backButton}
        {/* البطاقة كُتبت قبل النشاط: من هنا يُنشأ النشاط مملوءًا منها و مربوطًا بها */}
        {editable && !card.session_id && (
          <Button
            variant="brand"
            size="sm"
            onClick={() => navigate('/sessions', { state: { prepCard: card } })}
            className="order-last w-full sm:order-none sm:w-auto"
          >
            <IconCalendar />
            {t('prep.createSession')}
          </Button>
        )}
        <ExportPdfButton kind="prep" id={card.id} compact />
        {/* A card that worked, written again for another day: same content, dated today,
            by the account's own قائد and tied to no نشاط yet */}
        {editable && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const { id: _id, session_id: _s, leader_id: _l, ...rest } = card;
              navigate('/prep-cards', { state: { prepDefaults: { ...rest, date: todayISO() } } });
            }}
            aria-label={t('prep.duplicate')}
            className="w-11 px-0 sm:w-auto sm:px-3"
          >
            <IconCopy />
            <span className="sr-only sm:not-sr-only">{t('prep.duplicate')}</span>
          </Button>
        )}
        {editable && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={t('common.edit')}
            className="w-11 px-0 sm:w-auto sm:px-3"
          >
            <IconPencil />
            <span className="sr-only sm:not-sr-only">{t('common.edit')}</span>
          </Button>
        )}
        {canDelete && (
          <Button
            variant="destructive-ghost"
            size="sm"
            onClick={remove}
            aria-label={t('common.delete')}
            className="w-11 px-0 sm:w-auto sm:px-3"
          >
            <IconTrash />
            <span className="sr-only sm:not-sr-only">{t('common.delete')}</span>
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="bg-primary h-1.5" />
        <CardContent className="p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('prep.cardLabel')}
          </p>
          {/* <bdi>: an Arabic title keeps its letter order on the French screen (a Latin one
              on the Arabic screen) and stays aligned with the page */}
          <h1 className="mt-1 text-xl font-bold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">
            <bdi>{card.title}</bdi>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5 tabular-nums">
              <IconCalendar className="h-4 w-4 text-muted-foreground" />
              {fmtDate(card.date)}
            </span>
            {card.start_time && (
              <span className="flex items-center gap-1.5 tabular-nums">
                <IconClock className="h-4 w-4 text-muted-foreground" />
                {fmtTime(card.start_time)}
              </span>
            )}
            {card.place && (
              <span className="flex items-center gap-1.5">
                <IconPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                <bdi>{card.place}</bdi>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <IconShield className="h-4 w-4 text-muted-foreground" />
              <Badge>{branchName(card, lng)}</Badge>
            </span>
          </div>
          {card.leader && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('prep.author')}
              {colon(lng)}
              {card.leader_id ? (
                <Link
                  to={`/leaders/${card.leader_id}`}
                  className={cn('focus-ring rounded font-medium text-foreground hover:text-primary hover:underline', TAP)}
                >
                  <bdi>{card.leader}</bdi>
                </Link>
              ) : (
                <bdi className="font-medium text-foreground">{card.leader}</bdi>
              )}
            </p>
          )}
          {card.matalib.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-muted-foreground">
                {t('prep.matalib')}
                {colon(lng)}
              </span>
              {card.matalib.map((n) => (
                <Badge key={n} variant="warning" className="tabular-nums">
                  {n}
                </Badge>
              ))}
            </div>
          )}
          {card.matalib.length > 0 && card.branch_id && (
            <div className="mt-2">
              <MatalibNamed branchId={card.branch_id} numbers={card.matalib} />
            </div>
          )}
          {/* النشاط الذي حُضِّرت له — the same chip the نشاط shows for its card, so the link
              reads alike both ways, and a 44px target on a phone */}
          {card.session_id && (
            <Link
              to={`/sessions/${card.session_id}`}
              className="focus-ring mt-4 flex min-h-11 w-fit max-w-full items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft px-3.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 sm:min-h-10"
            >
              <IconCalendar className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {t('prep.session')}
                {colon(lng)}
                <bdi>{card.session_title}</bdi>
              </span>
            </Link>
          )}
        </CardContent>
      </Card>

      {sections.length > 0 ? (
        sections.map(([key, labelKey]) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle>{t(labelKey)}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* auto: Arabic text keeps its own direction on the French screen, and vice
                  versa; anywhere: one pasted link must not push the page past a phone's edge */}
              <p dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
                {card[key]}
              </p>
            </CardContent>
          </Card>
        ))
      ) : (
        // Every section is optional: a card saved with its heading alone says what comes here
        <Card>
          <EmptyState icon={<IconClipboard className="h-6 w-6" />} title={t('prep.emptyCard')}>
            {t('prep.emptyCardHint')}
          </EmptyState>
        </Card>
      )}

      {stamp && <p className="text-xs text-muted-foreground">{stamp}</p>}

      <Dialog open={editing} onClose={() => setEditing(false)} title={t('prep.editCard')}>
        {branches.error || leaders.error ? (
          <ErrorState
            message={t('error.loadFailed')}
            onRetry={() => {
              if (branches.error) branches.reload();
              if (leaders.error) leaders.reload();
            }}
            retryLabel={t('error.retry')}
          />
        ) : (
          <PrepCardForm
            initial={card}
            branches={branches.data || []}
            leaders={leaders.data || []}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => {
              setEditing(false);
              setCard(updated);
              toast.success(t('prep.updated'));
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
