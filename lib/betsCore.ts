// Apostas TXAPILOG — "sistema operativo" em memória: mesmas regras das funções SQL (bets_sweep, bets_place,
// liquidação, anulação, correções). Usado no modo demo (localStorage) e nos testes. Em produção quem decide é o
// Postgres (supabase/migrations/2026-10-10-bets.sql); este ficheiro espelha-o regra a regra. Sem IA.

import type { BetGame, BetSettings, BetStatus, Currency, Kyc, KycInput, KycStatus, MarketKind, MarketStatus, MatchStatus, PersonalLimits, SelResult, SlipError } from './bets.ts';
import {
  DEFAULT_SETTINGS, ELO_START, cfgFor, limitsFor, realMoneyUnlockable, validateKyc, NO_LIMITS, POSTPONE_VOID_HOURS, comboOdds, eloDelta, evalBet, isoWeekRef, maputoDayStart, maputoWeekStart, marketTitle,
  matchMarkets, outrightProbs, potentialReturn, priceOdds, round2, selectionResult, validateSlip,
} from './bets.ts';

export interface Team { id: string; game: BetGame; name: string; rating: number; played: number; logo?: string }
export interface Match {
  id: string; game: BetGame; tournamentId: string | null; tournamentName: string; home: string; away: string;
  homeTeamId: string; awayTeamId: string; startsAt: string; originalStartsAt: string; status: MatchStatus;
  homeScore: number | null; awayScore: number | null; settledVersion: number; eloHome: number; eloAway: number; eloApplied: boolean; voided: boolean;
  example?: boolean;
}
export interface Market {
  id: string; matchId: string | null; tournamentId: string | null; game: BetGame; kind: MarketKind; line: number | null; title: string;
  status: MarketStatus; autoSuspended: boolean; manualVoid?: boolean; margin: number | null; closesAt: string | null; tournamentName?: string;
}
export interface Selection { id: string; marketId: string; code: string; label: string; prob: number; odds: number; manual: boolean; result: SelResult; sort: number }
export interface Bet {
  id: string; userId: string; userName?: string; kind: 'simples' | 'multipla'; stake: number; totalOdds: number; potential: number;
  status: BetStatus; payout: number; version: number; createdAt: string; settledAt: string | null; currency?: Currency;
}
export interface Leg { betId: string; selectionId: string; marketId: string; groupId: string; odds: number; result: SelResult }
export interface LedgerRow { id: number; userId: string; delta: number; reason: string; ref: string; balanceAfter: number; createdAt: string; currency?: Currency }
export interface Withdrawal { id: string; userId: string; amount: number; method: 'M-Pesa' | 'e-Mola'; phone: string; status: 'pendente' | 'pago' | 'recusado'; reference: string; note: string; createdAt: string; decidedAt: string | null }
export interface LogRow { id: number; at: string; actor: string; action: string; target: string; details: string }
export interface DB {
  settings: BetSettings; teams: Team[]; matches: Match[]; markets: Market[]; selections: Selection[]; bets: Bet[]; legs: Leg[];
  ledger: LedgerRow[]; limits: Record<string, PersonalLimits>; log: LogRow[]; seq: number; paymentsEnabled: boolean;
  /** carteira em MT — livro-razão separado dos TXAP Pontos */
  money: LedgerRow[]; kyc: Record<string, Kyc>; withdrawals: Withdrawal[];
}

export function emptyDB(): DB {
  return { settings: { ...DEFAULT_SETTINGS }, teams: [], matches: [], markets: [], selections: [], bets: [], legs: [], ledger: [], limits: {}, log: [], seq: 1, paymentsEnabled: false, money: [], kyc: {}, withdrawals: [] };
}

const nid = (db: DB, p: string) => `${p}${db.seq++}`;
const iso = (ms: number) => new Date(ms).toISOString();

export function logAdmin(db: DB, actor: string, action: string, target: string, details: unknown, now: number) {
  db.log.unshift({ id: db.seq++, at: iso(now), actor, action, target, details: typeof details === 'string' ? details : JSON.stringify(details) });
}

/* ---------------- Carteira (livro-razão só de acréscimos) ---------------- */
const book = (db: DB, cur: Currency) => (cur === 'mt' ? (db.money ??= []) : db.ledger);
export function balanceOf(db: DB, user: string, cur: Currency = 'pontos'): number {
  const L = book(db, cur);
  for (let i = L.length - 1; i >= 0; i--) if (L[i].userId === user) return L[i].balanceAfter;
  return 0;
}
/** Lançamento idempotente: (utilizador, motivo, ref) só entra uma vez. Saldo nunca negativo, exceto correções do admin. */
export function post(db: DB, user: string, delta: number, reason: string, ref: string, now: number, cur: Currency = 'pontos'): number {
  const L = book(db, cur);
  if (L.some((r) => r.userId === user && r.reason === reason && r.ref === ref)) return balanceOf(db, user, cur);
  const after = balanceOf(db, user, cur) + delta;
  if (after < 0 && reason !== 'correcao') throw new Error('BALANCE');
  L.push({ id: db.seq++, userId: user, delta, reason, ref, balanceAfter: after, createdAt: iso(now), currency: cur });
  return after;
}
/** Verificação: saldo derivado = soma dos movimentos. */
export function ledgerConsistent(db: DB, user: string, cur: Currency = 'pontos'): boolean {
  let s = 0;
  for (const r of book(db, cur)) if (r.userId === user) { s += r.delta; if (s !== r.balanceAfter) return false; }
  return true;
}
export function claimWeekly(db: DB, user: string, now: number): { credited: boolean; balance: number } {
  const ref = isoWeekRef(now);
  const had = db.ledger.some((r) => r.userId === user && r.reason === 'semanal' && r.ref === ref);
  const balance = had ? balanceOf(db, user) : post(db, user, db.settings.weeklyAllowance, 'semanal', ref, now);
  return { credited: !had, balance };
}

