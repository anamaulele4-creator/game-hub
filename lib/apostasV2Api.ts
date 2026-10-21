// Apostas v2 — acesso aos dados. Produção: funções SECURITY DEFINER do Supabase (apv2_*) + leitura com RLS.
// Modo demo: o motor em memória de lib/apostasV2.ts guardado no localStorage (com o mesmo comportamento).
import { IS_DEMO } from './config';
import { sb } from './supabase';
import { isMissing } from './appSettings';
import * as v2 from './apostasV2';
import type { V2BetStatus, V2Limits, V2MarketStatus, V2Perm, V2Res } from './apostasV2';

export interface V2SelView { id: string; marketId: string; label: string; odds: number; oddsVersion: number; result: string }
export interface V2MarketView { id: string; title: string; game: string; status: V2MarketStatus; closesAt: string | null; createdAt: string; selections: V2SelView[] }
export interface V2MyBet { id: string; marketId: string; selectionId: string; market: string; label: string; stake: number; oddsLocked: number; potential: number; status: V2BetStatus; payout: number; createdAt: string; settledAt: string | null }
export interface V2Me { enabled: boolean; installed: boolean; limits: V2Limits; balance: number; claimed: boolean; staff: boolean; loggedIn: boolean }
export interface V2AdminBet extends V2MyBet { userId: string; handle: string }
export interface V2StaffRow { id: string; handle: string; name: string; role: string; perms: V2Perm[] }
export interface V2AuditRow { id: number; action: string; target: string; actor: string; before: unknown; after: unknown; at: string }
export interface V2AdminView { enabled: boolean; limits: V2Limits; myPerms: V2Perm[]; bets: V2AdminBet[]; staff: V2StaffRow[]; audit: V2AuditRow[] }

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DEMO_KEY = 'txap-apostas-v2-demo-v1';
const ME = 'demo';

/* ---------------- Demo ---------------- */
function seed(now: number): v2.V2DB {
  const d = v2.emptyV2();
  d.roles[ME] = 'admin'; d.roles['mod-ex'] = 'moderator';
  d.perms[ME] = ['markets', 'odds', 'settle', 'toggle'];
  d.enabled = true;
  v2.createMarket(d, ME, 'Liga Squad Free Fire: Fênix Squad vs Raio Gaming', 'ff', new Date(now + 26 * 3600e3).toISOString(), [{ label: 'Fênix Squad', odds: 1.75 }, { label: 'Raio Gaming', odds: 2.1 }], now);
  v2.createMarket(d, ME, 'Taça eFootball 1v1: Mambas FC vs Águias da Matola', 'ef', new Date(now + 50 * 3600e3).toISOString(), [{ label: 'Mambas FC', odds: 2.2 }, { label: 'Empate', odds: 3.4 }, { label: 'Águias da Matola', odds: 2.9 }], now);
  d.enabled = false; // como em produção: desligado por omissão
  d.audit = [];
  return d;
}
function demo(): v2.V2DB {
  try { const raw = localStorage.getItem(DEMO_KEY); if (raw) return JSON.parse(raw); } catch { /* ignora */ }
  const d = seed(Date.now()); save(d); return d;
}
function save(d: v2.V2DB) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* ignora */ } }
function withDemo(fn: (d: v2.V2DB) => V2Res): V2Res { const d = demo(); const r = fn(d); save(d); return r; }
function demoMarkets(d: v2.V2DB): V2MarketView[] {
  return d.markets.map((m) => ({ ...m, selections: d.selections.filter((s) => s.marketId === m.id).map((s) => ({ ...s })) }));
}
function demoBet(d: v2.V2DB, b: v2.V2Bet): V2MyBet {
  const m = d.markets.find((x) => x.id === b.marketId); const s = d.selections.find((x) => x.id === b.selectionId);
  return { id: b.id, marketId: b.marketId, selectionId: b.selectionId, market: m?.title ?? '', label: s?.label ?? '', stake: b.stake, oddsLocked: b.oddsLocked, potential: b.potential, status: b.status, payout: b.payout, createdAt: b.createdAt, settledAt: b.settledAt };
}

