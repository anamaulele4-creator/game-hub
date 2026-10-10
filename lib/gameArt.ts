// Imagens reais de cada jogo (capas, flyers, cartões). Ficheiros WebP em public/games/<id>-<480|960|1600>.webp
// + <id>-lqip.webp (32 px, desfocado enquanto carrega). Origem e créditos: docs/IMAGE-CREDITS.md.
// Funções puras (testadas em tests/quality.test.mjs).
import type { GameKey } from './jogos';

export type ArtId = 'ff' | 'ff-2' | 'ff-3' | 'cr' | 'ef' | 'dls' | 'outros';

export interface Art {
  id: ArtId;
  game: GameKey;
  alt: string;
  /** largura real do ficheiro "-1600" (algumas fontes são mais pequenas: não inventamos píxeis) */
  maxW: number;
  /** object-position para cortes 4:3 / 1:1 */
  pos: string;
}

export const ART: Record<ArtId, Art> = {
  ff: { id: 'ff', game: 'ff', alt: 'Free Fire — esquadrão em combate (arte oficial Garena)', maxW: 1600, pos: '30% 40%' },
  'ff-2': { id: 'ff-2', game: 'ff', alt: 'Free Fire — personagens a saltar entre explosões (arte oficial Garena)', maxW: 1600, pos: '70% 35%' },
  'ff-3': { id: 'ff-3', game: 'ff', alt: 'Free Fire — Kelly e amigos em festa (arte oficial Garena)', maxW: 1600, pos: '50% 30%' },
  cr: { id: 'cr', game: 'cr', alt: 'Clash Royale — arte oficial Supercell', maxW: 1600, pos: '55% 45%' },
  ef: { id: 'ef', game: 'ef', alt: 'eFootball — arte oficial Konami', maxW: 1351, pos: '50% 35%' },
  dls: { id: 'dls', game: 'dls', alt: 'Dream League Soccer — arte oficial First Touch Games', maxW: 1369, pos: '60% 40%' },
  outros: { id: 'outros', game: 'outros', alt: 'Jogos móveis — telemóvel com jogo no ecrã', maxW: 1365, pos: '60% 50%' },
};

/** Arte principal de cada categoria. */
export const GAME_ART: Record<GameKey, ArtId> = { ff: 'ff', cr: 'cr', ef: 'ef', dls: 'dls', outros: 'outros' };

/** Várias artes para carrosséis (repete a principal quando só existe uma). */
export function artsFor(k: GameKey): ArtId[] {
  return k === 'ff' ? ['ff', 'ff-2', 'ff-3'] : [GAME_ART[k]];
}

/** n-ésima arte de um jogo (roda pelas disponíveis). */
export function artAt(k: GameKey, n: number): ArtId {
  const a = artsFor(k);
  return a[((n % a.length) + a.length) % a.length];
}

const fileW = (w: number) => (w >= 1600 ? 1600 : w);

/** URL de um tamanho. `base` = NEXT_PUBLIC_BASE_PATH. */
export function artUrl(base: string, id: ArtId, w: number | 'lqip'): string {
  return `${base}/games/${id}-${w === 'lqip' ? 'lqip' : fileW(w)}.webp`;
}

/** srcset com as larguras permitidas pelo nível de qualidade (deviceQuality.allowedWidths) e as larguras reais dos ficheiros. */
export function artSrcSet(base: string, id: ArtId, widths: number[]): string {
  const a = ART[id];
  return widths.map((w) => `${artUrl(base, id, w)} ${w >= 1600 ? a.maxW : w}w`).join(', ');
}
