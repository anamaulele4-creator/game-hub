'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { isPublic } from '@/lib/routes';
import { Logo } from './ui';

export function Splash() {
  return (
    <div className="relative flex min-h-[85vh] flex-col items-center justify-center gap-3">
      <div className="hero-bg hero-strong" aria-hidden />
      <Logo size={72} />
      <p className="bg-gradient-to-r from-neon to-neon2 bg-clip-text text-xl font-black tracking-wider text-transparent">Social POIPAK</p>
      <div className="h-1 w-24 overflow-hidden rounded bg-panel2"><div className="h-1 w-1/2 animate-pulse rounded bg-neon" /></div>
    </div>
  );
}

/** Portão de autenticação: sem sessão, todas as rotas (exceto públicas) vão para /bem-vindo. A sessão fica guardada. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  const router = useRouter();
  const { s, ready } = useStore();
  const pub = isPublic(path);
  const allowed = IS_DEMO || pub || s.account.loggedIn;
  useEffect(() => {
    if (ready && !allowed) {
      const next = path.replace(process.env.NEXT_PUBLIC_BASE_PATH ?? '', '') || '/';
      router.replace(next && next !== '/' ? `/bem-vindo?next=${encodeURIComponent(next + (typeof window !== 'undefined' ? window.location.search : ''))}` : '/bem-vindo');
    }
  }, [ready, allowed, path, router]);
  if (pub || IS_DEMO) return <>{children}</>;
  if (!ready || !allowed) return <Splash />;
  return <>{children}</>;
}
