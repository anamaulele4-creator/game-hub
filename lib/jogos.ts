// Jogos & Torneios — configuração por jogo + utilitários puros (testáveis em tests/jogos.test.mjs).
// Regra da Ana: nunca apresentar números inventados como reais. Tudo o que não vem do Supabase
// é mostrado como "A anunciar" ou marcado "Dados de exemplo".

export type GameKey = 'ff' | 'cr' | 'ef' | 'dls' | 'outros';
export const GAME_KEYS: GameKey[] = ['ff', 'cr', 'ef', 'dls', 'outros'];

export interface GameCfg {
  key: GameKey;
  abbr: string;
  name: string;
  /** etiqueta em maiúsculas usada no carrossel */
  tag: string;
  /** "Entrar em …" */
  short: string;
  /** classes Tailwind da etiqueta do jogo (cores por jogo mantidas do protótipo) */
  tagCls: string;
  /** gradiente da capa / arte do flyer */
  cover: string;
  /** cor da etiqueta do jogo no protótipo TXAPZONE (FF laranja, CR azul, eF verde, DLS amarelo, Outros cinza) */
  color: string;
  /** cor do texto sobre `color` */
  onColor: string;
  emoji: string;
  currency: string;
  currencyOne: string;
  packs: number[];
  defaultPack: number;
  idLabel: string;
  idPlaceholder: string;
  idHelp: string;
  /** coluna específica do jogo no histórico */
  statCol: string;
  statTotal: string;
  market: { cat: MarketCat; title: string }[];
}

export type MarketCat = 'Guias' | 'Coaching' | 'Packs para lives' | 'Design';
export const MARKET_CATS: ('Todos' | MarketCat)[] = ['Todos', 'Guias', 'Coaching', 'Packs para lives', 'Design'];

export const GAMES_CFG: Record<GameKey, GameCfg> = {
  ff: {
    key: 'ff', abbr: 'FF', name: 'Free Fire', tag: 'FREE FIRE', short: 'Free Fire', emoji: '',
    tagCls: 'bg-[#FF6B1A] text-white', cover: 'from-[#FF6B1A] via-[#C2410C] to-[#1E3A8A]', color: '#FF6B1A', onColor: '#FFFFFF',
    currency: 'Diamantes', currencyOne: 'diamantes', packs: [100, 310, 520, 1060, 2180, 5600], defaultPack: 310,
    idLabel: 'ID do jogador Free Fire', idPlaceholder: 'Ex.: 123456789', idHelp: 'Confirmamos o nome da conta antes de pagares.',
    statCol: 'Kills', statTotal: 'Kills totais',
    market: [
      { cat: 'Guias', title: 'Guia de sensibilidade e HUD' },
      { cat: 'Guias', title: 'Rotina de treino de mira' },
      { cat: 'Coaching', title: 'Coaching 1h com jogador competitivo' },
      { cat: 'Packs para lives', title: 'Pack de overlays para live' },
      { cat: 'Design', title: 'Logo e banner para equipa' },
    ],
  },
  cr: {
    key: 'cr', abbr: 'CR', name: 'Clash Royale', tag: 'CLASH ROYALE', short: 'Clash Royale', emoji: '',
    tagCls: 'bg-[#3B82F6] text-white', cover: 'from-[#3B82F6] via-[#1D4ED8] to-[#0B1B4D]', color: '#3B82F6', onColor: '#FFFFFF',
    currency: 'Gemas', currencyOne: 'gemas', packs: [80, 500, 1200, 2500, 6500, 14000], defaultPack: 500,
    idLabel: 'Tag do jogador Clash Royale', idPlaceholder: 'Ex.: #2PYQ8L0', idHelp: 'Confirmamos o nome da conta antes de pagares.',
    statCol: 'Coroas', statTotal: 'Coroas totais',
    market: [
      { cat: 'Guias', title: 'Decks meta para subir troféus' },
      { cat: 'Guias', title: 'Guia de ciclo de elixir' },
      { cat: 'Coaching', title: 'Coaching 1h para ladder e torneios' },
      { cat: 'Packs para lives', title: 'Pack de overlays Clash Royale' },
      { cat: 'Design', title: 'Logo e banner para o clã' },
    ],
  },
  ef: {
    key: 'ef', abbr: 'eF', name: 'eFootball', tag: 'EFOOTBALL', short: 'eFootball', emoji: '',
    tagCls: 'bg-[#22C55E] text-ink', cover: 'from-[#22C55E] via-[#15803D] to-[#0B1B4D]', color: '#22C55E', onColor: '#0B0B0D',
    currency: 'eFootball Coins', currencyOne: 'coins', packs: [100, 300, 550, 1040, 2130, 3250], defaultPack: 550,
    idLabel: 'ID do utilizador eFootball', idPlaceholder: 'Ex.: ABCD-123-456-789', idHelp: 'Confirmamos o nome da conta antes de pagares.',
    statCol: 'Golos', statTotal: 'Golos marcados',
    market: [
      { cat: 'Guias', title: 'Formações e táticas para Divisão 1' },
      { cat: 'Guias', title: 'Guia de dribles e skills' },
      { cat: 'Coaching', title: 'Coaching 1h com jogador competitivo' },
      { cat: 'Packs para lives', title: 'Pack de overlays para live de eFootball' },
      { cat: 'Design', title: 'Emblema e banner para o clube' },
    ],
  },
  dls: {
    key: 'dls', abbr: 'DLS', name: 'Dream League Soccer', tag: 'DREAM LEAGUE SOCCER', short: 'DLS', emoji: '',
    tagCls: 'bg-[#FACC15] text-ink', cover: 'from-[#FACC15] via-[#B98900] to-[#0B1B4D]', color: '#FACC15', onColor: '#0B0B0D',
    currency: 'DLS Coins', currencyOne: 'coins', packs: [100, 300, 650, 1400, 3000, 6500], defaultPack: 300,
    idLabel: 'Nome do clube / ID DLS', idPlaceholder: 'Ex.: Maputo FC', idHelp: 'Confirmamos a conta antes de pagares.',
    statCol: 'Golos', statTotal: 'Golos marcados',
    market: [
      { cat: 'Guias', title: 'Guia de gestão de plantel e treinos' },
      { cat: 'Guias', title: 'Táticas para ganhar online' },
      { cat: 'Coaching', title: 'Coaching 1h com jogador competitivo' },
      { cat: 'Packs para lives', title: 'Pack de overlays para live de DLS' },
      { cat: 'Design', title: 'Kit e logo personalizados DLS' },
    ],
  },
  outros: {
    key: 'outros', abbr: '+', name: 'Outros', tag: 'OUTROS JOGOS', short: 'Outros', emoji: '',
    tagCls: 'bg-[#3F3F46] text-white', cover: 'from-[#3F3F46] via-[#26469E] to-[#0B1B4D]', color: '#3F3F46', onColor: '#FFFFFF',
    currency: 'Créditos do jogo', currencyOne: 'créditos', packs: [100, 250, 500, 1000, 2500, 5000], defaultPack: 500,
    idLabel: 'Jogo e ID do jogador', idPlaceholder: 'Ex.: PUBG Mobile · 5123456789', idHelp: 'Confirmamos o jogo e a conta antes de pagares.',
    statCol: 'Pontos', statTotal: 'Pontos totais',
    market: [
      { cat: 'Guias', title: 'Guia para começar no competitivo' },
      { cat: 'Guias', title: 'Rotina de treino diária' },
      { cat: 'Coaching', title: 'Coaching 1h com jogador competitivo' },
      { cat: 'Packs para lives', title: 'Pack de overlays para live' },
      { cat: 'Design', title: 'Logo e banner para equipa' },
    ],
  },
};

