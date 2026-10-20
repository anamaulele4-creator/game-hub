// TXAPILOG · Módulo competitivo — acesso aos dados.
// Modo real: Supabase (RPCs SECURITY DEFINER de supabase/competitive.sql + leituras com RLS). O cliente nunca escreve tabelas.
// Modo demo: motor em memória (lib/competitiveCore.ts) no localStorage, com dados "Exemplo" claramente identificados.
import { IS_DEMO, SUPABASE_URL } from './config';
import { sb } from './supabase';
import * as core from './competitiveCore';
import type { CDB } from './competitiveCore';
import { DEFAULT_FLAGS, bettingOn, monetaryOn, newIdemKey } from './competitive';
import type { BetTerms, ChallengeStatus, CompGame, EligibilityReason, Licence, MemberRole, Pick } from './competitive';

/* ---------------- Tipos de vista (iguais nos dois modos) ---------------- */
export interface TeamLite { id: string; name: string; tag: string | null; logo: string | null; game: CompGame; rating: number }
export interface TeamView extends TeamLite { province: string | null; bio: string; captainId: string; status: string; played: number; wins: number; draws: number; losses: number; example?: boolean }
export interface MemberView { userId: string; handle: string; name: string; avatar: string | null; role: MemberRole; canManageChallenges: boolean }
export interface InviteView { id: string; teamId: string; teamName: string; userHandle?: string; status: string; createdAt: string }
export interface ChallengeView {
  id: string; game: CompGame; status: ChallengeStatus; title: string; rules: string; playersPerTeam: number; bestOf: number; scheduledAt: string | null;
  challenger: TeamLite; opponent: TeamLite | null; challengerScore: number | null; opponentScore: number | null; winnerTeamId: string | null;
  resultSource: string | null; resultVerifiedAt: string | null; cancelReason: string | null; createdAt: string; example?: boolean;
}
export interface EventRow { from: string | null; to: string; action: string; at: string; details: Record<string, unknown> }
export interface EventView {
  challenge: ChallengeView; challengerTeam: TeamView; opponentTeam: TeamView | null; events: EventRow[];
  submissions: { teamId: string; challengerScore: number; opponentScore: number; proofs: string[]; at: string }[];
  predictions: Record<Pick, number>; myPrediction: Pick | null;
  disputes: { id: string; reason: string; status: string; resolution: string | null; evidence: string[]; at: string; teamId: string | null }[];
  market: { selections: { id: string; code: string; label: string; odds: number; marketStatus: string }[]; status: string } | null;
  canManageChallenger: boolean; canManageOpponent: boolean; bettingOn: boolean;
}
export interface WalletView {
  available: number; reserved: number; total: number; reservedWithdrawals: number; reservedBets: number;
  ledger: { id: string; delta: number; reason: string; ref: string; balanceAfter: number; at: string }[];
  deposits: { id: string; amount: number; status: string; method: string; at: string }[];
  monetaryOn: boolean; bettingOn: boolean; providerReady: boolean; eligibility: { ok: boolean; reasons: EligibilityReason[] };
  limits: { depositDaily: number | null; depositWeekly: number | null; depositMonthly: number | null; coolOffUntil: string | null; selfExcludedUntil: string | null; pending: unknown; pendingEffectiveAt: string | null };
}
export interface Me { id: string; handle: string; isAdmin: boolean; aal: 'aal1' | 'aal2' }
export interface AdminView {
  settings: Record<string, unknown>; licences: Licence[]; providers: { provider: string; configured: boolean; live: boolean; checked_at: string }[];
  monetaryOn: boolean; bettingOn: boolean; strongAuth: boolean;
  counts: { teams: number; challenges: Record<string, number>; open_disputes: number; risk_open: number };
  disputes: Row[]; review: Row[]; teams: Row[]; risk: Row[]; audit: Row[]; transactions: Row[]; activity: Record<string, number>;
}
export type Res<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; code: string; reasons?: string[] };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/* ---------------- Demo ---------------- */
const KEY = 'txap-comp-demo-v1';
export const DEMO_ME = 'demo';
const H = 3600e3;
function seed(now: number): CDB {
  const db = core.emptyCDB();
  db.users.push({ id: DEMO_ME, handle: 'tu_demo', name: 'Tu (demo)', birthDate: '1995-06-01', province: 'Maputo Cidade', kyc: null, admin: true });
  const ex = ['ex_jogador1', 'ex_jogador2', 'ex_jogador3', 'ex_jogador4', 'ex_jogador5', 'ex_jogador6'];
  ex.forEach((h, i) => db.users.push({ id: h, handle: h, name: `Jogador Exemplo ${i + 1}`, birthDate: '1999-01-01', province: 'Sofala', kyc: null }));
  const t = (cap: string, mem: string, name: string, game: CompGame) => {
    const id = (core.createTeam(db, cap, { name, game, bio: 'Equipa fictícia do modo demonstração.' }, now - 72 * H) as { teamId: string }).teamId;
    core.respondInvite(db, mem, (core.invite(db, cap, id, mem, now - 72 * H) as { inviteId: string }).inviteId, true, now - 72 * H);
    db.teams.find((x) => x.id === id)!.example = true;
    return id;
  };
  const a = t('ex_jogador1', 'ex_jogador2', 'Exemplo Mambas', 'eFootball');
  const b = t('ex_jogador3', 'ex_jogador4', 'Exemplo Leões', 'eFootball');
  const c = t('ex_jogador5', 'ex_jogador6', 'Exemplo Fénix', 'Free Fire');
  // concluído (histórico)
  const done = (core.createChallenge(db, 'ex_jogador1', { teamId: a, opponentId: b, title: 'Amigável de exemplo', rules: 'Melhor de 1, 6 minutos por parte.', players: 1, bestOf: 1, scheduledAt: new Date(now - 46 * H).toISOString(), publish: true, idem: null }, now - 48 * H) as { challengeId: string }).challengeId;
  core.respondChallenge(db, 'ex_jogador3', done, true, null, '', now - 47 * H);
  core.sweep(db, now - 45 * H);
  core.submitResult(db, 'ex_jogador1', done, a, 2, 1, [], now - 44 * H);
  core.submitResult(db, 'ex_jogador3', done, b, 2, 1, [], now - 44 * H);
  // agendado
  const sch = (core.createChallenge(db, 'ex_jogador3', { teamId: b, opponentId: a, title: 'Desforra (exemplo)', rules: 'Melhor de 3. Sem pausas.', players: 2, bestOf: 3, scheduledAt: new Date(now + 26 * H).toISOString(), publish: true, idem: null }, now - H) as { challengeId: string }).challengeId;
  core.respondChallenge(db, 'ex_jogador1', sch, true, null, '', now - H / 2);
  // aberto (qualquer equipa de Free Fire pode aceitar)
  core.createChallenge(db, 'ex_jogador5', { teamId: c, opponentId: null, title: 'Squad aberto (exemplo)', rules: 'Modo Contra Squad, 3 rondas.', players: 2, bestOf: 3, scheduledAt: new Date(now + 50 * H).toISOString(), publish: true, idem: null }, now - 2 * H);
  db.challenges.forEach((x) => { x.example = true; });
  db.audit = [];
  return db;
}
function load(now: number): CDB {
  let db: CDB | null = null;
  try { const raw = localStorage.getItem(KEY); if (raw) db = JSON.parse(raw) as CDB; } catch { /* sem armazenamento */ }
  if (!db?.users?.length) db = seed(now);
  core.sweep(db, now);
  return db;
}
function save(db: CDB) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* cheio */ } }
function demo<T>(fn: (db: CDB, now: number) => T): T { const now = Date.now(); const db = load(now); const r = fn(db, now); save(db); return r; }
const DEMO_SEEN = new Set<string>();

