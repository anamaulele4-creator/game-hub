// TXAPILOG · Módulo competitivo — "servidor" em memória para o MODO DEMO e para os testes.
// Espelha as funções de supabase/competitive.sql (mesmos códigos de erro, mesma máquina de estados).
// Em produção nada disto corre: as decisões são do Postgres. Nunca credita dinheiro real.
import { priceOdds } from './bets.ts';
import type { SelResult } from './bets.ts';
import {
  DEFAULT_FLAGS, DEFAULT_RULES, PRE_MATCH, assertTransition, bettingOn, cancelAllowed, canManageChallenges, eligibility, flagChangeError, isTerminal,
  licenceValid, monetaryOn, outcomeOf, payoutFromTerms, postEntry, reconcileResults, snapshotTerms, teamEloDelta, validateLicence, validateTeam, walletSummary,
} from './competitive.ts';
import type { BetTerms, ChallengeStatus, CompGame, EligibilityInput, Flags, LedgerEntry, Licence, MemberRole, Pick, Side } from './competitive.ts';

export interface CTeam {
  id: string; name: string; tag: string | null; game: CompGame; province: string | null; bio: string; logo: string | null; captainId: string; createdBy: string;
  status: 'ativa' | 'suspensa' | 'dissolvida'; rating: number; played: number; wins: number; draws: number; losses: number; createdAt: string; example?: boolean;
}
export interface CMember { teamId: string; userId: string; role: MemberRole; canManageChallenges: boolean; joinedAt: string; leftAt: string | null }
export interface CInvite { id: string; teamId: string; userId: string; invitedBy: string; status: 'pendente' | 'aceite' | 'recusado' | 'cancelado' | 'expirado'; createdAt: string }
export interface CChallenge {
  id: string; game: CompGame; challengerTeamId: string; opponentTeamId: string | null; status: ChallengeStatus; title: string; rules: string; playersPerTeam: number; bestOf: number;
  scheduledAt: string | null; createdBy: string; acceptedAt: string | null; startedAt: string | null; firstResultAt: string | null; completedAt: string | null; cancelledAt: string | null;
  cancelReason: string | null; challengerScore: number | null; opponentScore: number | null; winnerTeamId: string | null; resultSource: 'acordo' | 'admin' | null;
  resultVerifiedAt: string | null; predictionsEnabled: boolean; market: { odds: Record<'challenger' | 'opponent', number>; open: boolean } | null; version: number; createdAt: string; example?: boolean;
}
export interface CEvent { id: number; challengeId: string; from: ChallengeStatus | null; to: ChallengeStatus; action: string; actor: string | null; details: Record<string, unknown>; at: string }
export interface CSubmission { challengeId: string; teamId: string; challengerScore: number; opponentScore: number; proofs: string[]; by: string; at: string }
export interface CDispute { id: string; challengeId: string; openedBy: string; teamId: string | null; reason: string; evidence: string[]; status: 'aberta' | 'em_analise' | 'resolvida' | 'anulada'; resolution: string | null; at: string }
export interface CPrediction { challengeId: string; userId: string; pick: Pick; correct: boolean | null; at: string }
export interface CPayment { id: string; userId: string; amount: number; method: 'M-Pesa' | 'e-Mola'; status: 'pendente' | 'em processamento' | 'pago' | 'falhou'; idem: string; providerRef: string | null; at: string }
export interface CWithdrawal { id: string; userId: string; amount: number; method: string; status: 'pendente' | 'pago' | 'recusado'; at: string }
export interface CBet { id: string; userId: string; challengeId: string; pick: 'challenger' | 'opponent'; terms: BetTerms; status: 'aberta' | 'ganha' | 'perdida' | 'anulada'; payout: number; at: string }
export interface CAudit { id: number; actor: string | null; action: string; target: string; details: Record<string, unknown>; at: string }
export interface CUser { id: string; handle: string; name: string; birthDate: string | null; province: string | null; kyc: 'pendente' | 'aprovado' | 'recusado' | null; banned?: boolean; admin?: boolean }
export interface CSettings extends Flags { cancelWindowHours: number; acceptanceHours: number; resultHours: number; maxTeamMembers: number; depositMin: number; depositMax: number; termsVersion: string; maxPayout: number }

export interface CDB {
  settings: CSettings; licences: Licence[]; providerReady: boolean; users: CUser[]; teams: CTeam[]; members: CMember[]; invites: CInvite[];
  challenges: CChallenge[]; events: CEvent[]; submissions: CSubmission[]; disputes: CDispute[]; predictions: CPrediction[];
  ledger: LedgerEntry[]; payments: CPayment[]; withdrawals: CWithdrawal[]; bets: CBet[]; audit: CAudit[]; idem: Record<string, unknown>; rg: Record<string, { coolOffUntil: string | null; selfExcludedUntil: string | null; depositDaily: number | null }>;
  seq: number;
}
export type R<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; code: string; reasons?: string[] };
const err = (code: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, code, ...extra });

