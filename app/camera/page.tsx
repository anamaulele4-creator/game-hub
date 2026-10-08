'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MAX_UPLOAD_MB } from '@/lib/config';
import { Capture, pickRecorderType, setPendingCapture } from '@/lib/camera';
import { CamApi, CameraView } from '@/components/CameraView';

type Tipo = 'video' | 'long' | 'photo' | 'meme';
const MAX_SEC: Record<Tipo, number> = { video: 300, long: 7200, photo: 0, meme: 0 };
const SIZE_STOP = (MAX_UPLOAD_MB - 2) * 1024 * 1024; // para antes do limite do plano
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function CameraPage() {
  const router = useRouter();
  const api = useRef<CamApi | null>(null);
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [mode, setMode] = useState<'photo' | 'video'>('video');
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [msg, setMsg] = useState('');
  const [flash, setFlash] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const bytes = useRef(0);
  const t0 = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasStream = useRef<MediaStream | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tipo') as Tipo | null;
    const ok = t && ['video', 'long', 'photo', 'meme'].includes(t) ? t : null;
    setTipo(ok);
    setMode(ok === 'photo' || ok === 'meme' ? 'photo' : 'video');
  }, []);

  // Ao sair: parar gravação e faixas do canvas
  useEffect(() => () => {
    if (tick.current) clearInterval(tick.current);
    try { if (recorder.current && recorder.current.state !== 'inactive') { recorder.current.onstop = null; recorder.current.stop(); } } catch {}
    canvasStream.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
  }, []);

  const go = (c: Capture) => {
    setPendingCapture(c);
    router.push(`/publicar?tipo=${c.kind}`);
  };

  const fallback = (f: File) => {
    const isVid = f.type.startsWith('video/');
    go({ file: f, kind: isVid ? (tipo === 'long' ? 'long' : 'video') : (tipo === 'meme' ? 'meme' : 'photo') });
  };

  const photo = () => {
    const c = api.current?.canvas;
    if (!c || !c.width) { setMsg('A câmara ainda não está pronta.'); return; }
    setFlash(true); setTimeout(() => setFlash(false), 150);
    try {
      c.toBlob((b) => {
        if (!b) { setMsg('Não foi possível tirar a foto. Tenta outra vez.'); return; }
        go({ file: new File([b], `poipak-${Date.now()}.jpg`, { type: 'image/jpeg' }), kind: tipo === 'meme' ? 'meme' : 'photo' });
      }, 'image/jpeg', 0.9);
    } catch { setMsg('Não foi possível tirar a foto. Tenta outra vez.'); }
  };

  const stopRec = () => {
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    try { if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop(); } catch { setRec(false); }
  };

  const startRec = () => {
    setMsg('');
    const c = api.current?.canvas;
    const type = pickRecorderType();
    if (!c || !c.width) { setMsg('A câmara ainda não está pronta.'); return; }
    if (!type || typeof c.captureStream !== 'function') { setMsg('Este navegador não consegue gravar vídeo aqui. Usa "Escolher do dispositivo" ou grava com a câmara do telemóvel.'); return; }
    try {
      const cs = c.captureStream(30);
      canvasStream.current = cs;
      const out = new MediaStream([...cs.getVideoTracks(), ...(api.current?.audio ?? []).filter((t) => t.readyState === 'live')]);
      const mr = new MediaRecorder(out, { mimeType: type, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 64_000 });
      chunks.current = []; bytes.current = 0;
      const lim = MAX_SEC[tipo ?? 'video'] || 300;
      mr.ondataavailable = (e) => {
        if (!e.data?.size) return;
        chunks.current.push(e.data); bytes.current += e.data.size;
        if (bytes.current >= SIZE_STOP) { setMsg(`Chegaste ao limite de ${MAX_UPLOAD_MB} MB do plano atual.`); stopRec(); }
      };
      mr.onerror = () => { setMsg('A gravação falhou. Tenta outra vez.'); stopRec(); };
      mr.onstop = () => {
        setRec(false);
        cs.getTracks().forEach((t) => { try { t.stop(); } catch {} });
        const dur = Math.round((Date.now() - t0.current) / 1000);
        const base = type.split(';')[0];
        const blob = new Blob(chunks.current, { type: base });
        chunks.current = [];
        if (!blob.size || dur < 1) { setMsg('O vídeo ficou vazio. Grava pelo menos 1 segundo.'); return; }
        if (blob.size > MAX_UPLOAD_MB * 1024 * 1024) { setMsg(`O vídeo ficou com mais de ${MAX_UPLOAD_MB} MB. Grava um vídeo mais curto.`); return; }
        const ext = base.includes('mp4') ? 'mp4' : 'webm';
        const kind: Tipo = tipo === 'long' || dur > 300 ? 'long' : 'video';
        go({ file: new File([blob], `poipak-${Date.now()}.${ext}`, { type: base }), kind, duration: dur });
      };
      recorder.current = mr;
      mr.start(1000);
      t0.current = Date.now(); setSecs(0); setRec(true);
      tick.current = setInterval(() => {
        const s = (Date.now() - t0.current) / 1000;
        setSecs(s);
        if (s >= lim) { setMsg(`Tempo máximo: ${Math.round(lim / 60)} min.`); stopRec(); }
      }, 250);
    } catch {
      setMsg('Não foi possível começar a gravar neste navegador. Usa "Escolher do dispositivo".');
      setRec(false);
    }
  };

  const lim = MAX_SEC[tipo ?? 'video'] || 300;
  const canToggle = !tipo && !rec;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={() => router.back()} className="h-11 rounded-full bg-white/10 px-4 text-base" aria-label="Fechar a câmara">✕</button>
        <p className="text-sm font-semibold text-white/85">Câmara POIPAK</p>
        <span className="w-11" />
      </div>
      <div className="relative min-h-0 flex-1">
        <CameraView apiRef={api} audio={mode === 'video'} landscape={tipo === 'long'} onFallback={fallback}
          fallbackAccept={mode === 'photo' ? 'image/*' : 'video/*'} className="h-full" locked={rec} />
        {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}
        {rec && <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-red-600 px-3 py-1 text-sm font-bold">● {mmss(secs)} / {mmss(lim)}</span>}

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {msg && <p className="mx-4 rounded-xl bg-black/75 px-3 py-2 text-center text-sm text-amber-100">{msg}</p>}
          <div className="flex items-center gap-6">
            {canToggle && (
              <div className="flex rounded-full bg-black/60 p-1 text-sm">
                <button type="button" onClick={() => setMode('photo')} className={`rounded-full px-3 py-2 ${mode === 'photo' ? 'bg-white text-black' : 'text-white/80'}`}>Foto</button>
                <button type="button" onClick={() => setMode('video')} className={`rounded-full px-3 py-2 ${mode === 'video' ? 'bg-white text-black' : 'text-white/80'}`}>Vídeo</button>
              </div>
            )}
            <button type="button" onClick={mode === 'photo' ? photo : rec ? stopRec : startRec}
              aria-label={mode === 'photo' ? 'Tirar foto' : rec ? 'Parar gravação' : 'Começar a gravar'}
              className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/10">
              <span className={mode === 'photo' ? 'h-14 w-14 rounded-full bg-white' : rec ? 'h-8 w-8 rounded-md bg-red-600' : 'h-14 w-14 rounded-full bg-red-600'} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
