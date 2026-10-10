// Ícones de linha (24×24, traço 1.8) para a navegação e cabeçalhos — um só estilo em toda a app.
// Desenhados à mão (sem biblioteca) para manter o bundle pequeno.
import React from 'react';

export type IconName =
  | 'home' | 'compass' | 'plus' | 'clapper' | 'user' | 'bell' | 'chat' | 'menu' | 'back' | 'search'
  | 'trophy' | 'gamepad' | 'tv' | 'live' | 'settings' | 'chevron' | 'close' | 'sparkle' | 'star' | 'chart' | 'heart' | 'calendar' | 'shield' | 'share' | 'bookmark' | 'play' | 'volume' | 'mute';

const P: Record<IconName, React.ReactNode> = {
  home: <><path d="M3.5 10.5 12 3.8l8.5 6.7" /><path d="M5.5 9v10.2c0 .5.4.8.8.8H10v-5.5h4V20h3.7c.4 0 .8-.3.8-.8V9" /></>,
  compass: <><circle cx="12" cy="12" r="8.5" /><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  clapper: <><rect x="3.5" y="8" width="17" height="12" rx="2" /><path d="m3.8 8 1.4-3.6 15 .1-1.2 3.5M9 4.5 7.6 8M14.6 4.5 13.2 8" /><path d="m10.5 11.5 4 2.5-4 2.5z" /></>,
  user: <><circle cx="12" cy="8.5" r="3.7" /><path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  chat: <><path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.5A7.5 7.5 0 1 1 20 12Z" /></>,
  menu: <><path d="M4.5 7h15M4.5 12h15M4.5 17h15" /></>,
  back: <><path d="M14.5 5.5 8 12l6.5 6.5" /></>,
  chevron: <><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  trophy: <><path d="M8 4.5h8v5a4 4 0 0 1-8 0z" /><path d="M8 6.5H5v1.2A3 3 0 0 0 8 10.7M16 6.5h3v1.2a3 3 0 0 1-3 3M12 13.5v3.5M8.5 20h7M9.5 17h5" /></>,
  gamepad: <><path d="M7.5 7.5h9a4.5 4.5 0 0 1 4.4 5.5l-.9 3.8a2 2 0 0 1-3.5.8L14.8 15H9.2l-1.7 2.6a2 2 0 0 1-3.5-.8l-.9-3.8a4.5 4.5 0 0 1 4.4-5.5Z" /><path d="M8.5 10v3M7 11.5h3" /><circle cx="15.5" cy="10.8" r=".6" /><circle cx="17" cy="12.6" r=".6" /></>,
  tv: <><rect x="3" y="6" width="18" height="12.5" rx="2.2" /><path d="m8.5 2.8 3.5 3.2 3.5-3.2M10.5 10l4 2.3-4 2.2z" /></>,
  live: <><circle cx="12" cy="12" r="2.2" /><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 18.6a9.3 9.3 0 0 1 0-13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.4A7.6 7.6 0 0 0 6.9 6.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.5 2.4h4l.5-2.4a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  sparkle: <><path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z" /></>,
  star: <><path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.8l-5.1 2.6 1-5.6-4.1-4 5.7-.8z" /></>,
  chart: <><path d="M4.5 19.5h15M7 16v-4M11 16V8M15 16v-6M19 16V5" /></>,
  heart: <><path d="M12 19.5s-7.5-4.4-7.5-9.7A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5c0 5.3-7.5 9.7-7.5 9.7Z" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
  share: <><path d="M12 3.5v11M7.5 8 12 3.5 16.5 8" /><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" /></>,
  bookmark: <><path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" /></>,
  play: <><path d="M7.5 4.8v14.4L19 12z" /></>,
  volume: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  mute: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>,
  shield: <><path d="M12 3.2 19 6v5.5c0 4.4-3 7.8-7 9.3-4-1.5-7-4.9-7-9.3V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
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