export const MAIN_GAMES: GameKey[] = ['ff', 'cr', 'ef', 'dls'];

/* ---------- Capas reais (public/img/games, origem em SOURCES.md) ---------- */
/** Larguras disponíveis de cada capa 16:9 (WebP). */
export const COVER_WIDTHS = [640, 1280] as const;

/** Caminho da capa do jogo (sem basePath). */
export function gameCover(key: GameKey, w: 640 | 1280 = 640): string {
  return `/img/games/${key}-${w}.webp`;
}

/** srcset das capas para o browser escolher (com basePath). */
export function gameCoverSrcSet(key: GameKey, base = ''): string {
  return COVER_WIDTHS.map((w) => `${base}${gameCover(key, w)} ${w}w`).join(', ');
}

/** Ícone oficial do jogo (192 px). "Outros" não tem ícone: usa-se a sigla. */
export function gameIconSrc(key: GameKey): string | null {
  return key === 'outros' ? null : `/img/games/${key}-icon.webp`;
}

/** Associa o texto livre do campo `game` de um torneio a uma categoria. */
export function gameKeyOf(game: string): GameKey {
  const g = (game || '').toLowerCase();
  if (/free\s*fire|\bff\b/.test(g)) return 'ff';
  if (/clash\s*royale|\bcr\b/.test(g)) return 'cr';
  if (/e-?football|\bpes\b/.test(g)) return 'ef';
  if (/dream\s*league|\bdls\b/.test(g)) return 'dls';
  return 'outros';
}

export function isGameKey(k: string): k is GameKey {
  return (GAME_KEYS as string[]).includes(k);
}

