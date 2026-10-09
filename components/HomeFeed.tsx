'use client';

// Início estilo Instagram: barra de topo, histórias (lives + quem segues) e feed de publicações numa coluna.
import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { Clip, Post, fmt, idol } from '@/lib/data';
import { ago, clipType, youtubeId, ytThumb } from '@/lib/feed';
import { useStore } from '@/lib/store';
import { MoreMenu } from './Moderation';
import { safePlay } from './SafeVideo';
import { MusicTag, useClipAudio } from './ClipAudio';
import type { ClipMedia } from '@/lib/media';
import { AvatarFace, BrandMark, CommentsSheet, ShareSheet, Verified } from './ui';

/* ---------------- Barra de topo ---------------- */
export function HomeTopBar() {
  const { s, ready } = useStore();
  const unread = s.notifs.filter((n) => !n.read).length;
  const [dm, setDm] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const tick = () => import('@/lib/dm').then((m) => m.unreadTotal()).then((n) => { if (alive) setDm(n); }).catch(() => {});
    const t = setTimeout(tick, 1200);
    const iv = setInterval(tick, 30000);
    return () => { alive = false; clearTimeout(t); clearInterval(iv); };
  }, [ready, s.account.loggedIn]);
  const badge = (n: number) => n > 0 && <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-pink px-1 text-center text-[11px] font-bold leading-[18px] text-white">{n > 9 ? '9+' : n}</span>;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-line bg-bg/95 pl-3 pr-1">
      <Link href="/" className="flex min-h-[44px] flex-1 items-center gap-2" aria-label="TXAPILOG — Início">
        <BrandMark height={30} />
      </Link>
      <Link href="/notificacoes" className="relative flex h-11 w-11 items-center justify-center text-[22px]" aria-label={`Notificações${unread ? ` (${unread} novas)` : ''}`}>🤍{badge(unread)}</Link>
      <Link href="/mensagens" className="relative flex h-11 w-11 items-center justify-center text-[22px]" aria-label={`Mensagens${dm ? ` (${dm} por ler)` : ''}`}>✉️{badge(dm)}</Link>
    </header>
  );
}

/* ---------------- Histórias ---------------- */
export interface Story { key: string; href: string; name: string; avatar: string; live?: boolean }

export function StoriesRow({ stories, onAdd, loading }: { stories: Story[]; onAdd: () => void; loading?: boolean }) {
  const { s } = useStore();
  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto border-b border-line px-3 py-3" aria-label="Histórias">
      <button type="button" onClick={onAdd} className="flex w-[72px] shrink-0 flex-col items-center gap-1" aria-label="Criar a tua história">
        <span className="relative flex h-[66px] w-[66px] items-center justify-center rounded-full border border-line bg-panel2 text-3xl">
          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full"><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg bg-neon text-base font-bold leading-none text-white">+</span>
        </span>
        <span className="w-full truncate text-center text-[11px] text-white/70">A tua história</span>
      </button>
      {loading && [0, 1, 2, 3].map((k) => <span key={k} className="flex w-[72px] shrink-0 flex-col items-center gap-1"><span className="skeleton h-[66px] w-[66px] rounded-full" /><span className="skeleton h-3 w-12 rounded" /></span>)}
      {stories.map((st) => (
        <Link key={st.key} href={st.href} className="flex w-[72px] shrink-0 flex-col items-center gap-1">
          <span className={`relative rounded-full p-[2.5px] ${st.live ? 'bg-neon' : 'bg-white/70'}`}>
            <span className="flex h-[61px] w-[61px] items-center justify-center overflow-hidden rounded-full border-2 border-bg bg-panel2 text-3xl"><AvatarFace a={st.avatar} name={st.name} fill /></span>
            {st.live && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-neon px-1 text-[9px] font-bold leading-[14px] text-ink">AO VIVO</span>}
          </span>
          <span className="w-full truncate text-center text-[12px] text-white/80">{st.name}</span>
        </Link>
      ))}
    </div>
  );
}

/* ---------------- Vídeo do feed: só carrega perto do ecrã, toca sem som quando visível ---------------- */
function FeedVideo({ src, poster, muted, media }: { src: string; poster?: string; muted: boolean; media?: ClipMedia }) {
  const box = useRef<HTMLDivElement>(null);
  const v = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const [corsOff, setCorsOff] = useState(false);
  const boost = ((media?.gain ?? 1) * (media?.orig ?? 1)) > 1.01 && !/^(blob|data):/.test(src) && !corsOff;
  // A música segue o vídeo (play/pausa/loop); o vídeo só toca quando está visível
  useClipAudio(v, media, { active: true, muted, near, videoKey: `${near}|${failed}|${boost}` });
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setNear(true);
      const vid = v.current;
      if (!vid) return;
      if (e.intersectionRatio >= 0.6) safePlay(vid); else vid.pause();
    }, { rootMargin: '300px 0px', threshold: [0, 0.6, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (v.current) v.current.muted = muted; }, [muted]);
  return (
    <div ref={box} className="absolute inset-0">
      {near && !failed ? (
        <video key={String(boost)} ref={v} src={src} poster={poster} muted={muted} loop playsInline preload="metadata" crossOrigin={boost ? 'anonymous' : undefined}
          onError={() => (boost ? setCorsOff(true) : setFailed(true))}
          onLoadedData={(e) => { const r = box.current?.getBoundingClientRect(); if (r && r.top < innerHeight * 0.6 && r.bottom > innerHeight * 0.4) safePlay(e.currentTarget); }}
          className="h-full w-full bg-black object-cover" />
      ) : poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : null}
      {failed && <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white/70">Vídeo indisponível</span>}
    </div>
  );
}

