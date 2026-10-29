import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { fileToDataUrl } from '../utils';
import { Button, IconCamera, IconImage } from './ui';

/* Profile photo: shoot it with the camera or pick an existing picture
   (gallery, files). `capture` forces the camera on phones, so the import
   input goes without it. On pointer devices both open the same file dialog,
   so the camera button only shows on touch screens. */
export default function PhotoPicker({ value, onChange, label }) {
  const { t } = useTranslation();
  const cameraRef = useRef(null);
  const fileRef = useRef(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    // Cleared so picking the same file again still fires onChange
    e.target.value = '';
    if (!file) return;
    onChange(await fileToDataUrl(file));
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        aria-label={t(value ? 'member.changePhoto' : 'member.addPhoto')}
        className="focus-ring flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-input bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {value ? (
          <img src={value} alt="" className="img-outline h-full w-full object-cover" />
        ) : (
          <IconCamera className="h-6 w-6" />
        )}
      </button>
      <div className="min-w-0 space-y-1.5 text-sm">
        <p className="font-medium">{label}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="pointer-fine:hidden" onClick={() => cameraRef.current?.click()}>
            <IconCamera />
            {t('member.takePhoto')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <IconImage />
            {t('member.uploadPhoto')}
          </Button>
          {value && (
            <Button variant="destructive-ghost" size="sm" onClick={() => onChange(null)}>
              {t('member.removePhoto')}
            </Button>
          )}
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={pick} className="sr-only" />
        <input ref={fileRef} type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={pick} className="sr-only" />
      </div>
    </div>
  );
}
