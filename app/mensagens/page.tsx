'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Page, Tabs, AvatarFace, Sheet } from '@/components/ui';
import { PeopleList } from '@/components/Social';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import type { DmConversation } from '@/lib/dm';
import type { Person } from '@/lib/social';

const T = ['Conversas', 'Pedidos'] as const;

export default function Mensagens() {
  const { s, ready } = useStore();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof T)[number]>('Conversas');
  const [list, setList] = useState<DmConversation[] | null>(null);
  const [q, setQ] = useState('');
  const [timeLabel, setTL] = useState<(i: string) => string>(() => () => '');
  const [pick, setPick] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [pq, setPq] = useState('');

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const load = () => import('@/lib/dm').then(async (m) => {
      setTL(() => m.timeLabel);
      const l = await m.listConversations();
      if (alive) setList(l);
    }).catch(() => { if (alive) setList((x) => x ?? []); });
    void load();
    // Caixa de entrada atualiza sozinha enquanto está aberta (novas mensagens chegam sem recarregar)
    const iv = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    return () => { alive = false; clearInterval(iv); };
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

  const reqs = (list ?? []).filter((c) => c.status === 'pedido');
  const chats = (list ?? []).filter((c) => c.status === 'aceite' && !s.blocked.includes(c.peer.id));
  const shown = (tab === 'Pedidos' ? reqs : chats).filter((c) => (c.peer.name + c.peer.handle).toLowerCase().includes(q.toLowerCase()));
  const pShown = (people ?? []).filter((p) => (p.name + p.handle).toLowerCase().includes(pq.toLowerCase()));

  return (
    <Page title="Mensagens" back="/">
      <div className="mb-3 flex items-center gap-2">
        <input className="input min-w-0 flex-1" placeholder="Pesquisar conversas" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisar conversas" />
        <button type="button" onClick={() => setPick(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neon text-lg" aria-label="Nova mensagem">✏️</button>
      </div>
      <Tabs tabs={T} value={tab} onChange={setTab} />
      {reqs.length > 0 && tab === 'Conversas' && <button onClick={() => setTab('Pedidos')} className="mb-3 flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-line bg-panel px-3.5 py-2 text-left text-sm"><span>📨</span><span className="flex-1">{reqs.length} pedido(s) de mensagem de pessoas que não segues</span><span className="text-white/40">›</span></button>}
      {tab === 'Pedidos' && <p className="mb-2 text-xs text-white/50">Pedidos de quem não segues. Só sabem que leste depois de aceitares.</p>}
      {list === null && <div className="space-y-1">{[0, 1, 2, 3].map((i) => <div key={i} className="flex items-center gap-3 py-2"><span className="skeleton h-14 w-14 rounded-full" /><span className="flex-1 space-y-2"><span className="skeleton block h-3.5 w-1/2 rounded" /><span className="skeleton block h-3 w-3/4 rounded" /></span></div>)}</div>}
      {list && shown.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/25 text-2xl">✉️</span>
          <p className="font-bold">{tab === 'Pedidos' ? 'Sem pedidos' : q ? 'Nenhuma conversa encontrada' : 'Ainda sem mensagens'}</p>
          {tab === 'Conversas' && !q && <><p className="text-sm text-white/60">Segue alguém e toca em “Mensagem” no perfil, ou começa aqui.</p><button type="button" onClick={() => setPick(true)} className="btn mt-1">Nova mensagem</button></>}
        </div>
      )}
      <ul>
        {shown.map((c) => (
          <li key={c.id}>
            <Link href={`/mensagens/chat?c=${encodeURIComponent(c.id)}`} className="flex min-h-[68px] items-center gap-3 py-2">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel2 text-2xl"><AvatarFace a={c.peer.avatar} name={c.peer.name} fill /></span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${c.unread ? 'font-bold' : 'font-semibold'}`}>{c.peer.name}{c.peer.verified && ' ✅'} {c.muted && <span className="text-white/40">🔕</span>}</p>
                <p className="flex min-w-0 gap-1 text-[13px]"><span className={`min-w-0 truncate ${c.unread ? 'font-semibold text-white' : 'text-white/55'}`}>{c.lastFromMe ? 'Tu: ' : ''}{c.preview || 'Nova conversa'}</span>{c.lastAt ? <span className="shrink-0 text-white/40">· {timeLabel(c.lastAt)}</span> : null}</p>
              </div>
              {c.unread > 0 ? <span className="min-w-[22px] rounded-full bg-neon px-1.5 text-center text-[12px] font-bold leading-[22px]">{c.unread > 9 ? '9+' : c.unread}</span> : null}
            </Link>
          </li>
        ))}
      </ul>

      <Sheet open={pick} onClose={() => setPick(false)} title="Nova mensagem">
        <input className="input mb-3 w-full" placeholder="Pesquisar quem segues" value={pq} onChange={(e) => setPq(e.target.value)} aria-label="Pesquisar pessoas" />
        <p className="mb-2 text-xs text-white/50">Podes enviar mensagem a quem segues.</p>
        <PeopleList people={pShown} loading={people === null} empty={s.following.length ? 'Ninguém encontrado.' : 'Ainda não segues ninguém. Segue jogadores em Explorar para lhes enviar mensagem.'}
          onPick={(p) => { setPick(false); router.push(`/mensagens/chat?u=${encodeURIComponent(p.id)}`); }} />
        {!s.following.length && <Link href="/explorar" className="btn mt-3 w-full" onClick={() => setPick(false)}>Explorar</Link>}
      </Sheet>
    </Page>
  );
}
