'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CLIPS, IDOLS, LIVES, POSTS, divisionFor, fmt, idol, levelFor } from '@/lib/data';
import { useStore } from '@/lib/store';
import { MoreMenu } from '@/components/Moderation';
import { SponsoredCard } from '@/components/Sponsored';
import { ClipThumb, CommentsSheet, FollowButton, IdolChip, LiveCard, Page, ReactionBar, Section, ShareSheet, Shelf, Tabs, TournamentCard, Verified, AvatarFace } from '@/components/ui';
import { GAMES, byHot, byNew, clipType, feedHref, isLong } from '@/lib/feed';

const TABS = ['Para ti', 'Lives', 'Torneios', 'Clipes', 'Seguindo'] as const;
type Tab = (typeof TABS)[number];

function PostCard({ id }: { id: string }) {
  const p = POSTS.find((x) => x.id === id)!;
  const i = idol(p.idolId);
  const { s, toggleLike, toggleSave, isSaved } = useStore();
  const [cOpen, setC] = useState(false);
  const [shOpen, setSh] = useState(false);
  const liked = s.liked.includes(p.id);
  const ncom = (s.comments[p.id] ?? []).length;
  return (
    <article className="card mb-3">
      <div className="mb-2 flex items-center gap-1">
      <Link href={`/idolo/${i.id}`} className="flex flex-1 items-center gap-2">
        <span className="overflow-hidden flex h-10 w-10 items-center justify-center rounded-full bg-panel2 text-2xl"><AvatarFace a={i.avatar} name={i.name} fill /></span>
        <div className="flex-1">
          <p className="text-sm font-semibold">{i.name}{i.verified && <Verified />}</p>
          <p className="text-xs text-white/50">{i.handle} · {p.time}</p>
        </div>
        <FollowButton idolId={i.id} small />
      </Link>
      <MoreMenu kind="post" target={p.id} label={p.text.slice(0, 40)} owner={i.id} ownerLabel={i.name} />
      </div>
      <p className="mb-3 text-sm">{p.emoji} {p.text}</p>
      <ReactionBar target={p.id} />
      <div className="mt-3 flex justify-between text-sm text-white/70">
        <button onClick={() => toggleLike(p.id)} className={liked ? 'text-pink' : ''}>{liked ? '❤️' : '🤍'} {fmt(p.likes + (liked ? 1 : 0))}</button>
        <button onClick={() => setC(true)}>💬 {fmt(p.comments + ncom)}</button>
        <button onClick={() => setSh(true)}>📤 Partilhar</button>
        <button onClick={() => toggleSave({ kind: 'post', id: p.id })}>{isSaved({ kind: 'post', id: p.id }) ? '🔖' : '📑'}</button>
      </div>
      <CommentsSheet open={cOpen} onClose={() => setC(false)} target={p.id} />
      <ShareSheet open={shOpen} onClose={() => setSh(false)} path={`/idolo/${i.id}`} text={`${i.name} no Social POIPAK:`} target={p.id} />
    </article>
  );
}

