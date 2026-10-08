// Detetor de som (no telemóvel, sem enviar nada): descodifica o áudio do vídeo com Web Audio,
// mede pico/RMS/loudness aproximada (LUFS sem filtro K) e sugere um ganho. Também mede brilho/movimento.
import { MAX_GAIN } from './media';

export type SoundState = 'none' | 'low' | 'good';
export interface SoundResult { state: SoundState; peakDb: number; rmsDb: number; lufs: number; gain: number; canRaise: boolean; analysedSec: number }

const MAX_SEC = 60;            // só analisa o primeiro minuto
const TARGET_LUFS = -14;
const PEAK_CEIL_DB = -1;
const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -120);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Procura rapidamente uma faixa de áudio no contentor (MP4/MOV: hdlr 'soun'; WebM/MKV: codec A_…). null = não sei. */
export async function hasAudioTrack(file: Blob): Promise<boolean | null> {
  try {
    const N = 3 * 1024 * 1024;
    const parts = file.size <= 2 * N ? [file] : [file.slice(0, N), file.slice(file.size - N)];
    let sawContainer = false;
    for (const [pi, p] of parts.entries()) {
      const b = new Uint8Array(await p.arrayBuffer());
      const head = pi === 0 ? Math.min(b.length, 65536) : 0; // cabeçalhos Matroska/WebM estão no início
      for (let i = 0; i < b.length - 16; i++) {
        // 'hdlr' .... .... 'soun'
        if (b[i] === 0x68 && b[i + 1] === 0x64 && b[i + 2] === 0x6c && b[i + 3] === 0x72) {
          sawContainer = true;
          if (b[i + 12] === 0x73 && b[i + 13] === 0x6f && b[i + 14] === 0x75 && b[i + 15] === 0x6e) return true;
        }
        // Matroska CodecID "A_" (A_OPUS, A_VORBIS, A_AAC…) e DocType webm
        if (i < head && b[i] === 0x86 && b[i + 2] === 0x41 && b[i + 3] === 0x5f) return true;
        if (i < head && b[i] === 0x77 && b[i + 1] === 0x65 && b[i + 2] === 0x62 && b[i + 3] === 0x6d) sawContainer = true;
      }
    }
    return sawContainer ? false : null;
  } catch { return null; }
}

function decodeCtx(): BaseAudioContext | null {
  const W = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext; AudioContext?: typeof AudioContext };
  const OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext;
  try { if (OAC) return new OAC(1, 44100, 44100); } catch {}
  try { if (W.AudioContext) return new W.AudioContext(); } catch {}
  return null;
}

function decode(c: BaseAudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((res, rej) => {
    try {
      const p = c.decodeAudioData(buf, res, rej) as unknown as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(res, rej);
    } catch (e) { rej(e); }
  });
}

/**
 * Analisa o som. onProgress(0..1). Lança erro se não conseguir (o ecrã mostra "podes publicar na mesma").
 * Ficheiros grandes: tenta só os primeiros 16 MB (vídeos gravados no telemóvel/web costumam ter o índice no início).
 */
