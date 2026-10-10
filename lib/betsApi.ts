// Apostas TXAP Pontos — acesso aos dados. Modo real: Supabase (RPCs SECURITY DEFINER + leitura com RLS).
// Modo demo: o mesmo "sistema operativo" em memória (lib/betsCore.ts) guardado no localStorage, com "Dados de exemplo".
import { IS_DEMO } from './config';
import { sb } from './supabase';
import type { BetGame, BetSettings, Currency, KycInput, KycStatus, PersonalLimits } from './bets';
import { DEFAULT_SETTINGS, NO_LIMITS, maputoDayStart, maputoWeekStart } from './bets';
import * as core from './betsCore';
import type { Bet, DB, LedgerRow, Leg, LogRow, Market, Match, PlaceInput, PlaceResult, Selection, Withdrawal } from './betsCore';

export interface MyLeg extends Leg { label: string; market: string; event: string }
export interface MyBet extends Bet { legs: MyLeg[] }
export interface Me {
  balance: number; weekClaimed: boolean; limits: PersonalLimits; stakedToday: number; stakedWeek: number;
  balanceMt: number; mtStakedToday: number; mtStakedWeek: number;
  kyc: { status: KycStatus; note: string; fullName: string; idType: string } | null;
}
export interface MoneyView { ledger: LedgerRow[]; withdrawals: Withdrawal[] }
export interface AdminMoney {
  kyc: { userId: string; handle: string; fullName: string; birthDate: string; idType: string; idNumber: string; phone: string; status: KycStatus; note: string; submittedAt: string; balance: number }[];
  withdrawals: (Withdrawal & { handle: string })[];
  totals: { deposits: number; withdrawn: number; pendingWithdrawals: number; balances: number };
}
export interface TeamInfo { id: string; name: string; game: BetGame; logo: string }
export interface BetsView {
  settings: BetSettings; teams: Record<string, TeamInfo>; matches: Match[]; markets: Market[]; selections: Selection[];
  me: Me | null; myBets: MyBet[];
  /** true quando tudo o que se vê é "Dados de exemplo" (demo, ou produção sem jogos agendados). */
  example: boolean;
  /** true quando as seleções não podem ser apostadas (exemplo em produção). */
  readOnly: boolean;
  weeklyCredited?: boolean;
}
export type Res = { ok: true } | { ok: false; code: string };
export interface AdminOverview {
  exposure: core.Exposure[]; alerts: core.RiskAlert[];
  users: { userId: string; handle: string; bets: number; staked: number; returned: number; open: number; balance: number; stakedMt: number; balanceMt: number }[];
  totals: { bets: number; open: number; staked: number; paid: number; liability: number; stakedMt: number; paidMt: number; liabilityMt: number };
}
export interface AdminBet extends Bet { handle: string; legs: MyLeg[] }

const DEMO_KEY = 'txap-bets-demo-v1';
const DEMO_USER = 'demo';
const H = 3600e3;

