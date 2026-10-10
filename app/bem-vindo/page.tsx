'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BrandLogo } from '@/components/ui';
import { useStore } from '@/lib/store';

export default function BemVindo() {
  const { s, ready } = useStore();
  const router = useRouter();
  useEffect(() => {
    if (ready && s.account.loggedIn) router.replace(new URLSearchParams(window.location.search).get('next') || '/');
  }, [ready, s.account.loggedIn, router]);
  const q = typeof window !== 'undefined' ? window.location.search : '';
  return (
    <main className="relative flex min-h-screen flex-col px-6 pb-10 pt-16">
      <div className="hero-bg hero-strong" aria-hidden />
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="sr-only">TXAPILOG</h1>
        <BrandLogo width={240} />
        <p className="mt-2 max-w-xs text-sm text-white/75">Clipes, lives, torneios e ídolos do gaming moçambicano. 🇲🇿</p>
        <div className="mt-6 grid w-full max-w-xs grid-cols-3 gap-2 text-xs text-white/70">
          <span className="rounded-xl bg-panel/80 p-2">🎬<br />Clipes</span><span className="rounded-xl bg-panel/80 p-2">🏆<br />Torneios</span><span className="rounded-xl bg-panel/80 p-2">📡<br />Lives</span>
        </div>
      </div>
      <div className="mx-auto w-full max-w-xs space-y-3">
        <Link href={`/registar${q}`} className="btn w-full !py-3 text-base">Criar conta</Link>
        <Link href={`/entrar${q}`} className="btn-ghost w-full !py-3 text-base">Iniciar sessão</Link>
        <Link href="/recuperar" className="block text-center text-xs text-white/60 underline">Esqueci a palavra-passe</Link>
        <Link href="/baixar" className="block text-center text-xs text-neon2">⬇️ Baixar o app</Link>
        <p className="pt-2 text-center text-[11px] text-white/40">13+ · <Link href="/termos" className="underline">Termos</Link> · <Link href="/privacidade" className="underline">Privacidade</Link> · <Link href="/seguranca-infantil" className="underline">Segurança infantil</Link></p>
      </div>
    </main>
  );
}
