'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ageFrom, meetsAgeGate, signUpEmail } from '@/lib/auth';
import { MIN_AGE, PROVINCES } from '@/lib/config';
import { useStore } from '@/lib/store';
import { BrandMark } from '@/components/ui';
import { Err, checkContact } from '@/components/AuthBits';
import { normalizeCode, refFromSearch, validCode } from '@/lib/affiliates';
import { affApi } from '@/lib/affiliatesApi';

type Step = 'dados' | 'consentimento' | 'bloqueado';

export default function Registar() {
  const { s, set, toast } = useStore();
  const router = useRouter();
  const [step, setStep] = useState<Step>('dados');
  const [birth, setBirth] = useState('');
  const [f, setF] = useState({ name: '', handle: '', email: '', pw: '', province: 'Maputo Cidade' });
  const [show, setShow] = useState(false);
  const [c, setC] = useState({ terms: false, privacy: false, personalizedAds: false, analytics: false, marketing: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Código de afiliado: vem do link (?ref=CODIGO) ou é escrito à mão. Opcional; fica associado uma única vez.
  const [ref, setRef] = useState('');
  useEffect(() => { const r = refFromSearch(window.location.search); if (r) { setRef(r); affApi.rememberRef(r); } }, []);
  const minor = birth ? ageFrom(birth) < 18 : false;

  const field = 'h-14 w-full rounded-xl border border-[rgba(148,170,235,.26)] bg-[#0D1738] px-4 text-[16px] text-white outline-none placeholder:text-white/40 focus:border-[#FFC20E] focus:shadow-[0_0_0_3px_rgba(255,194,14,.18)]';
  const label = 'block text-[13px] font-semibold text-white/80';
  const primary = 'h-14 w-full rounded-xl bg-gradient-to-b from-[#FFD23F] to-[#FFC20E] text-[17px] font-bold text-[#0B1B4D] disabled:opacity-50';

  const next = () => {
    setErr('');
    if (!f.name.trim() || !f.handle.trim()) return setErr('Indica nome e nome de utilizador.');
    if (!/^[a-z0-9_.]{3,24}$/.test(f.handle.replace(/^@/, '').toLowerCase())) return setErr('Nome de utilizador: 3–24 letras minúsculas, números, _ ou .');
    const cc = checkContact('email', f.email);
    if (!cc.id) return setErr(cc.error!);
    if (f.pw.length < 8) return setErr('A palavra-passe precisa de pelo menos 8 caracteres.');
    if (ref.trim() && !validCode(ref)) return setErr('Código de afiliado inválido (4 a 16 letras e números).');
    if (!birth) return setErr('Indica a tua data de nascimento.');
    if (!meetsAgeGate(birth)) { setBirth(''); setStep('bloqueado'); return; }
    setStep('consentimento');
  };

  const finish = (id: string) => {
    set((p) => ({
      ...p,
      account: { ...p.account, loggedIn: true, method: 'email', birth, province: f.province, email: id },
      consent: { done: true, date: new Date().toISOString(), terms: true, privacy: true, personalizedAds: minor ? false : c.personalizedAds, analytics: c.analytics },
    }));
    toast('Conta criada. Bem-vindo à TxapZone');
    router.push('/');
  };

  const createAccount = async () => {
    setErr('');
    const cc = checkContact('email', f.email);
    if (!cc.id) { setStep('dados'); return setErr(cc.error!); }
    setBusy(true);
    const code = ref.trim() ? normalizeCode(ref) : '';
    if (code) affApi.rememberRef(code);
    const meta = { ...(code ? { ref: code } : {}), name: f.name, handle: f.handle.replace(/^@/, '').toLowerCase(), birth, province: f.province, consent: { ...c, personalizedAds: minor ? false : c.personalizedAds, at: new Date().toISOString() } };
    const r = await signUpEmail(cc.id, f.pw, meta);
    setBusy(false);
    if (!r.ok) return setErr(r.error!);
    if (r.session) { finish(cc.id); return; }
    set((p) => ({ ...p, consent: { done: true, date: new Date().toISOString(), terms: true, privacy: true, personalizedAds: minor ? false : c.personalizedAds, analytics: c.analytics } }));
    router.push(`/confirmar?id=${encodeURIComponent(cc.id)}&ch=email${r.demoCode ? `&demo=${r.demoCode}` : ''}`);
  };

  const checks = [
    ['terms', <>Aceito os <Link className="underline" href="/termos/">Termos de Uso</Link> e as <Link className="underline" href="/diretrizes/">Diretrizes da Comunidade</Link> (obrigatório)</>],
    ['privacy', <>Li a <Link className="underline" href="/privacidade/">Política de Privacidade</Link> (obrigatório)</>],
    ['personalizedAds', <>Anúncios personalizados (opcional)</>],
    ['analytics', <>Estatísticas anónimas para melhorar a app (opcional)</>],
    ['marketing', <>Novidades e promoções por email (opcional)</>],
  ] as const;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#0A1230] text-white [background-image:radial-gradient(1200px_520px_at_50%_-180px,rgba(43,79,184,.45),transparent_70%)]">
      <header className="flex h-16 items-center justify-between border-b border-[rgba(148,170,235,.14)] bg-[#0D1738] px-4 sm:px-6">
        <Link href="/" aria-label="TxapZone — Início"><BrandMark height={32} /></Link>
        <Link href="/entrar/" className="flex h-11 items-center rounded-xl bg-[#1A2A5E] px-5 text-[15px] font-bold">Entrar</Link>
      </header>

      <main className="mx-auto flex w-full max-w-[480px] flex-col px-4 pb-10 pt-8 sm:pt-14">
        <div className="rounded-2xl border border-[rgba(148,170,235,.14)] bg-[#111D47] p-5 shadow-[0_8px_24px_-8px_rgba(2,6,23,.6)] sm:p-8">
          {!s.admin.settings.signupsOpen ? (
            <p className="py-6 text-center text-sm text-white/80">Os registos estão temporariamente fechados. Tenta mais tarde.</p>
          ) : step === 'bloqueado' ? (
            <div className="space-y-4 py-2 text-center">
              <h1 className="font-display text-[26px] font-bold">Ainda não podes criar conta</h1>
              <p className="text-sm text-white/75">A TxapZone exige pelo menos {MIN_AGE} anos. Volta quando tiveres idade. Por segurança, não guardámos a data indicada.</p>
              <Link href="/" className="flex h-14 w-full items-center justify-center rounded-xl bg-[#1A2A5E] text-[16px] font-bold">Voltar ao início</Link>
            </div>
          ) : (
            <>
              <h1 className="text-center font-display text-[30px] font-bold leading-tight sm:text-[34px]">Cria a tua conta gratuita</h1>
              <div className="mt-5 flex gap-1" aria-hidden>
                {(['dados', 'consentimento'] as const).map((x, i) => (
                  <div key={x} className={`h-1 flex-1 rounded ${i <= (step === 'dados' ? 0 : 1) ? 'bg-[#FFC20E]' : 'bg-white/15'}`} />
                ))}
              </div>

              {step === 'dados' && (
                <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); next(); }}>
                  <label className={label}>Nome
                    <input className={`${field} mt-1.5`} autoComplete="name" placeholder="O teu nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                  </label>
                  <label className={label}>Nome de utilizador
                    <input className={`${field} mt-1.5`} placeholder="ex.: nyxff" autoCapitalize="none" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value.replace(/\s/g, '') })} />
                  </label>
                  <label className={label}>Email
                    <input className={`${field} mt-1.5`} type="email" autoComplete="email" inputMode="email" placeholder="o.teu@email.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                  </label>
                  <label className={label}>Palavra-passe
                    <div className="relative mt-1.5">
                      <input className={`${field} pr-24`} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Mínimo 8 caracteres" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />
                      <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 h-10 -translate-y-1/2 rounded-lg px-3 text-[13px] font-semibold text-white/70 hover:text-white">{show ? 'Ocultar' : 'Mostrar'}</button>
                    </div>
                  </label>
                  <label className={label}>Data de nascimento
                    <input type="date" className={`${field} mt-1.5 [color-scheme:dark]`} value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} />
                    <span className="mt-1 block text-[12px] font-normal text-white/50">Maiores de {MIN_AGE} anos. Não aparece no teu perfil.</span>
                  </label>
                  <label className={label}>Código de afiliado (opcional)
                    <input className={`${field} mt-1.5 uppercase`} placeholder="Ex.: NYXFF4K2" autoCapitalize="characters" maxLength={16} value={ref} onChange={(e) => setRef(e.target.value)} />
                    <span className="mt-1 block text-[12px] font-normal text-white/50">Se alguém te convidou, escreve o código ou usa o link que recebeste.</span>
                  </label>
                  <label className={label}>Província
                    <select className={`${field} mt-1.5 [color-scheme:dark]`} value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}>
                      {PROVINCES.map((p) => <option key={p} className="bg-[#111D47]">{p}</option>)}
                    </select>
                  </label>
                  <Err msg={err} />
                  <button type="submit" className={primary}>Continuar</button>
                </form>
              )}

              {step === 'consentimento' && (
                <div className="mt-6 space-y-3 text-[14px]">
                  <p className="font-semibold">Privacidade e consentimento</p>
                  {minor && <p className="rounded-xl bg-white/10 p-3 text-[12.5px]">Conta de menor (13–17): anúncios personalizados desativados, mensagens só de quem segues e compras exigem autorização do encarregado de educação.</p>}
                  {checks.map(([k, text]) => (
                    <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-xl bg-[#0D1738] p-3 ${k === 'personalizedAds' && minor ? 'opacity-40' : ''}`}>
                      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#FFC20E]" disabled={k === 'personalizedAds' && minor} checked={c[k]} onChange={() => setC({ ...c, [k]: !c[k] })} />
                      <span className="text-white/85">{text}</span>
                    </label>
                  ))}
                  <Err msg={err} />
                  <button type="button" className={primary} disabled={!c.terms || !c.privacy || busy} onClick={createAccount}>{busy ? 'A criar…' : 'Criar conta'}</button>
                  <button type="button" className="h-11 w-full text-[14px] text-white/70" onClick={() => { setErr(''); setStep('dados'); }}>‹ Voltar</button>
                </div>
              )}

              <p className="mt-6 text-center text-[14px] text-white/70">Já tens conta? <Link href="/entrar/" className="font-semibold text-[#FFD65C]">Entrar</Link></p>
            </>
          )}
        </div>
        <p className="mt-6 text-center text-[12px] text-white/50">
          18+ · <Link href="/termos/" className="underline">Termos</Link> · <Link href="/privacidade/" className="underline">Privacidade</Link>
        </p>
      </main>
    </div>
  );
}