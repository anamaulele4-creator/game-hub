'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Page, Avatar, Sheet } from '@/components/ui';
import { PeopleList } from '@/components/Social';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import type { Chat } from '@/lib/chat';
import type { Person } from '@/lib/social';

const T = ['Todas', 'Não lidas', 'Grupos', 'Pedidos'] as const;
type Tab = (typeof T)[number];

export default function Mensagens() {
  const { s, ready } = useStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Todas');
  const [list, setList] = useState<Chat[] | null>(null);
  const [q, setQ] = useState('');
  const [lib, setLib] = useState<typeof import('@/lib/chat') | null>(null);
  const [pick, setPick] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [pq, setPq] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const load = () => import('@/lib/chat').then(async (m) => {
      setLib(m);
      const l = await m.listChats();
      if (alive) setList(l);
    }).catch(() => { if (alive) setList((x) => x ?? []); });
    void load();
    const iv = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    let off = () => {};
    void import('@/lib/chat').then((m) => { off = m.onPresence(() => tick((n) => n + 1)); });
    return () => { alive = false; clearInterval(iv); off(); };
  }, [ready, s.account.loggedIn]);

  useEffect(() => {
    if (!pick) return;
    let alive = true;
    setPeople(null);
    void import('@/lib/social').then((m) => m.peopleIFollow(s.following)).then((l) => { if (alive) setPeople(l.filter((p) => !s.blocked.includes(p.id))); });
    return () => { alive = false; };
  }, [pick, s.following, s.blocked]);

  if (ready && !IS_DEMO && !s.account.loggedIn) return (
    <Page title="Mensagens" back="/"><div className="card mt-6 space-y-3 text-center"><p className="text-4xl">💬</p><p className="text-sm">Entra na tua conta para conversar com amigos e ídolos.</p><Link href="/entrar" className="btn w-full">Entrar</Link></div></Page>
  );

  const all = (list ?? []).filter((c) => !(c.peer && s.blocked.includes(c.peer.id)));
  const reqs = all.filter((c) => c.status === 'pedido');
  const chats = all.filter((c) => c.status === 'aceite');
  const base = tab === 'Pedidos' ? reqs : tab === 'Grupos' ? chats.filter((c) => c.kind === 'grupo') : tab === 'Não lidas' ? chats.filter((c) => c.unread > 0) : chats;
  const shown = base.filter((c) => (c.title + (c.peer?.handle ?? '')).toLowerCase().includes(q.toLowerCase()));
  const pShown = (people ?? []).filter((p) => (p.name + p.handle).toLowerCase().includes(pq.toLowerCase()));

  return (
    <Page title="Mensagens" back="/">
      <input className="input mb-3 w-full" placeholder="🔍 Pesquisar conversas e grupos" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisar conversas" />
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {T.map((t) => {
          const n = t === 'Pedidos' ? reqs.length : t === 'Não lidas' ? chats.filter((c) => c.unread > 0).length : 0;
          return <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-neon/25 text-neon2' : 'bg-panel2 text-white/70'}`}>{t}{n ? ` · ${n}` : ''}</button>;
        })}
      </div>
      {tab === 'Pedidos' && <p className="mb-2 text-xs text-white/50">Pedidos de quem não segues. Só sabem que leste depois de aceitares.</p>}
      {list === null && <div className="space-y-1">{[0, 1, 2, 3].map((i) => <div key={i} className="flex items-center gap-3 py-2"><span className="skeleton h-14 w-14 rounded-full" /><span className="flex-1 space-y-2"><span className="skeleton block h-3.5 w-1/2 rounded" /><span className="skeleton block h-3 w-3/4 rounded" /></span></div>)}</div>}
      {list && shown.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/25 text-2xl">{tab === 'Grupos' ? '👥' : '✉️'}</span>
          <p className="font-bold">{tab === 'Pedidos' ? 'Sem pedidos' : q ? 'Nada encontrado' : tab === 'Grupos' ? 'Ainda sem grupos' : tab === 'Não lidas' ? 'Tudo lido ✅' : 'Ainda sem mensagens'}</p>
          {tab === 'Grupos' && <Link href="/mensagens/grupo?novo=1" className="btn mt-1">Criar grupo</Link>}
          {tab === 'Todas' && !q && <><p className="text-sm text-white/60">Segue alguém e toca em “Mensagem” no perfil, ou começa aqui.</p><button type="button" onClick={() => setPick(true)} className="btn mt-1">Nova conversa</button></>}
        </div>
      )}
      <ul>
        {shown.map((c) => {
          const on = c.peer && lib?.isOnline(c.peer.id);
          return (
            <li key={c.id}>
              <Link href={`/mensagens/chat?c=${encodeURIComponent(c.id)}`} className="flex min-h-[72px] items-center gap-3 py-2">
                <span className="relative"><Avatar a={c.photo} name={c.title} size={54} />{on && <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-bg bg-lime" aria-label="Online" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2"><span className={`min-w-0 flex-1 truncate text-base ${c.unread ? 'font-bold' : 'font-semibold'}`}>{c.title}{c.peer?.verified && ' ✅'}</span><span className={`shrink-0 text-xs ${c.unread ? 'text-lime' : 'text-white/45'}`}>{lib?.timeLabel(c.lastAt)}</span></p>
                  <p className="flex items-center gap-2 text-sm">
                    <span className={`min-w-0 flex-1 truncate ${c.unread ? 'text-white' : 'text-white/55'}`}>
                      {c.lastFromMe ? 'Tu: ' : c.kind === 'grupo' && c.lastSenderName ? `${c.lastSenderName}: ` : ''}{c.preview || (c.kind === 'grupo' ? 'Grupo criado' : 'Nova conversa')}
                    </span>
                    {c.muted && <span className="text-white/40" aria-label="Silenciada">🔕</span>}
                    {c.unread > 0 && <span className="min-w-[22px] rounded-full bg-lime px-1.5 text-center text-[12px] font-bold leading-[22px] text-black">{c.unread > 99 ? '99+' : c.unread}</span>}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <button type="button" onClick={() => setPick(true)} className="fixed bottom-24 right-[max(1rem,calc(50%-14rem+1rem))] z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-neon text-2xl shadow-lg" aria-label="Nova conversa ou grupo">✏️</button>

      <Sheet open={pick} onClose={() => setPick(false)} title="Nova conversa">
        <div className="mb-3 divide-y divide-line overflow-hidden rounded-2xl bg-panel2">
          <button onClick={() => { setPick(false); router.push('/mensagens/grupo?novo=1'); }} className="flex min-h-[56px] w-full items-center gap-3 px-3 text-left"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-neon text-xl">👥</span><span className="font-semibold">Novo grupo</span></button>
        </div>
        <input className="input mb-3 w-full" placeholder="Pesquisar quem segues" value={pq} onChange={(e) => setPq(e.target.value)} aria-label="Pesquisar pessoas" />
        <p className="mb-2 text-xs text-white/50">Podes enviar mensagem a quem segues.</p>
        <PeopleList people={pShown} loading={people === null} empty={s.following.length ? 'Ninguém encontrado.' : 'Ainda não segues ninguém. Segue jogadores em Explorar para lhes enviar mensagem.'}
          onPick={(p) => { setPick(false); router.push(`/mensagens/chat?u=${encodeURIComponent(p.id)}`); }} />
        {!s.following.length && <Link href="/explorar" className="btn mt-3 w-full" onClick={() => setPick(false)}>Explorar</Link>}
      </Sheet>
    </Page>
  );
}
