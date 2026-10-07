import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { saveFile } from '../lib/download';
import { fmtDate } from '../utils';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Spinner,
  useConfirm,
  useToast,
  IconCamera,
  IconDownload,
  IconFileSheet,
  IconFileText,
  IconPlus,
  IconTrash,
} from './ui';

// Twin of FILE_MAX in server/index.js (kept under nginx's 12 Mo body cap)
const FILE_MAX = 11 * 1024 * 1024;
const DOC_ACCEPT = '.pdf,.xlsx,.xlsm,.xls,application/pdf';

/** Draws an image file onto a canvas no larger than `max` px, as a JPEG blob. */
async function shrinkImage(file, max, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  // White under a transparent PNG: JPEG has no alpha and would turn it black
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality)
  );
}

/**
 * A phone photo is 4–8 Mo: it travels as a 2048 px JPEG, which is plenty to look at
 * and print, plus a small thumbnail for the grid — both cut here, the server has no
 * image library. A GIF goes as is (redrawing it would freeze it).
 */
async function prepareImage(file) {
  const thumb = await shrinkImage(file, 480, 0.75);
  const main = file.type === 'image/gif' ? file : await shrinkImage(file, 2048, 0.85);
  const name = file.type === 'image/gif' ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { main: main.size < file.size ? main : file, thumb, name };
}

async function uploadOne(base, file) {
  const isImage = file.type.startsWith('image/');
  let body = file;
  let name = file.name;
  let thumbLen = 0;
  if (isImage) {
    const p = await prepareImage(file);
    body = new Blob([p.thumb, p.main]);
    thumbLen = p.thumb.size;
    name = p.name;
  }
  if (body.size - thumbLen > FILE_MAX) {
    const err = new Error('file_too_large');
    err.status = 413;
    throw err;
  }
  return api.upload(`${base}/files`, body, {
    'X-File-Name': encodeURIComponent(name),
    'X-Thumb-Length': String(thumbLen),
  });
}

const fmtSize = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

/** Object URL of a file served behind the token; revoked when the caller unmounts. */
function useBlobUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    let made = null;
    setUrl(null);
    api
      .download(path)
      .then(({ blob }) => {
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => alive && setUrl(''));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return url;
}