/* ---------------- Supabase ---------------- */
async function rpc(fn: string, args: Row = {}): Promise<Row> {
  const c = await sb();
  const { data, error } = await c.rpc(fn, args);
  if (error) return { ok: false, code: isMissing(error.message) ? 'NOT_INSTALLED' : /permission denied/i.test(error.message) ? 'AUTH' : error.message };
  return data as Row;
}
const asRes = (r: Row): V2Res => (r?.ok ? (r as V2Res) : { ok: false, code: String(r?.code ?? 'ERRO'), ...r } as V2Res);
const mapBet = (b: Row): V2MyBet => ({
  id: b.id, marketId: b.market_id, selectionId: b.selection_id, market: b.market ?? b.apv2_markets?.title ?? '', label: b.label ?? b.apv2_selections?.label ?? '',
  stake: b.stake, oddsLocked: Number(b.odds_locked), potential: b.potential, status: b.status, payout: b.payout, createdAt: b.created_at, settledAt: b.settled_at,
});

export const apostasV2Api = {
  async me(): Promise<V2Me> {
    if (IS_DEMO) { const d = demo(); return { enabled: d.enabled, installed: true, limits: d.limits, balance: v2.balanceV2(d, ME), claimed: d.ledger.some((l) => l.userId === ME && l.reason === 'inicial'), staff: true, loggedIn: true }; }
    const c = await sb();
    const { data: s } = await c.auth.getSession();
    const r = await rpc('apv2_me');
    if (!r?.ok) return { enabled: false, installed: r?.code !== 'NOT_INSTALLED', limits: v2.V2_DEFAULT_LIMITS, balance: 0, claimed: false, staff: false, loggedIn: !!s.session };
    return { enabled: !!r.enabled, installed: true, limits: { ...v2.V2_DEFAULT_LIMITS, ...r.limits }, balance: r.balance ?? 0, claimed: !!r.claimed, staff: !!r.staff, loggedIn: !!s.session };
  },
  async markets(includeClosed = false): Promise<V2MarketView[]> {
    if (IS_DEMO) return demoMarkets(demo()).filter((m) => includeClosed || m.status === 'aberto' || m.status === 'suspenso');
    const c = await sb();
    let q = c.from('apv2_markets').select('id,title,game_key,status,closes_at,created_at,apv2_selections(id,market_id,label,odds,odds_version,result,sort)').order('created_at', { ascending: false }).limit(100);
    if (!includeClosed) q = q.in('status', ['aberto', 'suspenso']);
    const { data, error } = await q;
    if (error) throw new Error(isMissing(error.message) ? 'NOT_INSTALLED' : error.message);
    return (data ?? []).map((m: Row) => ({
      id: m.id, title: m.title, game: m.game_key, status: m.status, closesAt: m.closes_at, createdAt: m.created_at,
      selections: [...(m.apv2_selections ?? [])].sort((a: Row, b: Row) => a.sort - b.sort).map((s: Row) => ({ id: s.id, marketId: s.market_id, label: s.label, odds: Number(s.odds), oddsVersion: s.odds_version, result: s.result })),
    }));
  },
  async myBets(): Promise<V2MyBet[]> {
    if (IS_DEMO) { const d = demo(); return d.bets.filter((b) => b.userId === ME).map((b) => demoBet(d, b)); }
    const c = await sb();
    const { data: s } = await c.auth.getSession();
    if (!s.session) return [];
    const { data } = await c.from('apv2_bets').select('*,apv2_markets(title),apv2_selections(label)').eq('user_id', s.session.user.id).order('created_at', { ascending: false }).limit(100);
    return (data ?? []).map(mapBet);
  },
  async claim(): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.claimTest(d, ME));
    return asRes(await rpc('apv2_claim_test_balance'));
  },
  /** A odd vista pelo utilizador vai junto: se mudou, o servidor recusa com ODDS_CHANGED e devolve a odd nova. */
  async place(selectionId: string, stake: number, seenOdds: number, requestId: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.placeV2(d, ME, selectionId, stake, seenOdds, Date.now(), requestId));
    return asRes(await rpc('apv2_place', { p_selection: selectionId, p_stake: stake, p_seen_odds: seenOdds, p_request: requestId }));
  },

  /* ---------- Admin ---------- */
  async adminView(): Promise<V2AdminView | { error: string }> {
    if (IS_DEMO) {
      const d = demo();
      return {
        enabled: d.enabled, limits: d.limits, myPerms: v2.V2_PERMS.filter((p) => v2.hasPerm(d, ME, p)),
        bets: d.bets.map((b) => ({ ...demoBet(d, b), userId: b.userId, handle: b.userId === ME ? 'tu (demo)' : b.userId })),
        staff: [{ id: ME, handle: 'ana', name: 'Ana (demo)', role: 'admin', perms: d.perms[ME] ?? [] }, { id: 'mod-ex', handle: 'moderador.exemplo', name: 'Moderador exemplo', role: 'moderator', perms: d.perms['mod-ex'] ?? [] }],
        audit: d.audit.map((a) => ({ id: a.id, action: a.action, target: a.target, actor: a.actor === ME ? 'ana' : a.actor, before: a.before, after: a.after, at: a.at })),
      };
    }
    const r = await rpc('apv2_admin_view');
    if (!r?.ok) return { error: String(r?.code ?? 'ERRO') };
    return {
      enabled: !!r.enabled, limits: { ...v2.V2_DEFAULT_LIMITS, ...r.limits }, myPerms: r.my_perms ?? [],
      bets: (r.bets ?? []).map((b: Row) => ({ ...mapBet(b), userId: b.user_id, handle: b.handle })),
      staff: (r.staff ?? []).map((s: Row) => ({ id: s.id, handle: s.handle, name: s.display_name ?? '', role: s.role, perms: s.perms ?? [] })),
      audit: (r.audit ?? []).map((a: Row) => ({ id: a.id, action: a.action, target: a.target, actor: a.actor_handle, before: a.before, after: a.after, at: a.created_at })),
    };
  },
  async setEnabled(on: boolean): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.setEnabled(d, ME, on, Date.now()));
    return asRes(await rpc('app_setting_set', { p_key: 'apostas_enabled', p_value: on }));
  },
  async setLimits(l: V2Limits): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => { if (!v2.hasPerm(d, ME, 'toggle')) return { ok: false, code: 'FORBIDDEN' }; if (!(l.min_stake >= 1 && l.max_stake >= l.min_stake && l.initial_test_balance >= 0)) return { ok: false, code: 'INVALID' }; d.limits = l; return { ok: true }; });
    return asRes(await rpc('app_setting_set', { p_key: 'apostas_limits', p_value: l }));
  },
  async createMarket(title: string, game: string, closesAt: string | null, selections: { label: string; odds: number }[]): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.createMarket(d, ME, title, game, closesAt, selections, Date.now()));
    return asRes(await rpc('apv2_admin_create_market', { p_title: title, p_game: game, p_closes_at: closesAt, p_selections: selections }));
  },
  async marketStatus(id: string, status: 'aberto' | 'suspenso' | 'fechado'): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.marketStatus(d, ME, id, status, Date.now()));
    return asRes(await rpc('apv2_admin_market_status', { p_market: id, p_status: status }));
  },
  async setOdds(selectionId: string, odds: number): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.setOdds(d, ME, selectionId, odds, Date.now()));
    return asRes(await rpc('apv2_admin_set_odds', { p_selection: selectionId, p_odds: odds }));
  },
  async settleBet(betId: string, result: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.settleBetV2(d, ME, betId, result, Date.now()));
    return asRes(await rpc('apv2_admin_settle_bet', { p_bet: betId, p_result: result }));
  },
  async settleMarket(marketId: string, winner: string | null): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.settleMarketV2(d, ME, marketId, winner, Date.now()));
    return asRes(await rpc('apv2_admin_settle_market', { p_market: marketId, p_winner: winner }));
  },
  async grant(userId: string, perm: V2Perm, on: boolean): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => v2.grant(d, ME, userId, perm, on, Date.now()));
    return asRes(await rpc('apv2_admin_grant', { p_user: userId, p_perm: perm, p_on: on }));
  },
  async testCredit(userId: string, amount: number, ref: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo((d) => { if (!v2.hasPerm(d, ME, 'settle')) return { ok: false, code: 'FORBIDDEN' }; return { ok: true, balance: v2.postV2(d, userId, amount, 'admin', ref) }; });
    return asRes(await rpc('apv2_admin_test_credit', { p_user: userId, p_amount: amount, p_ref: ref }));
  },
};

