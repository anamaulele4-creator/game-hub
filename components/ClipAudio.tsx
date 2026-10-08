'use client';

// Som das publicações no leitor: ganho automático do som original + música sincronizada com o vídeo.
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { ClipMedia } from '@/lib/media';
import { applyVolume, unlockAudio } from '@/lib/media';

const playSafe = (a: HTMLMediaElement) => { try { const p = a.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch {} };

/**
 * - Cria o <audio> só quando a publicação está perto do ecrã (near) e liberta-o quando sai.
 * - Com vídeo: play/pausa/seek/loop seguem o vídeo (corrige desvios > 0,3 s).
 * - Sem vídeo (foto/momento): toca quando ativo, em loop a partir do início escolhido.
 * - Respeita "toca para ativar o som": a música fica muda enquanto o vídeo estiver mudo.
 */
export function useClipAudio(videoRef: RefObject<HTMLVideoElement | null> | null, media: ClipMedia | undefined, opt: { active: boolean; muted: boolean; near: boolean; videoKey?: string }) {
  const music = media?.music;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState(false);
  const activeRef = useRef(opt.active);
  activeRef.current = opt.active;
  const startRef = useRef(music?.start ?? 0);
  startRef.current = music?.start ?? 0;
  const level = (media?.gain ?? 1) * (media?.orig ?? 1);
  const start = music?.start ?? 0;
  const span = music?.dur && music.dur - start > 3 ? music.dur - start : 0;
  const posFor = useCallback((t: number) => start + (span ? t % span : t), [start, span]);

  // <audio> só perto do ecrã
  useEffect(() => {
    if (!music?.url || !opt.near) return;
    const a = new Audio();
    a.preload = 'auto';
    a.src = music.url;
    a.muted = true;
    const onEnded = () => { try { a.currentTime = startRef.current; } catch {} if (activeRef.current) playSafe(a); };
    const onErr = () => setFailed(true);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onErr);
    audio.current = a;
    setFailed(false);
    setReady((n) => n + 1);
    return () => {
      a.removeEventListener('ended', onEnded); a.removeEventListener('error', onErr);
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch {}
      if (audio.current === a) audio.current = null;
    };
  }, [music?.url, opt.near]); // eslint-disable-line react-hooks/exhaustive-deps

  // Volume/mudo
  useEffect(() => {
    const a = audio.current;
    if (a && music) { a.volume = music.vol; a.muted = opt.muted; }
    const v = videoRef?.current;
    if (v) applyVolume(v, opt.muted ? Math.min(1, level) : level);
  }, [opt.muted, music, level, ready, videoRef, media?.music, opt.videoKey]);

  // Sincronização com o vídeo
  useEffect(() => {
    const a = audio.current;
    const v = videoRef?.current;
    if (!a || !music) return;
    if (!v) {
      // Foto / momento: toca enquanto estiver visível
      if (opt.active) { if (a.paused) { try { if (a.currentTime < start) a.currentTime = start; } catch {} playSafe(a); } }
      else a.pause();
      return;
    }
    let last = 0;
    const sync = (force = false) => {
      const want = posFor(v.currentTime);
      if (force || Math.abs(a.currentTime - want) > 0.3) { try { a.currentTime = want; } catch {} }
    };
    const onPlay = () => { if (level !== 1) applyVolume(v, opt.muted ? Math.min(1, level) : level); sync(true); if (activeRef.current) playSafe(a); };
    const onPause = () => a.pause();
    const onSeeked = () => sync(true);
    const onTime = () => {
      const t = v.currentTime;
      if (t + 0.5 < last) sync(true); // o vídeo voltou ao início (loop)
      else if (!v.paused && a.paused && activeRef.current) { sync(true); playSafe(a); }
      else if (!v.paused) sync();
      last = t;
    };
    const onWait = () => a.pause();
    v.addEventListener('play', onPlay); v.addEventListener('playing', onPlay); v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked); v.addEventListener('timeupdate', onTime); v.addEventListener('waiting', onWait);
    if (!v.paused && opt.active) onPlay(); else a.pause();
    return () => {
      v.removeEventListener('play', onPlay); v.removeEventListener('playing', onPlay); v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked); v.removeEventListener('timeupdate', onTime); v.removeEventListener('waiting', onWait);
      a.pause();
    };
  }, [ready, music, opt.active, opt.videoKey, videoRef, posFor, start, level, opt.muted]);

  /** Chamar dentro do toque que ativa o som (iOS/Android exigem gesto). */
  const kick = useCallback((unmute: boolean) => {
    if (level > 1) unlockAudio();
    const a = audio.current;
    if (!a) return;
    a.muted = !unmute;
    const v = videoRef?.current;
    if (unmute && (v ? !v.paused || activeRef.current : activeRef.current)) {
      try { a.currentTime = v ? posFor(v.currentTime) : Math.max(a.currentTime, start); } catch {}
      playSafe(a);
    }
  }, [level, videoRef, posFor, start]);

  return { kick, failed, hasMusic: !!music };
}

/** "🎵 Título · Artista" a deslizar, como no Instagram/TikTok. Toque → licença e atribuição. */
export function MusicTag({ media, className = '' }: { media?: ClipMedia; className?: string }) {
  const [open, setOpen] = useState(false);
  const m = media?.music;
  if (!m) return null;
  const text = `${m.title} · ${m.artist}`;
  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Música: ${text}. Ver licença`}
        className="flex max-w-full items-center gap-1.5 text-[13px] text-white/90">
        <span aria-hidden>🎵</span>
        <span className="music-marquee min-w-0 flex-1 overflow-hidden whitespace-nowrap"><span>{text}&nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp;{text}</span></span>
      </button>
      {open && (
        <p className="mt-1 rounded-lg bg-black/60 p-2 text-[11px] leading-snug text-white/75">
          {m.attribution || text} · {m.license}
          {m.landing && <> · <a href={m.landing} target="_blank" rel="noopener noreferrer" className="underline">fonte</a></>}
          {m.licenseUrl && <> · <a href={m.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">licença</a></>}
        </p>
      )}
    </div>
  );
}
