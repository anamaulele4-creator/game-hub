// Câmara POIPAK: filtros de jogo desenhados num canvas 2D (leves para Android de gama baixa).
// Também guarda a captura feita na câmara para a página /publicar a abrir já carregada.

export type FilterId = 'normal' | 'arena' | 'retro' | 'noite' | 'vitoria' | 'pb' | 'hud' | 'moldura' | 'coroa' | 'killstreak';
export interface CamFilter { id: FilterId; label: string; icon: string; css?: string; sticker?: 'crown' | 'kill' }
export const FILTERS: CamFilter[] = [
  { id: 'normal', label: 'Normal', icon: '○' },
  { id: 'arena', label: 'Arena', icon: '⚡', css: 'contrast(1.35) saturate(1.15) brightness(1.02)' },
  { id: 'retro', label: 'Retro Arcade', icon: '👾', css: 'saturate(1.4) contrast(1.15)' },
  { id: 'noite', label: 'Noite', icon: '🌙', css: 'brightness(0.78) contrast(1.1) saturate(0.85)' },
  { id: 'vitoria', label: 'Vitória', icon: '🏆', css: 'saturate(1.2) brightness(1.05) sepia(0.25)' },
  { id: 'pb', label: 'P&B', icon: '◐', css: 'grayscale(1) contrast(1.1)' },
  { id: 'hud', label: 'HUD Gamer', icon: '🎯', css: 'contrast(1.12)' },
  { id: 'moldura', label: 'Moldura POIPAK', icon: '🖼️' },
  { id: 'coroa', label: 'Coroa', icon: '👑', sticker: 'crown' },
  { id: 'killstreak', label: 'Kill streak', icon: '🔥', sticker: 'kill' },
];

/** Posição de um sticker (fração da largura/altura do canvas, 0–1). */
export interface StickerPos { x: number; y: number }

let ctxFilterOk: boolean | null = null;
function supportsCtxFilter(ctx: CanvasRenderingContext2D) {
  if (ctxFilterOk === null) {
    try { const prev = ctx.filter; ctx.filter = 'blur(1px)'; ctxFilterOk = ctx.filter === 'blur(1px)'; ctx.filter = prev || 'none'; } catch { ctxFilterOk = false; }
  }
  return ctxFilterOk;
}

