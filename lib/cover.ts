// Capas de torneio: regras puras (sem DOM), testadas em tests/capas.test.mjs.
// O recorte/compressão no browser está em lib/coverImage.ts e usa estas funções.
// Sem imports: o node:test corre este ficheiro diretamente (--experimental-strip-types).

/** Tipos aceites no campo "Imagem de capa". */
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Tamanho máximo do ficheiro escolhido (antes de comprimir). */
export const COVER_MAX_INPUT = 12 * 1024 * 1024;
/** Largura máxima da capa final (16:9 → 1280 x 720). */
export const COVER_MAX_W = 1280;
/** Peso alvo da capa final em WebP. */
export const COVER_TARGET_BYTES = 300 * 1024;
/** Lado mínimo aceitável da imagem original (abaixo disto fica pixelizada). */
export const COVER_MIN_SIDE = 320;
/** Bucket público do Supabase onde ficam as capas (o mesmo das fotos/clipes). */
export const COVER_BUCKET = 'clips';

/** Valida o ficheiro escolhido. Devolve a mensagem de erro (português) ou null se estiver bem. */
export function validateCoverFile(f: { type?: string; size?: number; name?: string }): string | null {
  const type = (f.type || '').toLowerCase();
  const byExt = /\.(jpe?g|png|webp)$/i.test(f.name || '');
  if (!(COVER_TYPES as readonly string[]).includes(type) && !(type === '' && byExt)) return 'Formato não suportado. Usa JPG, PNG ou WebP.';
  if (!f.size) return 'O ficheiro está vazio.';
  if (f.size > COVER_MAX_INPUT) return `Imagem demasiado grande (máximo ${Math.round(COVER_MAX_INPUT / 1048576)} MB).`;
  return null;
}

/** Valida as dimensões da imagem já descodificada. */
export function validateCoverSize(w: number, h: number): string | null {
  if (!w || !h) return 'Não foi possível ler a imagem.';
  if (Math.min(w, h) < COVER_MIN_SIDE * 9 / 16 || w < COVER_MIN_SIDE) return `Imagem muito pequena (mínimo ${COVER_MIN_SIDE} px de largura).`;
  return null;
}

export interface Rect { sx: number; sy: number; sw: number; sh: number }

/** Recorte central com proporção 16:9 (corta os lados se for larga demais, ou cima/baixo se for alta). */
export function cropRect16x9(w: number, h: number): Rect {
  const R = 16 / 9;
  if (w <= 0 || h <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  if (w / h > R) {
    const sw = Math.round(h * R);
    return { sx: Math.floor((w - sw) / 2), sy: 0, sw, sh: h };
  }
  const sh = Math.round(w / R);
  return { sx: 0, sy: Math.floor((h - sh) / 2), sw: w, sh };
}

/** Tamanho de saída: nunca aumenta a imagem e nunca passa de `max` px de largura; altura = largura * 9/16. */
export function coverOutputSize(cropW: number, max = COVER_MAX_W): { w: number; h: number } {
  const w = Math.max(1, Math.min(Math.round(cropW), max));
  return { w, h: Math.round(w * 9 / 16) };
}

/**
 * Próximo passo da compressão: qualidade a tentar a seguir, ou null para parar.
 * Começa em 0,82 e desce 0,1 de cada vez até 0,42; se ainda pesar mais do que o alvo, o chamador reduz a largura.
 */
export function nextCoverQuality(bytes: number, q: number, target = COVER_TARGET_BYTES): number | null {
  if (bytes <= target) return null;
  const n = Math.round((q - 0.1) * 100) / 100;
  return n >= 0.42 ? n : null;
}

/** Só aceitamos capas https (Supabase) ou data URL de imagem (modo demo). Evita javascript: e afins. */
export function isSafeCoverUrl(u: unknown): u is string {
  return typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/i.test(u) || /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(u));
}

export type CoverSource = { kind: 'image'; src: string } | { kind: 'game'; game: string };

/** Capa a mostrar para um torneio: a imagem própria se existir e for válida; senão a capa do jogo
 *  (`game` = texto do torneio; o componente converte com gameKeyOf para public/img/games/). */
export function tournamentCover(t: { cover?: string | null; game: string }): CoverSource {
  return isSafeCoverUrl(t.cover) ? { kind: 'image', src: t.cover } : { kind: 'game', game: t.game };
}

/** Marca no fim do URL guardado a dizer que existe também a versão de 640 px (`<nome>-640.webp`). */
export const COVER_SMALL_MARK = '#v640';

/**
 * Versões de uma capa para srcset: { src (1280), small (640, se existir) }.
 * Em Poupança usa-se só `small`; nas outras o browser escolhe pelo srcset.
 */
export function coverVariants(url: string): { src: string; small?: string } {
  if (!url.endsWith(COVER_SMALL_MARK)) return { src: url };
  const src = url.slice(0, -COVER_SMALL_MARK.length);
  const m = src.match(/^(.*)\.(webp|jpg)$/);
  return m ? { src, small: `${m[1]}-640.${m[2]}` } : { src };
}

/** Caminho no bucket: pasta pública dos torneios (admin) ou, em alternativa, a pasta do próprio utilizador. */
export function coverPath(id: string, stamp: number, uid?: string): string {
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'torneio';
  return uid ? `${uid}/tournament-${safe}-${stamp}.webp` : `tournaments/${safe}-${stamp}.webp`;
}

/** Caminho de um objeto do bucket a partir do URL público (para apagar a capa antiga). */
export function coverPathFromUrl(url: string | undefined | null, bucket = COVER_BUCKET): string | null {
  if (!url || !/^https:/.test(url)) return null;
  const m = url.match(new RegExp(`/storage/v1/object/public/${bucket}/([^?#]+)`));
  if (!m) return null;
  const p = decodeURIComponent(m[1]);
  return /(^tournaments\/|\/tournament-)/.test(p) ? p : null;
}

/** A base de dados ainda não tem a coluna (SQL por correr)? Reconhece os erros do PostgREST/Postgres. */
export function isMissingColumnError(msg: string | undefined | null, col: string): boolean {
  if (!msg) return false;
  return msg.includes(col) && /(could not find|does not exist|schema cache|PGRST204|42703)/i.test(msg);
}
