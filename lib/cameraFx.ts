// Câmara POIPAK — filtros e stickers animados, desenhados 100% em Canvas 2D.
// Tudo o que se vê no canvas entra na foto, na gravação e na live (o canvas é a fonte).
//
// Regras de desempenho (Android de gama baixa, ex.: Galaxy A05):
//  - NUNCA usar ctx.filter (em muitos Android corre por software e cai para 5–10 fps; no Safari antigo nem existe).
//  - Sem leitura de píxeis (getImageData) e sem shadowBlur por frame.
//  - Só drawImage + gradientes + formas simples; partículas calculadas a partir do tempo (sem estado, sem alocação).
//  - Gradientes/padrões em cache por tamanho do canvas.

export type FilterId = 'normal' | 'respawn' | 'levelup' | 'pixel' | 'neon' | 'boss' | 'vitoria' | 'hud' | 'moldura' | 'retro';
export type StickerId = 'crown' | 'kill' | 'gg' | 'mvp';

export interface CamFilter { id: FilterId; label: string; icon: string; desc: string }
export interface CamSticker { id: StickerId; label: string; icon: string }
/** Posição de um sticker (fração da largura/altura do canvas, 0–1). */
export interface StickerPos { x: number; y: number }

export const FILTERS: CamFilter[] = [
  { id: 'normal', label: 'Normal', icon: '○', desc: 'Imagem limpa, sem efeitos' },
  { id: 'respawn', label: 'Respawn', icon: '⟳', desc: 'Linha de scan e glitch de reaparecimento' },
  { id: 'levelup', label: 'Level Up', icon: '⬆', desc: 'Partículas douradas e “LEVEL UP”' },
  { id: 'pixel', label: 'Pixel Arena', icon: '▦', desc: 'Pixelização a pulsar e linhas CRT' },
  { id: 'neon', label: 'Neon Suave', icon: '✦', desc: 'Luz azul suave a passar, cores calmas' },
  { id: 'boss', label: 'Boss Fight', icon: '♥', desc: 'Batimento vermelho e barra de vida' },
  { id: 'vitoria', label: 'Vitória', icon: '🏆', desc: 'Confetti, coroa e “VITÓRIA”' },
  { id: 'hud', label: 'HUD POIPAK', icon: '◎', desc: 'Radar, munição e mira a respirar' },
  { id: 'moldura', label: 'Moldura POIPAK', icon: '▢', desc: 'Moldura animada com o logo POIPAK' },
  { id: 'retro', label: 'Retro 8-bit', icon: '👾', desc: 'Visual de consola antiga com estrelas pixel' },
];

export const STICKERS: CamSticker[] = [
  { id: 'crown', label: 'Coroa', icon: '👑' },
  { id: 'kill', label: 'Kill streak', icon: '🔥' },
  { id: 'gg', label: 'GG', icon: 'GG' },
  { id: 'mvp', label: 'MVP', icon: '⭐' },
];

export const DEFAULT_STICKER_POS: Record<StickerId, StickerPos> = {
  crown: { x: 0.5, y: 0.2 }, kill: { x: 0.5, y: 0.6 }, gg: { x: 0.22, y: 0.44 }, mvp: { x: 0.76, y: 0.44 },
};

export interface DrawOpts {
  /** Tempo em ms (performance.now()). */
  t: number;
  mirror: boolean;
  stickers: StickerId[];
  pos: Record<StickerId, StickerPos>;
  /** prefers-reduced-motion: animações mais lentas, sem flashes nem glitch. */
  reduced?: boolean;
  killText?: string;
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const EMOJI = "'Noto Color Emoji','Apple Color Emoji','Segoe UI Emoji',sans-serif";
const BLUE = '#5b9bd5';
const GOLD = '#ffcf4d';

// ---------- utilidades ----------
const fract = (x: number) => x - Math.floor(x);
/** pseudo-aleatório determinístico 0–1 */
const rnd = (i: number) => fract(Math.sin(i * 127.1 + 311.7) * 43758.5453);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);

