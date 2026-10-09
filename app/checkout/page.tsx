'use client';

import Link from 'next/link';
import { useState } from 'react';
import { mzn } from '@/lib/data';
import { useStore } from '@/lib/store';
import { CheckoutSheet } from '@/components/LazyCheckout';
import { DemoBanner, Page } from '@/components/ui';
import { Icon } from '@/components/icons';

export default function CheckoutPage() {
  const { s, set } = useStore();
  const [open, setOpen] = useState(false);
  const counts = s.cart.reduce<Record<string, number>>((a, id) => ({ ...a, [id]: (a[id] ?? 0) + 1 }), {});
  const lines = Object.entries(counts).map(([id, qty]) => { const p = s.admin.products.find((x) => x.id === id)!; return { id, label: p.name, amount: p.price, qty, emoji: p.emoji }; }).filter((l) => l.label);
  const total = lines.reduce((a, l) => a + l.amount * l.qty, 0);
  const change = (id: string, d: number) => set((p) => {
    if (d > 0) return { ...p, cart: [...p.cart, id] };
    const i = p.cart.indexOf(id);
    return { ...p, cart: p.cart.filter((_, k) => k !== i) };
  });
  return (
    <Page title="Carrinho" back="/loja">
      <DemoBanner />
      {lines.length === 0 ? (
        <div className="card text-center"><p className="mb-3">O carrinho está vazio.</p><Link href="/loja" className="btn">Ir à loja</Link></div>
      ) : (
        <>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="card flex items-center gap-3 !p-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-panel2 text-[#FFC107]"><Icon name="box" size={22} /></span>
                <div className="flex-1"><p className="text-sm">{l.label}</p><p className="text-xs text-white/60">{mzn(l.amount)} cada</p></div>
                <div className="flex items-center gap-2"><button className="rounded bg-panel2 px-2" onClick={() => change(l.id, -1)}>−</button><span>{l.qty}</span><button className="rounded bg-panel2 px-2" onClick={() => change(l.id, 1)}>+</button></div>
              </div>
            ))}
          </div>
          <div className="card mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{mzn(total)}</span></div>
            <div className="flex justify-between text-white/60"><span>Entrega (digital / levantamento)</span><span>0 MZN</span></div>
            <div className="flex justify-between text-lg font-bold"><span>Total final</span><span className="text-neon2">{mzn(total)}</span></div>
          </div>
          <div className="mt-4 flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => set((p) => ({ ...p, cart: [] }))}>Esvaziar</button>
            <button className="btn flex-1" onClick={() => setOpen(true)}>Finalizar · {mzn(total)}</button>
          </div>
        </>
      )}
      <CheckoutSheet open={open} onClose={() => setOpen(false)} title="Encomenda da Loja" lines={lines.map((l) => ({ label: l.label, amount: l.amount, qty: l.qty }))}
        onPaid={() => set((p) => ({ ...p, cart: [] }))} />
    </Page>
  );
}
