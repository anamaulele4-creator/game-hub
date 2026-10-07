'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CLIPS, EVENTS, LESSONS, POSTS, idol } from '@/lib/data';
import { Saved, useStore } from '@/lib/store';
import { ClipThumb, Page, Tabs } from '@/components/ui';

const T = ['Tudo', 'Clipes', 'Publicações', 'Torneios', 'Aulas', 'Produtos', 'Eventos'] as const;
type Tb = (typeof T)[number];
const MAP: Record<Tb, Saved['kind'] | null> = { Tudo: null, Clipes: 'clipe', 'Publicações': 'post', Torneios: 'torneio', Aulas: 'aula', Produtos: 'produto', Eventos: 'evento' };

export default function GuardadosPage() {
  const { s, toggleSave } = useStore();
  const [t, setT] = useState<Tb>('Tudo');
  const list = s.saved.filter((x) => !MAP[t] || x.kind === MAP[t]);
  const clips = list.filter((x) => x.kind === 'clipe');
  const others = list.filter((x) => x.kind !== 'clipe');

  const info = (x: Saved): { title: string; sub: string; href: string; emoji: string } => {
    switch (x.kind) {
      case 'post': { const p = POSTS.find((y) => y.id === x.id)!; return { title: p.text, sub: idol(p.idolId).name, href: `/idolo/${p.idolId}`, emoji: p.emoji }; }
      case 'torneio': { const p = s.admin.tournaments.find((y) => y.id === x.id); return { title: p?.name ?? 'Torneio', sub: p?.date ?? '', href: `/torneios/${x.id}`, emoji: '🏆' }; }
      case 'aula': { const p = LESSONS.find((y) => y.id === x.id)!; return { title: p.title, sub: `${p.level} · ${p.minutes} min`, href: '/escola', emoji: p.emoji }; }
      case 'produto': { const p = s.admin.products.find((y) => y.id === x.id); return { title: p?.name ?? 'Produto', sub: p ? `${p.price} MZN` : '', href: '/loja', emoji: p?.emoji ?? '🛍️' }; }
      case 'evento': { const p = EVENTS.find((y) => y.id === x.id)!; return { title: p.name, sub: p.date, href: '/eventos', emoji: p.emoji }; }
      default: { const c = CLIPS.find((y) => y.id === x.id)!; return { title: c.title, sub: '', href: `/clipe/${c.id}`, emoji: c.emoji }; }
    }
  };

  return (
    <Page title="Meus Guardados" back="/perfil">
      <Tabs tabs={T} value={t} onChange={setT} />
      {list.length === 0 && <p className="card text-center text-sm text-white/60">Nada guardado aqui. Toca em 📑 para guardar.</p>}
      {clips.length > 0 && <div className="mb-4 grid grid-cols-3 gap-2">{clips.map((c) => <ClipThumb key={c.id} id={c.id} />)}</div>}
      <div className="space-y-2">
        {others.map((x) => { const i = info(x); return (
          <div key={x.kind + x.id} className="card flex items-center gap-3 !p-3">
            <span className="text-2xl">{i.emoji}</span>
            <Link href={i.href} className="min-w-0 flex-1"><p className="truncate text-sm">{i.title}</p><p className="text-[11px] text-white/50">{x.kind} · {i.sub}</p></Link>
            <button onClick={() => toggleSave(x)} className="text-xs text-pink">Remover</button>
          </div>
        ); })}
      </div>
    </Page>
  );
}
