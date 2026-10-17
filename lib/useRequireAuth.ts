'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Devolve uma função: se há sessão executa a ação, senão leva ao login e volta depois. */
export function useRequireAuth() {
  const { s, toast } = useStore();
  const router = useRouter();
  const path = usePathname() || '/';
  const logged = IS_DEMO || s.account.loggedIn;
  return (action?: () => void): boolean => {
    if (logged) { action?.(); return true; }
    toast('Entra na tua conta para continuar.');
    router.push(`/entrar?next=${encodeURIComponent(path.replace(BASE, '') || '/')}`);
    return false;
  };
}