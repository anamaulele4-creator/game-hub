'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MIN_AGE } from '@/lib/config';
import { usePathname, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { isPublic } from '@/lib/routes';
import { BrandLogo } from './ui';

export function Splash() {
  return (
    <div className="relative flex min-h-[85vh] flex-col items-center justify-center gap-3">
      <div className="hero-bg hero-strong" aria-hidden />
      <BrandLogo width={200} />
      <div role="status" aria-label="A carregar" className="skeleton h-1.5 w-28 rounded-full" />
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
  // Contas criadas com o Google não trazem data de nascimento: pede-a antes de continuar (idade mínima)
  if (s.account.loggedIn && !s.account.birth) return <BirthGate />;
  return <>{children}</>;
}

function BirthGate() {
  const { s, set, toast } = useStore();
  const [birth, setBirth] = useState('');
  const [terms, setTerms] = useState(s.consent.done);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [blocked, setBlocked] = useState(false);
  if (blocked) return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-4xl">🙅</p><p className="text-lg font-semibold">Ainda não podes usar o TXAPILOG</p>
      <p className="text-sm text-white/70">É preciso ter pelo menos {MIN_AGE} anos. A sessão foi terminada.</p>
      <Link href="/bem-vindo" className="btn-ghost">Voltar</Link>
    </main>
  );
  return (
    <main className="mx-auto max-w-sm p-6 pt-12">
      <div className="card space-y-4">
        <p className="text-lg font-semibold">Só falta um passo 👋</p>
        <p className="text-sm text-white/70">Indica a tua data de nascimento. O TXAPILOG é para maiores de {MIN_AGE} anos e usamos isto para proteger contas de menores. Não aparece no teu perfil.</p>
        <input type="date" className="input w-full" value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} />
        <label className="flex gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-neon" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>Aceito os <Link href="/termos" className="text-neon2 underline">Termos</Link>, as <Link href="/diretrizes" className="text-neon2 underline">Diretrizes</Link> e a <Link href="/privacidade" className="text-neon2 underline">Política de Privacidade</Link>.</span></label>
        {err && <p className="text-sm text-pink">{err}</p>}
        <button className="btn w-full" disabled={!birth || !terms || busy} onClick={async () => {
          setErr(''); setBusy(true);
          const m = await import('@/lib/auth');
          const r = await m.saveBirthDate(birth).catch(() => ({ ok: false, error: 'Sem ligação. Tenta outra vez.' }));
          setBusy(false);
          if (!r.ok) { if (!m.meetsAgeGate(birth)) { setBlocked(true); set((p) => ({ ...p, account: { ...p.account, loggedIn: false } })); return; } setErr(r.error || 'Erro.'); return; }
          set((p) => ({ ...p, account: { ...p.account, birth }, consent: { ...p.consent, done: true, date: new Date().toISOString(), terms: true, privacy: true } }));
          toast('Conta pronta ✅');
        }}>{busy ? 'A guardar…' : 'Continuar'}</button>
      </div>
    </main>
  );
}
