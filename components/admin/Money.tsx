'use client';

import { PAYMENTS, PLANS, mzn } from '@/lib/data';
import { Payout } from '@/lib/store';
import { useAdmin, Badge } from './shared';

export function Plans() {
  const { a, upd, act } = useAdmin();
  return (
    <div className="space-y-2">
      {PLANS.map((p) => (
        <div key={p.id} className="card flex items-center gap-3 !p-3 text-sm">
          <span className="flex-1">{p.name}<span className="block text-xs text-white/50">/{p.period}</span></span>
          <input type="number" className="input w-24" value={a.planPrices[p.id] ?? p.price} onChange={(e) => upd({ planPrices: { ...a.planPrices, [p.id]: Number(e.target.value) } })} onBlur={(e) => act('Alterou preço do plano', `${p.name} → ${e.target.value} MZN`)} /><span className="text-xs">MZN</span>
        </div>
      ))}
      <p className="text-center text-xs text-white/50">Os preços alterados aparecem logo na página Planos. Assinantes atuais mantêm o preço até à renovação (aviso de 30 dias na versão real).</p>
    </div>
  );
}

export function Payouts() {
  const { a, upd, act } = useAdmin();
  const setPo = (p: Payout, status: Payout['status']) => { upd({ payouts: a.payouts.map((x) => (x.id === p.id ? { ...x, status } : x)) }); act(`Levantamento ${status}`, `${p.creator} ${mzn(p.amount)}`, `Levantamento ${status}`); };
  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <p className="font-semibold">Levantamentos de criadores</p>
        {a.payouts.map((p) => (
          <div key={p.id} className="rounded-xl bg-panel2 p-2 text-sm">
            <div className="flex justify-between"><span>{p.creator} · {mzn(p.amount)}</span><Badge tone={p.status === 'pago' ? 'green' : p.status === 'rejeitado' ? 'red' : p.status === 'aprovado' ? 'blue' : 'amber'}>{p.status}</Badge></div>
            <p className="text-xs text-white/50">{p.method} · {p.date}</p>
            {(p.status === 'pendente' || p.status === 'aprovado') && (
              <div className="mt-1 flex gap-2 text-xs">
                {p.status === 'pendente' && <button className="btn-ghost flex-1 !py-1" onClick={() => setPo(p, 'aprovado')}>Aprovar</button>}
                <button className="btn flex-1 !py-1" onClick={() => setPo(p, 'pago')}>Marcar pago</button>
                <button className="flex-1 rounded-xl bg-red-600 py-1" onClick={() => setPo(p, 'rejeitado')}>Rejeitar</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="card space-y-2 text-sm">
        <p className="font-semibold">Comissões da plataforma</p>
        {a.commissions.map((c, i) => (
          <div key={c.area} className="flex items-center gap-2"><span className="flex-1">{c.area}</span><input className="input w-48 text-xs" value={c.rate} onChange={(e) => upd({ commissions: a.commissions.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} onBlur={() => act('Alterou comissão', c.area)} /></div>
        ))}
      </div>
      <div className="card space-y-2">
        <p className="font-semibold">Pagamentos recebidos</p>
        <p className="text-xs text-white/60">M-Pesa / e-Mola via agregador: <b>não ativo</b> (ver supabase/functions/payments).</p>
        {(a.payments.length ? a.payments : PAYMENTS).map((p) => (
          <div key={p.id} className="rounded-xl bg-panel2 p-2 text-sm">
            <div className="flex justify-between"><span>{p.item}</span><span className="font-semibold">{mzn(p.amount)}</span></div>
            <p className="text-xs text-white/50">{p.user} · {p.method}</p>
            <select className="input mt-1 w-full" value={p.status} onChange={(e) => { upd({ payments: a.payments.map((x) => (x.id === p.id ? { ...x, status: e.target.value } : x)) }); act('Alterou estado de pagamento', `${p.id} → ${e.target.value}`); }}>
              {['pago', 'pendente', 'em processamento', 'falhou', 'reembolsado'].map((st) => <option key={st}>{st}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
