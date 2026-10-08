'use client';

// Recorte redondo de foto (mesmo editor da foto de perfil) para a foto do grupo.
import { useEffect, useRef, useState } from 'react';
import { drawCrop } from '../AvatarEditor';
import { Sheet } from '../ui';

const OUT = 512;
const VIEW = 220;

export function PhotoCropSheet({ open, onClose, title, onDone }: { open: boolean; onClose: () => void; title: string; onDone: (blob: Blob, preview: string) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [err, setErr] = useState('');
  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; o: { x: number; y: number } } | null>(null);

  useEffect(() => { if (!open) { setImg(null); setErr(''); setZoom(1); setOff({ x: 0, y: 0 }); } }, [open]);
  useEffect(() => { const c = view.current; if (!c || !img) return; const ctx = c.getContext('2d'); if (ctx) drawCrop(ctx, img, VIEW * 2, zoom, off); }, [img, zoom, off]);

  const pick = (f?: File) => {
    setErr('');
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr('Escolhe uma imagem (JPG, PNG ou WebP).'); return; }
    const u = URL.createObjectURL(f); const im = new Image();
    im.onload = () => { setImg(im); setZoom(1); setOff({ x: 0, y: 0 }); };
    im.onerror = () => setErr('Não foi possível abrir esta imagem.');
    im.src = u;
  };
  const clampOff = (o: { x: number; y: number }, z: number) => {
    if (!img) return o;
    const m = Math.min(img.naturalWidth, img.naturalHeight);
    const lx = Math.max(0, (img.naturalWidth - m / z) / 2) / (m / z), ly = Math.max(0, (img.naturalHeight - m / z) / 2) / (m / z);
    return { x: Math.max(-lx, Math.min(lx, o.x)), y: Math.max(-ly, Math.min(ly, o.y)) };
  };
  const save = () => {
    if (!img) return;
    const c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
    const ctx = c.getContext('2d'); if (!ctx) return;
    drawCrop(ctx, img, OUT, zoom, off);
    const prev = c.toDataURL('image/jpeg', 0.8);
    c.toBlob((b) => { if (b) { onDone(b, prev); onClose(); } else setErr('Não foi possível preparar a foto.'); }, 'image/jpeg', 0.86);
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col items-center">
        {img ? (
          <canvas ref={view} width={VIEW * 2} height={VIEW * 2}
            onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, o: off }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} }}
            onPointerMove={(e) => { const d = drag.current; if (d) setOff(clampOff({ x: d.o.x + (e.clientX - d.x) / VIEW, y: d.o.y + (e.clientY - d.y) / VIEW }, zoom)); }}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            className="touch-none rounded-full border-4 border-neon" style={{ width: VIEW, height: VIEW }} aria-label="Pré-visualização. Arrasta para ajustar." />
        ) : <span className="flex h-40 w-40 items-center justify-center rounded-full border-4 border-line bg-panel2 text-6xl">📷</span>}
        {img && (
          <label className="mt-4 w-full text-sm text-white/80">Zoom
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => { const z = Number(e.target.value); setZoom(z); setOff((o) => clampOff(o, z)); }} className="mt-1 w-full accent-[#5b9bd5]" aria-label="Zoom" />
          </label>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="btn-ghost flex min-h-[3rem] cursor-pointer items-center justify-center text-base">🖼️ Galeria<input type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <label className="btn-ghost flex min-h-[3rem] cursor-pointer items-center justify-center text-base">📸 Câmara<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      {err && <p className="mt-3 rounded-xl bg-red-500/15 p-3 text-sm text-red-300">{err}</p>}
      <button className="btn mt-4 min-h-[3.25rem] w-full text-base" disabled={!img} onClick={save}>Usar esta foto</button>
    </Sheet>
  );
}