let logo: HTMLImageElement | null = null;
function getLogo() {
  if (logo || typeof window === 'undefined') return logo;
  logo = new Image();
  logo.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/icons/icon-192.png`;
  return logo;
}

// Canvas pequeno para pixelização (reutilizado; nunca muda de tamanho por frame)
let pix: HTMLCanvasElement | null = null;
let pixCtx: CanvasRenderingContext2D | null = null;
function pixCanvas(w: number, h: number) {
  if (!pix) { pix = document.createElement('canvas'); pixCtx = pix.getContext('2d'); }
  if (pix.width !== w) pix.width = w;
  if (pix.height !== h) pix.height = h;
  return pixCtx;
}

// Cache de gradientes/padrões por tamanho
let cacheKey = '';
const cache: Record<string, CanvasGradient | CanvasPattern | null> = {};
function cached<T extends CanvasGradient | CanvasPattern | null>(ctx: CanvasRenderingContext2D, W: number, H: number, name: string, make: () => T): T {
  const k = `${W}x${H}`;
  if (k !== cacheKey) { cacheKey = k; for (const n of Object.keys(cache)) delete cache[n]; }
  if (!(name in cache)) cache[name] = make();
  return cache[name] as T;
}

function vignetteGrad(ctx: CanvasRenderingContext2D, W: number, H: number, color: string, inner = 0.35) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * inner, W / 2, H / 2, Math.hypot(W, H) / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, color);
  return g;
}

function fill(ctx: CanvasRenderingContext2D, W: number, H: number, style: string | CanvasGradient | CanvasPattern, alpha = 1, op: GlobalCompositeOperation = 'source-over') {
  ctx.globalCompositeOperation = op; ctx.globalAlpha = alpha; ctx.fillStyle = style; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

// Camadas estáticas pré-desenhadas: tinta + vinheta + scanlines num só canvas → 1 passagem por frame
// (em vez de 3–4 passagens de ecrã inteiro com modos de mistura, que são lentas sem GPU).
const layers = new Map<string, HTMLCanvasElement>();
function layer(W: number, H: number, name: string, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  const k = `${name}:${W}x${H}`;
  let cv = layers.get(k);
  if (!cv) {
    cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    if (!c) return null;
    try { paint(c); } catch {}
    layers.set(k, cv);
    // guarda só as 2 últimas (memória em telemóveis de 2–3 GB)
    while (layers.size > 2) { const first = layers.keys().next().value as string; layers.delete(first); }
  }
  return cv;
}
function drawLayer(ctx: CanvasRenderingContext2D, W: number, H: number, name: string, paint: (c: CanvasRenderingContext2D) => void, alpha = 1) {
  const l = layer(W, H, name, paint);
  if (!l) return;
  ctx.globalAlpha = alpha; ctx.drawImage(l, 0, 0); ctx.globalAlpha = 1;
}
const solid = (c: CanvasRenderingContext2D, W: number, H: number, color: string, a: number) => { c.globalAlpha = a; c.fillStyle = color; c.fillRect(0, 0, W, H); c.globalAlpha = 1; };
const vig = (c: CanvasRenderingContext2D, W: number, H: number, color: string, inner: number, a: number) => { c.globalAlpha = a; c.fillStyle = vignetteGrad(c, W, H, color, inner); c.fillRect(0, 0, W, H); c.globalAlpha = 1; };
const scans = (c: CanvasRenderingContext2D, W: number, H: number, a: number, step: number) => { c.fillStyle = `rgba(0,0,0,${a})`; for (let y = 0; y < H; y += step) c.fillRect(0, y, W, Math.max(1, step >> 1)); };

/** Texto com contorno (sem shadowBlur = rápido). */
function bigText(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, size: number, color: string, stroke = 'rgba(0,0,0,.85)', weight = 900) {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size / 7); ctx.strokeStyle = stroke; ctx.strokeText(txt, x, y);
  ctx.fillStyle = color; ctx.fillText(txt, x, y);
}

/** Desenha a fonte em "cover" (recorta sem deformar), espelhada se for a câmara frontal. */
function drawCover(c: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, mirror: boolean) {
  const sc = Math.max(W / sw, H / sh);
  const dw = sw * sc, dh = sh * sc;
  c.save();
  if (mirror) { c.translate(W, 0); c.scale(-1, 1); }
  c.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  c.restore();
}

/** Pixeliza: desenha pequeno (block px) e amplia sem suavização. */
function drawPixelated(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, mirror: boolean, block: number) {
  const pw = Math.max(8, Math.round(W / block)), ph = Math.max(8, Math.round(H / block));
  const p = pixCanvas(Math.ceil(W / 4), Math.ceil(H / 4)); // tamanho fixo (bloco mínimo 4 px)
  if (!p) { drawCover(ctx, src, sw, sh, W, H, mirror); return; }
  p.imageSmoothingEnabled = true;
  drawCover(p, src, sw, sh, pw, ph, mirror); // desenha no canto (0,0,pw,ph)
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pix!, 0, 0, pw, ph, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
}

// ---------- efeitos ----------
function fxRespawn(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, reduced: boolean) {
  drawLayer(ctx, W, H, 'respawn', (c) => { solid(c, W, H, '#1c3d5e', 0.14); scans(c, W, H, 0.16, 4); vig(c, W, H, 'rgba(0,10,25,1)', 0.4, 0.45); });
  // Linha de scan a descer
  const y = fract(s / 2.6) * H * 1.2 - H * 0.1;
  const band = cached(ctx, W, H, 'respawnBand', () => { const g = ctx.createLinearGradient(0, -H * 0.08, 0, H * 0.08); g.addColorStop(0, 'rgba(91,155,213,0)'); g.addColorStop(0.5, 'rgba(160,210,255,0.55)'); g.addColorStop(1, 'rgba(91,155,213,0)'); return g; });
  ctx.save(); ctx.translate(0, y); ctx.fillStyle = band; ctx.fillRect(0, -H * 0.08, W, H * 0.16); ctx.restore();
  // Glitch por intervalos (≈0,35 s a cada 3 s)
  const ph = fract(s / 3);
  if (!reduced && ph > 0.88) {
    const k = Math.floor(s * 20);
    for (let i = 0; i < 5; i++) {
      const sy = Math.floor(rnd(k + i * 7) * H), sh = Math.floor(H * (0.02 + rnd(k + i) * 0.06));
      const off = (rnd(k * 3 + i) - 0.5) * W * 0.12;
      ctx.drawImage(ctx.canvas, 0, sy, W, sh, off, sy, W, sh);
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.35;
      ctx.fillStyle = i % 2 ? '#00e0ff' : '#ff3e8a'; ctx.fillRect(0, sy, W, sh);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    bigText(ctx, 'RESPAWN', W / 2, H * 0.5, Math.min(W, H) * 0.11, '#dff0ff');
  }
  const u = Math.min(W, H);
  ctx.globalAlpha = 0.85; bigText(ctx, '● REC  RESPAWN', W * 0.5, H * 0.06, u * 0.04, '#cfe6ff', 'rgba(0,0,0,.6)', 700); ctx.globalAlpha = 1;
}

function fxLevelUp(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, reduced: boolean) {
  drawLayer(ctx, W, H, 'levelup', (c) => { solid(c, W, H, '#ffb627', 0.08); vig(c, W, H, 'rgba(70,40,0,1)', 0.4, 0.4); });
  const u = Math.min(W, H);
  // Partículas a subir
  ctx.fillStyle = GOLD;
  const n = reduced ? 14 : 28;
  for (let i = 0; i < n; i++) {
    const sp = 0.12 + rnd(i) * 0.18;
    const y = H * (1.05 - fract(s * sp + rnd(i + 50)) * 1.15);
    const x = W * rnd(i + 99) + Math.sin(s * 2 + i) * u * 0.015;
    const r = u * (0.004 + rnd(i + 7) * 0.008);
    ctx.globalAlpha = 0.5 + 0.5 * rnd(i + 3);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  // Pop "LEVEL UP" a cada 4 s
  const ph = fract(s / 4);
  if (ph < 0.45) {
    const p = ph / 0.45;
    if (!reduced && p < 0.15) fill(ctx, W, H, '#ffe9a8', (0.15 - p) * 2.4);
    const sc = reduced ? 1 : 0.6 + ease(p * 2.5) * 0.4 + Math.sin(p * Math.PI) * 0.08;
    ctx.globalAlpha = p > 0.8 ? (1 - p) * 5 : 1;
    bigText(ctx, 'LEVEL UP', W / 2, H * 0.32, u * 0.14 * sc, GOLD, '#3a2400');
    bigText(ctx, '+250 XP', W / 2, H * 0.32 + u * 0.12 * sc, u * 0.05 * sc, '#fff6d8', '#3a2400', 800);
    ctx.globalAlpha = 1;
  }
  // Barra de XP
  const bw = W * 0.6, bx = (W - bw) / 2, by = H * 0.9, bh = u * 0.022;
  ctx.fillStyle = 'rgba(18,20,23,.7)'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = GOLD; ctx.fillRect(bx, by, bw * (0.15 + 0.85 * fract(s / 4)), bh);
}

function fxPixel(ctx: CanvasRenderingContext2D, W: number, H: number, s: number) {
  drawLayer(ctx, W, H, 'pixel', (c) => { solid(c, W, H, '#3d7bff', 0.1); scans(c, W, H, 0.26, 4); vig(c, W, H, 'rgba(0,0,0,1)', 0.35, 0.55); });
  const u = Math.min(W, H);
  ctx.globalAlpha = 0.9; bigText(ctx, 'PIXEL ARENA', W / 2, H * 0.06, u * 0.05, '#bfe0ff', 'rgba(0,0,0,.8)', 800);
  ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(s * 3)); bigText(ctx, 'INSERT COIN', W / 2, H * 0.92, u * 0.04, '#ffffff', 'rgba(0,0,0,.8)', 800); ctx.globalAlpha = 1;
}

function fxNeon(ctx: CanvasRenderingContext2D, W: number, H: number, s: number) {
  // Faixa de luz diagonal suave a varrer
  const span = W + H;
  const x = fract(s / 6) * span * 1.4 - span * 0.2;
  const g = cached(ctx, W, H, 'neonBand', () => { const gr = ctx.createLinearGradient(-W * 0.35, 0, W * 0.35, 0); gr.addColorStop(0, 'rgba(91,155,213,0)'); gr.addColorStop(0.5, 'rgba(150,200,255,0.32)'); gr.addColorStop(1, 'rgba(91,155,213,0)'); return gr; });
  const a = 0.25 + 0.15 * Math.sin(s * 1.2);
  drawLayer(ctx, W, H, 'neon', (c) => { solid(c, W, H, '#5b9bd5', 0.1); vig(c, W, H, 'rgba(20,40,70,1)', 0.4, 1); }, 0.6 + a * 0.4);
  ctx.save(); ctx.translate(x - H * 0.5, 0); ctx.transform(1, 0, 0.5, 1, 0, 0); ctx.fillStyle = g; ctx.fillRect(-W * 0.35, 0, W * 0.7, H); ctx.restore();
}

function fxBoss(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, reduced: boolean) {
  // Batimento: dois picos por ciclo de ~1,1 s
  const ph = fract(s / 1.1);
  const beat = reduced ? 0.4 + 0.1 * Math.sin(s) : Math.max(Math.exp(-Math.pow((ph - 0.05) * 18, 2)), 0.7 * Math.exp(-Math.pow((ph - 0.25) * 18, 2)));
  drawLayer(ctx, W, H, 'boss', (c) => { solid(c, W, H, '#5a0000', 0.1); vig(c, W, H, 'rgba(170,0,0,1)', 0.28, 1); }, 0.5 + beat * 0.45);
  const u = Math.min(W, H);
  // HUD do boss
  const bw = W * 0.7, bx = (W - bw) / 2, by = H * 0.075, bh = u * 0.03;
  const hp = 0.25 + 0.6 * (1 - fract(s / 12));
  bigText(ctx, '☠ BOSS FINAL', W / 2, by - u * 0.03, u * 0.045, '#ffd7d7', 'rgba(0,0,0,.85)', 800);
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
  ctx.fillStyle = '#5a0b0b'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = beat > 0.6 ? '#ff6b6b' : '#e23b3b'; ctx.fillRect(bx, by, bw * hp, bh);
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(bx, by, bw * hp, bh * 0.35);
  // Coração do jogador
  ctx.font = `900 ${Math.round(u * (0.06 + beat * 0.015))}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ff4d4d';
  ctx.fillText('♥', u * 0.05, H * 0.93);
  ctx.font = `800 ${Math.round(u * 0.04)}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText(`${Math.round(30 + 70 * hp)} / 100`, u * 0.14, H * 0.93);
}

function fxVitoria(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, reduced: boolean) {
  drawLayer(ctx, W, H, 'vitoria', (c) => { solid(c, W, H, '#ffb627', 0.1); vig(c, W, H, 'rgba(80,45,0,1)', 0.38, 0.5); });
  const u = Math.min(W, H);
  const cols = ['#ffcf4d', '#5b9bd5', '#ffffff', '#ff7aa2', '#7ee0b0'];
  const n = reduced ? 18 : 42;
  for (let i = 0; i < n; i++) {
    const sp = 0.1 + rnd(i) * 0.12;
    const y = H * (fract(s * sp + rnd(i + 20)) * 1.15 - 0.08);
    const x = W * rnd(i + 40) + Math.sin(s * 1.5 + i) * u * 0.03;
    const w = u * 0.016, h = u * 0.008;
    const a = s * (1 + rnd(i + 9) * 2) + i;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(1, Math.cos(a * 1.7));
    ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  }
  const bob = reduced ? 0 : Math.sin(s * 2.4) * u * 0.012;
  ctx.font = `${Math.round(u * 0.13)}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('👑', W / 2, H * 0.12 + bob);
  bigText(ctx, 'VITÓRIA', W / 2, H * 0.21 + bob, u * 0.12, GOLD, '#3a2400');
  ctx.globalAlpha = 0.9; bigText(ctx, '#1 POIPAK', W / 2, H * 0.21 + u * 0.1 + bob, u * 0.045, '#fff', 'rgba(0,0,0,.8)', 800); ctx.globalAlpha = 1;
}