export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16); c.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* =====================================================================================================
 * Apostas v3 — confrontos, estados, limites, resultados com dupla validação, carteira e reclamações.
 * Produção: funções do supabase/migrations/2026-10-21-apostas-v3.sql. Demo: motor v3 de lib/apostasV2.ts.
 * Se o SQL v3 ainda não foi instalado, me3().v3 = false e a interface usa as Apostas v2 como antes.
 * ===================================================================================================== */
export interface V3SelView extends V2SelView { side: 'a' | 'b' | 'empate' | null }
export interface V3MatchView {
  id: string; game: string; teamA: string; teamB: string; logoA: string | null; logoB: string | null; startsAt: string; organizer: string; rules: string;
  tournamentRef: string | null; tournamentName: string; status: v2.V3MatchStatus; result: string | null; scoreA: number | null; scoreB: number | null;
  marketId: string | null; marketStatus: V2MarketStatus | null; selections: V3SelView[];
}
export interface V3Me extends V2Me { v3: boolean; chips: number[]; block: string | null; serverNow: string }
export interface V3BetView extends V2MyBet {
  matchId: string | null; game: string; teamA: string; teamB: string; matchStatus: string | null; startsAt: string | null;
  confirmedAt: string | null; officialResult: string | null; settledAmount: number | null; requestId: string | null;
}
export interface V3EventView { id: number; from: string | null; to: string; amount: number | null; note: string; at: string }
export interface V3LedgerRow { id: number; delta: number; reason: string; ref: string; balanceAfter: number; at: string; handle?: string; userId?: string }
export interface V3WalletView extends v2.V3Wallet { ledger: V3LedgerRow[] }
export interface V3ComplaintView { id: string; userId: string; handle: string; betId: string | null; matchId: string | null; message: string; status: string; response: string; at: string }
export interface V3ResultView { id: string; matchId: string; winner: string; scoreA: number | null; scoreB: number | null; motivo: string; evidence: string; proposer: string; proposedBy: string; status: string; reviewer: string; reviewMotivo: string; at: string }
export interface V3TeamView { id: string; game: string; name: string; logo: string | null }
export interface V3ExposureRow { marketId: string; title: string; status: string; matchId: string | null; exposure: number; openStake: number; openBets: number }
export interface V3AdminMatch extends Omit<V3MatchView, 'selections' | 'marketStatus'> { bets: number; openStake: number }
export interface V3AdminView { matches: V3AdminMatch[]; teams: V3TeamView[]; limits: v2.V3Limit[]; results: V3ResultView[]; complaints: V3ComplaintView[]; exposure: V3ExposureRow[]; ledger: V3LedgerRow[]; chips: number[] }

