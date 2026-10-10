'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Channel, sendOtp, signInPassword, verifyOtp } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { BrandLogo, Page } from '@/components/ui';
import { ChannelTabs, ContactInput, DemoCode, Err, GoogleButton, MoreOptions, OtpInput, checkContact } from '@/components/AuthBits';
import { LegalFooter } from '@/components/LegalFooter';

export default function Entrar() {
  const { set, toast } = useStore();
  const router = useRouter();
  const [ch, setCh] = useState<Channel>('email');
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [contact, setContact] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ id: string; code?: string } | null>(null);
  const [mfa, setMfa] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [pre, setPre] = useState<{ id: string; google: boolean } | null>(null);

  // Vindo de "Mudar de conta": ?email=…&via=google preenche o contacto
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = (q.get('email') || '').trim();
    if (!e) return;
    const google = q.get('via') === 'google';
    if (e.includes('@')) setCh('email'); else setCh('phone');
    setContact(e);
    setPre({ id: e, google });
  }, []);

  const done = (id: string) => {
    set((p) => ({ ...p, account: { ...p.account, loggedIn: true, method: ch, ...(ch === 'email' ? { email: id } : { phone: id }) } }));
    toast('Sessão iniciada ✅');
    router.push(new URLSearchParams(window.location.search).get('next') || '/');
  };

  const submit = async () => {
    setErr('');
    const c = checkContact(ch, contact);
    if (!c.id) return setErr(c.error!);
    setBusy(true);
    if (mode === 'password') {
      const r = await signInPassword(ch, c.id, pw);
      setBusy(false);
      if (!r.ok) { if (/confirma primeiro/i.test(r.error ?? '')) { router.push(`/confirmar?id=${encodeURIComponent(c.id)}&ch=${ch}`); return; } return setErr(r.error!); }
      const f = await (await import('@/lib/security')).needsMfa();
      if (f) { setMfa(f); return; }
      return done(c.id);
    }
    const r = await sendOtp(ch, c.id);
    setBusy(false);
    if (!r.ok) return setErr(r.error!);
    setSent({ id: c.id, code: r.demoCode });
  };

  return (
    <Page title="Iniciar sessão" back="/bem-vindo">
      <div className="hero-bg hero-strong" aria-hidden />
      <div className="mb-5 flex flex-col items-center gap-2"><BrandLogo width={170} /><p className="text-base text-white/80">Bem-vindo de volta</p></div>
      {mfa ? (
        <div className="card space-y-3">
          <p className="text-sm">🔐 Verificação em 2 passos: escreve o código da tua app autenticadora.</p>
          <input className="input w-full text-center font-mono text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))} />
          <Err msg={err} />
          <button className="btn w-full" disabled={busy || mfaCode.length !== 6} onClick={async () => { setBusy(true); const r = await (await import('@/lib/security')).verifyTotp(mfa, mfaCode); setBusy(false); if (r.ok) done(contact.trim()); else setErr(r.error!); }}>Confirmar</button>
        </div>
      ) : !sent ? (
        <div className="card">
        {pre && <p className="mb-3 rounded-xl bg-panel2 p-3 text-center text-sm text-white/75">Entra de novo como <b className="text-white">{pre.id}</b> para continuar.</p>}
        <GoogleButton hint={pre?.google ? pre.id : undefined} />
        <MoreOptions key={pre ? 'pre' : 'none'} defaultOpen={!!err || (!!pre && !pre.google)}>
        <div className="space-y-3">
          <ChannelTabs value={ch} onChange={(c) => { setCh(c); setErr(''); }} />
          <ContactInput channel={ch} value={contact} onChange={setContact} />
          {mode === 'password' && <input className="input w-full" type="password" autoComplete="current-password" placeholder="Palavra-passe" value={pw} onChange={(e) => setPw(e.target.value)} />}
          <Err msg={err} />
          <button className="btn w-full" disabled={busy} onClick={submit}>{busy ? 'Aguarda…' : mode === 'password' ? 'Entrar' : ch === 'email' ? 'Enviar código por email' : 'Enviar código por SMS'}</button>
          <button className="w-full text-xs text-neon2" onClick={() => setMode(mode === 'password' ? 'otp' : 'password')}>{mode === 'password' ? 'Entrar sem palavra-passe (código de 6 dígitos)' : 'Usar palavra-passe'}</button>
          <div className="flex justify-between text-xs"><Link href="/recuperar" className="text-white/60 underline">Esqueci a palavra-passe</Link><Link href="/registar" className="text-neon2">Criar conta ›</Link></div>
        </div>
        </MoreOptions>
        </div>
      ) : (
        <div className="card space-y-3">
          <p className="text-sm">Enviámos um código para <b>{sent.id}</b>.</p>
          <DemoCode code={sent.code} />
          <OtpInput busy={busy} onSubmit={async (code) => { setBusy(true); const r = await verifyOtp(ch, sent.id, code, 'login'); setBusy(false); if (r.ok) done(sent.id); else setErr(r.error!); }} />
          <Err msg={err} />
          <button className="w-full text-xs text-white/60" onClick={() => setSent(null)}>‹ Alterar contacto</button>
        </div>
      )}
      <LegalFooter />
    </Page>
  );
}