export function emptyCDB(): CDB {
  return {
    settings: { ...DEFAULT_FLAGS, cancelWindowHours: 2, acceptanceHours: 72, resultHours: 24, maxTeamMembers: 10, depositMin: 10, depositMax: 25000, termsVersion: 'v1-2026-10-19', maxPayout: 50000 },
    licences: [], providerReady: false, users: [], teams: [], members: [], invites: [], challenges: [], events: [], submissions: [], disputes: [], predictions: [],
    ledger: [], payments: [], withdrawals: [], bets: [], audit: [], idem: {}, rg: {}, seq: 1,
  };
}
const nid = (db: CDB, p: string) => `${p}${db.seq++}`;
const iso = (t: number) => new Date(t).toISOString();
const user = (db: CDB, id: string) => db.users.find((u) => u.id === id);
const isAdmin = (db: CDB, id: string) => !!user(db, id)?.admin;
export function audit(db: CDB, actor: string | null, action: string, target: string, details: Record<string, unknown>, now: number) {
  db.audit.unshift({ id: db.seq++, actor, action, target, details, at: iso(now) });
}
function idemGet(db: CDB, u: string, k: string | null) { return k ? db.idem[`${u}:${k}`] : undefined; }
function idemPut<T>(db: CDB, u: string, k: string | null, v: T): T { if (k) db.idem[`${u}:${k}`] = v; return v; }

/* ---------------- Equipas ---------------- */
export const activeMembers = (db: CDB, team: string) => db.members.filter((m) => m.teamId === team && !m.leftAt);
export const memberOf = (db: CDB, team: string | null, u: string) => (team ? db.members.find((m) => m.teamId === team && m.userId === u && !m.leftAt) : undefined);
export const canManage = (db: CDB, team: string | null, u: string) => !!team && db.teams.find((t) => t.id === team)?.status === 'ativa' && canManageChallenges(memberOf(db, team, u));

export function createTeam(db: CDB, u: string, t: { name: string; tag?: string | null; game: CompGame; province?: string | null; bio?: string; logo?: string | null }, now: number): R<{ teamId: string }> {
  if (!user(db, u) || user(db, u)!.banned) return err('AUTH');
  const v = validateTeam(t); if (v) return err(v);
  if (db.teams.some((x) => x.name.trim().toLowerCase() === t.name.trim().toLowerCase())) return err('NAME_TAKEN');
  if (db.members.some((m) => m.userId === u && !m.leftAt && db.teams.find((x) => x.id === m.teamId && x.game === t.game && x.status === 'ativa'))) return err('ALREADY_IN_GAME');
  const team: CTeam = { id: nid(db, 'team-'), name: t.name.trim(), tag: t.tag ? t.tag.trim().toUpperCase() : null, game: t.game, province: t.province || null, bio: (t.bio ?? '').slice(0, 500),
    logo: t.logo ?? null, captainId: u, createdBy: u, status: 'ativa', rating: 1500, played: 0, wins: 0, draws: 0, losses: 0, createdAt: iso(now) };
  db.teams.push(team);
  db.members.push({ teamId: team.id, userId: u, role: 'capitao', canManageChallenges: true, joinedAt: iso(now), leftAt: null });
  audit(db, u, 'equipa_criada', team.id, { nome: team.name }, now);
  return { ok: true, teamId: team.id };
}
export function updateTeam(db: CDB, u: string, teamId: string, p: { bio: string; province: string | null; logo: string | null; tag: string | null }, now: number): R {
  const t = db.teams.find((x) => x.id === teamId);
  if (!t || memberOf(db, teamId, u)?.role !== 'capitao') return err('FORBIDDEN');
  if (p.tag && !/^[A-Z0-9]{2,6}$/.test(p.tag.toUpperCase())) return err('TAG');
  Object.assign(t, { bio: p.bio.slice(0, 500), province: p.province || null, logo: p.logo || null, tag: p.tag ? p.tag.toUpperCase() : null });
  audit(db, u, 'equipa_editada', teamId, {}, now);
  return { ok: true };
}
export function invite(db: CDB, u: string, teamId: string, handle: string, now: number): R<{ inviteId: string }> {
  const t = db.teams.find((x) => x.id === teamId);
  if (!t || t.status !== 'ativa') return err('TEAM');
  const me = memberOf(db, teamId, u);
  if (!me || me.role === 'membro') return err('FORBIDDEN');
  const target = db.users.find((x) => x.handle.toLowerCase() === handle.replace(/^@/, '').trim().toLowerCase() && !x.banned);
  if (!target) return err('USER');
  if (memberOf(db, teamId, target.id)) return err('ALREADY_MEMBER');
  if (activeMembers(db, teamId).length >= db.settings.maxTeamMembers) return err('TEAM_FULL');
  if (db.invites.some((i) => i.teamId === teamId && i.userId === target.id && i.status === 'pendente')) return err('ALREADY_INVITED');
  const i: CInvite = { id: nid(db, 'inv-'), teamId, userId: target.id, invitedBy: u, status: 'pendente', createdAt: iso(now) };
  db.invites.push(i);
  audit(db, u, 'convite_enviado', teamId, { utilizador: target.id }, now);
  return { ok: true, inviteId: i.id };
}
export function respondInvite(db: CDB, u: string, inviteId: string, accept: boolean, now: number): R {
  const i = db.invites.find((x) => x.id === inviteId);
  if (!i || i.userId !== u) return err('NOT_FOUND');
  if (i.status !== 'pendente') return err('INVITE_CLOSED');
  if (!accept) { i.status = 'recusado'; return { ok: true }; }
  const t = db.teams.find((x) => x.id === i.teamId)!;
  if (t.status !== 'ativa') return err('TEAM');
  if (db.members.some((m) => m.userId === u && !m.leftAt && m.teamId !== t.id && db.teams.find((x) => x.id === m.teamId && x.game === t.game && x.status === 'ativa'))) return err('ALREADY_IN_GAME');
  if (activeMembers(db, t.id).length >= db.settings.maxTeamMembers) return err('TEAM_FULL');
  const old = db.members.find((m) => m.teamId === t.id && m.userId === u);
  if (old) Object.assign(old, { leftAt: null, role: 'membro', canManageChallenges: false, joinedAt: iso(now) });
  else db.members.push({ teamId: t.id, userId: u, role: 'membro', canManageChallenges: false, joinedAt: iso(now), leftAt: null });
  i.status = 'aceite';
  audit(db, u, 'convite_aceite', t.id, {}, now);
  return { ok: true };
}
export function memberAction(db: CDB, u: string, teamId: string, target: string, action: 'sair' | 'remover' | 'vice' | 'gerir_desafios' | 'capitao', value: boolean | null, now: number): R {
  const t = db.teams.find((x) => x.id === teamId);
  if (!t) return err('TEAM');
  if (action === 'sair') {
    if (target !== u || !memberOf(db, teamId, u)) return err('FORBIDDEN');
    if (t.captainId === u && activeMembers(db, teamId).length > 1) return err('CAPTAIN_MUST_TRANSFER');
    memberOf(db, teamId, u)!.leftAt = iso(now);
    if (t.captainId === u) t.status = 'dissolvida';
    return { ok: true };
  }
  if (t.captainId !== u) return err('FORBIDDEN');
  const m = memberOf(db, teamId, target);
  if (!m || target === u) return err('MEMBER');
  if (action === 'remover') {
    if (db.challenges.some((c) => (c.challengerTeamId === teamId || c.opponentTeamId === teamId) && (c.status === 'IN_PROGRESS' || c.status === 'PENDING_RESULT'))) return err('IN_MATCH');
    m.leftAt = iso(now);
  } else if (action === 'vice') { m.role = value === false ? 'membro' : 'vice'; if (m.role === 'membro') m.canManageChallenges = false; }
  else if (action === 'gerir_desafios') { if (m.role === 'vice') m.canManageChallenges = !!value; }
  else if (action === 'capitao') {
    const me = memberOf(db, teamId, u)!; me.role = 'membro'; me.canManageChallenges = false;
    m.role = 'capitao'; m.canManageChallenges = true; t.captainId = target;
  }
  audit(db, u, 'membro_' + action, teamId, { utilizador: target }, now);
  return { ok: true };
}

