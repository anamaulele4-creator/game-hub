'use client';

// Carteira › Apostas (saldo de teste). Mostra disponível, reservado/em jogo, apostas pendentes, ganhos liquidados e histórico.
// Lido do servidor (apv2_wallet). Se o SQL v3 não estiver instalado ou não houver sessão, não mostra nada (a carteira MT continua igual).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fmtMTTeste } from '@/lib/apostasV2';
import { V3WalletView, apostasV3Api } from '@/lib/apostasV2Api';

const REASON: Record<string, string> = { inicial: 'Saldo inicial de teste', aposta: 'Aposta (débito)', liquidacao: 'Liquidação (ganho ou reembolso)', admin: 'Crédito de teste (admin)' };
const when = (iso: string) => (iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function WalletApostas() {
  const [w, setW] = useState<V3WalletView | null | undefined>(undefined);
  const [all, setAll] = useState(false);
  useEffect(() => { void apostasV3Api.wallet().then(setW).catch(() => setW(null)); }, []);
  if (!w) return null;
  const rows = all ? w.ledger : w.ledger.slice(0, 8);
  return (
    <section className="card mt-4" aria-labelledby="wallet-apostas">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p id="wallet-apostas" className="font-bold">Apostas · saldo de teste</p>
        <Link href="/apostas#minhas" className="text-sm text-neon2 underline">Minhas apostas</Link>
      </div>
      <p className="mb-3 text-[12px] text-white/60">Sem valor monetário: não se deposita nem se levanta. Separado do saldo em MT acima.</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Disponível</p><p className="font-bold">{fmtMTTeste(w.available)}</p></div>
        <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Reservado / em jogo</p><p className="font-bold">{fmtMTTeste(w.reserved)}</p></div>
        <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Apostas pendentes</p><p className="font-bold">{w.pending}</p></div>
        <div className="rounded-[14px] bg-panel2 p-2"><p className="text-white/65">Ganhos liquidados</p><p className="font-bold">{fmtMTTeste(w.wonTotal)}</p><p className="text-[11px] text-white/50">líquido {w.netWon >= 0 ? '+' : ''}{w.netWon} · reembolsos {w.refundedTotal}</p></div>
        <div className="col-span-2 rounded-[14px] bg-panel2 p-2 text-[12px] text-white/60">Depósitos e levantamentos: não se aplicam ao saldo de teste (dinheiro real desligado até haver autorização legal).</div>
      </div>
      <p className="mb-1 mt-3 text-sm font-bold">Histórico</p>
      {w.ledger.length === 0 ? <p className="text-sm text-white/60">Sem movimentos.</p> : (
        <ul className="divide-y divide-line text-sm">{rows.map((e) => (
          <li key={`${e.id}-${e.ref}`} className="flex items-center gap-2 py-2">
            <span className="flex-1">{REASON[e.reason] ?? e.reason}<span className="block text-xs text-white/50">{when(e.at)}</span></span>
            <span className={`font-bold ${e.delta > 0 ? 'text-emerald-300' : 'text-white'}`}>{e.delta > 0 ? '+' : ''}{e.delta}</span>
            <span className="w-20 text-right text-xs text-white/55">{e.balanceAfter}</span>
          </li>))}
        </ul>
      )}
      {w.ledger.length > 8 && <button type="button" className="mt-2 text-sm text-neon2 underline" onClick={() => setAll((x) => !x)}>{all ? 'Mostrar menos' : `Ver todos (${w.ledger.length})`}</button>}
    </section>
  );
}
