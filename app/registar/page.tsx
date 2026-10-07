'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Channel, ageFrom, meetsAgeGate, signUpEmail, signUpPhone, verifyOtp } from '@/lib/auth';
import { IS_DEMO, MIN_AGE, PROVINCES } from '@/lib/config';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';
import { ChannelTabs, ContactInput, DemoCode, Err, OtpInput, checkContact } from '@/components/AuthBits';
import { LegalFooter } from '@/components/LegalFooter';

type Step = 'idade' | 'dados' | 'consentimento' | 'codigo' | 'bloqueado';

export default function Registar() {
  const { s, set, toast } = useStore();
  const router = useRouter();
  const [step, setStep] = useState<Step>('idade');
  const [birth, setBirth] = useState('');
  const [ch, setCh] = useState<Channel>('email');
  const [f, setF] = useState({ name: '', handle: '', contact: '', pw: '', province: 'Maputo Cidade' });
  const [c, setC] = useState({ terms: false, privacy: false, personalizedAds: false, analytics: false, marketing: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ id: string; code?: string } | null>(null);
  const minor = birth ? ageFrom(birth) < 18 : false;

  if (!s.admin.settings.signupsOpen) return <Page title="Criar conta" back="/entrar"><p className="card text-center text-sm">Os registos estão temporariamente fechados. Tenta mais tarde.</p></Page>;

  const steps: Step[] = ['idade', 'dados', 'consentimento', 'codigo'];
  const idx = steps.indexOf(step);

  const createAccount = async () => {
    setErr('');
    const cc = checkContact(ch, f.contact);
    if (!cc.id) { setStep('dados'); return setErr(cc.error!); }
    setBusy(true);
    const meta = { name: f.name, handle: f.handle.replace(/^@/, '').toLowerCase(), birth, province: f.province, consent: { ...c, personalizedAds: minor ? false : c.personalizedAds, at: new Date().toISOString() } };
    const r = ch === 'email' ? await signUpEmail(cc.id, f.pw, meta) : await signUpPhone(cc.id, f.pw, meta);
    setBusy(false);
    if (!r.ok) return setErr(r.error!);
    if (r.session) { finish(cc.id); return; }
    // Confirmação obrigatória antes de usar a app
    set((p) => ({ ...p, consent: { done: true, date: new Date().toISOString(), terms: true, privacy: true, personalizedAds: minor ? false : c.personalizedAds, analytics: c.analytics } }));
    router.push(`/confirmar?id=${encodeURIComponent(cc.id)}&ch=${ch}${r.demoCode ? `&demo=${r.demoCode}` : ''}`);
  };

  const finish = (id: string) => {
    set((p) => ({
      ...p,
      account: { ...p.account, loggedIn: true, method: ch, birth, province: f.province, ...(ch === 'email' ? { email: id } : { phone: id }) },
      consent: { done: true, date: new Date().toISOString(), terms: true, privacy: true, personalizedAds: minor ? false : c.personalizedAds, analytics: c.analytics },
    }));
    toast('Conta criada 🎉 Bem-vindo ao GAME HUB');
    router.push('/');
  };

  return (
    <Page title="Criar conta" back="/bem-vindo">
      <div className="hero-bg hero-strong" aria-hidden />
      {step !== 'bloqueado' && <div className="mb-4 flex gap-1">{steps.map((x, i) => <div key={x} className={`h-1 flex-1 rounded ${i <= idx ? 'bg-neon' : 'bg-panel2'}`} />)}</div>}

      {step === 'idade' && (
        <div className="card space-y-3">
          <p className="font-semibold">Qual é a tua data de nascimento?</p>
          <p className="text-xs text-white/60">O GAME HUB é para maiores de {MIN_AGE} anos. Usamos isto para proteger contas de menores. Não aparece no teu perfil.</p>
          <input type="date" className="input w-full" value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} />
          <button className="btn w-full" disabled={!birth} onClick={() => (meetsAgeGate(birth) ? setStep('dados') : setStep('bloqueado'))}>Continuar</button>
        </div>
      )}

      {step === 'bloqueado' && (
        <div className="card space-y-3 text-center">
          <p className="text-4xl">🙅</p>
          <p className="font-semibold">Ainda não podes criar conta</p>
          <p className="text-sm text-white/70">O GAME HUB exige pelo menos {MIN_AGE} anos. Volta quando tiveres idade. Por segurança, não guardámos a data indicada.</p>
          <Link href="/" className="btn-ghost w-full">Voltar ao início</Link>
        </div>
      )}

      {step === 'dados' && (
        <div className="card space-y-3">
          <ChannelTabs value={ch} onChange={(x) => { setCh(x); setErr(''); }} />
          <input className="input w-full" placeholder="Nome" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input w-full" placeholder="Nome de utilizador (ex.: @nyxff)" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value.replace(/\s/g, '') })} />
          <ContactInput channel={ch} value={f.contact} onChange={(v) => setF({ ...f, contact: v })} />
          <input className="input w-full" type="password" autoComplete="new-password" placeholder="Palavra-passe (mín. 8)" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />
          <select className="input w-full" value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}>{PROVINCES.map((p) => <option key={p}>{p}</option>)}</select>
          {ch === 'phone' && <p className="text-[11px] text-white/50">Vais receber um SMS com um código.{IS_DEMO ? ' (Demo: o código aparece no ecrã.)' : ''}</p>}
          <Err msg={err} />
          <button className="btn w-full" onClick={() => {
            setErr('');
            if (!f.name.trim() || !f.handle.trim()) return setErr('Indica nome e nome de utilizador.');
            if (!/^[a-z0-9_.]{3,24}$/.test(f.handle.replace(/^@/, '').toLowerCase())) return setErr('Nome de utilizador: 3–24 letras minúsculas, números, _ ou .');
            const cc = checkContact(ch, f.contact); if (!cc.id) return setErr(cc.error!);
            if (f.pw.length < 8) return setErr('A palavra-passe precisa de pelo menos 8 caracteres.');
            setStep('consentimento');
          }}>Continuar</button>
        </div>
      )}

      {step === 'consentimento' && (
        <div className="card space-y-2 text-sm">
          <p className="font-semibold">Privacidade e consentimento</p>
          {minor && <p className="rounded-lg bg-neon2/15 p-2 text-[11px] text-neon2">Conta de menor (13–17): anúncios personalizados desativados, mensagens só de quem segues e compras exigem autorização do encarregado de educação.</p>}
          {([
            ['terms', <>Aceito os <Link className="text-neon2 underline" href="/termos">Termos de Uso</Link> e as <Link className="text-neon2 underline" href="/diretrizes">Diretrizes da Comunidade</Link> (obrigatório)</>],
            ['privacy', <>Li a <Link className="text-neon2 underline" href="/privacidade">Política de Privacidade</Link> (obrigatório)</>],
            ['personalizedAds', <>Anúncios personalizados (opcional) · <Link className="underline" href="/cookies">saber mais</Link></>],
            ['analytics', <>Estatísticas anónimas para melhorar a app (opcional)</>],
            ['marketing', <>Novidades e promoções por email/SMS (opcional)</>],
          ] as const).map(([k, label]) => (
            <label key={k} className={`flex gap-3 rounded-xl bg-panel2 p-3 ${k === 'personalizedAds' && minor ? 'opacity-40' : ''}`}>
              <input type="checkbox" className="mt-1 h-4 w-4 accent-fuchsia-500" disabled={k === 'personalizedAds' && minor} checked={c[k]} onChange={() => setC({ ...c, [k]: !c[k] })} />
              <span>{label}</span>
            </label>
          ))}
          <Err msg={err} />
          <button className="btn w-full" disabled={!c.terms || !c.privacy || busy} onClick={createAccount}>{busy ? 'A criar…' : 'Criar conta e receber código'}</button>
        </div>
      )}

      {step === 'codigo' && sent && (
        <div className="card space-y-3">
          <p className="text-sm">Confirma a tua conta com o código de 6 dígitos enviado para <b>{sent.id}</b>{ch === 'email' ? ' (ou toca no link do email)' : ''}. Vê também a pasta de spam.</p>
          <DemoCode code={sent.code} />
          <OtpInput busy={busy} onSubmit={async (code) => {
            setBusy(true);
            const r = await verifyOtp(ch, sent.id, code, 'signup');
            setBusy(false);
            if (!r.ok) return setErr(r.error!);
            finish(sent.id);
          }} />
          <Err msg={err} />
        </div>
      )}
      <p className="mt-4 text-center text-xs text-white/60">Já tens conta? <Link href="/entrar" className="text-neon2">Entrar</Link></p>
      <LegalFooter />
    </Page>
  );
}