/** Valor em meticais; 0 ou desconhecido = "A anunciar" (nunca inventar). */
export function mtOrTba(n: number | null | undefined): string {
  return n && n > 0 ? `${n.toLocaleString('pt-PT')} MT` : 'A anunciar';
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** "2026-10-17 15:00" → "Sáb 17 Out · 15h". Texto não reconhecido é devolvido tal como está; vazio → "Data a anunciar". */
export function fmtWhen(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec((date || '').trim());
  if (!m) return date?.trim() ? date.trim() : 'Data a anunciar';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return date;
  const base = `${DIAS[d.getDay()]} ${m[3]} ${MESES[d.getMonth()]}`;
  if (!m[4]) return base;
  const h = Number(m[4]);
  return `${base} · ${h}h${m[5] !== '00' ? m[5] : ''}`;
}

/** Números moçambicanos M-Pesa/e-Mola: 84–87 + 7 dígitos (aceita +258 / 258 e espaços). Devolve 9 dígitos ou null. */
export function normalizeMzPhone(raw: string): string | null {
  let d = (raw || '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('258') && d.length === 12) d = d.slice(3);
  return /^8[4-7]\d{7}$/.test(d) ? d : null;
}

export function fmtMzPhone(d: string): string {
  return d.length === 9 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` : d;
}

/** Validação leve do ID por jogo (formato apenas; a conta é confirmada pelo parceiro quando a revenda abrir). */
export function validPlayerId(key: GameKey, raw: string): boolean {
  const v = (raw || '').trim();
  if (key === 'ff') return /^\d{6,12}$/.test(v);
  if (key === 'cr') return /^#?[0289PYLQGRJCUV]{3,14}$/i.test(v);
  return v.length >= 3 && v.length <= 60;
}

export const PAY_SOON = 'Pagamentos M-Pesa/e-Mola em breve';

/* ---------- Conteúdo de exemplo do protótipo TXAPZONE ----------
 * Mostrado só quando não há dados reais, sempre com a etiqueta "Dados de exemplo".
 * Os marcadores do protótipo ([PRÉMIO], [PREÇO], [VALOR], [N], [#], [TEMPO], [ODD]…) aparecem como "A anunciar". */
export const TBA = 'A anunciar';

export interface ExampleFlyer { title: string; sub: string }

/** Flyers do carrossel principal (um por jogo), textos do protótipo. */
export const HOME_EXAMPLE_FLYERS: Record<GameKey, ExampleFlyer> = {
  ff: { title: 'Liga Squad', sub: 'Squad 4v4 · Bermuda · Sáb 17 Out · 15h · Prémio A anunciar' },
  cr: { title: 'Copa 1v1', sub: '1v1 · Melhor de 3 · Sáb 17 Out · 17h · Prémio A anunciar' },
  ef: { title: 'Taça 1v1', sub: '1v1 · Online · Sáb 17 Out · 19h · Prémio A anunciar' },
  dls: { title: 'Taça DLS 1v1', sub: '1v1 · Online · Dom 18 Out · 15h · Prémio A anunciar' },
  outros: { title: 'Torneios Outros jogos', sub: 'Modo a anunciar · Data a anunciar · Prémio A anunciar' },
};

/** 3 flyers do separador Início de cada jogo (o 1.º é o do protótipo). */
export function gameExampleFlyers(k: GameKey): ExampleFlyer[] {
  if (k === 'ff') return [
    HOME_EXAMPLE_FLYERS.ff,
    { title: 'Clash Squad Relâmpago', sub: 'Clash Squad 4v4 · Data a anunciar · Prémio A anunciar' },
    { title: 'Copa Solo', sub: 'Solo · Data a anunciar · Prémio A anunciar' },
  ];
  const base = HOME_EXAMPLE_FLYERS[k];
  return [
    base,
    { title: `Liga ${GAMES_CFG[k].short}`, sub: 'Modo a anunciar · Data a anunciar · Prémio A anunciar' },
    { title: `Copa ${GAMES_CFG[k].short}`, sub: 'Modo a anunciar · Data a anunciar · Prémio A anunciar' },
  ];
}

/** Linhas de exemplo do histórico (protótipo, Free Fire). */
export const HISTORY_EXAMPLE: { name: string; date: string }[] = [
  { name: 'Liga Squad — Jornada 1', date: 'Sáb 03 Out' },
  { name: 'Clash Squad Relâmpago', date: '27 Set 2026' },
  { name: 'Copa Solo', date: '20 Set 2026' },
];

/** Jogos de exemplo da secção Apostas (só leitura). */
export const BET_EXAMPLE: { a: string; b: string; when: string }[] = [
  { a: 'Equipa A', b: 'Equipa B', when: 'Hoje · 20h' },
  { a: 'Equipa C', b: 'Equipa D', when: 'Hoje · 21h' },
  { a: 'Equipa E', b: 'Equipa F', when: 'Amanhã · 19h' },
];

/** Iniciais para o avatar circular do cabeçalho ("Ana Maulele" → "AM"). */
export function initials(name: string | null | undefined): string {
  const parts = (name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'TX';
  const a = parts[0][0];
  const b = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] ?? '');
  return (a + b).toUpperCase();
}
