'use client';

import { IS_DEMO } from '@/lib/config';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signInPassword } from '@/lib/auth';
import { withSoftTimeout } from '@/lib/sessionCache';
import { useStore } from '@/lib/store';
import { BrandMark } from '@/components/ui';
import { Err, checkContact } from '@/components/AuthBits';

/** Fator 2FA por confirmar depois do login (no máximo 6 s à espera; depois usa o que o login devolveu). */
async function mfaAfterLogin(fromLogin: string | null): Promise<string | null> {
  try {
    const r = await withSoftTimeout((await import('@/lib/security')).needsMfa(), 6000);
    return r.timedOut ? fromLogin : r.value;
  } catch { return fromLogin; }
}

export default function Entrar() {
  const { set, toast } = useStore();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    const e = (new URLSearchParams(window.location.search).get('email') || '').trim();
    if (e.includes('@')) setEmail(e);
  }, []);

  const done = (id: string) => {
    set((p) => ({ ...p, account: { ...p.account, loggedIn: true, method: 'email', email: id } }));
    toast('Sessão iniciada');
    router.push(new URLSearchParams(window.location.search).get('next') || '/');
  };

  const submit = async () => {
    setErr('');
    const c = checkContact('email', email);
    if (!c.id) return setErr(c.error!);
    if (!pw) return setErr('Escreve a palavra-passe.');
    setBusy(true);
    try {
      const r = await signInPassword('email', c.id, pw);
      if (!r.ok) {
        if (/confirma primeiro/i.test(r.error ?? '')) { router.push(`/confirmar?id=${encodeURIComponent(c.id)}&ch=email`); return; }
        return setErr(r.error!);
      }
      // 2FA: pergunta ao supabase-js, mas nunca fica à espera para sempre — o próprio login já diz se há fator verificado.
      const f = await mfaAfterLogin(r.mfaFactor ?? null);
      if (f) { setMfa(f); return; }
      done(c.id);
    } catch (e) {
      setErr('Não foi possível concluir a entrada: ' + String((e as Error)?.message || e) + '. Tenta de novo.');
    } finally { setBusy(false); }
  };

  const field = 'h-14 w-full rounded-xl border border-[rgba(148,170,235,.26)] bg-[#0D1738] px-4 text-[16px] text-white outline-none placeholder:text-white/40 focus:border-[#FFC20E] focus:shadow-[0_0_0_3px_rgba(255,194,14,.18)]';
  const primary = 'h-14 w-full rounded-xl bg-gradient-to-b from-[#FFD23F] to-[#FFC20E] text-[17px] font-bold text-[#0B1B4D] disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#0A1230] text-white [background-image:radial-gradient(1200px_520px_at_50%_-180px,rgba(43,79,184,.45),transparent_70%)]">
      <header className="flex h-16 items-center justify-between border-b border-[rgba(148,170,235,.14)] bg-[#0D1738] px-4 sm:px-6">
        <Link href="/" aria-label="TxapZone — Início"><BrandMark height={32} /></Link>
        <Link href="/registar/" className="flex h-11 items-center rounded-xl bg-gradient-to-b from-[#FFD23F] to-[#FFC20E] px-5 text-[15px] font-bold text-[#0B1B4D]">Criar Conta</Link>
      </header>

      <main className="mx-auto flex w-full max-w-[480px] flex-col px-4 pb-10 pt-8 sm:pt-14">
        <div className="rounded-2xl border border-[rgba(148,170,235,.14)] bg-[#111D47] p-5 shadow-[0_8px_24px_-8px_rgba(2,6,23,.6)] sm:p-8">
          <h1 className="text-center font-display text-[30px] font-bold leading-tight sm:text-[34px]">Entra na tua conta</h1>
          <p className="mt-1 text-center text-[14px] text-white/65">Bem-vindo de volta</p>

          {mfa ? (
            <div className="mt-6 space-y-4">
              <p className="text-center text-sm text-white/80">Verificação em 2 passos: escreve o código da tua app autenticadora.</p>
              <input className={`${field} text-center font-mono text-2xl tracking-[0.5em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))} />
              <Err msg={err} />
              <button type="button" className={primary} disabled={busy || mfaCode.length !== 6}
                onClick={async () => { setBusy(true); setErr(''); try { const r = await (await import('@/lib/security')).verifyTotp(mfa, mfaCode); if (r.ok) done(email.trim()); else setErr(r.error!); } catch (e) { setErr('Não foi possível confirmar o código: ' + String((e as Error)?.message || e)); } finally { setBusy(false); } }}>
                Confirmar
              </button>
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <label className="block text-[13px] font-semibold text-white/80">Email
                <input className={`${field} mt-1.5`} type="email" autoComplete="email" inputMode="email" placeholder="o.teu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block text-[13px] font-semibold text-white/80">Palavra-passe
                <div className="relative mt-1.5">
                  <input className={`${field} pr-24`} type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Palavra-passe" value={pw} onChange={(e) => setPw(e.target.value)} />
                  <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 h-10 -translate-y-1/2 rounded-lg px-3 text-[13px] font-semibold text-white/70 hover:text-white">{show ? 'Ocultar' : 'Mostrar'}</button>
                </div>
              </label>
              <Err msg={err} />
              <button type="submit" disabled={busy} className={primary}>{busy ? 'Aguarda…' : 'Entrar'}</button>
              <div className="flex flex-col items-center gap-2 pt-1 text-[14px]">
                <Link href="/recuperar/" className="text-white/70 underline">Esqueci a palavra-passe</Link>
                <p className="text-white/70">Ainda não tens conta? <Link href="/registar/" className="font-semibold text-[#FFD65C]">Criar conta</Link></p>
              </div>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-[12px] text-white/50">
          18+ · <Link href="/termos/" className="underline">Termos</Link> · <Link href="/privacidade/" className="underline">Privacidade</Link>
        </p>
      </main>
    </div>
  );
}