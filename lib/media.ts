// Fotos enviadas por organizadores e vendedores: comprimidas no telemóvel (WebP), guardadas em 3 larguras
// (<nome>-480/-960/-1600.webp) no bucket público "media" do Supabase. A capa guarda o URL da versão -960 e o
// srcset é montado a partir dele. Fotos "art:<id>" são a arte oficial dos jogos (public/games).
import { IS_DEMO, SUPABASE_URL } from './config';
import { sb } from './supabase';

import { MEDIA_WIDTHS, fitWithin, squareCrop } from './mediaPure.ts';
export { MEDIA_WIDTHS, artRefId, fitWithin, isArtRef, mediaSrcSet, squareCrop } from './mediaPure.ts';

async function encode(bmp: ImageBitmap, max: number, quality: number, square = false): Promise<Blob> {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  if (square) {
    const { sx, sy, side } = squareCrop(bmp.width, bmp.height);
    const out = Math.min(side, max);
    c.width = out; c.height = out;
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, out, out);
  } else {
    const { w, h } = fitWithin(bmp.width, bmp.height, max);
    c.width = w; c.height = h;
    ctx.drawImage(bmp, 0, 0, w, h);
  }
  const webp = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', quality));
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('IMG'))), 'image/jpeg', quality));
}

export const MAX_SOURCE_MB = 15;

/**
 * Comprime e envia uma foto. `folder` = "tournaments/<id>" ou "products/<uid>".
 * Devolve o URL público da versão -960 (ou, em modo demo, um data URL pequeno guardado localmente).
 */
export async function uploadPhoto(file: File, folder: string, opts: { square?: boolean } = {}): Promise<string> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) throw new Error('Formato não suportado. Usa JPG, PNG ou WebP.');
  if (file.size > MAX_SOURCE_MB * 1024 * 1024) throw new Error(`Foto acima de ${MAX_SOURCE_MB} MB.`);
  const bmp = await createImageBitmap(file);
  try {
    if (IS_DEMO) {
      const b = await encode(bmp, opts.square ? 320 : 720, 0.72, opts.square);
      return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });
    }
    const c = await sb();
    const base = `${folder}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    for (const w of MEDIA_WIDTHS) {
      const blob = await encode(bmp, w, w === 1600 ? 0.78 : 0.8, opts.square);
      const { error } = await c.storage.from('media').upload(`${base}-${w}.webp`, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
      if (error) throw new Error(error.message);
    }
    return `${SUPABASE_URL}/storage/v1/object/public/media/${base}-960.webp`;
  } finally {
    bmp.close();
  }
}
