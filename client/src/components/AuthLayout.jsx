import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn, useTheme } from './ui';

/*
 * The emblem redrawn as a scene, proportions traced from logo.png (arch
 * radius 300, centre 400,640): the onion arch, the sun inside it, the plum
 * peaks and the teal lake, all held inside the arch as in the logo. Each use
 * frames it with its own viewBox — the desktop panel lets the arch rise from
 * the bottom edge, the phone band cuts it through the peaks like a horizon.
 * Anchored to the bottom; overflow stays visible so a wider box adds sky.
 */
const ARCH =
  'M400 940A300 300 0 0 0 595 412L592 400A72 70.5 0 0 0 520 329.5L511.6 325' +
  'C499 292 442 244 400 222.4C358 244 301 292 288.4 325L280 329.5' +
  'A72 70.5 0 0 0 208 400L205 412A300 300 0 0 0 400 940Z';
const LAKE =
  'M513 482C548 516 660 618 780 752V960H80Q230 945 326 852' +
  'C304 796 301 703 370 632C415 586 499 499 513 482Z';

function Scene({ viewBox, className }) {
  // Two scenes can be mounted at once (band + panel): each needs its own clip id
  const clip = `arch${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMax meet"
      className={cn('overflow-visible', className)}
      aria-hidden="true"
      focusable="false"
    >
      <clipPath id={clip}>
        <path d={ARCH} />
      </clipPath>
      <path d={ARCH} fill="var(--scene-field)" />
      <g clipPath={`url(#${clip})`}>
        <circle cx="400" cy="636" r="221" fill="var(--scene-sun)" className="animate-sun-rise" />
        <path d="M286 569 551 960H20Z" fill="var(--scene-peak)" />
        <path d="M287 724 475 960H99Z" fill="var(--scene-shadow)" />
        <path d={LAKE} fill="var(--scene-lake)" />
        {/* The logo's keyline: a wide stroke whose outer half is clipped away
            and whose middle the orange covers, leaving a 3-unit inner line */}
        <path d={ARCH} fill="none" stroke="var(--scene-keyline)" strokeWidth="13" strokeLinejoin="round" />
      </g>
      <path d={ARCH} fill="none" stroke="var(--scene-line)" strokeWidth="7" strokeLinejoin="round" />
    </svg>
  );
}

/** The group's name as the logo sets it: Arabic over Latin capitals, in both UI languages. */
function Lockup({ className }) {
  return (
    <div className={cn('px-8 text-center text-scene-ink', className)}>
      <p lang="ar" dir="rtl" className="text-[1.75rem] font-bold leading-snug">
        كشافة الغدير – أبيدجان
      </p>
      {/* Inline tracking: the Arabic-page rule that zeroes tracking-* classes
          is right for joined script, wrong for these Latin capitals */}
      <p lang="fr" dir="ltr" className="mt-1.5 text-xs font-semibold uppercase" style={{ letterSpacing: '0.2em' }}>
        Scout Alghadir – Abidjan
      </p>
    </div>
  );
}

const LANGS = [
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
];

/** Both languages in view, the current one marked — readable whichever one the page is in. */
function LanguageSwitch({ className }) {
  const { t, i18n } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('settings.language')}
      className={cn('flex rounded-full border border-border bg-card p-1 shadow-xs', className)}
    >
      {LANGS.map(({ code, label }) => {
        const active = i18n.language === code;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={active}
            onClick={() => i18n.changeLanguage(code)}
            className={cn(
              'focus-ring min-h-9 cursor-pointer rounded-full px-3.5 text-xs font-medium transition-colors sm:min-h-8',
              active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Title block shared by the sign-in and first-password screens. */
export function AuthHeader({ title, children }) {
  const { t } = useTranslation();
  return (
    <header className="space-y-2">
      {/* Phones: app name + language on one row, clear of the scene. Desktop
          drops the row — the lockup names the app, the switch sits up top. */}
      <div className="flex flex-wrap items-center justify-between gap-3 lg:hidden">
        <p className="text-sm font-semibold text-primary">{t('app.name')}</p>
        <LanguageSwitch />
      </div>
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight lg:text-[2rem]">{title}</h1>
      {children && <p className="text-[0.9375rem] text-muted-foreground">{children}</p>}
    </header>
  );
}

/**
 * Sign-in frame: the scene as a band above a sheet on phones, the start half
 * of the screen on desktop. Children are the form column.
 */
export default function AuthLayout({ children }) {
  // The phone's status bar continues the scene's sky while this screen is up
  const { setChromeTint } = useTheme();
  useEffect(() => {
    setChromeTint('--scene-sky');
    return () => setChromeTint(null);
  }, [setChromeTint]);

  return (
    <main className="relative flex min-h-dvh flex-col bg-background lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Phones: pb-6 is plain sky for the sheet to overlap, so the scene's own
          bottom edge — just above the dark peak — is the cut on every screen */}
      <div className="relative overflow-hidden bg-scene-sky pb-6 pt-[env(safe-area-inset-top)] lg:m-3 lg:rounded-[1.75rem] lg:p-0">
        <Scene viewBox="-120 135 1040 585" className="block aspect-video max-h-[min(20rem,30dvh)] w-full lg:hidden" />
        <Scene viewBox="40 44 720 821" className="absolute inset-0 hidden size-full lg:block" />
        <Lockup className="absolute inset-x-0 top-[clamp(2rem,7vh,4.5rem)] hidden lg:block" />
      </div>

      {/* Phones keep the form high, under the scene, where the keyboard leaves
          it visible; from tablets up it centres in the space that is left */}
      <div className="relative z-10 -mt-6 flex-1 rounded-t-[1.75rem] bg-background px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-7 md:flex md:flex-col md:justify-center md:pb-16 lg:mt-0 lg:rounded-none lg:px-12 lg:py-20">
        <LanguageSwitch className="absolute end-6 top-6 hidden lg:flex" />
        <div className="animate-fade-up mx-auto w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}
