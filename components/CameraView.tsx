'use client';

import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { CamFilter, DEFAULT_STICKER_POS, FILTERS, STICKERS, StickerId, StickerPos, cameraError, drawFrame, hitSticker, stopStream } from '@/lib/camera';

export interface CamApi { canvas: HTMLCanvasElement; readonly audio: MediaStreamTrack[]; readonly filter: CamFilter; readonly stickers: StickerId[] }

/** Tamanhos de saída (o canvas é o que vai para a foto, a gravação e a live). */
const SIZES = { portrait: [[720, 1280], [540, 960]], landscape: [[1280, 720], [960, 540]] } as const;
const FRAME_MS = 1000 / 30; // ~30 fps (não desenhar 60×/s num ecrã de 60 Hz)

/**
 * Câmara com filtros: getUserMedia → <video> escondido → canvas (filtro animado) visível.
 * Um único ciclo de desenho (requestAnimationFrame, limitado a ~30 fps) que lê tudo de refs,
 * por isso mudar de filtro nunca pára nem duplica o ciclo.
 * Frente/trás, lanterna (se suportada), chips de filtros, deslizar para mudar, stickers arrastáveis.
 * Pára todas as faixas ao sair. Nunca lança erro: mostra mensagem e "Escolher do dispositivo".
 */