const isNet = (m: string) => /failed to fetch|fetch failed|network|load failed|timeout|ECONN/i.test(m);
async function rpc3(fn: string, args: Row = {}): Promise<Row> {
  try {
    const c = await sb();
    const { data, error } = await c.rpc(fn, args);
    if (error) return { ok: false, code: isMissing(error.message) ? 'NOT_INSTALLED' : isNet(error.message) ? 'NETWORK' : /permission denied/i.test(error.message) ? 'AUTH' : error.message };
    return data as Row;
  } catch (e) { return { ok: false, code: isNet(String((e as Error)?.message ?? e)) ? 'NETWORK' : String((e as Error)?.message ?? e) }; }
}
const mapMatch = (m: Row): V3MatchView => {
  const mk = (m.apv2_markets ?? [])[0] ?? null;
  return {
    id: m.id, game: m.game_key, teamA: m.team_a_name, teamB: m.team_b_name, logoA: m.team_a_logo, logoB: m.team_b_logo, startsAt: m.starts_at, organizer: m.organizer_name ?? '',
    rules: m.rules ?? '', tournamentRef: m.tournament_ref, tournamentName: m.tournament_name ?? '', status: m.status, result: m.result, scoreA: m.score_a, scoreB: m.score_b,
    marketId: mk?.id ?? m.market_id ?? null, marketStatus: mk?.status ?? null,
    selections: [...(mk?.apv2_selections ?? [])].sort((a: Row, b: Row) => a.sort - b.sort).map((s: Row) => ({ id: s.id, marketId: s.market_id, label: s.label, odds: Number(s.odds), oddsVersion: s.odds_version, result: s.result, side: s.side ?? null })),
  };
};
const mapBet3 = (b: Row): V3BetView => ({
  ...mapBet(b), market: b.apv2_markets?.title ?? b.market ?? '', label: b.selection_label ?? b.apv2_selections?.label ?? b.label ?? '',
  matchId: b.match_id ?? null, game: b.apv2_matches?.game_key ?? b.apv2_markets?.game_key ?? 'outros', teamA: b.apv2_matches?.team_a_name ?? '', teamB: b.apv2_matches?.team_b_name ?? '',
  matchStatus: b.apv2_matches?.status ?? null, startsAt: b.apv2_matches?.starts_at ?? null, confirmedAt: b.confirmed_at ?? null, officialResult: b.official_result ?? null,
  settledAmount: b.settled_amount ?? null, requestId: b.request_id ?? null,
});
const mapLedger = (l: Row): V3LedgerRow => ({ id: l.id, delta: l.delta, reason: l.reason, ref: l.ref, balanceAfter: l.balance_after, at: l.created_at, handle: l.handle, userId: l.user_id });