function XpStrip() {
  const { s } = useStore();
  const d = divisionFor(s.xp);
  const lv = levelFor(s.xp);
  return (
    <Link href="/missoes" className="card mb-5 flex items-center gap-3 !p-3">
      <span className="text-3xl">{d.emoji}</span>
      <div className="flex-1">
        <p className="text-sm font-semibold">Nível {lv.level} · {d.name}</p>
        <div className="mt-1 h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-gradient-to-r from-neon to-neon2" style={{ width: `${lv.pct}%` }} /></div>
      </div>
      <div className="text-right text-xs">
        <p className="font-bold text-amber-300">🔥 {s.streak} dias</p>
        <p className="text-white/50">{s.missions.claimed.length}/5 missões</p>
      </div>
    </Link>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('Para ti');
  const { s } = useStore();
  const featured = LIVES.find((l) => l.featured && (s.admin.liveStatus[l.id] ?? 'ao vivo') === 'ao vivo') ?? LIVES.find((l) => (s.admin.liveStatus[l.id] ?? 'ao vivo') === 'ao vivo');
  const followed = IDOLS.filter((i) => s.following.includes(i.id) && !s.blocked.includes(i.id));
  const visibleClips = CLIPS.filter((c) => !s.admin.hiddenClips.includes(c.id) && !s.blocked.includes(c.idolId));
  const short = visibleClips.filter((c) => !isLong(c));
  const long = visibleClips.filter(isLong);
  const posts = POSTS.filter((p) => !s.blocked.includes(p.idolId) && !s.admin.removed.includes(p.id));
  const lives = LIVES.filter((l) => (s.admin.liveStatus[l.id] ?? 'ao vivo') === 'ao vivo' && !s.blocked.includes(l.idolId));

  return (
    <Page>
      <div className="hero-bg" aria-hidden />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'Para ti' && (
        <>
          <XpStrip />
          {featured && <Section title="🔴 Live em destaque" href="/lives"><LiveCard l={featured} big /></Section>}
          <Section title="💜 Os teus ídolos" href="/idolos">
            <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
              {(followed.length ? followed : IDOLS).map((i) => <IdolChip key={i.id} i={i} />)}
              <Link href="/idolos" className="flex w-20 shrink-0 flex-col items-center gap-1"><span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-white/30 text-2xl">＋</span><span className="text-xs">Descobrir</span></Link>
            </div>
          </Section>
          {visibleClips.length === 0 ? (
            <div className="card mb-5 text-center">
              <p className="text-3xl">🎬😂📺</p>
              <p className="mt-1 text-sm text-white/70">Ainda não há publicações. Sê o primeiro: clipe, meme ou vídeo.</p>
              <Link href="/publicar" className="btn mt-3">＋ Publicar</Link>
            </div>
          ) : (
            <>
              <Shelf title="🔥 Em alta" href={feedHref('em-alta')} clips={byHot(short).slice(0, 12)} />
              <Shelf title="📺 Vídeos" href="/videos" clips={byNew(long)} wide />
              <Shelf title="😂 Memes" href={feedHref('memes')} clips={byNew(short.filter((c) => clipType(c) === 'meme'))} />
              <Shelf title="🎬 Clipes recentes" href={feedHref('videos')} clips={byNew(short.filter((c) => clipType(c) === 'video'))} />
              <Shelf title="📷 Fotos" href={feedHref('fotos')} clips={byNew(short.filter((c) => clipType(c) === 'photo'))} />
            </>
          )}
          {GAMES.filter((g) => g !== 'Memes' && g !== 'Geral').map((g) => <Shelf key={g} title={g} href={feedHref('g:' + g)} clips={byHot(short.filter((c) => c.game === g))} />)}
          <Section title="🏆 Torneios abertos" href="/torneios">
            <div className="space-y-3">{s.admin.tournaments.filter((t) => t.status === 'aberto').slice(0, 2).map((t) => <TournamentCard key={t.id} t={t} />)}</div>
          </Section>
          <Section title="📰 Feed">{posts.map((p, k) => <div key={p.id}><PostCard id={p.id} />{k === 1 && <SponsoredCard slot="home-1" />}</div>)}{posts.length < 2 && <SponsoredCard slot="home-1" />}</Section>
        </>
      )}

      {tab === 'Lives' && <div className="space-y-3">{lives.map((l) => <LiveCard key={l.id} l={l} big />)}</div>}

      {tab === 'Torneios' && <div className="space-y-3">{s.admin.tournaments.map((t) => <TournamentCard key={t.id} t={t} />)}</div>}

      {tab === 'Clipes' && (
        <>
          <Link href="/clipes" className="btn mb-4 w-full">▶ Abrir feed vertical</Link>
          <div className="grid grid-cols-3 gap-2">{visibleClips.map((c) => <ClipThumb key={c.id} id={c.id} />)}</div>
        </>
      )}

      {tab === 'Seguindo' && (
        followed.length === 0 ? (
          <div className="card text-center"><p className="mb-3">Ainda não segues ninguém.</p><Link href="/idolos" className="btn">Descobrir ídolos</Link></div>
        ) : (
          <>
            {lives.filter((l) => s.following.includes(l.idolId)).map((l) => <div key={l.id} className="mb-3"><LiveCard l={l} big /></div>)}
            {posts.filter((p) => s.following.includes(p.idolId)).map((p) => <PostCard key={p.id} id={p.id} />)}
            <div className="grid grid-cols-3 gap-2">{visibleClips.filter((c) => s.following.includes(c.idolId)).map((c) => <ClipThumb key={c.id} id={c.id} />)}</div>
          </>
        )
      )}
    </Page>
  );
}