/* ---------------- Demo ---------------- */
function seedDemo(now: number): DB {
  const db = core.emptyDB();
  const at = (h: number) => new Date(now + h * H).toISOString();
  const rnd = (x: number) => Math.round(x / (15 * 60e3)) * 15 * 60e3; // horas certas
  const t = (h: number) => new Date(rnd(now + h * H)).toISOString();
  const add = (game: BetGame, home: string, away: string, h: number, tid: string, tname: string) =>
    core.createMatch(db, { game, home, away, startsAt: h < 0 ? at(h) : t(h), tournamentId: tid, tournamentName: tname, example: true }, '', now);
  // Jogos passados (com resultado) para o Elo já diferenciar as equipas
  const past: [BetGame, string, string, number, number, string, string][] = [
    ['ef', 'Mambas FC', 'Leões de Maputo', 2, 0, 'ex-ef', 'Taça eFootball 1v1'],
    ['ef', 'Águias da Matola', 'Mambas FC', 1, 1, 'ex-ef', 'Taça eFootball 1v1'],
    ['ff', 'Fênix Squad', 'Raio Gaming', 1, 0, 'ex-ff', 'Liga Squad Free Fire'],
    ['dls', 'Costa do Sol DLS', 'Maxaquene Pro', 3, 1, 'ex-dls', 'Taça DLS 1v1'],
  ];
  past.forEach(([g, a, b, x, y, tid, tn], i) => { const m = add(g, a, b, -48 - i * 3, tid, tn); core.recordResult(db, m.id, x, y, '', now); });
  add('ef', 'Mambas FC', 'Águias da Matola', 3, 'ex-ef', 'Taça eFootball 1v1');
  add('ef', 'Leões de Maputo', 'Ferroviário eSports', 5, 'ex-ef', 'Taça eFootball 1v1');
  add('ff', 'Fênix Squad', 'Kalash Team', 4, 'ex-ff', 'Liga Squad Free Fire');
  add('ff', 'Raio Gaming', 'Tubarões FF', 26, 'ex-ff', 'Liga Squad Free Fire');
  add('dls', 'Costa do Sol DLS', 'Chibuto United', 6, 'ex-dls', 'Taça DLS 1v1');
  add('cr', 'Rei do Elixir', 'Torre Norte', 2, 'ex-cr', 'Copa Clash Royale 1v1');
  add('cr', 'Coroa Azul', 'Rei do Elixir', 28, 'ex-cr', 'Copa Clash Royale 1v1');
  db.matches.forEach((m) => { m.example = true; });
  // Apostas de outros jogadores de exemplo (para o painel admin mostrar exposição e alertas)
  const others = [['ex-1', 'Jogador Exemplo 1'], ['ex-2', 'Jogador Exemplo 2']];
  for (const [u] of others) { core.claimWeekly(db, u, now); core.confirmAge(db, u, null, now); }
  const open = db.selections.filter((s) => { const mk = db.markets.find((m) => m.id === s.marketId)!; return mk.status === 'aberto' && mk.kind !== 'exact'; });
  const pick = (code: string, i = 0) => open.filter((s) => s.code === code)[i];
  const tryPlace = (u: string, sels: (Selection | undefined)[], stake: number) => {
    const ok = sels.filter(Boolean) as Selection[];
    if (ok.length) core.placeBet(db, u, { selectionIds: ok.map((s) => s.id), stake, odds: ok.map((s) => s.odds) }, now);
  };
  tryPlace('ex-1', [pick('1', 0)], 400);
  tryPlace('ex-1', [pick('over', 0), pick('2', 1)], 150);
  tryPlace('ex-2', [pick('1', 0)], 250);
  tryPlace('ex-2', [pick('under', 1)], 600);
  db.bets.forEach((b) => { b.userName = others.find(([u]) => u === b.userId)?.[1]; });
  db.settings.bigStakeAlert = 500; db.settings.sameSelectionAlert = 2; // limiares baixos só na demo, para os alertas aparecerem
  db.log = [];
  return db;
}

function loadDemo(now: number): DB {
  let db: DB | null = null;
  try { const raw = localStorage.getItem(DEMO_KEY); if (raw) db = JSON.parse(raw) as DB; } catch {}
  if (!db || !db.matches?.length) db = seedDemo(now);
  db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
  db.money ??= []; db.kyc ??= {}; db.withdrawals ??= [];
  core.sweep(db, now);
  // Jogos de exemplo acabaram todos? Volta a semear para a demo nunca ficar vazia (mantém as apostas do utilizador).
  if (!db.matches.some((m) => m.status === 'agendado')) {
    const fresh = seedDemo(now);
    fresh.ledger = db.ledger.filter((r) => r.userId === DEMO_USER).concat(fresh.ledger.filter((r) => r.userId !== DEMO_USER));
    fresh.limits = { ...fresh.limits, ...(db.limits[DEMO_USER] ? { [DEMO_USER]: db.limits[DEMO_USER] } : {}) };
    fresh.seq = Math.max(fresh.seq, db.seq) + 1;
    db = fresh;
  }
  return db;
}
function saveDemo(db: DB) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch {} }
function withDemo<T>(fn: (db: DB, now: number) => T): T {
  const now = Date.now();
  const db = loadDemo(now);
  const r = fn(db, now);
  saveDemo(db);
  return r;
}

function legsView(db: Pick<DB, 'legs' | 'selections' | 'markets' | 'matches'>, betId: string): MyLeg[] {
  return db.legs.filter((l) => l.betId === betId).map((l) => {
    const s = db.selections.find((x) => x.id === l.selectionId); const mk = db.markets.find((m) => m.id === l.marketId);
    const mt = mk?.matchId ? db.matches.find((m) => m.id === mk.matchId) : null;
    return { ...l, label: s?.label ?? '—', market: mk?.title ?? '', event: mt ? `${mt.home} vs ${mt.away}` : (mk?.tournamentName || 'Torneio') };
  });
}