let pix: HTMLCanvasElement | null = null;
let scan: CanvasPattern | null = null;
let logo: HTMLImageElement | null = null;
function getLogo() {
  if (logo || typeof window === 'undefined') return logo;
  logo = new Image();
  logo.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/icons/icon-192.png`;
  return logo;
}

function watermark(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const s = Math.round(Math.min(W, H) * 0.075);
  const x = W - s * 3.4, y = H - s * 1.6;
  ctx.save();
  ctx.globalAlpha = 0.85;
  const l = getLogo();
  if (l && l.complete && l.naturalWidth) ctx.drawImage(l, x, y, s, s);
  ctx.font = `800 ${Math.round(s * 0.5)}px system-ui, sans-serif`;
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
  ctx.fillText('POIPAK', x + s * 1.15, y + s / 2);
  ctx.restore();
}

function vignette(ctx: CanvasRenderingContext2D, W: number, H: number, color: string, strength: number) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, color);
  ctx.save(); ctx.globalAlpha = strength; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
}

function tint(ctx: CanvasRenderingContext2D, W: number, H: number, color: string, alpha: number, op: GlobalCompositeOperation = 'soft-light') {
  ctx.save(); ctx.globalCompositeOperation = op; ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); ctx.restore();
}

/** Desenha um frame com o filtro ativo. Nunca lança erro. */
export function drawFrame(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, f: CamFilter, mirror: boolean, stickers: Record<'crown' | 'kill', StickerPos>, killText = '🔥 KILL STREAK x5') {
  try {
    // Recorte "cover" da fonte para o canvas
    const sc = Math.max(W / sw, H / sh);
    const dw = sw * sc, dh = sh * sc, dx = (W - dw) / 2, dy = (H - dh) / 2;
    const useCss = !!f.css && supportsCtxFilter(ctx);
    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    if (f.id === 'retro') {
      // Pixel ligeiro: desenha pequeno e amplia sem suavização
      const pw = Math.max(1, Math.round(W / 4)), ph = Math.max(1, Math.round(H / 4));
      pix ??= document.createElement('canvas');
      if (pix.width !== pw) pix.width = pw;
      if (pix.height !== ph) pix.height = ph;
      const p = pix.getContext('2d');
      if (p) { p.drawImage(src, (dx / W) * pw, (dy / H) * ph, (dw / W) * pw, (dh / H) * ph); }
      ctx.imageSmoothingEnabled = false;
      if (useCss) ctx.filter = f.css!;
      ctx.drawImage(pix, 0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
    } else {
      if (useCss) ctx.filter = f.css!;
      ctx.drawImage(src, dx, dy, dw, dh);
    }
    ctx.restore();
    ctx.filter = 'none';

    // Sobreposições (funcionam também sem ctx.filter, ex.: Safari)
    switch (f.id) {
      case 'arena': tint(ctx, W, H, '#1e6fff', 0.28); if (!useCss) tint(ctx, W, H, '#000', 0.12, 'overlay'); break;
      case 'retro': {
        if (!scan) {
          const c = document.createElement('canvas'); c.width = 4; c.height = 4;
          const x = c.getContext('2d'); if (x) { x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, 4, 2); }
          scan = ctx.createPattern(c, 'repeat');
        }
        if (scan) { ctx.save(); ctx.fillStyle = scan; ctx.fillRect(0, 0, W, H); ctx.restore(); }
        tint(ctx, W, H, '#ff3ec8', 0.12);
        break;
      }
      case 'noite': tint(ctx, W, H, '#0b5560', 0.45); if (!useCss) tint(ctx, W, H, '#000', 0.25, 'source-over'); vignette(ctx, W, H, 'rgba(0,10,15,1)', 0.5); break;
      case 'vitoria': tint(ctx, W, H, '#ffb627', 0.3); vignette(ctx, W, H, 'rgba(90,50,0,1)', 0.55); break;
      case 'pb': if (!useCss) tint(ctx, W, H, '#808080', 1, 'saturation'); break;
      case 'hud': {
        tint(ctx, W, H, '#2b8cff', 0.12);
        const m = Math.round(Math.min(W, H) * 0.05), L = Math.round(Math.min(W, H) * 0.12);
        ctx.save(); ctx.strokeStyle = 'rgba(120,200,255,0.9)'; ctx.lineWidth = Math.max(2, Math.round(W / 240));
        ctx.strokeRect(m / 2, m / 2, W - m, H - m);
        ctx.lineWidth *= 2.2;
        for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
          ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
        }
        // mira central discreta
        const c = Math.min(W, H) * 0.035; ctx.lineWidth /= 2.2; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(W / 2, H / 2, c, 0, Math.PI * 2); ctx.moveTo(W / 2 - c * 1.6, H / 2); ctx.lineTo(W / 2 - c * 0.6, H / 2); ctx.moveTo(W / 2 + c * 0.6, H / 2); ctx.lineTo(W / 2 + c * 1.6, H / 2); ctx.stroke();
        ctx.restore();
        watermark(ctx, W, H);
        break;
      }
      case 'moldura': {
        const b = Math.round(Math.min(W, H) * 0.035);
        ctx.save(); ctx.lineWidth = b; ctx.strokeStyle = '#121417'; ctx.strokeRect(b / 2, b / 2, W - b, H - b);
        ctx.lineWidth = Math.max(2, b / 5); ctx.strokeStyle = '#5b9bd5'; ctx.strokeRect(b, b, W - 2 * b, H - 2 * b); ctx.restore();
        watermark(ctx, W, H);
        break;
      }
    }
    if (f.sticker === 'crown') {
      const p = stickers.crown, s = Math.round(Math.min(W, H) * 0.22);
      ctx.save(); ctx.font = `${s}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('👑', p.x * W, p.y * H); ctx.restore();
    }
    if (f.sticker === 'kill') {
      const p = stickers.kill, s = Math.round(Math.min(W, H) * 0.07);
      ctx.save(); ctx.font = `900 ${s}px Impact, 'Arial Black', system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(killText).width + s;
      ctx.fillStyle = 'rgba(18,20,23,0.75)'; ctx.fillRect(p.x * W - tw / 2, p.y * H - s * 0.8, tw, s * 1.6);
      ctx.lineWidth = Math.max(2, s / 8); ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffd34d';
      ctx.strokeText(killText, p.x * W, p.y * H); ctx.fillText(killText, p.x * W, p.y * H);
      ctx.restore();
    }
  } catch { /* nunca parar a câmara por causa de um frame */ }
}

/** O ponto (fração do canvas) toca no sticker? */
export function hitSticker(f: CamFilter, pos: StickerPos, x: number, y: number) {
  if (!f.sticker) return false;
  const r = f.sticker === 'crown' ? 0.14 : 0.1;
  return Math.abs(pos.x - x) < (f.sticker === 'kill' ? 0.35 : r) && Math.abs(pos.y - y) < r;
}

// ---------- Captura para /publicar ----------
export interface Capture { file: File; kind: 'video' | 'long' | 'photo' | 'meme'; duration?: number }
let pending: Capture | null = null;
export function setPendingCapture(c: Capture) { pending = c; }
export function takePendingCapture(): Capture | null { const c = pending; pending = null; return c; }

/** Formato de gravação suportado (mp4 se possível, senão webm). */
export function pickRecorderType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
  for (const t of list) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {} }
  return '';
}

export function stopStream(s?: MediaStream | null) {
  try { s?.getTracks().forEach((t) => { try { t.stop(); } catch {} }); } catch {}
}

/** Mensagem amigável para erros do getUserMedia. */
export function cameraError(e: unknown): string {
  const n = (e as { name?: string })?.name ?? '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Não deste permissão para usar a câmara. Podes ativá-la nas definições do navegador (ícone 🔒 na barra de endereço) ou escolher um ficheiro do dispositivo.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Não encontrámos nenhuma câmara neste dispositivo. Escolhe um ficheiro do dispositivo.';
  if (n === 'NotReadableError') return 'A câmara está a ser usada por outra app. Fecha a outra app e tenta outra vez.';
  return 'Não foi possível abrir a câmara neste navegador. Escolhe um ficheiro do dispositivo.';
}
