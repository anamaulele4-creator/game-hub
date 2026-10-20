// Afiliados, permissões por função e verificação de vendedores — regras puras (iguais às do SQL em
// supabase/migrations/2026-10-20-moderador-afiliados.sql). Testes: tests/affiliates.test.mjs e tests/affiliates-sql.test.mjs.
//
// Regra de comissão (decisão do dono, 2026-10-20):
//   • Só ganha comissão quem tem função 'moderador' (influenciador) ou 'admin'. Outros padrinhos não recebem nada.
//   • A comissão (por omissão 10 %, configurável pelo admin) só nasce quando o convidado GANHA dinheiro:
//     lucro líquido de apostas em MT (pagamento − valor apostado), vendas concluídas no marketplace (valor do vendedor,
//     já sem a taxa da plataforma), prémios de torneios/campeonatos e vitórias em desafios.
//   • Registos, depósitos, perdas e compras NÃO geram comissão.
//   • É a plataforma que paga a comissão (bónus ao influenciador). O convidado fica com 100 % do que ganhou.
//   • Idempotente: no máximo uma comissão por evento de origem (tipo + referência).

export type AppRole = 'utilizador' | 'criador' | 'moderador' | 'admin';
export const ROLE_NAMES: Record<AppRole, string> = { utilizador: 'Utilizador', criador: 'Criador', moderador: 'Moderador (influenciador)', admin: 'Admin' };

/** Papéis do Postgres (profiles.role) → papéis da app. */
export const roleFromDb = (r: string | null | undefined): AppRole => (r === 'admin' ? 'admin' : r === 'moderator' ? 'moderador' : r === 'creator' ? 'criador' : 'utilizador');

/** Papel do estado da app (s.user.role: 'admin' | 'moderador' | 'criador' | 'user') → AppRole. */
export const appRole = (r: string | null | undefined): AppRole => (r === 'admin' || r === 'moderador' || r === 'criador' ? r : 'utilizador');

/* ---------------- Permissões ---------------- */
/** Criar torneios e campeonatos: moderador e admin. ('criador' e 'utilizador' só participam — como já era.) */
export const canCreateTournament = (r: AppRole | undefined) => r === 'moderador' || r === 'admin';
/** Destacar os PRÓPRIOS anúncios no marketplace (o admin pode retirar a permissão a um moderador). */
export const canFeatureListing = (r: AppRole | undefined, revoked = false) => r === 'admin' || (r === 'moderador' && !revoked);
/** Ganhar comissões de afiliado. */
export const canEarnCommission = (r: AppRole | undefined) => r === 'moderador' || r === 'admin';
/** Ver o painel de afiliado. */
export const hasAffiliatePanel = canEarnCommission;
/** Apostar e criar apostas: qualquer conta (o dinheiro real continua atrás de realOn()/interruptores do servidor). */
export const canBet = (_r: AppRole | undefined) => true;

/* ---------------- Código e link ---------------- */
export const AFF_CODE_RE = /^[A-Z0-9]{4,16}$/;
export const normalizeCode = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
export const validCode = (s: string | null | undefined) => AFF_CODE_RE.test(normalizeCode(s));
export function affiliateLink(site: string, code: string): string {
  return `${site.replace(/\/+$/, '')}/registar/?ref=${encodeURIComponent(normalizeCode(code))}`;
}
/** Lê ?ref= de um URL/search. Devolve null se não for um código válido. */
export function refFromSearch(search: string): string | null {
  const qs = search.includes('?') ? search.slice(search.indexOf('?')) : '?' + search;
  const v = new URLSearchParams(qs).get('ref');
  const c = normalizeCode(v);
  return AFF_CODE_RE.test(c) ? c : null;
}
/** Sugestão de código a partir do @ (o servidor acrescenta 4 caracteres aleatórios e garante unicidade). */
export const codeBase = (handle: string) => normalizeCode(handle.replace(/^@/, '')).slice(0, 8) || 'TXAP';