/* ---------------- Equipas, jogos e mercados ---------------- */
function teamFor(db: DB, game: BetGame, name: string): Team {
  const n = name.trim();
  let t = db.teams.find((x) => x.game === game && x.name.toLowerCase() === n.toLowerCase());
  if (!t) { t = { id: nid(db, 't'), game, name: n, rating: ELO_START, played: 0 }; db.teams.push(t); }
  return t;
}
const rating = (db: DB, id: string) => db.teams.find((t) => t.id === id)?.rating ?? ELO_START;
const marginOf = (db: DB, m: Market) => (m.margin ?? db.settings.margin);

export function ensureMarkets(db: DB, matchId: string) {
  const mt = db.matches.find((m) => m.id === matchId);
  if (!mt) return;
  const specs = matchMarkets(mt.game, mt.home, mt.away, rating(db, mt.homeTeamId), rating(db, mt.awayTeamId));
  for (const sp of specs) {
    if (db.markets.some((m) => m.matchId === matchId && m.kind === sp.kind)) continue;
    const mk: Market = { id: nid(db, 'm'), matchId, tournamentId: mt.tournamentId, game: mt.game, kind: sp.kind, line: sp.line, title: sp.title, status: 'aberto', autoSuspended: false, margin: null, closesAt: mt.startsAt };
    db.markets.push(mk);
    sp.selections.forEach((s, i) => db.selections.push({ id: nid(db, 's'), marketId: mk.id, code: s.code, label: s.label, prob: s.prob, odds: priceOdds(s.prob, db.settings.margin), manual: false, result: 'pendente', sort: i }));
  }
  if (mt.tournamentId) ensureOutright(db, mt.tournamentId, mt.game, mt.tournamentName);
}

/** Recalcula odds (não manuais) dos mercados abertos/suspensos de um jogo. */
export function priceMatch(db: DB, matchId: string) {
  const mt = db.matches.find((m) => m.id === matchId);
  if (!mt) return;
  const specs = matchMarkets(mt.game, mt.home, mt.away, rating(db, mt.homeTeamId), rating(db, mt.awayTeamId));
  for (const mk of db.markets.filter((m) => m.matchId === matchId && (m.status === 'aberto' || m.status === 'suspenso'))) {
    const sp = specs.find((x) => x.kind === mk.kind);
    if (!sp) continue;
    for (const s of db.selections.filter((x) => x.marketId === mk.id)) {
      const p = sp.selections.find((x) => x.code === s.code)?.prob ?? 0;
      s.prob = p;
      if (!s.manual) s.odds = priceOdds(p, marginOf(db, mk));
    }
  }
}

function tournamentTeams(db: DB, tId: string): Team[] {
  const ids = new Set<string>();
  for (const m of db.matches) if (m.tournamentId === tId && !m.voided) { ids.add(m.homeTeamId); ids.add(m.awayTeamId); }
  return db.teams.filter((t) => ids.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));
}
function tournamentClose(db: DB, tId: string): string | null {
  const st = db.matches.filter((m) => m.tournamentId === tId && !m.voided).map((m) => m.startsAt).sort();
  return st[0] ?? null;
}

export function ensureOutright(db: DB, tId: string, game: BetGame, tName: string) {
  let mk = db.markets.find((m) => m.kind === 'outright' && m.tournamentId === tId);
  const teams = tournamentTeams(db, tId);
  if (teams.length < 2) return;
  if (!mk) {
    mk = { id: nid(db, 'm'), matchId: null, tournamentId: tId, game, kind: 'outright', line: null, title: marketTitle('outright', game, null), status: 'aberto', autoSuspended: false, margin: null, closesAt: tournamentClose(db, tId), tournamentName: tName };
    db.markets.push(mk);
  }
  if (mk.status !== 'aberto' && mk.status !== 'suspenso') return;
  mk.closesAt = tournamentClose(db, tId);
  const have = new Set(db.selections.filter((s) => s.marketId === mk!.id).map((s) => s.code));
  for (const t of teams) if (!have.has(t.name)) db.selections.push({ id: nid(db, 's'), marketId: mk.id, code: t.name, label: t.name, prob: 0, odds: 0, manual: false, result: 'pendente', sort: 0 });
  priceOutright(db, tId);
}
export function priceOutright(db: DB, tId: string) {
  const mk = db.markets.find((m) => m.kind === 'outright' && m.tournamentId === tId);
  if (!mk || (mk.status !== 'aberto' && mk.status !== 'suspenso')) return;
  const probs = outrightProbs(tournamentTeams(db, tId).map((t) => ({ name: t.name, rating: t.rating })));
  const sels = db.selections.filter((s) => s.marketId === mk.id);
  sels.sort((a, b) => a.label.localeCompare(b.label)).forEach((s, i) => {
    const p = probs.find((x) => x.code === s.code)?.prob ?? 0;
    s.prob = p; s.sort = i;
    if (!s.manual) s.odds = priceOdds(p, marginOf(db, mk));
  });
}

