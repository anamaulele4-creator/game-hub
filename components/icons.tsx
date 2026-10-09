// Ícones TXAPZONE: traço único de 1.8 px, cantos arredondados, herdam a cor (currentColor).
// A app não usa emojis: todos os ícones da interface vêm daqui (desenhados à mão, grelha 24 px).
import React from 'react';

export type IconName =
  | 'home' | 'explore' | 'plus' | 'clips' | 'user' | 'chat' | 'bell' | 'menu' | 'back' | 'close' | 'gamepad'
  | 'trophy' | 'live' | 'search' | 'settings' | 'shop' | 'star' | 'chevron' | 'video' | 'spark' | 'calendar' | 'shield' | 'download' | 'wifi' | 'bolt'
  | 'wallet' | 'receipt' | 'cart' | 'lock' | 'bot' | 'cap' | 'tool' | 'swap' | 'logout' | 'megaphone' | 'chart' | 'users'
  | 'card' | 'alert' | 'idcard' | 'cpu' | 'doc' | 'check' | 'info' | 'box' | 'store' | 'coin' | 'palette' | 'target'
  | 'book' | 'globe' | 'mail' | 'phone' | 'key' | 'eye' | 'trash' | 'crown' | 'clock' | 'moon' | 'image' | 'link' | 'flag' | 'ticket';

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
  bolt: <><path d="M13.2 3.5 5.8 13.2h5.6l-1 7.3 7.8-10h-5.7z" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3" /><rect x="4" y="8" width="16" height="11" rx="2.5" /><path d="M15.5 13.5h.01" strokeWidth="2.6" /></>,
  receipt: <><path d="M6 3.5h12v17l-2.5-1.6L13 20.5l-2.5-1.6L8 20.5l-2-1.3z" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></>,
  cart: <><path d="M3.5 4.5h2.2l2.1 10.2h9.6l1.9-7.2H6.6" /><circle cx="9.5" cy="19" r="1.3" /><circle cx="16.5" cy="19" r="1.3" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5M12 14.4v2" /></>,
  bot: <><rect x="4.5" y="8" width="15" height="11" rx="3.5" /><path d="M12 4.5V8M9.3 13h.01M14.7 13h.01M9.8 16.2h4.4" /><path d="M2.8 12.5v2.5M21.2 12.5v2.5" /></>,
  cap: <><path d="m2.8 9.5 9.2-4.5 9.2 4.5-9.2 4.5z" /><path d="M6.6 11.4v4.3c1.4 1.4 3.4 2.2 5.4 2.2s4-.8 5.4-2.2v-4.3M21.2 9.5v5" /></>,
  tool: <><path d="M14.6 6.2a4 4 0 0 0 5 5L12.2 18.6a2.2 2.2 0 0 1-3.1-3.1z" /><path d="M14.6 6.2 17 3.8l3.2 3.2-2.4 2.4" /></>,
  swap: <><path d="M5 8.5h13l-3.5-3.5M19 15.5H6l3.5 3.5" /></>,
  logout: <><path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" /><path d="M14.5 8 18.5 12l-4 4M18.5 12H9.5" /></>,
  megaphone: <><path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H7l7.5 4V4.5L7 8.5H5.5A1.5 1.5 0 0 0 4 10Z" /><path d="M18 9a4 4 0 0 1 0 6M7.5 15.5l1 4" /></>,
  chart: <><path d="M4.5 19.5h15" /><path d="M7 16v-4.5M11 16V7.5M15 16v-6M19 16V5" /></>,
  users: <><circle cx="9" cy="8.5" r="3.3" /><path d="M3.2 19.2c.9-3 3.1-4.6 5.8-4.6s4.9 1.6 5.8 4.6M15.2 5.6a3.2 3.2 0 0 1 0 6M17.4 14.8c1.7.6 2.9 2 3.4 4.4" /></>,
  card: <><rect x="3.5" y="6" width="17" height="12" rx="2.5" /><path d="M3.5 10h17M7 14.5h3" /></>,
  alert: <><path d="M12 4.2 21 19.5H3z" /><path d="M12 10v4.2M12 17h.01" /></>,
  idcard: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M6 15.5c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h3.5M14 13.5h3.5" /></>,
  cpu: <><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 10h4v4h-4zM9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5" /></>,
  doc: <><path d="M6.5 3.5h7.5l4 4v13h-11.5z" /><path d="M13.5 3.5V8h4.5M9.5 12.5h5M9.5 16h5" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  info: <><circle cx="12" cy="12" r="8.6" /><path d="M12 11v5.5M12 7.8h.01" /></>,
  box: <><path d="m12 3.5 8 4.2v8.6l-8 4.2-8-4.2V7.7z" /><path d="m4 7.7 8 4.3 8-4.3M12 12v8.5" /></>,
  store: <><path d="M4 9.5 5.5 4.5h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v7.5h13V12M10 19.5v-4.5h4v4.5" /></>,
  coin: <><ellipse cx="12" cy="7.5" rx="7" ry="3" /><path d="M5 7.5v4.5c0 1.7 3.1 3 7 3s7-1.3 7-3V7.5M5 12v4.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12" /></>,
  palette: <><path d="M12 3.8a8.2 8.2 0 0 0 0 16.4c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.7-1.1-2.8 0-1 .8-1.7 1.9-1.7h2.2a3.4 3.4 0 0 0 3.4-3.4C20.2 6.9 16.5 3.8 12 3.8Z" /><path d="M8 10.5h.01M10.5 7.5h.01M14.5 7.8h.01" strokeWidth="2.6" /></>,
  target: <><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="4.6" /><path d="M12 12h.01" strokeWidth="2.8" /></>,
  book: <><path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2z" /><path d="M5 19.5a2 2 0 0 0 2 1h12v-3" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5Z" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m4.5 7 7.5 6 7.5-6" /></>,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 17.5h2" /></>,
  key: <><circle cx="8" cy="15" r="3.8" /><path d="m10.8 12.3 8.2-8.2M16.5 6.6l2.3 2.3M14.3 8.8l1.8 1.8" /></>,
  eye: <><path d="M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5" /></>,
  crown: <><path d="m3.8 8 4.4 3.6L12 5.5l3.8 6.1L20.2 8l-1.7 10H5.5z" /><path d="M5.5 18h13" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  moon: <><path d="M19.5 14.5A7.8 7.8 0 0 1 9.5 4.5a7.8 7.8 0 1 0 10 10Z" /></>,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4.5 17.5 5-5 3.5 3.5 2.5-2.5 4 4" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  flag: <><path d="M5.5 20.5V4M5.5 4.5h11l-2 4 2 4h-11" /></>,
  ticket: <><path d="M3.5 8.5V6.5h17v2a2.5 2.5 0 0 0 0 5v2h-17v-2a2.5 2.5 0 0 0 0-5Z" /><path d="M14 6.5v11" strokeDasharray="1.6 2" /></>,
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