/* ---------- Demo v3 ---------- */
function demo3(): v2.V2DB {
  const d = demo();
  if (!d.v3) {
    const now = Date.now(); const was = d.enabled; d.enabled = true;
    const mk = (game: string, a: string, b: string, h: number, oa: number, ob: number, od?: number) => v2.createMatchV3(d, ME, { game, teamA: a, teamB: b, startsAt: new Date(now + h * 3600e3).toISOString(), organizer: 'TxapZone', rules: 'Melhor de 3. Resultado oficial validado por 2 pessoas da equipa.', oddsA: oa, oddsB: ob, oddsDraw: od ?? null, tournamentName: 'Liga TxapZone' }, now);
    const ids = [mk('ff', 'Fênix Squad', 'Raio Gaming', 26, 1.75, 2.1), mk('ef', 'Mambas FC', 'Águias da Matola', 50, 2.2, 2.9, 3.4), mk('valorant', 'Leões MZ', 'Tubarões', 6, 1.6, 2.4), mk('cod', 'Lobos', 'Falcões', 72, 1.9, 1.9), mk('fortnite', 'Tempestade', 'Neblina', 30, 2.5, 1.55)];
    for (const r of ids) if (r.ok) v2.matchStatusV3(d, ME, String(r.id), 'apostas_abertas', 'demo: abrir apostas', now);
    d.enabled = was; d.audit = [];
    save(d);
  }
  return d;
}
function withDemo3(fn: (d: v2.V2DB) => V2Res): V2Res { const d = demo3(); let r: V2Res; try { r = fn(d); } catch (e) { r = { ok: false, code: String((e as Error).message) }; } save(d); return r; }
function demoMatchView(d: v2.V2DB, m: v2.V3Match): V3MatchView {
  const mk = d.markets.find((x) => x.id === m.marketId);
  return { ...m, marketId: m.marketId, marketStatus: mk?.status ?? null, selections: d.selections.filter((s) => s.marketId === m.marketId).map((s) => ({ ...s, side: s.side ?? null })) };
}
function demoBet3(d: v2.V2DB, b: v2.V2Bet): V3BetView {
  const mt = b.matchId ? v2.v3(d).matches.find((x) => x.id === b.matchId) : undefined;
  const m = d.markets.find((x) => x.id === b.marketId);
  return { ...demoBet(d, b), label: b.selectionLabel ?? demoBet(d, b).label, matchId: b.matchId ?? null, game: mt?.game ?? m?.game ?? 'outros', teamA: mt?.teamA ?? '', teamB: mt?.teamB ?? '', matchStatus: mt?.status ?? null, startsAt: mt?.startsAt ?? null, confirmedAt: b.confirmedAt ?? null, officialResult: b.officialResult ?? null, settledAmount: b.settledAmount ?? null, requestId: b.requestId ?? null };
}

