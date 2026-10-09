'use client';
// Capa de torneio no browser: lê o ficheiro, recorta ao centro para 16:9, reduz para no máximo 1280 px de largura
// e comprime para WebP (~300 KB). Em modo real envia para o Storage do Supabase; em modo demo devolve um data URL.
import { IS_DEMO } from './config';
import {
  COVER_BUCKET, COVER_MAX_W, COVER_SMALL_MARK, coverVariants, COVER_TARGET_BYTES, coverOutputSize, coverPath, coverPathFromUrl, cropRect16x9,
  nextCoverQuality, validateCoverFile, validateCoverSize,
} from './cover';

export interface CoverResult { blob: Blob; dataUrl: string; width: number; height: number; bytes: number; type: string; /** versão de 640 px (srcset / Poupança) */ small?: Blob }

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    } catch { /* cai para <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('Não foi possível ler a imagem.')); img.src = url; });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
const toDataUrl = (b: Blob) => new Promise<string>((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => bad(fr.error); fr.readAsDataURL(b); });

/** Valida, recorta (16:9 ao centro) e comprime. Lança Error com mensagem em português. */
export async function prepareCover(file: File): Promise<CoverResult> {
  const bad = validateCoverFile(file);
  if (bad) throw new Error(bad);
  const img = await decode(file);
  try {
    const dims = validateCoverSize(img.w, img.h);
    if (dims) throw new Error(dims);
    const r = cropRect16x9(img.w, img.h);
    let max = COVER_MAX_W;
    for (let pass = 0; pass < 3; pass++) {
      const { w, h } = coverOutputSize(r.sw, max);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Este navegador não consegue preparar a imagem.');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.src, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
      let q: number | null = 0.82;
      let blob: Blob | null = null;
      while (q != null) {
        blob = await toBlob(c, 'image/webp', q);
        // Navegadores sem codificador WebP devolvem PNG: usar JPEG nesse caso
        if (blob && blob.type !== 'image/webp') blob = await toBlob(c, 'image/jpeg', q);
        if (!blob) throw new Error('Não foi possível comprimir a imagem.');
        q = nextCoverQuality(blob.size, q);
      }
      if (blob && (blob.size <= COVER_TARGET_BYTES * 1.15 || pass === 2)) {
        let small: Blob | undefined;
        if (w > 700) {
          const s2 = document.createElement('canvas'); s2.width = 640; s2.height = 360;
          const c2 = s2.getContext('2d');
          if (c2) { c2.imageSmoothingQuality = 'high'; c2.drawImage(c, 0, 0, 640, 360); small = (await toBlob(s2, blob.type, 0.78)) ?? undefined; }
        }
        return { blob, dataUrl: await toDataUrl(blob), width: w, height: h, bytes: blob.size, type: blob.type, small };
      }
      max = Math.round(w * 0.8);
    }
    throw new Error('Não foi possível comprimir a imagem.');
  } finally { img.done(); }
}

/**
 * Guarda a capa e devolve o URL a gravar no torneio.
 * Demo: data URL. Real: bucket público 'clips' em tournaments/<id>-<data>.webp (precisa da política do SQL
 * supabase/migrations/2026-10-10_tournament_cover.sql); se essa política ainda não existir, usa a pasta do próprio utilizador.
 */
export async function saveCover(id: string, r: CoverResult, previous?: string): Promise<string> {
  if (IS_DEMO) return r.dataUrl;
  const { sb } = await import('./supabase');
  const c = await sb();
  const uid = (await c.auth.getSession()).data.session?.user.id;
  if (!uid) throw new Error('A tua sessão terminou. Entra outra vez para guardar a imagem.');
  const ext = r.type === 'image/webp' ? '.webp' : '.jpg';
  const stamp = Date.now();
  const opts = { contentType: r.type, upsert: false, cacheControl: '31536000' };
  let path = coverPath(id, stamp).replace(/\.webp$/, ext);
  let up = await c.storage.from(COVER_BUCKET).upload(path, r.blob, opts);
  if (up.error) {
    path = coverPath(id, stamp, uid).replace(/\.webp$/, ext);
    up = await c.storage.from(COVER_BUCKET).upload(path, r.blob, opts);
  }
  if (up.error) throw new Error('Não foi possível enviar a imagem. Verifica a ligação e tenta outra vez.');
  let mark = '';
  if (r.small) {
    const sp = path.replace(/\.(webp|jpg)$/, '-640.$1');
    const u2 = await c.storage.from(COVER_BUCKET).upload(sp, r.small, opts);
    if (!u2.error) mark = COVER_SMALL_MARK;
  }
  await dropCover(previous);
  return c.storage.from(COVER_BUCKET).getPublicUrl(path).data.publicUrl + mark;
}

/** Apaga do Storage a capa antiga (quando o admin a remove). Silencioso em caso de falha. */
export async function dropCover(previous?: string): Promise<void> {
  if (IS_DEMO) return;
  const old = coverPathFromUrl(previous);
  if (!old) return;
  const small = coverVariants(previous!).small;
  const paths = [old, ...(small ? [coverPathFromUrl(small.replace(/#.*$/, ''))].filter((x): x is string => !!x) : [])];
  try { const { sb } = await import('./supabase'); await (await sb()).storage.from(COVER_BUCKET).remove(paths); } catch { /* ignora */ }
}