export interface MatchInput { game: BetGame; home: string; away: string; startsAt: string; tournamentId?: string | null; tournamentName?: string; example?: boolean }
/** Agendar um jogo abre os mercados automaticamente. */
export function createMatch(db: DB, inp: MatchInput, actor: string, now: number): Match {
  if (!inp.home.trim() || !inp.away.trim() || inp.home.trim().toLowerCase() === inp.away.trim().toLowerCase()) throw new Error('TEAMS');
  if (isNaN(Date.parse(inp.startsAt))) throw new Error('DATE');
  const h = teamFor(db, inp.game, inp.home), a = teamFor(db, inp.game, inp.away);
  const st = iso(Date.parse(inp.startsAt));
  const m: Match = {
    id: nid(db, 'j'), game: inp.game, tournamentId: inp.tournamentId || null, tournamentName: inp.tournamentName || '', home: h.name, away: a.name,
    homeTeamId: h.id, awayTeamId: a.id, startsAt: st, originalStartsAt: st, status: 'agendado', homeScore: null, awayScore: null,
    settledVersion: 0, eloHome: 0, eloAway: 0, eloApplied: false, voided: false, example: inp.example,
  };
  db.matches.push(m);
  ensureMarkets(db, m.id);
  if (Date.parse(st) <= now) sweep(db, now);
  if (actor) logAdmin(db, actor, 'jogo_criado', m.id, { jogo: `${m.home} vs ${m.away}`, inicio: st }, now);
  return m;
}

/* ---------------- Automação ---------------- */
/** Idempotente: abre, suspende, reabre e anula conforme o relógio. Igual a bets_sweep() no Postgres. */
export function sweep(db: DB, now: number): { suspended: number; reopened: number; voided: number } {
  let suspended = 0, reopened = 0, voided = 0;
  for (const mt of db.matches) {
    if (mt.voided) continue;
    const start = Date.parse(mt.startsAt);
    const graceOver = now > Date.parse(mt.originalStartsAt) + POSTPONE_VOID_HOURS * 3600e3;
    const pushedTooFar = start > Date.parse(mt.originalStartsAt) + POSTPONE_VOID_HOURS * 3600e3;
    if (mt.status === 'cancelado' || (mt.status === 'adiado' && (graceOver || pushedTooFar))) {
      applyMatchOutcome(db, mt.id, 'void', null, null, now); voided++; continue;
    }
    if (mt.status === 'agendado' && start <= now) mt.status = 'ao_vivo';
    if (mt.status === 'agendado') ensureMarkets(db, mt.id);
    for (const mk of db.markets.filter((m) => m.matchId === mt.id)) {
      if (mk.status === 'aberto' && (start <= now || mt.status !== 'agendado')) { mk.status = 'suspenso'; mk.autoSuspended = true; suspended++; }
      else if (mk.status === 'suspenso' && mk.autoSuspended && mt.status === 'agendado' && start > now) { mk.status = 'aberto'; mk.autoSuspended = false; reopened++; }
      mk.closesAt = mt.startsAt;
    }
  }
  for (const mk of db.markets.filter((m) => m.kind === 'outright')) {
    if (mk.status === 'aberto' && mk.closesAt && Date.parse(mk.closesAt) <= now) { mk.status = 'suspenso'; mk.autoSuspended = true; suspended++; }
  }
  return { suspended, reopened, voided };
}

function betsTouching(db: DB, marketIds: Set<string>): Bet[] {
  const ids = new Set(db.legs.filter((l) => marketIds.has(l.marketId)).map((l) => l.betId));
  return db.bets.filter((b) => ids.has(b.id));
}

/** Liquidação idempotente de uma aposta (pagamento com ref única por versão). */
export function settleBet(db: DB, betId: string, now: number) {
  const b = db.bets.find((x) => x.id === betId);
  if (!b || b.status !== 'aberta') return;
  const legs = db.legs.filter((l) => l.betId === betId);
  for (const l of legs) l.result = db.selections.find((s) => s.id === l.selectionId)?.result ?? l.result;
  const cur: Currency = b.currency ?? 'pontos';
  const r = evalBet(legs, b.stake, cfgFor(db.settings, cur).maxPayout);
  if (r.status === 'aberta') return;
  b.status = r.status; b.payout = r.payout; b.settledAt = iso(now);
  if (r.payout > 0) post(db, b.userId, r.payout, r.status === 'anulada' ? 'reembolso' : 'ganho', `${b.id}:${b.version}`, now, cur);
}

