import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui's class helper. Unlike a plain join, tailwind-merge resolves
 * conflicts so a caller's `className` reliably beats the component's default
 * (e.g. `h-16` passed to an `h-10` Avatar) regardless of CSS source order.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