/* ---------------- Desafios ---------------- */
function setStatus(db: CDB, c: CChallenge, to: ChallengeStatus, action: string, actor: string | null, details: Record<string, unknown>, now: number) {
  assertTransition(c.status, to);
  db.events.push({ id: db.seq++, challengeId: c.id, from: c.status, to, action, actor, details, at: iso(now) });
  c.status = to; c.version++;
}
function note(db: CDB, c: CChallenge, action: string, actor: string | null, details: Record<string, unknown>, now: number) {
  db.events.push({ id: db.seq++, challengeId: c.id, from: c.status, to: c.status, action, actor, details, at: iso(now) });
}
const sharesMembers = (db: CDB, a: string, b: string) => activeMembers(db, a).some((m) => !!memberOf(db, b, m.userId));
export const sideOf = (db: CDB, c: CChallenge, u: string): Side => (isAdmin(db, u) && !canManage(db, c.challengerTeamId, u) && !canManage(db, c.opponentTeamId, u) ? 'admin'
  : canManage(db, c.challengerTeamId, u) ? 'challenger' : canManage(db, c.opponentTeamId, u) ? 'opponent' : 'none');

export interface CreateChallengeInput { teamId: string; opponentId: string | null; title: string; rules: string; players: number; bestOf: number; scheduledAt: string | null; publish: boolean; idem: string | null }
export function createChallenge(db: CDB, u: string, p: CreateChallengeInput, now: number): R<{ challengeId: string; duplicate?: boolean }> {
  const prev = idemGet(db, u, p.idem) as R<{ challengeId: string }> | undefined; if (prev) return { ...prev, duplicate: true } as R<{ challengeId: string; duplicate?: boolean }>;
  const t = db.teams.find((x) => x.id === p.teamId);
  if (!t || t.status !== 'ativa') return err('TEAM');
  if (!canManage(db, t.id, u)) return err('FORBIDDEN');
  if (!(p.players >= 1 && p.players <= 11)) return err('PLAYERS');
  if (activeMembers(db, t.id).length < p.players) return err('NOT_ENOUGH_PLAYERS');
  if (p.scheduledAt && (Date.parse(p.scheduledAt) < now + 30 * 60e3 || Date.parse(p.scheduledAt) > now + 90 * 86400e3)) return err('DATE');
  let o: CTeam | undefined;
  if (p.opponentId) {
    o = db.teams.find((x) => x.id === p.opponentId);
    if (!o || o.status !== 'ativa' || o.id === t.id) return err('OPPONENT');
    if (o.game !== t.game) return err('GAME_MISMATCH');
    if (sharesMembers(db, t.id, o.id)) return err('SHARED_MEMBERS');
  }
  const c: CChallenge = { id: nid(db, 'ch-'), game: t.game, challengerTeamId: t.id, opponentTeamId: o?.id ?? null, status: 'DRAFT', title: p.title.slice(0, 80), rules: p.rules.slice(0, 2000),
    playersPerTeam: p.players, bestOf: p.bestOf || 1, scheduledAt: p.scheduledAt, createdBy: u, acceptedAt: null, startedAt: null, firstResultAt: null, completedAt: null, cancelledAt: null,
    cancelReason: null, challengerScore: null, opponentScore: null, winnerTeamId: null, resultSource: null, resultVerifiedAt: null, predictionsEnabled: true, market: null, version: 1, createdAt: iso(now) };
  db.challenges.push(c);
  db.events.push({ id: db.seq++, challengeId: c.id, from: null, to: 'DRAFT', action: 'criar', actor: u, details: { equipa: t.name }, at: iso(now) });
  if (p.publish) setStatus(db, c, o ? 'PENDING_ACCEPTANCE' : 'OPEN', o ? 'enviar_desafio' : 'publicar_aberto', u, o ? { adversario: o.name } : {}, now);
  audit(db, u, 'desafio_criado', c.id, {}, now);
  return idemPut(db, u, p.idem, { ok: true as const, challengeId: c.id });
}
export function publishChallenge(db: CDB, u: string, id: string, now: number): R {
  const c = db.challenges.find((x) => x.id === id);
  if (!c) return err('NOT_FOUND');
  if (!canManage(db, c.challengerTeamId, u)) return err('FORBIDDEN');
  if (c.status !== 'DRAFT') return err('STATE');
  setStatus(db, c, c.opponentTeamId ? 'PENDING_ACCEPTANCE' : 'OPEN', c.opponentTeamId ? 'enviar_desafio' : 'publicar_aberto', u, {}, now);
  return { ok: true };
}
export function respondChallenge(db: CDB, u: string, id: string, accept: boolean, myTeam: string | null, reason: string, now: number): R<{ status: ChallengeStatus }> {
  const c = db.challenges.find((x) => x.id === id);
  if (!c) return err('NOT_FOUND');
  let team: string;
  if (c.status === 'PENDING_ACCEPTANCE') {
    team = c.opponentTeamId!;
    if (!canManage(db, team, u)) return err('FORBIDDEN');
    if (!accept) {
      setStatus(db, c, 'CANCELLED', 'recusar', u, { motivo: reason.slice(0, 300) }, now);
      c.cancelledAt = iso(now); c.cancelReason = 'Recusado: ' + reason.slice(0, 200);
      return { ok: true, status: c.status };
    }
  } else if (c.status === 'OPEN') {
    if (!accept || !myTeam) return err('STATE');
    const o = db.teams.find((x) => x.id === myTeam);
    if (!o || o.status !== 'ativa' || o.game !== c.game || o.id === c.challengerTeamId) return err('OPPONENT');
    if (!canManage(db, o.id, u)) return err('FORBIDDEN');
    if (memberOf(db, c.challengerTeamId, u) || sharesMembers(db, c.challengerTeamId, o.id)) return err('SHARED_MEMBERS');
    team = o.id;
  } else return err('STATE');
  if (activeMembers(db, team).length < c.playersPerTeam) return err('NOT_ENOUGH_PLAYERS');
  if (c.scheduledAt && Date.parse(c.scheduledAt) <= now) return err('DATE');
  c.opponentTeamId = team;
  setStatus(db, c, 'ACCEPTED', 'aceitar', u, { equipa: team }, now); c.acceptedAt = iso(now);
  if (c.scheduledAt) setStatus(db, c, 'SCHEDULED', 'agendar', u, { data: c.scheduledAt }, now);
  return { ok: true, status: c.status };
}
export function scheduleChallenge(db: CDB, u: string, id: string, at: string, now: number): R {
  const c = db.challenges.find((x) => x.id === id);
  if (!c) return err('NOT_FOUND');
  if (!canManage(db, c.challengerTeamId, u) && !canManage(db, c.opponentTeamId, u)) return err('FORBIDDEN');
  if (c.status !== 'ACCEPTED') return err('STATE');
  const t = Date.parse(at);
  if (!(t >= now + 30 * 60e3 && t <= now + 90 * 86400e3)) return err('DATE');
  c.scheduledAt = new Date(t).toISOString();
  setStatus(db, c, 'SCHEDULED', 'agendar', u, { data: c.scheduledAt }, now);
  return { ok: true };
}
export function startChallenge(db: CDB, u: string, id: string, now: number): R {
  const c = db.challenges.find((x) => x.id === id);
  if (!c) return err('NOT_FOUND');
  if (!canManage(db, c.challengerTeamId, u) && !canManage(db, c.opponentTeamId, u) && !isAdmin(db, u)) return err('FORBIDDEN');
  if (c.status !== 'SCHEDULED') return err('STATE');
  if (c.scheduledAt && Date.parse(c.scheduledAt) > now + 15 * 60e3) return err('TOO_EARLY');
  setStatus(db, c, 'IN_PROGRESS', 'iniciar', u, {}, now); c.startedAt = iso(now);
  if (c.market) c.market.open = false;
  return { ok: true };
}
function finish(db: CDB, c: CChallenge, now: number) {
  const a = db.teams.find((t) => t.id === c.challengerTeamId)!; const b = db.teams.find((t) => t.id === c.opponentTeamId)!;
  const cs = c.challengerScore!, os = c.opponentScore!;
  const d = teamEloDelta(a.rating, b.rating, cs, os);
  const r = outcomeOf(cs, os);
  a.rating = Math.round((a.rating + d) * 100) / 100; b.rating = Math.round((b.rating - d) * 100) / 100;
  a.played++; b.played++;
  if (r === 'challenger') { a.wins++; b.losses++; } else if (r === 'opponent') { b.wins++; a.losses++; } else { a.draws++; b.draws++; }
  db.predictions.filter((p) => p.challengeId === c.id).forEach((p) => { p.correct = p.pick === r; });
  void now;
}
function settleMarket(db: CDB, c: CChallenge, now: number) {
  for (const b of db.bets.filter((x) => x.challengeId === c.id && x.status === 'aberta')) {
    let res: SelResult;
    if (c.status === 'CANCELLED') res = 'anulada';
    else if (c.status === 'COMPLETED' && c.resultVerifiedAt) { const o = outcomeOf(c.challengerScore!, c.opponentScore!); res = o === 'draw' ? 'anulada' : o === b.pick ? 'ganha' : 'perdida'; }
    else continue;
    const p = payoutFromTerms(b.terms, [res]);
    b.status = p.status as CBet['status']; b.payout = p.payout;
    if (p.payout > 0) postEntry(db.ledger, { userId: b.userId, delta: p.payout, reason: res === 'anulada' ? 'reembolso' : 'ganho', ref: b.id }, now, () => nid(db, 'le-'));
  }
}
export function submitResult(db: CDB, u: string, id: string, team: string, cs: number, os: number, proofs: string[], now: number): R<{ status: ChallengeStatus }> {
  const c = db.challenges.find((x) => x.id === id);
  if (!c) return err('NOT_FOUND');
  if ((team !== c.challengerTeamId && team !== c.opponentTeamId) || !canManage(db, team, u)) return err('FORBIDDEN');
  if (c.status !== 'IN_PROGRESS' && c.status !== 'PENDING_RESULT') return err('STATE');
  if (![cs, os].every((x) => Number.isInteger(x) && x >= 0 && x <= 999)) return err('SCORE');
  if (proofs.length > 5) return err('PROOF');
  if (db.submissions.some((s) => s.challengeId === id && s.teamId === team)) return err('ALREADY_SUBMITTED');
  db.submissions.push({ challengeId: id, teamId: team, challengerScore: cs, opponentScore: os, proofs, by: u, at: iso(now) });
  const out = reconcileResults(db.submissions.filter((s) => s.challengeId === id));
  if (out.status === 'PENDING_RESULT') { setStatus(db, c, 'PENDING_RESULT', 'resultado_submetido', u, { resultado: `${cs}-${os}` }, now); c.firstResultAt = iso(now); }
  else if (out.status === 'COMPLETED') {
    setStatus(db, c, 'COMPLETED', 'resultado_confirmado', u, { resultado: `${cs}-${os}` }, now);
    Object.assign(c, { completedAt: iso(now), challengerScore: cs, opponentScore: os, resultSource: 'acordo', winnerTeamId: cs > os ? c.challengerTeamId : cs < os ? c.opponentTeamId : null });
    finish(db, c, now);
  } else {
    setStatus(db, c, 'DISPUTED', 'resultados_divergentes', u, { a: out.a, b: out.b }, now);
    db.disputes.push({ id: nid(db, 'disp-'), challengeId: id, openedBy: u, teamId: team, reason: 'Resultados submetidos não coincidem (abertura automática).', evidence: [], status: 'aberta', resolution: null, at: iso(now) });
  }
  return { ok: true, status: c.status };
}
export function openDispute(db: CDB, u: string, id: string, team: string, reason: string, evidence: string[], now: number): R {
  const c = db.challenges.find((x) => x.id === id);
  if (!c) return err('NOT_FOUND');
  if ((team !== c.challengerTeamId && team !== c.opponentTeamId) || !canManage(db, team, u)) return err('FORBIDDEN');
  if (reason.trim().length < 5) return err('REASON');
  if (c.status === 'DISPUTED' || c.status === 'UNDER_REVIEW') {
    db.disputes.filter((d) => d.challengeId === id && (d.status === 'aberta' || d.status === 'em_analise')).forEach((d) => d.evidence.push(...evidence));
    note(db, c, 'provas_adicionadas', u, { n: evidence.length }, now);
    return { ok: true };
  }
  if (c.status !== 'PENDING_RESULT') return err('STATE');
  db.disputes.push({ id: nid(db, 'disp-'), challengeId: id, openedBy: u, teamId: team, reason: reason.trim().slice(0, 1000), evidence, status: 'aberta', resolution: null, at: iso(now) });
  setStatus(db, c, 'DISPUTED', 'disputa_aberta', u, { equipa: team }, now);
  return { ok: true };
}
export function cancelChallenge(db: CDB, u: string, id: string, reason: string, now: number): R {
  const c = db.challenges.find((x) => x.id === id);
  if (!c) return err('NOT_FOUND');
  const side = canManage(db, c.challengerTeamId, u) ? 'challenger' : canManage(db, c.opponentTeamId, u) ? 'opponent' : 'none';
  if (!cancelAllowed(c.status, side, c.scheduledAt, db.settings.cancelWindowHours, now)) return err('CANCEL_NOT_ALLOWED');
  setStatus(db, c, 'CANCELLED', 'cancelar', u, { lado: side, motivo: reason.slice(0, 300) }, now);
  c.cancelledAt = iso(now); c.cancelReason = reason.slice(0, 300);
  settleMarket(db, c, now);
  return { ok: true };
}
export function predict(db: CDB, u: string, id: string, pick: Pick, now: number): R {
  if (!db.settings.predictionsEnabled) return err('PREDICTIONS_OFF');
  const c = db.challenges.find((x) => x.id === id);
  if (!c || !c.predictionsEnabled) return err('NOT_FOUND');
  if (!PRE_MATCH.includes(c.status) || (c.scheduledAt && Date.parse(c.scheduledAt) <= now)) return err('CLOSED');
  const p = db.predictions.find((x) => x.challengeId === id && x.userId === u);
  if (p) { p.pick = pick; p.at = iso(now); } else db.predictions.push({ challengeId: id, userId: u, pick, correct: null, at: iso(now) });
  return { ok: true };
}
export function sweep(db: CDB, now: number): number {
  let n = 0;
  for (const c of db.challenges) {
    const due = c.scheduledAt ? Date.parse(c.scheduledAt) <= now : false;
    if ((c.status === 'OPEN' || c.status === 'PENDING_ACCEPTANCE') && (due || (c.status === 'PENDING_ACCEPTANCE' && Date.parse(lastChange(db, c)) < now - db.settings.acceptanceHours * 3600e3))) {
      setStatus(db, c, 'CANCELLED', 'expirar', null, {}, now); c.cancelledAt = iso(now); c.cancelReason = 'Expirou sem resposta'; n++;
    } else if (c.status === 'SCHEDULED' && due) { setStatus(db, c, 'IN_PROGRESS', 'iniciar_automatico', null, {}, now); c.startedAt = iso(now); if (c.market) c.market.open = false; n++; }
    else if (c.status === 'IN_PROGRESS' && c.startedAt && Date.parse(c.startedAt) < now - db.settings.resultHours * 3600e3) { setStatus(db, c, 'UNDER_REVIEW', 'sem_resultado', null, {}, now); n++; }
    else if (c.status === 'PENDING_RESULT' && c.firstResultAt && Date.parse(c.firstResultAt) < now - db.settings.resultHours * 3600e3) { setStatus(db, c, 'UNDER_REVIEW', 'confirmacao_em_falta', null, {}, now); n++; }
  }
  return n;
}
const lastChange = (db: CDB, c: CChallenge) => db.events.filter((e) => e.challengeId === c.id).slice(-1)[0]?.at ?? c.createdAt;

