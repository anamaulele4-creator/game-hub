'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Clip, GIFTS, PLAYERS, fmt, idol } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { CommentsSheet, FollowButton, ReactionBar, ShareSheet, Sheet, Verified } from './ui';
import { MoreMenu } from './Moderation';
import { HotBadge } from './ClipExtras';
import { clipType, videoHref } from '@/lib/feed';
import { VideoFailed, safePlay, useVideoRecovery } from './SafeVideo';

export function ClipSlide({ c, muted, setMuted, height = 'feed-h' }: { c: Clip; muted: boolean; setMuted: (m: boolean) => void; height?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [near, setNear] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hearts, setHearts] = useState<number[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const [imgOk, setImgOk] = useState(false);
  const [cOpen, setC] = useState(false);
  const [shOpen, setSh] = useState(false);
  const [chOpen, setCh] = useState(false);
  const [gOpen, setG] = useState(false);
  const lastTap = useRef(0);
  const counted = useRef(false);
  const viewSent = useRef(false);
  const [views, setViews] = useState(c.views);
  const kind = c.kind ?? 'video';
  const t = clipType(c);
  const long = t === 'long';
  const isVideo = kind === 'video' && !!c.video && !long;
  const rec = useVideoRecovery(isVideo ? c.video : undefined);
  const { s, toggleLike, toggleSave, isSaved, track, set, unlock, toast } = useStore();
  const i = idol(c.idolId);
  const liked = s.liked.includes(c.id);
  const saved = isSaved({ kind: 'clipe', id: c.id });
  const ncom = (s.comments[c.id] ?? []).reduce((a, x) => a + 1 + x.replies.length, 0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio > 0.6), { threshold: [0, 0.6, 1] });
    // Só carrega o vídeo quando o clipe está a 1 ecrã de distância (poupa dados e acelera o feed)
    // e descarrega-o quando fica longe (liberta memória em telemóveis baratos)
    const pre = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '100% 0px' });
    io.observe(el);
    pre.observe(el);
    return () => { io.disconnect(); pre.disconnect(); };
  }, []);

  // Autoplay quando visível
  useEffect(() => {
    const v = vid.current;
    if (visible && !paused) {
      if (v) {
        v.muted = muted;
        // Se o navegador recusar som sem toque, toca sem som e mostra "Toca para ativar o som"
        safePlay(v, () => { if (!v.muted) { v.muted = true; setMuted(true); safePlay(v); } });
      }
      const t = setTimeout(() => { if (!counted.current) { counted.current = true; track('watch'); } }, 2500);
      // Conta 1 visualização após 3 s visível (servidor: 1 por pessoa por clipe a cada 24 h)
      const tv = setTimeout(() => {
        if (viewSent.current) return;
        viewSent.current = true;
        void import('@/lib/clips').then((m) => m.recordView(c.id, 3000, false)).then((n) => { if (n != null) setViews(n); }).catch(() => {});
      }, 3000);
      return () => { clearTimeout(t); clearTimeout(tv); };
    }
    v?.pause();
  }, [visible, paused, near, rec.url, rec.failed, track, c.id, muted, setMuted]);


  const onTap = () => {
    // 1.º toque num vídeo sem som = ativar o som (não pausa)
    if (isVideo && muted && vid.current) {
      vid.current.muted = false;
      safePlay(vid.current);
      setMuted(false);
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (!liked) toggleLike(c.id);
      setHearts((h) => [...h, now]);
      setTimeout(() => setHearts((h) => h.filter((x) => x !== now)), 900);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
      setTimeout(() => { if (lastTap.current === now) setPaused((p) => !p); }, 310);
    }
  };

  const challenge = (to: string) => {
    set((p) => ({ ...p, challenges: [{ id: 'ch' + Date.now(), to, game: `Replica: ${c.title}`, stake: 'Por diversão', status: 'enviado' }, ...p.challenges] }));
    unlock('a10');
    toast(`⚔️ Desafio enviado a ${to}`);
    setCh(false);
  };

  return (
    <div ref={ref} className={`snap-item relative w-full overflow-hidden ${height} ${t === 'photo' || t === 'meme' ? 'bg-black' : `bg-gradient-to-br ${c.gradient}`}`} onClick={onTap}>
      {(t === 'photo' || t === 'meme') && c.image ? (
        <div className="absolute inset-x-0 top-20 bottom-36 flex items-center justify-center px-2">
          {!imgOk && <div className="skeleton absolute inset-x-2 inset-y-0 rounded-2xl" aria-hidden />}
          {/* Só pede a imagem quando está perto do ecrã */}
          {(near || visible) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.image} alt={c.title} loading="lazy" decoding="async" onLoad={() => setImgOk(true)}
              className={`relative max-h-full max-w-full rounded-xl object-contain transition-opacity duration-200 ${imgOk ? 'opacity-100' : 'opacity-0'}`} />
          )}
        </div>
      ) : long ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black p-4 pb-40" onClick={(e) => e.stopPropagation()}>
          {c.thumb && (near || visible) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.thumb} alt={c.title} loading="lazy" className="aspect-video w-full rounded-xl object-cover" />
          )}
          <Link href={videoHref(c.id)} className="btn">📺 Ver vídeo completo</Link>
        </div>
      ) : kind === 'text' ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 pb-44 pr-20">
          <div className="w-full rounded-3xl bg-black/50 p-6">
            <p className="mb-2 text-xs text-white/60">💭 Momento</p>
            <p className="whitespace-pre-wrap break-words text-xl font-bold leading-snug">{c.title}</p>
            {c.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-white/80">{c.description}</p>}
          </div>
        </div>
      ) : isVideo ? (
        rec.failed ? (
          <VideoFailed poster={c.thumb} onRetry={rec.retry} />
        ) : near ? (
          <video key={rec.url} ref={vid} src={rec.url} poster={c.thumb} className="absolute inset-0 h-full w-full bg-black object-cover" loop playsInline muted={muted} preload={visible ? 'auto' : 'metadata'}
            onError={rec.fail} onStalled={rec.onStalled} onProgress={rec.onProgressOk} onCanPlay={rec.onProgressOk}
            onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration && bar.current) bar.current.style.width = `${(v.currentTime / v.duration) * 100}%`; }} />
        ) : (
          <div className="skeleton absolute inset-0" aria-hidden />
        )
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[120px]">{c.emoji}</span>
        </div>
      )}
      {t === 'meme' && <span className="pointer-events-none absolute left-3 top-24 z-10 rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-bold text-black">😂 Meme</span>}
      {isVideo && !rec.failed && muted && visible && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-10 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-sm font-semibold">🔇 Toca no vídeo para ativar o som</div>
      )}
      {paused && <div className="absolute inset-0 flex items-center justify-center text-7xl opacity-80">▶</div>}
      {hearts.map((h) => <span key={h} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-pop text-8xl">💜</span>)}

      <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4 text-center text-xs" onClick={(e) => e.stopPropagation()}>
        <Link href={`/idolo/${i.id}`} className="flex h-12 w-12 items-center justify-center rounded-full border-2 bg-black/40 text-2xl" style={{ borderColor: i.color }}>{i.avatar}</Link>
        <button onClick={() => toggleLike(c.id)} aria-label="Gosto"><span className="block text-3xl">{liked ? '💜' : '🤍'}</span>{fmt(c.likes + (liked ? 1 : 0))}</button>
        <button onClick={() => setC(true)} aria-label="Comentários"><span className="block text-3xl">💬</span>{fmt(c.comments + ncom)}</button>
        <button onClick={() => toggleSave({ kind: 'clipe', id: c.id })} aria-label="Guardar"><span className="block text-3xl">{saved ? '🔖' : '📑'}</span>{saved ? 'Guardado' : 'Guardar'}</button>
        <button onClick={() => setSh(true)} aria-label="Partilhar"><span className="block text-3xl">📤</span>{fmt(c.shares)}</button>
        <button onClick={() => setG(true)} aria-label="Oferecer presente"><span className="block text-3xl">🎁</span>Oferecer</button>
        <button onClick={() => setCh(true)} aria-label="Desafiar"><span className="block text-3xl">⚔️</span>Desafio</button>
        <MoreMenu kind="clipe" target={c.id} label={c.title} owner={i.id} ownerLabel={i.name} className="bg-black/40 py-1 text-2xl" />
        <button onClick={() => { const m = !muted; if (vid.current) { vid.current.muted = m; if (!m) safePlay(vid.current); } setMuted(m); }} aria-label="Som"><span className="block text-2xl">{muted ? '🔇' : '🔊'}</span></button>
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 p-4 pb-20 pr-20" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <Link href={`/idolo/${i.id}`} className="font-semibold">{i.name}{i.verified && <Verified />}</Link>
          <FollowButton idolId={i.id} small />
        </div>
        <HotBadge id={c.id} className="mb-1 inline-block" />
        {kind !== 'text' && <p className="mb-1 text-sm">{c.title}</p>}
        {(t === 'photo' || t === 'meme') && c.description && <p className="mb-1 line-clamp-2 text-xs text-white/80">{c.description}</p>}
        <p className="mb-2 text-xs text-white/60">{c.game} · 👁 {fmt(views)} visualizações · {c.tags.map((t) => '#' + t).join(' ')}</p>
        <ReactionBar target={c.id} />
      </div>
      {isVideo && <div className="absolute bottom-16 left-0 right-0 h-0.5 bg-white/20"><div ref={bar} className="h-0.5 bg-neon2" style={{ width: 0 }} /></div>}

      <div onClick={(e) => e.stopPropagation()}>
        <CommentsSheet open={cOpen} onClose={() => setC(false)} target={c.id} />
        <ShareSheet open={shOpen} onClose={() => setSh(false)} path={`/clipe/${c.id}`} text={`Vê este clipe de ${i.name} no Social POIPAK:`} target={c.id} />
        <Sheet open={gOpen} onClose={() => setG(false)} title={`🎁 Oferecer a ${i.name}`}>
          <p className="mb-2 text-xs text-white/60">Tens {s.coins} moedas. O criador recebe a maior parte do valor.</p>
          <div className="grid grid-cols-5 gap-2">
            {GIFTS.map((g) => (
              <button key={g.id} className="flex flex-col items-center rounded-xl bg-panel2 p-2 text-xs" onClick={async () => {
                if (s.coins < g.coins) { toast('Moedas insuficientes. Compra moedas numa live.'); return; }
                if (!IS_DEMO) { const r = await (await import('@/lib/monetization')).sendGift(c.idolId, 'clipe', c.id, g.id, g.coins); if (!r.ok) { toast(r.error!); return; } }
                set((p) => ({ ...p, coins: p.coins - g.coins }));
                toast(`${g.emoji} ${g.name} enviado a ${i.name}!`); setG(false);
              }}><span className="text-2xl">{g.emoji}</span>{g.coins}</button>
            ))}
          </div>
        </Sheet>
        <Sheet open={chOpen} onClose={() => setCh(false)} title="⚔️ Desafiar alguém a superar este clipe">
          <div className="space-y-2">
            {PLAYERS.map((p) => (
              <button key={p.id} onClick={() => challenge(p.name)} className="flex w-full items-center gap-3 rounded-xl bg-panel2 p-3 text-left">
                <span className="text-2xl">{p.avatar}</span><span className="flex-1">{p.name}</span><span className="chip">{p.division}</span>
              </button>
            ))}
          </div>
        </Sheet>
      </div>
    </div>
  );
}
