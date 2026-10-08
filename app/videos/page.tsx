'use client';

// Área "Vídeos" (estilo YouTube): vídeos longos na horizontal 16:9, separados do feed vertical de clipes.
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { CLIPS, Clip, fmt, idol } from '@/lib/data';
import { GAMES, ago, byHot, byNew, fmtDuration, isLong, videoHref, youtubeId, ytEmbed, ytThumb, ytWatch } from '@/lib/feed';
import { useStore } from '@/lib/store';
import { MoreMenu } from '@/components/Moderation';
import { SafeVideo } from '@/components/SafeVideo';
import { MusicTag, useClipAudio } from '@/components/ClipAudio';
import { ClipThumb, CommentsSheet, FollowButton, Page, ShareSheet, Shelf, Verified, AvatarFace } from '@/components/ui';

function useLongVideos() {
  const { s } = useStore();
  return CLIPS.filter((c) => isLong(c) && !s.admin.hiddenClips.includes(c.id) && !s.blocked.includes(c.idolId));
}

function Catalog() {
  const all = useLongVideos();
  const [g, setG] = useState('Todos');
  const games = ['Todos', ...Array.from(new Set(all.map((c) => c.game).filter(Boolean)))];
  const list = g === 'Todos' ? all : all.filter((c) => c.game === g);
  return (
    <Page title="📺 Vídeos" back="/">
      <p className="mb-3 text-xs text-white/60">Vídeos longos: jogos completos, tutoriais, torneios. Para clipes curtos na vertical, abre <Link href="/clipes" className="text-neon2">Clipes</Link>.</p>
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4">
        {games.map((x) => <button key={x} onClick={() => setG(x)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${g === x ? 'bg-white text-black' : 'bg-panel2 text-white/75'}`}>{x}</button>)}
      </div>
      {all.length === 0 ? (
        <div className="card text-center">
          <p className="text-4xl">📺</p>
          <p className="mt-2 text-sm text-white/70">Ainda não há vídeos longos. Publica um ficheiro ou cola um link do YouTube.</p>
          <Link href="/publicar?tipo=longo" className="btn mt-3">＋ Publicar vídeo longo</Link>
        </div>
      ) : g === 'Todos' ? (
        <>
          <Shelf title="🔥 Em alta" clips={byHot(all)} wide />
          <Shelf title="🆕 Recentes" clips={byNew(all)} wide />
          {GAMES.map((x) => <Shelf key={x} title={x} clips={all.filter((c) => c.game === x)} wide />)}
        </>
      ) : (
        <div className="space-y-4">{list.map((c) => <VideoRow key={c.id} c={c} big />)}</div>
      )}
      <Link href="/publicar?tipo=longo" className="btn mt-2 w-full">＋ Publicar vídeo longo</Link>
    </Page>
  );
}

function VideoRow({ c, big }: { c: Clip; big?: boolean }) {
  const i = idol(c.idolId);
  if (big) return (
    <div>
      <ClipThumb c={c} wide />
      <Link href={videoHref(c.id)} className="mt-1.5 block">
        <p className="line-clamp-2 text-sm font-semibold">{c.title}</p>
        <p className="text-xs text-white/60">{i.name} · {fmt(c.views)} visualizações{c.createdAt ? ` · ${ago(c.createdAt)}` : ''}</p>
      </Link>
    </div>
  );
  return (
    <Link href={videoHref(c.id)} className="flex gap-2">
      <div className="w-40 shrink-0"><ThumbStatic c={c} /></div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs font-semibold">{c.title}</p>
        <p className="mt-0.5 text-xs text-white/60">{i.name}</p>
        <p className="text-xs text-white/50">{fmt(c.views)} visualizações{c.createdAt ? ` · ${ago(c.createdAt)}` : ''}</p>
      </div>
    </Link>
  );
}

/** Miniatura 16:9 sem link próprio (para usar dentro de outro link). */
function ThumbStatic({ c }: { c: Clip }) {
  const [ok, setOk] = useState(false);
  return (
    <div className={`relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br ${c.gradient}`}>
      {!ok && <span className="skeleton absolute inset-0" />}
      {c.thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.thumb} alt="" loading="lazy" decoding="async" onLoad={() => setOk(true)} className={`absolute inset-0 h-full w-full object-cover ${ok ? 'opacity-100' : 'opacity-0'}`} />
      )}
      {c.duration ? <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[11px]">{fmtDuration(c.duration)}</span> : null}
    </div>
  );
}

function Player({ id }: { id: string }) {
  const [c, setC] = useState<Clip | null | undefined>(() => CLIPS.find((x) => x.id === id));
  const all = useLongVideos();
  const { s, toggleLike, toggleSave, isSaved } = useStore();
  const [cOpen, setCOpen] = useState(false);
  const [shOpen, setSh] = useState(false);
  const [more, setMore] = useState(false);
  const [views, setViews] = useState<number | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (c) return;
    let alive = true;
    void import('@/lib/clips').then((m) => m.fetchClip(id)).then((x) => { if (alive) setC(x); }).catch(() => { if (alive) setC(null); });
    return () => { alive = false; };
  }, [id, c]);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  // 1 visualização após 5 s na página (o servidor conta 1 por pessoa por vídeo a cada 24 h)
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(() => {
      if (sent.current) return; sent.current = true;
      void import('@/lib/clips').then((m) => m.recordView(c.id, 5000, false)).then((n) => { if (n != null) setViews(n); }).catch(() => {});
    }, 5000);
    return () => clearTimeout(t);
  }, [c]);

  if (c === undefined) return <Page title="Vídeo" back="/videos"><div className="skeleton -mx-4 -mt-4 aspect-video" /><div className="skeleton mt-3 h-5 w-2/3 rounded" /></Page>;
  if (c === null) return <Page title="Vídeo" back="/videos"><div className="card mt-6 text-center"><p className="text-4xl">🔎</p><p className="mt-2 text-sm text-white/70">Vídeo não encontrado ou privado.</p></div></Page>;

  const i = idol(c.idolId);
  const yt = youtubeId(c.video);
  const liked = s.liked.includes(c.id);
  const saved = isSaved({ kind: 'clipe', id: c.id });
  const related = [...all.filter((x) => x.id !== c.id && x.idolId === c.idolId), ...byHot(all.filter((x) => x.id !== c.id && x.idolId !== c.idolId && x.game === c.game)), ...byHot(all.filter((x) => x.id !== c.id && x.idolId !== c.idolId && x.game !== c.game))].slice(0, 20);

  return (
    <Page title={c.title} back="/videos">
      <div className="-mx-4 -mt-4 aspect-video bg-black">
        {yt ? (
          <LiteYouTube id={yt} title={c.title} />
        ) : c.video ? (
          <LongFilePlayer c={c} />
        ) : (
          <div className="flex h-full items-center justify-center text-5xl">{c.emoji}</div>
        )}
      </div>
      <h1 className="mt-3 text-base font-bold leading-snug">{c.title}</h1>
      {!yt && <MusicTag media={c.media} className="mt-1" />}
      <p className="text-xs text-white/60">{fmt(views ?? c.views)} visualizações{c.createdAt ? ` · ${ago(c.createdAt)}` : ''}{c.duration ? ` · ${fmtDuration(c.duration)}` : ''} · {c.game}</p>

      <div className="mt-3 flex items-center gap-2">
        <Link href={`/idolo/${i.id}`} className="flex min-w-0 flex-1 items-center gap-2">
          <span className="overflow-hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-panel2 text-xl" style={{ borderColor: i.color }}><AvatarFace a={i.avatar} name={i.name} fill /></span>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{i.name}{i.verified && <Verified />}</span><span className="block text-xs text-white/50">{fmt(i.followers)} seguidores</span></span>
        </Link>
        <FollowButton idolId={i.id} small />
      </div>

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 text-xs">
        <button onClick={() => toggleLike(c.id)} className="shrink-0 rounded-full bg-panel2 px-3 py-1.5">{liked ? '💜' : '🤍'} {fmt(c.likes + (liked ? 1 : 0))}</button>
        <button onClick={() => setCOpen(true)} className="shrink-0 rounded-full bg-panel2 px-3 py-1.5">💬 {fmt(c.comments + (s.comments[c.id]?.length ?? 0))}</button>
        <button onClick={() => setSh(true)} className="shrink-0 rounded-full bg-panel2 px-3 py-1.5">📤 Partilhar</button>
        <button onClick={() => toggleSave({ kind: 'clipe', id: c.id })} className="shrink-0 rounded-full bg-panel2 px-3 py-1.5">{saved ? '🔖 Guardado' : '📑 Guardar'}</button>
        {yt && <a href={ytWatch(yt)} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full bg-panel2 px-3 py-1.5">▶ Abrir no YouTube</a>}
        <MoreMenu kind="clipe" target={c.id} label={c.title} owner={i.id} ownerLabel={i.name} className="shrink-0 rounded-full bg-panel2 px-3 py-1" />
      </div>

      {(c.description || c.tags.length > 0) && (
        <button onClick={() => setMore((m) => !m)} className="mt-3 block w-full rounded-xl bg-panel2 p-3 text-left text-xs">
          <p className={`whitespace-pre-wrap break-words text-white/85 ${more ? '' : 'line-clamp-3'}`}>{c.description || 'Sem descrição.'}</p>
          {c.tags.length > 0 && <p className="mt-1 text-neon2">{c.tags.filter((t) => t !== 'longo').map((t) => '#' + t).join(' ')}</p>}
          <p className="mt-1 font-semibold text-white/60">{more ? 'Mostrar menos' : '…mais'}</p>
        </button>
      )}

      <h2 className="mb-2 mt-5 text-sm font-bold">A seguir</h2>
      {related.length ? <div className="space-y-3">{related.map((x) => <VideoRow key={x.id} c={x} />)}</div> : <p className="text-xs text-white/50">Sem outros vídeos ainda.</p>}

      <CommentsSheet open={cOpen} onClose={() => setCOpen(false)} target={c.id} />
      <ShareSheet open={shOpen} onClose={() => setSh(false)} path={videoHref(c.id)} text={`Vê este vídeo de ${i.name} no Social POIPAK:`} target={c.id} />
    </Page>
  );
}

/** YouTube "leve": só a miniatura até tocar; o iframe (youtube-nocookie) só carrega depois. */
function LiteYouTube({ id, title }: { id: string; title: string }) {
  const [on, setOn] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);
  if (on) return (
    <iframe src={ytEmbed(id) + '&autoplay=1'} title={title} className="h-full w-full" loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
  );
  return (
    <button type="button" onClick={() => setOn(true)} className="relative block h-full w-full bg-panel" aria-label={`Ver ${title}`}>
      {thumbOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ytThumb(id)} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setThumbOk(false)} />
      )}
      <span className="absolute left-1/2 top-1/2 flex h-14 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-black/70 text-2xl">▶</span>
    </button>
  );
}

function VideosInner() {
  const v = useSearchParams().get('v');
  return v ? <Player key={v} id={v} /> : <Catalog />;
}

export default function VideosPage() {
  return <Suspense fallback={<Page title="📺 Vídeos"><div className="skeleton aspect-video rounded-xl" /></Page>}><VideosInner /></Suspense>;
}

/** Vídeo longo enviado como ficheiro: toca a música escolhida sincronizada e aplica o volume do som original. */
function LongFilePlayer({ c }: { c: Clip }) {
  const v = useRef<HTMLVideoElement | null>(null);
  useClipAudio(v, c.media, { active: true, muted: false, near: true, videoKey: c.id });
  return <SafeVideo ref={v} src={c.video!} poster={c.thumb} className="h-full w-full" boxClassName="h-full w-full" />;
}
