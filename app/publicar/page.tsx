'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Clip, GRADIENTS, upsertClips } from '@/lib/data';
import { IS_DEMO, MAX_UPLOAD_MB } from '@/lib/config';
import { GAMES, youtubeId, ytThumb, ytWatch } from '@/lib/feed';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';
import { SafeVideo } from '@/components/SafeVideo';
import { SoundStudio } from '@/components/SoundStudio';
import type { ClipMedia } from '@/lib/media';
import { AI_NAME, moderate, recordModeration, rememberPost } from '@/lib/poipakAI';

type Kind = 'video' | 'long' | 'photo' | 'meme' | 'text';
const KINDS: { k: Kind; label: string; icon: string }[] = [
  { k: 'long', label: 'Vídeos', icon: '📺' },
  { k: 'video', label: 'Clipes', icon: '🎬' },
  { k: 'meme', label: 'Memes', icon: '😂' },
  { k: 'photo', label: 'Fotos', icon: '📷' },
  { k: 'text', label: 'Momentos', icon: '💭' },
];
const TIPO: Record<string, Kind> = { long: 'long', longo: 'long', video: 'video', clipe: 'video', meme: 'meme', photo: 'photo', foto: 'photo', text: 'text', momento: 'text' };
const MAX_MB = MAX_UPLOAD_MB;
const MAX_SEC = 300; // clipes do feed vertical: até 5 minutos
const MAX_SEC_LONG = 7200; // vídeos longos: até 2 horas
const TOO_BIG = `Ficheiro grande demais (máx. ${MAX_MB} MB no plano atual). Para vídeos longos, cola um link do YouTube.`;
const MEME_BGS = ['#000000', '#ffffff', '#1E3A8A', '#FFC20E', '#0B1B4D', '#2F55C4', '#FFE9A6', '#ef4444'];

// ---------- Meme clássico: texto branco em Impact com contorno preto, desenhado num canvas ----------
const MEME_FONT = (px: number) => `900 ${px}px Impact, Anton, 'Arial Black', 'Helvetica Neue', Arial, sans-serif`;
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const tryL = line ? line + ' ' + w : w;
      if (ctx.measureText(tryL).width <= maxW || !line) line = tryL; else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}
function drawBlock(ctx: CanvasRenderingContext2D, text: string, W: number, H: number, pos: 'top' | 'bottom') {
  if (!text.trim()) return;
  const maxW = W * 0.92, maxH = H * 0.3;
  let size = Math.round(W * 0.13), lines: string[] = [];
  for (; size >= 14; size -= 2) {
    ctx.font = MEME_FONT(size);
    lines = wrap(ctx, text, maxW);
    if (lines.length * size * 1.08 <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
  }
  ctx.font = MEME_FONT(size);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, size * 0.12); ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
  const lh = size * 1.08, pad = H * 0.03;
  const y0 = pos === 'top' ? pad : H - pad - lines.length * lh;
  lines.forEach((l, k) => { const y = y0 + k * lh; ctx.strokeText(l, W / 2, y); ctx.fillText(l, W / 2, y); });
}
function drawMeme(cv: HTMLCanvasElement, img: HTMLImageElement | null, bg: string, top: string, bottom: string, upper: boolean) {
  let W = 1080, H = 1080;
  if (img) { const sc = Math.min(1, 1080 / Math.max(img.naturalWidth, img.naturalHeight)); W = Math.round(img.naturalWidth * sc); H = Math.round(img.naturalHeight * sc); }
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (img) ctx.drawImage(img, 0, 0, W, H);
  const t = (x: string) => (upper ? x.toLocaleUpperCase('pt-PT') : x);
  drawBlock(ctx, t(top), W, H, 'top');
  drawBlock(ctx, t(bottom), W, H, 'bottom');
}
const canvasBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Não foi possível criar a imagem do meme.'))), 'image/jpeg', 0.88));

const parseTags = (s: string) => Array.from(new Set(s.split(/[\s,]+/).map((t) => t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase()).filter(Boolean))).slice(0, 10);