function demoView(db: DB, now: number, user: string, readOnly: boolean): BetsView {
  const l = core.limitsOf(db, user);
  return {
    settings: db.settings, teams: Object.fromEntries(db.teams.map((t) => [t.id, { id: t.id, name: t.name, game: t.game, logo: t.logo ?? '' }])), matches: db.matches, markets: db.markets, selections: db.selections,
    me: readOnly ? null : {
      balance: core.balanceOf(db, user), weekClaimed: db.ledger.some((r) => r.userId === user && r.reason === 'semanal'), limits: l,
      stakedToday: core.stakedSince(db, user, maputoDayStart(now)), stakedWeek: core.stakedSince(db, user, maputoWeekStart(now)),
      balanceMt: core.balanceOf(db, user, 'mt'), mtStakedToday: core.stakedSince(db, user, maputoDayStart(now), 'mt'), mtStakedWeek: core.stakedSince(db, user, maputoWeekStart(now), 'mt'),
      kyc: db.kyc?.[user] ? { status: db.kyc[user].status, note: db.kyc[user].note, fullName: db.kyc[user].fullName, idType: db.kyc[user].idType } : null,
    },
    myBets: db.bets.filter((b) => b.userId === user).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => ({ ...b, legs: legsView(db, b.id) })),
    example: true, readOnly,
  };
}

/** Pré-visualização de exemplo (produção sem jogos agendados): só leitura, nada guardado. */
export function exampleView(): BetsView {
  const now = Date.now();
  return demoView(seedDemo(now), now, '__none__', true);
}

/* ---------------- Real (Supabase) ---------------- */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const num = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));
const mapSettings = (r: Row | null): BetSettings => r ? ({
  betsEnabled: r.bets_enabled !== false,
  margin: num(r.margin, 0.07), minStake: num(r.min_stake, 10), maxStake: num(r.max_stake, 5000), maxPayout: num(r.max_payout, 100000), maxLegs: num(r.max_legs, 10),
  weeklyAllowance: num(r.weekly_allowance, 1000), eloK: num(r.elo_k, 32), bigStakeAlert: num(r.big_stake_alert, 2000), sameSelectionAlert: num(r.same_selection_alert, 20),
  realMoneyEnabled: !!r.real_money_enabled, igjLicenceNo: r.igj_licence_no ?? '', igjLicenceDate: r.igj_licence_date ?? '', igjLicenceExpiry: r.igj_licence_expiry ?? '',
  mtMinStake: num(r.mt_min_stake, 10), mtMaxStake: num(r.mt_max_stake, 2000), mtMaxPayout: num(r.mt_max_payout, 50000), mtMinWithdraw: num(r.mt_min_withdraw, 50), mtMaxWithdrawDaily: num(r.mt_max_withdraw_daily, 20000),
}) : { ...DEFAULT_SETTINGS };
const mapMatch = (r: Row): Match => ({
  id: r.id, game: r.game_key, tournamentId: r.tournament_id, tournamentName: r.tournament_name ?? '', home: r.home, away: r.away, homeTeamId: r.home_team_id, awayTeamId: r.away_team_id,
  startsAt: r.starts_at, originalStartsAt: r.original_starts_at, status: r.status, homeScore: r.home_score, awayScore: r.away_score, settledVersion: r.settled_version,
  eloHome: num(r.elo_home), eloAway: num(r.elo_away), eloApplied: r.elo_applied, voided: r.voided,
});
const mapMarket = (r: Row): Market => ({
  id: r.id, matchId: r.match_id, tournamentId: r.tournament_id, tournamentName: r.tournament_name ?? '', game: r.game_key, kind: r.kind, line: r.line == null ? null : Number(r.line),
  title: r.title, status: r.status, autoSuspended: r.auto_suspended, manualVoid: r.manual_void, margin: r.margin == null ? null : Number(r.margin), closesAt: r.closes_at,
});
const mapSel = (r: Row): Selection => ({ id: r.id, marketId: r.market_id, code: r.code, label: r.label, prob: num(r.prob), odds: num(r.odds), manual: r.manual, result: r.result, sort: r.sort });
const mapBet = (r: Row): MyBet => ({
  id: r.id, userId: r.user_id, kind: r.kind, stake: r.stake, totalOdds: num(r.total_odds), potential: r.potential, status: r.status, payout: r.payout, version: r.version,
  createdAt: r.created_at, settledAt: r.settled_at, currency: r.currency ?? 'pontos',
  legs: (r.bet_legs ?? []).map((l: Row) => ({
    betId: r.id, selectionId: l.selection_id, marketId: l.market_id, groupId: l.group_id, odds: num(l.odds), result: l.result,
    label: l.bet_selections?.label ?? '—', market: l.bet_markets?.title ?? '',
    event: l.bet_markets?.bet_matches ? `${l.bet_markets.bet_matches.home} vs ${l.bet_markets.bet_matches.away}` : (l.bet_markets?.tournament_name || 'Torneio'),
  })),
});
const BET_SELECT = 'id,user_id,currency,kind,stake,total_odds,potential,status,payout,version,created_at,settled_at,bet_legs(selection_id,market_id,group_id,odds,result,bet_selections(label),bet_markets(title,tournament_name,bet_matches(home,away)))';