/** Reverte apostas já liquidadas que tocam estes mercados (para correções). */
function reopenBets(db: DB, marketIds: Set<string>, now: number) {
  for (const b of betsTouching(db, marketIds)) {
    if (b.status === 'aberta') continue;
    if (b.payout > 0) post(db, b.userId, -b.payout, 'correcao', `${b.id}:${b.version}`, now, b.currency ?? 'pontos');
    b.version++; b.status = 'aberta'; b.payout = 0; b.settledAt = null;
  }
}

/** Resultado registado (ou anulação) → liquida tudo. Serve também para corrigir um resultado já liquidado. */
export function applyMatchOutcome(db: DB, matchId: string, mode: 'result' | 'void', h: number | null, a: number | null, now: number) {
  const mt = db.matches.find((m) => m.id === matchId);
  if (!mt) throw new Error('MATCH');
  const mks = db.markets.filter((m) => m.matchId === matchId);
  const ids = new Set(mks.map((m) => m.id));
  if (mt.settledVersion > 0) {
    reopenBets(db, ids, now);
    if (mt.eloApplied) {
      const th = db.teams.find((t) => t.id === mt.homeTeamId)!, ta = db.teams.find((t) => t.id === mt.awayTeamId)!;
      th.rating = round2(th.rating - mt.eloHome); ta.rating = round2(ta.rating - mt.eloAway); th.played--; ta.played--;
      mt.eloApplied = false; mt.eloHome = 0; mt.eloAway = 0;
    }
  }
  if (mode === 'void') {
    mt.voided = true; if (mt.status !== 'adiado') mt.status = 'cancelado';
    for (const mk of mks) { mk.status = 'anulado'; for (const s of db.selections.filter((x) => x.marketId === mk.id)) s.result = 'anulada'; }
  } else {
    if (h == null || a == null || h < 0 || a < 0 || !Number.isInteger(h) || !Number.isInteger(a)) throw new Error('SCORE');
    mt.homeScore = h; mt.awayScore = a; mt.status = 'terminado'; mt.voided = false;
    for (const mk of mks) {
      if (mk.manualVoid) continue; // mercado anulado à mão fica anulado
      mk.status = 'liquidado';
      for (const s of db.selections.filter((x) => x.marketId === mk.id)) s.result = selectionResult(mk.kind, s.code, mk.line, h, a);
    }
    const th = db.teams.find((t) => t.id === mt.homeTeamId)!, ta = db.teams.find((t) => t.id === mt.awayTeamId)!;
    const [dh, da] = eloDelta(th.rating, ta.rating, h > a ? 1 : h === a ? 0.5 : 0, db.settings.eloK);
    th.rating = round2(th.rating + dh); ta.rating = round2(ta.rating + da); th.played++; ta.played++;
    mt.eloHome = dh; mt.eloAway = da; mt.eloApplied = true;
    // Elo mudou → recalcula odds dos outros jogos abertos destas equipas e do vencedor do torneio
    for (const o of db.matches) if (o.id !== mt.id && !o.voided && o.status === 'agendado' && [o.homeTeamId, o.awayTeamId].some((x) => x === th.id || x === ta.id)) priceMatch(db, o.id);
  }
  mt.settledVersion++;
  if (mt.tournamentId) { ensureOutright(db, mt.tournamentId, mt.game, mt.tournamentName); priceOutright(db, mt.tournamentId); }
  for (const b of betsTouching(db, ids)) settleBet(db, b.id, now);
}

export function recordResult(db: DB, matchId: string, h: number, a: number, actor: string, now: number) {
  const mt = db.matches.find((m) => m.id === matchId);
  const correction = !!mt && mt.settledVersion > 0;
  applyMatchOutcome(db, matchId, 'result', h, a, now);
  logAdmin(db, actor, correction ? 'resultado_corrigido' : 'resultado_registado', matchId, { resultado: `${h}-${a}` }, now);
}
export function voidMatch(db: DB, matchId: string, actor: string, now: number, reason = 'anulado pelo admin') {
  applyMatchOutcome(db, matchId, 'void', null, null, now);
  logAdmin(db, actor, 'jogo_anulado', matchId, { motivo: reason }, now);
}
/** Reagendar: até 48 h depois da hora original o jogo continua (mercados reabrem); mais tarde → anulado e reembolsado. */
export function rescheduleMatch(db: DB, matchId: string, startsAt: string, actor: string, now: number) {
  const mt = db.matches.find((m) => m.id === matchId);
  if (!mt || mt.voided || mt.status === 'terminado') throw new Error('MATCH');
  const st = Date.parse(startsAt);
  if (isNaN(st)) throw new Error('DATE');
  mt.startsAt = iso(st);
  mt.status = st > Date.parse(mt.originalStartsAt) + POSTPONE_VOID_HOURS * 3600e3 ? 'adiado' : 'agendado';
  logAdmin(db, actor, 'jogo_reagendado', matchId, { inicio: mt.startsAt }, now);
  sweep(db, now);
  if (mt.tournamentId) { const mk = db.markets.find((m) => m.kind === 'outright' && m.tournamentId === mt.tournamentId); if (mk) mk.closesAt = tournamentClose(db, mt.tournamentId); }
}
export function postponeMatch(db: DB, matchId: string, actor: string, now: number) {
  const mt = db.matches.find((m) => m.id === matchId);
  if (!mt || mt.voided || mt.status === 'terminado') throw new Error('MATCH');
  mt.status = 'adiado';
  logAdmin(db, actor, 'jogo_adiado', matchId, {}, now);
  sweep(db, now);
}
export function cancelMatch(db: DB, matchId: string, actor: string, now: number) {
  const mt = db.matches.find((m) => m.id === matchId);
  if (!mt) throw new Error('MATCH');
  mt.status = 'cancelado';
  logAdmin(db, actor, 'jogo_cancelado', matchId, {}, now);
  sweep(db, now);
}

