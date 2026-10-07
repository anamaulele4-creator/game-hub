'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Channel, sendOtp, signInPassword, verifyOtp } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { Logo, Page } from '@/components/ui';
import { ChannelTabs, ContactInput, DemoCode, Err, OtpInput, checkContact } from '@/components/AuthBits';
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

  const done = (id: string) => {
    set((p) => ({ ...p, account: { ...p.account, loggedIn: true, method: ch, ...(ch === 'email' ? { email: id } : { phone: id }) } }));
    toast('Sessão iniciada ✅');
    router.push('/');
  };

  const submit = async () => {
    setErr('');
    const c = checkContact(ch, contact);
    if (!c.id) return setErr(c.error!);
    setBusy(true);
    if (mode === 'password') {
      const r = await signInPassword(ch, c.id, pw);
      setBusy(false);
      return r.ok ? done(c.id) : setErr(r.error!);
    }
    const r = await sendOtp(ch, c.id);
    setBusy(false);
    if (!r.ok) return setErr(r.error!);
    setSent({ id: c.id, code: r.demoCode });
  };

  return (
    <Page title="Entrar" back="/perfil">
      <div className="hero-bg hero-strong" aria-hidden />
      <div className="mb-5 flex flex-col items-center gap-2"><Logo size={56} /><p className="text-sm text-white/60">Entra com email ou número de telemóvel</p></div>
      {!sent ? (
        <div className="card space-y-3">
          <ChannelTabs value={ch} onChange={(c) => { setCh(c); setErr(''); }} />
          <ContactInput channel={ch} value={contact} onChange={setContact} />
          {mode === 'password' && <input className="input w-full" type="password" autoComplete="current-password" placeholder="Palavra-passe" value={pw} onChange={(e) => setPw(e.target.value)} />}
          <Err msg={err} />
          <button className="btn w-full" disabled={busy} onClick={submit}>{busy ? 'Aguarda…' : mode === 'password' ? 'Entrar' : ch === 'email' ? 'Enviar código por email' : 'Enviar código por SMS'}</button>
          <button className="w-full text-xs text-neon2" onClick={() => setMode(mode === 'password' ? 'otp' : 'password')}>{mode === 'password' ? 'Entrar sem palavra-passe (código de 6 dígitos)' : 'Usar palavra-passe'}</button>
          <div className="flex justify-between text-xs"><Link href="/recuperar" className="text-white/60 underline">Esqueci-me / recuperar conta</Link><Link href="/registar" className="text-neon2">Criar conta ›</Link></div>
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
