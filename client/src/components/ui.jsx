import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './shadcn/select';

export { cn };

/* ============================================================
   Icons (lucide paths, inline SVG)
   ============================================================ */

function Icon({ children, className, strokeWidth = 2 }) {
  return (
    <svg
      className={cn('h-4 w-4 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconHome = (p) => (
  <Icon {...p}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </Icon>
);
export const IconUsers = (p) => (
  <Icon {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);
export const IconPin = (p) => (
  <Icon {...p}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </Icon>
);
export const IconSchool = (p) => (
  <Icon {...p}>
    <path d="M22 9 12 4 2 9l10 5 10-5z" />
    <path d="M6 11.5V17c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5v-5.5" />
  </Icon>
);
export const IconSort = (p) => (
  <Icon {...p}>
    <path d="M7 4v16" />
    <path d="m3 8 4-4 4 4" />
    <path d="M17 20V4" />
    <path d="m13 16 4 4 4-4" />
  </Icon>
);
export const IconCalendar = (p) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Icon>
);
export const IconTrendingUp = (p) => (
  <Icon {...p}>
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </Icon>
);
export const IconSettings = (p) => (
  <Icon {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const IconLanguages = (p) => (
  <Icon {...p}>
    <path d="m5 8 6 6" />
    <path d="m4 14 6-6 2-3" />
    <path d="M2 5h12" />
    <path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" />
    <path d="M14 18h6" />
  </Icon>
);
export const IconShield = (p) => (
  <Icon {...p}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  </Icon>
);
export const IconPlus = (p) => (
  <Icon {...p}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Icon>
);
export const IconSearch = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
);
export const IconPencil = (p) => (
  <Icon {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </Icon>
);
export const IconTrash = (p) => (
  <Icon {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </Icon>
);
export const IconAlert = (p) => (
  <Icon {...p}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);
export const IconArrow = (p) => (
  <Icon {...p}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);
export const IconBack = (p) => (
  <Icon {...p}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Icon>
);
export const IconX = (p) => (
  <Icon {...p}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);
export const IconCheck = (p) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
export const IconCheckAll = (p) => (
  <Icon {...p}>
    <path d="M18 6 7 17l-5-5" />
    <path d="m22 10-7.5 7.5L13 16" />
  </Icon>
);
export const IconSun = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Icon>
);
export const IconMoon = (p) => (
  <Icon {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Icon>
);
export const IconPhone = (p) => (
  <Icon {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
  </Icon>
);
export const IconChevronDown = (p) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const IconInbox = (p) => (
  <Icon {...p}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Icon>
);
export const IconSparkles = (p) => (
  <Icon {...p}>
    <path d="m12 3-1.9 5.8L4 10.5l6.1 1.7L12 18l1.9-5.8L20 10.5l-6.1-1.7z" />
    <path d="M19 17.5 19.6 19l1.4.5-1.4.5-.6 1.5-.6-1.5L17 19.5l1.4-.5z" />
  </Icon>
);
export const IconClock = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Icon>
);
export const IconFilter = (p) => (
  <Icon {...p}>
    <path d="M3 5h18M7 12h10M10 19h4" />
  </Icon>
);
export const IconCake = (p) => (
  <Icon {...p}>
    <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
    <path d="M2 21h20" />
    <path d="M7 8v2M12 8v2M17 8v2" />
    <path d="M7 4.5c0 .8-.6 1.5-1 1.5M12 4.5c0 .8-.6 1.5-1 1.5M17 4.5c0 .8-.6 1.5-1 1.5" />
  </Icon>
);
export const IconAward = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="6" />
    <path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5" />
  </Icon>
);
export const IconLock = (p) => (
  <Icon {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);
export const IconLogout = (p) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Icon>
);

/* ============================================================
   Theme
   ============================================================ */

const ThemeContext = createContext({ theme: 'light', setTheme: () => {}, toggle: () => {} });

function initialTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#120d17' : '#f8fbfc'
    );
    localStorage.setItem('theme', theme);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggle: () => setTheme((v) => (v === 'dark' ? 'light' : 'dark')) }),
    [theme]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/* ============================================================
   Primitives
   ============================================================ */

export function Spinner({ className }) {
  return (
    <svg
      className={cn('h-4 w-4 shrink-0 animate-spin-slow', className)}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" fill="none" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/* Solid variants carry a hairline top highlight so they read as lit surfaces
   rather than flat swatches, and a color-matched glow instead of grey shadow. */
const buttonVariants = {
  default:
    'ring-inset-light bg-primary text-primary-foreground shadow-brand hover:bg-primary-hover active:scale-[0.98]',
  brand:
    'ring-inset-light bg-primary text-primary-foreground shadow-brand hover:bg-primary-hover active:scale-[0.98]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70 active:scale-[0.98]',
  outline:
    'border border-border bg-card text-foreground shadow-xs hover:border-primary/35 hover:bg-accent hover:text-accent-foreground active:scale-[0.98]',
  ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground active:scale-[0.98]',
  destructive:
    'ring-inset-light bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:scale-[0.98]',
  'destructive-ghost': 'text-destructive hover:bg-destructive/10 active:scale-[0.98]',
};

/* Touch targets are ≥44px on phones and tighten up on pointer devices. */
const buttonSizes = {
  default: 'h-11 px-4 text-sm sm:h-10',
  sm: 'h-10 px-3 text-xs sm:h-8',
  lg: 'h-12 px-6 text-base sm:h-11',
  icon: 'h-10 w-10 sm:h-9 sm:w-9',
  'icon-sm': 'h-9 w-9 sm:h-8 sm:w-8',
};

export function Button({
  variant = 'default',
  size = 'default',
  className,
  loading = false,
  disabled,
  children,
  ...props
}) {
  return (
    <button
      type={props.type || 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'focus-ring inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg',
        'font-medium tracking-[-0.005em] transition-all duration-150 cursor-pointer',
        'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Card({ className, interactive = false, ...props }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card text-card-foreground shadow-sm',
        interactive &&
          'transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-3 sm:p-5 sm:pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return (
    <h2 className={cn('text-base font-semibold leading-tight tracking-tight', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-4 pt-0 sm:p-5 sm:pt-0', className)} {...props} />;
}

export const fieldBase =
  'flex h-11 w-full rounded-lg border border-input bg-card px-3.5 text-sm shadow-xs transition-colors sm:h-10 ' +
  'hover:border-input/70 focus-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(fieldBase, 'placeholder:text-muted-foreground', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(fieldBase, 'h-auto min-h-20 py-2 placeholder:text-muted-foreground', className)}
      {...props}
    />
  );
}

/* Radix forbids an item with an empty value, so '' rides through as a sentinel. */
const EMPTY_VALUE = '__empty__';

/** Flattens `<option>` / `<optgroup>` children (incl. fragments and arrays) into a list. */
function collectOptions(children, out = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      collectOptions(child.props.children, out);
    } else if (child.type === 'optgroup') {
      out.push({ group: child.props.label });
      collectOptions(child.props.children, out);
    } else if (child.type === 'option') {
      out.push({
        value: String(child.props.value ?? ''),
        label: child.props.children,
        disabled: !!child.props.disabled,
      });
    }
  });
  return out;
}

/**
 * shadcn Select behind the native `<select>` API: call sites keep writing
 * `<option>` children and an `onChange` that reads `e.target.value`, so the
 * whole app gets the same listbox without touching every form.
 * A disabled empty option is read as the placeholder, as it is in HTML.
 */
export function Select({ className, children, value, onChange, id, name, required, disabled, placeholder, ...props }) {
  const options = collectOptions(children);
  const isPlaceholderOption = (o) => o.value === '' && o.disabled;
  const hasEmptyItem = options.some((o) => o.value === '' && !o.disabled);
  const placeholderText = placeholder ?? options.find(isPlaceholderOption)?.label;
  const current = value == null ? '' : String(value);

  const root = (
    <SelectRoot
      value={current === '' && hasEmptyItem ? EMPTY_VALUE : current}
      onValueChange={(v) =>
        onChange?.({ target: { value: v === EMPTY_VALUE ? '' : v, name, id } })
      }
      name={name}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className={cn('rounded-lg px-3.5 hover:border-input/70 hover:bg-card', className)}
        {...props}
      >
        <SelectValue placeholder={placeholderText} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o, i) => {
          if (o.group) return <SelectLabel key={`group-${i}`}>{o.group}</SelectLabel>;
          if (isPlaceholderOption(o)) return null;
          return (
            <SelectItem key={o.value || EMPTY_VALUE} value={o.value === '' ? EMPTY_VALUE : o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </SelectRoot>
  );

  if (!required) return root;

  /* Required needs a real form control the browser can point its message at —
     Radix's own hidden select is unfocusable, so submit would fail silently. */
  return (
    <div className="relative w-full">
      {root}
      <input
        tabIndex={-1}
        required
        aria-hidden="true"
        value={current}
        onChange={() => {}}
        className="pointer-events-none absolute bottom-0 start-3 h-0 w-0 opacity-0"
      />
    </div>
  );
}

export function Label({ className, ...props }) {
  return (
    <label
      className={cn('text-sm font-medium leading-none text-foreground', className)}
      {...props}
    />
  );
}

/** Label + control + optional hint/error, wired up with the right aria attrs. */
export function Field({ label, hint, error, children, className }) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ');
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      {typeof children === 'function'
        ? children({ id, 'aria-describedby': describedBy || undefined, 'aria-invalid': !!error })
        : children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const badgeVariants = {
  default: 'bg-primary/12 text-primary border-primary/25',
  secondary: 'bg-secondary text-secondary-foreground border-transparent',
  destructive: 'bg-destructive/12 text-destructive border-destructive/25',
  success: 'bg-success/12 text-success border-success/25',
  warning: 'bg-warning/15 text-warning border-warning/30',
  info: 'bg-info/12 text-info border-info/25',
  outline: 'text-muted-foreground border-border bg-transparent',
  solid: 'bg-primary text-primary-foreground border-transparent',
};

export function Badge({ variant = 'default', className, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}

export function Avatar({ photo, name, className }) {
  const base = 'h-10 w-10 shrink-0 rounded-full';
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        loading="lazy"
        className={cn(base, 'border border-border object-cover', className)}
      />
    );
  }
  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      aria-hidden="true"
      className={cn(
        base,
        'bg-primary ring-inset-light flex items-center justify-center text-xs font-semibold text-primary-foreground',
        className
      )}
    >
      {initials}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

/** Standard page-level loading placeholder: header + rows. */
export function SkeletonPage({ rows = 5 }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Card className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function ProgressBar({ value, className, label }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div
      className={cn('h-2.5 overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ============================================================
   Overlays — Dialog / Sheet
   ============================================================ */

/* `[tabindex="-1"]` is excluded everywhere: the pickers park an invisible input
   there purely to carry `required`, and it must not eat the focus. */
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]),button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([tabindex="-1"]),' +
  'select:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])';

let openOverlays = 0;

/**
 * Accessible modal. Renders as a centered dialog on tablet+ and as a
 * bottom sheet on phones (thumb-reachable, native-feeling).
 */
export function Dialog({ open, onClose, title, description, children, size = 'md' }) {
  const { t } = useTranslation();
  const panelRef = useRef(null);
  const contentRef = useRef(null);
  const restoreRef = useRef(null);
  const titleId = useId();
  // Callers pass inline arrows; a ref keeps the effect from re-running (and
  // re-focusing) on every parent render while Escape still sees the latest.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    openOverlays += 1;
    document.body.setAttribute('data-scroll-locked', '');

    const panel = panelRef.current;
    // Focus the first field, not the close button, so keyboards land on content.
    const first = contentRef.current?.querySelector(FOCUSABLE);
    (first || panel)?.focus({ preventScroll: true });

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        // A select/popover layer is open on top — that one owns the Escape,
        // otherwise closing a dropdown would throw the whole form away.
        if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      openOverlays = Math.max(0, openOverlays - 1);
      if (openOverlays === 0) document.body.removeAttribute('data-scroll-locked');
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="animate-overlay-in absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'animate-sheet-in sm:animate-dialog-in relative flex max-h-[92dvh] w-full flex-col',
          'rounded-t-3xl border border-border bg-card shadow-xl outline-none',
          'sm:max-h-[88dvh] sm:rounded-2xl',
          widths[size]
        )}
      >
        {/* Grab handle — signals the sheet is dismissible on touch */}
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border sm:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-semibold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
            <IconX />
          </Button>
        </div>
        <div ref={contentRef} className="safe-b flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ============================================================
   Confirm — replaces window.confirm (styled, i18n-able, focus-safe)
   ============================================================ */

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children, labels }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((opts) => {
    setState(typeof opts === 'string' ? { message: opts } : opts);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function settle(value) {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!state}
        onClose={() => settle(false)}
        title={state?.title || labels.confirmTitle}
        size="sm"
      >
        <p className="text-sm text-muted-foreground">{state?.message}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => settle(false)}>
            {state?.cancelLabel || labels.cancel}
          </Button>
          <Button
            variant={state?.destructive === false ? 'default' : 'destructive'}
            onClick={() => settle(true)}
          >
            {state?.confirmLabel || labels.confirm}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (await confirm(msg)) {...}` */
export const useConfirm = () => useContext(ConfirmContext);

/* ============================================================
   Toasts
   ============================================================ */

const ToastContext = createContext(null);

const toastStyles = {
  success: { cls: 'border-success/30 bg-success/12 text-success', Icon: IconCheck },
  error: { cls: 'border-destructive/30 bg-destructive/12 text-destructive', Icon: IconAlert },
  info: { cls: 'border-info/30 bg-info/12 text-info', Icon: IconSparkles },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message, type = 'success', ms = 3200) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-2), { id, message, type }]);
      setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      toast: push,
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error', 5000),
      info: (m) => push(m, 'info'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          role="region"
          aria-label="notifications"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottomnav-h)+0.75rem)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-5 lg:items-end lg:px-5"
        >
          {toasts.map(({ id, message, type }) => {
            const { cls, Icon: I } = toastStyles[type] || toastStyles.info;
            return (
              <div
                key={id}
                role="status"
                aria-live="polite"
                onClick={() => dismiss(id)}
                className={cn(
                  'animate-toast-in pointer-events-auto flex w-full max-w-sm cursor-pointer items-start gap-2.5',
                  'glass rounded-xl border px-4 py-3 text-sm font-medium shadow-lg',
                  cls
                )}
              >
                <I className="mt-0.5" />
                <span className="flex-1">{message}</span>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ============================================================
   Data display
   ============================================================ */

/** Horizontally scrollable table with a fade hint at the trailing edge. */
export function Table({ children, className }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 whitespace-nowrap px-3 text-start align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }) {
  return <td className={cn('px-3 py-3 align-middle', className)} {...props} />;
}

/** Row in a card-style list. Set `to`/`onClick` to make the whole row activate. */
export function ListRow({ className, children, ...props }) {
  return (
    <li
      className={cn('flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5', className)}
      {...props}
    />
  );
}

export function EmptyState({ icon, title, children, action, className }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className
      )}
    >
      {icon && (
        <div className="bg-brand-soft flex h-14 w-14 items-center justify-center rounded-2xl text-primary ring-1 ring-primary/15">
          {icon}
        </div>
      )}
      {title && <p className="font-medium text-foreground">{title}</p>}
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}

/** Full-width error card with a retry affordance. */
export function ErrorState({ message, onRetry, retryLabel }) {
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <IconAlert className="h-5 w-5 text-destructive" />
        <p className="min-w-40 flex-1 text-sm font-medium text-destructive">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   Composed patterns
   ============================================================ */

/** Sticky page title row with optional actions. */
export function PageHeader({ title, description, children, className }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * Segmented control. Used for attendance marking — the options read as one
 * group to screen readers and each button reports its pressed state.
 */
export function SegmentedControl({ options, value, onChange, label, size = 'default', className }) {
  const tones = {
    success: 'bg-success text-success-foreground border-success',
    destructive: 'bg-destructive text-destructive-foreground border-destructive',
    warning: 'bg-warning text-warning-foreground border-warning',
    default: 'bg-primary text-primary-foreground border-primary',
  };
  const pad = size === 'sm' ? 'h-9 px-2.5 text-xs sm:h-8' : 'h-10 px-3 text-xs sm:h-9 sm:text-sm';
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex overflow-hidden rounded-lg border border-border', className)}
    >
      {options.map((o, i) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-ring inline-flex flex-1 cursor-pointer items-center justify-center font-medium transition-colors',
              pad,
              i > 0 && 'border-s border-border',
              active
                ? cn(tones[o.tone || 'default'], 'animate-pop')
                : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Numbered matalib grid. Read-only by default; pass `onToggle` to make the
 * cells tappable. Cells are 44px on phones so they are reliably hittable.
 */
export function RequirementGrid({ total, selected = [], onToggle, label }) {
  const set = new Set(selected);
  return (
    <div
      role={onToggle ? 'group' : 'list'}
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))]"
    >
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const on = set.has(n);
        const cls = cn(
          'flex h-11 items-center justify-center rounded-md border text-xs font-semibold transition-all sm:h-9',
          on
            ? 'border-primary bg-primary text-primary-foreground shadow-xs'
            : 'border-border bg-muted text-muted-foreground'
        );
        return onToggle ? (
          <button
            key={n}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(n)}
            className={cn(
              cls,
              'focus-ring cursor-pointer',
              on ? 'animate-pop' : 'hover:border-primary/40 hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {n}
          </button>
        ) : (
          <div key={n} role="listitem" className={cls}>
            {n}
          </div>
        );
      })}
    </div>
  );
}

/** Big number tile. Optional `to` turns the whole tile into a link target. */
export function StatTile({ icon, label, value, hint, tone = 'brand', className }) {
  const tones = {
    brand: 'text-primary',
    success: 'text-success',
    destructive: 'text-destructive',
    warning: 'text-warning',
    plain: 'text-foreground',
  };
  return (
    <div className={cn('flex items-center gap-4', className)}>
      {icon && (
        <div className="bg-brand-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-primary ring-1 ring-primary/15">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className={cn('tabular text-3xl font-bold leading-none tracking-tight', tones[tone])}>
          {value}
        </div>
        <div className="mt-1.5 truncate text-sm text-muted-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

/** Label/value pair for detail headers. */
export function DetailItem({ icon, label, children, dir }) {
  return (
    <div className="flex items-start gap-1.5 text-sm">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground" dir={dir}>
        {children}
      </span>
    </div>
  );
}
