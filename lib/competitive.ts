// TXAPILOG · Módulo competitivo — regras PURAS (sem rede, sem React). Espelham supabase/competitive.sql regra a regra.
// Em produção quem decide é o Postgres; este ficheiro serve o modo demo, a interface (mostrar/ocultar ações) e os testes
// (tests/competitive.test.mjs). Nada aqui confere permissões: o servidor valida sempre de novo.
import { evalBet, potentialReturn, round2 } from './bets.ts';
import type { SelResult } from './bets.ts';

/* ---------------- Máquina de estados dos desafios ---------------- */
export const CHALLENGE_STATES = [
  'DRAFT', 'OPEN', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_RESULT', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED', 'DISPUTED',
] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATES)[number];

export const STATUS_LABEL: Record<ChallengeStatus, string> = {
  DRAFT: 'Rascunho', OPEN: 'Aberto', PENDING_ACCEPTANCE: 'A aguardar resposta', ACCEPTED: 'Aceite', SCHEDULED: 'Agendado',
  IN_PROGRESS: 'A decorrer', PENDING_RESULT: 'A aguardar resultado', UNDER_REVIEW: 'Em análise', COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado', DISPUTED: 'Em disputa',
};

/** Transições permitidas — IGUAL a comp__can_transition() no SQL. */
export const TRANSITIONS: Record<ChallengeStatus, readonly ChallengeStatus[]> = {
  DRAFT: ['OPEN', 'PENDING_ACCEPTANCE', 'CANCELLED'],
  OPEN: ['ACCEPTED', 'CANCELLED'],
  PENDING_ACCEPTANCE: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PENDING_RESULT', 'UNDER_REVIEW', 'CANCELLED'],
  PENDING_RESULT: ['COMPLETED', 'DISPUTED', 'UNDER_REVIEW'],
  UNDER_REVIEW: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
  DISPUTED: ['UNDER_REVIEW', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
export const canTransition = (from: ChallengeStatus, to: ChallengeStatus): boolean => TRANSITIONS[from]?.includes(to) ?? false;
export const isTerminal = (s: ChallengeStatus) => s === 'COMPLETED' || s === 'CANCELLED';
/** Estados em que as previsões grátis e as apostas ainda estão abertas (antes da hora de início). */
export const PRE_MATCH: readonly ChallengeStatus[] = ['OPEN', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'SCHEDULED'];

export function assertTransition(from: ChallengeStatus, to: ChallengeStatus) {
  if (!canTransition(from, to)) throw new Error(`COMP_TRANSITION: ${from} -> ${to}`);
}

export type Side = 'challenger' | 'opponent' | 'admin' | 'none';
/** Regras de cancelamento — IGUAL a comp__cancel_allowed(). */
export function cancelAllowed(status: ChallengeStatus, side: Side, scheduledAt: string | null, windowHours: number, now: number): boolean {
  if (side === 'admin') return !isTerminal(status);
  if (status === 'DRAFT' || status === 'OPEN' || status === 'PENDING_ACCEPTANCE') return side === 'challenger';
  if (status === 'ACCEPTED' || status === 'SCHEDULED') {
    if (side !== 'challenger' && side !== 'opponent') return false;
    return !scheduledAt || Date.parse(scheduledAt) - windowHours * 3600e3 > now;
  }
  return false;
}

/* ---------------- Resultados e disputas ---------------- */
export interface Submission { teamId: string; challengerScore: number; opponentScore: number }
export type ReconcileOutcome =
  | { status: 'PENDING_RESULT' }
  | { status: 'COMPLETED'; challengerScore: number; opponentScore: number }
  | { status: 'DISPUTED'; a: string; b: string };

/** 1 submissão → aguarda a outra; 2 iguais → COMPLETED; 2 diferentes → DISPUTED (abre disputa automática). */
export function reconcileResults(subs: Submission[]): ReconcileOutcome {
  const valid = subs.filter((s) => Number.isInteger(s.challengerScore) && Number.isInteger(s.opponentScore) && s.challengerScore >= 0 && s.opponentScore >= 0);
  if (valid.length < 2) return { status: 'PENDING_RESULT' };
  const [x, y] = valid;
  if (x.challengerScore === y.challengerScore && x.opponentScore === y.opponentScore) return { status: 'COMPLETED', challengerScore: x.challengerScore, opponentScore: x.opponentScore };
  return { status: 'DISPUTED', a: `${x.challengerScore}-${x.opponentScore}`, b: `${y.challengerScore}-${y.opponentScore}` };
}
export type Pick = 'challenger' | 'draw' | 'opponent';
export const outcomeOf = (cs: number, os: number): Pick => (cs > os ? 'challenger' : cs < os ? 'opponent' : 'draw');

/** Elo das equipas (k = 32), igual a comp__finish(). Devolve a variação do desafiante (a do adversário é o simétrico). */
export function teamEloDelta(ratingChallenger: number, ratingOpponent: number, cs: number, os: number, k = 32): number {
  const e = 1 / (1 + 10 ** ((ratingOpponent - ratingChallenger) / 400));
  const sc = cs > os ? 1 : cs === os ? 0.5 : 0;
  return round2(k * (sc - e));
}

/** Procedimento de disputa (texto mostrado na página do evento e no COMPETITIVO.md). */
export const DISPUTE_STEPS = [
  'Os dois capitães submetem o resultado (com provas: capturas ou vídeo) até 24 h depois do início.',
  'Se os resultados coincidem, o desafio fica Concluído. Se não coincidem, abre-se uma disputa automática.',
  'Qualquer capitão pode abrir disputa enquanto aguarda o resultado do adversário e acrescentar provas.',
  'A equipa TxapZone analisa (estado Em análise), pode pedir mais provas e decide o resultado final ou anula o desafio.',
  'A decisão fica registada no histórico imutável do desafio.',
];

/* ---------------- Elegibilidade (serviços restritos: dinheiro e apostas) ---------------- */
export const MZ_PROVINCES = ['Maputo Cidade', 'Maputo Província', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete', 'Zambézia', 'Nampula', 'Niassa', 'Cabo Delgado'] as const;
export interface EligibilityInput {
  active: boolean; frozen?: boolean; birthDate: string | null; kycStatus: 'pendente' | 'aprovado' | 'recusado' | null; kycLevel?: number;
  province: string | null; country?: string | null; selfExcludedUntil?: string | null; coolOffUntil?: string | null;
}
export interface EligibilityRules { minAge: number; allowedProvinces: readonly string[]; allowedCountries: readonly string[] }
export const DEFAULT_RULES: EligibilityRules = { minAge: 18, allowedProvinces: MZ_PROVINCES, allowedCountries: ['MZ'] };
export type EligibilityReason = 'ACCOUNT' | 'FROZEN' | 'NO_BIRTH' | 'MINOR' | 'KYC' | 'LOCATION' | 'COUNTRY' | 'SELF_EXCLUDED' | 'COOL_OFF';
export const REASON_TEXT: Record<EligibilityReason, string> = {
  ACCOUNT: 'Conta suspensa, banida ou eliminada.', FROZEN: 'Conta congelada por segurança.', NO_BIRTH: 'Falta a data de nascimento.',
  MINOR: 'Só para maiores de 18 anos.', KYC: 'Identidade ainda não verificada (KYC).', LOCATION: 'Província de residência não permitida ou em falta.',
  COUNTRY: 'Serviço disponível só em Moçambique.', SELF_EXCLUDED: 'Autoexclusão ativa.', COOL_OFF: 'Pausa (cool-off) ativa.',
};

export function ageAt(birth: string, now: number): number {
  const b = new Date(birth + 'T00:00:00Z'); const n = new Date(now + 2 * 3600e3); // dia de Maputo
  if (isNaN(b.getTime())) return -1;
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  const m = n.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

/** IGUAL a comp_eligibility(). */
export function eligibility(i: EligibilityInput, rules: EligibilityRules, now: number): { ok: boolean; reasons: EligibilityReason[] } {
  const r: EligibilityReason[] = [];
  if (!i.active) r.push('ACCOUNT');
  if (i.frozen) r.push('FROZEN');
  if (!i.birthDate) r.push('NO_BIRTH'); else if (ageAt(i.birthDate, now) < rules.minAge) r.push('MINOR');
  if (i.kycStatus !== 'aprovado' && (i.kycLevel ?? 0) < 2) r.push('KYC');
  if (!i.province || !rules.allowedProvinces.includes(i.province)) r.push('LOCATION');
  if (i.country && !['XX', 'T1'].includes(i.country.toUpperCase()) && !rules.allowedCountries.includes(i.country.toUpperCase())) r.push('COUNTRY');
  if (i.selfExcludedUntil && Date.parse(i.selfExcludedUntil) > now) r.push('SELF_EXCLUDED');
  if (i.coolOffUntil && Date.parse(i.coolOffUntil) > now) r.push('COOL_OFF');
  return { ok: r.length === 0, reasons: r };
}

/* ---------------- Interruptores (gating) e licença ---------------- */
export interface Licence { id: string; scope: 'apostas' | 'pagamentos'; authority: string; licenceNo: string; validFrom: string; validUntil: string; revokedAt: string | null; notes?: string; createdAt?: string }
export interface Flags { monetaryFeaturesEnabled: boolean; bettingEnabled: boolean; predictionsEnabled: boolean }
/** Valores por omissão: TUDO o que envolve dinheiro DESLIGADO. */
export const DEFAULT_FLAGS: Flags = { monetaryFeaturesEnabled: false, bettingEnabled: false, predictionsEnabled: true };
export const UNAVAILABLE = 'Indisponível até aprovação legal';

export const maputoDate = (now: number) => new Date(now + 2 * 3600e3).toISOString().slice(0, 10);
export function licenceValid(lics: Licence[], scope: 'apostas' | 'pagamentos', now: number): Licence | null {
  const d = maputoDate(now);
  return lics.filter((l) => l.scope === scope && !l.revokedAt && l.validFrom <= d && l.validUntil >= d).sort((a, b) => b.validUntil.localeCompare(a.validUntil))[0] ?? null;
}
export const monetaryOn = (f: Flags, lics: Licence[], now: number) => f.monetaryFeaturesEnabled && !!licenceValid(lics, 'apostas', now);
export const bettingOn = (f: Flags, lics: Licence[], now: number) => monetaryOn(f, lics, now) && f.bettingEnabled;

export function validateLicence(l: { authority: string; licenceNo: string; validFrom: string; validUntil: string }, now: number): string | null {
  if ((l.authority ?? '').trim().length < 3) return 'AUTHORITY';
  if ((l.licenceNo ?? '').trim().length < 2) return 'NUMBER';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(l.validUntil) || l.validUntil <= l.validFrom) return 'DATES';
  if (l.validUntil < maputoDate(now)) return 'EXPIRED';
  return null;
}

/** IGUAL a comp_admin_set_flags(): devolve o código de erro ou null quando a alteração é permitida. */
export function flagChangeError(p: { monetary: boolean; betting: boolean; confirm: string; isAdmin: boolean; aal: string; licences: Licence[]; now: number }): string | null {
  if (!p.isAdmin) return 'FORBIDDEN';
  if (p.aal !== 'aal2') return 'MFA_REQUIRED';
  if (p.betting && !p.monetary) return 'BETTING_NEEDS_MONETARY';
  if (p.monetary || p.betting) {
    if (p.confirm.trim().toUpperCase() !== 'ATIVAR') return 'CONFIRM';
    if (!licenceValid(p.licences, 'apostas', p.now)) return 'LICENCE';
  }
  return null;
}

export type MoneyOp = 'deposit' | 'withdraw' | 'bet';
/** Primeira barreira de cada operação monetária (o servidor repete tudo). */
export function gate(op: MoneyOp, s: { flags: Flags; licences: Licence[]; providerReady: boolean; eligible: boolean; now: number }): string | null {
  if (op === 'bet' && !bettingOn(s.flags, s.licences, s.now)) return 'BETTING_OFF';
  if (!monetaryOn(s.flags, s.licences, s.now)) return 'MONETARY_OFF';
  if (op === 'deposit' && !s.providerReady) return 'PROVIDER_NOT_CONFIGURED';
  if (!s.eligible) return 'NOT_ELIGIBLE';
  return null;
}

/* ---------------- Livro-razão (carteira) ---------------- */
export interface LedgerEntry { entryId: string; userId: string; delta: number; reason: string; ref: string; idempotencyKey: string; balanceAfter: number; createdAt: string }
export const ledgerKey = (user: string, reason: string, ref: string) => `${user}:${reason}:${ref}`;
/** Saldo derivado = soma dos movimentos (deve ser igual ao balance_after do último). */
export const deriveBalance = (L: LedgerEntry[], user: string) => L.filter((e) => e.userId === user).reduce((a, e) => a + e.delta, 0);
/** Lançamento só de acréscimo e idempotente: a mesma chave nunca entra duas vezes; saldo nunca negativo (exceto correção). */
export function postEntry(L: LedgerEntry[], e: { userId: string; delta: number; reason: string; ref: string }, now: number, newId: () => string): { entry: LedgerEntry; duplicate: boolean } {
  if (!Number.isInteger(e.delta) || e.delta === 0) throw new Error('AMOUNT');
  const key = ledgerKey(e.userId, e.reason, e.ref);
  const prev = L.find((x) => x.idempotencyKey === key);
  if (prev) return { entry: prev, duplicate: true };
  const after = deriveBalance(L, e.userId) + e.delta;
  if (after < 0 && e.reason !== 'correcao') throw new Error('BALANCE');
  const entry: LedgerEntry = { entryId: newId(), userId: e.userId, delta: e.delta, reason: e.reason, ref: e.ref, idempotencyKey: key, balanceAfter: after, createdAt: new Date(now).toISOString() };
  L.push(entry);
  return { entry, duplicate: false };
}
export function walletSummary(L: LedgerEntry[], user: string, pendingWithdrawals: number, openBetStakes: number) {
  const available = deriveBalance(L, user);
  return { available, reserved: pendingWithdrawals + openBetStakes, total: available + pendingWithdrawals + openBetStakes };
}
export function ledgerConsistent(L: LedgerEntry[], user: string): boolean {
  let run = 0;
  for (const e of L.filter((x) => x.userId === user)) { run += e.delta; if (run !== e.balanceAfter) return false; }
  return true;
}

/* ---------------- Termos da aposta (instantâneo na confirmação) ---------------- */
export interface TermsLeg { selectionId: string; label: string; odds: number }
export interface BetTerms { termsVersion: string; currency: 'pontos' | 'mt'; stake: number; legs: TermsLeg[]; totalOdds: number; potential: number; maxPayout: number; confirmedAt: string }
export function snapshotTerms(stake: number, legs: TermsLeg[], maxPayout: number, currency: 'pontos' | 'mt', termsVersion: string, now: number): BetTerms {
  if (!Number.isInteger(stake) || stake <= 0) throw new Error('STAKE');
  if (!legs.length) throw new Error('EMPTY');
  const totalOdds = round2(legs.reduce((a, l) => a * l.odds, 1));
  return Object.freeze({ termsVersion, currency, stake, legs: legs.map((l) => Object.freeze({ ...l })), totalOdds, potential: potentialReturn(stake, totalOdds, maxPayout), maxPayout, confirmedAt: new Date(now).toISOString() }) as BetTerms;
}
/** Pagamento calculado SÓ a partir dos termos confirmados (igual a bets__settle_bet). */
export function payoutFromTerms(t: BetTerms, results: SelResult[]): { status: string; payout: number } {
  if (results.length !== t.legs.length) throw new Error('LEGS');
  const r = evalBet(t.legs.map((l, i) => ({ odds: l.odds, result: results[i] })), t.stake, t.maxPayout);
  return { status: r.status, payout: r.payout };
}
/** Uma tentativa de mudar termos já confirmados é sempre recusada (o SQL tem um trigger igual). */
export function assertTermsUnchanged(a: BetTerms, b: BetTerms) {
  const k = (t: BetTerms) => JSON.stringify([t.stake, t.totalOdds, t.potential, t.currency, t.maxPayout, t.legs.map((l) => [l.selectionId, l.odds])]);
  if (k(a) !== k(b)) throw new Error('COMP_TERMS_LOCKED');
}

/* ---------------- Equipas ---------------- */
export const COMP_GAMES = ['Free Fire', 'eFootball', 'PUBG Mobile', 'Call of Duty Mobile', 'Mobile Legends', 'FIFA / FC Mobile', 'Clash Royale', 'DLS', 'Outro'] as const;
export type CompGame = (typeof COMP_GAMES)[number];
export type MemberRole = 'capitao' | 'vice' | 'membro';
export const ROLE_LABEL: Record<MemberRole, string> = { capitao: 'Capitão', vice: 'Vice-capitão', membro: 'Membro' };
export function validateTeam(t: { name: string; tag?: string | null }): string | null {
  const n = (t.name ?? '').trim();
  if (n.length < 3 || n.length > 40) return 'NAME';
  if (t.tag && !/^[A-Z0-9]{2,6}$/.test(t.tag.trim().toUpperCase())) return 'TAG';
  return null;
}
export const canManageChallenges = (m: { role: MemberRole; canManageChallenges: boolean } | undefined) => !!m && (m.role === 'capitao' || (m.role === 'vice' && m.canManageChallenges));

/* ---------------- Mensagens (códigos do servidor → português) ---------------- */
export const COMP_TEXT: Record<string, string> = {
  AUTH: 'Entra na tua conta para continuar.', FORBIDDEN: 'Não tens permissão para isto.', RATE: 'Demasiados pedidos. Tenta mais tarde.',
  NAME: 'Nome entre 3 e 40 caracteres.', TAG: 'Sigla com 2 a 6 letras/números.', NAME_TAKEN: 'Já existe uma equipa com esse nome.', LOGO: 'Logótipo inválido.',
  ALREADY_IN_GAME: 'Já pertences a uma equipa deste jogo.', TEAM: 'Equipa indisponível.', USER: 'Utilizador não encontrado.', ALREADY_MEMBER: 'Já é membro.',
  TEAM_FULL: 'Equipa cheia.', ALREADY_INVITED: 'Convite já enviado.', INVITE_CLOSED: 'Convite já não está disponível.', NOT_FOUND: 'Não encontrado.',
  CAPTAIN_MUST_TRANSFER: 'Passa a capitania antes de sair.', MEMBER: 'Membro inválido.', IN_MATCH: 'A equipa está a meio de um jogo.',
  PLAYERS: 'Número de jogadores inválido.', NOT_ENOUGH_PLAYERS: 'A equipa não tem jogadores suficientes.', DATE: 'Data inválida (mín. 30 min, máx. 90 dias).',
  OPPONENT: 'Adversário inválido.', GAME_MISMATCH: 'As equipas são de jogos diferentes.', SHARED_MEMBERS: 'As equipas partilham jogadores.',
  STATE: 'Esta ação não é possível no estado atual.', TOO_EARLY: 'Ainda não é hora de começar.', SCORE: 'Resultado inválido.', PROOF: 'Provas inválidas (máx. 5 imagens tuas).',
  ALREADY_SUBMITTED: 'A tua equipa já submeteu o resultado.', REASON: 'Escreve o motivo (mín. 5 caracteres).', CANCEL_NOT_ALLOWED: 'Cancelamento não permitido pelas regras.',
  PREDICTIONS_OFF: 'Previsões desligadas.', PICK: 'Escolha inválida.', CLOSED: 'Já fechou.',
  MONETARY_OFF: UNAVAILABLE + '.', BETTING_OFF: 'Apostas: ' + UNAVAILABLE.toLowerCase() + '.', PROVIDER_NOT_CONFIGURED: 'Pagamentos M-Pesa ainda não configurados.',
  NOT_ELIGIBLE: 'Não cumpres os requisitos (18+, identidade verificada, residência em Moçambique, sem autoexclusão).',
  IDEMPOTENCY: 'Pedido inválido.', AMOUNT: 'Valor fora dos limites.', PHONE: 'Número inválido para o método escolhido.', DEPOSIT_LIMIT: 'Ultrapassa o teu limite de depósito.',
  PIN: 'Autorização do PIN inválida ou expirada.', MIN_WITHDRAW: 'Abaixo do mínimo de levantamento.', MAX_WITHDRAW: 'Acima do limite diário de levantamento.',
  BALANCE: 'Saldo insuficiente.', CONFIRM: 'Confirmação explícita em falta.', COMP_OWN_CHALLENGE: 'Membros das equipas não podem apostar no próprio desafio.',
  COMP_NOT_ELIGIBLE: 'Não cumpres os requisitos para apostar.', COMP_CLOSED: 'Apostas fechadas.', COMP_BETTING_OFF: 'Apostas: ' + UNAVAILABLE.toLowerCase() + '.',
  ODDS_CHANGED: 'As odds mudaram. Revê e confirma de novo.', MFA_REQUIRED: 'Operação sensível: entra com a app autenticadora (2FA).',
  LICENCE: 'Regista primeiro uma licença válida.', BETTING_NEEDS_MONETARY: 'As apostas exigem as funcionalidades monetárias ligadas.',
  DATES: 'Datas da licença inválidas.', EXPIRED: 'Licença fora da validade.', AUTHORITY: 'Indica a entidade emissora.', NUMBER: 'Indica o número da licença.',
  ALREADY: 'Já existe.', ACTION: 'Ação inválida.', INVALID: 'Valores inválidos.', SIGNATURE: 'Assinatura inválida.',
  NOT_INSTALLED: 'Módulo competitivo ainda não está ativo na base de dados.', ERRO: 'Algo correu mal. Tenta novamente.',
};
export const compText = (code?: string | null) => (code && COMP_TEXT[code]) || COMP_TEXT.ERRO;

export function newIdemKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