/* ---------------- Admin: mercados e odds ---------------- */
export function setMarketStatus(db: DB, marketId: string, status: 'aberto' | 'suspenso', actor: string, now: number) {
  const mk = db.markets.find((m) => m.id === marketId);
  if (!mk || (mk.status !== 'aberto' && mk.status !== 'suspenso')) throw new Error('MARKET');
  if (status === 'aberto' && mk.closesAt && Date.parse(mk.closesAt) <= now) throw new Error('STARTED');
  mk.status = status; mk.autoSuspended = false;
  logAdmin(db, actor, status === 'aberto' ? 'mercado_reaberto' : 'mercado_suspenso', marketId, { mercado: mk.title }, now);
}
export function overrideOdds(db: DB, selectionId: string, odds: number, actor: string, now: number) {
  const s = db.selections.find((x) => x.id === selectionId);
  if (!s) throw new Error('SEL');
  if (!(odds >= 1.01 && odds <= 1000)) throw new Error('ODDS');
  const old = s.odds;
  s.odds = round2(odds); s.manual = true;
  logAdmin(db, actor, 'odd_alterada', selectionId, { selecao: s.label, de: old, para: s.odds }, now);
}
export function resetOdds(db: DB, marketId: string, actor: string, now: number) {
  const mk = db.markets.find((m) => m.id === marketId);
  if (!mk) throw new Error('MARKET');
  for (const s of db.selections.filter((x) => x.marketId === marketId)) s.manual = false;
  if (mk.matchId) priceMatch(db, mk.matchId); else if (mk.tournamentId) priceOutright(db, mk.tournamentId);
  logAdmin(db, actor, 'odds_automaticas', marketId, { mercado: mk.title }, now);
}
export function setMarketMargin(db: DB, marketId: string, margin: number | null, actor: string, now: number) {
  const mk = db.markets.find((m) => m.id === marketId);
  if (!mk) throw new Error('MARKET');
  if (margin != null && !(margin >= 0 && margin <= 0.5)) throw new Error('MARGIN');
  mk.margin = margin;
  if (mk.matchId) priceMatch(db, mk.matchId); else if (mk.tournamentId) priceOutright(db, mk.tournamentId);
  logAdmin(db, actor, 'margem_mercado', marketId, { margem: margin }, now);
}
export function voidMarket(db: DB, marketId: string, actor: string, now: number) {
  const mk = db.markets.find((m) => m.id === marketId);
  if (!mk) throw new Error('MARKET');
  const ids = new Set([marketId]);
  reopenBets(db, ids, now);
  mk.status = 'anulado'; mk.manualVoid = true;
  for (const s of db.selections.filter((x) => x.marketId === marketId)) s.result = 'anulada';
  for (const b of betsTouching(db, ids)) settleBet(db, b.id, now);
  logAdmin(db, actor, 'mercado_anulado', marketId, { mercado: mk.title }, now);
}
export function settleOutright(db: DB, marketId: string, winnerSelectionId: string, actor: string, now: number) {
  const mk = db.markets.find((m) => m.id === marketId && m.kind === 'outright');
  if (!mk) throw new Error('MARKET');
  const ids = new Set([marketId]);
  reopenBets(db, ids, now);
  const sels = db.selections.filter((x) => x.marketId === marketId);
  if (!sels.some((s) => s.id === winnerSelectionId)) throw new Error('SEL');
  for (const s of sels) s.result = s.id === winnerSelectionId ? 'ganha' : 'perdida';
  mk.status = 'liquidado';
  for (const b of betsTouching(db, ids)) settleBet(db, b.id, now);
  logAdmin(db, actor, 'vencedor_torneio', marketId, { vencedor: sels.find((s) => s.id === winnerSelectionId)?.label }, now);
}
export function saveSettings(db: DB, patch: Partial<BetSettings>, actor: string, now: number) {
  const next = { ...db.settings, ...patch, realMoneyEnabled: db.settings.realMoneyEnabled, igjLicenceNo: db.settings.igjLicenceNo, igjLicenceDate: db.settings.igjLicenceDate, igjLicenceExpiry: db.settings.igjLicenceExpiry };
  if (!(next.margin >= 0 && next.margin <= 0.5)) throw new Error('MARGIN');
  if (!(next.minStake >= 1 && next.maxStake >= next.minStake && next.maxPayout >= next.maxStake)) throw new Error('LIMITS');
  if (!(next.maxLegs >= 1 && next.maxLegs <= 10)) throw new Error('LEGS');
  if (!(next.mtMinStake >= 1 && next.mtMaxStake >= next.mtMinStake && next.mtMaxPayout >= next.mtMaxStake && next.mtMinWithdraw >= 1 && next.mtMaxWithdrawDaily >= next.mtMinWithdraw)) throw new Error('LIMITS');
  const changedMargin = next.margin !== db.settings.margin;
  db.settings = next;
  if (changedMargin) {
    for (const m of db.matches) if (!m.voided && m.status === 'agendado') priceMatch(db, m.id);
    for (const t of new Set(db.markets.filter((m) => m.kind === 'outright' && m.tournamentId).map((m) => m.tournamentId!))) priceOutright(db, t);
  }
  logAdmin(db, actor, 'definicoes_apostas', 'bet_settings', patch, now);
}
/** Liga/desliga dinheiro real. Ligar exige licença IGJ (nº, emissão, validade futura) e confirmação explícita. Nunca inventa licença. */
export function setBetsEnabled(db: DB, on: boolean, actor: string, now: number) {
  db.settings.betsEnabled = on;
  logAdmin(db, actor, on ? 'apostas_ativadas' : 'apostas_desativadas', 'bet_settings', {}, now);
}
export function setTeamLogo(db: DB, teamId: string, url: string | null, actor: string, now: number) {
  const t = db.teams.find((x) => x.id === teamId);
  if (!t) throw new Error('NOT_FOUND');
  t.logo = url ?? undefined;
  logAdmin(db, actor, url ? 'logo_equipa' : 'logo_removido', teamId, { equipa: t.name }, now);
}

