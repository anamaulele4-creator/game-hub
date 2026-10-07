'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Page } from '@/components/ui';
import { DemoCode, Err, OtpInput } from '@/components/AuthBits';
import { resendConfirmation, verifyOtp, Channel } from '@/lib/auth';
import { useStore } from '@/lib/store';

function Confirmar() {
  const p = useSearchParams();
  const router = useRouter();
  const { s, ready, toast } = useStore();
  const id = p.get('id') ?? '';
  const ch = (p.get('ch') === 'phone' ? 'phone' : 'email') as Channel;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(60);
  const [code, setCode] = useState<string | undefined>(p.get('demo') ?? undefined);

  useEffect(() => { const t = setInterval(() => setWait((w) => (w > 0 ? w - 1 : 0)), 1000); return () => clearInterval(t); }, []);
  // Ao clicar no link do email, o Supabase inicia sessão automaticamente → entra.
  useEffect(() => { if (ready && s.account.loggedIn) router.replace('/'); }, [ready, s.account.loggedIn, router]);

  return (
    <Page title="Confirme a sua conta" back="/bem-vindo">
      <div className="hero-bg hero-strong" aria-hidden />
      <div className="card mt-4 space-y-3 text-center">
        <p className="text-5xl">{ch === 'email' ? '📧' : '📱'}</p>
        <p className="font-semibold">Falta só confirmar a tua conta</p>
        <p className="text-sm text-white/70">{ch === 'email' ? <>Enviámos um link e um código de 6 dígitos para <b>{id || 'o teu email'}</b>. Abre o email (vê também o spam) e toca no link, ou escreve o código.</> : <>Enviámos um código por SMS para <b>{id}</b>.</>}</p>
        <DemoCode code={code} />
        {id && <OtpInput busy={busy} onSubmit={async (c) => { setBusy(true); setErr(''); const r = await verifyOtp(ch, id, c, 'signup'); setBusy(false); if (r.ok) { toast('Conta confirmada ✅'); router.replace('/'); } else setErr(r.error!); }} />}
        <Err msg={err} />
        <button className="btn-ghost w-full" disabled={!id || wait > 0 || busy} onClick={async () => { setErr(''); const r = await resendConfirmation(ch, id); if (r.ok) { setWait(60); setCode(r.demoCode); toast('Reenviado'); } else setErr(r.error!); }}>{wait > 0 ? `Reenviar em ${wait}s` : 'Reenviar confirmação'}</button>
        <p className="text-[11px] text-white/50">Sem confirmação não é possível usar a app. <Link href="/entrar" className="text-neon2 underline">Já confirmei — iniciar sessão</Link></p>
      </div>
    </Page>
  );
}
export default function Page_() { return <Suspense fallback={null}><Confirmar /></Suspense>; }
