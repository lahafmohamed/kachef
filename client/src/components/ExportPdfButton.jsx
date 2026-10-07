import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth, usePerms } from '../auth';
import { saveFile } from '../lib/download';
import { useSection } from '../section';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { Button, cn, useToast, IconChevronDown, IconDownload, IconFileSheet, IconFileText } from './ui';

// The kinds whose sheet has an Excel twin (lib/excelReports.js). The builders and the
// spreadsheet writer load the first time someone asks for a workbook.
const EXCEL_KINDS = new Set([
  'sessions',
  'members',
  'leaders',
  'branches',
  'promotions',
  'members-list',
  'leaders-list',
  'sessions-list',
  'prep-list',
  'plan',
  'prep',
  'treasury',
  'branch-money',
  'meeting',
  'meetings-list',
  'meeting-decisions',
]);

// Up/Down step through the choices the way a menu does; Tab keeps working too
function menuArrowKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  const next = e.key === 'ArrowDown' ? i + 1 : (i === -1 ? items.length : i) - 1;
  items[(next + items.length) % items.length]?.focus();
}

function Choice({ icon, title, hint, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="focus-ring flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <span aria-hidden="true" className="flex shrink-0 text-muted-foreground [&>svg]:h-5 [&>svg]:w-5">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

/**
 * Downloads one نشاط / عنصر / قائد / فرقة / list — as a PDF or as an Excel workbook.
 * The PDF: the server renders the app's own /print/<kind>/<id> sheet with Chromium and
 * sends the file back; nothing to print, nothing to configure on the phone. Should the
 * server have no Chromium, the sheet page opens instead, where the browser's own «Save
 * as PDF» still works. The workbook is written right here, from the API calls the sheet
 * makes, so it holds what the PDF holds — as cells to sort and filter.
 */
export default function ExportPdfButton({
  kind,
  id,
  query = '',
  className,
  size = 'sm',
  variant = 'outline',
  // Icon only on phones, where a header already holds the page's primary action
  compact = false,
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { can } = usePerms();
  const { section } = useSection();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // A list sheet carries the page's filters: ?a=1&b=2 (no leading "?")
  const qs = String(query || '').replace(/^\?/, '');
  const excel = EXCEL_KINDS.has(kind);

  async function pdf() {
    setBusy(true);
    try {
      const { blob, filename } = await api.download(
        `/export/${kind}/${id}.pdf?lang=${encodeURIComponent(i18n.language)}${qs ? `&${qs}` : ''}`
      );
      await saveFile(blob, filename || `${t('print.exportPdf')}.pdf`);
    } catch (err) {
      if (err.status === 501) {
        toast.error(t('print.unavailable'));
        if (!location.pathname.startsWith('/print/')) navigate(`/print/${kind}/${id}${qs ? `?${qs}` : ''}`);
      } else {
        toast.error(t('print.failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function workbook() {
    setBusy(true);
    try {
      const { excelFile } = await import('../lib/excelReports');
      const { blob, filename } = await excelFile(kind, id, qs, { t, lng: i18n.language, can, user, section });
      await saveFile(blob, filename);
    } catch {
      toast.error(t('excel.failed'));
    } finally {
      setBusy(false);
    }
  }

  const label = excel ? t('excel.download') : t('print.exportPdf');
  const buttonProps = {
    variant,
    size,
    loading: busy,
    className: cn('group', compact && 'w-11 px-0 sm:w-auto sm:px-3', className),
  };
  const face = (
    <>
      {!busy && <IconDownload />}
      {compact ? <span className="sr-only sm:not-sr-only">{label}</span> : label}
    </>
  );

  if (!excel)
    return (
      <Button {...buttonProps} onClick={pdf}>
        {face}
      </Button>
    );

  const pick = (run) => () => {
    setOpen(false);
    run();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button {...buttonProps}>
          {face}
          {/* A choice behind it, not a download yet; points up once the choices show */}
          <IconChevronDown
            className={cn(
              'opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180',
              compact && 'hidden sm:block'
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={label} onKeyDown={menuArrowKeys} className="w-64 p-1.5">
        <div className="flex flex-col">
          <Choice icon={<IconFileText />} title={t('excel.pdf')} hint={t('excel.pdfHint')} onSelect={pick(pdf)} />
          <Choice
            icon={<IconFileSheet />}
            title={t('excel.xlsx')}
            hint={t('excel.xlsxHint')}
            onSelect={pick(workbook)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
