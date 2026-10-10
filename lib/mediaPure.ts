// Funções puras das fotos (testadas em tests/registration-market.test.mjs).

export const MEDIA_WIDTHS = [480, 960, 1600] as const;
const VARIANT_RE = /-960\.webp(\?.*)?$/;

export const isArtRef = (src: string) => src.startsWith('art:');
export const artRefId = (src: string) => src.slice(4);

/** srcset de uma foto enviada (só larguras permitidas pelo nível de qualidade). */
export function mediaSrcSet(url: string, widths: readonly number[]): string | undefined {
  if (!VARIANT_RE.test(url)) return undefined;
  return widths.filter((w) => (MEDIA_WIDTHS as readonly number[]).includes(w)).map((w) => `${url.replace(VARIANT_RE, `-${w}.webp`)} ${w}w`).join(', ');
}

/** Dimensões dentro de max × max sem aumentar a imagem. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Recorte central quadrado (logótipos de equipa). */
export function squareCrop(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}
