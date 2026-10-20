// Apostas v2 — regras puras (sem rede). A fonte de verdade em produção é o Postgres
// (supabase/migrations/2026-10-20-apostas-v2.sql); este ficheiro espelha as mesmas regras para o modo demo,
// a pré-visualização do boletim e os testes (tests/apostas-v2.test.mjs).
// SALDO DE TESTE APENAS: sem valor monetário, não se compra nem se levanta. Dinheiro real fica desligado.

export type V2Result = 'ganha' | 'perdida' | 'anulada' | 'reembolsada';
export type V2BetStatus = 'aberta' | V2Result;
export type V2MarketStatus = 'aberto' | 'suspenso' | 'fechado' | 'liquidado' | 'anulado';
export type V2Perm = 'markets' | 'odds' | 'settle' | 'toggle' | 'permissions';
export const V2_PERMS: V2Perm[] = ['markets', 'odds', 'settle', 'toggle', 'permissions'];
export const V2_PERM_NAMES: Record<V2Perm, string> = {
  markets: 'Criar e gerir mercados', odds: 'Definir odds', settle: 'Liquidar apostas', toggle: 'Ligar/desligar apostas', permissions: 'Gerir permissões',
};
export const V2_RESULT_NAMES: Record<V2BetStatus, string> = { aberta: 'Aberta', ganha: 'Ganha', perdida: 'Perdida', anulada: 'Anulada', reembolsada: 'Reembolsada' };
export const V2_CURRENCY = 'Saldo de teste';
export const V2_BANNER = 'Apostas com saldo de teste — sem dinheiro real. Não se compra, não se levanta.';

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
export interface V2Selection { id: string; marketId: string; label: string; odds: number; oddsVersion: number; result: 'pendente' | V2Result }
export interface V2Market { id: string; title: string; game: string; status: V2MarketStatus; closesAt: string | null; createdAt: string }
export interface V2Bet { id: string; userId: string; marketId: string; selectionId: string; stake: number; oddsLocked: number; oddsVersionLocked: number; potential: number; status: V2BetStatus; payout: number; requestId?: string; createdAt: string; settledAt: string | null }
export interface V2Ledger { userId: string; delta: number; reason: string; ref: string; balanceAfter: number }
export interface V2Audit { id: number; at: string; actor: string; action: string; target: string; before: unknown; after: unknown }
export interface V2DB {
  enabled: boolean; limits: V2Limits; markets: V2Market[]; selections: V2Selection[]; bets: V2Bet[]; ledger: V2Ledger[];
  perms: Record<string, V2Perm[]>; roles: Record<string, 'admin' | 'moderator' | 'creator' | 'user'>; audit: V2Audit[]; seq: number;
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
function settleInner(d: V2DB, actor: string, betId: string, result: string, now: number): V2Res {
  const r = normResult(result); if (!r) return { ok: false, code: 'INVALID' };
  const b = d.bets.find((x) => x.id === betId); if (!b) return { ok: false, code: 'NOT_FOUND' };
  if (b.status !== 'aberta') return b.status === r ? { ok: true, already: true, status: b.status, payout: b.payout } : { ok: false, code: 'ALREADY_SETTLED', status: b.status };
  const pay = payoutFor(r, b.stake, b.potential);
  if (pay > 0) postV2(d, b.userId, pay, 'liquidacao', b.id);
  b.status = r; b.payout = pay; b.settledAt = iso(now);
  audit(d, actor, 'liquidar_aposta', b.id, { status: 'aberta' }, { status: r, payout: pay, user: b.userId }, now);
  return { ok: true, already: false, status: r, payout: pay };
}
export function settleBetV2(d: V2DB, actor: string, betId: string, result: string, now: number): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  return settleInner(d, actor, betId, result, now);
}
export function settleMarketV2(d: V2DB, actor: string, marketId: string, winner: string | null, now: number): V2Res {
  if (!hasPerm(d, actor, 'settle')) return { ok: false, code: 'FORBIDDEN' };
  const m = d.markets.find((x) => x.id === marketId); if (!m) return { ok: false, code: 'NOT_FOUND' };
  if (m.status === 'liquidado' || m.status === 'anulado') return { ok: true, already: true, status: m.status };
  const sels = d.selections.filter((s) => s.marketId === marketId);
  if (winner && !sels.some((s) => s.id === winner)) return { ok: false, code: 'INVALID' };
  for (const s of sels) if (s.result === 'pendente') s.result = winner == null ? 'anulada' : s.id === winner ? 'ganha' : 'perdida';
  let n = 0;
  for (const b of d.bets.filter((x) => x.marketId === marketId && x.status === 'aberta')) { settleInner(d, actor, b.id, sels.find((s) => s.id === b.selectionId)!.result, now); n++; }
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
