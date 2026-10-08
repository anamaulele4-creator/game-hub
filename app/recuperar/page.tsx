'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Channel, sendOtp, sendRecoveryLink, updatePassword, verifyOtp } from '@/lib/auth';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';
import { ChannelTabs, ContactInput, DemoCode, Err, OtpInput, checkContact } from '@/components/AuthBits';

export default function Recuperar() {
  const { toast } = useStore();
  const [ch, setCh] = useState<Channel>('email');
  const [how, setHow] = useState<'link' | 'otp'>('otp');
  const [contact, setContact] = useState('');
  const [step, setStep] = useState<'pedir' | 'codigo' | 'link' | 'nova' | 'feito'>('pedir');
  const [sent, setSent] = useState<{ id: string; code?: string } | null>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Modo real: ao abrir o link de recuperação do email, o Supabase cria uma sessão de recuperação.
  useEffect(() => {
    if (IS_DEMO) return;
    let off: (() => void) | undefined;
    void import('@/lib/supabase').then(({ sb }) => sb()).then((c) => {
      const { data } = c.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') setStep('nova'); });
      off = () => data.subscription.unsubscribe();
      if (window.location.hash.includes('type=recovery')) setStep('nova');
    });
    return () => off?.();
  }, []);

  const send = async () => {
    setErr('');
    const c = checkContact(ch, contact);
    if (!c.id) return setErr(c.error!);
    setBusy(true);
    const r = ch === 'email' && how === 'link' ? await sendRecoveryLink(c.id) : await sendOtp(ch, c.id);
    setBusy(false);
    if (!r.ok) return setErr(r.error!);
    setSent({ id: c.id, code: r.demoCode });
    setStep(ch === 'email' && how === 'link' ? 'link' : 'codigo');
  };

  return (
    <Page title="Esqueci a palavra-passe" back="/entrar">
      <div className="hero-bg hero-strong" aria-hidden />
      {step === 'pedir' && (
        <div className="card space-y-3">
          <p className="text-sm text-white/70">Escolhe como queres recuperar o acesso.</p>
          <ChannelTabs value={ch} onChange={(x) => { setCh(x); setErr(''); }} />
          {ch === 'email' && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button onClick={() => setHow('otp')} className={`rounded-xl border p-2 ${how === 'otp' ? 'border-neon bg-neon/20' : 'border-line'}`}>🔢 Código por email</button>
              <button onClick={() => setHow('link')} className={`rounded-xl border p-2 ${how === 'link' ? 'border-neon bg-neon/20' : 'border-line'}`}>🔗 Link por email</button>
            </div>
          )}
          <ContactInput channel={ch} value={contact} onChange={setContact} />
          <Err msg={err} />
          <button className="btn w-full" disabled={busy} onClick={send}>{busy ? 'A enviar…' : ch === 'phone' ? 'Enviar código por SMS' : how === 'link' ? 'Enviar link' : 'Enviar código'}</button>
        </div>
      )}
      {step === 'link' && sent && (
        <div className="card space-y-3 text-sm">
          <p>Se existir uma conta com <b>{sent.id}</b>, enviámos um link para definires nova palavra-passe. Abre-o neste dispositivo.</p>
          {IS_DEMO && <><p className="text-xs text-amber-200">Demo: nenhum email foi enviado. Simula o clique no link:</p><button className="btn w-full" onClick={() => setStep('nova')}>Abrir link (simulado)</button></>}
        </div>
      )}
      {step === 'codigo' && sent && (
        <div className="card space-y-3">
          <p className="text-sm">Introduz o código enviado para <b>{sent.id}</b>.</p>
          <DemoCode code={sent.code} />
          <OtpInput busy={busy} onSubmit={async (code) => { setBusy(true); const r = await verifyOtp(ch, sent.id, code, 'recovery'); setBusy(false); if (r.ok) setStep('nova'); else setErr(r.error!); }} />
          <Err msg={err} />
        </div>
      )}
      {step === 'nova' && (
        <div className="card space-y-3">
          <p className="font-semibold">Nova palavra-passe</p>
          <input className="input w-full" type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Err msg={err} />
          <button className="btn w-full" disabled={pw.length < 8} onClick={async () => { const r = await updatePassword(pw); if (r.ok) { setStep('feito'); toast('Palavra-passe alterada'); } else setErr(r.error!); }}>Guardar</button>
        </div>
      )}
      {step === 'feito' && (
        <div className="card space-y-3 text-center"><p className="text-4xl">🔐</p><p>Conta recuperada.</p><Link href="/" className="btn w-full">Ir para o início</Link></div>
      )}
    </Page>
  );
}
