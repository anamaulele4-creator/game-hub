// Apostas v2 — regras puras (sem rede). A fonte de verdade em produção é o Postgres
// (supabase/migrations/2026-10-20-apostas-v2.sql); este ficheiro espelha as mesmas regras para o modo demo,
// a pré-visualização do boletim e os testes (tests/apostas-v2.test.mjs).
// SALDO DE TESTE APENAS: sem valor monetário, não se compra nem se levanta. Dinheiro real fica desligado.

export type V2Result = 'ganha' | 'perdida' | 'anulada' | 'reembolsada';
export type V2OpenStatus = 'aberta' | 'pendente_confirmacao' | 'confirmada' | 'em_andamento' | 'em_analise';
export type V2BetStatus = V2OpenStatus | V2Result;
export type V2MarketStatus = 'aberto' | 'suspenso' | 'fechado' | 'liquidado' | 'anulado';
export type V2Perm = 'markets' | 'odds' | 'settle' | 'toggle' | 'permissions';
export const V2_PERMS: V2Perm[] = ['markets', 'odds', 'settle', 'toggle', 'permissions'];
export const V2_PERM_NAMES: Record<V2Perm, string> = {
  markets: 'Criar e gerir mercados', odds: 'Definir odds', settle: 'Liquidar apostas', toggle: 'Ligar/desligar apostas', permissions: 'Gerir permissões',
};
export const V2_RESULT_NAMES: Record<V2BetStatus, string> = {
  aberta: 'Confirmada', pendente_confirmacao: 'Pendente', confirmada: 'Confirmada', em_andamento: 'Em andamento', em_analise: 'Em análise',
  ganha: 'Ganha', perdida: 'Perdida', anulada: 'Anulada', reembolsada: 'Reembolsada',
};
/** Dinheiro em jogo (aposta ainda não liquidada). 'aberta' = apostas antigas da v2. */
export const isOpenBet = (s: string) => ['aberta', 'pendente_confirmacao', 'confirmada', 'em_andamento', 'em_analise'].includes(s);
export const V2_CURRENCY = 'Saldo de teste';

export interface V2Limits { min_stake: number; max_stake: number; initial_test_balance: number }
export const V2_DEFAULT_LIMITS: V2Limits = { min_stake: 10, max_stake: 5000, initial_test_balance: 1000 };