export default function PublicarPage() {
  const router = useRouter();
  const { s, toast } = useStore();
  const [kind, setKind] = useState<Kind>('video');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ duration: number | null; thumb: Blob | null } | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [game, setGame] = useState(GAMES[0]);
  const [tags, setTags] = useState('');
  const [vis, setVis] = useState<'public' | 'followers'>('public');
  const [q, setQ] = useState<{ limit: number; used: number; rules: boolean; active: boolean } | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [stage, setStage] = useState('');
  const [err, setErr] = useState('');
  const cancelRef = useRef<(() => void) | null>(null);
  // Som: ganho automático + música (guardado com a publicação)
  const [media, setMedia] = useState<ClipMedia | undefined>(undefined);
  const previewVid = useRef<HTMLVideoElement | null>(null);
  // Vídeo longo: ficheiro ou link do YouTube
  const [longMode, setLongMode] = useState<'file' | 'link'>('link');
  const [ytUrl, setYtUrl] = useState('');
  const yt = youtubeId(ytUrl);
  // Meme
  const [memeImg, setMemeImg] = useState<HTMLImageElement | null>(null);
  const [memeBg, setMemeBg] = useState(MEME_BGS[0]);
  const [topT, setTopT] = useState('');
  const [botT, setBotT] = useState('');
  const [upper, setUpper] = useState(true);
  const memeCv = useRef<HTMLCanvasElement>(null);
  const soundCaption = useMemo(() => [title, desc, topT, botT].join(' '), [title, desc, topT, botT]);
  const soundTags = useMemo(() => parseTags(tags), [tags]);

  useEffect(() => {
    if (kind !== 'meme' || !memeCv.current) return;
    const cv = memeCv.current;
    const go = () => drawMeme(cv, memeImg, memeBg, topT, botT, upper);
    go();
    // Redesenha quando a fonte Impact/Anton termina de carregar
    void document.fonts?.ready.then(go).catch(() => {});
  }, [kind, memeImg, memeBg, topT, botT, upper]);

  useEffect(() => {
    const apply = (t: string | null | undefined) => {
      const k = t ? TIPO[t] : undefined;
      if (!k) return;
      setKind(k); setFile(null); setPreview(null); setProbe(null); setErr(''); setMemeImg(null);
      setGame((g) => (k === 'meme' ? 'Memes' : g === 'Memes' ? GAMES[0] : g));
    };
    apply(new URLSearchParams(window.location.search).get('tipo'));
    // Captura feita na Câmara TXAPILOG: abre já carregada (mesmo fluxo que escolher um ficheiro)
    void import('@/lib/camera').then((cam) => {
      const cap = cam.takePendingCapture();
      if (!cap) return;
      const k = TIPO[cap.kind] ?? 'video';
      if (k === 'long') setLongMode('file');
      setTimeout(() => { void onPickRef.current?.(cap.file, k, cap.duration); }, 0);
    }).catch(() => {});
    // Aberto pela folha "+ Publicar" quando já estamos nesta página (só muda o ?tipo=)
    const on = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener('poipak-tipo', on);
    return () => window.removeEventListener('poipak-tipo', on);
  }, []);

  useEffect(() => {
    if (IS_DEMO) { setQ({ limit: 10, used: 0, rules: true, active: true }); return; }
    void import('@/lib/clips').then((m) => m.quota()).then(setQ).catch(() => {});
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const onPickRef = useRef<((f: File | undefined, k?: Kind, d?: number) => Promise<void>) | null>(null);
  const switchKind = (k: Kind) => {
    if (busy) return;
    setMedia(undefined);
    setKind(k); setFile(null); setPreview(null); setProbe(null); setErr(''); setMemeImg(null);
    if (k === 'meme') setGame('Memes'); else if (game === 'Memes') setGame(GAMES[0]);
  };

  const onPick = async (f: File | undefined, k: Kind = kind, knownDur?: number) => {
    setErr('');
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) { setErr(k === 'video' || k === 'long' ? TOO_BIG : `Ficheiro grande demais (máx. ${MAX_MB} MB no plano atual).`); return; }
    if (k === 'video' || k === 'long') {
      if (!f.type.startsWith('video/')) { setErr('Escolhe um ficheiro de vídeo.'); return; }
      const m = await import('@/lib/clips');
      const p0 = await m.probeVideo(f);
      const p = { ...p0, duration: p0.duration ?? knownDur ?? null };
      const lim = k === 'long' ? MAX_SEC_LONG : MAX_SEC;
      if (p.duration && p.duration > lim) {
        URL.revokeObjectURL(p.url);
        setErr(k === 'video' ? `O vídeo tem ${Math.round(p.duration / 60)} min. Clipes vão até 5 minutos: publica em 📺 Vídeos.` : `O vídeo tem ${Math.round(p.duration / 60)} min. O máximo é 2 horas.`);
        return;
      }
      setProbe({ duration: p.duration, thumb: p.thumb }); setPreview(p.url);
    } else if (k === 'meme') {
      if (!/^image\/(jpeg|png|webp|gif)/.test(f.type)) { setErr('Escolhe uma imagem JPG, PNG, WebP ou GIF.'); return; }
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => { setMemeImg(im); };
      im.onerror = () => { URL.revokeObjectURL(url); setErr('Não foi possível abrir a imagem.'); };
      im.src = url;
      setPreview(url);
    } else {
      if (!f.type.startsWith('image/')) { setErr('Escolhe uma imagem.'); return; }
      setPreview(URL.createObjectURL(f));
    }
    setFile(f);
  };

  onPickRef.current = onPick;
  const camHref = `/camera?tipo=${kind}`;

  // TXAPILOG IA: moderação ao vivo do texto
  const modText = [title, desc, topT, botT].filter(Boolean).join('\n');
  const mod = modText.trim() ? moderate(modText, { tags: parseTags(tags), allowCaps: kind === 'meme' }) : null;
  const left = q ? Math.max(0, q.limit - q.used) : null;
  const needRules = !!q && !q.rules;
  const content = kind === 'text' ? title.trim().length > 0
    : kind === 'meme' ? !!memeImg || !!(topT.trim() || botT.trim())
    : kind === 'long' ? title.trim().length > 0 && (longMode === 'link' ? !!yt : !!file)
    : !!file && (kind === 'photo' || title.trim().length > 0);
  const ready = content
    && (!needRules || agree) && left !== 0 && q?.active !== false && !busy;

  const publish = async () => {
    if (!ready) return;
    const m0 = moderate(modText, { tags: parseTags(tags), allowCaps: kind === 'meme', checkRepeat: true });
    if (m0.level === 'block') { recordModeration(m0, 'publicar', modText); setErr(`${m0.tip} (${m0.reasons.join(', ')})`); return; }
    if (m0.level === 'warn') recordModeration(m0, 'publicar', modText);
    setBusy(true); setErr(''); setProg(0); setStage('A preparar…');
    const memeTitle = [topT, botT].map((x) => x.trim()).filter(Boolean).join(' / ').slice(0, 120) || '😂 Meme';
    const userTags = parseTags(tags);
    const base = {
      title: title.trim() || (kind === 'photo' ? '📷' : kind === 'meme' ? memeTitle : ''), description: desc.trim(), game,
      tags: kind === 'meme' ? ['meme', ...userTags.filter((t) => t !== 'meme')].slice(0, 10) : kind === 'long' ? ['longo', ...userTags.filter((t) => t !== 'longo')].slice(0, 10) : userTags,
      visibility: vis,
    };
    try {
      if (IS_DEMO) {
        for (let i = 1; i <= 10; i++) { await new Promise((r) => setTimeout(r, 120)); setProg(i / 10); }
        const memeUrl = kind === 'meme' && memeCv.current ? memeCv.current.toDataURL('image/jpeg', 0.8) : undefined;
        const ck: Clip['kind'] = kind === 'text' ? 'text' : kind === 'photo' || kind === 'meme' ? 'photo' : 'video';
        const c: Clip = {
          id: 'me' + Date.now(), idolId: 'me', title: base.title, game, gradient: GRADIENTS[0], emoji: kind === 'text' ? '💭' : kind === 'photo' ? '📷' : kind === 'meme' ? '😂' : '🎬',
          likes: 0, comments: 0, shares: 0, views: 0, tags: base.tags, description: base.description, kind: ck, visibility: vis, createdAt: new Date().toISOString(),
          image: kind === 'photo' ? preview ?? undefined : memeUrl, thumb: memeUrl ?? (kind === 'long' && longMode === 'link' && yt ? ytThumb(yt) : undefined),
          video: kind === 'long' && longMode === 'link' && yt ? ytWatch(yt) : (kind === 'video' || kind === 'long') ? preview ?? undefined : undefined,
          duration: probe?.duration ?? undefined, media: kind === 'long' && longMode === 'link' ? undefined : media,
        };
        upsertClips([c]);
      } else {
        const m = await import('@/lib/clips');
        if (needRules) await m.acceptRules();
        const onP = (p: number, st: string) => { setProg(p); setStage(st); };
        if (kind === 'long' && longMode === 'link') {
          setStage('A publicar…');
          await m.publishYouTube({ ...base, url: ytUrl });
        } else if (kind === 'meme') {
          if (!memeCv.current) throw new Error('Pré-visualização do meme indisponível.');
          drawMeme(memeCv.current, memeImg, memeBg, topT, botT, upper);
          const blob = await canvasBlob(memeCv.current);
          const mf = new File([blob], 'meme.jpg', { type: 'image/jpeg' });
          const job = m.publishPost({ ...base, kind: 'photo', file: mf, skipShrink: true, media }, onP);
          cancelRef.current = job.cancel;
          await job.promise;
        } else {
          const job = kind === 'video' || kind === 'long'
            ? m.publishClip({ ...base, file: file!, thumb: probe?.thumb ?? null, duration: probe?.duration ?? null, media }, onP)
            : m.publishPost({ ...base, kind, file, media }, onP);
          cancelRef.current = job.cancel;
          await job.promise;
        }
      }
      rememberPost(modText);
      toast(kind === 'video' ? 'Clipe publicado 🎉' : kind === 'long' ? 'Vídeo publicado 🎉' : kind === 'meme' ? 'Meme publicado 😂' : kind === 'photo' ? 'Foto publicada 🎉' : 'Momento publicado 🎉');
      router.push(kind === 'long' ? '/videos' : kind === 'meme' ? '/clipes?f=memes' : '/clipes');
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg === 'cancelado' ? 'Envio cancelado.' : msg);
    } finally {
      cancelRef.current = null; setBusy(false);
    }
  };

  return (
    <Page title="Publicar" back="/clipes">
      <p className="mb-3 text-sm text-white/70">Partilha jogadas, vídeos, memes, fotos e momentos. Qualquer pessoa pode ser criadora no TXAPILOG ✨</p>

      <Link href="/lives/criar" className="mb-2 flex min-h-[3.5rem] items-center gap-3 rounded-2xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-base font-bold">
        <span className="text-2xl" aria-hidden>🔴</span>
        <span className="flex-1">Live<span className="block text-sm font-normal text-white/60">Criar uma live agora ou agendar</span></span>
        <span aria-hidden className="text-white/60">›</span>
      </Link>
      <div className="mb-4 grid grid-cols-3 gap-2" role="tablist" aria-label="Tipo de publicação">
        {KINDS.map((x) => (
          <button key={x.k} role="tab" aria-selected={kind === x.k} onClick={() => { switchKind(x.k); try { window.history.replaceState(window.history.state, '', `?tipo=${x.k}`); } catch {} }} disabled={busy}
            className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 text-sm font-semibold leading-tight ${kind === x.k ? 'border-neon bg-neon/20 text-white' : 'border-line bg-panel2 text-white/75'}`}>
            <span className="text-2xl" aria-hidden>{x.icon}</span>{x.label}
          </button>
        ))}
      </div>

      {kind === 'long' && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
          <button onClick={() => { setLongMode('link'); setErr(''); }} disabled={busy} className={`rounded-xl border p-2 ${longMode === 'link' ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/70'}`}>🔗 Link do YouTube</button>
          <button onClick={() => { setLongMode('file'); setErr(''); }} disabled={busy} className={`rounded-xl border p-2 ${longMode === 'file' ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/70'}`}>📁 Enviar ficheiro</button>
        </div>
      )}

      {kind === 'long' && longMode === 'link' && (
        <div className="card mb-4">
          <label className="block text-xs text-white/70">
            Link do YouTube
            <input className="input mt-1 w-full" inputMode="url" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="https://youtu.be/… ou youtube.com/watch?v=…" />
          </label>
          {ytUrl && !yt && <p className="mt-1 text-xs text-red-300">Link inválido. Aceita youtube.com/watch, youtu.be e youtube.com/shorts.</p>}
          {yt && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ytThumb(yt)} alt="Miniatura do vídeo" className="mt-3 aspect-video w-full rounded-xl object-cover" />
          )}
          <p className="mt-2 text-xs text-white/50">O vídeo toca a partir do YouTube (sem gastar o espaço da plataforma). Duração livre.</p>
        </div>
      )}

      {kind === 'meme' && (
        <div className="card mb-4">
          <div className="mb-3 overflow-hidden rounded-xl bg-black">
            <canvas ref={memeCv} className="mx-auto block h-auto max-h-80 w-auto max-w-full" aria-label="Pré-visualização do meme" />
          </div>
          <div className="space-y-2">
            <input className="input meme-font w-full tracking-wide" maxLength={90} value={topT} onChange={(e) => setTopT(e.target.value)} placeholder="Texto de cima" />
            <input className="input meme-font w-full tracking-wide" maxLength={90} value={botT} onChange={(e) => setBotT(e.target.value)} placeholder="Texto de baixo" />
            <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> MAIÚSCULAS (estilo clássico)</label>
          </div>
          <Link href={camHref} className={`btn mt-3 flex min-h-[3rem] w-full items-center justify-center text-base ${busy ? 'pointer-events-none opacity-50' : ''}`}>📷 Câmara TXAPILOG (com filtros)</Link>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              🖼️ Imagem
              <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              📸 Câmara
              <input type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          {!memeImg ? (
            <div className="mt-3">
              <p className="mb-1 text-xs text-white/60">Ou usa um fundo de cor:</p>
              <div className="flex flex-wrap gap-2">
                {MEME_BGS.map((c) => <button key={c} onClick={() => setMemeBg(c)} aria-label={`Fundo ${c}`} className={`h-8 w-8 rounded-full border-2 ${memeBg === c ? 'border-neon2' : 'border-white/20'}`} style={{ background: c }} />)}
              </div>
            </div>
          ) : (
            <button className="mt-2 text-xs text-pink underline" onClick={() => { setMemeImg(null); setPreview(null); }}>Remover imagem (usar fundo de cor)</button>
          )}
          <p className="mt-2 text-xs text-white/50">O meme é guardado como imagem (máx. 1080 px) com a etiqueta #meme.</p>
        </div>
      )}

      {(kind === 'video' || kind === 'photo' || (kind === 'long' && longMode === 'file')) && (
        <div className="card mb-4">
          {preview ? (
            <div className="mb-3 flex justify-center overflow-hidden rounded-xl bg-black">
              {kind !== 'photo'
                ? <SafeVideo ref={previewVid} src={preview} className="max-h-72 w-full" boxClassName="w-full min-h-[10rem]" />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={preview} alt="Pré-visualização" className="max-h-72 object-contain" />}
            </div>
          ) : (
            <p className="mb-3 text-center text-4xl">{kind === 'video' ? '🎬' : kind === 'long' ? '📺' : '📷'}</p>
          )}
          <Link href={camHref} className={`btn mb-2 flex min-h-[3rem] w-full items-center justify-center text-base ${busy ? 'pointer-events-none opacity-50' : ''}`}>📷 Câmara TXAPILOG (com filtros)</Link>
          <div className="grid grid-cols-2 gap-2">
            <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              🖼️ Galeria
              <input type="file" className="hidden" accept={kind === 'photo' ? 'image/*' : 'video/*'} onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              {kind === 'photo' ? '📸 Câmara do telemóvel' : '🎥 Gravar no telemóvel'}
              <input type="file" className="hidden" accept={kind === 'photo' ? 'image/*' : 'video/*'} capture="environment" onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          <p className="mt-2 text-xs text-white/50">
            {kind === 'video' ? `Clipe vertical: máximo ${MAX_MB} MB e ${MAX_SEC / 60} minutos.` : kind === 'long' ? `Máximo ${MAX_MB} MB no plano atual e 2 horas. Ficheiro maior? Usa um link do YouTube.` : `Máximo ${MAX_MB} MB. A foto é reduzida para poupar dados.`}
            {file && ` · ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`}
          </p>
        </div>
      )}

      {!(kind === 'long' && longMode === 'link') && (kind === 'text' || kind === 'photo' || kind === 'meme' || !!file) && (
        <SoundStudio key={`${kind}-${kind === 'video' || kind === 'long' ? preview ?? '' : ''}`} kind={kind} file={kind === 'video' || kind === 'long' ? file : null}
          previewUrl={kind === 'video' || kind === 'long' ? preview : null} duration={probe?.duration ?? null} game={game} caption={soundCaption} tags={soundTags}
          videoRef={previewVid} onChange={setMedia} disabled={busy} />
      )}

      <div className="space-y-3">
        <label className="block text-xs text-white/70">
          {kind === 'text' ? 'O teu momento' : kind === 'photo' || kind === 'meme' ? 'Legenda (opcional)' : 'Título'}
          {kind === 'text'
            ? <textarea className="input mt-1 w-full" rows={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O que estás a jogar ou a sentir?" />
            : <input className="input mt-1 w-full" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'photo' || kind === 'meme' ? 'Escreve uma legenda' : kind === 'long' ? 'Ex.: Final completa da Copa Mambas' : 'Ex.: Booyah com 12 kills 🔥'} />}
          <span className="float-right text-[11px] text-white/40">{title.length}/120</span>
        </label>
        <label className="block text-xs text-white/70">
          Descrição (opcional)
          <textarea className="input mt-1 w-full" rows={2} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Conta mais detalhes…" />
        </label>
        <label className="block text-xs text-white/70">
          Jogo
          <select className="input mt-1 w-full" value={game} onChange={(e) => setGame(e.target.value)}>
            {GAMES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="block text-xs text-white/70">
          Hashtags
          <input className="input mt-1 w-full" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#freefire #moçambique" />
        </label>
        <div className="text-xs text-white/70">
          Quem pode ver
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button onClick={() => setVis('public')} className={`rounded-xl border p-2 text-sm ${vis === 'public' ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/70'}`}>🌍 Público</button>
            <button onClick={() => setVis('followers')} className={`rounded-xl border p-2 text-sm ${vis === 'followers' ? 'border-neon bg-neon/20' : 'border-line bg-panel2 text-white/70'}`}>👥 Só seguidores</button>
          </div>
        </div>

        {needRules && (
          <label className="flex items-start gap-2 rounded-xl bg-panel2 p-3 text-xs">
            <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>Li e aceito as <Link href="/diretrizes" className="text-neon2 underline">Diretrizes da Comunidade</Link>: nada de violência real, nudez, ódio, burlas ou conteúdo de outras pessoas sem autorização.</span>
          </label>
        )}

        {q && (
          <p className="text-xs text-white/60">
            {q.active === false ? '⛔ A tua conta não pode publicar agora.' : left === 0 ? '⏳ Atingiste o limite de hoje. Volta amanhã.' : `📤 Restam ${left} de ${q.limit} publicações hoje.`}
          </p>
        )}

        {busy && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-white/70"><span>{stage}</span><span>{Math.round(prog * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-panel2"><div className="h-2 rounded-full bg-gradient-to-r from-neon to-neon2 transition-all" style={{ width: `${Math.round(prog * 100)}%` }} /></div>
          </div>
        )}
        {mod && mod.level !== 'ok' && (
          <div className={`rounded-xl p-3 text-sm ${mod.level === 'block' ? 'bg-red-500/10 text-red-200' : 'bg-neon/10 text-neon3'}`}>
            <p className="font-semibold">🛡️ {AI_NAME}: {mod.level === 'block' ? 'isto não pode ser publicado' : 'sugestão'}</p>
            <p className="mt-0.5 text-xs opacity-90">{mod.tip} ({mod.reasons.join(', ')})</p>
          </div>
        )}
        {err && <p className="rounded-xl bg-red-500/15 p-2 text-xs text-red-300">{err}</p>}

        <div className="flex gap-2 pb-6">
          {busy
            ? <button className="btn-ghost flex-1" onClick={() => cancelRef.current?.()}>✖ Cancelar envio</button>
            : <button className="btn flex-1 disabled:opacity-40" disabled={!ready} onClick={publish}>Publicar</button>}
        </div>
        {!s.account.loggedIn && !IS_DEMO && <p className="text-xs text-white/60">Entra na tua conta para publicar.</p>}
      </div>
    </Page>
  );
}
