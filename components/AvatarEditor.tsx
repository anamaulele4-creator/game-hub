'use client';

import { useEffect, useRef, useState } from 'react';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { AvatarFace, Sheet, isImgAvatar } from './ui';

const OUT = 512;
const VIEW = 240;

function drawCrop(ctx: CanvasRenderingContext2D, img: HTMLImageElement, size: number, zoom: number, off: { x: number; y: number }) {
  const s = Math.min(img.naturalWidth, img.naturalHeight) / zoom; // lado do quadrado na imagem original
  const cx = img.naturalWidth / 2 - off.x * s, cy = img.naturalHeight / 2 - off.y * s;
  const sx = Math.min(Math.max(0, cx - s / 2), img.naturalWidth - s), sy = Math.min(Math.max(0, cy - s / 2), img.naturalHeight - s);
  ctx.fillStyle = '#121417'; ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
}

/** Editar perfil → foto de perfil: escolher/fotografar, recorte redondo com zoom, guardar, remover. */
export function AvatarEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, set, toast } = useStore();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [post, setPost] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; o: { x: number; y: number } } | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => { if (!open) { setImg(null); setErr(''); setZoom(1); setOff({ x: 0, y: 0 }); } }, [open]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => {
    const c = view.current; if (!c || !img) return;
    const ctx = c.getContext('2d'); if (ctx) drawCrop(ctx, img, VIEW * 2, zoom, off);
  }, [img, zoom, off]);

  const pick = (f?: File) => {
    setErr('');
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr('Escolhe uma imagem (JPG, PNG ou WebP).'); return; }
    if (f.size > 25 * 1024 * 1024) { setErr('Imagem demasiado grande (máx. 25 MB).'); return; }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const u = URL.createObjectURL(f); urlRef.current = u;
    const im = new Image();
    im.onload = () => { setImg(im); setZoom(1); setOff({ x: 0, y: 0 }); };
    im.onerror = () => setErr('Não foi possível abrir esta imagem. Experimenta outra (JPG ou PNG).');
    im.src = u;
  };

  const clampOff = (o: { x: number; y: number }, z: number) => {
    if (!img) return o;
    const m = Math.min(img.naturalWidth, img.naturalHeight);
    const lx = Math.max(0, (img.naturalWidth - m / z) / 2) / (m / z), ly = Math.max(0, (img.naturalHeight - m / z) / 2) / (m / z);
    return { x: Math.max(-lx, Math.min(lx, o.x)), y: Math.max(-ly, Math.min(ly, o.y)) };
  };

  const oldPath = (url: string, uid: string) => { const m = url.match(/\/clips\/([^?]+)$/); return m && m[1].startsWith(`${uid}/avatar-`) ? decodeURIComponent(m[1]) : null; };

  const save = async () => {
    if (!img || busy) return;
    setBusy(true); setErr('');
    try {
      const c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
      const ctx = c.getContext('2d'); if (!ctx) throw new Error('Este navegador não consegue preparar a foto.');
      drawCrop(ctx, img, OUT, zoom, off);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.86));
      if (!blob) throw new Error('Não foi possível preparar a foto.');
      if (IS_DEMO) {
        const url = c.toDataURL('image/jpeg', 0.8);
        set((p) => ({ ...p, user: { ...p.user, avatar: url } }));
        toast('Foto de perfil atualizada ✅'); onClose(); return;
      }
      const { sb } = await import('@/lib/supabase');
      const cl = await sb();
      const uid = (await cl.auth.getSession()).data.session?.user.id;
      if (!uid) throw new Error('A tua sessão terminou. Entra outra vez para mudar a foto.');
      const path = `${uid}/avatar-${Date.now()}.jpg`;
      const up = await cl.storage.from('clips').upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
      if (up.error) throw new Error('Não foi possível enviar a foto. Verifica a ligação e tenta outra vez.');
      const url = cl.storage.from('clips').getPublicUrl(path).data.publicUrl;
      const { error } = await cl.from('profiles').update({ avatar_url: url }).eq('id', uid);
      if (error) { await cl.storage.from('clips').remove([path]).catch(() => {}); throw new Error('Não foi possível guardar a foto no perfil. Tenta outra vez.'); }
      const prev = s.user.avatar;
      set((p) => ({ ...p, user: { ...p.user, avatar: url } }));
      const op = isImgAvatar(prev) ? oldPath(prev, uid) : null;
      if (op) void cl.storage.from('clips').remove([op]).then(() => {}, () => {});
      toast('Foto de perfil atualizada ✅');
      if (post) {
        try {
          const m = await import('@/lib/clips');
          const f = new File([blob], 'perfil.jpg', { type: 'image/jpeg' });
          await m.publishPost({ kind: 'photo', file: f, skipShrink: true, title: 'Atualizou a foto de perfil', description: '', game: 'Geral', tags: ['perfil'], visibility: 'public' }, () => {}).promise;
        } catch (e) {
          toast('A foto de perfil foi guardada, mas não foi publicada no feed: ' + ((e as Error)?.message || 'erro desconhecido'));
        }
      }
      onClose();
    } catch (e) {
      setErr((e as Error)?.message || 'Algo correu mal. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (!window.confirm('Remover a tua foto de perfil?')) return;
    setBusy(true); setErr('');
    try {
      const prev = s.user.avatar;
      if (!IS_DEMO) {
        const { sb } = await import('@/lib/supabase');
        const cl = await sb();
        const uid = (await cl.auth.getSession()).data.session?.user.id;
        if (!uid) throw new Error('A tua sessão terminou. Entra outra vez.');
        const { error } = await cl.from('profiles').update({ avatar_url: null }).eq('id', uid);
        if (error) throw new Error('Não foi possível remover a foto. Tenta outra vez.');
        const op = isImgAvatar(prev) ? oldPath(prev, uid) : null;
        if (op) void cl.storage.from('clips').remove([op]).then(() => {}, () => {});
      }
      set((p) => ({ ...p, user: { ...p.user, avatar: '🙂' } }));
      toast('Foto removida');
      onClose();
    } catch (e) {
      setErr((e as Error)?.message || 'Algo correu mal. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => { drag.current = { x: e.clientX, y: e.clientY, o: off }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    setOff(clampOff({ x: d.o.x + (e.clientX - d.x) / VIEW, y: d.o.y + (e.clientY - d.y) / VIEW }, zoom));
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Foto de perfil">
      <div className="flex flex-col items-center">
        {img ? (
          <canvas ref={view} width={VIEW * 2} height={VIEW * 2} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            className="touch-none rounded-full border-4 border-neon" style={{ width: VIEW, height: VIEW }} aria-label="Pré-visualização redonda da foto. Arrasta para ajustar." />
        ) : (
          <span className="flex items-center justify-center overflow-hidden rounded-full border-4 border-line bg-panel2 text-7xl" style={{ width: VIEW * 0.75, height: VIEW * 0.75 }}>
            <AvatarFace a={s.user.avatar} name={s.user.name} fill />
          </span>
        )}
        {img && (
          <label className="mt-4 w-full text-sm text-white/80">
            Zoom
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => { const z = Number(e.target.value); setZoom(z); setOff((o) => clampOff(o, z)); }} className="mt-1 w-full accent-[#5b9bd5]" aria-label="Zoom" />
            <span className="block text-center text-xs text-white/50">Arrasta a foto para a centrar</span>
          </label>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className={`btn-ghost flex min-h-[3rem] cursor-pointer items-center justify-center text-base ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          🖼️ Galeria
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <label className={`btn-ghost flex min-h-[3rem] cursor-pointer items-center justify-center text-base ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          📸 Câmara
          <input type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>

      {img && (
        <label className="mt-3 flex items-center gap-3 rounded-xl bg-panel2 p-3 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={post} onChange={(e) => setPost(e.target.checked)} />
          Publicar também como foto no feed
        </label>
      )}
      {err && <p className="mt-3 rounded-xl bg-red-500/15 p-3 text-sm text-red-300">{err}</p>}

      <button className="btn mt-4 min-h-[3.25rem] w-full text-base disabled:opacity-40" disabled={!img || busy} onClick={save}>{busy ? 'A guardar…' : 'Guardar foto de perfil'}</button>
      {isImgAvatar(s.user.avatar) && !img && (
        <button className="mt-2 min-h-[3rem] w-full rounded-2xl border border-red-500/50 text-base text-red-200 disabled:opacity-40" disabled={busy} onClick={remove}>Remover foto</button>
      )}
    </Sheet>
  );
}
