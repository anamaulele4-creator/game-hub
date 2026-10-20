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
