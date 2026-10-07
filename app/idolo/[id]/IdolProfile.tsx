'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CLIPS, DIVISIONS, IDOLS, LIVES, POSTS, fmt } from '@/lib/data';
import { useStore } from '@/lib/store';
import { MoreMenu } from '@/components/Moderation';
import { CheckoutSheet } from '@/components/LazyCheckout';
import { ClipThumb, FollowButton, LiveCard, Page, ShareSheet, Stat, Tabs, TournamentCard, Verified } from '@/components/ui';

const T = ['Publicações', 'Clipes', 'Lives', 'Torneios', 'Conquistas'] as const;
type Tb = (typeof T)[number];

function Missing({ what, back }: { what: string; back: string }) {
  return <Page title={what} back={back}><div className="card mt-6 text-center"><p className="text-4xl">🔎</p><p className="mt-2 text-sm text-white/70">{what} não encontrado ou ainda a carregar.</p></div></Page>;
}
export default function IdolProfile({ id }: { id: string }) {
  const i = IDOLS.find((x) => x.id === id);
  if (!i) return <Missing what="Perfil" back="/idolos" />;
  return <Inner i={i} />;
}

function Inner({ i }: { i: (typeof IDOLS)[number] }) {
  const [member, setMember] = useState(false);
  const { s, toast, set } = useStore();
  const [tab, setTab] = useState<Tb>('Publicações');
  const [sh, setSh] = useState(false);
  const following = s.following.includes(i.id);
  const d = DIVISIONS.find((x) => x.name === i.division)!;
  const notifKey = 'notif:' + i.id;
  const notifOn = s.liked.includes(notifKey);
  const clips = CLIPS.filter((c) => c.idolId === i.id);
  const lives = LIVES.filter((l) => l.idolId === i.id);
  const tours = s.admin.tournaments.filter((t) => t.organizer === i.name || t.organizer === i.team);

  return (
    <Page title={i.name} back="/idolos">
      <div className="-mx-4 -mt-4 h-28" style={{ background: `linear-gradient(135deg, ${i.color}, #0b0614)` }} />
      <div className="-mt-12 mb-3 flex items-end gap-3">
        <span className="flex h-24 w-24 items-center justify-center rounded-full border-4 bg-panel text-5xl" style={{ borderColor: i.color, boxShadow: `0 0 20px ${i.color}` }}>{i.avatar}</span>
        <div className="flex-1 pb-2">
          <p className="text-xl font-bold">{i.name}{i.verified && <Verified />} <MoreMenu kind="utilizador" target={i.handle} label={i.name} owner={i.id} ownerLabel={i.name} /></p>
          {s.blocked.includes(i.id) && <p className="text-xs text-pink">🚫 Bloqueaste este utilizador</p>}
          {!s.blocked.includes(i.id) && <div className="mt-1 flex flex-wrap gap-2"><Link href={`/mensagens/chat?u=${encodeURIComponent(i.id)}`} className="btn-ghost !px-3 !py-1 text-xs">💬 Enviar mensagem</Link><button className="btn !px-3 !py-1 text-xs" onClick={() => setMember(true)}>👑 Tornar-me membro</button></div>}
          <p className="text-xs text-white/60">{i.handle} · {i.game}{i.team ? ` · ${i.team}` : ''}</p>
        </div>
      </div>
      <p className="mb-3 text-sm">{i.bio}</p>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="Seguidores" value={fmt(i.followers + (following ? 1 : 0))} />
        <Stat label="Divisão" value={<span style={{ color: d.color }}>{d.emoji} {i.division}</span>} />
        <Stat label="Ranking" value={`#${i.rank}`} />
      </div>
      <div className="mb-4 flex gap-2">
        <div className="flex-1"><FollowButton idolId={i.id} /></div>
        <button className={following ? 'btn-ghost' : 'btn-ghost opacity-50'} onClick={() => {
          if (!following) { toast('Segue primeiro para ativar notificações'); return; }
          set((p) => ({ ...p, liked: notifOn ? p.liked.filter((x) => x !== notifKey) : [...p.liked, notifKey] }));
          toast(notifOn ? 'Notificações desativadas' : `🔔 Vais ser avisado quando ${i.name} entrar em direto`);
        }}>{notifOn ? '🔔' : '🔕'}</button>
        <button className="btn-ghost" onClick={() => setSh(true)}>📤</button>
      </div>
      <Tabs tabs={T} value={tab} onChange={setTab} />
      {tab === 'Publicações' && (POSTS.filter((p) => p.idolId === i.id).map((p) => (
        <div key={p.id} className="card mb-2"><p className="text-sm">{p.emoji} {p.text}</p><p className="mt-1 text-[11px] text-white/50">{p.time} · ❤️ {fmt(p.likes)} · 💬 {p.comments}</p></div>
      )))}
      {tab === 'Clipes' && (clips.length ? <div className="grid grid-cols-3 gap-2">{clips.map((c) => <ClipThumb key={c.id} id={c.id} />)}</div> : <p className="text-sm text-white/60">Sem clipes ainda.</p>)}
      {tab === 'Lives' && (lives.length ? <div className="space-y-3">{lives.map((l) => <LiveCard key={l.id} l={l} big />)}</div> : <p className="text-sm text-white/60">Offline agora. Ativa o 🔔 para saber quando entrar em direto.</p>)}
      {tab === 'Torneios' && (tours.length ? <div className="space-y-3">{tours.map((t) => <TournamentCard key={t.id} t={t} />)}</div> : <p className="text-sm text-white/60">Sem torneios organizados.</p>)}
      {tab === 'Conquistas' && (
        <div className="space-y-2">{i.achievements.map((a) => <div key={a} className="card flex items-center gap-3 !p-3"><span className="text-2xl">🏅</span><span className="text-sm">{a}</span></div>)}</div>
      )}
      <ShareSheet open={sh} onClose={() => setSh(false)} path={`/idolo/${i.id}`} text={`Segue ${i.name} no Social POIPAK:`} target={i.id} />
      {member && <CheckoutSheet open={member} onClose={() => setMember(false)} title={`Membro de ${i.name}`} lines={[{ label: `Subscrição mensal · ${i.name}`, amount: 99 }]} recurring="mensal, cancela quando quiseres" onPaid={() => toast(`👑 Agora és membro de ${i.name}!`)} />}
    </Page>
  );
}
