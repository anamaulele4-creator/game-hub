'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { REASON_TEXT } from '@/lib/competitive';
import type { EligibilityReason } from '@/lib/competitive';
import { compApi } from '@/lib/competitiveApi';
import type { WalletView } from '@/lib/competitiveApi';
import { IS_DEMO } from '@/lib/config';
import { sb } from '@/lib/supabase';
import { PinPrompt } from '@/components/PinPrompt';
import { Sheet } from '@/components/ui';
import { DemoNote, Empty, Field, Shortcuts, Skel, Unavailable, fmtDate, useRun } from './Kit';

const REASON_PT: Record<string, string> = { deposito: 'Depósito', levantamento: 'Levantamento', levantamento_recusado: 'Levantamento devolvido', aposta: 'Aposta', ganho: 'Ganho', reembolso: 'Reembolso', correcao: 'Correção', ajuste: 'Ajuste', comissao_afiliado: 'Comissão de afiliado',
  compra: 'Compra no marketplace', venda: 'Venda no marketplace', payout: 'Pagamento ao vendedor (pedido)', payout_recusado: 'Pagamento ao vendedor devolvido' };
const mt = (n: number) => `${n.toLocaleString('pt-PT')} MT`;

export default function WalletArea() {
  const [w, setW] = useState<WalletView | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState<'' | 'dep' | 'wd' | 'rg'>('');
  const run = useRun();
  const load = useCallback(async () => {
    const r = await compApi.wallet().catch(() => ({ ok: false as const, code: 'ERRO' }));
    if ('available' in r) { setW(r); setErr(''); } else { setW(null); setErr(r.code); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Saldo em tempo real: o crédito acontece no servidor (comp__confirm_deposit, atómico e idempotente) no instante em que o
  // fornecedor confirma (webhook assinado ou consulta de estado na Edge Function). A app ouve o livro-razão e os pagamentos
  // (Supabase Realtime, RLS: só os próprios) e volta a ler o saldo logo a seguir. Nunca há crédito antes da confirmação.
  useEffect(() => {
    if (IS_DEMO) return;
    let stop = false; let off: (() => void) | null = null;
    void (async () => {
      try {
        const c = await sb(); const { data } = await c.auth.getSession(); const uid = data.session?.user.id;
        if (!uid || stop) return;
        const ch = c.channel(`carteira-${uid}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'money_ledger', filter: `user_id=eq.${uid}` }, () => { void load(); })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments', filter: `user_id=eq.${uid}` }, () => { void load(); })
          .subscribe();
        off = () => { void c.removeChannel(ch); };
        if (stop) off();
      } catch { /* sem realtime: fica a consulta periódica abaixo */ }
    })();
    const vis = () => { if (document.visibilityState === 'visible') void load(); }; // volta da app M-Pesa/e-Mola
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; off?.(); document.removeEventListener('visibilitychange', vis); };
  }, [load]);
  const waiting = !!w && w.deposits.some((d) => d.status === 'pendente' || d.status === 'em processamento');
  // Enquanto houver depósito pendente: pergunta ao servidor (Edge Function) se o fornecedor já confirmou e relê o saldo.
  useEffect(() => {
  if (!w || IS_DEMO) return;
  const pend = w.deposits.filter((d) => d.status === 'pendente' || d.status === 'em processamento');
  if (!pend.length) return;
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    for (const d of pend) await compApi.checkDeposit(d.id).catch(() => {});
    await load();
    busy = false;
  }, 6000);
  return () => clearInterval(t);
}, [w, load]);

  if (w === undefined) return <Skel />;
  if (!w) return (<><Shortcuts /><Empty>{err === 'AUTH' ? <>Entra na tua conta para ver a carteira. <Link className="text-neon2 underline" href="/entrar?next=/carteira">Entrar</Link></> : err === 'NOT_INSTALLED' ? 'Carteira ainda não disponível.' : 'Não foi possível abrir a carteira.'}</Empty><div className="mt-4"><Unavailable what="A carteira em dinheiro" /></div></>);
  return (
    <>
      <DemoNote />
      <Shortcuts />
      <div className="hud-card mb-4 p-5">
        <p className="text-sm text-white/70">Saldo disponível</p>
        <p className="stat-num text-4xl">{mt(w.available)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Reservado</p><p className="font-bold">{mt(w.reserved)}</p><p className="text-[11px] text-white/50">levantamentos {mt(w.reservedWithdrawals)} · apostas {mt(w.reservedBets)}</p></div>
          <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Total</p><p className="font-bold">{mt(w.total)}</p><p className="text-[11px] text-white/50">{IS_DEMO ? 'demo: calculado no navegador' : 'calculado no servidor'}</p></div>
        </div>
        {w.monetaryOn ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={!w.eligibility.ok} onClick={() => setSheet('dep')}>Depositar</button>
            <button type="button" className="btn-ghost" disabled={!w.eligibility.ok || w.available <= 0} onClick={() => setSheet('wd')}>Levantar</button>
            <button type="button" className="btn-ghost" onClick={() => setSheet('rg')}>Limites e pausas</button>
          </div>
        ) : <div className="mt-4"><Unavailable what="Depósitos, levantamentos e apostas em dinheiro" /></div>}
      </div>

      {w.monetaryOn && !w.eligibility.ok && (
        <section className="card mb-4 text-sm">
          <p className="mb-1 font-bold">Para usar dinheiro real falta:</p>
          <ul className="list-disc pl-5">{w.eligibility.reasons.map((r) => <li key={r}>{REASON_TEXT[r as EligibilityReason] ?? r}</li>)}</ul>
          <p className="mt-2 text-white/65">Verifica a identidade em <Link className="text-neon2 underline" href="/apostas#carteira">Apostas › Carteira MT</Link> ou <Link className="text-neon2 underline" href="/seguranca">Segurança</Link>.</p>
        </section>
      )}
      {w.monetaryOn && !w.providerReady && <p className="mb-4 rounded-[14px] bg-white/5 p-3 text-sm text-white/75">Depósitos automáticos M-Pesa ainda não configurados pela equipa. Nada é cobrado.</p>}

      {w.deposits.length > 0 && (
        <section className="card mb-4">
          <p className="mb-2 font-bold">Depósitos</p>
          <ul className="divide-y divide-line text-sm">{w.deposits.map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-2">
              <span className="flex-1">{d.method} · {mt(d.amount)} <span className="text-xs text-white/55">{fmtDate(d.at)}</span></span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${d.status === 'pago' ? 'bg-emerald-600' : d.status === 'falhou' ? 'bg-red-600' : 'bg-white/10'}`}>{d.status}</span>
              {IS_DEMO && d.status === 'pendente' && <button type="button" className="chip text-xs" onClick={async () => { if (await run(compApi.demoSimulateWebhook(d.id), 'Demo: webhook simulado')) void load(); }}>Simular confirmação (demo)</button>}
            </li>))}
          </ul>
          {waiting && <p className="mt-2 text-xs text-neon2" role="status">À espera da confirmação da operadora… o saldo atualiza sozinho assim que o pagamento for confirmado.</p>}
          <p className="mt-2 text-xs text-white/55">O valor entra na carteira automaticamente no momento em que o fornecedor confirma o pagamento ao nosso servidor — sem aprovação manual. Antes disso nada é creditado; capturas de ecrã não contam.</p>
        </section>
      )}

      <section className="card">
        <p className="mb-2 font-bold">Movimentos</p>
        {w.ledger.length === 0 ? <p className="text-sm text-white/60">Sem movimentos.</p> : (
          <ul className="divide-y divide-line text-sm">{w.ledger.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-2">
              <span className="flex-1">{REASON_PT[e.reason] ?? e.reason}<span className="block text-xs text-white/50">{fmtDate(e.at)}</span></span>
              <span className={`font-bold ${e.delta > 0 ? 'text-emerald-300' : 'text-white'}`}>{e.delta > 0 ? '+' : ''}{mt(e.delta)}</span>
              <span className="w-24 text-right text-xs text-white/55">{mt(e.balanceAfter)}</span>
            </li>))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-white/45">Livro-razão só de acréscimos: cada movimento tem um identificador único e nunca é alterado.</p>
      </section>

      <DepositSheet open={sheet === 'dep'} onClose={() => setSheet('')} onDone={() => { setSheet(''); void load(); }} />
      <WithdrawSheet open={sheet === 'wd'} onClose={() => setSheet('')} max={w.available} onDone={() => { setSheet(''); void load(); }} />
      <LimitsSheet open={sheet === 'rg'} onClose={() => setSheet('')} w={w} onDone={() => { setSheet(''); void load(); }} />
    </>
  );
}

function DepositSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(100); const [phone, setPhone] = useState(''); const [method, setMethod] = useState<'M-Pesa' | 'e-Mola'>('M-Pesa');
  const [idem, setIdem] = useState(() => compApi.newIdem()); const [busy, setBusy] = useState(false);
  const run = useRun();
  return (
    <Sheet open={open} onClose={onClose} title="Depositar">
      <div className="space-y-3">
        <Field label="Método"><select className="input" value={method} onChange={(e) => setMethod(e.target.value as 'M-Pesa' | 'e-Mola')}><option>M-Pesa</option><option>e-Mola</option></select></Field>
        <Field label="Número" hint={method === 'M-Pesa' ? '84 ou 85 + 7 dígitos' : '86 ou 87 + 7 dígitos'}><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="84 123 4567" /></Field>
        <Field label="Valor (MT)"><input type="number" min={10} className="input" value={amount} onChange={(e) => setAmount(Math.floor(Number(e.target.value)))} /></Field>
        <p className="text-xs text-white/60">Vais receber no telemóvel um pedido para aprovar com o teu PIN M-Pesa. O saldo só aumenta quando a operadora confirma.</p>
        <button type="button" className="btn w-full" disabled={busy} onClick={async () => { setBusy(true); const r = await run(compApi.deposit(amount, method, phone, idem), 'Pedido enviado. Aprova no telemóvel.'); setBusy(false); if (r) { setIdem(compApi.newIdem()); onDone(); } }}>Pedir {amount} MT</button>
      </div>
    </Sheet>
  );
}
function WithdrawSheet({ open, onClose, onDone, max }: { open: boolean; onClose: () => void; onDone: () => void; max: number }) {
  const [amount, setAmount] = useState(50); const [phone, setPhone] = useState(''); const [method, setMethod] = useState<'M-Pesa' | 'e-Mola'>('M-Pesa'); const [pin, setPin] = useState(false);
  const [idem, setIdem] = useState(() => compApi.newIdem());
  const run = useRun();
  const go = async (token: string) => { const r = await run(compApi.withdraw(amount, method, phone, token, idem), 'Pedido de levantamento registado'); setIdem(compApi.newIdem()); if (r) onDone(); };
  return (
    <Sheet open={open} onClose={onClose} title="Levantar">
      <div className="space-y-3">
        <Field label="Método"><select className="input" value={method} onChange={(e) => setMethod(e.target.value as 'M-Pesa' | 'e-Mola')}><option>M-Pesa</option><option>e-Mola</option></select></Field>
        <Field label="Número"><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label={`Valor (MT, disponível ${max})`}><input type="number" min={50} max={max} className="input" value={amount} onChange={(e) => setAmount(Math.floor(Number(e.target.value)))} /></Field>
        <p className="text-xs text-white/60">O valor fica reservado até a equipa confirmar o pagamento. Exige o teu PIN de transação.</p>
        <button type="button" className="btn w-full" onClick={() => (IS_DEMO ? go('demo') : setPin(true))}>Continuar</button>
      </div>
      {!IS_DEMO && <PinPrompt open={pin} onClose={() => setPin(false)} purpose="levantamento" amount={amount} onAuthorized={(t) => { setPin(false); void go(t); }} />}
    </Sheet>
  );
}
function LimitsSheet({ open, onClose, w, onDone }: { open: boolean; onClose: () => void; w: WalletView; onDone: () => void }) {
  const [d, setD] = useState(w.limits.depositDaily?.toString() ?? ''); const [wk, setWk] = useState(w.limits.depositWeekly?.toString() ?? ''); const [m, setM] = useState(w.limits.depositMonthly?.toString() ?? '');
  const run = useRun();
  const n = (s: string) => (s.trim() ? Math.max(1, Math.floor(Number(s))) : null);
  return (
    <Sheet open={open} onClose={onClose} title="Jogo responsável">
      <div className="space-y-3 text-sm">
        <p className="text-white/75">Baixar um limite é imediato. Subir ou remover só conta 24 h depois.</p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Diário (MT)"><input className="input" inputMode="numeric" value={d} onChange={(e) => setD(e.target.value)} /></Field>
          <Field label="Semanal"><input className="input" inputMode="numeric" value={wk} onChange={(e) => setWk(e.target.value)} /></Field>
          <Field label="Mensal"><input className="input" inputMode="numeric" value={m} onChange={(e) => setM(e.target.value)} /></Field>
        </div>
        {w.limits.pendingEffectiveAt && <p className="text-xs text-neon2">Aumento pendente até {fmtDate(w.limits.pendingEffectiveAt)}.</p>}
        <button type="button" className="btn w-full" onClick={async () => { const r = await run(compApi.setDepositLimits(n(d), n(wk), n(m)), 'Limites guardados'); if (r) onDone(); }}>Guardar limites de depósito</button>
        <p className="pt-2 font-bold">Pausa (cool-off)</p>
        <div className="flex flex-wrap gap-2">{[24, 72, 168, 720].map((h) => (
          <button key={h} type="button" className="chip" onClick={async () => { if (window.confirm(`Pausar dinheiro e apostas durante ${h >= 168 ? h / 24 + ' dias' : h + ' h'}? Não dá para desfazer.`) && await run(compApi.coolOff(h), 'Pausa ativa')) onDone(); }}>{h >= 168 ? `${h / 24} dias` : `${h} h`}</button>))}
        </div>
        {w.limits.coolOffUntil && <p className="text-xs">Pausa ativa até {fmtDate(w.limits.coolOffUntil)}.</p>}
        <p className="pt-2 text-white/75">Autoexclusão (7, 30 ou 90 dias) e limites de aposta: <Link className="text-neon2 underline" href="/apostas#responsavel">Apostas › Jogo responsável</Link>. Ajuda: <Link className="text-neon2 underline" href="/bem-estar">Bem-estar</Link>.</p>
      </div>
    </Sheet>
  );
}
