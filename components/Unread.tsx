'use client';
// Contadores de notificações e mensagens por ler, partilhados por toda a moldura (um só pedido periódico).
import { useSyncExternalStore } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';

let dmCount = 0;
let dmTimer: ReturnType<typeof setInterval> | null = null;
const dmSubs = new Set<() => void>();
function dmTick() {
  import('@/lib/dm').then((m) => m.unreadTotal()).then((n) => { if (n !== dmCount) { dmCount = n; dmSubs.forEach((f) => f()); } }).catch(() => {});
}
function dmSubscribe(f: () => void) {
  dmSubs.add(f);
  if (!dmTimer) { setTimeout(dmTick, 1200); dmTimer = setInterval(dmTick, 45000); }
  return () => { dmSubs.delete(f); if (!dmSubs.size && dmTimer) { clearInterval(dmTimer); dmTimer = null; } };
}
const noop = () => () => {};

/** Notificações e mensagens por ler (as mensagens só são pedidas com sessão). */
export function useUnread() {
  const { s, ready } = useStore();
  const on = ready && (IS_DEMO || s.account.loggedIn);
  const dm = useSyncExternalStore(on ? dmSubscribe : noop, () => (on ? dmCount : 0), () => 0);
  const notifs = s.notifs.filter((n) => !n.read).length;
  return { dm, notifs };
}

/** Contador sobre um ícone. */
export function CountBadge({ n, className = '' }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return <span className={`absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-pink px-1 text-center text-[11px] font-bold leading-[18px] text-ink ring-2 ring-bg ${className}`}>{n > 9 ? '9+' : n}</span>;
}

