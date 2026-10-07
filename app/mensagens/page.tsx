'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Page, Tabs } from '@/components/ui';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import type { DmConversation } from '@/lib/dm';

const T = ['Conversas', 'Pedidos'] as const;

export default function Mensagens() {
  const { s, ready } = useStore();
  const [tab, setTab] = useState<(typeof T)[number]>('Conversas');
  const [list, setList] = useState<DmConversation[] | null>(null);
  const [q, setQ] = useState('');
  const [timeLabel, setTL] = useState<(i: string) => string>(() => () => '');

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void import('@/lib/dm').then(async (m) => {
      setTL(() => m.timeLabel);
      const l = await m.listConversations();
      if (alive) setList(l);
    });
    return () => { alive = false; };
  }, [ready, s.account.loggedIn]);

  if (ready && !IS_DEMO && !s.account.loggedIn) return (
    <Page title="Mensagens" back="/"><div className="card mt-6 space-y-3 text-center"><p className="text-4xl">💬</p><p className="text-sm">Entra na tua conta para conversar com amigos e ídolos.</p><Link href="/entrar" className="btn w-full">Entrar</Link></div></Page>
  );

  const reqs = (list ?? []).filter((c) => c.status === 'pedido');
  const chats = (list ?? []).filter((c) => c.status === 'aceite' && !s.blocked.includes(c.peer.id));
  const shown = (tab === 'Pedidos' ? reqs : chats).filter((c) => (c.peer.name + c.peer.handle).toLowerCase().includes(q.toLowerCase()));

  return (
    <Page title="Mensagens" back="/">
      <p className="mb-3 rounded-lg bg-lime/10 p-2 text-center text-[11px] text-lime">💬 Mensagens grátis — enviadas pela internet, sem moedas nem SMS.</p>
      <Tabs tabs={T} value={tab} onChange={setTab} />
      {reqs.length > 0 && tab === 'Conversas' && <button onClick={() => setTab('Pedidos')} className="card mb-3 w-full !p-3 text-left text-sm">📨 {reqs.length} pedido(s) de mensagem de pessoas que não segues ›</button>}
      <input className="input mb-3 w-full" placeholder="Pesquisar conversas" value={q} onChange={(e) => setQ(e.target.value)} />
      {tab === 'Pedidos' && <p className="mb-2 text-[11px] text-white/50">Pedidos de quem não segues. Só sabem que leste depois de aceitares.</p>}
      {list === null && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="card h-16 animate-pulse" />)}</div>}
      {list && shown.length === 0 && <p className="card text-center text-sm text-white/60">{tab === 'Pedidos' ? 'Sem pedidos.' : 'Ainda não tens conversas. Abre o perfil de um ídolo ou amigo e toca em “Enviar mensagem”.'}</p>}
      <div className="space-y-2">
        {shown.map((c) => (
          <Link key={c.id} href={`/mensagens/chat?c=${encodeURIComponent(c.id)}`} className={`card flex items-center gap-3 !p-3 ${c.unread ? 'border-neon/60' : ''}`}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-panel2 text-2xl">{c.peer.avatar}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{c.peer.name}{c.peer.verified && ' ✅'} {c.muted && <span className="text-white/40">🔕</span>}</p>
              <p className={`truncate text-xs ${c.unread ? 'text-white' : 'text-white/50'}`}>{c.lastFromMe ? 'Tu: ' : ''}{c.preview || 'Nova conversa'}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] text-white/40">{timeLabel(c.lastAt)}</span>
              {c.unread > 0 && <span className="rounded-full bg-pink px-1.5 text-[10px] font-bold">{c.unread}</span>}
            </div>
          </Link>
        ))}
      </div>
    </Page>
  );
}
