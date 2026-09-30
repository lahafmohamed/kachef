import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { saveFile } from '../lib/download';
import { Button, cn, useToast, IconDownload } from './ui';

/**
 * Downloads the PDF of one نشاط / عنصر / قائد / فرقة. The server renders the
 * app's own /print/<kind>/<id> sheet with Chromium and sends the file back;
 * nothing to print, nothing to configure on the phone.
 * Should the server have no Chromium, the sheet page opens instead, where the
 * browser's own «Save as PDF» still works.
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
  const [busy, setBusy] = useState(false);
  // A list sheet carries the page's filters: ?a=1&b=2 (no leading "?")
  const qs = String(query || '').replace(/^\?/, '');

  async function run() {
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

  return (
    <Button
      variant={variant}
      size={size}
      className={cn(compact && 'w-11 px-0 sm:w-auto sm:px-3', className)}
      loading={busy}
      onClick={run}
    >
      {!busy && <IconDownload />}
      {compact ? <span className="sr-only sm:not-sr-only">{t('print.exportPdf')}</span> : t('print.exportPdf')}
    </Button>
  );
}
