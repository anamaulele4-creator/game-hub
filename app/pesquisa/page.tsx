'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CHANNELS, CLIPS, IDOLS, LESSONS, idol } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, AvatarFace } from '@/components/ui';

export default function PesquisaPage() {
  const { s } = useStore();
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const m = (x: string) => x.toLowerCase().includes(t);
  const res = t ? [
    ...IDOLS.filter((i) => m(i.name) || m(i.game) || m(i.handle)).map((i) => ({ k: 'i' + i.id, e: i.avatar, title: i.name, sub: `Ídolo · ${i.game}`, href: `/idolo/${i.id}` })),
    ...CLIPS.filter((c) => m(c.title) || m(c.game) || c.tags.some(m)).map((c) => ({ k: 'c' + c.id, e: c.emoji, title: c.title, sub: `Clipe · ${idol(c.idolId).name}`, href: `/clipe/${c.id}` })),
    ...s.admin.tournaments.filter((x) => m(x.name) || m(x.game)).map((x) => ({ k: 't' + x.id, e: '🏆', title: x.name, sub: `Torneio · ${x.game}`, href: `/torneios/${x.id}` })),
    ...LESSONS.filter((x) => m(x.title)).map((x) => ({ k: 'l' + x.id, e: x.emoji, title: x.title, sub: 'Aula · Escola Free Fire', href: '/escola' })),
    ...CHANNELS.filter((x) => m(x.name) || m(x.topic)).map((x) => ({ k: 'ch' + x.id, e: x.emoji, title: x.name, sub: 'Canal', href: '/canais' })),
    ...s.admin.products.filter((x) => m(x.name)).map((x) => ({ k: 'p' + x.id, e: x.emoji, title: x.name, sub: `Loja · ${x.price} MZN`, href: '/loja' })),
  ] : [];
  return (
    <Page title="Pesquisar" back="/">
      <input autoFocus className="input mb-4 w-full" placeholder="Ídolos, clipes, torneios, aulas…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!t && <div className="flex flex-wrap gap-2">{['Free Fire', 'booyah', 'Nyx', 'eFootball', 'sensibilidade', 'diamantes'].map((x) => <button key={x} onClick={() => setQ(x)} className="chip !text-sm">{x}</button>)}</div>}
      {t && res.length === 0 && <p className="text-center text-sm text-white/60">Sem resultados para &quot;{q}&quot;.</p>}
      <div className="space-y-2">{res.map((r) => <Link key={r.k} href={r.href} className="card flex items-center gap-3 !p-3"><span className="text-2xl"><AvatarFace a={r.e} name={r.title} /></span><div><p className="text-sm">{r.title}</p><p className="text-xs text-white/50">{r.sub}</p></div></Link>)}</div>
    </Page>
  );
}
