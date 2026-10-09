// Ícones TXAPILOG: traço único de 1.8 px, cantos arredondados, herdam a cor (currentColor).
// Substituem os emojis na navegação (os emojis ficam só para conteúdo e expressão).
import React from 'react';

export type IconName =
  | 'home' | 'explore' | 'plus' | 'clips' | 'user' | 'chat' | 'bell' | 'menu' | 'back' | 'close' | 'gamepad'
  | 'trophy' | 'live' | 'search' | 'settings' | 'shop' | 'star' | 'chevron' | 'video' | 'spark' | 'calendar' | 'shield' | 'download' | 'wifi';

const P: Record<IconName, React.ReactNode> = {
  home: <><path d="M3.5 10.5 12 3.8l8.5 6.7" /><path d="M5.8 9v10.2h4.4v-5.4h3.6v5.4h4.4V9" /></>,
  explore: <><circle cx="12" cy="12" r="8.6" /><path d="m15.6 8.4-2.2 5-5 2.2 2.2-5z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  clips: <><rect x="4" y="3.5" width="16" height="17" rx="3.5" /><path d="m10.2 9.2 4.6 2.8-4.6 2.8z" /></>,
  user: <><circle cx="12" cy="8.4" r="3.9" /><path d="M4.6 20.2c1.3-3.6 4.1-5.4 7.4-5.4s6.1 1.8 7.4 5.4" /></>,
  chat: <><path d="M20 11.6c0 4.2-3.6 7.4-8 7.4-1.2 0-2.3-.2-3.3-.6L4 19.8l1.3-3.9A7 7 0 0 1 4 11.6C4 7.4 7.6 4.2 12 4.2s8 3.2 8 7.4Z" /></>,
  bell: <><path d="M6.3 16.5V11a5.7 5.7 0 0 1 11.4 0v5.5l1.6 1.8H4.7z" /><path d="M10 20.2a2.2 2.2 0 0 0 4 0" /></>,
  menu: <><path d="M4.5 7h15M4.5 12h15M4.5 17h15" /></>,
  back: <><path d="M14.8 5.2 8 12l6.8 6.8" /></>,
  close: <><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></>,
  gamepad: <><path d="M7.4 7h9.2A4.4 4.4 0 0 1 21 11.4v1.4a4.2 4.2 0 0 1-7.4 2.8l-.6-.7h-2l-.6.7A4.2 4.2 0 0 1 3 12.8v-1.4A4.4 4.4 0 0 1 7.4 7Z" /><path d="M7.8 9.6v3.4M6.1 11.3h3.4" /><path d="M15.6 10.4h.01M17.4 12.2h.01" strokeWidth="2.6" /></>,
  trophy: <><path d="M7.5 4.5h9v4.2a4.5 4.5 0 0 1-9 0z" /><path d="M7.5 6.2H4.6v1.2a3 3 0 0 0 3 3M16.5 6.2h2.9v1.2a3 3 0 0 1-3 3M12 13.2v3.6M8.6 19.8h6.8M9.6 16.8h4.8v3H9.6z" /></>,
  live: <><circle cx="12" cy="12" r="2.3" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.5 4.5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" /></>,
  shop: <><path d="M5 8h14l-1.2 11.2H6.2z" /><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" /></>,
  star: <><path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.2l-4.8 2.6 1-5.4-4-3.7 5.4-.7z" /></>,
  chevron: <><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></>,
  video: <><rect x="3.5" y="6" width="12.5" height="12" rx="2.5" /><path d="m16 10.5 4.5-2.7v8.4L16 13.5" /></>,
  spark: <><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.6 2.6M15.4 15.4 18 18M18 6l-2.6 2.6M8.6 15.4 6 18" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  shield: <><path d="M12 3.6 19 6.3v5.4c0 4.3-3 7.6-7 8.8-4-1.2-7-4.5-7-8.8V6.3z" /><path d="m9 12 2.2 2.2L15.2 10" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></>,
  wifi: <><path d="M4 9.5a12 12 0 0 1 16 0M7 12.8a7.5 7.5 0 0 1 10 0M10 16a3 3 0 0 1 4 0" /><path d="M12 19.2h.01" strokeWidth="2.8" /></>,
};

export function Icon({ name, size = 24, className = '', strokeWidth = 1.8, title }: { name: IconName; size?: number; className?: string; strokeWidth?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {P[name]}
    </svg>
  );
}