export type StakeCode = 'STAKE_INT' | 'STAKE_POSITIVE' | 'STAKE_MIN' | 'STAKE_MAX' | 'BALANCE';
/** Mesma ordem de verificação do servidor (apv2_place). */
export function validateStakeV2(stake: number, limits: V2Limits, balance: number): StakeCode | null {
  if (!Number.isFinite(stake) || !Number.isInteger(stake)) return 'STAKE_INT';
  if (stake <= 0) return 'STAKE_POSITIVE';
  if (stake < limits.min_stake) return 'STAKE_MIN';
  if (stake > limits.max_stake) return 'STAKE_MAX';
  if (stake > balance) return 'BALANCE';
  return null;
}
export const round2 = (x: number) => Math.round(x * 100) / 100;
/** Retorno potencial (arredondado para baixo, como no servidor). */
export const potentialV2 = (stake: number, odds: number) => Math.floor(stake * round2(odds) + 1e-9);
/** Aceita won/lost/void/refund ou os nomes portugueses. */
export function normResult(r: string): V2Result | null {
  const m: Record<string, V2Result> = { won: 'ganha', lost: 'perdida', void: 'anulada', refund: 'reembolsada', ganha: 'ganha', perdida: 'perdida', anulada: 'anulada', reembolsada: 'reembolsada' };
  return m[String(r).toLowerCase()] ?? null;
}
export const payoutFor = (r: V2Result, stake: number, potential: number) => (r === 'ganha' ? potential : r === 'perdida' ? 0 : stake);
export const fmtTest = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} pts de teste`;
export const fmtOddsV2 = (o: number) => round2(o).toFixed(2);

export const V2_ERR: Record<string, string> = {
  AUTH: 'Entra na tua conta.', DISABLED: 'As apostas estão desativadas neste momento.', FORBIDDEN: 'Sem permissão.',
  STAKE_INT: 'Indica um valor inteiro.', STAKE_POSITIVE: 'O valor tem de ser maior que zero.', STAKE_MIN: 'Valor abaixo do mínimo.', STAKE_MAX: 'Valor acima do máximo.',
  BALANCE: 'Saldo de teste insuficiente.', NOT_FOUND: 'Não encontrado.', CLOSED: 'Este mercado já não aceita apostas.',
  ODDS_CHANGED: 'A odd mudou. Confirma de novo com a odd atual.', ALREADY_SETTLED: 'Esta aposta já foi liquidada com outro resultado.',
  INVALID: 'Valores inválidos.', STATE: 'Esta ação já não é possível.', ROLE: 'Só admins e moderadores podem receber permissões de Apostas.',
  NOT_INSTALLED: 'Apostas v2 ainda não instaladas no servidor (corre o SQL de sql-apostas.html).',
};
export const v2ErrText = (code: string) => V2_ERR[code] ?? code;

/* ---------------- Motor em memória (modo demo e testes) — espelha o SQL regra a regra ---------------- */
export interface V2Selection { id: string; marketId: string; label: string; odds: number; oddsVersion: number; result: 'pendente' | V2Result; side?: 'a' | 'b' | 'empate' }
export interface V2Market { id: string; title: string; game: string; status: V2MarketStatus; closesAt: string | null; createdAt: string; matchId?: string | null }
export interface V2Bet { id: string; userId: string; marketId: string; selectionId: string; stake: number; oddsLocked: number; oddsVersionLocked: number; potential: number; status: V2BetStatus; payout: number; requestId?: string; createdAt: string; settledAt: string | null;
  matchId?: string | null; selectionLabel?: string; confirmedAt?: string | null; officialResult?: string | null; settledAmount?: number | null }
export interface V2Ledger { userId: string; delta: number; reason: string; ref: string; balanceAfter: number }
export interface V2Audit { id: number; at: string; actor: string; action: string; target: string; before: unknown; after: unknown }
export interface V2DB {
  enabled: boolean; limits: V2Limits; markets: V2Market[]; selections: V2Selection[]; bets: V2Bet[]; ledger: V2Ledger[];
  perms: Record<string, V2Perm[]>; roles: Record<string, 'admin' | 'moderator' | 'creator' | 'user'>; audit: V2Audit[]; seq: number;
  v3?: V3State;
}
export type V2Res = { ok: true; [k: string]: unknown } | { ok: false; code: string; [k: string]: unknown };

export function emptyV2(): V2DB {
  return { enabled: false, limits: { ...V2_DEFAULT_LIMITS }, markets: [], selections: [], bets: [], ledger: [], perms: {}, roles: {}, audit: [], seq: 1 };
}
const nid = (d: V2DB, p: string) => `${p}${d.seq++}`;
const iso = (t: number) => new Date(t).toISOString();
export function hasPerm(d: V2DB, user: string, p: V2Perm): boolean {
  const role = d.roles[user];
  if (role !== 'admin' && role !== 'moderator') return false;
  return (p === 'permissions' && role === 'admin') || (d.perms[user] ?? []).includes(p);
}
function audit(d: V2DB, actor: string, action: string, target: string, before: unknown, after: unknown, now: number) {
  d.audit.unshift({ id: d.seq++, at: iso(now), actor, action, target, before, after });
}
export function balanceV2(d: V2DB, user: string): number {
  for (let i = d.ledger.length - 1; i >= 0; i--) if (d.ledger[i].userId === user) return d.ledger[i].balanceAfter;
  return 0;
}
/** Lançamento idempotente: (utilizador, motivo, ref) só entra uma vez; nunca negativo. */
export function postV2(d: V2DB, user: string, delta: number, reason: string, ref: string): number {
  if (d.ledger.some((r) => r.userId === user && r.reason === reason && r.ref === ref)) return balanceV2(d, user);
  const after = balanceV2(d, user) + delta;
  if (after < 0) throw new Error('BALANCE');
  d.ledger.push({ userId: user, delta, reason, ref, balanceAfter: after });
  return after;
}
export function setEnabled(d: V2DB, actor: string, on: boolean, now: number): V2Res {
  if (!hasPerm(d, actor, 'toggle')) return { ok: false, code: 'FORBIDDEN' };
  if (d.enabled !== on) { audit(d, actor, 'definicao:apostas_enabled', 'apostas_enabled', { value: d.enabled }, { value: on }, now); d.enabled = on; }
  return { ok: true };
}
export function grant(d: V2DB, actor: string, user: string, p: V2Perm, on: boolean, now: number): V2Res {
  if (!hasPerm(d, actor, 'permissions')) return { ok: false, code: 'FORBIDDEN' };
  if (!['admin', 'moderator'].includes(d.roles[user] ?? '')) return { ok: false, code: 'ROLE' };
  const cur = d.perms[user] ?? [];
  const had = cur.includes(p);
  if (had !== on) { d.perms[user] = on ? [...cur, p] : cur.filter((x) => x !== p); audit(d, actor, on ? 'dar_permissao' : 'tirar_permissao', user, { perm: p, on: had }, { perm: p, on }, now); }
  return { ok: true };
}
export function claimTest(d: V2DB, user: string): V2Res {
  if (!d.enabled) return { ok: false, code: 'DISABLED' };
  return { ok: true, balance: postV2(d, user, d.limits.initial_test_balance, 'inicial', 'v2') };
}
export function createMarket(d: V2DB, actor: string, title: string, game: string, closesAt: string | null, sels: { label: string; odds: number }[], now: number): V2Res {
  if (!hasPerm(d, actor, 'markets')) return { ok: false, code: 'FORBIDDEN' };
  if (title.trim().length < 3 || sels.length < 2 || sels.length > 20 || sels.some((s) => !s.label.trim() || !(s.odds >= 1.01 && s.odds <= 1000))) return { ok: false, code: 'INVALID' };
  const m: V2Market = { id: nid(d, 'm'), title: title.trim(), game: game || 'outros', status: 'aberto', closesAt, createdAt: iso(now) };
  d.markets.unshift(m);
  for (const s of sels) d.selections.push({ id: nid(d, 's'), marketId: m.id, label: s.label.trim(), odds: round2(s.odds), oddsVersion: 1, result: 'pendente' });
  audit(d, actor, 'criar_mercado', m.id, null, { title: m.title, selections: sels }, now);
  return { ok: true, id: m.id };
}
export function marketStatus(d: V2DB, actor: string, id: string, status: 'aberto' | 'suspenso' | 'fechado', now: number): V2Res {
  if (!hasPerm(d, actor, 'markets')) return { ok: false, code: 'FORBIDDEN' };
  const m = d.markets.find((x) => x.id === id); if (!m) return { ok: false, code: 'NOT_FOUND' };
  if (m.status === 'liquidado' || m.status === 'anulado') return { ok: false, code: 'STATE' };
  audit(d, actor, 'estado_mercado', id, { status: m.status }, { status }, now); m.status = status;
  return { ok: true };
}
export function setOdds(d: V2DB, actor: string, selId: string, odds: number, now: number): V2Res {
  if (!hasPerm(d, actor, 'odds')) return { ok: false, code: 'FORBIDDEN' };
  const o = round2(odds); if (!(o >= 1.01 && o <= 1000)) return { ok: false, code: 'INVALID' };
  const s = d.selections.find((x) => x.id === selId); if (!s) return { ok: false, code: 'NOT_FOUND' };
  const m = d.markets.find((x) => x.id === s.marketId)!;
  if (m.status === 'liquidado' || m.status === 'anulado' || s.result !== 'pendente') return { ok: false, code: 'STATE' };
  if (o !== s.odds) { audit(d, actor, 'mudar_odd', selId, { odds: s.odds, version: s.oddsVersion }, { odds: o, version: s.oddsVersion + 1 }, now); s.odds = o; s.oddsVersion++; }
  return { ok: true, odds: s.odds, odds_version: s.oddsVersion };
}
export function placeV2(d: V2DB, user: string, selId: string, stake: number, seenOdds: number, now: number, requestId?: string): V2Res {
  if (!d.enabled) return { ok: false, code: 'DISABLED' };
  if (requestId) { const p = d.bets.find((b) => b.userId === user && b.requestId === requestId); if (p) return { ok: true, bet: p.id, odds: p.oddsLocked, potential: p.potential, balance: balanceV2(d, user), replay: true }; }
  const sc = validateStakeV2(stake, d.limits, Infinity); if (sc) return { ok: false, code: sc };
  const s = d.selections.find((x) => x.id === selId); if (!s) return { ok: false, code: 'NOT_FOUND' };
  const m = d.markets.find((x) => x.id === s.marketId)!;
  if (m.status !== 'aberto' || (m.closesAt && Date.parse(m.closesAt) <= now) || s.result !== 'pendente') return { ok: false, code: 'CLOSED' };
  if (round2(seenOdds) !== s.odds) return { ok: false, code: 'ODDS_CHANGED', odds: s.odds, odds_version: s.oddsVersion };
  if (balanceV2(d, user) < stake) return { ok: false, code: 'BALANCE', balance: balanceV2(d, user) };
  const b: V2Bet = { id: nid(d, 'b'), userId: user, marketId: m.id, selectionId: s.id, stake, oddsLocked: s.odds, oddsVersionLocked: s.oddsVersion, potential: potentialV2(stake, s.odds), status: 'aberta', payout: 0, requestId, createdAt: iso(now), settledAt: null };
  d.bets.unshift(b);
  const bal = postV2(d, user, -stake, 'aposta', b.id);
  return { ok: true, bet: b.id, odds: b.oddsLocked, potential: b.potential, balance: bal };
}
function settleInner(d: V2DB, actor: string, betId: string, result: string, now: number, official?: string | null, note?: string): V2Res {
  const r = normResult(result); if (!r) return { ok: false, code: 'INVALID' };
  const b = d.bets.find((x) => x.id === betId); if (!b) return { ok: false, code: 'NOT_FOUND' };
  if (!isOpenBet(b.status)) return b.status === r ? { ok: true, already: true, status: b.status, payout: b.payout } : { ok: false, code: 'ALREADY_SETTLED', status: b.status };
  const pay = payoutFor(r, b.stake, b.potential);
  if (pay > 0) postV2(d, b.userId, pay, 'liquidacao', b.id);
  betEvent(d, b, r, note ?? '', actor, now, pay);
  b.status = r; b.payout = pay; b.settledAmount = pay; b.officialResult = official ?? null; b.settledAt = iso(now);
  audit(d, actor, 'liquidar_aposta', b.id, { status: 'aberta' }, { status: r, payout: pay, user: b.userId }, now);
  return { ok: true, already: false, status: r, payout: pay };
}
export function settleBetV2(d: V2DB, actor: string, betId: string, result: string, now: number): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  if (d.bets.find((x) => x.id === betId)?.matchId) return { ok: false, code: 'RESULT_NOT_VALIDATED' };
  return settleInner(d, actor, betId, result, now);
}
export function settleMarketV2(d: V2DB, actor: string, marketId: string, winner: string | null, now: number): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  const m = d.markets.find((x) => x.id === marketId); if (!m) return { ok: false, code: 'NOT_FOUND' };
  if (m.matchId) return { ok: false, code: 'RESULT_NOT_VALIDATED' };
  if (m.status === 'liquidado' || m.status === 'anulado') return { ok: true, already: true, status: m.status };
  const sels = d.selections.filter((s) => s.marketId === marketId);
  if (winner && !sels.some((s) => s.id === winner)) return { ok: false, code: 'INVALID' };
  for (const s of sels) if (s.result === 'pendente') s.result = winner == null ? 'anulada' : s.id === winner ? 'ganha' : 'perdida';
  let n = 0;
  for (const b of d.bets.filter((x) => x.marketId === marketId && isOpenBet(x.status))) { settleInner(d, actor, b.id, sels.find((s) => s.id === b.selectionId)!.result, now); n++; }
  const prev = m.status; m.status = winner == null ? 'anulado' : 'liquidado';
  audit(d, actor, winner == null ? 'anular_mercado' : 'liquidar_mercado', marketId, { status: prev }, { winner, bets: n }, now);
  return { ok: true, already: false, bets: n };
}

/* ---------------- Venda de contas (marketplace) ---------------- */
/** Só criadores e admins vendem contas; com o interruptor desligado, só o admin. Também imposto no servidor (CONTAS_CRIADOR / CONTAS_OFF). */
export function canSellAccounts(role: string | undefined, enabled: boolean): boolean {
  if (role === 'admin') return true;
  return enabled && role === 'criador';
}
export const CONTAS_MSG = { role: 'Só criadores podem vender contas.', off: 'A venda de contas está desativada pelo admin.' };

/* =====================================================================================================
 * Apostas v3 — confrontos, estados, limites, resultados com dupla validação.
 * Espelha supabase/migrations/2026-10-21-apostas-v3.sql (fonte de verdade em produção). Saldo de TESTE apenas.
 * ===================================================================================================== */

/* ---------------- Cálculo de dinheiro (inteiros; sem erros de vírgula flutuante) ---------------- */
/** Multiplicador em centésimas inteiras: "1,85" | 1.85 → 185. Inválido → NaN. */
export function oddsToHundredths(o: number | string): number {
  const str = typeof o === 'number' ? (Number.isFinite(o) ? o.toFixed(6) : '') : String(o).trim().replace(',', '.');
  const m = /^(\d{1,4})(?:\.(\d+))?$/.exec(str);
  if (!m) return NaN;
  const dec = (m[2] ?? '').padEnd(3, '0');
  const cents = Number(m[1]) * 100 + Number(dec.slice(0, 2));
  return Number(dec[2]) >= 5 ? cents + 1 : cents; // arredonda à centésima (como round(x, 2) no servidor)
}
export interface StakeCalc { valor: number; mult: number; retorno: number; ganho: number; retornoExato: string }
/**
 * retorno = valor × multiplicador; ganho líquido = retorno − valor. Tudo em MT inteiros (de teste).
 * O retorno é arredondado para baixo à unidade, exatamente como o servidor (floor(stake * odds)).
 * retornoExato mostra o valor com 2 casas, calculado em inteiros (sem 0.1 + 0.2).
 */
export function calcStake(valor: number, mult: number | string): StakeCalc | null {
  const c = oddsToHundredths(mult);
  if (!Number.isInteger(valor) || valor <= 0 || !Number.isFinite(c) || c < 101) return null;
  const totalCents = valor * c; // valor (MT) × centésimas = centésimos de MT, inteiro
  const retorno = Math.floor(totalCents / 100);
  return { valor, mult: c / 100, retorno, ganho: retorno - valor, retornoExato: `${Math.floor(totalCents / 100)}.${String(totalCents % 100).padStart(2, '0')}` };
}
export const fmtMT = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} MT`;
/** Moeda de teste: mostramos "MT de teste" para nunca parecer dinheiro real. */
export const fmtMTTeste = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} MT (teste)`;

/* ---------------- Jogos, estados e transições ---------------- */
export type V3Game = 'ff' | 'ef' | 'dls' | 'fortnite' | 'cod' | 'cr' | 'valorant' | 'minecraft' | 'outros';
export const V3_GAMES: { key: V3Game; name: string; emoji: string; color: string }[] = [
  { key: 'ff', name: 'Free Fire', emoji: '🔥', color: '#FF6B1A' },
  { key: 'ef', name: 'eFootball', emoji: '⚽', color: '#22C55E' },
  { key: 'dls', name: 'DLS', emoji: '🏆', color: '#A855F7' },
  { key: 'fortnite', name: 'Fortnite', emoji: '🪂', color: '#38BDF8' },
  { key: 'cod', name: 'CoD', emoji: '🎯', color: '#EAB308' },
  { key: 'cr', name: 'Clash Royale', emoji: '👑', color: '#3B82F6' },
  { key: 'valorant', name: 'Valorant', emoji: '🗡️', color: '#F43F5E' },
  { key: 'minecraft', name: 'Minecraft', emoji: '⛏️', color: '#84CC16' },
  { key: 'outros', name: 'Outros', emoji: '🎮', color: '#94A3B8' },
];
export const v3GameName = (k: string) => V3_GAMES.find((g) => g.key === k)?.name ?? 'Outros';
export const isV3Game = (k: string): k is V3Game => V3_GAMES.some((g) => g.key === k);

export type V3MatchStatus = 'agendado' | 'apostas_abertas' | 'em_andamento' | 'suspenso' | 'aguarda_resultado' | 'resultado_em_analise' | 'finalizado' | 'cancelado';
export const V3_MATCH_STATUS: Record<V3MatchStatus, string> = {
  agendado: 'Agendado', apostas_abertas: 'Apostas abertas', em_andamento: 'Em andamento', suspenso: 'Suspenso',
  aguarda_resultado: 'A aguardar resultado', resultado_em_analise: 'Resultado em análise', finalizado: 'Finalizado', cancelado: 'Cancelado',
};
const MATCH_NEXT: Record<V3MatchStatus, V3MatchStatus[]> = {
  agendado: ['apostas_abertas', 'suspenso', 'em_andamento', 'cancelado'],
  apostas_abertas: ['agendado', 'suspenso', 'em_andamento', 'cancelado'],
  suspenso: ['agendado', 'apostas_abertas', 'em_andamento', 'cancelado'],
  em_andamento: ['suspenso', 'aguarda_resultado', 'resultado_em_analise', 'cancelado'],
  aguarda_resultado: ['resultado_em_analise', 'cancelado'],
  resultado_em_analise: ['aguarda_resultado', 'finalizado', 'cancelado'],
  finalizado: [], cancelado: [],
};
export const matchNextOk = (from: V3MatchStatus, to: V3MatchStatus) => from === to || MATCH_NEXT[from].includes(to);
const BET_NEXT: Record<string, V2BetStatus[]> = {
  pendente_confirmacao: ['confirmada', 'anulada', 'reembolsada'],
  aberta: ['confirmada', 'em_andamento', 'em_analise', 'ganha', 'perdida', 'anulada', 'reembolsada'],
  confirmada: ['em_andamento', 'em_analise', 'ganha', 'perdida', 'anulada', 'reembolsada'],
  em_andamento: ['em_analise', 'ganha', 'perdida', 'anulada', 'reembolsada'],
  em_analise: ['em_andamento', 'ganha', 'perdida', 'anulada', 'reembolsada'],
};
export const betNextOk = (from: string, to: string) => (BET_NEXT[from] ?? []).includes(to as V2BetStatus);

/** Separadores de "Minhas apostas". */
export type V3Tab = 'todas' | 'pendentes' | 'em_andamento' | 'ganhas' | 'perdidas' | 'anuladas' | 'reembolsadas';
export const V3_TABS: { key: V3Tab; label: string; match: (s: string) => boolean }[] = [
  { key: 'todas', label: 'Todas', match: () => true },
  { key: 'pendentes', label: 'Pendentes', match: (s) => ['pendente_confirmacao', 'confirmada', 'aberta'].includes(s) },
  { key: 'em_andamento', label: 'Em andamento', match: (s) => s === 'em_andamento' || s === 'em_analise' },
  { key: 'ganhas', label: 'Ganhas', match: (s) => s === 'ganha' },
  { key: 'perdidas', label: 'Perdidas', match: (s) => s === 'perdida' },
  { key: 'anuladas', label: 'Anuladas', match: (s) => s === 'anulada' },
  { key: 'reembolsadas', label: 'Reembolsadas', match: (s) => s === 'reembolsada' },
];
export interface V3BetFilter { tab?: V3Tab; game?: string; status?: string; from?: string; to?: string; q?: string }
export function filterBetsV3<T extends { status: string; createdAt: string; game?: string; label?: string; market?: string }>(bets: T[], f: V3BetFilter): T[] {
  const tab = V3_TABS.find((t) => t.key === (f.tab ?? 'todas'))!;
  const from = f.from ? Date.parse(`${f.from}T00:00:00`) : -Infinity;
  const to = f.to ? Date.parse(`${f.to}T23:59:59.999`) : Infinity;
  const q = (f.q ?? '').trim().toLowerCase();
  return bets.filter((b) => tab.match(b.status) && (!f.game || b.game === f.game) && (!f.status || b.status === f.status)
    && Date.parse(b.createdAt) >= from && Date.parse(b.createdAt) <= to
    && (!q || `${b.label ?? ''} ${b.market ?? ''}`.toLowerCase().includes(q)));
}

/* ---------------- Mensagens de erro (claras, em português) ---------------- */
Object.assign(V2_ERR, {
  BALANCE: 'Saldo insuficiente.', CLOSED: 'Mercado encerrado: este confronto já não aceita apostas.', SUSPENDED: 'Mercado suspenso temporariamente. Tenta mais tarde.',
  ODDS_CHANGED: 'O multiplicador mudou. Revê o novo valor e confirma outra vez.', NETWORK: 'Falha de rede. A tua aposta não foi duplicada — tenta outra vez.',
  RESULT_NOT_VALIDATED: 'Resultado ainda não validado: os confrontos só são liquidados depois de um resultado aprovado.',
  LIMIT_STAKE: 'Valor acima do limite por aposta.', LIMIT_USER: 'Atingiste o teu limite de apostas em aberto.', LIMIT_EXPOSURE: 'Limite deste mercado atingido. Tenta um valor menor ou outro confronto.',
  UNDERAGE: 'Apostas só para maiores de 18 anos.', SELF_EXCLUDED: 'Estás em autoexclusão. Não podes apostar até ao fim do período.', ACCOUNT_SUSPENDED: 'A tua conta está suspensa.',
  REQUEST_ID: 'Pedido inválido. Fecha e abre o boletim.', REQUEST_REUSED: 'Este pedido já foi usado com outros dados. Fecha e abre o boletim.',
  INVALID_RESULT: 'Resultado inválido (vencedor ou placar não batem certo).', SAME_REVIEWER: 'Quem propôs o resultado não o pode aprovar. Pede a outra pessoa.',
  MOTIVO: 'Indica o motivo (mín. 3 letras).', PAST_DATE: 'A data do confronto já passou.', MATERIAL_CHANGE: 'Já há apostas: não podes mudar as equipas ou o jogo. Cancela e cria outro confronto.',
  RESULT_PENDING: 'Já existe um resultado à espera de revisão.', LOGO_URL: 'O logótipo tem de ser carregado para o armazenamento da app (pasta teams/).',
  DUPLICATE: 'Já existe uma equipa com esse nome neste jogo.', TOO_MANY: 'Tens demasiadas reclamações em aberto.',
});

/* ---------------- Exposição (pior caso para a casa) ---------------- */
/** max(Σ retornos numa seleção) − Σ valores do mercado, nunca negativo. Igual a apv2__market_exposure. */
export function marketExposureOf(sels: { id: string }[], bets: { selectionId: string; stake: number; potential: number; status: string }[], extra?: { selectionId: string; stake: number; potential: number }): number {
  const open = bets.filter((b) => isOpenBet(b.status));
  const stakes = open.reduce((a, b) => a + b.stake, 0) + (extra?.stake ?? 0);
  let worst = 0;
  for (const s of sels) {
    const pot = open.filter((b) => b.selectionId === s.id).reduce((a, b) => a + b.potential, 0) + (extra && extra.selectionId === s.id ? extra.potential : 0);
    worst = Math.max(worst, pot);
  }
  return Math.max(0, worst - stakes);
}

/* ---------------- Motor v3 em memória (modo demo e testes) ---------------- */
export interface V3Match {
  id: string; game: string; teamA: string; teamB: string; logoA: string | null; logoB: string | null; startsAt: string; organizer: string; rules: string;
  tournamentRef: string | null; tournamentName: string; status: V3MatchStatus; result: 'a' | 'b' | 'empate' | 'cancelado' | null; scoreA: number | null; scoreB: number | null; marketId: string; createdAt: string;
}
export interface V3ResultRow { id: string; matchId: string; winner: 'a' | 'b' | 'empate'; scoreA: number | null; scoreB: number | null; motivo: string; proposedBy: string; requestId?: string; status: 'proposto' | 'aprovado' | 'rejeitado'; reviewedBy: string | null; reviewMotivo: string; at: string }
export interface V3Limit { scope: 'user' | 'match' | 'market' | 'event' | 'global_exposure'; ref: string; maxStake: number | null; maxExposure: number | null; autoSuspend: boolean; active: boolean }
export interface V3Event { id: number; betId: string; userId: string; from: string | null; to: string; amount: number; note: string; actor: string; at: string }
export interface V3Complaint { id: string; userId: string; betId: string | null; matchId: string | null; message: string; status: 'aberta' | 'em_analise' | 'resolvida' | 'rejeitada'; response: string; at: string }
export interface V3Account { block?: string | null; selfMaxStake?: number | null }
export interface V3State { matches: V3Match[]; results: V3ResultRow[]; limits: V3Limit[]; events: V3Event[]; complaints: V3Complaint[]; chips: number[]; accounts: Record<string, V3Account> }
export const V3_DEFAULT_CHIPS = [50, 100, 200, 500, 1000];

export function v3(d: V2DB): V3State {
  if (!d.v3) d.v3 = { matches: [], results: [], limits: [], events: [], complaints: [], chips: [...V3_DEFAULT_CHIPS], accounts: {} };
  return d.v3;
}
function betEvent(d: V2DB, b: V2Bet, to: V2BetStatus, note: string, actor: string, now: number, amount?: number) {
  const s = v3(d);
  if (b.status === to) return;
  s.events.push({ id: d.seq++, betId: b.id, userId: b.userId, from: b.status, to, amount: amount ?? (isOpenBet(to) ? b.stake : b.payout), note, actor, at: iso(now) });
}
function moveBet(d: V2DB, b: V2Bet, to: V2BetStatus, note: string, actor: string, now: number) {
  if (b.status === to) return;
  if (!betNextOk(b.status, to)) throw new Error(`BET_TRANSITION ${b.status} -> ${to}`);
  betEvent(d, b, to, note, actor, now); b.status = to;
}
const motivoOk = (m: string | null | undefined) => (m ?? '').trim().length >= 3;
const matchMarkets = (d: V2DB, matchId: string) => d.markets.filter((m) => m.matchId === matchId);
function syncMatch(d: V2DB, mt: V3Match, actor: string, note: string, now: number) {
  for (const m of matchMarkets(d, mt.id)) if (m.status !== 'liquidado' && m.status !== 'anulado') {
    m.status = mt.status === 'apostas_abertas' ? 'aberto' : mt.status === 'suspenso' ? 'suspenso' : 'fechado'; m.closesAt = mt.startsAt;
  }
  for (const b of d.bets.filter((x) => x.matchId === mt.id)) {
    if ((mt.status === 'em_andamento' || mt.status === 'aguarda_resultado') && ['aberta', 'confirmada', 'em_analise'].includes(b.status)) moveBet(d, b, 'em_andamento', note, actor, now);
    if (mt.status === 'resultado_em_analise' && ['aberta', 'confirmada', 'em_andamento'].includes(b.status)) moveBet(d, b, 'em_analise', note, actor, now);
  }
}
export interface V3MatchInput { game: string; teamA: string; teamB: string; logoA?: string | null; logoB?: string | null; startsAt: string; organizer?: string; rules?: string; tournamentRef?: string | null; tournamentName?: string; oddsA: number; oddsB: number; oddsDraw?: number | null }
export function createMatchV3(d: V2DB, actor: string, p: V3MatchInput, now: number): V2Res {
  if (!hasPerm(d, actor, 'markets')) return { ok: false, code: 'FORBIDDEN' };
  const a = p.teamA.trim(), b = p.teamB.trim();
  if (!isV3Game(p.game) || !a || !b || a.toLowerCase() === b.toLowerCase() || a.length > 60 || b.length > 60) return { ok: false, code: 'INVALID' };
  if (!(Date.parse(p.startsAt) > now)) return { ok: false, code: 'PAST_DATE' };
  const okOdd = (o: number | null | undefined) => typeof o === 'number' && o >= 1.01 && o <= 1000;
  if (!okOdd(p.oddsA) || !okOdd(p.oddsB) || (p.oddsDraw != null && !okOdd(p.oddsDraw))) return { ok: false, code: 'INVALID' };
  const mk: V2Market = { id: nid(d, 'm'), title: `${a} vs ${b}`.slice(0, 120), game: p.game, status: 'fechado', closesAt: p.startsAt, createdAt: iso(now) };
  const mt: V3Match = { id: nid(d, 'x'), game: p.game, teamA: a, teamB: b, logoA: p.logoA ?? null, logoB: p.logoB ?? null, startsAt: p.startsAt, organizer: p.organizer ?? '', rules: p.rules ?? '', tournamentRef: p.tournamentRef || null, tournamentName: p.tournamentName ?? '', status: 'agendado', result: null, scoreA: null, scoreB: null, marketId: mk.id, createdAt: iso(now) };
  mk.matchId = mt.id;
  d.markets.unshift(mk);
  d.selections.push({ id: nid(d, 's'), marketId: mk.id, label: a, odds: round2(p.oddsA), oddsVersion: 1, result: 'pendente', side: 'a' });
  if (p.oddsDraw != null) d.selections.push({ id: nid(d, 's'), marketId: mk.id, label: 'Empate', odds: round2(p.oddsDraw), oddsVersion: 1, result: 'pendente', side: 'empate' });
  d.selections.push({ id: nid(d, 's'), marketId: mk.id, label: b, odds: round2(p.oddsB), oddsVersion: 1, result: 'pendente', side: 'b' });
  v3(d).matches.unshift(mt);
  audit(d, actor, 'criar_confronto', mt.id, null, { ...p }, now);
  return { ok: true, id: mt.id, market: mk.id };
}
export function matchStatusV3(d: V2DB, actor: string, id: string, to: V3MatchStatus, motivo: string, now: number): V2Res {
  if (!hasPerm(d, actor, 'markets')) return { ok: false, code: 'FORBIDDEN' };
  if (!motivoOk(motivo)) return { ok: false, code: 'MOTIVO' };
  if (!['agendado', 'apostas_abertas', 'suspenso', 'em_andamento', 'aguarda_resultado'].includes(to)) return { ok: false, code: 'INVALID' };
  const mt = v3(d).matches.find((x) => x.id === id); if (!mt) return { ok: false, code: 'NOT_FOUND' };
  if (mt.status === to) return { ok: true, already: true };
  if (!matchNextOk(mt.status, to)) return { ok: false, code: 'STATE', status: mt.status };
  if (to === 'apostas_abertas' && Date.parse(mt.startsAt) <= now) return { ok: false, code: 'PAST_DATE' };
  const prev = mt.status; mt.status = to; syncMatch(d, mt, actor, motivo.trim(), now);
  audit(d, actor, 'estado_confronto', id, { status: prev }, { status: to, motivo: motivo.trim() }, now);
  return { ok: true };
}
function limitFor(s: V3State, scope: V3Limit['scope'], ref: string | null | undefined) { return ref == null ? undefined : s.limits.find((l) => l.active && l.scope === scope && l.ref === ref); }
function exposureOfMarkets(d: V2DB, ids: string[], extra?: { marketId: string; selectionId: string; stake: number; potential: number }) {
  return [...new Set(ids)].reduce((acc, mid) => acc + marketExposureOf(d.selections.filter((s) => s.marketId === mid), d.bets.filter((b) => b.marketId === mid), extra && extra.marketId === mid ? extra : undefined), 0);
}
function scopeMarkets(d: V2DB, scope: V3Limit['scope'], m: V2Market, mt: V3Match | undefined, plus: boolean): string[] {
  const s = v3(d);
  if (scope === 'market') return [m.id];
  if (scope === 'match') return mt ? matchMarkets(d, mt.id).map((x) => x.id) : [];
  if (scope === 'event') return mt?.tournamentRef ? s.matches.filter((x) => x.tournamentRef === mt.tournamentRef).map((x) => x.marketId) : [];
  return [...d.bets.filter((b) => isOpenBet(b.status)).map((b) => b.marketId), ...(plus ? [m.id] : [])];
}
function autoSuspend(d: V2DB, m: V2Market, scope: string, limit: number, exposure: number, now: number) {
  if (m.status !== 'aberto') return;
  m.status = 'suspenso';
  audit(d, 'sistema', 'auto_suspender_limite', m.id, { status: 'aberto' }, { status: 'suspenso', scope, limit, exposure, motivo: 'Limite de exposição atingido' }, now);
}
/** Confirmar aposta: mesma ordem de verificações do apv2_bet_confirm. */
export function confirmV3(d: V2DB, user: string, selId: string, stake: number, seenOdds: number, now: number, requestId: string | null | undefined): V2Res {
  const s3 = v3(d);
  if (!d.enabled) return { ok: false, code: 'DISABLED' };
  if (!requestId) return { ok: false, code: 'REQUEST_ID' };
  const prev = d.bets.find((b) => b.userId === user && b.requestId === requestId);
  if (prev) {
    if (prev.selectionId !== selId || prev.stake !== stake) return { ok: false, code: 'REQUEST_REUSED' };
    return { ok: true, bet: prev.id, odds: prev.oddsLocked, potential: prev.potential, status: prev.status, balance: balanceV2(d, user), replay: true };
  }
  const acc = s3.accounts[user] ?? {};
  if (acc.block) return { ok: false, code: acc.block };
  const sc = validateStakeV2(stake, d.limits, Infinity); if (sc) return { ok: false, code: sc };
  const sel = d.selections.find((x) => x.id === selId); if (!sel) return { ok: false, code: 'NOT_FOUND' };
  const m = d.markets.find((x) => x.id === sel.marketId)!;
  const mt = m.matchId ? s3.matches.find((x) => x.id === m.matchId) : undefined;
  if (m.status === 'suspenso' || mt?.status === 'suspenso') return { ok: false, code: 'SUSPENDED' };
  if (m.status !== 'aberto' || (m.closesAt && Date.parse(m.closesAt) <= now) || sel.result !== 'pendente' || (mt && (mt.status !== 'apostas_abertas' || Date.parse(mt.startsAt) <= now))) return { ok: false, code: 'CLOSED' };
  if (round2(seenOdds) !== sel.odds) return { ok: false, code: 'ODDS_CHANGED', odds: sel.odds, odds_version: sel.oddsVersion };
  if (balanceV2(d, user) < stake) return { ok: false, code: 'BALANCE', balance: balanceV2(d, user) };
  const pot = potentialV2(stake, sel.odds);
  // limites
  const maxStakes = s3.limits.filter((l) => l.active && l.maxStake != null && ((l.scope === 'user' && (l.ref === user || l.ref === '')) || (l.scope === 'market' && l.ref === m.id) || (mt && l.scope === 'match' && l.ref === mt.id) || (mt?.tournamentRef && l.scope === 'event' && l.ref === mt.tournamentRef))).map((l) => l.maxStake!);
  if (acc.selfMaxStake != null) maxStakes.push(acc.selfMaxStake);
  if (maxStakes.length && stake > Math.min(...maxStakes)) return { ok: false, code: 'LIMIT_STAKE', max: Math.min(...maxStakes) };
  const ul = s3.limits.find((l) => l.active && l.scope === 'user' && l.ref === user && l.maxExposure != null) ?? s3.limits.find((l) => l.active && l.scope === 'user' && l.ref === '' && l.maxExposure != null);
  if (ul && d.bets.filter((b) => b.userId === user && isOpenBet(b.status)).reduce((a, b) => a + b.stake, 0) + stake > ul.maxExposure!) return { ok: false, code: 'LIMIT_USER', max: ul.maxExposure };
  const extra = { marketId: m.id, selectionId: sel.id, stake, potential: pot };
  for (const scope of ['market', 'match', 'event', 'global_exposure'] as const) {
    const ref = scope === 'market' ? m.id : scope === 'match' ? mt?.id : scope === 'event' ? mt?.tournamentRef : '';
    const l = limitFor(s3, scope, ref); if (!l || l.maxExposure == null) continue;
    const nxt = exposureOfMarkets(d, scopeMarkets(d, scope, m, mt, true), extra);
    if (nxt > l.maxExposure) {
      const cur = exposureOfMarkets(d, scopeMarkets(d, scope, m, mt, false));
      if (l.autoSuspend && cur >= l.maxExposure) autoSuspend(d, m, scope, l.maxExposure, cur, now);
      return { ok: false, code: 'LIMIT_EXPOSURE', scope, max: l.maxExposure, exposure: cur };
    }
  }
  const b: V2Bet = { id: nid(d, 'b'), userId: user, marketId: m.id, selectionId: sel.id, stake, oddsLocked: sel.odds, oddsVersionLocked: sel.oddsVersion, potential: pot, status: 'pendente_confirmacao', payout: 0, requestId, createdAt: iso(now), settledAt: null, matchId: mt?.id ?? null, selectionLabel: sel.label, confirmedAt: null, officialResult: null, settledAmount: null };
  s3.events.push({ id: d.seq++, betId: b.id, userId: user, from: null, to: 'pendente_confirmacao', amount: stake, note: 'Pedido recebido', actor: user, at: iso(now) });
  const bal = postV2(d, user, -stake, 'aposta', b.id);
  d.bets.unshift(b);
  moveBet(d, b, 'confirmada', `Valor debitado; multiplicador ${sel.odds} congelado`, user, now); b.confirmedAt = iso(now);
  for (const scope of ['market', 'match', 'event', 'global_exposure'] as const) {
    const ref = scope === 'market' ? m.id : scope === 'match' ? mt?.id : scope === 'event' ? mt?.tournamentRef : '';
    const l = limitFor(s3, scope, ref); if (!l || l.maxExposure == null || !l.autoSuspend) continue;
    const e = exposureOfMarkets(d, scopeMarkets(d, scope, m, mt, false));
    if (e >= l.maxExposure) autoSuspend(d, m, scope, l.maxExposure, e, now);
  }
  return { ok: true, bet: b.id, odds: b.oddsLocked, potential: pot, status: 'confirmada', balance: bal };
}
export function proposeResultV3(d: V2DB, actor: string, matchId: string, winner: string, scoreA: number | null, scoreB: number | null, motivo: string, now: number, requestId?: string): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  const s3 = v3(d);
  if (requestId) { const p = s3.results.find((r) => r.proposedBy === actor && r.requestId === requestId); if (p) return { ok: true, id: p.id, replay: true }; }
  if (!motivoOk(motivo)) return { ok: false, code: 'MOTIVO' };
  if (!['a', 'b', 'empate'].includes(winner) || (scoreA ?? 0) < 0 || (scoreB ?? 0) < 0) return { ok: false, code: 'INVALID_RESULT' };
  const mt = s3.matches.find((x) => x.id === matchId); if (!mt) return { ok: false, code: 'NOT_FOUND' };
  if (mt.status !== 'em_andamento' && mt.status !== 'aguarda_resultado') return { ok: false, code: 'STATE', status: mt.status };
  if (winner === 'empate' && !d.selections.some((s) => s.marketId === mt.marketId && s.side === 'empate')) return { ok: false, code: 'INVALID_RESULT' };
  if (scoreA != null && scoreB != null && ((winner === 'a' && scoreA <= scoreB) || (winner === 'b' && scoreB <= scoreA) || (winner === 'empate' && scoreA !== scoreB))) return { ok: false, code: 'INVALID_RESULT' };
  if (s3.results.some((r) => r.matchId === matchId && r.status === 'proposto')) return { ok: false, code: 'RESULT_PENDING' };
  const r: V3ResultRow = { id: nid(d, 'r'), matchId, winner: winner as V3ResultRow['winner'], scoreA, scoreB, motivo: motivo.trim(), proposedBy: actor, requestId, status: 'proposto', reviewedBy: null, reviewMotivo: '', at: iso(now) };
  s3.results.unshift(r);
  const prev = mt.status; mt.status = 'resultado_em_analise'; syncMatch(d, mt, actor, 'Resultado proposto, à espera de revisão', now);
  audit(d, actor, 'propor_resultado', matchId, { status: prev }, { result: r.id, winner, motivo: r.motivo }, now);
  return { ok: true, id: r.id };
}
export function reviewResultV3(d: V2DB, actor: string, resultId: string, approve: boolean, motivo: string, now: number): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  if (!motivoOk(motivo)) return { ok: false, code: 'MOTIVO' };
  const s3 = v3(d);
  const r = s3.results.find((x) => x.id === resultId); if (!r) return { ok: false, code: 'NOT_FOUND' };
  if (r.status !== 'proposto') return (r.status === 'aprovado') === approve ? { ok: true, already: true, status: r.status } : { ok: false, code: 'STATE', status: r.status };
  if (r.proposedBy === actor) return { ok: false, code: 'SAME_REVIEWER' };
  const mt = s3.matches.find((x) => x.id === r.matchId)!;
  r.reviewedBy = actor; r.reviewMotivo = motivo.trim();
  if (!approve) {
    r.status = 'rejeitado'; mt.status = 'aguarda_resultado'; syncMatch(d, mt, actor, `Resultado rejeitado na revisão: ${motivo.trim()}`, now);
    audit(d, actor, 'rejeitar_resultado', mt.id, { result: r.id }, { motivo: motivo.trim() }, now);
    return { ok: true, status: 'rejeitado' };
  }
  r.status = 'aprovado'; mt.status = 'finalizado'; mt.result = r.winner; mt.scoreA = r.scoreA; mt.scoreB = r.scoreB;
  const label = `${r.winner === 'a' ? mt.teamA : r.winner === 'b' ? mt.teamB : 'Empate'}${r.scoreA != null && r.scoreB != null ? ` (${r.scoreA}-${r.scoreB})` : ''}`;
  for (const s of d.selections.filter((x) => x.marketId === mt.marketId && x.result === 'pendente')) s.result = s.side === r.winner ? 'ganha' : 'perdida';
  let n = 0;
  for (const b of d.bets.filter((x) => x.matchId === mt.id && isOpenBet(x.status))) {
    const side = d.selections.find((s) => s.id === b.selectionId)?.side;
    settleInner(d, actor, b.id, side === r.winner ? 'ganha' : 'perdida', now, label, 'Resultado oficial validado'); n++;
  }
  for (const m of matchMarkets(d, mt.id)) if (m.status !== 'anulado') m.status = 'liquidado';
  audit(d, actor, 'aprovar_resultado', mt.id, { result: r.id, proposed_by: r.proposedBy }, { winner: r.winner, bets: n, motivo: motivo.trim() }, now);
  return { ok: true, status: 'aprovado', bets: n };
}
export function cancelMatchV3(d: V2DB, actor: string, matchId: string, motivo: string, now: number): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  if (!motivoOk(motivo)) return { ok: false, code: 'MOTIVO' };
  const s3 = v3(d);
  const mt = s3.matches.find((x) => x.id === matchId); if (!mt) return { ok: false, code: 'NOT_FOUND' };
  if (mt.status === 'cancelado') return { ok: true, already: true };
  if (mt.status === 'finalizado') return { ok: false, code: 'STATE' };
  const prev = mt.status; mt.status = 'cancelado'; mt.result = 'cancelado';
  for (const r of s3.results.filter((x) => x.matchId === matchId && x.status === 'proposto')) { r.status = 'rejeitado'; r.reviewMotivo = `Confronto cancelado: ${motivo.trim()}`; }
  let n = 0;
  for (const b of d.bets.filter((x) => x.matchId === matchId && isOpenBet(x.status))) { settleInner(d, actor, b.id, 'reembolsada', now, 'cancelado', `Confronto cancelado: ${motivo.trim()}`); n++; }
  for (const s of d.selections.filter((x) => x.marketId === mt.marketId && x.result === 'pendente')) s.result = 'anulada';
  for (const m of matchMarkets(d, matchId)) if (m.status !== 'liquidado') m.status = 'anulado';
  audit(d, actor, 'cancelar_confronto', matchId, { status: prev }, { status: 'cancelado', refunds: n, motivo: motivo.trim() }, now);
  return { ok: true, already: false, refunds: n };
}
export function refundBetV3(d: V2DB, actor: string, betId: string, motivo: string, now: number): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  if (!motivoOk(motivo)) return { ok: false, code: 'MOTIVO' };
  return settleInner(d, actor, betId, 'reembolsada', now, null, `Reembolso: ${motivo.trim()}`);
}
export function setLimitV3(d: V2DB, actor: string, l: V3Limit, motivo: string, now: number): V2Res {
  if (!hasPerm(d, actor, 'toggle')) return { ok: false, code: 'FORBIDDEN' };
  if (!motivoOk(motivo)) return { ok: false, code: 'MOTIVO' };
  const ref = (l.ref ?? '').trim();
  if ((l.scope === 'global_exposure' && ref) || (['match', 'market', 'event'].includes(l.scope) && !ref) || (l.maxStake != null && l.maxStake < 1) || (l.maxExposure != null && l.maxExposure < 0)) return { ok: false, code: 'INVALID' };
  const s3 = v3(d);
  const i = s3.limits.findIndex((x) => x.scope === l.scope && x.ref === ref);
  const row = { ...l, ref };
  audit(d, actor, 'limite', `${l.scope}:${ref}`, i >= 0 ? s3.limits[i] : null, { ...row, motivo: motivo.trim() }, now);
  if (i >= 0) s3.limits[i] = row; else s3.limits.push(row);
  return { ok: true };
}
export function setChipsV3(d: V2DB, actor: string, values: number[], now: number): V2Res {
  if (!hasPerm(d, actor, 'toggle')) return { ok: false, code: 'FORBIDDEN' };
  if (!Array.isArray(values) || values.length < 1 || values.length > 8 || values.some((v, i) => !Number.isInteger(v) || v <= 0 || v > 1e6 || (i > 0 && v <= values[i - 1]))) return { ok: false, code: 'INVALID' };
  const s3 = v3(d);
  audit(d, actor, 'definicao:apostas_stake_chips', 'apostas_stake_chips', { value: s3.chips }, { value: values }, now);
  s3.chips = [...values];
  return { ok: true, value: values };
}
export function openComplaintV3(d: V2DB, user: string, betId: string | null, matchId: string | null, message: string, now: number): V2Res {
  const s3 = v3(d);
  const msg = message.trim();
  if (msg.length < 5 || msg.length > 1000) return { ok: false, code: 'INVALID' };
  let mid = matchId;
  if (betId) { const b = d.bets.find((x) => x.id === betId && x.userId === user); if (!b) return { ok: false, code: 'NOT_FOUND' }; mid = b.matchId ?? matchId; }
  if (s3.complaints.filter((c) => c.userId === user && (c.status === 'aberta' || c.status === 'em_analise')).length >= 5) return { ok: false, code: 'TOO_MANY' };
  const c: V3Complaint = { id: nid(d, 'c'), userId: user, betId, matchId: mid, message: msg, status: 'aberta', response: '', at: iso(now) };
  s3.complaints.unshift(c);
  return { ok: true, id: c.id };
}
export function updateComplaintV3(d: V2DB, actor: string, id: string, status: 'em_analise' | 'resolvida' | 'rejeitada', response: string, now: number): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  if (!['em_analise', 'resolvida', 'rejeitada'].includes(status) || (status !== 'em_analise' && !motivoOk(response))) return { ok: false, code: 'INVALID' };
  const c = v3(d).complaints.find((x) => x.id === id); if (!c) return { ok: false, code: 'NOT_FOUND' };
  if (c.status === 'resolvida' || c.status === 'rejeitada') return { ok: false, code: 'STATE' };
  audit(d, actor, 'reclamacao', id, { status: c.status }, { status, motivo: response }, now);
  c.status = status; c.response = response.trim();
  return { ok: true };
}
export function tickV3(d: V2DB, now: number): number {
  let n = 0;
  for (const mt of v3(d).matches) if (mt.status === 'apostas_abertas' && Date.parse(mt.startsAt) <= now) {
    mt.status = 'em_andamento'; syncMatch(d, mt, 'sistema', 'Início do confronto (automático)', now); n++;
  }
  return n;
}
export interface V3Wallet { available: number; reserved: number; pending: number; wonTotal: number; netWon: number; refundedTotal: number }
export function walletV3(d: V2DB, user: string): V3Wallet {
  const mine = d.bets.filter((b) => b.userId === user);
  const open = mine.filter((b) => isOpenBet(b.status));
  const won = mine.filter((b) => b.status === 'ganha');
  return {
    available: balanceV2(d, user), reserved: open.reduce((a, b) => a + b.stake, 0), pending: open.length,
    wonTotal: won.reduce((a, b) => a + b.payout, 0), netWon: won.reduce((a, b) => a + b.payout - b.stake, 0),
    refundedTotal: mine.filter((b) => b.status === 'reembolsada' || b.status === 'anulada').reduce((a, b) => a + b.payout, 0),
  };
}
export function marketExposureV3(d: V2DB, marketId: string): number {
  return marketExposureOf(d.selections.filter((s) => s.marketId === marketId), d.bets.filter((b) => b.marketId === marketId));
}