export async function analyseSound(file: Blob, onProgress: (p: number) => void = () => {}): Promise<SoundResult> {
  onProgress(0.02);
  const track = await hasAudioTrack(file);
  if (track === false) { onProgress(1); return { state: 'none', peakDb: -120, rmsDb: -120, lufs: -120, gain: 1, canRaise: false, analysedSec: 0 }; }
  const c = decodeCtx();
  if (!c) throw new Error('Web Audio indisponível');
  const LIMIT = 16 * 1024 * 1024;
  const tries: Blob[] = file.size > LIMIT ? [file.slice(0, LIMIT), file] : [file];
  if (file.size > 40 * 1024 * 1024) tries.pop(); // não descodifica ficheiros enormes inteiros (memória em telemóveis baratos)
  let ab: AudioBuffer | null = null;
  let lastErr: unknown = null;
  for (const part of tries) {
    try {
      onProgress(0.1);
      const raw = await part.arrayBuffer();
      onProgress(0.35);
      ab = await decode(c, raw);
      break;
    } catch (e) { lastErr = e; }
  }
  try { (c as AudioContext).close?.(); } catch {}
  if (!ab) {
    // Sem faixa de áudio reconhecível + falha na descodificação → muito provavelmente vídeo sem som
    if (track === null && /decode|encoding|unable/i.test(String((lastErr as Error)?.message ?? lastErr))) {
      const probe = await silentByPlayback(file);
      if (probe === true) { onProgress(1); return { state: 'none', peakDb: -120, rmsDb: -120, lufs: -120, gain: 1, canRaise: false, analysedSec: 0 }; }
    }
    throw lastErr ?? new Error('Falha ao descodificar');
  }
  onProgress(0.6);
  const sr = ab.sampleRate;
  const n = Math.min(ab.length, Math.floor(sr * MAX_SEC));
  const chans = Math.min(ab.numberOfChannels, 2);
  const data = Array.from({ length: chans }, (_, k) => ab!.getChannelData(k));
  const block = Math.floor(sr * 0.4), hop = Math.floor(sr * 0.1);
  let peak = 0, sumSq = 0;
  const blocks: number[] = [];
  // Energia por janelas de 100 ms (depois junta em blocos de 400 ms com 75% de sobreposição, como no BS.1770)
  const hops: number[] = [];
  for (let s = 0; s + hop <= n; s += hop) {
    let e = 0;
    for (let ch = 0; ch < chans; ch++) {
      const d = data[ch];
      for (let i = s; i < s + hop; i++) { const x = d[i]; e += x * x; const a = x < 0 ? -x : x; if (a > peak) peak = a; }
    }
    sumSq += e;
    hops.push(e / hop);
    if (hops.length % 50 === 0) { onProgress(0.6 + 0.35 * (s / n)); await tick(); }
  }
  const per = block / hop;
  for (let k = 0; k + per <= hops.length; k++) { let m = 0; for (let j = 0; j < per; j++) m += hops[k + j]; blocks.push(m / per); }
  const L = (ms: number) => -0.691 + 10 * Math.log10(ms || 1e-12);
  const abs = blocks.filter((m) => L(m) > -70);
  let lufs = -120;
  if (abs.length) {
    const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
    const rel = abs.filter((m) => L(m) > L(meanAbs) - 10);
    lufs = L(rel.reduce((a, b) => a + b, 0) / (rel.length || 1));
  }
  const peakDb = db(peak);
  const rmsDb = n ? 10 * Math.log10(sumSq / (n * chans) || 1e-12) : -120;
  const want = Math.pow(10, (TARGET_LUFS - lufs) / 20);
  const peakRoom = Math.pow(10, (PEAK_CEIL_DB - peakDb) / 20);
  const gain = Math.max(1, Math.min(MAX_GAIN, want, peakRoom));
  const state: SoundState = peakDb < -50 || lufs < -55 ? 'none' : lufs < -23 ? 'low' : 'good';
  onProgress(1);
  return { state, peakDb, rmsDb, lufs, gain: state === 'none' ? 1 : gain, canRaise: state === 'low' && gain >= 1.4, analysedSec: n / sr };
}

/** Recurso: toca 1,5 s sem som e vê se o navegador descodificou algum byte de áudio (Chrome/Safari). */
function silentByPlayback(file: Blob): Promise<boolean | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video') as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean };
    const url = URL.createObjectURL(file);
    let done = false;
    const end = (r: boolean | null) => { if (done) return; done = true; try { v.pause(); } catch {} v.removeAttribute('src'); URL.revokeObjectURL(url); resolve(r); };
    v.muted = true; v.playsInline = true; v.src = url;
    setTimeout(() => {
      if (typeof v.mozHasAudio === 'boolean') return end(!v.mozHasAudio);
      if (typeof v.webkitAudioDecodedByteCount === 'number') return end(v.webkitAudioDecodedByteCount === 0);
      end(null);
    }, 1800);
    v.onerror = () => end(null);
    void v.play()?.catch(() => end(null));
  });
}