/* ---------------- Comissões ---------------- */
export const DEFAULT_COMMISSION_PCT = 10;
export const MAX_COMMISSION_PCT = 50;
/** Tipos de evento que geram comissão (ganhos do convidado). */
export type GainKind = 'aposta' | 'desafio' | 'venda' | 'torneio' | 'campeonato';
/** Eventos que NUNCA geram comissão. */
export type NoGainKind = 'registo' | 'deposito' | 'perda' | 'compra' | 'aposta_perdida' | 'reembolso';
export const GAIN_KINDS: GainKind[] = ['aposta', 'desafio', 'venda', 'torneio', 'campeonato'];
export const GAIN_LABEL: Record<GainKind, string> = { aposta: 'Aposta ganha', desafio: 'Desafio ganho', venda: 'Venda no marketplace', torneio: 'Prémio de torneio', campeonato: 'Prémio de campeonato' };

export const validPct = (p: number) => Number.isFinite(p) && p >= 0 && p <= MAX_COMMISSION_PCT;

/** Ganho líquido de uma aposta: pagamento − valor apostado (o valor devolvido não conta). Só apostas em MT ganhas. */
export function betGain(b: { status: string; stake: number; payout: number; currency: string }): number {
  if (b.currency !== 'mt' || b.status !== 'ganha') return 0;
  return Math.max(0, Math.floor(b.payout) - Math.floor(b.stake));
}
/** Valor do vendedor numa venda concluída: total − taxa da plataforma (taxa null = 0). */
export function saleGain(o: { status: string; totalMzn: number; feePct: number | null }): number {
  if (o.status !== 'concluido') return 0;
  return Math.max(0, o.totalMzn - Math.floor((o.totalMzn * (o.feePct ?? 0)) / 100));
}
/** Comissão em MT inteiros (arredondada para baixo). */
export const commissionOf = (gain: number, pct: number) => (gain > 0 && validPct(pct) ? Math.floor((Math.floor(gain) * pct) / 100) : 0);

export interface AffUser { id: string; role: AppRole; referredBy: string | null; banned?: boolean; createdAt?: number }
export interface Commission { id: string; referrerId: string; inviteeId: string; kind: GainKind; sourceRef: string; gain: number; pct: number; amount: number; status: 'creditado' | 'anulado'; at: string }
export interface AffDB { users: AffUser[]; commissions: Commission[]; wallet: Record<string, number>; pct: number; enabled: boolean }

export type CreditResult = { ok: true; amount: number; commissionId: string } | { ok: false; reason: 'NO_GAIN' | 'NOT_GAIN_KIND' | 'NO_REFERRER' | 'SELF' | 'REFERRER_NOT_ELIGIBLE' | 'DISABLED' | 'ZERO' | 'DUPLICATE' };

/**
 * Espelho de public.affiliate__credit: credita a comissão ao padrinho (se elegível) sem tocar no ganho do convidado.
 * Idempotente por (kind, sourceRef).
 */
export function creditCommission(db: AffDB, inviteeId: string, kind: GainKind | NoGainKind, sourceRef: string, gain: number, now = Date.now()): CreditResult {
  if (!GAIN_KINDS.includes(kind as GainKind)) return { ok: false, reason: 'NOT_GAIN_KIND' };
  if (!(gain > 0)) return { ok: false, reason: 'NO_GAIN' };
  if (!db.enabled) return { ok: false, reason: 'DISABLED' };
  const inv = db.users.find((u) => u.id === inviteeId);
  if (!inv?.referredBy) return { ok: false, reason: 'NO_REFERRER' };
  if (inv.referredBy === inviteeId) return { ok: false, reason: 'SELF' };
  const ref = db.users.find((u) => u.id === inv.referredBy);
  if (!ref || ref.banned || !canEarnCommission(ref.role)) return { ok: false, reason: 'REFERRER_NOT_ELIGIBLE' };
  if (db.commissions.some((c) => c.kind === kind && c.sourceRef === sourceRef)) return { ok: false, reason: 'DUPLICATE' };
  const amount = commissionOf(gain, db.pct);
  if (amount < 1) return { ok: false, reason: 'ZERO' };
  const c: Commission = { id: `c${db.commissions.length + 1}`, referrerId: ref.id, inviteeId, kind: kind as GainKind, sourceRef, gain: Math.floor(gain), pct: db.pct, amount, status: 'creditado', at: new Date(now).toISOString() };
  db.commissions.push(c);
  db.wallet[ref.id] = (db.wallet[ref.id] ?? 0) + amount; // bónus pago pela plataforma
  return { ok: true, amount, commissionId: c.id };
}