async function rpc<T = Row>(fn: string, args?: Row): Promise<T> {
  const c = await sb();
  const { data, error } = await c.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}
const mapWd = (w: Row): Withdrawal => ({ id: w.id, userId: w.user_id, amount: w.amount, method: w.method, phone: w.phone, status: w.status, reference: w.reference ?? '', note: w.note ?? '', createdAt: w.created_at, decidedAt: w.decided_at });
const res = (d: Row): Res => (d?.ok ? { ok: true } : { ok: false, code: d?.code ?? 'ERRO' });

async function realLoad(admin = false): Promise<BetsView> {
  const c = await sb();
  await c.rpc('bets_sweep').then(() => undefined, () => undefined);
  const since = new Date(Date.now() - 3 * 86400e3).toISOString();
  const [{ data: st }, { data: ms, error: e1 }] = await Promise.all([
    c.from('bet_settings').select('*').eq('id', 1).maybeSingle(),
    c.from('bet_matches').select('*').or(`status.in.(agendado,ao_vivo,adiado),starts_at.gte.${since}`).order('starts_at').limit(120),
  ]);
  if (e1) throw new Error(e1.message);
  const matches = (ms ?? []).map(mapMatch);
  const ids = matches.map((m) => m.id);
  const [{ data: mk1 }, { data: mk2 }] = await Promise.all([
    ids.length ? c.from('bet_markets').select('*').in('match_id', ids) : Promise.resolve({ data: [] as Row[] }),
    c.from('bet_markets').select('*').eq('kind', 'outright').or(`status.in.(aberto,suspenso),settled_at.gte.${since}`).limit(40),
  ]);
  const markets = [...(mk1 ?? []), ...(mk2 ?? [])].map(mapMarket);
  const mids = markets.map((m) => m.id);
  const selections: Selection[] = [];
  for (let i = 0; i < mids.length; i += 80) {
    const { data } = await c.from('bet_selections').select('*').in('market_id', mids.slice(i, i + 80));
    selections.push(...(data ?? []).map(mapSel));
  }
  let me: Me | null = null; let myBets: MyBet[] = []; let weeklyCredited = false;
  const { data: ses } = await c.auth.getSession();
  if (ses.session) {
    const w = await rpc('bets_claim_weekly').catch(() => null);
    weeklyCredited = !!w?.credited;
    const m = await rpc('bets_me').catch(() => null);
    if (m?.ok) me = {
      balance: m.balance, weekClaimed: m.week_claimed, stakedToday: m.staked_today, stakedWeek: m.staked_week,
      balanceMt: m.balance_mt ?? 0, mtStakedToday: m.mt_staked_today ?? 0, mtStakedWeek: m.mt_staked_week ?? 0,
      kyc: m.kyc ? { status: m.kyc.status, note: m.kyc.note ?? '', fullName: m.kyc.full_name ?? '', idType: m.kyc.id_type ?? '' } : null,
      limits: { maxStake: m.max_stake, maxDaily: m.max_daily, maxWeekly: m.max_weekly, selfExcludedUntil: m.self_excluded_until, ageConfirmedAt: m.age_confirmed_at, mtMaxStake: m.mt_max_stake, mtMaxDaily: m.mt_max_daily, mtMaxWeekly: m.mt_max_weekly },
    };
    const { data: bs } = await c.from('bets').select(BET_SELECT).eq('user_id', ses.session.user.id).order('created_at', { ascending: false }).limit(60);
    myBets = (bs ?? []).map(mapBet);
  }
  const teamIds = Array.from(new Set(matches.flatMap((m) => [m.homeTeamId, m.awayTeamId])));
  const teams: Record<string, TeamInfo> = {};
  if (teamIds.length) {
    const { data: tr } = await c.from('bet_teams').select('id,name,game_key,logo_url').in('id', teamIds);
    for (const t of tr ?? []) teams[t.id] = { id: t.id, name: t.name, game: t.game_key, logo: t.logo_url ?? '' };
  }
  const view: BetsView = { settings: mapSettings(st), teams, matches, markets, selections, me, myBets, example: false, readOnly: false, weeklyCredited };
  if (!admin && !markets.some((m) => m.status === 'aberto' || m.status === 'suspenso') && !myBets.length) {
    const ex = exampleView();
    return { ...ex, settings: view.settings, me, myBets, weeklyCredited };
  }
  return view;
}