/* ---------------- Admin ---------------- */
export function adminChallenge(db: CDB, u: string, aal: string, id: string, action: 'analisar' | 'resolver' | 'verificar' | 'anular', cs: number | null, os: number | null, noteTxt: string, now: number): R {
  if (!isAdmin(db, u)) return err('FORBIDDEN');
  const c = db.challenges.find((x) => x.id === id);
  if (!c) return err('NOT_FOUND');
  if (action !== 'analisar' && aal !== 'aal2') return err('MFA_REQUIRED');
  if (action === 'analisar') {
    if (!['DISPUTED', 'PENDING_RESULT', 'IN_PROGRESS'].includes(c.status)) return err('STATE');
    setStatus(db, c, 'UNDER_REVIEW', 'admin_analisar', u, { nota: noteTxt }, now);
    db.disputes.filter((d) => d.challengeId === id && d.status === 'aberta').forEach((d) => { d.status = 'em_analise'; });
  } else if (action === 'resolver') {
    if (c.status !== 'UNDER_REVIEW' && c.status !== 'DISPUTED') return err('STATE');
    if (cs == null || os == null || cs < 0 || os < 0) return err('SCORE');
    if (noteTxt.trim().length < 5) return err('REASON');
    setStatus(db, c, 'COMPLETED', 'admin_resolver', u, { resultado: `${cs}-${os}`, nota: noteTxt }, now);
    Object.assign(c, { completedAt: iso(now), challengerScore: cs, opponentScore: os, resultSource: 'admin', resultVerifiedAt: iso(now), winnerTeamId: cs > os ? c.challengerTeamId : cs < os ? c.opponentTeamId : null });
    db.disputes.filter((d) => d.challengeId === id && (d.status === 'aberta' || d.status === 'em_analise')).forEach((d) => { d.status = 'resolvida'; d.resolution = noteTxt; });
    finish(db, c, now); settleMarket(db, c, now);
  } else if (action === 'verificar') {
    if (c.status !== 'COMPLETED' || c.resultVerifiedAt) return err('STATE');
    c.resultVerifiedAt = iso(now); note(db, c, 'resultado_verificado', u, {}, now); settleMarket(db, c, now);
  } else {
    if (isTerminal(c.status)) return err('STATE');
    if (noteTxt.trim().length < 5) return err('REASON');
    setStatus(db, c, 'CANCELLED', 'admin_anular', u, { nota: noteTxt }, now);
    c.cancelledAt = iso(now); c.cancelReason = 'Admin: ' + noteTxt;
    db.disputes.filter((d) => d.challengeId === id && (d.status === 'aberta' || d.status === 'em_analise')).forEach((d) => { d.status = 'anulada'; d.resolution = noteTxt; });
    settleMarket(db, c, now);
  }
  audit(db, u, 'admin_desafio_' + action, id, { nota: noteTxt }, now);
  return { ok: true };
}
export function recordLicence(db: CDB, u: string, aal: string, l: Omit<Licence, 'id' | 'revokedAt'>, now: number): R<{ licenceId: string }> {
  if (!isAdmin(db, u)) return err('FORBIDDEN');
  if (aal !== 'aal2') return err('MFA_REQUIRED');
  const v = validateLicence(l, now); if (v) return err(v);
  const lic: Licence = { ...l, id: nid(db, 'lic-'), revokedAt: null, createdAt: iso(now) };
  db.licences.push(lic);
  audit(db, u, 'licenca_registada', lic.id, { entidade: l.authority, numero: l.licenceNo, de: l.validFrom, ate: l.validUntil }, now);
  return { ok: true, licenceId: lic.id };
}
export function revokeLicence(db: CDB, u: string, aal: string, id: string, now: number): R {
  if (!isAdmin(db, u)) return err('FORBIDDEN');
  if (aal !== 'aal2') return err('MFA_REQUIRED');
  const l = db.licences.find((x) => x.id === id && !x.revokedAt); if (!l) return err('NOT_FOUND');
  l.revokedAt = iso(now); audit(db, u, 'licenca_revogada', id, {}, now);
  return { ok: true };
}
export function setFlags(db: CDB, u: string, aal: string, monetary: boolean, betting: boolean, confirm: string, now: number): R {
  const e = flagChangeError({ monetary, betting, confirm, isAdmin: isAdmin(db, u), aal, licences: db.licences, now });
  if (e) { if (e === 'LICENCE') audit(db, u, 'ativacao_recusada', 'settings', { motivo: 'sem licença válida' }, now); return err(e); }
  const before = { monetario: db.settings.monetaryFeaturesEnabled, apostas: db.settings.bettingEnabled };
  db.settings.monetaryFeaturesEnabled = monetary; db.settings.bettingEnabled = betting;
  audit(db, u, 'funcionalidades_monetarias', 'settings', { monetario: monetary, apostas: betting, antes: before, licenca: licenceValid(db.licences, 'apostas', now)?.licenceNo ?? null }, now);
  return { ok: true };
}
export function openMarket(db: CDB, u: string, aal: string, id: string, now: number): R {
  if (!isAdmin(db, u)) return err('FORBIDDEN');
  if (aal !== 'aal2') return err('MFA_REQUIRED');
  if (!bettingOn(db.settings, db.licences, now)) return err('BETTING_OFF');
  const c = db.challenges.find((x) => x.id === id);
  if (!c || c.status !== 'SCHEDULED' || !c.scheduledAt || Date.parse(c.scheduledAt) <= now + 10 * 60e3) return err('STATE');
  if (c.market) return err('ALREADY');
  const a = db.teams.find((t) => t.id === c.challengerTeamId)!; const b = db.teams.find((t) => t.id === c.opponentTeamId)!;
  const e = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
  c.market = { odds: { challenger: priceOdds(e, 0.07), opponent: priceOdds(1 - e, 0.07) }, open: true };
  note(db, c, 'mercado_aberto', u, {}, now); audit(db, u, 'mercado_desafio_aberto', id, {}, now);
  return { ok: true };
}

