'use client';
// Contador de notificações por ler (torneios, compras e conta), partilhado pela moldura.
import { useStore } from '@/lib/store';
import { isPlatformNotif } from '@/lib/routes';

export function useUnread() {
  const { s } = useStore();
  const notifs = s.notifs.filter((n) => !n.read && isPlatformNotif(n)).length;
  return { notifs };
}

/** Contador sobre um ícone. */
export function CountBadge({ n, className = '' }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return <span className={`absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#FFC107] px-1 text-center text-[11px] font-bold leading-[18px] text-[#0E0F13] ring-2 ring-[#0E0F13] ${className}`}>{n > 9 ? '9+' : n}</span>;
}