export const apostasV3Api = {
  async me(): Promise<V3Me> {
    if (IS_DEMO) { const d = demo3(); const base = await apostasV2Api.me(); return { ...base, v3: true, chips: v2.v3(d).chips, block: null, serverNow: new Date().toISOString() }; }
    const c = await sb();
    const { data: s } = await c.auth.getSession();
    const r = await rpc3('apv2_v3_me');
    if (!r?.ok) {
      const base = await apostasV2Api.me();
      return { ...base, v3: false, chips: v2.V3_DEFAULT_CHIPS, block: null, serverNow: new Date().toISOString() };
    }
    return { enabled: !!r.enabled, installed: true, limits: { ...v2.V2_DEFAULT_LIMITS, ...r.limits }, balance: r.balance ?? 0, claimed: !!r.claimed, staff: !!r.staff, loggedIn: !!s.session,
      v3: true, chips: Array.isArray(r.chips) ? r.chips : v2.V3_DEFAULT_CHIPS, block: r.block ?? null, serverNow: r.server_now ?? new Date().toISOString() };
  },
  async matches(): Promise<V3MatchView[]> {
    if (IS_DEMO) { const d = demo3(); return v2.v3(d).matches.map((m) => demoMatchView(d, m)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)); }
    const c = await sb();
    const since = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
    const { data, error } = await c.from('apv2_matches')
      .select('*,apv2_markets(id,status,closes_at,apv2_selections(id,market_id,label,odds,odds_version,result,sort,side))')
      .or(`status.not.in.(finalizado,cancelado),starts_at.gte.${since}`).order('starts_at', { ascending: true }).limit(200);
    if (error) throw new Error(isMissing(error.message) ? 'NOT_INSTALLED' : isNet(error.message) ? 'NETWORK' : error.message);
    return (data ?? []).map(mapMatch);
  },
  async myBets(): Promise<V3BetView[]> {
    if (IS_DEMO) { const d = demo3(); return d.bets.filter((b) => b.userId === ME).map((b) => demoBet3(d, b)); }
    const c = await sb();
    const { data: s } = await c.auth.getSession();
    if (!s.session) return [];
    const { data, error } = await c.from('apv2_bets').select('*,apv2_markets(title,game_key),apv2_selections(label),apv2_matches(team_a_name,team_b_name,game_key,status,starts_at)')
      .eq('user_id', s.session.user.id).order('created_at', { ascending: false }).limit(300);
    if (error) throw new Error(isNet(error.message) ? 'NETWORK' : error.message);
    return (data ?? []).map(mapBet3);
  },
  async betEvents(betId: string): Promise<V3EventView[]> {
    if (IS_DEMO) return v2.v3(demo3()).events.filter((e) => e.betId === betId).map((e) => ({ id: e.id, from: e.from, to: e.to, amount: e.amount, note: e.note, at: e.at }));
    const c = await sb();
    const { data } = await c.from('apv2_bet_events').select('*').eq('bet_id', betId).order('id', { ascending: true });
    return (data ?? []).map((e: Row) => ({ id: e.id, from: e.from_status, to: e.to_status, amount: e.amount, note: e.note, at: e.created_at }));
  },
  async claim(): Promise<V2Res> { return apostasV2Api.claim(); },
  /** Confirmar: o mesmo requestId em todas as tentativas (duplo clique / falha de rede) → nunca debita 2x. */
  async confirm(selectionId: string, stake: number, seenOdds: number, requestId: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.confirmV3(d, ME, selectionId, stake, seenOdds, Date.now(), requestId));
    return asRes(await rpc3('apv2_bet_confirm', { p_selection: selectionId, p_stake: stake, p_seen_odds: seenOdds, p_request: requestId }));
  },
  async wallet(): Promise<V3WalletView | null> {
    if (IS_DEMO) { const d = demo3(); return { ...v2.walletV3(d, ME), ledger: d.ledger.filter((l) => l.userId === ME).map((l, i) => ({ id: i + 1, delta: l.delta, reason: l.reason, ref: l.ref, balanceAfter: l.balanceAfter, at: '' })).reverse() }; }
    const r = await rpc3('apv2_wallet');
    if (!r?.ok) return null;
    return { available: r.available, reserved: r.reserved, pending: r.pending, wonTotal: r.won_total, netWon: r.net_won, refundedTotal: r.refunded_total, ledger: (r.ledger ?? []).map(mapLedger) };
  },
  async complaint(betId: string | null, matchId: string | null, message: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.openComplaintV3(d, ME, betId, matchId, message, Date.now()));
    return asRes(await rpc3('apv2_complaint_open', { p_bet: betId, p_match: matchId, p_message: message }));
  },
  async myComplaints(): Promise<V3ComplaintView[]> {
    if (IS_DEMO) return v2.v3(demo3()).complaints.filter((c) => c.userId === ME).map((c) => ({ ...c, handle: 'tu' }));
    const c = await sb();
    const { data } = await c.from('apv2_complaints').select('*').order('created_at', { ascending: false }).limit(50);
    return (data ?? []).map((x: Row) => ({ id: x.id, userId: x.user_id, handle: '', betId: x.bet_id, matchId: x.match_id, message: x.message, status: x.status, response: x.response, at: x.created_at }));
  },

  /* ---------- Admin ---------- */
  async adminView(): Promise<V3AdminView | { error: string }> {
    if (IS_DEMO) {
      const d = demo3(); const s = v2.v3(d);
      return {
        matches: s.matches.map((m) => ({ ...m, marketId: m.marketId, bets: d.bets.filter((b) => b.matchId === m.id).length, openStake: d.bets.filter((b) => b.matchId === m.id && v2.isOpenBet(b.status)).reduce((a, b) => a + b.stake, 0) })),
        teams: [], limits: s.limits, chips: s.chips,
        results: s.results.map((r) => ({ id: r.id, matchId: r.matchId, winner: r.winner, scoreA: r.scoreA, scoreB: r.scoreB, motivo: r.motivo, evidence: '', proposer: r.proposedBy === ME ? 'ana' : r.proposedBy, proposedBy: r.proposedBy, status: r.status, reviewer: r.reviewedBy ?? '', reviewMotivo: r.reviewMotivo, at: r.at })),
        complaints: s.complaints.map((c) => ({ ...c, handle: c.userId === ME ? 'tu (demo)' : c.userId })),
        exposure: d.markets.filter((m) => d.bets.some((b) => b.marketId === m.id && v2.isOpenBet(b.status))).map((m) => ({ marketId: m.id, title: m.title, status: m.status, matchId: m.matchId ?? null, exposure: v2.marketExposureV3(d, m.id), openStake: d.bets.filter((b) => b.marketId === m.id && v2.isOpenBet(b.status)).reduce((a, b) => a + b.stake, 0), openBets: d.bets.filter((b) => b.marketId === m.id && v2.isOpenBet(b.status)).length })),
        ledger: d.ledger.map((l, i) => ({ id: i + 1, delta: l.delta, reason: l.reason, ref: l.ref, balanceAfter: l.balanceAfter, at: '', handle: l.userId === ME ? 'tu (demo)' : l.userId, userId: l.userId })).reverse(),
      };
    }
    const r = await rpc3('apv2_admin_v3_view');
    if (!r?.ok) return { error: String(r?.code ?? 'ERRO') };
    return {
      matches: (r.matches ?? []).map((m: Row) => ({ ...mapMatch(m), bets: m.bets ?? 0, openStake: m.open_stake ?? 0 })),
      teams: (r.teams ?? []).map((t: Row) => ({ id: t.id, game: t.game_key, name: t.name, logo: t.logo_url })),
      limits: (r.limits ?? []).map((l: Row) => ({ scope: l.scope, ref: l.ref, maxStake: l.max_stake, maxExposure: l.max_exposure, autoSuspend: l.auto_suspend, active: l.active })),
      results: (r.results ?? []).map((x: Row) => ({ id: x.id, matchId: x.match_id, winner: x.winner, scoreA: x.score_a, scoreB: x.score_b, motivo: x.motivo, evidence: x.evidence, proposer: x.proposer, proposedBy: x.proposed_by, status: x.status, reviewer: x.reviewer, reviewMotivo: x.review_motivo, at: x.proposed_at })),
      complaints: (r.complaints ?? []).map((x: Row) => ({ id: x.id, userId: x.user_id, handle: x.handle, betId: x.bet_id, matchId: x.match_id, message: x.message, status: x.status, response: x.response, at: x.created_at })),
      exposure: (r.exposure ?? []).map((x: Row) => ({ marketId: x.market_id, title: x.title, status: x.status, matchId: x.match_id, exposure: x.exposure, openStake: x.open_stake, openBets: x.open_bets })),
      ledger: (r.ledger ?? []).map(mapLedger), chips: r.chips ?? v2.V3_DEFAULT_CHIPS,
    };
  },
  async teamSave(id: string | null, game: string, name: string, logo: string | null): Promise<V2Res> {
    if (IS_DEMO) return { ok: false, code: 'Equipas: só com o Supabase ligado (no demo escreve os nomes no confronto).' };
    return asRes(await rpc3('apv2_admin_team_save', { p_id: id, p_game: game, p_name: name, p_logo: logo }));
  },
  async matchSave(id: string | null, p: v2.V3MatchInput & { teamAId?: string | null; teamBId?: string | null }, motivo: string | null): Promise<V2Res> {
    if (IS_DEMO) {
      if (id) return { ok: false, code: 'No demo só é possível criar confrontos.' };
      return withDemo3((d) => v2.createMatchV3(d, ME, p, Date.now()));
    }
    const body = { game: p.game, team_a_id: p.teamAId ?? null, team_b_id: p.teamBId ?? null, team_a_name: p.teamA, team_b_name: p.teamB, team_a_logo: p.logoA ?? null, team_b_logo: p.logoB ?? null,
      starts_at: p.startsAt, organizer_name: p.organizer ?? '', rules: p.rules ?? '', tournament_ref: p.tournamentRef ?? null, tournament_name: p.tournamentName ?? '', odds_a: p.oddsA, odds_b: p.oddsB, odds_draw: p.oddsDraw ?? null };
    return asRes(await rpc3('apv2_admin_match_save', { p_id: id, p: body, p_motivo: motivo }));
  },
  async matchStatus(id: string, status: v2.V3MatchStatus, motivo: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.matchStatusV3(d, ME, id, status, motivo, Date.now()));
    return asRes(await rpc3('apv2_admin_match_status', { p_match: id, p_status: status, p_motivo: motivo }));
  },
  async matchCancel(id: string, motivo: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.cancelMatchV3(d, ME, id, motivo, Date.now()));
    return asRes(await rpc3('apv2_admin_match_cancel', { p_match: id, p_motivo: motivo }));
  },
  async proposeResult(matchId: string, winner: string, scoreA: number | null, scoreB: number | null, evidence: string, motivo: string, requestId: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.proposeResultV3(d, ME, matchId, winner, scoreA, scoreB, motivo, Date.now(), requestId));
    return asRes(await rpc3('apv2_admin_result_propose', { p_match: matchId, p_winner: winner, p_score_a: scoreA, p_score_b: scoreB, p_evidence: evidence, p_motivo: motivo, p_request: requestId }));
  },
  async reviewResult(resultId: string, approve: boolean, motivo: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.reviewResultV3(d, ME, resultId, approve, motivo, Date.now()));
    return asRes(await rpc3('apv2_admin_result_review', { p_result: resultId, p_approve: approve, p_motivo: motivo }));
  },
  async refund(betId: string, motivo: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.refundBetV3(d, ME, betId, motivo, Date.now()));
    return asRes(await rpc3('apv2_admin_refund_bet', { p_bet: betId, p_motivo: motivo }));
  },
  async setLimit(l: v2.V3Limit, motivo: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.setLimitV3(d, ME, l, motivo, Date.now()));
    return asRes(await rpc3('apv2_admin_limit_set', { p_scope: l.scope, p_ref: l.ref, p_max_stake: l.maxStake, p_max_exposure: l.maxExposure, p_auto_suspend: l.autoSuspend, p_active: l.active, p_motivo: motivo }));
  },
  async setChips(values: number[]): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.setChipsV3(d, ME, values, Date.now()));
    return asRes(await rpc3('apv2_admin_set_stake_chips', { p_values: values }));
  },
  async complaintUpdate(id: string, status: 'em_analise' | 'resolvida' | 'rejeitada', response: string): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => v2.updateComplaintV3(d, ME, id, status, response, Date.now()));
    return asRes(await rpc3('apv2_admin_complaint_update', { p_id: id, p_status: status, p_response: response }));
  },
  async tick(): Promise<V2Res> {
    if (IS_DEMO) return withDemo3((d) => ({ ok: true, started: v2.tickV3(d, Date.now()) }));
    return asRes(await rpc3('apv2_tick'));
  },
};
