'use client';

import { useState } from 'react';
import { PLANS, Plan, mzn } from '@/lib/data';
import { useStore } from '@/lib/store';
import { CheckoutSheet } from '@/components/LazyCheckout';
import { Page } from '@/components/ui';

export default function PlanosPage() {
  const { s, set, toast, unlock } = useStore();
  const [sel, setSel] = useState<Plan | null>(null);
  const price = (p: Plan) => s.admin.planPrices[p.id] ?? p.price;
  return (
    <Page title="Planos" back="/mais">
      <p className="mb-4 text-center text-sm text-white/70">Sem letras pequenas: preço final visível, cancelas quando quiseres no Perfil.</p>
      <div className="space-y-3">
        {PLANS.map((p) => {
          const active = s.plans.includes(p.id);
          return (
            <div key={p.id} className={`card ${p.highlight ? 'border-neon shadow-neon' : ''}`}>
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold">{p.emoji} {p.name}</p>
                {p.highlight && <span className="chip !bg-neon !text-white">Mais popular</span>}
              </div>
              <p className="my-1 text-2xl font-black text-neon2">{mzn(price(p))}<span className="text-xs font-normal text-white/60"> / {p.period}</span></p>
              <ul className="mb-3 space-y-1 text-sm">{p.perks.map((x) => <li key={x}>✓ {x}</li>)}</ul>
              {active ? (
                <button className="btn-ghost w-full" onClick={() => { set((x) => ({ ...x, plans: x.plans.filter((y) => y !== p.id) })); toast(`${p.name} cancelado. Sem custos.`); }}>Ativo · Cancelar</button>
              ) : <button className="btn w-full" onClick={() => setSel(p)}>Escolher {p.name}</button>}
            </div>
          );
        })}
      </div>
      {sel && <CheckoutSheet open={!!sel} onClose={() => setSel(null)} title={`Plano ${sel.name}`} lines={[{ label: `${sel.name} (${sel.period})`, amount: price(sel) }]}
        recurring={sel.period === 'mês' ? `mensal, ${mzn(price(sel))}` : undefined}
        onPaid={() => { set((x) => ({ ...x, plans: [...x.plans, sel.id] })); if (sel.id === 'verificacao') unlock('a1'); }} />}
    </Page>
  );
}