/** Foto/momento com música: toca quando a publicação está visível (e o som ligado). */
function FeedMusic({ media, muted }: { media: ClipMedia; muted: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { setNear(e.isIntersecting); setVis(e.intersectionRatio >= 0.6); }, { rootMargin: '300px 0px', threshold: [0, 0.6, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useClipAudio(null, media, { active: vis, muted, near, videoKey: 'm' });
  return <span ref={box} className="hidden" aria-hidden />;
}

function LazyImg({ src, contain }: { src: string; contain?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <>
      {!ok && <span className="skeleton absolute inset-0" aria-hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" decoding="async" onLoad={() => setOk(true)}
        className={`absolute inset-0 h-full w-full ${contain ? 'bg-black object-contain' : 'object-cover'} transition-opacity ${ok ? 'opacity-100' : 'opacity-0'}`} />
    </>
  );
}

/* ---------------- Publicação ---------------- */
export type FeedItem = { kind: 'clip'; c: Clip } | { kind: 'post'; p: Post };

export function FeedPost({ item, muted, setMuted, liveIds }: { item: FeedItem; muted: boolean; setMuted: (m: boolean) => void; liveIds: Set<string> }) {
  const { s, toggleLike, toggleSave, isSaved } = useStore();
  const [cOpen, setC] = useState(false);
  const [shOpen, setSh] = useState(false);
  const [more, setMore] = useState(false);
  const [heart, setHeart] = useState(0);
  const lastTap = useRef(0);
  const single = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isClip = item.kind === 'clip';
  const id = isClip ? item.c.id : item.p.id;
  const authorId = isClip ? item.c.idolId : item.p.idolId;
  const a = idol(authorId);
  const liked = s.liked.includes(id);
  const likes = (isClip ? item.c.likes : item.p.likes) + (liked ? 1 : 0);
  const ncom = (isClip ? item.c.comments : item.p.comments) + (s.comments[id] ?? []).length;
  const caption = isClip ? [item.c.title, item.c.description].filter(Boolean).join(' — ') : `${item.p.emoji} ${item.p.text}`;
  const when = isClip ? ago(item.c.createdAt) : item.p.time;
  const game = isClip ? item.c.game : a.game;
  const savedKey = { kind: isClip ? 'clipe' : 'post', id } as const;
  const t = isClip ? clipType(item.c) : 'text';
  const isVideo = isClip && t === 'video' && !!item.c.video;
  const music = isClip && t !== 'long' ? item.c.media?.music : undefined;
  const soundy = isVideo || !!music;

  const like = () => { if (!liked) toggleLike(id); setHeart(Date.now()); };
  const onMediaTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) { if (single.current) clearTimeout(single.current); lastTap.current = 0; like(); return; }
    lastTap.current = now;
    if (soundy) { const m = !muted; if (!m) void import('@/lib/media').then((x) => x.unlockAudio()); single.current = setTimeout(() => setMuted(m), 280); }
  };

  let media: React.ReactNode = null;
  if (isClip) {
    const c = item.c;
    const img = c.image || c.thumb;
    if (t === 'long') {
      const yt = youtubeId(c.video);
      const poster = c.thumb || (yt ? ytThumb(yt) : undefined);
      media = (
        <Link href={`/videos?v=${encodeURIComponent(c.id)}`} className={`relative block aspect-video bg-gradient-to-br ${c.gradient}`} aria-label={`Ver vídeo: ${c.title}`}>
          {poster ? <LazyImg src={poster} /> : <span className="absolute inset-0 flex items-center justify-center text-5xl">{c.emoji}</span>}
          <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-2xl">▶</span></span>
        </Link>
      );
    } else if (t === 'text') {
      media = (
        <div onClick={onMediaTap} className={`relative flex aspect-square select-none items-center justify-center bg-gradient-to-br ${c.gradient} p-8 text-center text-xl font-bold leading-snug`}>
          {c.title}
          {music && c.media && <FeedMusic media={c.media} muted={muted} />}
          {music && <span className="pointer-events-none absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-sm" aria-hidden>{muted ? '🔇' : '🔊'}</span>}
        </div>
      );
    } else {
      const box = t === 'meme' ? 'aspect-square' : 'aspect-[4/5]';
      media = (
        <div onClick={onMediaTap} className={`relative ${box} select-none overflow-hidden bg-gradient-to-br ${c.gradient}`}>
          {music && !isVideo && c.media && <FeedMusic media={c.media} muted={muted} />}
          {isVideo ? <FeedVideo src={c.video!} poster={c.thumb} muted={muted} media={c.media} />
            : img ? <LazyImg src={img} contain={t === 'meme'} />
            : <span className="absolute inset-0 flex items-center justify-center text-6xl opacity-80">{c.emoji}</span>}
          {soundy && <span className="pointer-events-none absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-sm" aria-hidden>{muted ? '🔇' : '🔊'}</span>}
        </div>
      );
    }
  }

  return (
    <article className="border-b border-line pb-3">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Link href={`/idolo/${a.id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5">
          <span className={`shrink-0 rounded-full p-[2px] ${liveIds.has(a.id) ? 'bg-neon' : 'bg-transparent'}`}>
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-bg bg-panel2 text-lg"><AvatarFace a={a.avatar} name={a.name} fill /></span>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight">{a.name}{a.verified && <Verified />}</span>
            {game && <span className="block truncate text-[12px] leading-tight text-white/55">🎮 {game}</span>}
          </span>
        </Link>
        <MoreMenu kind={isClip ? 'clipe' : 'post'} target={id} label={caption.slice(0, 40)} owner={a.id} ownerLabel={a.name} className="flex h-11 w-11 items-center justify-center" />
      </div>

      {media && <div className="relative">
        {media}
        {heart > 0 && <span key={heart} className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl animate-pop" aria-hidden>❤️</span>}
      </div>}

      <div className="flex items-center px-1.5 pt-1">
        <button type="button" onClick={() => toggleLike(id)} aria-pressed={liked} aria-label={liked ? 'Remover gosto' : 'Curtir'} className={`flex h-11 w-11 items-center justify-center text-[24px] ${liked ? '' : 'opacity-90'}`}>{liked ? '❤️' : '🤍'}</button>
        <button type="button" onClick={() => setC(true)} aria-label="Comentar" className="flex h-11 w-11 items-center justify-center text-[22px]">💬</button>
        <button type="button" onClick={() => setSh(true)} aria-label="Partilhar" className="flex h-11 w-11 items-center justify-center text-[22px]">↗️</button>
        <span className="flex-1" />
        <button type="button" onClick={() => toggleSave(savedKey)} aria-pressed={isSaved(savedKey)} aria-label={isSaved(savedKey) ? 'Remover dos guardados' : 'Guardar'} className={`flex h-11 w-11 items-center justify-center text-[22px] ${isSaved(savedKey) ? '' : 'opacity-60 grayscale'}`}>🔖</button>
      </div>

      <div className="space-y-1 px-3">
        {music && <MusicTag media={item.kind === 'clip' ? item.c.media : undefined} className="max-w-full" />}
        <p className="text-sm font-semibold">{fmt(likes)} {likes === 1 ? 'gosto' : 'gostos'}</p>
        {caption && (
          <p className={`break-words text-sm ${more ? 'whitespace-pre-line' : 'line-clamp-2'}`}>
            <Link href={`/idolo/${a.id}`} className="mr-1.5 font-semibold">{a.name}</Link>{caption}
          </p>
        )}
        {!more && caption.length > 90 && <button type="button" onClick={() => setMore(true)} className="text-sm text-white/55">mais</button>}
        <button type="button" onClick={() => setC(true)} className="block min-h-[28px] text-sm text-white/55">
          {ncom > 0 ? (ncom === 1 ? 'Ver 1 comentário' : `Ver todos os ${fmt(ncom)} comentários`) : 'Adicionar um comentário…'}
        </button>
        {when && <p className="text-[12px] text-white/45">{when}</p>}
      </div>

      {cOpen && <CommentsSheet open={cOpen} onClose={() => setC(false)} target={id} />}
      {shOpen && <ShareSheet open={shOpen} onClose={() => setSh(false)} path={isClip ? `/clipe/${id}` : `/idolo/${a.id}`} text={`${a.name} no TXAPILOG:`} target={id} />}
    </article>
  );
}

export function FeedSkeleton() {
  return (
    <div aria-busy="true" aria-label="A carregar publicações">
      {[0, 1].map((k) => (
        <div key={k} className="border-b border-line pb-4">
          <div className="flex items-center gap-2.5 px-3 py-3"><span className="skeleton h-9 w-9 rounded-full" /><span className="skeleton h-3.5 w-32 rounded" /></div>
          <div className="skeleton aspect-[4/5]" />
          <div className="space-y-2 px-3 pt-3"><span className="skeleton block h-3.5 w-24 rounded" /><span className="skeleton block h-3.5 w-3/4 rounded" /></div>
        </div>
      ))}
    </div>
  );
}