function fxHud(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, reduced: boolean) {
  drawLayer(ctx, W, H, 'hud', (c) => { solid(c, W, H, '#2b8cff', 0.06); vig(c, W, H, 'rgba(5,20,40,1)', 0.45, 0.4); });
  const u = Math.min(W, H), m = u * 0.05, L = u * 0.1;
  ctx.strokeStyle = 'rgba(150,205,255,0.9)'; ctx.lineWidth = Math.max(2, u / 200);
  ctx.beginPath();
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
    ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y);
  }
  ctx.stroke();
  // Radar / minimapa (canto superior esquerdo)
  const R = u * 0.12, cx = m + R + u * 0.02, cy = m + R + u * 0.04;
  ctx.fillStyle = 'rgba(10,30,50,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(150,205,255,0.7)'; ctx.lineWidth = Math.max(1, u / 400);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.moveTo(cx + R * 0.5, cy); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  const ang = (reduced ? s * 0.6 : s * 2.2) % (Math.PI * 2);
  ctx.fillStyle = 'rgba(120,200,255,0.35)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, ang - 0.6, ang); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 3; i++) {
    const a = rnd(i + 5) * Math.PI * 2, d = R * (0.3 + rnd(i + 11) * 0.6);
    const age = ((ang - a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    ctx.globalAlpha = clamp(1 - age / 3, 0.15, 1);
    ctx.fillStyle = i === 0 ? '#ff6b6b' : '#ffcf4d';
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, u * 0.009, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Munição (canto inferior direito): conta para baixo e recarrega
  const ammo = 30 - (Math.floor(s * 2.5) % 31);
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.font = `800 ${Math.round(u * 0.09)}px ${FONT}`; ctx.fillStyle = ammo < 6 ? '#ff8080' : '#e8f4ff';
  ctx.fillText(String(ammo).padStart(2, '0'), W - m - u * 0.02, H - m - u * 0.05);
  ctx.font = `700 ${Math.round(u * 0.035)}px ${FONT}`; ctx.fillStyle = 'rgba(200,225,255,.85)';
  ctx.fillText(ammo < 6 ? 'RECARREGA' : '/ 120  MUNIÇÃO', W - m - u * 0.02, H - m - u * 0.01);
  // Mira a respirar
  const br = 1 + (reduced ? 0.03 : 0.12) * Math.sin(s * 2.2);
  const c = u * 0.035 * br;
  ctx.strokeStyle = 'rgba(200,235,255,0.85)'; ctx.lineWidth = Math.max(2, u / 300);
  ctx.beginPath(); ctx.arc(W / 2, H / 2, c, 0, Math.PI * 2);
  ctx.moveTo(W / 2 - c * 1.8, H / 2); ctx.lineTo(W / 2 - c * 0.6, H / 2); ctx.moveTo(W / 2 + c * 0.6, H / 2); ctx.lineTo(W / 2 + c * 1.8, H / 2);
  ctx.moveTo(W / 2, H / 2 - c * 1.8); ctx.lineTo(W / 2, H / 2 - c * 0.6); ctx.moveTo(W / 2, H / 2 + c * 0.6); ctx.lineTo(W / 2, H / 2 + c * 1.8);
  ctx.stroke();
  ctx.fillStyle = '#ff6b6b'; ctx.fillRect(W / 2 - 2, H / 2 - 2, 4, 4);
  watermark(ctx, W, H, 0.7);
}

function watermark(ctx: CanvasRenderingContext2D, W: number, H: number, alpha = 0.85, y0?: number) {
  const s = Math.round(Math.min(W, H) * 0.07);
  const x = W - s * 3.6, y = y0 ?? (H - s * 1.6);
  ctx.globalAlpha = alpha;
  const l = getLogo();
  if (l && l.complete && l.naturalWidth) ctx.drawImage(l, x, y, s, s);
  ctx.font = `800 ${Math.round(s * 0.5)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, s / 12); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText('POIPAK', x + s * 1.15, y + s / 2);
  ctx.fillStyle = '#fff'; ctx.fillText('POIPAK', x + s * 1.15, y + s / 2);
  ctx.globalAlpha = 1;
}

function fxMoldura(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, reduced: boolean) {
  const u = Math.min(W, H), b = Math.round(u * 0.04);
  ctx.fillStyle = '#121417';
  ctx.fillRect(0, 0, W, b); ctx.fillRect(0, H - b, W, b); ctx.fillRect(0, 0, b, H); ctx.fillRect(W - b, 0, b, H);
  // Luz a percorrer a moldura
  const per = 2 * (W + H - 4 * b), p = fract(s / (reduced ? 10 : 4)) * per, len = per * 0.18;
  ctx.lineWidth = Math.max(3, b / 3); ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(91,155,213,0.45)'; ctx.strokeRect(b, b, W - 2 * b, H - 2 * b);
  ctx.strokeStyle = '#9fd0ff';
  ctx.setLineDash([len, per - len]); ctx.lineDashOffset = -p;
  ctx.strokeRect(b, b, W - 2 * b, H - 2 * b);
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  // Cantos
  ctx.fillStyle = BLUE; const k = b * 1.6;
  for (const [x, y] of [[b, b], [W - b, b], [b, H - b], [W - b, H - b]]) ctx.fillRect(x - k / 2, y - k / 2, k, k);
  // Logo com leve pulsação
  const sc = 1 + (reduced ? 0 : 0.04 * Math.sin(s * 2));
  const L = u * 0.12 * sc, lx = W / 2 - u * 0.22, ly = H - b - L * 1.35;
  ctx.fillStyle = 'rgba(18,20,23,0.8)'; ctx.fillRect(W / 2 - u * 0.24, ly - u * 0.01, u * 0.48, L + u * 0.02);
  const l = getLogo();
  if (l && l.complete && l.naturalWidth) ctx.drawImage(l, lx, ly, L, L);
  ctx.font = `900 ${Math.round(u * 0.06)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  ctx.fillText('POIPAK', lx + L + u * 0.03, ly + L / 2);
}

function fxRetro(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, reduced: boolean) {
  // "Paleta" de consola: contraste forte + tons quentes/roxos por blend (sem ler píxeis)
  drawLayer(ctx, W, H, 'retro', (c) => {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ff4fa3'); g.addColorStop(0.5, '#5b3cff'); g.addColorStop(1, '#ffb627');
    c.globalAlpha = 0.2; c.fillStyle = g; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
    scans(c, W, H, 0.22, 6); vig(c, W, H, 'rgba(20,0,40,1)', 0.4, 0.5);
  });
  // Estrelas pixel a piscar
  const u = Math.min(W, H), p = Math.max(3, Math.round(u / 120));
  for (let i = 0; i < 22; i++) {
    const tw = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(s * (2 + rnd(i) * 3) + i);
    if (tw < 0.25) continue;
    const x = Math.round(W * rnd(i + 70) / p) * p, y = Math.round(H * rnd(i + 90) * 0.35 / p) * p;
    ctx.globalAlpha = tw; ctx.fillStyle = i % 3 ? '#ffffff' : '#ffe066';
    ctx.fillRect(x, y, p, p); ctx.fillRect(x - p, y, p, p); ctx.fillRect(x + p, y, p, p); ctx.fillRect(x, y - p, p, p); ctx.fillRect(x, y + p, p, p);
  }
  ctx.globalAlpha = 1;
  ctx.font = `900 ${Math.round(u * 0.05)}px ui-monospace, monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffe066'; ctx.fillText(`1UP ${String(Math.floor(s * 37) % 100000).padStart(5, '0')}`, u * 0.05, H * 0.03);
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText('♥♥♥', W - u * 0.05, H * 0.03);
}

// ---------- stickers ----------
function stickerSize(id: StickerId, u: number) {
  return id === 'crown' ? u * 0.22 : id === 'kill' ? u * 0.07 : id === 'gg' ? u * 0.16 : u * 0.12;
}

function drawSticker(ctx: CanvasRenderingContext2D, id: StickerId, p: StickerPos, W: number, H: number, s: number, reduced: boolean, killText: string) {
  const u = Math.min(W, H), x = p.x * W, y = p.y * H, sz = stickerSize(id, u);
  const m = reduced ? 0.25 : 1;
  ctx.save(); ctx.translate(x, y);
  if (id === 'crown') {
    ctx.translate(0, Math.sin(s * 3) * u * 0.012 * m); ctx.rotate(Math.sin(s * 1.6) * 0.08 * m);
    ctx.font = `${Math.round(sz)}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('👑', 0, 0);
  } else if (id === 'kill') {
    const sc = 1 + 0.06 * m * Math.max(0, Math.sin(s * 5)); ctx.scale(sc, sc);
    ctx.font = `900 ${Math.round(sz)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(killText).width + sz;
    ctx.fillStyle = 'rgba(18,20,23,0.8)'; ctx.fillRect(-tw / 2, -sz * 0.8, tw, sz * 1.6);
    ctx.fillStyle = '#ff7a3d'; ctx.fillRect(-tw / 2, sz * 0.62, tw * (0.5 + 0.5 * fract(s / 2)), sz * 0.18);
    bigText(ctx, killText, 0, 0, sz, GOLD, '#000');
  } else if (id === 'gg') {
    ctx.rotate(-0.12 + Math.sin(s * 2.5) * 0.1 * m);
    const sc = 1 + 0.05 * m * Math.sin(s * 4); ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(18,20,23,0.8)'; ctx.beginPath(); ctx.arc(0, 0, sz * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = BLUE; ctx.lineWidth = sz * 0.07; ctx.stroke();
    bigText(ctx, 'GG', 0, sz * 0.03, sz * 0.8, '#ffffff', BLUE);
  } else {
    // MVP com brilho a passar
    const w = sz * 2.3, h = sz * 0.95;
    ctx.fillStyle = '#121417'; ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = GOLD; ctx.fillRect(-w / 2, -h / 2, w, h * 0.1); ctx.fillRect(-w / 2, h / 2 - h * 0.1, w, h * 0.1);
    bigText(ctx, '★ MVP', 0, 0, sz * 0.62, GOLD, '#000');
    const sx = (fract(s / (reduced ? 6 : 2.2)) * 1.6 - 0.8) * w;
    ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(sx - h * 0.3, -h / 2); ctx.lineTo(sx + h * 0.1, -h / 2); ctx.lineTo(sx - h * 0.1, h / 2); ctx.lineTo(sx - h * 0.5, h / 2); ctx.fill();
  }
  ctx.restore();
}

/** O ponto (fração do canvas) toca no sticker? Devolve o sticker de cima. */
export function hitSticker(active: StickerId[], pos: Record<StickerId, StickerPos>, x: number, y: number, W: number, H: number): StickerId | null {
  const u = Math.min(W, H);
  for (let i = active.length - 1; i >= 0; i--) {
    const id = active[i], p = pos[id], sz = stickerSize(id, u);
    const hw = (id === 'kill' ? sz * 6 : id === 'mvp' ? sz * 1.3 : sz * 0.7) / W;
    const hh = (id === 'kill' ? sz * 1.1 : sz * 0.75) / H;
    if (Math.abs(p.x - x) < hw + 0.03 && Math.abs(p.y - y) < hh + 0.03) return id;
  }
  return null;
}

/** Desenha um frame com o filtro e os stickers ativos. Nunca lança erro. */
export function drawFrame(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, f: CamFilter, o: DrawOpts) {
  const reduced = !!o.reduced;
  const s = (o.t / 1000) * (reduced ? 0.5 : 1);
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // 1) Imagem base
    if (f.id === 'pixel') {
      const block = reduced ? 8 : 6 + Math.round(5 * (0.5 + 0.5 * Math.sin(s * 2.4)));
      drawPixelated(ctx, src, sw, sh, W, H, o.mirror, block);
    } else if (f.id === 'retro') {
      drawPixelated(ctx, src, sw, sh, W, H, o.mirror, 5);
    } else {
      drawCover(ctx, src, sw, sh, W, H, o.mirror);
    }
    // 2) Efeito animado
    switch (f.id) {
      case 'respawn': fxRespawn(ctx, W, H, s, reduced); break;
      case 'levelup': fxLevelUp(ctx, W, H, s, reduced); break;
      case 'pixel': fxPixel(ctx, W, H, s); break;
      case 'neon': fxNeon(ctx, W, H, s); break;
      case 'boss': fxBoss(ctx, W, H, s, reduced); break;
      case 'vitoria': fxVitoria(ctx, W, H, s, reduced); break;
      case 'hud': fxHud(ctx, W, H, s, reduced); break;
      case 'moldura': fxMoldura(ctx, W, H, s, reduced); break;
      case 'retro': fxRetro(ctx, W, H, s, reduced); break;
    }
  } catch { /* nunca parar a câmara por causa de um frame */ }
  // 3) Stickers (por cima de tudo)
  for (const id of o.stickers) {
    try { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; drawSticker(ctx, id, o.pos[id], W, H, s, reduced, o.killText ?? '🔥 KILL STREAK x5'); } catch {}
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
