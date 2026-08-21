/**
 * shadcn/ui Calendar — react-day-picker v10 styled with this project's tokens.
 * Range selection, RTL aware, and localised through a date-fns locale.
 */
import { DayPicker } from 'react-day-picker';
import { cn } from '../../lib/utils';

function NavChevron({ orientation, className, ...props }) {
  const d = orientation === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6';
  return (
    <svg
      className={cn('h-4 w-4', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={d} />
    </svg>
  );
}

const navButton =
  'focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card ' +
  'text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40';

export function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('select-none', className)}
      components={{ Chevron: NavChevron }}
      classNames={{
        months: 'flex flex-col gap-4 sm:flex-row',
        month: 'space-y-3',
        month_caption: 'flex h-9 items-center justify-center',
        caption_label: 'text-sm font-semibold capitalize',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous: navButton,
        button_next: navButton,
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        // 36px columns under 640px so 7 of them + chrome fit a 320px viewport;
        // full 40px everywhere else
        weekday: 'w-9 text-[0.7rem] font-medium uppercase text-muted-foreground sm:w-10',
        week: 'mt-1 flex w-full',
        day: 'relative h-10 w-9 p-0 text-center text-sm sm:w-10',
        day_button:
          'focus-ring inline-flex h-10 w-9 items-center justify-center rounded-md font-normal tabular-nums sm:w-10 ' +
          'transition-colors hover:bg-accent hover:text-accent-foreground',
        today: 'font-bold text-primary',
        outside: 'text-muted-foreground/50',
        disabled: 'pointer-events-none opacity-40',
        hidden: 'invisible',
        // Range: the ends are solid, the middle is a tinted band
        selected: '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
        range_middle:
          'bg-accent [&>button]:bg-transparent [&>button]:text-accent-foreground [&>button]:rounded-none',
        range_start: 'rounded-s-md bg-accent',
        range_end: 'rounded-e-md bg-accent',
        root: 'relative',
        ...classNames,
      }}
      {...props}
    />
  );
}
