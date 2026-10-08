'use client';

import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { CamFilter, FILTERS, StickerPos, cameraError, drawFrame, hitSticker, stopStream } from '@/lib/camera';

export interface CamApi { canvas: HTMLCanvasElement; audio: MediaStreamTrack[]; filter: CamFilter }

/**
 * Câmara com filtros: getUserMedia → <video> escondido → canvas (filtro) visível.
 * Frente/trás, lanterna (se suportada), chips de filtros, deslizar para mudar, stickers arrastáveis.
 * Pára todas as faixas ao sair. Nunca lança erro: mostra mensagem e "Escolher do dispositivo".
 */
export function CameraView({ apiRef, audio = true, landscape = false, onFallback, fallbackAccept = 'image/*,video/*', className = '', compact = false, locked = false }: {
  apiRef?: MutableRefObject<CamApi | null>; audio?: boolean; landscape?: boolean; onFallback?: (f: File) => void; fallbackAccept?: string; className?: string; compact?: boolean; locked?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [fi, setFi] = useState(0);
  const fiRef = useRef(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [torchOk, setTorchOk] = useState(false);
  const [torch, setTorch] = useState(false);
  const stickers = useRef<Record<'crown' | 'kill', StickerPos>>({ crown: { x: 0.5, y: 0.2 }, kill: { x: 0.5, y: 0.82 } });
  const drag = useRef<{ mode: 'drag' | 'swipe'; x0: number; y0: number } | null>(null);
  const filter = FILTERS[fi];

  useEffect(() => { fiRef.current = fi; if (apiRef?.current) apiRef.current.filter = FILTERS[fi]; }, [fi, apiRef]);

  const start = useCallback(async (face: 'user' | 'environment') => {
    stopStream(stream.current); stream.current = null;
    setErr(''); setLoading(true); setTorch(false); setTorchOk(false);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setErr('Este navegador não permite usar a câmara. Escolhe um ficheiro do dispositivo.'); setLoading(false); return; }
    const v = { facingMode: face, width: { ideal: landscape ? 1280 : 720 }, height: { ideal: landscape ? 720 : 1280 }, frameRate: { ideal: 30, max: 30 } };
    let s: MediaStream | null = null;
    try { s = await navigator.mediaDevices.getUserMedia({ video: v, audio: audio ? { echoCancellation: true, noiseSuppression: true } : false }); }
    catch (e) {
      // Sem microfone (ou recusado): tenta só vídeo
      if (audio) { try { s = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); } catch (e2) { setErr(cameraError(e2)); } }
      else setErr(cameraError(e));
    }
    if (!s) { setLoading(false); return; }
    stream.current = s;
    try {
      const vt = s.getVideoTracks()[0];
      const caps = (vt?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorchOk(!!caps.torch);
    } catch {}
    const el = video.current;
    if (el) { el.srcObject = s; el.muted = true; el.playsInline = true; try { await el.play(); } catch {} }
    setLoading(false);
  }, [audio, landscape]);

  // Ciclo de desenho
  useEffect(() => {
    let alive = true;
    const loop = () => {
      if (!alive) return;
      const v = video.current, c = canvas.current;
      if (v && c && v.readyState >= 2 && v.videoWidth) {
        const sw = v.videoWidth, sh = v.videoHeight;
        const W = landscape ? 1280 : 720, H = landscape ? 720 : 1280;
        if (c.width !== W) c.width = W;
        if (c.height !== H) c.height = H;
        const ctx = c.getContext('2d');
        if (ctx) drawFrame(ctx, v, sw, sh, W, H, FILTERS[fiRef.current], facing === 'user', stickers.current);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf.current); };
  }, [facing, landscape]);

  useEffect(() => { void start(facing); }, [facing, start]);
  // Parar tudo ao sair (ou quando a aba fica escondida muito tempo não é necessário: só ao desmontar)
  useEffect(() => () => { cancelAnimationFrame(raf.current); stopStream(stream.current); stream.current = null; }, []);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = canvas.current ? { canvas: canvas.current, audio: stream.current?.getAudioTracks() ?? [], filter: FILTERS[fiRef.current] } : null;
  });

  const toggleTorch = async () => {
    try {
      const t = stream.current?.getVideoTracks()[0];
      await t?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch { setTorchOk(false); }
  };

  const rel = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!canvas.current) return;
    const p = rel(e);
    const key = filter.sticker;
    if (key && hitSticker(filter, stickers.current[key], p.x, p.y)) { drag.current = { mode: 'drag', x0: p.x, y0: p.y }; try { canvas.current.setPointerCapture(e.pointerId); } catch {} }
    else drag.current = { mode: 'swipe', x0: e.clientX, y0: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; const key = filter.sticker;
    if (!d || d.mode !== 'drag' || !key || !canvas.current) return;
    const p = rel(e);
    stickers.current[key] = { x: Math.min(0.95, Math.max(0.05, p.x)), y: Math.min(0.95, Math.max(0.05, p.y)) };
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.mode !== 'swipe') return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) setFi((i) => (i + (dx < 0 ? 1 : -1) + FILTERS.length) % FILTERS.length);
  };

  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      <video ref={video} className="hidden" muted playsInline />
      <canvas ref={canvas} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
        className={`mx-auto block h-full max-h-full w-auto max-w-full touch-none select-none ${err ? 'invisible' : ''}`} style={{ aspectRatio: landscape ? '16 / 9' : '9 / 16' }} aria-label={`Pré-visualização da câmara com filtro ${filter.label}`} />

      {loading && !err && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">A abrir a câmara…</p>}
      {err && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-4xl">📷</p>
          <p className="text-base leading-relaxed text-white/85">{err}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-ghost min-h-[3rem] px-4 text-base" onClick={() => void start(facing)}>Tentar outra vez</button>
            {onFallback && (
              <label className="btn min-h-[3rem] cursor-pointer px-4 text-base">
                📁 Escolher do dispositivo
                <input type="file" className="hidden" accept={fallbackAccept} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFallback(f); e.target.value = ''; }} />
              </label>
            )}
          </div>
        </div>
      )}

      {!err && !locked && (
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} className="h-11 w-11 rounded-full bg-black/55 text-lg" aria-label="Trocar câmara frontal/traseira">🔄</button>
          {torchOk && <button type="button" onClick={toggleTorch} className={`h-11 w-11 rounded-full text-lg ${torch ? 'bg-amber-300/90 text-black' : 'bg-black/55'}`} aria-label={torch ? 'Desligar lanterna' : 'Ligar lanterna'}>🔦</button>}
        </div>
      )}

      {!err && (
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pt-6 ${compact ? 'pb-2' : 'pb-28'}`}>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="listbox" aria-label="Filtros">
            {FILTERS.map((f, k) => (
              <button key={f.id} type="button" role="option" aria-selected={k === fi} onClick={() => setFi(k)}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-2 text-sm font-semibold ${k === fi ? 'border-white bg-white text-black' : 'border-white/25 bg-black/50 text-white/85'}`}>
                <span aria-hidden>{f.icon}</span>{f.label}
              </button>
            ))}
          </div>
          {filter.sticker && <p className="mt-1 text-center text-xs text-white/70">Arrasta o {filter.sticker === 'crown' ? '👑' : 'texto'} para o mudar de lugar</p>}
        </div>
      )}
    </div>
  );
}
