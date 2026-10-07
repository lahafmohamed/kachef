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
/** A month's dues paid — lucide «calendar-check» */
export const IconCalendarCheck = (p) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <path d="m9 16 2 2 4-4" />
  </Icon>
);
/** المخيمات و الدورات — lucide «tent» */
export const IconTent = (p) => (
  <Icon {...p}>
    <path d="M3.5 21 14 3" />
    <path d="M20.5 21 10 3" />
    <path d="M15.5 21 12 15l-3.5 6" />
    <path d="M2 21h20" />
  </Icon>
);
/** الاجتماعات — lucide «messages-square»: what was said, and what came of it */
export const IconMessages = (p) => (
  <Icon {...p}>
    <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
    <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
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
export const IconArchive = (p) => (
  <Icon {...p}>
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </Icon>
);
export const IconArchiveRestore = (p) => (
  <Icon {...p}>
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h2" />
    <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
    <path d="m9 15 3-3 3 3" />
    <path d="M12 12v9" />
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
/** WhatsApp's own glyph, filled — the outline set has no shape people recognise as it. */
export const IconWhatsApp = ({ className }) => (
  <svg className={cn('h-4 w-4 shrink-0', className)} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35ZM12.05 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.4 9.4 0 0 1-1.44-5.01c0-5.2 4.23-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.44 9.43Zm8.03-17.46A11.27 11.27 0 0 0 12.05.72C5.79.72.7 5.8.7 12.06c0 2 .52 3.95 1.52 5.67L.6 23.28l5.68-1.49a11.33 11.33 0 0 0 5.77 1.47h.01c6.25 0 11.34-5.09 11.34-11.34 0-3.03-1.18-5.88-3.32-8.02Z" />
  </svg>
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
export const IconBell = (p) => (
  <Icon {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
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
export const IconClipboard = (p) => (
  <Icon {...p}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M9 11h6" />
    <path d="M9 15h4" />
  </Icon>
);
export const IconAward = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="6" />
    <path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5" />
  </Icon>
);
// تقييم النشاط
export const IconStar = (p) => (
  <Icon {...p}>
    <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
  </Icon>
);
export const IconCoins = (p) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
    <path d="M7 6h1v4" />
    <path d="m16.71 13.88.7.71-2.82 2.82" />
  </Icon>
);
export const IconHandHeart = (p) => (
  <Icon {...p}>
    <path d="M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16" />
    <path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
    <path d="m2 15 6 6" />
    <path d="M19.5 8.5c.7-.7 1.5-1.6 1.5-2.7A2.73 2.73 0 0 0 16 4a2.78 2.78 0 0 0-5 1.8c0 1.2.8 2 1.5 2.8L16 12Z" />
  </Icon>
);
export const IconWallet = (p) => (
  <Icon {...p}>
    <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
    <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
  </Icon>
);
export const IconReceipt = (p) => (
  <Icon {...p}>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
    <path d="M12 17.5v-11" />
  </Icon>
);
export const IconTransfer = (p) => (
  <Icon {...p}>
    <path d="m16 3 4 4-4 4" />
    <path d="M20 7H4" />
    <path d="m8 21-4-4 4-4" />
    <path d="M4 17h16" />
  </Icon>
);
// lucide «scale»: a caisse's count weighed against its book
export const IconScale = (p) => (
  <Icon {...p}>
    <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
    <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
    <path d="M7 21h10" />
    <path d="M12 3v18" />
    <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
  </Icon>
);
export const IconLock = (p) => (
  <Icon {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);
export const IconTag = (p) => (
  <Icon {...p}>
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
    <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
  </Icon>
);
export const IconEye = (p) => (
  <Icon {...p}>
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const IconEyeOff = (p) => (
  <Icon {...p}>
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </Icon>
);
export const IconLink = (p) => (
  <Icon {...p}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Icon>
);
export const IconUnlink = (p) => (
  <Icon {...p}>
    <path d="M15 7l1.5-1.5a5 5 0 0 1 7 7L22 14" />
    <path d="M9 17l-1.5 1.5a5 5 0 0 1-7-7L2 10" />
    <path d="M3 3l18 18" />
  </Icon>
);
export const IconKey = (p) => (
  <Icon {...p}>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6" />
    <path d="m15.5 7.5 3 3" />
  </Icon>
);
export const IconRefresh = (p) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <polyline points="21 3 21 9 15 9" />
  </Icon>
);
export const IconUserCheck = (p) => (
  <Icon {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <polyline points="16 11 18 13 22 9" />
  </Icon>
);
export const IconMore = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </Icon>
);
export const IconLogout = (p) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Icon>
);
export const IconDownload = (p) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </Icon>
);
// A document and a spreadsheet: the same page, lines of text or cells
export const IconFileText = (p) => (
  <Icon {...p}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </Icon>
);
export const IconFileSheet = (p) => (
  <Icon {...p}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M8 13h2" />
    <path d="M14 13h2" />
    <path d="M8 17h2" />
    <path d="M14 17h2" />
  </Icon>
);
export const IconDroplet = (p) => (
  <Icon {...p}>
    <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
  </Icon>
);
export const IconCamera = (p) => (
  <Icon {...p}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Icon>
);

/* ============================================================
   Theme
   ============================================================ */

const ThemeContext = createContext({
  theme: 'light',
  setTheme: () => {},
  toggle: () => {},
  setChromeTint: () => {},
});

function initialTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);
  // A screen whose top edge isn't the page background (the sign-in scene) can
  // ask for the browser chrome to match it: the name of a CSS colour variable.
  const [chromeTint, setChromeTint] = useState(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    // The browser chrome (a phone's status and address bars) takes the colour of the
    // screen's top edge — the app bar's card surface, unless a screen asks for a tint.
    // Read after the class flips, so it resolves in the new theme, and through a
    // probe, so the meta always gets a plain rgb() whatever syntax the token uses.
    const probe = document.createElement('i');
    probe.style.color = `var(${chromeTint || '--card'})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    // Every theme-color meta: index.html scopes one per system colour scheme, and with
    // the app's theme set against the system's, the one left untouched would win
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
    localStorage.setItem('theme', theme);
  }, [theme, chromeTint]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggle: () => setTheme((v) => (v === 'dark' ? 'light' : 'dark')),
      setChromeTint,
    }),
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

/**
 * Cross-fades one icon into another in place — theme toggles, check marks on a
 * selectable chip, anything whose icon is a function of state.
 *
 * Both slots stay mounted and stacked in a single grid cell, so the outgoing
 * icon animates *out* instead of vanishing. There is no motion library in this
 * project, so the swap is a plain CSS transition, which also means it is
 * interruptible — toggle twice quickly and the second swap picks up wherever
 * the first had reached.
 *
 * Two shapes:
 *  - `offIcon` given (theme toggle): the box is a fixed size and never resizes.
 *  - `collapse` (a check on a selectable chip): the box animates from zero
 *    width, so an unselected chip carries no dead space but the row still does
 *    not jump — the reflow is spread over the transition instead of landing on
 *    one frame. Assumes the parent is a flex row with `gap-1.5`: the negative
 *    inline-end margin cancels that gap while collapsed, so the chip closes up
 *    completely. The icons inside keep their own size and are clipped by the
 *    box, which makes the check appear to grow out of the chip's edge.
 */
export function IconSwap({ on, onIcon, offIcon = null, collapse = false, className }) {
  return (
    <span
      className={cn(
        'relative inline-grid h-4 w-4 shrink-0 place-items-center',
        className,
        // Last so tailwind-merge lets the collapsed width beat the caller's.
        collapse && [
          'overflow-hidden transition-[width,margin-inline-end] duration-200',
          'ease-[cubic-bezier(0.2,0,0,1)]',
          !on && 'w-0 -me-1.5',
        ]
      )}
    >
      {[
        { key: 'off', node: offIcon, show: !on },
        { key: 'on', node: onIcon, show: on },
      ].map(({ key, node, show }) => (
        <span
          key={key}
          aria-hidden="true"
          className={cn(
            'col-start-1 row-start-1 flex transition-[opacity,scale,filter] duration-200',
            'ease-[cubic-bezier(0.2,0,0,1)]',
            // blur-[0px], not blur-0: v4 dropped `blur-0`, and without a filter
            // declared on both sides the blur snaps off instead of resolving.
            show ? 'scale-100 opacity-100 blur-[0px]' : 'scale-[0.25] opacity-0 blur-[4px]'
          )}
        >
          {node}
        </span>
      ))}
    </span>
  );
}

/* Solid variants carry a hairline top highlight so they read as lit surfaces
   rather than flat swatches, and a color-matched glow instead of grey shadow. */
const buttonVariants = {
  default:
    'ring-inset-light bg-primary text-primary-foreground shadow-brand hover:bg-primary-hover active:scale-[0.96]',
  brand:
    'ring-inset-light bg-primary text-primary-foreground shadow-brand hover:bg-primary-hover active:scale-[0.96]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70 active:scale-[0.96]',
  outline:
    'border border-border bg-card text-foreground shadow-xs hover:border-primary/35 hover:bg-accent hover:text-accent-foreground active:scale-[0.96]',
  ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground active:scale-[0.96]',
  destructive:
    'ring-inset-light bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:scale-[0.96]',
  'destructive-ghost': 'text-destructive hover:bg-destructive/10 active:scale-[0.96]',
};

/* Touch targets are ≥44px on phones and tighten up on pointer devices. */
const buttonSizes = {
  default: 'h-11 px-4 text-sm sm:h-10',
  sm: 'h-11 px-3 text-xs sm:h-8',
  lg: 'h-12 px-6 text-base sm:h-11',
  icon: 'h-11 w-11 sm:h-9 sm:w-9',
  'icon-sm': 'h-11 w-11 sm:h-8 sm:w-8',
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
        'font-medium tracking-[-0.005em] transition-[color,background-color,border-color,box-shadow,scale] duration-150 cursor-pointer',
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
          'transition-[border-color,box-shadow,background-color] duration-200 hover:border-primary/30 hover:shadow-md active:shadow-xs',
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

/* Block, not the native inline: forms space label and control with space-y-*,
   whose margins an inline box ignores — the label then sat in its parent's
   line box with the focus ring over its descenders. text-sm keeps its own
   20px line height so a wrapped Arabic label isn't crushed to line-height 1. */
export function Label({ className, ...props }) {
  return (
    <label
      className={cn('block text-sm font-medium text-foreground', className)}
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
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums',
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
        className={cn(base, 'img-outline object-cover', className)}
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
 * `footer` stays pinned under the scrolling body — a long form keeps its save
 * button in reach without scrolling to the end (buttons use `form="<id>"`).
 * `autoFocus={false}` parks focus on the panel instead of the first field: a list
 * whose first control is a search box would otherwise pop the phone keyboard open.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', autoFocus = true }) {
  const { t } = useTranslation();
  const panelRef = useRef(null);
  const contentRef = useRef(null);
  const restoreRef = useRef(null);
  const titleId = useId();
  // Callers pass inline arrows; a ref keeps the effect from re-running (and
  // re-focusing) on every parent render while Escape still sees the latest.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The panel outlives `open` by the length of its exit animation, so dismissing
  // fades and settles instead of cutting to nothing — a sheet that slides up
  // over 320ms and then vanishes on a single frame reads as a glitch. Focus and
  // the scroll lock are released immediately (the effect below), not at the end
  // of the exit: only the pixels linger.
  const [render, setRender] = useState(open);
  useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    const id = setTimeout(() => setRender(false), 200); // --dur-base
    return () => clearTimeout(id);
  }, [open]);

  // Callers almost all write `{editing && <Form/>}` and clear `editing` on the
  // same tick that closes the dialog, and titles read `editing?.id ? … : …`.
  // Rendering live props through the exit would therefore fade out an empty
  // shell with the wrong heading. Hold the last frame we were handed while open
  // and play the exit against that — the user watches the dialog they were
  // actually looking at leave.
  const lastFrame = useRef(null);
  if (open) lastFrame.current = { title, description, children, footer };
  const frame = (open ? null : lastFrame.current) || { title, description, children, footer };

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    openOverlays += 1;
    document.body.setAttribute('data-scroll-locked', '');

    const panel = panelRef.current;
    // Focus the first field, not the close button, so keyboards land on content.
    const first = autoFocus ? contentRef.current?.querySelector(FOCUSABLE) : null;
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

  if (!render) return null;

  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };
  // On the way out the panel is decoration only: it must not swallow the click
  // that follows the dismissal, and assistive tech must not still see a dialog.
  const leaving = !open;

  return createPortal(
    <div
      aria-hidden={leaving || undefined}
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4',
        leaving && 'pointer-events-none'
      )}
    >
      <div
        className={cn(
          'absolute inset-0 bg-black/50 backdrop-blur-sm',
          leaving ? 'animate-overlay-out' : 'animate-overlay-in'
        )}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col',
          leaving ? 'animate-sheet-out sm:animate-dialog-out' : 'animate-sheet-in sm:animate-dialog-in',
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
              {frame.title}
            </h2>
            {frame.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{frame.description}</p>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
            <IconX />
          </Button>
        </div>
        {/* max(), as on the footer: safe-b alone zeroes the bottom padding on phones
            without a home indicator, so a form's own buttons sat on the screen edge */}
        <div
          ref={contentRef}
          className={cn(
            'flex-1 overflow-y-auto p-4 sm:p-5',
            !frame.footer &&
              'pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]'
          )}
        >
          {frame.children}
        </div>
        {frame.footer && (
          // max(): safe-b alone would zero the padding on phones without a home indicator
          <div className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:rounded-b-2xl sm:px-5">
            {frame.footer}
          </div>
        )}
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
  const { t } = useTranslation();
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());

  // Two-phase: mark the toast leaving so it can fade, then drop it from the
  // stack once the exit has played. Same reasoning as the sheet — an element
  // that animated its way in should not leave on a single frame.
  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((ts) => ts.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    clearTimeout(timers.current.get(`${id}:out`));
    timers.current.set(
      `${id}:out`,
      setTimeout(() => {
        timers.current.delete(`${id}:out`);
        setToasts((ts) => ts.filter((x) => x.id !== id));
      }, 120) // --dur-fast
    );
  }, []);

  const arm = useCallback(
    (id, ms) => {
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss]
  );

  const push = useCallback(
    (message, type = 'success', ms = 3200) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-2), { id, message, type, ms }]);
      arm(id, ms);
      return id;
    },
    [arm]
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
          aria-label={t('notif.title')}
          // Top of the screen on phones — the bottom is owned by the tab bar and
          // sticky save bars, so toasts there covered the very buttons just tapped.
          className="pointer-events-none fixed inset-x-0 top-[calc(var(--header-h)+env(safe-area-inset-top,0px)+0.75rem)] z-[60] flex flex-col items-center gap-2 px-4 lg:top-auto lg:bottom-5 lg:items-end lg:px-5"
        >
          {toasts.map(({ id, message, type, ms, leaving }) => {
            const { cls, Icon: I } = toastStyles[type] || toastStyles.info;
            // Hovering or focusing holds the toast; leaving restarts the full
            // timer. A toast already on its way out ignores both.
            const hold = () => !leaving && clearTimeout(timers.current.get(id));
            const release = () => !leaving && arm(id, ms);
            return (
              <div
                key={id}
                role="status"
                aria-live="polite"
                onMouseEnter={hold}
                onMouseLeave={release}
                onFocus={hold}
                onBlur={release}
                className={cn(
                  'flex w-full max-w-sm items-start gap-2.5',
                  leaving ? 'animate-toast-out pointer-events-none' : 'animate-toast-in pointer-events-auto',
                  'glass rounded-xl border ps-4 pe-2 py-2.5 text-sm font-medium shadow-lg',
                  cls
                )}
              >
                <I className="mt-1" />
                <span className="flex-1 py-0.5">{message}</span>
                {/* The visible square stays 32px so it sits inside the toast,
                    but the pseudo-element takes the real hit area to 44px —
                    this control is thumb-sized on phones, where the toast
                    renders at the top of the screen. */}
                <button
                  type="button"
                  onClick={() => dismiss(id)}
                  aria-label={t('common.close')}
                  className={cn(
                    'focus-ring relative -me-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                    'opacity-70 transition-opacity hover:opacity-100',
                    'before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11',
                    'before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]'
                  )}
                >
                  <IconX className="h-4 w-4" />
                </button>
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

/** Horizontally scrollable table; the wrapper owns the scroll so the page never does. */
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
        <div className="bg-brand-soft flex h-14 w-14 items-center justify-center rounded-xl text-primary ring-1 ring-primary/15">
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
export function SegmentedControl({ options, value, onChange, label, size = 'default', columns, className }) {
  const tones = {
    success: 'bg-success text-success-foreground border-success',
    destructive: 'bg-destructive text-destructive-foreground border-destructive',
    warning: 'bg-warning text-warning-foreground border-warning',
    // Selected but quiet: for a state most rows sit in by default, which a
    // solid fill would turn into a wall of colour
    'destructive-soft': 'bg-destructive/12 text-destructive border-destructive/25',
    'warning-soft': 'bg-warning/15 text-warning border-warning/30',
    default: 'bg-primary text-primary-foreground border-primary',
  };
  /* min-h instead of h so long labels (Arabic/French) wrap instead of clipping */
  const pad =
    size === 'sm'
      ? 'min-h-11 px-2.5 py-1 text-xs sm:min-h-8'
      : 'min-h-11 px-3 py-1.5 text-xs sm:min-h-9 sm:text-sm';
  return (
    <div
      role="group"
      aria-label={label}
      // `columns`: a grid instead of one row, for more options than a row can hold. The
      // 1px gap over the border colour draws the lines between cells, across rows too.
      // The grid goes last so a caller's «flex w-full» cannot undo it (cn keeps the last)
      className={cn(
        'overflow-hidden rounded-lg border border-border',
        !columns && 'inline-flex',
        className,
        columns && 'grid gap-px bg-border'
      )}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
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
              'focus-ring inline-flex flex-1 cursor-pointer items-center justify-center text-center leading-tight font-medium',
              'transition-[color,background-color,border-color,scale] duration-150 active:scale-[0.96]',
              pad,
              !columns && i > 0 && 'border-s border-border',
              // A count the grid cannot fill evenly: the first option («Tout») takes a whole row
              columns && i === 0 && options.length % columns && 'col-span-full',
              active
                ? tones[o.tone || 'default']
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
  // `animate-pop` acknowledges a tap, so only the tapped cell may play it.
  // Keying it off `on` alone fired the animation for every already-earned cell
  // the instant the grid mounted: open a عنصر with fifteen مطالب and fifteen
  // cells popped at once, which reads as a page glitch rather than feedback.
  // Same rule as skipping enter animations on first render.
  const [popped, setPopped] = useState(null);
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
          'flex h-11 items-center justify-center rounded-md border text-xs font-semibold transition-[color,background-color,border-color,box-shadow] sm:h-9',
          on
            ? 'border-primary bg-primary text-primary-foreground shadow-xs'
            : 'border-border bg-muted text-muted-foreground'
        );
        return onToggle ? (
          <button
            key={n}
            type="button"
            aria-pressed={on}
            onClick={() => {
              setPopped(n);
              onToggle(n);
            }}
            className={cn(
              cls,
              'focus-ring cursor-pointer',
              on
                ? popped === n && 'animate-pop'
                : 'hover:border-primary/40 hover:bg-accent hover:text-accent-foreground'
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
        <div className="bg-brand-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-primary ring-1 ring-primary/15">
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