export function CameraView({ apiRef, audio = true, landscape = false, onFallback, fallbackAccept = 'image/*,video/*', className = '', compact = false, locked = false }: {
  apiRef?: MutableRefObject<CamApi | null>; audio?: boolean; landscape?: boolean; onFallback?: (f: File) => void; fallbackAccept?: string; className?: string; compact?: boolean; locked?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const startToken = useRef(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [fi, setFi] = useState(0);
  const [active, setActive] = useState<StickerId[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [torchOk, setTorchOk] = useState(false);
  const [torch, setTorch] = useState(false);
  const [toast, setToast] = useState('');
  const [reduced, setReduced] = useState(false);

  // Estado lido pelo ciclo de desenho (refs = sem reiniciar o ciclo)
  const st = useRef({ fi: 0, active: [] as StickerId[], mirror: true, landscape, locked, reduced: false, low: false });
  st.current.fi = fi; st.current.active = active; st.current.landscape = landscape; st.current.locked = locked; st.current.reduced = reduced;
  const pos = useRef<Record<StickerId, StickerPos>>({ ...DEFAULT_STICKER_POS });
  const drag = useRef<{ mode: 'drag' | 'swipe'; id?: StickerId; x0: number; y0: number; moved: boolean } | null>(null);
  const filter = FILTERS[fi];

  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReduced(mq.matches);
      const on = () => setReduced(mq.matches);
      mq.addEventListener?.('change', on);
      return () => mq.removeEventListener?.('change', on);
    } catch { return undefined; }
  }, []);

  // Nome do filtro aparece por instantes ao mudar
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setToast(FILTERS[fi].label);
    const t = setTimeout(() => setToast(''), 900);
    return () => clearTimeout(t);
  }, [fi]);

  const start = useCallback(async (face: 'user' | 'environment') => {
    const my = ++startToken.current; // evita corridas ao trocar de câmara depressa (Android: "câmara ocupada")
    stopStream(stream.current); stream.current = null;
    setErr(''); setLoading(true); setTorch(false); setTorchOk(false);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setErr('Este navegador não permite usar a câmara. Escolhe um ficheiro do dispositivo.'); setLoading(false); return; }
    // Pedimos no máximo 720p: mais do que isso só gasta CPU num telemóvel de gama baixa.
    const v: MediaTrackConstraints = { facingMode: face, width: { ideal: landscape ? 1280 : 720 }, height: { ideal: landscape ? 720 : 1280 }, frameRate: { ideal: 30, max: 30 } };
    let s: MediaStream | null = null;
    try { s = await navigator.mediaDevices.getUserMedia({ video: v, audio: audio ? { echoCancellation: true, noiseSuppression: true } : false }); }
    catch (e) {
      if (my !== startToken.current) return;
      // Sem microfone (ou recusado): tenta só vídeo; câmara pedida inexistente: tenta qualquer câmara
      try { s = await navigator.mediaDevices.getUserMedia({ video: audio ? v : { frameRate: { ideal: 30, max: 30 } }, audio: false }); }
      catch (e2) { if (my === startToken.current) setErr(cameraError(audio ? e2 : e)); }
    }
    if (my !== startToken.current) { stopStream(s); return; }
    if (!s) { setLoading(false); return; }
    stream.current = s;
    try {
      const vt = s.getVideoTracks()[0];
      const set = vt?.getSettings?.() ?? {};
      // Espelhar só a câmara frontal (se o browser disser qual é; senão, segue o pedido)
      st.current.mirror = set.facingMode ? set.facingMode === 'user' : face === 'user';
      const caps = (vt?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorchOk(!!caps.torch);
    } catch { st.current.mirror = face === 'user'; }
    const el = video.current;
    if (el) { el.srcObject = s; el.muted = true; el.playsInline = true; try { await el.play(); } catch {} }
    if (my === startToken.current) setLoading(false);
  }, [audio, landscape]);

  // Ciclo de desenho único (montado uma vez)
  useEffect(() => {
    let alive = true, raf = 0, last = 0, ctx: CanvasRenderingContext2D | null = null, ctxFor: HTMLCanvasElement | null = null;
    let slow = 0, n = 0;
    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS - 4) return;
      const dt = last ? now - last : FRAME_MS;
      last = now;
      const v = video.current, c = canvas.current, S = st.current;
      if (!v || !c || v.readyState < 2 || !v.videoWidth) return;
      const [W, H] = SIZES[S.landscape ? 'landscape' : 'portrait'][S.low ? 1 : 0];
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      if (ctxFor !== c) { ctx = c.getContext('2d', { alpha: false, desynchronized: true } as CanvasRenderingContext2DSettings) ?? c.getContext('2d'); ctxFor = c; }
      if (!ctx) return;
      drawFrame(ctx, v, v.videoWidth, v.videoHeight, W, H, FILTERS[S.fi] ?? FILTERS[0], { t: now, mirror: S.mirror, stickers: S.active, pos: pos.current, reduced: S.reduced });
      // Telemóvel lento (< ~20 fps durante 2 s)? Baixa para 540p — só quando não está a gravar/transmitir.
      if (!S.low && !S.locked && !document.hidden) {
        if (dt > 52) slow++;
        if (++n >= 60) { if (slow > 40) S.low = true; n = 0; slow = 0; }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => { void start(facing); }, [facing, start]);
  useEffect(() => () => { startToken.current++; stopStream(stream.current); stream.current = null; }, []);

  // API estável para foto / gravação / live (getters = sempre o valor atual)
  useEffect(() => {
    if (!apiRef) return;
    const c = canvas.current;
    if (!c) { apiRef.current = null; return; }
    apiRef.current = {
      canvas: c,
      get audio() { return stream.current?.getAudioTracks() ?? []; },
      get filter() { return FILTERS[st.current.fi]; },
      get stickers() { return [...st.current.active]; },
    };
    return () => { apiRef.current = null; };
  }, [apiRef]);

  const toggleTorch = async () => {
    try {
      const t = stream.current?.getVideoTracks()[0];
      await t?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch { setTorchOk(false); }
  };

  const toggleSticker = (id: StickerId) => setActive((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  /** Ponto do toque em fração do conteúdo do canvas (o canvas usa object-contain: há margens). */
  const rel = (e: React.PointerEvent) => {
    const c = canvas.current!, r = c.getBoundingClientRect();
    const cw = c.width || 9, ch = c.height || 16;
    const sc = Math.min(r.width / cw, r.height / ch);
    const w = cw * sc, h = ch * sc, ox = r.left + (r.width - w) / 2, oy = r.top + (r.height - h) / 2;
    return { x: (e.clientX - ox) / w, y: (e.clientY - oy) / h };
  };
  const onDown = (e: React.PointerEvent) => {
    const c = canvas.current; if (!c) return;
    const p = rel(e);
    const id = hitSticker(st.current.active, pos.current, p.x, p.y, c.width || 720, c.height || 1280);
    drag.current = id ? { mode: 'drag', id, x0: p.x, y0: p.y, moved: false } : { mode: 'swipe', x0: e.clientX, y0: e.clientY, moved: false };
    try { c.setPointerCapture(e.pointerId); } catch {}
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.mode !== 'drag' || !d.id || !canvas.current) return;
    const p = rel(e);
    d.moved = true;
    pos.current[d.id] = { x: Math.min(0.95, Math.max(0.05, p.x)), y: Math.min(0.95, Math.max(0.05, p.y)) };
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    try { canvas.current?.releasePointerCapture(e.pointerId); } catch {}
    if (!d || d.mode !== 'swipe') return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setFi((i) => (i + (dx < 0 ? 1 : -1) + FILTERS.length) % FILTERS.length);
  };

  // Mantém o chip ativo visível
  const chipRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chipRow.current?.children[fi] as HTMLElement | undefined;
    try { el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'center', block: 'nearest' }); } catch {}
  }, [fi, reduced]);

  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      <video ref={video} className="pointer-events-none absolute h-px w-px opacity-0" muted playsInline aria-hidden />
      <canvas ref={canvas} width={landscape ? 1280 : 720} height={landscape ? 720 : 1280} data-filter={filter.id}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
        className={`block h-full w-full touch-none select-none object-contain ${err ? 'invisible' : ''}`}
        aria-label={`Pré-visualização da câmara com filtro ${filter.label}`} />

      {toast && <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-2xl font-extrabold text-white [text-shadow:0_2px_8px_rgba(0,0,0,.7)] motion-safe:animate-pulse">{toast}</p>}
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
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pt-6 ${compact ? 'pb-2' : 'pb-28'}`}>
          <div className="mb-1.5 flex justify-center gap-1.5" role="group" aria-label="Stickers">
            {STICKERS.map((s) => {
              const on = active.includes(s.id);
              return (
                <button key={s.id} type="button" aria-pressed={on} data-sticker={s.id} onClick={() => toggleSticker(s.id)}
                  className={`flex h-9 items-center gap-1 rounded-full border px-2.5 text-xs font-bold ${on ? 'border-[#5b9bd5] bg-[#5b9bd5]/30 text-white' : 'border-white/20 bg-black/50 text-white/80'}`}>
                  <span aria-hidden className={on ? 'fx-stk' : ''}>{s.icon}</span>{s.label}
                </button>
              );
            })}
          </div>
          <div ref={chipRow} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="listbox" aria-label="Filtros">
            {FILTERS.map((f, k) => (
              <button key={f.id} type="button" role="option" aria-selected={k === fi} data-filter={f.id} onClick={() => setFi(k)} title={f.desc}
                className={`flex shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 py-1 ${k === fi ? 'bg-white/15' : ''}`}>
                <span aria-hidden className={`fx-chip fx-${f.id} ${k === fi ? 'ring-2 ring-white' : 'ring-1 ring-white/25'}`}><span>{f.icon}</span></span>
                <span className={`max-w-[4.6rem] truncate text-[11px] font-semibold ${k === fi ? 'text-white' : 'text-white/75'}`}>{f.label}</span>
              </button>
            ))}
          </div>
          {active.length > 0 && <p className="mt-0.5 text-center text-xs text-white/70">Arrasta os stickers para os mudar de lugar</p>}
        </div>
      )}
    </div>
  );
}
