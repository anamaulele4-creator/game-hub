'use client';

import { useCallback, useEffect, useState } from 'react';
import { IS_DEMO } from '@/lib/config';
import { Tabs } from '@/components/ui';
import { useAdmin, Badge } from './shared';

const sb = () => import('@/lib/supabase').then((m) => m.sb());
type Flag = { id: string; user: string; userId?: string; kind: string; rules: string[]; score: number; amount?: number; status: string; at: string; ref?: string };
type App = { id: string; user: string; followers: number; hours: number; category?: string; pitch?: string; status: string; at: string };

const DEMO_FLAGS: Flag[] = [
  { id: 'rf1', user: '@mario_ff', kind: 'levantamento', rules: ['numero_novo_72h', 'dispositivo_novo_24h', 'valor_anomalo'], score: 75, amount: 18000, status: 'aberto', at: new Date().toISOString() },
  { id: 'rf2', user: '@freediamonds99', kind: 'conta', rules: ['pin_brute_force'], score: 60, status: 'aberto', at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'rf3', user: '@kiara', kind: 'pagamento', rules: ['velocidade_10min'], score: 30, amount: 2400, status: 'aberto', at: new Date(Date.now() - 7200000).toISOString() },
];
const RULE_LABEL: Record<string, string> = {
  velocidade_10min: 'Muitas transações em 10 min', levantamentos_dia: '3+ levantamentos hoje', numero_novo_72h: 'Número adicionado há < 72 h',
  dispositivo_novo_24h: 'Login de dispositivo novo < 24 h', valor_anomalo: 'Valor > 3× a média', primeira_transacao_alta: '1.ª transação alta',
  kyc_baixo_valor_alto: 'KYC baixo para o valor', pin_brute_force: '5 PINs errados', valor_webhook_diferente: 'Valor do operador ≠ pedido',
};

export function RiskQueue() {
  const { act } = useAdmin();
  const [flags, setFlags] = useState<Flag[]>(IS_DEMO ? DEMO_FLAGS : []);
  const [filter, setFilter] = useState<'aberto' | 'todos'>('aberto');
  const load = useCallback(async () => {
    if (IS_DEMO) return;
    const c = await sb();
    const { data } = await c.from('risk_flags').select('*').order('created_at', { ascending: false }).limit(300);
    setFlags((data ?? []).map((r) => ({ id: r.id, user: '@' + (r.user_handle ?? '?'), userId: r.user_id, kind: r.kind, rules: r.rules ?? [], score: r.score, amount: r.amount_mzn ?? undefined, status: r.status, at: r.created_at, ref: r.ref_id ?? undefined })));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (f: Flag, status: 'aprovado' | 'bloqueado', freeze = false) => {
    if (!IS_DEMO) {
      const c = await sb();
      await c.from('risk_flags').update({ status }).eq('id', f.id);
      if (f.kind === 'levantamento' && f.ref) await c.from('payouts').update({ status: status === 'aprovado' ? 'aprovado' : 'rejeitado' }).eq('id', f.ref);
      if (f.kind === 'pagamento' && f.ref && status === 'bloqueado') await c.from('payments').update({ status: 'falhou' }).eq('id', f.ref);
      if (freeze && f.userId) await c.rpc('admin_set_frozen', { p_user: f.userId, p_frozen: true });
      void load();
    } else setFlags((l) => l.map((x) => (x.id === f.id ? { ...x, status } : x)));
    act(`Risco: ${status}${freeze ? ' + conta congelada' : ''}`, `${f.user} · ${f.kind} ${f.amount ?? ''}`, status === 'aprovado' ? 'Aprovado' : freeze ? 'Bloqueado e conta congelada' : 'Bloqueado');
  };
  const list = flags.filter((f) => filter === 'todos' || f.status === 'aberto').sort((a, b) => b.score - a.score);
  return (
    <div className="space-y-2">
      <div className="flex gap-2 text-xs">{(['aberto', 'todos'] as const).map((x) => <button key={x} onClick={() => setFilter(x)} className={`rounded-full px-2 py-1 ${filter === x ? 'bg-neon' : 'bg-panel2'}`}>{x === 'aberto' ? 'Por rever' : 'Todos'}</button>)}</div>
      <p className="text-xs text-white/50">Regras: velocidade, anomalia de valor, número/dispositivo novos, KYC vs valor, força bruta de PIN. Pontuação ≥ 50 retém o levantamento até decisão.</p>
      {list.length === 0 && <p className="card text-center text-sm text-white/60">Sem alertas </p>}
      {list.map((f) => (
        <div key={f.id} className={`card !p-3 text-sm ${f.score >= 50 ? 'border-pink' : ''}`}>
          <div className="flex justify-between"><span className="font-semibold">{f.user} · {f.kind}{f.amount ? ` · ${f.amount.toLocaleString('pt-PT')} MZN` : ''}</span><Badge tone={f.score >= 50 ? 'red' : 'amber'}>risco {f.score}</Badge></div>
          <ul className="my-1 list-disc pl-5 text-xs text-white/70">{f.rules.map((r) => <li key={r}>{RULE_LABEL[r] ?? r}</li>)}</ul>
          <p className="text-[11px] text-white/40">{new Date(f.at).toLocaleString('pt-PT')} · {f.status}</p>
          {f.status === 'aberto' && (
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
              <button className="btn !px-1 !py-1" onClick={() => void decide(f, 'aprovado')}>Aprovar</button>
              <button className="rounded-xl bg-red-600 py-1 font-semibold" onClick={() => void decide(f, 'bloqueado')}>Bloquear</button>
              <button className="rounded-xl border border-red-500 py-1 text-red-300" onClick={() => void decide(f, 'bloqueado', true)}>Bloquear + congelar</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// A antiga revisão de níveis KYC foi substituída pela fila única (components/admin/Kyc.tsx).
export { default as KycReview } from './Kyc';

const MT = ['Candidaturas', 'Comissões'] as const;