export function setRealMoney(db: DB, on: boolean, lic: { licenceNo: string; issue: string; expiry: string; confirm: string }, actor: string, now: number) {
  const today = new Date(now + 2 * 3600e3).toISOString().slice(0, 10);
  const cand = { igjLicenceNo: lic.licenceNo.trim(), igjLicenceDate: lic.issue, igjLicenceExpiry: lic.expiry };
  if (on) {
    const g = realMoneyUnlockable(cand, lic.confirm, today);
    if (!g.ok) { logAdmin(db, actor, 'dinheiro_real_recusado', 'bet_settings', { motivo: g.reason }, now); throw new Error('IGJ'); }
  }
  db.settings = { ...db.settings, ...cand, realMoneyEnabled: on };
  logAdmin(db, actor, on ? 'dinheiro_real_ligado' : 'dinheiro_real_desligado', 'bet_settings', { licenca: cand.igjLicenceNo, emissao: lic.issue, validade: lic.expiry }, now);
}
/** Dinheiro real disponível agora (ligado e licença dentro da validade). */
export function realMoneyActive(db: DB, now: number): boolean {
  const today = new Date(now + 2 * 3600e3).toISOString().slice(0, 10);
  return db.settings.realMoneyEnabled && !!db.settings.igjLicenceExpiry && db.settings.igjLicenceExpiry > today;
}

