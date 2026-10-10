'use client';

// Leitores de vídeo que nunca "rebentam": em erro/paragem tentam 1 vez de novo (com cache-busting)
// e depois mostram um cartaz neutro com "Tentar de novo" em vez de um elemento partido.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useQuality } from './QualityProvider';

/** play() seguro: alguns navegadores antigos não devolvem Promise; nunca deixa erro sem tratamento. */
export function safePlay(v: HTMLVideoElement | null | undefined, onReject?: () => void) {
  if (!v) return;
  try {
    const p = v.play() as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => onReject?.());
  } catch { onReject?.(); }
}

/** Acrescenta ?r=… para forçar novo pedido (não se aplica a blob:/data:). */
export function bust(src: string, n: number) {
  if (!n || /^(blob|data):/.test(src)) return src;
  return src + (src.includes('?') ? '&' : '?') + 'r=' + n;
}

/** Estado de recuperação partilhado: 1 nova tentativa automática, depois falha visível. */
export function useVideoRecovery(src?: string) {
  const attempt = useRef(0); // 0 = original, 1 = repetição automática
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { attempt.current = 0; setFailed(false); setNonce(0); }, [src]);
  useEffect(() => () => { if (stallTimer.current) clearTimeout(stallTimer.current); }, []);
  const fail = useCallback(() => {
    if (stallTimer.current) { clearTimeout(stallTimer.current); stallTimer.current = null; }
    if (attempt.current === 0) { attempt.current = 1; setNonce(Date.now()); } else setFailed(true);
  }, []);
  /** "stalled" também acontece em redes lentas sem erro real: só conta como falha se nada carregar em 10 s. */
  const onStalled = useCallback((e: { currentTarget: HTMLVideoElement }) => {
    const v = e.currentTarget;
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = setTimeout(() => { if (v.readyState < 2 && !v.paused) fail(); }, 10000);
  }, [fail]);
  const onProgressOk = useCallback(() => { if (stallTimer.current) { clearTimeout(stallTimer.current); stallTimer.current = null; } }, []);
  const retry = useCallback(() => { attempt.current = 1; setFailed(false); setNonce(Date.now()); }, []);
  const url = src ? bust(src, nonce) : undefined;
  return { url, failed, fail, onStalled, onProgressOk, retry };
}

export function VideoFailed({ poster, onRetry, compact }: { poster?: string; onRetry: () => void; compact?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-panel p-4 text-center" onClick={(e) => e.stopPropagation()}>
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      )}
      <p className={`relative ${compact ? 'text-sm' : 'text-base'} text-white/80`}>Não foi possível carregar este vídeo</p>
      <button type="button" className="btn-ghost relative" onClick={(e) => { e.stopPropagation(); onRetry(); }}>↻ Tentar de novo</button>
    </div>
  );
}

/** Leitor com controlos (página de vídeo longo, pré-visualização ao publicar). */
export const SafeVideo = forwardRef<HTMLVideoElement | null, { src: string; poster?: string; className?: string; boxClassName?: string }>(function SafeVideo({ src, poster, className = '', boxClassName = '' }, ref) {
  const v = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => v.current as HTMLVideoElement, []);
  const r = useVideoRecovery(src);
  const { tier } = useQuality();
  return (
    <div className={`relative ${boxClassName}`}>
      {r.failed ? <VideoFailed poster={poster} onRetry={r.retry} compact /> : (
        <video key={r.url} ref={v} src={r.url} poster={poster} className={className} controls playsInline preload={tier === 'low' ? 'none' : 'metadata'}
          onError={r.fail} onStalled={r.onStalled} onProgress={r.onProgressOk} onCanPlay={r.onProgressOk} />
      )}
    </div>
  );
});
