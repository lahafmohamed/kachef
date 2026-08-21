/**
 * shadcn/ui Select — Radix primitive with this project's tokens.
 * Every dropdown in the app goes through this — filters directly, form fields
 * through the `Select` wrapper in ui.jsx that keeps the `<option>` API.
 */
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '../../lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

function Chevron({ className }) {
  return (
    <svg
      className={cn('h-4 w-4 shrink-0 opacity-60', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Check({ className }) {
  return (
    <svg
      className={cn('h-4 w-4', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function SelectTrigger({ className, children, icon, ...props }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'focus-ring flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-xs',
        'transition-colors hover:bg-accent/40 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-10',
        'data-[placeholder]:text-muted-foreground [&>span]:truncate',
        className
      )}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        {children}
      </span>
      <SelectPrimitive.Icon asChild>
        <Chevron />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = 'popper', ...props }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          // max-w caps long option labels on narrow phones — Radix only shifts on
          // collision, it never shrinks the panel by itself
          'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] max-w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg',
          'data-[state=open]:animate-dialog-in',
          className
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }) {
  return (
    <SelectPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)}
      {...props}
    />
  );
}

export function SelectItem({ className, children, ...props }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        // 44px tall on touch so the list is comfortable to tap
        'relative flex min-h-11 w-full cursor-pointer select-none items-center gap-2 rounded-md py-2 pe-8 ps-2.5 text-sm outline-none sm:min-h-9',
        '[&>span:first-child]:min-w-0 [&>span:first-child]:truncate',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute end-2 text-primary">
        <Check />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({ className, ...props }) {
  return <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
