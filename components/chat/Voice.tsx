'use client';

// Mensagens de voz: gravação (MediaRecorder, máx. 5 min, forma de onda) e leitor com velocidade 1× / 1,5× / 2×.
import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_MAX_SEC, fmtSec } from '@/lib/chat';

let playing: HTMLAudioElement | null = null;
const SPEEDS = [1, 1.5, 2];

export function VoicePlayer({ src, dur, wave, mine, avatar }: { src: string; dur?: number; wave?: string; mine?: boolean; avatar?: React.ReactNode }) {
  const a = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const [t, setT] = useState(0);
  const [total, setTotal] = useState(dur ?? 0);
  const [speed, setSpeed] = useState(1);
  const [err, setErr] = useState(false);
  const bars = (wave && wave.length ? wave : 'deghjlmkjhgfegijlnmkigfdcegikjhf').split('').map((ch) => Math.max(0.12, (ch.charCodeAt(0) - 97) / 15));
  const n = 32;
  const shown = Array.from({ length: n }, (_, i) => bars[Math.floor((i / n) * bars.length)] ?? 0.2);
  const p = total ? Math.min(1, t / total) : 0;

  useEffect(() => { const el = a.current; if (el) el.playbackRate = speed; }, [speed]);
  useEffect(() => () => { if (playing === a.current) playing = null; }, []);

  const toggle = async () => {
    const el = a.current; if (!el) return;
    if (on) { el.pause(); return; }
    if (playing && playing !== el) playing.pause();
    playing = el;
    el.playbackRate = speed;
    try { await el.play(); } catch { setErr(true); }
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = a.current; if (!el || !total) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total)); setT(el.currentTime);
  };

  return (
    <div className="flex min-w-[210px] items-center gap-2 py-0.5">
      <audio ref={a} src={src} preload="metadata"
        onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => { setOn(false); setT(0); }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onError={() => setErr(true)}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (isFinite(d) && d > 0) setTotal(d); }} />
      {avatar}
      <button type="button" onClick={toggle} aria-label={on ? 'Pausar' : 'Ouvir mensagem de voz'} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${mine ? 'bg-white/20' : 'bg-neon/80'}`}>{on ? '❚❚' : '▶'}</button>
      <div className="min-w-0 flex-1">
        <div className="flex h-8 cursor-pointer items-center gap-[2px]" onClick={seek} role="slider" aria-label="Posição" aria-valuenow={Math.round(t)} aria-valuemin={0} aria-valuemax={Math.round(total)}>
          {shown.map((v, i) => <span key={i} className={`w-[3px] flex-1 rounded-full ${i / n < p ? (mine ? 'bg-white' : 'bg-neon2') : mine ? 'bg-white/40' : 'bg-white/30'}`} style={{ height: `${Math.round(v * 100)}%` }} />)}
        </div>
        <p className="text-[11px] text-white/70">{err ? 'Não foi possível tocar' : fmtSec(on || t ? t : total)}</p>
      </div>
      <button type="button" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} className="shrink-0 rounded-full bg-black/25 px-2 py-1 text-xs font-bold" aria-label="Velocidade">{String(speed).replace('.', ',')}×</button>
    </div>
  );
}

export interface Recording { blob: Blob; dur: number; wave: string; mime: string }
interface RecState { mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; t0: number; peaks: number[]; ctx?: AudioContext; iv?: ReturnType<typeof setInterval>; mime: string }
const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? '';
};

/** Gravador de voz. start() pede o microfone; stop(true) devolve a gravação, stop(false) descarta. */
export function useRecorder(onAutoStop: (r: Recording) => void) {
  const [rec, setRec] = useState(false);
  const [sec, setSec] = useState(0);
  const [level, setLevel] = useState(0);
  const st = useRef<RecState | null>(null);
  const autoRef = useRef(onAutoStop); autoRef.current = onAutoStop;

  const finish = useCallback((keep: boolean): Promise<Recording | null> => new Promise((resolve) => {
    const s = st.current; if (!s) { resolve(null); return; }
    st.current = null;
    if (s.iv) clearInterval(s.iv);
    const dur = (Date.now() - s.t0) / 1000;
    s.mr.onstop = () => {
      s.stream.getTracks().forEach((t) => t.stop());
      try { void s.ctx?.close(); } catch {}
      setRec(false); setSec(0); setLevel(0);
      if (!keep || dur < 0.7) { resolve(null); return; }
      const blob = new Blob(s.chunks, { type: s.mime.split(';')[0] || 'audio/webm' });
      const pk = s.peaks.length ? s.peaks : [0.3];
      const max = Math.max(0.05, ...pk);
      const N = 40;
      const wave = Array.from({ length: N }, (_, i) => { const a = Math.floor((i / N) * pk.length), b = Math.max(a + 1, Math.floor(((i + 1) / N) * pk.length)); const v = Math.max(...pk.slice(a, b)); return String.fromCharCode(97 + Math.round(Math.min(1, v / max) * 15)); }).join('');
      resolve({ blob, dur, wave, mime: blob.type });
    };
    try { s.mr.stop(); } catch { resolve(null); }
  }), []);

  const start = useCallback(async (): Promise<string | null> => {
    if (st.current) return null;
    const mime = pickMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) return 'Este navegador não consegue gravar áudio.';
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { return 'Permite o acesso ao microfone para gravar mensagens de voz.'; }
    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    const s: RecState = { mr, stream, chunks: [], t0: Date.now(), peaks: [], mime };
    mr.ondataavailable = (e) => { if (e.data.size) s.chunks.push(e.data); };
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const ctx = new AC(); const an = ctx.createAnalyser(); an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an); s.ctx = ctx;
        const buf = new Uint8Array(an.fftSize);
        s.iv = setInterval(() => {
          an.getByteTimeDomainData(buf);
          let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] - 128));
          const v = m / 128; s.peaks.push(v); setLevel(v);
          const el = (Date.now() - s.t0) / 1000; setSec(el);
          if (el >= VOICE_MAX_SEC) void finish(true).then((r) => { if (r) autoRef.current(r); });
        }, 100);
      }
    } catch {}
    if (!s.iv) s.iv = setInterval(() => { const el = (Date.now() - s.t0) / 1000; setSec(el); s.peaks.push(0.3 + Math.random() * 0.4); if (el >= VOICE_MAX_SEC) void finish(true).then((r) => { if (r) autoRef.current(r); }); }, 100);
    mr.start(250);
    st.current = s; setRec(true); setSec(0);
    return null;
  }, [finish]);

  useEffect(() => () => { void finish(false); }, [finish]);
  return { rec, sec, level, start, stop: finish };
}