/* ---------------- API pública ---------------- */
export const betsApi = {
  async load(opts: { admin?: boolean } = {}): Promise<BetsView> {
    if (IS_DEMO) return withDemo((db, now) => { const w = core.claimWeekly(db, DEMO_USER, now); return { ...demoView(db, now, DEMO_USER, false), weeklyCredited: w.credited }; });
    return realLoad(!!opts.admin);
  },
  async confirmAge(birth: string | null): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.confirmAge(db, DEMO_USER, birth || null, now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_confirm_age'));
  },
  async place(inp: PlaceInput): Promise<PlaceResult> {
    if (IS_DEMO) return withDemo((db, now) => core.placeBet(db, DEMO_USER, inp, now));
    const d = await rpc('bets_place', { p_selection_ids: inp.selectionIds, p_stake: inp.stake, p_odds: inp.odds, p_accept_changes: !!inp.acceptChanges, p_currency: inp.currency ?? 'pontos' });
    if (d?.ok) return { ok: true, betId: d.bet_id, balance: d.balance };
    return { ok: false, code: d?.code ?? 'NOT_FOUND', odds: d?.odds ?? undefined };
  },
  async setLimits(l: { maxStake: number | null; maxDaily: number | null; maxWeekly: number | null; mtMaxStake: number | null; mtMaxDaily: number | null; mtMaxWeekly: number | null }): Promise<Res> {
    if (IS_DEMO) return withDemo((db) => { try { core.setLimits(db, DEMO_USER, l); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_set_limits', { p_max_stake: l.maxStake, p_max_daily: l.maxDaily, p_max_weekly: l.maxWeekly, p_mt_max_stake: l.mtMaxStake, p_mt_max_daily: l.mtMaxDaily, p_mt_max_weekly: l.mtMaxWeekly }));
  },
  async selfExclude(days: number): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { core.selfExclude(db, DEMO_USER, days, now); return { ok: true } as Res; });
    return res(await rpc('bets_self_exclude', { p_days: days }));
  },

  /* ----- Dinheiro real (MT) ----- */
  async submitKyc(k: KycInput): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.submitKyc(db, DEMO_USER, k, now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_kyc_submit', { p_full_name: k.fullName, p_birth_date: k.birthDate, p_id_type: k.idType, p_id_number: k.idNumber, p_phone: k.phone }));
  },
  async withdraw(amount: number, method: 'M-Pesa' | 'e-Mola', phone: string): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.requestWithdrawal(db, DEMO_USER, amount, method, phone, now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_withdraw_request', { p_amount: amount, p_method: method, p_phone: phone }));
  },
  async myMoney(): Promise<MoneyView> {
    if (IS_DEMO) return withDemo((db) => ({ ledger: db.money.filter((r) => r.userId === DEMO_USER).slice().reverse(), withdrawals: db.withdrawals.filter((w) => w.userId === DEMO_USER) }));
    const c = await sb();
    const { data: ses } = await c.auth.getSession();
    if (!ses.session) return { ledger: [], withdrawals: [] };
    const [{ data: l }, { data: w }] = await Promise.all([
      c.from('money_ledger').select('*').eq('user_id', ses.session.user.id).order('id', { ascending: false }).limit(100),
      c.from('money_withdrawals').select('*').eq('user_id', ses.session.user.id).order('created_at', { ascending: false }).limit(50),
    ]);
    return {
      ledger: (l ?? []).map((r: Row) => ({ id: r.id, userId: r.user_id, delta: r.delta, reason: r.reason, ref: r.ref, balanceAfter: r.balance_after, createdAt: r.created_at, currency: 'mt' as const })),
      withdrawals: (w ?? []).map(mapWd),
    };
  },

  /* ----- Admin ----- */
  async adminOverview(): Promise<AdminOverview> {
    if (IS_DEMO) return withDemo((db) => {
      const o = core.overview(db);
      const name = (u: string) => (u === DEMO_USER ? 'Tu (demo)' : db.bets.find((b) => b.userId === u)?.userName ?? u);
      const all = db.bets;
      return {
        exposure: o.exposure, alerts: o.alerts.map((a) => ({ ...a, text: a.text.replace(/\(([^)]+)\)$/, (_, u) => `(${name(u)})`) })),
        users: o.users.map((u) => ({ ...u, handle: name(u.userId), balance: core.balanceOf(db, u.userId), stakedMt: 0, balanceMt: core.balanceOf(db, u.userId, 'mt') })),
        totals: (() => {
          const P = all.filter((b) => (b.currency ?? 'pontos') === 'pontos'), M = all.filter((b) => b.currency === 'mt');
          const sum = (L: typeof all, f: (b: Bet) => number) => L.reduce((a, b) => a + f(b), 0);
          return { bets: all.length, open: all.filter((b) => b.status === 'aberta').length, staked: sum(P, (b) => b.stake), paid: sum(P, (b) => b.payout), liability: sum(P.filter((b) => b.status === 'aberta'), (b) => b.potential),
            stakedMt: sum(M, (b) => b.stake), paidMt: sum(M, (b) => b.payout), liabilityMt: sum(M.filter((b) => b.status === 'aberta'), (b) => b.potential) };
        })(),
      };
    });
    const d = await rpc('bets_admin_overview');
    if (!d?.ok) throw new Error(d?.code ?? 'ERRO');
    return {
      exposure: (d.exposure ?? []).map((e: Row) => ({ selectionId: e.selection_id, label: e.label, market: e.market, event: e.event, bets: e.bets, staked: e.staked, liability: e.liability })),
      alerts: d.alerts ?? [], users: (d.users ?? []).map((u: Row) => ({ userId: u.user_id, handle: '@' + u.handle, bets: u.bets, staked: u.staked ?? 0, returned: u.returned ?? 0, open: u.open, balance: u.balance, stakedMt: u.staked_mt ?? 0, balanceMt: u.balance_mt ?? 0 })),
      totals: { bets: d.totals.bets, open: d.totals.open, staked: d.totals.staked, paid: d.totals.paid, liability: d.totals.liability, stakedMt: d.totals.staked_mt ?? 0, paidMt: d.totals.paid_mt ?? 0, liabilityMt: d.totals.liability_mt ?? 0 },
    };
  },
  async adminBets(): Promise<AdminBet[]> {
    if (IS_DEMO) return withDemo((db) => db.bets.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => ({ ...b, handle: b.userId === DEMO_USER ? 'Tu (demo)' : b.userName ?? b.userId, legs: legsView(db, b.id) })));
    const c = await sb();
    const { data, error } = await c.from('bets').select(BET_SELECT + ',profiles(handle)').order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Row) => ({ ...mapBet(r), handle: '@' + (r.profiles?.handle ?? '?') }));
  },
  async adminLog(): Promise<LogRow[]> {
    if (IS_DEMO) return withDemo((db) => db.log.slice(0, 200));
    const c = await sb();
    const { data, error } = await c.from('bet_admin_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: Row) => ({ id: r.id, at: r.created_at, actor: r.actor_handle ? '@' + r.actor_handle : 'sistema', action: r.action, target: r.target, details: JSON.stringify(r.details ?? {}) }));
  },
  async createMatch(inp: core.MatchInput): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.createMatch(db, inp, 'Ana (admin)', now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_admin_create_match', { p_game: inp.game, p_home: inp.home, p_away: inp.away, p_starts_at: inp.startsAt, p_tournament_id: inp.tournamentId || null }));
  },
  async matchAction(id: string, action: 'resultado' | 'anular' | 'cancelar' | 'adiar' | 'reagendar', o: { startsAt?: string; home?: number; away?: number } = {}): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => {
      try {
        const A = 'Ana (admin)';
        if (action === 'resultado') core.recordResult(db, id, o.home!, o.away!, A, now);
        else if (action === 'anular') core.voidMatch(db, id, A, now);
        else if (action === 'cancelar') core.cancelMatch(db, id, A, now);
        else if (action === 'adiar') core.postponeMatch(db, id, A, now);
        else core.rescheduleMatch(db, id, o.startsAt!, A, now);
        return { ok: true } as Res;
      } catch (e) { return { ok: false, code: (e as Error).message }; }
    });
    return res(await rpc('bets_admin_match_action', { p_match: id, p_action: action, p_starts_at: o.startsAt ?? null, p_home: o.home ?? null, p_away: o.away ?? null }));
  },
  async marketAction(id: string, action: 'suspender' | 'reabrir' | 'odd' | 'odds_auto' | 'margem' | 'anular' | 'vencedor', value: number | null = null, selection: string | null = null): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => {
      try {
        const A = 'Ana (admin)';
        if (action === 'suspender' || action === 'reabrir') core.setMarketStatus(db, id, action === 'reabrir' ? 'aberto' : 'suspenso', A, now);
        else if (action === 'odd') core.overrideOdds(db, selection!, value!, A, now);
        else if (action === 'odds_auto') core.resetOdds(db, id, A, now);
        else if (action === 'margem') core.setMarketMargin(db, id, value, A, now);
        else if (action === 'anular') core.voidMarket(db, id, A, now);
        else core.settleOutright(db, id, selection!, A, now);
        return { ok: true } as Res;
      } catch (e) { return { ok: false, code: (e as Error).message }; }
    });
    return res(await rpc('bets_admin_market_action', { p_market: id, p_action: action, p_value: value, p_selection: selection }));
  },
  async saveSettings(p: Partial<BetSettings>): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.saveSettings(db, p, 'Ana (admin)', now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_admin_save_settings', { p: {
      margin: p.margin, min_stake: p.minStake, max_stake: p.maxStake, max_payout: p.maxPayout, max_legs: p.maxLegs, weekly_allowance: p.weeklyAllowance,
      elo_k: p.eloK, big_stake_alert: p.bigStakeAlert, same_selection_alert: p.sameSelectionAlert,
      mt_min_stake: p.mtMinStake, mt_max_stake: p.mtMaxStake, mt_max_payout: p.mtMaxPayout, mt_min_withdraw: p.mtMinWithdraw, mt_max_withdraw_daily: p.mtMaxWithdrawDaily,
    } }));
  },
  async setRealMoney(on: boolean, lic: { licenceNo: string; issue: string; expiry: string; confirm: string }): Promise<{ ok: true } | { ok: false; code: string; reason?: string }> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.setRealMoney(db, on, lic, 'Ana (admin)', now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    const d = await rpc('bets_admin_set_real_money', { p_on: on, p_licence_no: lic.licenceNo, p_issue: lic.issue || null, p_expiry: lic.expiry || null, p_confirm: lic.confirm });
    return d?.ok ? { ok: true } : { ok: false, code: d?.code ?? 'ERRO', reason: d?.reason };
  },
  async setEnabled(on: boolean): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { core.setBetsEnabled(db, on, 'Ana (admin)', now); return { ok: true } as Res; });
    return res(await rpc('bets_admin_set_enabled', { p_on: on }));
  },
  async teamLogo(teamId: string, url: string | null): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.setTeamLogo(db, teamId, url, 'Ana (admin)', now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_admin_team_logo', { p_team: teamId, p_url: url }));
  },
  async allTeams(): Promise<TeamInfo[]> {
    if (IS_DEMO) return withDemo((db) => db.teams.map((t) => ({ id: t.id, name: t.name, game: t.game, logo: t.logo ?? '' })));
    const c = await sb();
    const { data, error } = await c.from('bet_teams').select('id,name,game_key,logo_url').order('name').limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map((t: Row) => ({ id: t.id, name: t.name, game: t.game_key, logo: t.logo_url ?? '' }));
  },
  async adminMoney(): Promise<AdminMoney> {
    if (IS_DEMO) return withDemo((db) => {
      const name = (u: string) => (u === DEMO_USER ? 'Tu (demo)' : db.bets.find((b) => b.userId === u)?.userName ?? u);
      const dep = db.money.filter((r) => r.reason === 'deposito').reduce((a, r) => a + r.delta, 0);
      return {
        kyc: Object.entries(db.kyc).map(([u, k]) => ({ userId: u, handle: name(u), ...k, balance: core.balanceOf(db, u, 'mt') })),
        withdrawals: db.withdrawals.map((w) => ({ ...w, handle: name(w.userId) })),
        totals: { deposits: dep, withdrawn: db.withdrawals.filter((w) => w.status === 'pago').reduce((a, w) => a + w.amount, 0), pendingWithdrawals: db.withdrawals.filter((w) => w.status === 'pendente').reduce((a, w) => a + w.amount, 0),
          balances: Object.keys(db.kyc).reduce((a, u) => a + core.balanceOf(db, u, 'mt'), 0) },
      };
    });
    const d = await rpc('bets_admin_money');
    if (!d?.ok) throw new Error(d?.code ?? 'ERRO');
    return {
      kyc: (d.kyc ?? []).map((k: Row) => ({ userId: k.user_id, handle: '@' + (k.handle ?? '?'), fullName: k.full_name, birthDate: k.birth_date, idType: k.id_type, idNumber: k.id_number, phone: k.phone, status: k.status, note: k.note, submittedAt: k.submitted_at, balance: k.balance })),
      withdrawals: (d.withdrawals ?? []).map((w: Row) => ({ ...mapWd(w), handle: '@' + (w.handle ?? '?') })),
      totals: { deposits: d.totals.deposits, withdrawn: d.totals.withdrawn, pendingWithdrawals: d.totals.pending_withdrawals, balances: d.totals.balances },
    };
  },
  async kycReview(user: string, status: 'aprovado' | 'recusado', note: string): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.reviewKyc(db, user, status, note, 'Ana (admin)', now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_admin_kyc_review', { p_user: user, p_status: status, p_note: note }));
  },
  async deposit(user: string, amount: number, method: string, reference: string): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.adminDeposit(db, user, amount, method, reference, 'Ana (admin)', now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_admin_deposit', { p_user: user, p_amount: amount, p_method: method, p_reference: reference }));
  },
  async decideWithdrawal(id: string, action: 'pago' | 'recusado', reference: string): Promise<Res> {
    if (IS_DEMO) return withDemo((db, now) => { try { core.decideWithdrawal(db, id, action, reference, 'Ana (admin)', now); return { ok: true } as Res; } catch (e) { return { ok: false, code: (e as Error).message }; } });
    return res(await rpc('bets_admin_withdrawal', { p_id: id, p_action: action, p_reference: reference }));
  },
};