const lite = (t: core.CTeam): TeamLite => ({ id: t.id, name: t.name, tag: t.tag, logo: t.logo, game: t.game, rating: t.rating });
const teamV = (t: core.CTeam): TeamView => ({ ...lite(t), province: t.province, bio: t.bio, captainId: t.captainId, status: t.status, played: t.played, wins: t.wins, draws: t.draws, losses: t.losses, example: t.example });
function chV(db: CDB, c: core.CChallenge): ChallengeView {
  const a = db.teams.find((t) => t.id === c.challengerTeamId)!; const b = c.opponentTeamId ? db.teams.find((t) => t.id === c.opponentTeamId)! : null;
  return { id: c.id, game: c.game, status: c.status, title: c.title, rules: c.rules, playersPerTeam: c.playersPerTeam, bestOf: c.bestOf, scheduledAt: c.scheduledAt,
    challenger: lite(a), opponent: b ? lite(b) : null, challengerScore: c.challengerScore, opponentScore: c.opponentScore, winnerTeamId: c.winnerTeamId,
    resultSource: c.resultSource, resultVerifiedAt: c.resultVerifiedAt, cancelReason: c.cancelReason, createdAt: c.createdAt, example: c.example };
}
const r2 = <T extends object>(x: T) => x as unknown as Res<T>;

/* ---------------- Real ---------------- */
const NOT_INSTALLED = /could not find the function|does not exist|schema cache|relation .* does not exist/i;
async function rpc(fn: string, args: Row = {}): Promise<Row> {
  const c = await sb();
  const { data, error } = await c.rpc(fn, args);
  // Sem sessão o Postgres recusa a função (42501 permission denied): mostra "Entra na tua conta" em vez de um erro genérico
  if (error) return { ok: false, code: NOT_INSTALLED.test(error.message) ? 'NOT_INSTALLED' : (error.message.match(/COMP_[A-Z_]+/)?.[0] ?? (error.code === '42501' || /permission denied|JWT/i.test(error.message) ? 'AUTH' : 'ERRO')), message: error.message };
  return (data ?? {}) as Row;
}
async function session() { const c = await sb(); const { data } = await c.auth.getSession(); return data.session; }
const num = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));
const mapLite = (t: Row | null): TeamLite | null => (t ? { id: t.id, name: t.name, tag: t.tag ?? null, logo: t.logo_url ?? null, game: t.game, rating: num(t.rating, 1500) } : null);
const mapTeam = (t: Row): TeamView => ({ ...(mapLite(t) as TeamLite), province: t.province ?? null, bio: t.bio ?? '', captainId: t.captain_id, status: t.status ?? 'ativa',
  played: num(t.played), wins: num(t.wins), draws: num(t.draws), losses: num(t.losses) });
