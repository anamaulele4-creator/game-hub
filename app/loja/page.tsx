'use client';

import Link from 'next/link';
import { useState } from 'react';
import { mzn } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Tabs } from '@/components/ui';

const C = ['Tudo', 'Diamantes', 'Acessórios', 'Roupa', 'Serviços'] as const;
type Cat = (typeof C)[number];

export default function LojaPage() {
  const { s, set, toast, toggleSave, isSaved } = useStore();
  const [cat, setCat] = useState<Cat>('Tudo');
  const [q, setQ] = useState('');
  const items = s.admin.products.filter((p) => (cat === 'Tudo' || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase()));
  const add = (id: string) => { set((p) => ({ ...p, cart: [...p.cart, id] })); toast('Adicionado ao carrinho 🛒'); };
  return (
    <Page title="Loja" back="/mais">
      <div className="mb-3 flex gap-2">
        <input className="input flex-1" placeholder="Procurar na loja…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Link href="/checkout" className="btn relative">🛒{s.cart.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-lime px-1.5 text-[11px] text-black">{s.cart.length}</span>}</Link>
      </div>
      <Tabs tabs={C} value={cat} onChange={setCat} />
      <p className="mb-3 text-xs text-white/50">Marketplace: vendedores verificados. O Social POIPAK retém 10% de comissão (já incluída no preço).</p>
      <div className="grid grid-cols-2 gap-3">
        {items.map((p) => (
          <div key={p.id} className="card flex flex-col !p-3">
            <div className="mb-2 flex h-24 items-center justify-center rounded-xl bg-panel2 text-5xl">{p.emoji}</div>
            <p className="text-sm font-semibold leading-tight">{p.name}</p>
            <p className="text-xs text-white/50">{p.seller} · ⭐ {p.rating}</p>
            <p className="mt-1 font-bold text-neon2">{mzn(p.price)}</p>
            <p className="text-[11px] text-white/40">{p.stock < 20 ? `Só ${p.stock} em stock` : 'Em stock'}</p>
            <div className="mt-2 flex gap-1">
              <button className="btn flex-1 !px-2 !py-1 text-xs" onClick={() => add(p.id)}>Adicionar</button>
              <button className="rounded-lg bg-panel2 px-2" onClick={() => toggleSave({ kind: 'produto', id: p.id })}>{isSaved({ kind: 'produto', id: p.id }) ? '🔖' : '📑'}</button>
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