// ---------- Brilho e movimento (6 fotogramas pequenos) ----------
export interface VisualResult { brightness: number; motion: number }
export function analyseVisual(url: string, duration: number | null): Promise<VisualResult | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
    const g = cv.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    const frames: Uint8ClampedArray[] = [];
    let idx = 0, done = false;
    const D = duration && isFinite(duration) ? duration : 10;
    const times = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((f) => Math.min(D - 0.1, Math.max(0.05, f * D)));
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer); v.removeAttribute('src');
      if (!frames.length) return resolve(null);
      let lum = 0, diff = 0;
      frames.forEach((f, k) => {
        for (let i = 0; i < f.length; i += 4) {
          const y = 0.2126 * f[i] + 0.7152 * f[i + 1] + 0.0722 * f[i + 2];
          lum += y;
          if (k) { const p = frames[k - 1]; diff += Math.abs(y - (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2])); }
        }
      });
      const px = frames[0].length / 4;
      resolve({ brightness: lum / (px * frames.length) / 255, motion: frames.length > 1 ? diff / (px * (frames.length - 1)) / 255 : 0 });
    };
    const timer = setTimeout(finish, 7000);
    const next = () => { if (idx >= times.length) return finish(); try { v.currentTime = times[idx++]; } catch { finish(); } };
    v.onloadeddata = next;
    v.onseeked = () => {
      try { g?.drawImage(v, 0, 0, 32, 32); const d = g?.getImageData(0, 0, 32, 32).data; if (d) frames.push(new Uint8ClampedArray(d)); } catch { return finish(); }
      next();
    };
    v.onerror = finish;
  });
}

// ---------- POIPAK IA: humor do vídeo → termos de pesquisa ----------
export interface Mood { label: string; queries: string[]; why: string }
const has = (s: string, re: RegExp) => re.test(s);
export function moodFor(o: { game?: string; caption?: string; tags?: string[]; visual?: VisualResult | null; kind?: string }): Mood {
  const txt = [o.caption ?? '', ...(o.tags ?? [])].join(' ').toLowerCase();
  const g = (o.game ?? '').toLowerCase();
  const why: string[] = [];
  let label = 'Gaming'; let q: string[] = [];
  if (has(txt, /kk+|haha|rs+\b|engraç|meme|lol|😂|🤣|piada|zoeira|fail/)) { label = 'Divertido'; q = ['funny', 'quirky', 'comedy']; why.push('a legenda é divertida'); }
  else if (has(txt, /chill|relax|calm|noite|night|tranquil|lofi|sono|chuva|saudade/)) { label = 'Calmo'; q = ['lofi', 'chill', 'ambient']; why.push('a legenda é calma'); }
  else if (has(txt, /dança|danc|festa|party|amapiano|marrabenta|kizomba|afro/)) { label = 'Festa'; q = ['afrobeat', 'dance', 'house']; why.push('fala de festa/dança'); }
  else if (has(txt, /booyah|kill|clutch|vitória|vitoria|ganh|win|rank|mvp|boss|épic|epic|headshot|final|torneio/)) { label = 'Épico'; q = ['epic', 'trailer', 'action']; why.push('é uma jogada épica'); }
  else if (/free fire|pubg|call of duty|cod/.test(g)) { label = 'Ação'; q = ['epic electronic', 'action', 'dubstep']; why.push(`jogo de tiro (${o.game})`); }
  else if (/football|fifa|fc mobile/.test(g)) { label = 'Energia'; q = ['hip hop', 'energetic', 'beat']; why.push(`futebol (${o.game})`); }
  else if (/legends/.test(g)) { label = 'Épico'; q = ['epic orchestral', 'cinematic', 'epic']; why.push(`MOBA (${o.game})`); }
  else if (o.kind === 'text' || o.kind === 'photo') { label = 'Suave'; q = ['acoustic', 'chill', 'piano']; why.push('momento/foto'); }
  else { q = ['electronic', 'hip hop', 'upbeat']; }
  const v = o.visual;
  if (v) {
    if (v.motion > 0.12) { q.unshift(label === 'Calmo' ? 'upbeat' : 'energetic'); why.push('muito movimento'); }
    else if (v.motion < 0.03 && label !== 'Festa') { q.push('chill'); why.push('pouco movimento'); }
    if (v.brightness < 0.25) { q.push('dark'); why.push('imagem escura'); }
    else if (v.brightness > 0.6) { q.push('happy'); why.push('imagem clara'); }
  }
  return { label, queries: Array.from(new Set(q)).slice(0, 4), why: why.length ? why.join(', ') : 'estilo gaming' };
}
