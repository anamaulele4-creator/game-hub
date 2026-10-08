// Som das publicações: ganho automático (sem recodificar o vídeo) + música com licença livre.
// Guardado em clips.media (jsonb). Se a coluna ainda não existir (migração por correr),
// vai codificado numa etiqueta escondida "~m:<base64url>" dentro de clips.tags.

export interface MusicRef {
  id: string;
  url: string;          // ficheiro de áudio (pré-visualização mp3 do fornecedor)
  title: string;
  artist: string;
  license: string;      // ex.: "CC BY 4.0", "CC0"
  licenseUrl?: string;
  attribution: string;  // texto de atribuição completo (obrigatório em CC BY)
  source: string;       // ex.: "jamendo", "freesound" (via Openverse)
  landing?: string;     // página original da faixa
  start: number;        // segundos: início do trecho escolhido
  vol: number;          // 0..1 volume da música
  dur?: number;         // duração da faixa (s)
}

export interface ClipMedia {
  v: 1;
  /** ganho linear aplicado ao som original no leitor (1 = sem mudança, máx. ~7.9 = +18 dB) */
  gain?: number;
  /** volume do som original 0..1 (mistura com música) */
  orig?: number;
  /** resultado da análise: none | low | good */
  sound?: 'none' | 'low' | 'good';
  music?: MusicRef;
}

export const MAX_GAIN = Math.pow(10, 18 / 20); // +18 dB

const TAG_PREFIX = '~m:';

function b64urlEncode(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Limpa e limita o objeto antes de guardar (nunca confiar no que vem do cliente/BD). */
export function sanitizeMedia(m: unknown): ClipMedia | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const o = m as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : undefined);
  const str = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
  const out: ClipMedia = { v: 1 };
  const g = num(o.gain, 1, MAX_GAIN); if (g && g > 1.01) out.gain = Math.round(g * 100) / 100;
  const ov = num(o.orig, 0, 1); if (ov != null && ov < 0.99) out.orig = Math.round(ov * 100) / 100;
  if (o.sound === 'none' || o.sound === 'low' || o.sound === 'good') out.sound = o.sound;
  const mu = o.music as Record<string, unknown> | undefined;
  if (mu && typeof mu === 'object' && typeof mu.url === 'string' && /^https:\/\//.test(mu.url)) {
    out.music = {
      id: str(mu.id, 80), url: str(mu.url, 400), title: str(mu.title, 120) || 'Música', artist: str(mu.artist, 80) || 'Desconhecido',
      license: str(mu.license, 40), licenseUrl: /^https:\/\//.test(String(mu.licenseUrl ?? '')) ? str(mu.licenseUrl, 200) : undefined,
      attribution: str(mu.attribution, 400), source: str(mu.source, 40), landing: /^https?:\/\//.test(String(mu.landing ?? '')) ? str(mu.landing, 300) : undefined,
      start: num(mu.start, 0, 3600) ?? 0, vol: num(mu.vol, 0, 1) ?? 0.8, dur: num(mu.dur, 0, 7200),
    };
  }
  return out.gain || out.orig != null || out.music || out.sound ? out : undefined;
}

export function mediaToTag(m: ClipMedia): string { return TAG_PREFIX + b64urlEncode(JSON.stringify(m)); }

/** Separa etiquetas visíveis da etiqueta escondida com o som. */
export function splitTags(tags: string[] | null | undefined): { tags: string[]; media?: ClipMedia } {
  const vis: string[] = [];
  let media: ClipMedia | undefined;
  for (const t of tags ?? []) {
    if (typeof t !== 'string') continue;
    if (t.startsWith(TAG_PREFIX)) { try { media = sanitizeMedia(JSON.parse(b64urlDecode(t.slice(TAG_PREFIX.length)))); } catch {} continue; }
    if (t.startsWith('~')) continue;
    vis.push(t);
  }
  return { tags: vis, media };
}

export const fmtDur = (s?: number) => (s == null || !isFinite(s) ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

// ---------- Ganho no leitor (Web Audio), só depois de um toque do utilizador ----------
let ctx: AudioContext | null = null;
const wired = new WeakMap<HTMLMediaElement, GainNode>();

/** Cria/retoma o AudioContext. Chamar dentro de um toque (gesto do utilizador). */
export function unlockAudio() {
  try {
    if (typeof window === 'undefined') return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {}
}
let wantCtx = false;
if (typeof window !== 'undefined') {
  // Só cria o AudioContext quando há um vídeo a precisar de ganho (poupa bateria em telemóveis baratos);
  // em cada toque retoma-o se o sistema o suspendeu.
  const onGesture = () => { if (wantCtx || ctx) unlockAudio(); };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}

/**
 * Aplica volume ao som original. ≤1 → element.volume (sempre funciona).
 * >1 → GainNode + limitador, só se o AudioContext já estiver a correr (senão fica a 1, nunca em silêncio).
 */
export function applyVolume(el: HTMLMediaElement | null, level: number) {
  if (!el) return;
  const lv = Math.max(0, Math.min(MAX_GAIN, level));
  const g = wired.get(el);
  if (g) { g.gain.value = lv; el.volume = 1; return; }
  if (lv <= 1.01) { el.volume = lv; return; }
  el.volume = 1;
  wantCtx = true;
  if (!ctx || ctx.state !== 'running') return;
  // Vídeos de outro domínio sem CORS ficariam mudos via Web Audio: só liga se crossOrigin estiver definido ou for blob:
  const src = el.currentSrc || el.src;
  if (!/^(blob|data):/.test(src) && el.crossOrigin !== 'anonymous' && !src.startsWith(location.origin)) return;
  try {
    const node = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.1;
    gain.gain.value = lv;
    node.connect(gain).connect(lim).connect(ctx.destination);
    wired.set(el, gain);
  } catch {}
}