function Thumb({ base, file, onOpen, label }) {
  const url = useBlobUrl(`${base}/files/${file.id}${file.has_thumb ? '?thumb=1' : ''}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="group relative aspect-square overflow-hidden rounded-xl bg-muted outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 transition-transform duration-200 group-hover:scale-[1.03] dark:outline-white/10"
        />
      ) : (
        url === null && (
          <span className="absolute inset-0 grid place-items-center">
            <Spinner />
          </span>
        )
      )}
    </button>
  );
}

function PhotoViewer({ base, photos, index, onIndex, onClose, editable, onDelete }) {
  const { t } = useTranslation();
  const toast = useToast();
  const file = index === null ? null : photos[index];
  const url = useBlobUrl(file ? `${base}/files/${file.id}` : null);
  const go = (d) => onIndex((index + d + photos.length) % photos.length);

  useEffect(() => {
    if (!file || photos.length < 2) return undefined;
    const onKey = (e) => {
      // In RTL the "next" photo sits to the left
      const rtl = document.documentElement.dir === 'rtl';
      if (e.key === 'ArrowRight') go(rtl ? -1 : 1);
      if (e.key === 'ArrowLeft') go(rtl ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function download() {
    try {
      const { blob } = await api.download(`${base}/files/${file.id}?download=1`);
      await saveFile(blob, file.original_name);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Dialog
      open={!!file}
      onClose={onClose}
      size="lg"
      title={file ? `${t('files.photo')} ${index + 1} / ${photos.length}` : ''}
      description={file ? `${file.created_by || ''} · ${fmtDate(file.created_at.slice(0, 10))}` : ''}
      footer={
        file && (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {photos.length > 1 && (
                <>
                  <Button variant="outline" onClick={() => go(-1)}>
                    {t('files.previousPhoto')}
                  </Button>
                  <Button variant="outline" onClick={() => go(1)}>
                    {t('files.nextPhoto')}
                  </Button>
                </>
              )}
            </div>
            <div className="flex gap-2">
              {editable && (
                <Button variant="destructive-ghost" size="icon" onClick={() => onDelete(file)} aria-label={t('common.delete')}>
                  <IconTrash />
                </Button>
              )}
              <Button variant="outline" onClick={download}>
                <IconDownload />
                {t('files.downloadFile')}
              </Button>
            </div>
          </div>
        )
      }
    >
      <div className="grid min-h-60 place-items-center">
        {url ? (
          <img src={url} alt="" className="max-h-[65dvh] w-auto max-w-full rounded-lg object-contain" />
        ) : (
          <Spinner />
        )}
      </div>
    </Dialog>
  );
}

/**
 * Photos et documents (PDF, Excel) d'une séance ou d'un camp / d'une formation, sous
 * `base` (« /sessions/12 », « /events/3 »). Tout lecteur de la page les voit ; qui peut
 * faire l'appel peut en ajouter et en retirer.
 */
export default function AttachedFiles({ base, files = [], editable, onChange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const photoInput = useRef(null);
  const docInput = useRef(null);
  const [progress, setProgress] = useState(null); // { done, total }
  const [viewing, setViewing] = useState(null);
  const photos = files.filter((f) => f.kind === 'image');
  const docs = files.filter((f) => f.kind !== 'image');

  const errorText = (err) =>
    err.status === 413
      ? t('files.fileTooLarge')
      : err.status === 415
        ? t('files.fileUnsupported')
        : err.status === 409
          ? t('files.tooManyFiles')
          : err.message;

  async function add(list) {
    const picked = [...list];
    if (!picked.length) return;
    setProgress({ done: 0, total: picked.length });
    let failed = 0;
    for (const [i, file] of picked.entries()) {
      try {
        const r = await uploadOne(base, file);
        onChange(r.files);
      } catch (err) {
        failed += 1;
        toast.error(`${file.name} — ${errorText(err)}`);
      }
      setProgress({ done: i + 1, total: picked.length });
    }
    setProgress(null);
    if (picked.length - failed > 0) toast.success(t('files.filesAdded', { count: picked.length - failed }));
  }

  async function remove(file) {
    if (!(await confirm(t('files.confirmRemoveFile', { name: file.original_name })))) return;
    try {
      const r = await api.del(`${base}/files/${file.id}`);
      onChange(r.files);
      if (file.kind === 'image') {
        const left = r.files.filter((f) => f.kind === 'image').length;
        setViewing((v) => (v === null || left === 0 ? null : Math.min(v, left - 1)));
      }
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function openDoc(file) {
    // PDF: shown in a new tab. The tab opens on the click itself (a popup opened
    // after an await is blocked), then receives the file once it has arrived.
    const tab = file.kind === 'pdf' && !window.matchMedia?.('(pointer: coarse)').matches ? window.open('', '_blank') : null;
    try {
      const { blob } = await api.download(`${base}/files/${file.id}${tab ? '' : '?download=1'}`);
      if (tab) {
        tab.location.href = URL.createObjectURL(blob);
      } else {
        await saveFile(blob, file.original_name);
      }
    } catch (err) {
      tab?.close();
      toast.error(err.message);
    }
  }

  const busy = progress !== null;

  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {t('files.photos')}
              <span className="ms-2 font-normal tabular-nums text-muted-foreground">{photos.length}</span>
            </CardTitle>
            {editable && (
              <Button variant="outline" size="sm" onClick={() => photoInput.current?.click()} disabled={busy}>
                <IconCamera />
                {t('files.addPhotos')}
              </Button>
            )}
          </div>
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner />
              {t('files.uploading', { done: progress.done, total: progress.total })}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              add(e.target.files);
              e.target.value = '';
            }}
          />
          {photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('files.noPhotos')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {photos.map((f, i) => (
                <Thumb
                  key={f.id}
                  base={base}
                  file={f}
                  onOpen={() => setViewing(i)}
                  label={`${t('files.photo')} ${i + 1}`}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {t('files.documents')}
              <span className="ms-2 font-normal tabular-nums text-muted-foreground">{docs.length}</span>
            </CardTitle>
            {editable && (
              <Button variant="outline" size="sm" onClick={() => docInput.current?.click()} disabled={busy}>
                <IconPlus />
                {t('files.addDocuments')}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{t('files.documentsHint')}</p>
        </CardHeader>
        <CardContent>
          <input
            ref={docInput}
            type="file"
            accept={DOC_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              add(e.target.files);
              e.target.value = '';
            }}
          />
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('files.noDocuments')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {docs.map((f) => {
                const Icon = f.kind === 'excel' ? IconFileSheet : IconFileText;
                return (
                  <li key={f.id} className="flex min-h-14 items-center gap-1 pe-1.5">
                    <button
                      type="button"
                      onClick={() => openDoc(f)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-start hover:bg-accent"
                    >
                      <span
                        className={
                          f.kind === 'excel'
                            ? 'grid size-9 shrink-0 place-items-center rounded-lg bg-success/15 text-success'
                            : 'grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive'
                        }
                      >
                        <Icon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium" dir="auto">
                          {f.original_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {f.kind === 'excel' ? 'Excel' : 'PDF'} · <span dir="ltr">{fmtSize(f.size)}</span> ·{' '}
                          {f.created_by} · <span dir="ltr">{fmtDate(f.created_at.slice(0, 10))}</span>
                        </span>
                      </span>
                    </button>
                    {editable && (
                      <Button
                        variant="destructive-ghost"
                        size="icon"
                        onClick={() => remove(f)}
                        aria-label={`${t('common.delete')} — ${f.original_name}`}
                      >
                        <IconTrash />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <PhotoViewer
        base={base}
        photos={photos}
        index={viewing !== null && viewing < photos.length ? viewing : null}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
        editable={editable}
        onDelete={remove}
      />
    </>
  );
}