/* ---------------- Dinheiro real: KYC, depósitos manuais, levantamentos ---------------- */
export function submitKyc(db: DB, user: string, k: KycInput, now: number) {
  const today = new Date(now + 2 * 3600e3).toISOString().slice(0, 10);
  const e = validateKyc(k, today);
  if (e.length) throw new Error('KYC_INVALID');
  if (db.kyc[user]?.status === 'aprovado') throw new Error('KYC_LOCKED');
  db.kyc[user] = { ...k, idNumber: k.idNumber.replace(/\s/g, '').toUpperCase(), fullName: k.fullName.trim(), status: 'pendente', note: '', submittedAt: iso(now) };
}
export function reviewKyc(db: DB, user: string, status: KycStatus, note: string, actor: string, now: number) {
  const k = db.kyc[user];
  if (!k) throw new Error('KYC');
  k.status = status; k.note = note;
  logAdmin(db, actor, status === 'aprovado' ? 'kyc_aprovado' : 'kyc_recusado', user, { nota: note }, now);
}
/** Depósito confirmado manualmente pelo admin (até haver API M-Pesa/e-Mola). Idempotente pela referência. */
export function adminDeposit(db: DB, user: string, amount: number, method: string, reference: string, actor: string, now: number): number {
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) throw new Error('AMOUNT');
  if (!reference.trim()) throw new Error('REF');
  if (db.kyc[user]?.status !== 'aprovado') throw new Error('KYC');
  const ref = `${method}:${reference.trim().toUpperCase()}`;
  if ((db.money ?? []).some((r) => r.reason === 'deposito' && r.ref === ref)) throw new Error('DUP_REF');
  const bal = post(db, user, amount, 'deposito', ref, now, 'mt');
  logAdmin(db, actor, 'deposito_manual', user, { valor: amount, metodo: method, referencia: reference.trim() }, now);
  return bal;
}
export function requestWithdrawal(db: DB, user: string, amount: number, method: 'M-Pesa' | 'e-Mola', phone: string, now: number): Withdrawal {
  if (!realMoneyActive(db, now)) throw new Error('REAL_OFF');
  if (db.kyc[user]?.status !== 'aprovado') throw new Error('KYC');
  const c = db.settings;
  if (!Number.isInteger(amount) || amount < c.mtMinWithdraw) throw new Error('MIN_WITHDRAW');
  const day = maputoDayStart(now);
  const today = db.withdrawals.filter((w) => w.userId === user && w.status !== 'recusado' && Date.parse(w.createdAt) >= day).reduce((a, w) => a + w.amount, 0);
  if (today + amount > c.mtMaxWithdrawDaily) throw new Error('MAX_WITHDRAW');
  if (amount > balanceOf(db, user, 'mt')) throw new Error('BALANCE');
  const w: Withdrawal = { id: nid(db, 'w'), userId: user, amount, method, phone: phone.replace(/\s/g, ''), status: 'pendente', reference: '', note: '', createdAt: iso(now), decidedAt: null };
  post(db, user, -amount, 'levantamento', w.id, now, 'mt'); // reserva o valor
  db.withdrawals.unshift(w);
  return w;
}
/** Admin: marca como pago (com a referência da transferência feita) ou recusa (o valor volta à carteira). */
export function decideWithdrawal(db: DB, id: string, action: 'pago' | 'recusado', reference: string, actor: string, now: number) {
  const w = db.withdrawals.find((x) => x.id === id);
  if (!w || w.status !== 'pendente') throw new Error('WITHDRAWAL');
  if (action === 'pago' && !reference.trim()) throw new Error('REF');
  w.status = action; w.decidedAt = iso(now);
  if (action === 'pago') w.reference = reference.trim();
  else { w.note = reference.trim(); post(db, w.userId, w.amount, 'levantamento_recusado', w.id, now, 'mt'); }
  logAdmin(db, actor, action === 'pago' ? 'levantamento_pago' : 'levantamento_recusado', w.userId, { valor: w.amount, metodo: w.method, referencia: reference.trim() }, now);
}

/* ---------------- Jogador: boletim e jogo responsável ---------------- */
export function limitsOf(db: DB, user: string): PersonalLimits {
  return db.limits[user] ?? { ...NO_LIMITS };
}
export function stakedSince(db: DB, user: string, since: number, cur: Currency = 'pontos'): number {
  return db.bets.filter((b) => b.userId === user && (b.currency ?? 'pontos') === cur && Date.parse(b.createdAt) >= since).reduce((a, b) => a + b.stake, 0);
}
export function confirmAge(db: DB, user: string, birth: string | null, now: number) {
  if (birth) {
    const b = new Date(birth); const n = new Date(now);
    let age = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
    if (age < 18) throw new Error('MINOR');
  }
  db.limits[user] = { ...limitsOf(db, user), ageConfirmedAt: iso(now) };
}
export function setLimits(db: DB, user: string, l: { maxStake: number | null; maxDaily: number | null; maxWeekly: number | null; mtMaxStake?: number | null; mtMaxDaily?: number | null; mtMaxWeekly?: number | null }) {
  for (const v of [l.maxStake, l.maxDaily, l.maxWeekly, l.mtMaxStake ?? null, l.mtMaxDaily ?? null, l.mtMaxWeekly ?? null]) if (v != null && !(Number.isInteger(v) && v >= 1)) throw new Error('LIMIT');
  db.limits[user] = { ...limitsOf(db, user), ...l };
}
/** Autoexclusão 7/30/90 dias. Nunca encurta um período já em curso. */
export function selfExclude(db: DB, user: string, days: number, now: number) {
  if (![7, 30, 90].includes(days)) throw new Error('DAYS');
  const cur = limitsOf(db, user);
  const until = now + days * 86400e3;
  const keep = cur.selfExcludedUntil && Date.parse(cur.selfExcludedUntil) > until;
  db.limits[user] = { ...cur, selfExcludedUntil: keep ? cur.selfExcludedUntil : iso(until) };
}

export interface PlaceInput { selectionIds: string[]; stake: number; odds: number[]; acceptChanges?: boolean; currency?: Currency }
export type PlaceResult = { ok: true; betId: string; balance: number } | { ok: false; code: SlipError | 'ODDS_CHANGED' | 'NOT_FOUND'; odds?: Record<string, number> };