export { NO_LIMITS };
export const RES_TEXT: Record<string, string> = {
  FORBIDDEN: 'Sem permissão.', MINOR: 'A tua conta indica menos de 18 anos. As apostas não estão disponíveis para ti.', TEAMS: 'Indica duas equipas diferentes.',
  DATE: 'Data/hora inválida.', TOURNAMENT: 'Torneio não encontrado.', MATCH: 'Este jogo já não pode ser alterado.', SCORE: 'Resultado inválido.',
  MARKET: 'Mercado já fechado.', STARTED: 'O jogo já começou: não é possível reabrir.', SEL: 'Seleção inválida.', ODDS: 'Odd inválida (1.01 a 1000).',
  MARGIN: 'Margem entre 0 % e 50 %.', INVALID: 'Valores inválidos: verifica mínimo ≤ máximo ≤ pagamento máximo, margem 0–50 %, múltiplas 1–10.', LIMITS: 'Verifica mínimo ≤ máximo ≤ pagamento máximo.',
  LEGS: 'Múltiplas entre 1 e 10 seleções.', IGJ: 'Não ativado: confirma nº da licença IGJ, emissão, validade (futura) e escreve CONFIRMO.',
  LIMIT: 'Limite inválido.', KYC: 'Verificação de identidade (KYC) ainda não aprovada.', KYC_INVALID: 'Dados de identificação inválidos.', KYC_LOCKED: 'A tua verificação já está aprovada.',
  AMOUNT: 'Valor inválido.', REF: 'Indica a referência da transação (mín. 3 caracteres).', DUP_REF: 'Esta referência já foi creditada.', REAL_OFF: 'O dinheiro real não está ativo.',
  MIN_WITHDRAW: 'Valor abaixo do levantamento mínimo.', MAX_WITHDRAW: 'Passa o limite diário de levantamentos.', BALANCE: 'Saldo insuficiente.', WITHDRAWAL: 'Pedido já tratado.', PHONE: 'Número M-Pesa/e-Mola inválido.', DAYS: 'Escolhe 7, 30 ou 90 dias.', AUTH: 'Entra na tua conta para apostar.', ERRO: 'Não foi possível concluir. Tenta outra vez.',
};
