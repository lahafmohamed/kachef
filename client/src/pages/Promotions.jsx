import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { usePerms } from '../auth';
import { useFetch } from '../hooks';
import { avatarName, branchName, fmtDate, memberName } from '../utils';
import ExportPdfButton from '../components/ExportPdfButton';
import FilterSelect from '../components/FilterSelect';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  useConfirm,
  useToast,
  IconArrow,
  IconAward,
  IconShield,
  IconSparkles,
  IconTrendingUp,
} from '../components/ui';

export default function Promotions() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  // View-only accounts see who is due for promotion but cannot apply it
  const { has } = usePerms();
  const editable = has('promotions.apply');
  const pending = useFetch('/promotions/pending');
  const history = useFetch('/promotions/history');
  const branches = useFetch('/branches');
  const [busy, setBusy] = useState(null); // null | 'all' | 'picked' | member id
  // '' = كل الفرق. الفلترة على الفرقة التي يخرج منها العنصر، كما يفعل الخادم حين
  // يحصر قائدًا في فرقه: الترفيع يخصّ الفرقة التي يغادرها صاحبه.
  const [branch, setBranch] = useState('');
  // العناصر المؤشَّرون للترفيع دفعةً واحدة
  const [picked, setPicked] = useState(() => new Set());

  const sameBranch = (id) => !branch || String(id) === String(branch);
  const pendingList = (pending.data || []).filter((p) => sameBranch(p.current_branch.id));
  const historyList = (history.data || []).filter((h) => sameBranch(h.old_branch_id));
  const branchList = branches.data || [];
  const pickedIds = pendingList.filter((p) => picked.has(p.id)).map((p) => p.id);
  const allPicked = pendingList.length > 0 && pickedIds.length === pendingList.length;

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
    i18n.language
  );

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
      <PageHeader title={t('promotion.pending')} description={t('promotion.subtitle')}>
        {pendingList.length > 0 && (
          <>
            {/* الفرقة رقمًا في الرابط، و 0 تعني كل الفرق — الورقة تُبنى من نفس
                القائمة المعروضة هنا، بنفس الفلتر */}
            <ExportPdfButton kind="promotions" id={branch || 0} size="default" />
            {editable && (
              <Button
                variant="brand"
                loading={busy === 'all'}
                disabled={!!busy}
                onClick={() => promote(pendingList.map((p) => p.id), 'all')}
              >
                <IconTrendingUp />
                {t('promotion.promoteAll', { count: pendingList.length })}
              </Button>
            )}
          </>
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
          options={branchList.map((b) => ({ value: b.id, label: branchName(b, i18n.language) }))}
        />
        {branch && (
          <Button variant="ghost" size="sm" onClick={() => pickBranch('')}>
            {t('common.clearFilters')}
          </Button>
        )}
      </div>

      {pending.error ? (
        <ErrorState message={t('error.loadFailed')} onRetry={pending.reload} retryLabel={t('error.retry')} />
      ) : pending.loading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </Card>
      ) : (
        <Card>
          {pendingList.length === 0 ? (
            <EmptyState
              icon={<IconSparkles className="h-6 w-6 text-success" />}
              title={branch ? t('promotion.noPendingInBranch', { branch: branchLabel }) : t('promotion.noPending')}
            >
              {branch ? t('promotion.noPendingInBranchHint') : t('promotion.noPendingHint')}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {editable && pendingList.length > 1 && (
                <li className="px-4 py-2 sm:px-5">
                  <label className="flex min-h-9 w-fit cursor-pointer items-center gap-3 text-sm font-medium">
                    <input type="checkbox" checked={allPicked} onChange={toggleAll} />
                    {t('promotion.selectAll', { count: pendingList.length })}
                  </label>
                </li>
              )}
              {pendingList.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  {/* التأشير خارج الرابط: الضغط على الاسم يفتح بطاقة العنصر، لا يؤشِّره */}
                  {editable && (
                    <input
                      type="checkbox"
                      className="shrink-0"
                      checked={picked.has(p.id)}
                      onChange={() => togglePick(p.id)}
                      aria-label={t('promotion.selectOne', { name: memberName(p) })}
                    />
                  )}
                  <Avatar photo={p.photo} name={avatarName(p)} />
                  <div className="min-w-32 flex-1">
                    <Link
                      to={`/members/${p.id}`}
                      className="focus-ring rounded font-medium hover:text-primary hover:underline"
                    >
                      {memberName(p)}
                    </Link>
                    <div className="text-sm tabular-nums text-muted-foreground">
                      {p.age} {t('common.years')}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="secondary">{branchName(p.current_branch, i18n.language)}</Badge>
                    <IconArrow className="shrink-0 text-muted-foreground rtl:rotate-180" />
                    <Badge variant="solid">{branchName(p.target_branch, i18n.language)}</Badge>
                  </div>
                  {editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === p.id}
                      disabled={!!busy}
                      onClick={() => promote([p.id], p.id)}
                      className="w-full sm:w-auto"
                    >
                      {t('promotion.promote')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* شريط التأشير يلتصق بالأسفل، و فوق شريط التنقّل في الهاتف: لولا ذلك لاختفى
              الزرّ تحته، و التأشير بلا زرّ ترفيع لا معنى له */}
          {editable && pickedIds.length > 0 && (
            <div className="sticky bottom-[var(--bottomnav-h)] z-10 flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-border bg-card px-4 py-2.5 sm:px-5 lg:bottom-0">
              <span className="text-sm font-medium">
                {t('promotion.selected', { count: pickedIds.length })}
              </span>
              <span className="hidden grow sm:block" />
              <Button
                size="sm"
                variant="brand"
                loading={busy === 'picked'}
                disabled={!!busy}
                onClick={() => promote(pickedIds, 'picked')}
              >
                <IconTrendingUp />
                {t('promotion.promoteSelected', { count: pickedIds.length })}
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setPicked(new Set())}>
                {t('common.clearSelection')}
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('promotion.history')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {history.error ? (
            <div className="px-4 py-2">
              <ErrorState message={t('error.loadFailed')} onRetry={history.reload} retryLabel={t('error.retry')} />
            </div>
          ) : history.loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 p-4">
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : historyList.length === 0 ? (
            <EmptyState icon={<IconAward className="h-6 w-6" />} title={t('promotion.noHistory')} />
          ) : (
            <>
              {/* Mobile: one row per promotion, stacked */}
              <ul className="divide-y divide-border md:hidden">
                {historyList.map((h) => (
                  <li key={h.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link
                        to={`/members/${h.member_id}`}
                        className="focus-ring rounded font-medium hover:text-primary hover:underline"
                      >
                        {memberName(h)}
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmtDate(h.promoted_at)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">
                        {i18n.language === 'ar' ? h.old_name_ar : h.old_name_fr}
                      </Badge>
                      <IconArrow className="h-3.5 w-3.5 text-muted-foreground rtl:rotate-180" />
                      <Badge>{i18n.language === 'ar' ? h.new_name_ar : h.new_name_fr}</Badge>
                      <Badge variant="warning">
                        {h.matalib.length} {t('session.requirementsShort')}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>

              <Table className="hidden md:block">
                <thead className="border-b border-border">
                  <tr>
                    <Th>{t('common.date')}</Th>
                    <Th>{t('promotion.member')}</Th>
                    <Th>{t('promotion.oldBranch')}</Th>
                    <Th>{t('promotion.newBranch')}</Th>
                    <Th>{t('session.requirementsShort')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historyList.map((h) => (
                    <tr key={h.id} className="transition-colors hover:bg-accent/40">
                      <Td className="whitespace-nowrap tabular-nums">{fmtDate(h.promoted_at)}</Td>
                      <Td>
                        <Link
                          to={`/members/${h.member_id}`}
                          className="focus-ring rounded font-medium hover:text-primary hover:underline"
                        >
                          {memberName(h)}
                        </Link>
                      </Td>
                      <Td>
                        <Badge variant="secondary">
                          {i18n.language === 'ar' ? h.old_name_ar : h.old_name_fr}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge>{i18n.language === 'ar' ? h.new_name_ar : h.new_name_fr}</Badge>
                      </Td>
                      <Td>
                        <Badge variant="warning" title={h.matalib.join(', ')}>
                          {h.matalib.length}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