export function placeBet(db: DB, user: string, inp: PlaceInput, now: number): PlaceResult {
  sweep(db, now);
  if (!db.settings.betsEnabled) return { ok: false, code: 'BETS_OFF' };
  const sels = inp.selectionIds.map((id) => db.selections.find((s) => s.id === id));
  if (sels.some((s) => !s) || new Set(inp.selectionIds).size !== inp.selectionIds.length) return { ok: false, code: 'NOT_FOUND' };
  const legs = sels.map((s) => {
    const mk = db.markets.find((m) => m.id === s!.marketId)!;
    const mt = mk.matchId ? db.matches.find((m) => m.id === mk.matchId) : null;
    const open = mk.status === 'aberto' && (!mk.closesAt || Date.parse(mk.closesAt) > now) && (!mt || (mt.status === 'agendado' && Date.parse(mt.startsAt) > now));
    return { selectionId: s!.id, groupId: mk.matchId ?? `t:${mk.tournamentId}:${mk.id}`, odds: s!.odds, open, marketId: mk.id };
  });
  const cur: Currency = inp.currency ?? 'pontos';
  if (cur === 'mt') {
    if (!realMoneyActive(db, now)) return { ok: false, code: 'REAL_OFF' };
    if (db.kyc[user]?.status !== 'aprovado') return { ok: false, code: 'KYC' };
  }
  const errs = validateSlip(legs, inp.stake, cfgFor(db.settings, cur), limitsFor(limitsOf(db, user), cur), {
    balance: balanceOf(db, user, cur), stakedToday: stakedSince(db, user, maputoDayStart(now), cur), stakedWeek: stakedSince(db, user, maputoWeekStart(now), cur), now,
  });
  if (!Number.isInteger(inp.stake)) errs.unshift('STAKE_MIN');
  if (errs.length) return { ok: false, code: errs[0] };
  const changed: Record<string, number> = {};
  legs.forEach((l, i) => { if (Math.abs(l.odds - (inp.odds[i] ?? 0)) > 1e-9) changed[l.selectionId] = l.odds; });
  if (Object.keys(changed).length && !inp.acceptChanges) return { ok: false, code: 'ODDS_CHANGED', odds: changed };
  const total = comboOdds(legs.map((l) => l.odds));
  const b: Bet = {
    id: nid(db, 'b'), userId: user, kind: legs.length > 1 ? 'multipla' : 'simples', stake: inp.stake, totalOdds: total,
    potential: potentialReturn(inp.stake, total, cfgFor(db.settings, cur).maxPayout), status: 'aberta', payout: 0, version: 1, createdAt: iso(now), settledAt: null, currency: cur,
  };
  const balance = post(db, user, -inp.stake, 'aposta', b.id, now, cur);
  db.bets.push(b);
  for (const l of legs) db.legs.push({ betId: b.id, selectionId: l.selectionId, marketId: l.marketId, groupId: l.groupId, odds: l.odds, result: 'pendente' });
  return { ok: true, betId: b.id, balance };
}

/* ---------------- Admin: exposição e alertas ---------------- */
export interface Exposure { selectionId: string; label: string; market: string; event: string; bets: number; staked: number; liability: number }
export interface RiskAlert { kind: 'aposta_grande' | 'concentracao'; text: string; ref: string }
export function eventTitle(db: DB, mk: Market): string {
  if (mk.matchId) { const m = db.matches.find((x) => x.id === mk.matchId); return m ? `${m.home} vs ${m.away}` : ''; }
  return mk.tournamentName || 'Torneio';
}
export function overview(db: DB): { exposure: Exposure[]; alerts: RiskAlert[]; users: { userId: string; bets: number; staked: number; returned: number; open: number }[] } {
  const open = new Set(db.bets.filter((b) => b.status === 'aberta').map((b) => b.id));
  const ex = new Map<string, Exposure>();
  for (const l of db.legs) {
    const s = db.selections.find((x) => x.id === l.selectionId); const mk = db.markets.find((m) => m.id === l.marketId); const b = db.bets.find((x) => x.id === l.betId);
    if (!s || !mk || !b) continue;
    const e = ex.get(s.id) ?? { selectionId: s.id, label: s.label, market: mk.title, event: eventTitle(db, mk), bets: 0, staked: 0, liability: 0 };
    e.bets++; e.staked += b.stake; if (open.has(b.id)) e.liability += b.potential;
    ex.set(s.id, e);
  }
  const exposure = [...ex.values()].sort((a, b) => b.liability - a.liability || b.staked - a.staked);
  const alerts: RiskAlert[] = [];
  for (const b of db.bets) if (b.stake >= db.settings.bigStakeAlert) alerts.push({ kind: 'aposta_grande', text: `Aposta grande: ${b.stake} pts (${b.userName ?? b.userId})`, ref: b.id });
  for (const e of exposure) if (e.bets >= db.settings.sameSelectionAlert) alerts.push({ kind: 'concentracao', text: `${e.bets} apostas na mesma seleção: ${e.label} · ${e.event}`, ref: e.selectionId });
  const us = new Map<string, { userId: string; bets: number; staked: number; returned: number; open: number }>();
  for (const b of db.bets) {
    const u = us.get(b.userId) ?? { userId: b.userId, bets: 0, staked: 0, returned: 0, open: 0 };
    u.bets++; u.staked += b.stake; u.returned += b.payout; if (b.status === 'aberta') u.open++;
    us.set(b.userId, u);
  }
  return { exposure, alerts, users: [...us.values()].sort((a, b) => b.staked - a.staked) };
}