const mapCh = (c: Row, a: Row | null, b: Row | null): ChallengeView => ({
  id: c.id, game: c.game, status: c.status, title: c.title ?? '', rules: c.rules ?? '', playersPerTeam: c.players_per_team, bestOf: c.best_of, scheduledAt: c.scheduled_at,
  challenger: mapLite(a) ?? { id: c.challenger_team_id, name: '—', tag: null, logo: null, game: c.game, rating: 1500 }, opponent: mapLite(b),
  challengerScore: c.challenger_score, opponentScore: c.opponent_score, winnerTeamId: c.winner_team_id, resultSource: c.result_source, resultVerifiedAt: c.result_verified_at,
  cancelReason: c.cancel_reason, createdAt: c.created_at,
});
const CH_SELECT = '*, challenger:comp_teams!comp_challenges_challenger_team_id_fkey(id,name,tag,logo_url,game,rating), opponent:comp_teams!comp_challenges_opponent_team_id_fkey(id,name,tag,logo_url,game,rating)';
const res = (d: Row): Res => (d?.ok ? { ok: true, ...d } : { ok: false, code: d?.code ?? 'ERRO', reasons: d?.reasons });

/* ---------------- API ---------------- */
export const compApi = {
  demo: IS_DEMO,
  newIdem: newIdemKey,

  async me(): Promise<Me | null> {
    if (IS_DEMO) return { id: DEMO_ME, handle: 'tu_demo', isAdmin: true, aal: 'aal2' };
    const s = await session(); if (!s) return null;
    const c = await sb();
    const [{ data: p }, aal] = await Promise.all([
      c.from('profiles').select('handle, role').eq('id', s.user.id).maybeSingle(),
      c.auth.mfa.getAuthenticatorAssuranceLevel().then((r) => r.data?.currentLevel ?? 'aal1').catch(() => 'aal1'),
    ]);
    return { id: s.user.id, handle: p?.handle ?? '', isAdmin: p?.role === 'admin', aal: aal === 'aal2' ? 'aal2' : 'aal1' };
  },
  async sweep(): Promise<void> { if (IS_DEMO) { demo(() => 0); return; } await rpc('comp_sweep'); },

  /* ----- Equipas ----- */
  async teams(opts: { q?: string; game?: string } = {}): Promise<TeamView[]> {
    if (IS_DEMO) return demo((db) => db.teams.filter((t) => t.status !== 'dissolvida' && (!opts.game || t.game === opts.game) && (!opts.q || t.name.toLowerCase().includes(opts.q.toLowerCase())))
      .sort((a, b) => b.rating - a.rating).map(teamV));
    const c = await sb();
    let qy = c.from('comp_teams').select('*').eq('status', 'ativa').order('rating', { ascending: false }).limit(100);
    if (opts.game) qy = qy.eq('game', opts.game);
    if (opts.q) qy = qy.ilike('name', `%${opts.q.replace(/[%_]/g, '')}%`);
    const { data } = await qy;
    return (data ?? []).map(mapTeam);
  },
  async team(id: string): Promise<{ team: TeamView; members: MemberView[]; challenges: ChallengeView[]; invites: InviteView[] } | null> {
    if (IS_DEMO) return demo((db) => {
      const t = db.teams.find((x) => x.id === id); if (!t) return null;
      const members = core.activeMembers(db, id).map((m) => { const u = db.users.find((x) => x.id === m.userId)!; return { userId: u.id, handle: u.handle, name: u.name, avatar: null, role: m.role, canManageChallenges: m.canManageChallenges }; });
      const challenges = db.challenges.filter((c) => c.challengerTeamId === id || c.opponentTeamId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => chV(db, c));
      const invites = db.invites.filter((i) => i.teamId === id && i.status === 'pendente').map((i) => ({ id: i.id, teamId: id, teamName: t.name, userHandle: db.users.find((u) => u.id === i.userId)?.handle, status: i.status, createdAt: i.createdAt }));
      return { team: teamV(t), members, challenges, invites };
    });
    const c = await sb();
    const [{ data: t }, { data: m }, { data: ch }, { data: inv }] = await Promise.all([
      c.from('comp_teams').select('*').eq('id', id).maybeSingle(),
      c.from('comp_team_members').select('user_id, role, can_manage_challenges, profiles(handle, display_name, avatar_url)').eq('team_id', id).is('left_at', null),
      c.from('comp_challenges').select(CH_SELECT).or(`challenger_team_id.eq.${id},opponent_team_id.eq.${id}`).order('created_at', { ascending: false }).limit(50),
      c.from('comp_team_invites').select('id, team_id, status, created_at, profiles!comp_team_invites_user_id_fkey(handle)').eq('team_id', id).eq('status', 'pendente'),
    ]);
    if (!t) return null;
    return {
      team: mapTeam(t),
      members: (m ?? []).map((r: Row) => ({ userId: r.user_id, handle: r.profiles?.handle ?? '', name: r.profiles?.display_name ?? '', avatar: r.profiles?.avatar_url ?? null, role: r.role, canManageChallenges: r.can_manage_challenges })),
      challenges: (ch ?? []).map((r: Row) => mapCh(r, r.challenger, r.opponent)),
      invites: (inv ?? []).map((r: Row) => ({ id: r.id, teamId: r.team_id, teamName: t.name, userHandle: r.profiles?.handle, status: r.status, createdAt: r.created_at })),
    };
  },
  async myTeams(): Promise<(TeamView & { role: MemberRole; canManage: boolean })[]> {
    if (IS_DEMO) return demo((db) => db.members.filter((m) => m.userId === DEMO_ME && !m.leftAt).map((m) => ({ ...teamV(db.teams.find((t) => t.id === m.teamId)!), role: m.role, canManage: core.canManage(db, m.teamId, DEMO_ME) })));
    const s = await session(); if (!s) return [];
    const c = await sb();
    const { data } = await c.from('comp_team_members').select('role, can_manage_challenges, comp_teams(*)').eq('user_id', s.user.id).is('left_at', null);
    return (data ?? []).filter((r: Row) => r.comp_teams).map((r: Row) => ({ ...mapTeam(r.comp_teams), role: r.role, canManage: r.role === 'capitao' || (r.role === 'vice' && r.can_manage_challenges) }));
  },
  async myInvites(): Promise<InviteView[]> {
    if (IS_DEMO) return demo((db) => db.invites.filter((i) => i.userId === DEMO_ME && i.status === 'pendente').map((i) => ({ id: i.id, teamId: i.teamId, teamName: db.teams.find((t) => t.id === i.teamId)?.name ?? '', status: i.status, createdAt: i.createdAt })));
    const s = await session(); if (!s) return [];
    const c = await sb();
    const { data } = await c.from('comp_team_invites').select('id, team_id, status, created_at, comp_teams(name)').eq('user_id', s.user.id).eq('status', 'pendente');
    return (data ?? []).map((r: Row) => ({ id: r.id, teamId: r.team_id, teamName: r.comp_teams?.name ?? '', status: r.status, createdAt: r.created_at }));
  },
  async createTeam(p: { name: string; tag: string; game: CompGame; province: string; bio: string; logo: string | null }): Promise<Res<{ teamId: string }>> {
    if (IS_DEMO) return demo((db, now) => r2(core.createTeam(db, DEMO_ME, p, now)));
    const d = await rpc('comp_team_create', { p_name: p.name, p_tag: p.tag, p_game: p.game, p_province: p.province, p_bio: p.bio, p_logo: p.logo });
    return d.ok ? { ok: true, teamId: d.team_id } : res(d) as Res<{ teamId: string }>;
  },
  async updateTeam(id: string, p: { bio: string; province: string | null; logo: string | null; tag: string | null }): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.updateTeam(db, DEMO_ME, id, p, now)));
    return res(await rpc('comp_team_update', { p_team: id, p_bio: p.bio, p_province: p.province, p_logo: p.logo, p_tag: p.tag }));
  },
  async invite(teamId: string, handle: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.invite(db, DEMO_ME, teamId, handle, now)));
    return res(await rpc('comp_team_invite', { p_team: teamId, p_handle: handle }));
  },
  async respondInvite(id: string, accept: boolean): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.respondInvite(db, DEMO_ME, id, accept, now)));
    return res(await rpc('comp_invite_respond', { p_invite: id, p_accept: accept }));
  },
  async cancelInvite(id: string): Promise<Res> {
    if (IS_DEMO) return demo((db) => { const i = db.invites.find((x) => x.id === id); if (i) i.status = 'cancelado'; return { ok: true } as Res; });
    return res(await rpc('comp_invite_cancel', { p_invite: id }));
  },
  async memberAction(teamId: string, userId: string, action: 'sair' | 'remover' | 'vice' | 'gerir_desafios' | 'capitao', value: boolean | null = null): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.memberAction(db, DEMO_ME, teamId, userId === 'me' ? DEMO_ME : userId, action, value, now)));
    const s = await session();
    return res(await rpc('comp_team_member_action', { p_team: teamId, p_user: userId === 'me' ? s?.user.id : userId, p_action: action, p_value: value }));
  },

  /* ----- Desafios ----- */
  async challenges(filter: 'abertos' | 'meus' | 'todos'): Promise<ChallengeView[]> {
    if (IS_DEMO) return demo((db) => {
      const mine = new Set(db.members.filter((m) => m.userId === DEMO_ME && !m.leftAt).map((m) => m.teamId));
      return db.challenges.filter((c) => (filter === 'abertos' ? c.status === 'OPEN' : filter === 'meus' ? mine.has(c.challengerTeamId) || (c.opponentTeamId && mine.has(c.opponentTeamId)) : c.status !== 'DRAFT'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => chV(db, c));
    });
    const c = await sb();
    let qy = c.from('comp_challenges').select(CH_SELECT).order('created_at', { ascending: false }).limit(60);
    if (filter === 'abertos') qy = qy.eq('status', 'OPEN');
    else if (filter === 'todos') qy = qy.neq('status', 'DRAFT');
    else {
      const mine = (await compApi.myTeams()).map((t) => t.id);
      if (!mine.length) return [];
      qy = qy.or(`challenger_team_id.in.(${mine.join(',')}),opponent_team_id.in.(${mine.join(',')})`);
    }
    const { data } = await qy;
    return (data ?? []).map((r: Row) => mapCh(r, r.challenger, r.opponent));
  },
  async createChallenge(p: core.CreateChallengeInput): Promise<Res<{ challengeId: string }>> {
    if (IS_DEMO) return demo((db, now) => r2(core.createChallenge(db, DEMO_ME, p, now)));
    const d = await rpc('comp_challenge_create', { p_team: p.teamId, p_opponent: p.opponentId, p_title: p.title, p_rules: p.rules, p_players: p.players, p_best_of: p.bestOf, p_scheduled_at: p.scheduledAt, p_publish: p.publish, p_idem: p.idem });
    return d.ok ? { ok: true, challengeId: d.challenge_id } : res(d) as Res<{ challengeId: string }>;
  },
  async publish(id: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.publishChallenge(db, DEMO_ME, id, now)));
    return res(await rpc('comp_challenge_publish', { p_id: id, p_opponent: null }));
  },
  async respond(id: string, accept: boolean, team: string | null, reason = ''): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.respondChallenge(db, DEMO_ME, id, accept, team, reason, now)));
    return res(await rpc('comp_challenge_respond', { p_id: id, p_accept: accept, p_team: team, p_reason: reason }));
  },
  async schedule(id: string, at: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.scheduleChallenge(db, DEMO_ME, id, at, now)));
    return res(await rpc('comp_challenge_schedule', { p_id: id, p_at: at }));
  },
  async start(id: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.startChallenge(db, DEMO_ME, id, now)));
    return res(await rpc('comp_challenge_start', { p_id: id }));
  },
  async submitResult(id: string, team: string, cs: number, os: number, proofs: string[]): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.submitResult(db, DEMO_ME, id, team, cs, os, proofs, now)));
    return res(await rpc('comp_challenge_submit_result', { p_id: id, p_team: team, p_challenger_score: cs, p_opponent_score: os, p_proofs: proofs }));
  },
  async dispute(id: string, team: string, reason: string, evidence: string[]): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.openDispute(db, DEMO_ME, id, team, reason, evidence, now)));
    return res(await rpc('comp_challenge_dispute', { p_id: id, p_team: team, p_reason: reason, p_evidence: evidence }));
  },
  async cancel(id: string, reason: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.cancelChallenge(db, DEMO_ME, id, reason, now)));
    return res(await rpc('comp_challenge_cancel', { p_id: id, p_reason: reason }));
  },
  async predict(id: string, pick: Pick): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.predict(db, DEMO_ME, id, pick, now)));
    return res(await rpc('comp_predict', { p_id: id, p_pick: pick }));
  },
  async event(id: string): Promise<EventView | null> {
    if (IS_DEMO) return demo((db, now) => {
      const c = db.challenges.find((x) => x.id === id); if (!c) return null;
      const P = db.predictions.filter((p) => p.challengeId === id);
      const a = db.teams.find((t) => t.id === c.challengerTeamId)!; const b = c.opponentTeamId ? db.teams.find((t) => t.id === c.opponentTeamId)! : null;
      return {
        challenge: chV(db, c), challengerTeam: teamV(a), opponentTeam: b ? teamV(b) : null,
        events: db.events.filter((e) => e.challengeId === id).map((e) => ({ from: e.from, to: e.to, action: e.action, at: e.at, details: e.details })),
        submissions: db.submissions.filter((s) => s.challengeId === id).map((s) => ({ teamId: s.teamId, challengerScore: s.challengerScore, opponentScore: s.opponentScore, proofs: s.proofs, at: s.at })),
        predictions: { challenger: P.filter((p) => p.pick === 'challenger').length, draw: P.filter((p) => p.pick === 'draw').length, opponent: P.filter((p) => p.pick === 'opponent').length },
        myPrediction: P.find((p) => p.userId === DEMO_ME)?.pick ?? null,
        disputes: db.disputes.filter((d) => d.challengeId === id).map((d) => ({ id: d.id, reason: d.reason, status: d.status, resolution: d.resolution, evidence: d.evidence, at: d.at, teamId: d.teamId })),
        market: c.market && b ? { status: c.market.open ? 'aberto' : 'suspenso', selections: [
          { id: `${c.id}:challenger`, code: '1', label: a.name, odds: c.market.odds.challenger, marketStatus: c.market.open ? 'aberto' : 'suspenso' },
          { id: `${c.id}:opponent`, code: '2', label: b.name, odds: c.market.odds.opponent, marketStatus: c.market.open ? 'aberto' : 'suspenso' }] } : null,
        canManageChallenger: core.canManage(db, c.challengerTeamId, DEMO_ME), canManageOpponent: core.canManage(db, c.opponentTeamId, DEMO_ME),
        bettingOn: bettingOn(db.settings, db.licences, now),
      };
    });
    const d = await rpc('comp_challenge_public', { p_id: id });
    if (!d.ok) return null;
    const ch = d.challenge as Row;
    return {
      challenge: mapCh(ch, d.challenger, d.opponent), challengerTeam: mapTeam({ ...d.challenger, status: 'ativa' }), opponentTeam: d.opponent ? mapTeam({ ...d.opponent, status: 'ativa' }) : null,
      events: (d.events ?? []).map((e: Row) => ({ from: e.from, to: e.to, action: e.action, at: e.at, details: e.details ?? {} })),
      submissions: (d.submissions ?? []).map((s: Row) => ({ teamId: s.team_id, challengerScore: s.challenger_score, opponentScore: s.opponent_score, proofs: s.proofs ?? [], at: s.at })),
      predictions: { challenger: num(d.predictions?.challenger), draw: num(d.predictions?.draw), opponent: num(d.predictions?.opponent) }, myPrediction: d.my_prediction ?? null,
      disputes: (d.disputes ?? []).map((x: Row) => ({ id: x.id, reason: x.reason, status: x.status, resolution: x.resolution, evidence: x.evidence ?? [], at: x.at, teamId: x.team_id })),
      market: d.market ? { status: d.market.status, selections: (d.market.selections ?? []).map((s: Row) => ({ id: s.id, code: s.code, label: s.label, odds: num(s.odds), marketStatus: s.market_status })) } : null,
      canManageChallenger: !!d.can_manage_challenger, canManageOpponent: !!d.can_manage_opponent, bettingOn: !!d.betting_on,
    };
  },
  async profile(handle: string): Promise<Row | null> {
    if (IS_DEMO) return demo((db) => {
      const u = db.users.find((x) => x.handle.toLowerCase() === handle.replace(/^@/, '').toLowerCase()); if (!u) return null;
      const teams = db.members.filter((m) => m.userId === u.id && !m.leftAt).map((m) => { const t = db.teams.find((x) => x.id === m.teamId)!; return { id: t.id, name: t.name, game: t.game, logo_url: t.logo, role: m.role, rating: t.rating }; });
      const ids = new Set(teams.map((t) => t.id));
      const history = db.challenges.filter((c) => c.status === 'COMPLETED' && (ids.has(c.challengerTeamId) || (c.opponentTeamId && ids.has(c.opponentTeamId)))).map((c) => ({ id: c.id, game: c.game, challenger_score: c.challengerScore, opponent_score: c.opponentScore, completed_at: c.completedAt, challenger: db.teams.find((t) => t.id === c.challengerTeamId)?.name, opponent: db.teams.find((t) => t.id === c.opponentTeamId)?.name }));
      return { handle: u.handle, display_name: u.name, avatar_url: null, bio: '', verified: false, teams, history, example: u.id !== DEMO_ME };
    });
    const d = await rpc('comp_public_profile', { p_handle: handle });
    return d.ok ? d : null;
  },
  async activity(): Promise<Row[]> {
    if (IS_DEMO) return demo((db) => db.audit.filter((a) => a.actor === DEMO_ME).slice(0, 50).map((a) => ({ kind: 'auditoria', action: a.action, ref: a.target, at: a.at })));
    const d = await rpc('comp_my_activity');
    return Array.isArray(d) ? d : [];
  },

  /* ----- Carteira ----- */
  async wallet(): Promise<WalletView | { ok: false; code: string }> {
    if (IS_DEMO) return demo((db, now) => {
      const w = core.wallet(db, DEMO_ME); const rg = db.rg[DEMO_ME];
      return { ...w, ledger: db.ledger.filter((e) => e.userId === DEMO_ME).slice().reverse().map((e) => ({ id: e.entryId, delta: e.delta, reason: e.reason, ref: e.ref, balanceAfter: e.balanceAfter, at: e.createdAt })),
        deposits: db.payments.filter((p) => p.userId === DEMO_ME).slice().reverse().map((p) => ({ id: p.id, amount: p.amount, status: p.status, method: p.method, at: p.at })),
        monetaryOn: monetaryOn(db.settings, db.licences, now), bettingOn: bettingOn(db.settings, db.licences, now), providerReady: db.providerReady,
        eligibility: core.eligibilityOf(db, DEMO_ME, now),
        limits: { depositDaily: rg?.depositDaily ?? null, depositWeekly: null, depositMonthly: null, coolOffUntil: rg?.coolOffUntil ?? null, selfExcludedUntil: rg?.selfExcludedUntil ?? null, pending: null, pendingEffectiveAt: null } };
    });
    const d = await rpc('comp_wallet_me');
    if (!d.ok) return { ok: false, code: d.code ?? 'ERRO' };
    const l = d.limits ?? {};
    return {
      available: num(d.available), reserved: num(d.reserved), total: num(d.total), reservedWithdrawals: num(d.reserved_withdrawals), reservedBets: num(d.reserved_bets),
      ledger: (d.ledger ?? []).map((e: Row) => ({ id: e.id, delta: e.delta, reason: e.reason, ref: e.ref, balanceAfter: e.balance_after, at: e.at })),
      deposits: (d.deposits ?? []).map((p: Row) => ({ id: p.id, amount: p.amount, status: p.status, method: p.method, at: p.at })),
      monetaryOn: !!d.monetary_on, bettingOn: !!d.betting_on, providerReady: !!d.provider_ready, eligibility: { ok: !!d.eligibility?.ok, reasons: d.eligibility?.reasons ?? [] },
      limits: { depositDaily: l.deposit_daily ?? null, depositWeekly: l.deposit_weekly ?? null, depositMonthly: l.deposit_monthly ?? null, coolOffUntil: l.cool_off_until ?? null,
        selfExcludedUntil: l.self_excluded_until ?? null, pending: l.pending ?? null, pendingEffectiveAt: l.pending_effective_at ?? null },
    };
  },
  /** Cria o pedido (servidor) e pede à Edge Function para enviar o pedido de pagamento ao telemóvel. NUNCA credita aqui. */
  async deposit(amount: number, method: 'M-Pesa' | 'e-Mola', phone: string, idem: string): Promise<Res<{ paymentId: string }>> {
    if (IS_DEMO) return demo((db, now) => r2(core.depositIntent(db, DEMO_ME, amount, method, phone, idem, now)));
    const d = await rpc('comp_wallet_deposit_intent', { p_amount: amount, p_method: method, p_phone: phone, p_idem: idem });
    if (!d.ok) return res(d) as Res<{ paymentId: string }>;
    const s = await session();
       const r = await fetch(`${SUPABASE_URL}/functions/v1/payments/wallet-deposit`, {
      method: 'POST', headers: { authorization: `Bearer ${s?.access_token ?? ''}`, 'content-type': 'application/json', 'idempotency-key': idem },
      body: JSON.stringify({ payment_id: d.payment_id, phone }),
    }).then((x) => x.json()).catch(() => ({ ok: false, code: 'REDE' }));
    if (!r?.ok) return { ok: false, code: r?.code ?? 'PROVIDER_ERROR' };
    return { ok: true, paymentId: d.payment_id };
  },
    /** Pergunta à Edge Function se um depósito pendente já foi confirmado pelo fornecedor. Só o servidor credita. */
  async checkDeposit(paymentId: string): Promise<{ ok: boolean; status?: string; code?: string }> {
    if (IS_DEMO) return { ok: true, status: 'pendente' };
    const s = await session();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/payments/wallet-deposit-check`, {
      method: 'POST', headers: { authorization: `Bearer ${s?.access_token ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payment_id: paymentId }),
    }).then((x) => x.json()).catch(() => ({ ok: false, code: 'rede' }));
    return r as { ok: boolean; status?: string; code?: string };
  },
  /** SÓ MODO DEMO: simula o webhook do fornecedor (assinatura válida). Em produção esta função não existe no servidor. */
  async demoSimulateWebhook(paymentId: string): Promise<Res> {
    if (!IS_DEMO) return { ok: false, code: 'FORBIDDEN' };
    return demo((db, now) => { db.providerReady = true; return r2(core.confirmDeposit(db, paymentId, { eventId: 'demo-' + paymentId, providerRef: 'DEMO-' + paymentId, status: 'success', amount: db.payments.find((p) => p.id === paymentId)?.amount ?? 0, signatureOk: true }, DEMO_SEEN, now)); });
  },
  async withdraw(amount: number, method: 'M-Pesa' | 'e-Mola', phone: string, txToken: string, idem: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.withdraw(db, DEMO_ME, amount, method, phone, !!txToken, idem, now)));
    return res(await rpc('comp_wallet_withdraw', { p_amount: amount, p_method: method, p_phone: phone, p_tx_token: txToken, p_idem: idem }));
  },
  async setDepositLimits(daily: number | null, weekly: number | null, monthly: number | null): Promise<Res<{ pending?: boolean }>> {
    if (IS_DEMO) return demo((db) => { db.rg[DEMO_ME] = { ...(db.rg[DEMO_ME] ?? { coolOffUntil: null, selfExcludedUntil: null }), depositDaily: daily }; return { ok: true } as Res<{ pending?: boolean }>; });
    return res(await rpc('comp_rg_set_limits', { p_deposit_daily: daily, p_deposit_weekly: weekly, p_deposit_monthly: monthly })) as Res<{ pending?: boolean }>;
  },
  async coolOff(hours: number): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => { db.rg[DEMO_ME] = { ...(db.rg[DEMO_ME] ?? { selfExcludedUntil: null, depositDaily: null }), coolOffUntil: new Date(now + hours * H).toISOString() }; return { ok: true } as Res; });
    return res(await rpc('comp_rg_cool_off', { p_hours: hours }));
  },
  async placeBet(challengeId: string, selectionId: string, stake: number, odds: number, currency: 'pontos' | 'mt', confirmed: boolean, idem: string): Promise<Res<{ terms?: BetTerms | Row }>> {
    if (IS_DEMO) return demo((db, now) => r2(core.placeChallengeBet(db, DEMO_ME, challengeId, selectionId.endsWith(':opponent') ? 'opponent' : 'challenger', stake, odds, currency, confirmed, idem, now)));
    return res(await rpc('comp_bet_place', { p_selection: selectionId, p_stake: stake, p_odds: odds, p_currency: currency, p_confirm: confirmed, p_idem: idem }));
  },

  /* ----- Admin ----- */
  async adminOverview(): Promise<AdminView | { ok: false; code: string }> {
    if (IS_DEMO) return demo((db, now) => ({
      settings: { ...db.settings, monetary_features_enabled: db.settings.monetaryFeaturesEnabled, betting_enabled: db.settings.bettingEnabled, predictions_enabled: db.settings.predictionsEnabled },
      licences: db.licences, providers: [{ provider: 'mpesa', configured: db.providerReady, live: db.providerReady, checked_at: new Date(now).toISOString() }],
      monetaryOn: monetaryOn(db.settings, db.licences, now), bettingOn: bettingOn(db.settings, db.licences, now), strongAuth: true,
      counts: { teams: db.teams.filter((t) => t.status === 'ativa').length, challenges: db.challenges.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {} as Record<string, number>),
        open_disputes: db.disputes.filter((d) => d.status === 'aberta' || d.status === 'em_analise').length, risk_open: 0 },
      disputes: db.disputes.filter((d) => d.status === 'aberta' || d.status === 'em_analise').map((d) => { const c = db.challenges.find((x) => x.id === d.challengeId)!; return { id: d.id, challenge_id: d.challengeId, reason: d.reason, status: d.status, evidence_urls: d.evidence, created_at: d.at, challenge_status: c.status, challenger: db.teams.find((t) => t.id === c.challengerTeamId)?.name, opponent: db.teams.find((t) => t.id === c.opponentTeamId)?.name }; }),
      review: db.challenges.filter((c) => ['UNDER_REVIEW', 'DISPUTED', 'PENDING_RESULT', 'SCHEDULED', 'IN_PROGRESS'].includes(c.status) || (c.status === 'COMPLETED' && !c.resultVerifiedAt))
        .map((c) => ({ id: c.id, status: c.status, game: c.game, scheduled_at: c.scheduledAt, challenger_score: c.challengerScore, opponent_score: c.opponentScore, result_source: c.resultSource, result_verified_at: c.resultVerifiedAt, bet_match_id: c.market ? 'demo' : null, challenger: db.teams.find((t) => t.id === c.challengerTeamId)?.name, opponent: db.teams.find((t) => t.id === c.opponentTeamId)?.name })),
      teams: db.teams.map((t) => ({ id: t.id, name: t.name, game: t.game, status: t.status, rating: t.rating, played: t.played, members: core.activeMembers(db, t.id).length })),
      risk: [], audit: db.audit.slice(0, 200).map((a) => ({ id: a.id, action: a.action, target: a.target, details: a.details, aal: 'demo', created_at: a.at, actor: db.users.find((u) => u.id === a.actor)?.handle ?? 'sistema' })),
      transactions: db.ledger.slice().reverse().map((e) => ({ entry_id: e.entryId, handle: db.users.find((u) => u.id === e.userId)?.handle, delta: e.delta, reason: e.reason, ref: e.ref, balance_after: e.balanceAfter, created_at: e.createdAt })),
      activity: { challenges_7d: db.challenges.filter((c) => Date.parse(c.createdAt) > now - 7 * 86400e3).length, completed_7d: db.challenges.filter((c) => c.completedAt && Date.parse(c.completedAt) > now - 7 * 86400e3).length, teams_7d: db.teams.filter((t) => Date.parse(t.createdAt) > now - 7 * 86400e3).length, predictions_7d: db.predictions.length },
    }));
    const d = await rpc('comp_admin_overview');
    if (!d.ok) return { ok: false, code: d.code ?? 'ERRO' };
    return {
      settings: d.settings ?? {}, licences: (d.licences ?? []).map((l: Row) => ({ id: l.id, scope: l.scope, authority: l.authority, licenceNo: l.licence_no, validFrom: l.valid_from, validUntil: l.valid_until, revokedAt: l.revoked_at, notes: l.notes, createdAt: l.created_at })),
      providers: d.providers ?? [], monetaryOn: !!d.monetary_on, bettingOn: !!d.betting_on, strongAuth: !!d.strong_auth,
      counts: { teams: num(d.counts?.teams), challenges: d.counts?.challenges ?? {}, open_disputes: num(d.counts?.open_disputes), risk_open: num(d.counts?.risk_open) },
      disputes: d.disputes ?? [], review: d.review ?? [], teams: d.teams ?? [], risk: d.risk ?? [], audit: d.audit ?? [], transactions: d.transactions ?? [], activity: d.activity ?? {},
    };
  },
  async adminReconcile(): Promise<Row> {
    if (IS_DEMO) return demo((db) => ({ ok: true, paid_without_ledger: [], ledger_without_payment: [], stale_pending: db.payments.filter((p) => p.status === 'pendente'), provider_anomalies: [],
      totals: { ledger_total: db.ledger.reduce((a, e) => a + e.delta, 0), deposits_paid: db.payments.filter((p) => p.status === 'pago').reduce((a, p) => a + p.amount, 0), deposits_ledger: db.ledger.filter((e) => e.reason === 'deposito').reduce((a, e) => a + e.delta, 0) } }));
    return rpc('comp_admin_reconcile');
  },
  async adminRecordLicence(l: { scope: 'apostas' | 'pagamentos'; authority: string; licenceNo: string; validFrom: string; validUntil: string; notes: string }): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.recordLicence(db, DEMO_ME, 'aal2', l, now)));
    return res(await rpc('comp_admin_record_licence', { p_scope: l.scope, p_authority: l.authority, p_licence_no: l.licenceNo, p_valid_from: l.validFrom, p_valid_until: l.validUntil, p_notes: l.notes }));
  },
  async adminRevokeLicence(id: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.revokeLicence(db, DEMO_ME, 'aal2', id, now)));
    return res(await rpc('comp_admin_revoke_licence', { p_id: id }));
  },
  async adminSetFlags(monetary: boolean, betting: boolean, confirm: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.setFlags(db, DEMO_ME, 'aal2', monetary, betting, confirm, now)));
    return res(await rpc('comp_admin_set_flags', { p_monetary: monetary, p_betting: betting, p_confirm: confirm }));
  },
  async adminChallenge(id: string, action: 'analisar' | 'resolver' | 'verificar' | 'anular', cs: number | null, os: number | null, note: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.adminChallenge(db, DEMO_ME, 'aal2', id, action, cs, os, note, now)));
    return res(await rpc('comp_admin_challenge_action', { p_id: id, p_action: action, p_challenger_score: cs, p_opponent_score: os, p_note: note }));
  },
  async adminOpenMarket(id: string): Promise<Res> {
    if (IS_DEMO) return demo((db, now) => r2(core.openMarket(db, DEMO_ME, 'aal2', id, now)));
    return res(await rpc('comp_admin_open_market', { p_id: id }));
  },
  async adminTeam(id: string, action: 'suspender' | 'reativar', note: string): Promise<Res> {
    if (IS_DEMO) return demo((db) => { const t = db.teams.find((x) => x.id === id); if (!t) return { ok: false, code: 'NOT_FOUND' } as Res; t.status = action === 'suspender' ? 'suspensa' : 'ativa'; return { ok: true } as Res; });
    return res(await rpc('comp_admin_team_action', { p_team: id, p_action: action, p_note: note }));
  },
  /** SÓ MODO DEMO: marcar o fornecedor como configurado (em produção isto é feito pela Edge Function a partir dos segredos). */
  async demoSetProvider(ready: boolean): Promise<void> { if (IS_DEMO) demo((db) => { db.providerReady = ready; }); },
  defaults: DEFAULT_FLAGS,
};