/** Espelho de public.affiliate_apply_code: define o padrinho uma única vez, sem auto-convite nem ciclos diretos. */
export type ApplyResult = { ok: true } | { ok: false; code: 'INVALID' | 'NOT_FOUND' | 'SELF' | 'ALREADY' | 'CYCLE' | 'TOO_LATE' };
export const APPLY_WINDOW_DAYS = 7;
export function applyReferral(db: AffDB, userId: string, referrerId: string | null, now = Date.now()): ApplyResult {
  const u = db.users.find((x) => x.id === userId);
  if (!u) return { ok: false, code: 'INVALID' };
  if (u.referredBy) return { ok: false, code: 'ALREADY' };
  if (!referrerId) return { ok: false, code: 'NOT_FOUND' };
  if (referrerId === userId) return { ok: false, code: 'SELF' };
  const r = db.users.find((x) => x.id === referrerId);
  if (!r) return { ok: false, code: 'NOT_FOUND' };
  if (r.referredBy === userId) return { ok: false, code: 'CYCLE' };
  if (u.createdAt && now - u.createdAt > APPLY_WINDOW_DAYS * 86400e3) return { ok: false, code: 'TOO_LATE' };
  u.referredBy = referrerId;
  return { ok: true };
}

export const AFF_ERR: Record<string, string> = {
  INVALID: 'Código de afiliado inválido.', NOT_FOUND: 'Código de afiliado não encontrado.', SELF: 'Não podes usar o teu próprio código.',
  ALREADY: 'A tua conta já tem um código de afiliado associado.', CYCLE: 'Esse código pertence a alguém que tu convidaste.',
  TOO_LATE: `O código só pode ser associado nos primeiros ${APPLY_WINDOW_DAYS} dias da conta.`, AUTH: 'Entra na tua conta.', FORBIDDEN: 'Sem permissão.',
  NOT_INSTALLED: 'Funcionalidade ainda não instalada no servidor.', PCT: `Percentagem entre 0 e ${MAX_COMMISSION_PCT}.`, REASON: 'Indica o motivo da recusa (mín. 5 caracteres).',
  FILES: 'Envia a foto do documento e a selfie.', STATE: 'Esta verificação já foi decidida.',
};

/* ---------------- Verificação de vendedores ---------------- */
export type VerificationStatus = 'nenhuma' | 'pendente' | 'aprovado' | 'rejeitado';
export const VERIF_LABEL: Record<VerificationStatus, string> = { nenhuma: 'Por verificar', pendente: 'Em análise', aprovado: 'Verificado', rejeitado: 'Recusado' };
/** Contas e diamantes/moedas exigem vendedor verificado (documento + selfie). */
export const needsSellerVerification = (kind: string, category: string) => kind === 'conta' || kind === 'moedas' || category === 'moedas';
export function canCreateListing(kind: string, category: string, status: VerificationStatus, role?: AppRole): boolean {
  if (role === 'admin') return true;
  return !needsSellerVerification(kind, category) || status === 'aprovado';
}

/* ---------------- Valor da aposta escolhido pelo utilizador ---------------- */
export type StakeError = 'STAKE_INT' | 'STAKE_MIN' | 'STAKE_MAX';
/** Valida o valor (MT inteiros) entre os limites do servidor (bet_settings.mt_min_stake / mt_max_stake) e o limite pessoal. */
export function validateStake(stake: number, min: number, max: number, personalMax?: number | null): StakeError | null {
  if (!Number.isInteger(stake)) return 'STAKE_INT';
  if (stake < min) return 'STAKE_MIN';
  if (stake > Math.min(max, personalMax ?? Infinity)) return 'STAKE_MAX';
  return null;
}
export const STAKE_ERR: Record<StakeError, string> = { STAKE_INT: 'Indica um valor inteiro em MT.', STAKE_MIN: 'Valor abaixo do mínimo.', STAKE_MAX: 'Valor acima do máximo.' };