/* ---------------- Carteira e pagamentos ---------------- */
export function eligibilityOf(db: CDB, u: string, now: number) {
  const x = user(db, u); const rg = db.rg[u];
  const inp: EligibilityInput = { active: !!x && !x.banned, birthDate: x?.birthDate ?? null, kycStatus: x?.kyc ?? null, province: x?.province ?? null,
    selfExcludedUntil: rg?.selfExcludedUntil ?? null, coolOffUntil: rg?.coolOffUntil ?? null };
  return eligibility(inp, DEFAULT_RULES, now);
}
export function wallet(db: CDB, u: string) {
  const pendW = db.withdrawals.filter((w) => w.userId === u && w.status === 'pendente').reduce((a, w) => a + w.amount, 0);
  const openB = db.bets.filter((b) => b.userId === u && b.status === 'aberta' && b.terms.currency === 'mt').reduce((a, b) => a + b.terms.stake, 0);
  return { ...walletSummary(db.ledger, u, pendW, openB), reservedWithdrawals: pendW, reservedBets: openB };
}
export function depositIntent(db: CDB, u: string, amount: number, method: 'M-Pesa' | 'e-Mola', phone: string, idem: string, now: number): R<{ paymentId: string; duplicate?: boolean }> {
  if (!idem || idem.length < 16) return err('IDEMPOTENCY');
  const prev = idemGet(db, u, idem) as R<{ paymentId: string }> | undefined; if (prev) return { ...prev, duplicate: true } as R<{ paymentId: string; duplicate?: boolean }>;
  if (!monetaryOn(db.settings, db.licences, now)) return err('MONETARY_OFF');
  if (!db.providerReady) return err('PROVIDER_NOT_CONFIGURED');
  const el = eligibilityOf(db, u, now); if (!el.ok) return err('NOT_ELIGIBLE', { reasons: el.reasons });
  if (!(Number.isInteger(amount) && amount >= db.settings.depositMin && amount <= db.settings.depositMax)) return err('AMOUNT');
  const ph = phone.replace(/[\s-]/g, '').replace(/^\+?258/, '');
  if ((method === 'M-Pesa' && !/^8[45]\d{7}$/.test(ph)) || (method === 'e-Mola' && !/^8[67]\d{7}$/.test(ph))) return err('PHONE');
  const lim = db.rg[u]?.depositDaily;
  const today = db.payments.filter((p) => p.userId === u && p.status !== 'falhou' && Date.parse(p.at) > now - 86400e3).reduce((a, p) => a + p.amount, 0);
  if (lim != null && today + amount > lim) return err('DEPOSIT_LIMIT');
  const p: CPayment = { id: nid(db, 'pay-'), userId: u, amount, method, status: 'pendente', idem, providerRef: null, at: iso(now) };
  db.payments.push(p);
  audit(db, u, 'deposito_pedido', p.id, { valor: amount }, now);
  return idemPut(db, u, idem, { ok: true as const, paymentId: p.id });
}
/** Igual a comp__confirm_deposit(): só o servidor (webhook com assinatura verificada) chega aqui. Idempotente por evento e por pagamento. */
export function confirmDeposit(db: CDB, paymentId: string, ev: { eventId: string; providerRef: string; status: 'success' | 'failed'; amount: number; signatureOk: boolean }, seen: Set<string>, now: number): R<{ duplicate?: boolean }> {
  if (seen.has(ev.eventId)) return { ok: true, duplicate: true };
  seen.add(ev.eventId);
  if (!ev.signatureOk) return err('SIGNATURE');
  const p = db.payments.find((x) => x.id === paymentId);
  if (!p) return err('UNKNOWN_PAYMENT');
  if (p.status === 'pago') return { ok: true, duplicate: true };
  if (ev.status !== 'success') { p.status = 'falhou'; return { ok: true }; }
  if (ev.amount !== p.amount) { p.status = 'em processamento'; return err('AMOUNT_MISMATCH'); }
  if (db.payments.some((x) => x.providerRef === ev.providerRef && x.id !== p.id)) return err('DUP_REF');
  p.status = 'pago'; p.providerRef = ev.providerRef;
  postEntry(db.ledger, { userId: p.userId, delta: p.amount, reason: 'deposito', ref: 'mpesa:' + ev.providerRef }, now, () => nid(db, 'le-'));
  audit(db, null, 'deposito_confirmado', p.id, { valor: p.amount, ref: ev.providerRef }, now);
  return { ok: true };
}
export function withdraw(db: CDB, u: string, amount: number, method: 'M-Pesa' | 'e-Mola', phone: string, pinOk: boolean, idem: string, now: number): R<{ id: string; duplicate?: boolean }> {
  if (!idem || idem.length < 16) return err('IDEMPOTENCY');
  const prev = idemGet(db, u, idem) as R<{ id: string }> | undefined; if (prev) return { ...prev, duplicate: true } as R<{ id: string; duplicate?: boolean }>;
  if (!monetaryOn(db.settings, db.licences, now)) return err('MONETARY_OFF');
  const el = eligibilityOf(db, u, now); if (!el.ok) return err('NOT_ELIGIBLE', { reasons: el.reasons });
  if (!/^8[4-7]\d{7}$/.test(phone.replace(/[\s-]/g, '').replace(/^\+?258/, ''))) return err('PHONE');
  if (!pinOk) return err('PIN');
  if (!(Number.isInteger(amount) && amount >= 50)) return err('MIN_WITHDRAW');
  try {
    const w: CWithdrawal = { id: nid(db, 'wd-'), userId: u, amount, method, status: 'pendente', at: iso(now) };
    postEntry(db.ledger, { userId: u, delta: -amount, reason: 'levantamento', ref: w.id }, now, () => nid(db, 'le-'));
    db.withdrawals.push(w);
    return idemPut(db, u, idem, { ok: true as const, id: w.id });
  } catch (e) { return err((e as Error).message); }
}
export function placeChallengeBet(db: CDB, u: string, id: string, pick: 'challenger' | 'opponent', stake: number, shownOdds: number, currency: 'pontos' | 'mt', confirmed: boolean, idem: string, now: number): R<{ betId: string; terms: BetTerms; duplicate?: boolean }> {
  if (!idem || idem.length < 16) return err('IDEMPOTENCY');
  const prev = idemGet(db, u, idem) as R<{ betId: string; terms: BetTerms }> | undefined; if (prev) return { ...prev, duplicate: true } as R<{ betId: string; terms: BetTerms; duplicate?: boolean }>;
  if (!confirmed) return err('CONFIRM');
  if (!bettingOn(db.settings, db.licences, now)) return err('BETTING_OFF');
  const el = eligibilityOf(db, u, now); if (!el.ok) return err('NOT_ELIGIBLE', { reasons: el.reasons });
  const c = db.challenges.find((x) => x.id === id);
  if (!c?.market) return err('NOT_FOUND');
  if (memberOf(db, c.challengerTeamId, u) || memberOf(db, c.opponentTeamId, u)) return err('COMP_OWN_CHALLENGE');
  if (!c.market.open || c.status !== 'SCHEDULED' || !c.scheduledAt || Date.parse(c.scheduledAt) <= now) return err('COMP_CLOSED');
  const odds = c.market.odds[pick];
  if (odds !== shownOdds) return err('ODDS_CHANGED', { odds });
  if (!(Number.isInteger(stake) && stake >= 10)) return err('STAKE_MIN');
  const a = db.teams.find((t) => t.id === c.challengerTeamId)!; const b = db.teams.find((t) => t.id === c.opponentTeamId)!;
  const terms = snapshotTerms(stake, [{ selectionId: `${c.id}:${pick}`, label: pick === 'challenger' ? a.name : b.name, odds }], db.settings.maxPayout, currency, db.settings.termsVersion, now);
  const bet: CBet = { id: nid(db, 'bet-'), userId: u, challengeId: id, pick, terms, status: 'aberta', payout: 0, at: iso(now) };
  try { postEntry(db.ledger, { userId: u, delta: -stake, reason: 'aposta', ref: bet.id }, now, () => nid(db, 'le-')); } catch (e) { return err((e as Error).message); }
  db.bets.push(bet);
  audit(db, u, 'aposta_desafio', bet.id, { stake, odds }, now);
  return idemPut(db, u, idem, { ok: true as const, betId: bet.id, terms });
}
