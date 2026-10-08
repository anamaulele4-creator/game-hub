'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Page, Stat, Tabs } from '@/components/ui';
import { Bars, LineChart } from '@/components/Charts';
import { PinPrompt } from '@/components/PinPrompt';
import { useStore } from '@/lib/store';
import type { MonState } from '@/lib/monetization';
import type { SecStatus, WlEntry, KycLimit } from '@/lib/security';

const T = ['Painel', 'Programa', 'Membros', 'Levantar'] as const;
const mon = () => import('@/lib/monetization');
const sec = () => import('@/lib/security');
const MZN = (n: number) => `${n.toLocaleString('pt-PT', { maximumFractionDigits: 2 })} MZN`;
const SRC: Record<string, string> = { presente: '🎁 Presentes e doações', subscricao: '👑 Membros', anuncios: '📢 Partilha de anúncios', torneio: '🏆 Prémios de torneios', ajuste: '⚙️ Ajustes' };

export default function Monetizacao() {
  const { s, ready, toast } = useStore();
  const [tab, setTab] = useState<(typeof T)[number]>('Painel');
  const [m, setM] = useState<MonState | null | undefined>(undefined);
  const [secSt, setSecSt] = useState<SecStatus | null>(null);
  const [wl, setWl] = useState<WlEntry[]>([]);
  const [lims, setLims] = useState<KycLimit[]>([]);
  const [app, setApp] = useState({ category: 'Free Fire', pitch: '' });
  const [price, setPrice] = useState(99);
  const [wd, setWd] = useState({ wl: '', amount: 500 });
  const [pin, setPin] = useState(false);
  const [idem, setIdem] = useState(() => crypto.randomUUID?.() ?? String(Date.now()));
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([mon().then((x) => x.load()), sec().then((x) => x.status())]);
    setM(a); setSecSt(b);
    if (a) setPrice(a.subPrice);
    if (b) { const x = await sec(); const [w, l] = await Promise.all([x.whitelist(), x.kycLimits()]); setWl(w); setLims(l); if (w[0]) setWd((d) => ({ ...d, wl: d.wl || w[0].id })); }
  }, []);
  useEffect(() => { if (ready) void load(); }, [ready, s.account.loggedIn, load]);

  if (m === null) return <Page title="Monetização" back="/mais"><div className="card mt-6 space-y-3 text-center"><p className="text-4xl">💰</p><p className="text-sm">Entra na tua conta para ver o Programa de Criadores.</p><Link href="/entrar" className="btn w-full">Entrar</Link></div></Page>;
  if (!m) return <Page title="Monetização" back="/mais"><div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="card h-20 animate-pulse" />)}</div></Page>;

  const r = m.rules;
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10));
  const series = days.map((d) => ({ label: d.slice(8), value: m.earnings.filter((e) => e.at.slice(0, 10) === d).reduce((t, e) => t + e.net, 0) }));
  const bySrc = Object.keys(SRC).map((k) => ({ label: SRC[k], value: Math.round(m.earnings.filter((e) => e.source === k).reduce((t, e) => t + e.net, 0)) })).filter((x) => x.value > 0);
  const month = m.earnings.filter((e) => e.at.slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((t, e) => t + e.net, 0);
  const fPct = Math.min(100, (m.followers / r.minFollowers) * 100);
  const hPct = Math.min(100, (m.watchHours / r.minWatchHours) * 100);
  const lim = lims.find((l) => l.level === (secSt?.kycLevel ?? 0));
  const activeWl = wl.filter((w) => w.activeAfter <= new Date().toISOString());
  const locked = secSt?.withdrawalsLockedUntil && secSt.withdrawalsLockedUntil > new Date().toISOString();

  return (
    <Page title="Monetização" back="/mais">
      <Tabs tabs={T} value={tab} onChange={setTab} />

      {tab === 'Painel' && (m.approved ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Stat label="Saldo disponível" value={MZN(m.balance)} />
            <Stat label="Ganhos este mês" value={MZN(month)} />
            <Stat label="Membros ativos" value={m.members} />
            <Stat label="Seguidores" value={m.followers.toLocaleString('pt-PT')} />
          </div>
          <div className="card mb-3"><p className="mb-1 text-sm font-semibold">Ganhos líquidos (14 dias)</p><LineChart data={series} fmt={(v) => v.toFixed(0)} /></div>
          <div className="card mb-3"><p className="mb-2 text-sm font-semibold">Por fonte</p>{bySrc.length ? <Bars data={bySrc} fmt={(v) => MZN(v)} /> : <p className="text-xs text-white/50">Ainda sem ganhos.</p>}</div>
          <div className="card mb-3 space-y-1 text-xs">
            <p className="text-sm font-semibold">Movimentos</p>
            {m.earnings.slice(0, 12).map((e, i) => <div key={i} className="flex justify-between border-b border-line py-1 last:border-0"><span>{SRC[e.source]} · {new Date(e.at).toLocaleDateString('pt-PT')}</span><span className="text-lime">+{MZN(e.net)} <span className="text-white/40">(taxa {MZN(e.fee)})</span></span></div>)}
          </div>
          <button className="btn w-full" onClick={() => setTab('Levantar')}>💸 Levantar para M-Pesa / e-Mola</button>
        </>
      ) : <button className="card w-full text-center text-sm" onClick={() => setTab('Programa')}>Ainda não estás no Programa de Criadores. Ver requisitos ›</button>)}

      {tab === 'Programa' && (
        <div className="space-y-3">
          <div className="card space-y-2 text-sm">
            <p className="font-semibold">Como ganhas no Social POIPAK</p>
            <p>🎁 <b>Presentes e doações</b> em lives e clipes: recebes {r.giftCreatorPct}% (1 moeda = {MZN(r.coinValueMzn)}).</p>
            <p>👑 <b>Membros</b>: fãs pagam uma subscrição mensal; recebes {r.subCreatorPct}%.</p>
            <p>📢 <b>Anúncios</b>: {r.adsCreatorPct}% da receita diária de anúncios é dividida pelos criadores conforme as visualizações dos seus clipes.</p>
            <p>🏆 <b>Torneios</b>: prémios creditados no teu saldo (a plataforma retém {r.tournamentFeePct}% das inscrições pagas).</p>
            <p>💸 <b>Levantamentos</b> a partir de {MZN(r.minPayoutMzn)} para M-Pesa/e-Mola, protegidos por PIN, 2FA, lista branca e limites.</p>
          </div>
          <div className="card space-y-2 text-sm">
            <p className="font-semibold">Requisitos</p>
            <div><div className="flex justify-between text-xs"><span>Seguidores</span><span>{m.followers.toLocaleString('pt-PT')} / {r.minFollowers.toLocaleString('pt-PT')}</span></div><div className="mt-1 h-2 rounded bg-panel2"><div className="h-2 rounded bg-neon" style={{ width: `${fPct}%` }} /></div></div>
            <div><div className="flex justify-between text-xs"><span>Horas vistas (12 meses)</span><span>{m.watchHours} / {r.minWatchHours}</span></div><div className="mt-1 h-2 rounded bg-panel2"><div className="h-2 rounded bg-neon2" style={{ width: `${hPct}%` }} /></div></div>
            <p className="text-xs text-white/60">Idade mínima {r.minAge} anos · cumprir as Diretrizes da Comunidade · sem avisos graves nos últimos 90 dias.</p>
          </div>
          {m.approved ? <p className="card text-center text-sm text-lime">✅ Estás no Programa de Criadores.</p> : m.application?.status === 'pendente' ? <p className="card text-center text-sm text-amber-300">⏳ Candidatura em análise (enviada {new Date(m.application.at).toLocaleDateString('pt-PT')}).</p> : (
            <div className="card space-y-2">
              {m.application?.status === 'rejeitado' && <p className="text-xs text-pink">Última candidatura rejeitada: {m.application.note ?? 'requisitos em falta'}</p>}
              <select className="input w-full" value={app.category} onChange={(e) => setApp({ ...app, category: e.target.value })}>{['Free Fire', 'eFootball', 'PUBG Mobile', 'Call of Duty Mobile', 'Humor', 'Educação / Coaching', 'Outro'].map((c) => <option key={c}>{c}</option>)}</select>
              <textarea className="input min-h-20 w-full" maxLength={600} placeholder="Fala-nos do teu conteúdo (opcional)" value={app.pitch} onChange={(e) => setApp({ ...app, pitch: e.target.value })} />
              {err && <p className="text-xs text-pink">{err}</p>}
              <button className="btn w-full" onClick={async () => { setErr(''); const x = await (await mon()).apply(app.category, app.pitch); if (x.ok) { toast('Candidatura enviada 🎉'); void load(); } else setErr(x.error!); }}>Candidatar-me</button>
            </div>
          )}
        </div>
      )}

      {tab === 'Membros' && (m.approved ? (
        <div className="space-y-3">
          <div className="card space-y-2 text-sm">
            <p className="font-semibold">Subscrição de membros</p>
            <p className="text-xs text-white/60">Os fãs tocam em “Tornar-me membro” no teu perfil. Benefícios: emblema, chat exclusivo, clipes antecipados.</p>
            <label className="flex items-center gap-2 text-xs">Preço mensal <input type="number" min={25} max={5000} className="input w-24" value={price} onChange={(e) => setPrice(Number(e.target.value))} /> MZN · recebes {MZN(price * r.subCreatorPct / 100)}</label>
            {err && <p className="text-xs text-pink">{err}</p>}
            <button className="btn w-full" onClick={async () => { setErr(''); const x = await (await mon()).setSubPrice(price); if (x.ok) { toast('Preço guardado'); void load(); } else setErr(x.error!); }}>Guardar preço</button>
          </div>
          <div className="grid grid-cols-2 gap-2"><Stat label="Membros ativos" value={m.members} /><Stat label="Receita mensal estimada" value={MZN(m.members * price * r.subCreatorPct / 100)} /></div>
        </div>
      ) : <p className="card text-center text-sm text-white/60">Disponível depois de entrares no Programa de Criadores.</p>)}

      {tab === 'Levantar' && (
        <div className="space-y-3">
          <div className="card text-center"><p className="text-xs text-white/60">Saldo disponível</p><p className="text-3xl font-black text-neon2">{MZN(m.balance)}</p><p className="text-xs text-white/50">Limite diário (nível {secSt?.kycLevel ?? 0}): {MZN(lim?.withdraw ?? 0)} · mínimo {MZN(r.minPayoutMzn)}</p></div>
          {!secSt?.pinSet || activeWl.length === 0 || (lim?.withdraw ?? 0) === 0 || locked || secSt?.frozen ? (
            <div className="card space-y-1 text-sm">
              <p className="font-semibold">Antes de levantar</p>
              <p>{secSt?.pinSet ? '✅' : '⬜'} PIN de transação criado</p>
              <p>{secSt?.totp.some((x) => x.status === 'verified') ? '✅' : '⬜'} 2FA ativo (recomendado)</p>
              <p>{activeWl.length ? '✅' : wl.length ? '⏳' : '⬜'} Número M-Pesa/e-Mola na lista branca {wl.length && !activeWl.length ? '(ativo 24 h após adicionar)' : ''}</p>
              <p>{(lim?.withdraw ?? 0) > 0 ? '✅' : '⬜'} Verificação nível 1+ (telemóvel)</p>
              {locked && <p className="text-amber-200">⏳ Levantamentos bloqueados até {new Date(secSt!.withdrawalsLockedUntil!).toLocaleString('pt-PT')} por alteração de segurança.</p>}
              {secSt?.frozen && <p className="text-pink">❄️ Conta congelada.</p>}
              <Link href="/seguranca" className="btn mt-2 w-full">Abrir Centro de segurança</Link>
            </div>
          ) : (
            <div className="card space-y-2 text-sm">
              <select className="input w-full" value={wd.wl} onChange={(e) => setWd({ ...wd, wl: e.target.value })}>{activeWl.map((w) => <option key={w.id} value={w.id}>{w.method} · +{w.msisdn.slice(0, 5)}•••{w.msisdn.slice(-2)} {w.label}</option>)}</select>
              <input type="number" className="input w-full" min={r.minPayoutMzn} value={wd.amount} onChange={(e) => setWd({ ...wd, amount: Number(e.target.value) })} />
              <div className="flex gap-2 text-xs">{[500, 1000, 5000].map((v) => <button key={v} className="chip" onClick={() => setWd({ ...wd, amount: v })}>{v}</button>)}<button className="chip" onClick={() => setWd({ ...wd, amount: Math.floor(Math.min(m.balance, lim?.withdraw ?? 0)) })}>Máximo</button></div>
              {err && <p className="text-xs text-pink">{err}</p>}
              <button className="btn w-full" disabled={wd.amount < r.minPayoutMzn || wd.amount > m.balance} onClick={() => { setErr(''); setPin(true); }}>Levantar {MZN(wd.amount)}</button>
              <p className="text-xs text-white/50">Taxa de levantamento: 0 MZN (a taxa do operador, se houver, é mostrada antes de confirmar). Valores altos ou invulgares passam por revisão manual.</p>
            </div>
          )}
          <div className="card space-y-1 text-xs">
            <p className="text-sm font-semibold">Histórico de levantamentos</p>
            {m.payouts.length === 0 && <p className="text-white/50">Sem levantamentos.</p>}
            {m.payouts.map((p) => <div key={p.id} className="flex justify-between border-b border-line py-1 last:border-0"><span>{new Date(p.at).toLocaleDateString('pt-PT')} · {p.method}</span><span>{MZN(p.amount)} · <b className={p.status === 'pago' ? 'text-lime' : p.status === 'rejeitado' ? 'text-pink' : 'text-amber-300'}>{p.status}</b></span></div>)}
          </div>
        </div>
      )}

      <PinPrompt open={pin} onClose={() => setPin(false)} purpose="levantamento" amount={wd.amount} onAuthorized={async (token) => {
        setPin(false);
        const x = await (await sec()).requestWithdrawal(wd.wl, wd.amount, token, idem);
        if (!x.ok) { setErr(x.error!); return; }
        const w = wl.find((y) => y.id === wd.wl);
        (await mon()).demoRecordPayout(wd.amount, `${w?.method} ${w?.msisdn.slice(3, 5)}•••${w?.msisdn.slice(-2)}`);
        setIdem(crypto.randomUUID?.() ?? String(Date.now()));
        toast(x.data?.review ? 'Pedido enviado para revisão de segurança 🛡️' : 'Pedido de levantamento enviado ✅');
        void load();
      }} />
    </Page>
  );
}
