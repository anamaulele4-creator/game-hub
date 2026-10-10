// Apostas TXAPILOG — motor determinístico, escrito à mão (sem IA em lado nenhum).
// Regras: Elo → probabilidades → margem da casa → odds arredondadas a 2 casas, entre 1.05 e 50.
// A MESMA lógica existe em SQL (supabase/migrations/2026-10-10-bets.sql); o servidor é a fonte de verdade
// em produção, este ficheiro serve o modo demo, a pré-visualização do boletim e os testes (tests/bets.test.mjs).
//
// Moeda: TXAP Pontos — pontos virtuais SEM valor monetário (não se compram, não se levantam, não se convertem).
// Dinheiro real só com licença da Inspecção Geral de Jogos (IGJ) + pagamentos ativos.

export type BetGame = 'ff' | 'cr' | 'ef' | 'dls' | 'outros';
export type MarketKind = '1x2' | '12' | 'total' | 'exact' | 'outright';
export type MarketStatus = 'aberto' | 'suspenso' | 'liquidado' | 'anulado';
export type SelResult = 'pendente' | 'ganha' | 'perdida' | 'anulada';
export type BetStatus = 'aberta' | 'ganha' | 'perdida' | 'anulada';
export type MatchStatus = 'agendado' | 'ao_vivo' | 'terminado' | 'cancelado' | 'adiado';

export const ODDS_MIN = 1.05;
export const ODDS_MAX = 50;
export const ELO_START = 1500;
export const POSTPONE_VOID_HOURS = 48;
export const SELF_EXCLUSION_DAYS = [7, 30, 90] as const;
export const POINTS = 'TXAP Pontos';
export const BETS_BANNER = 'Apostas com TXAP Pontos — sem dinheiro real. Dinheiro real só com licença do IGJ.';

export interface BetSettings {
  /** interruptor geral "Apostas ativas" */
  betsEnabled: boolean;
  margin: number; // 0.07 = 7 %
  minStake: number;
  maxStake: number;
  maxPayout: number;
  maxLegs: number;
  weeklyAllowance: number;
  eloK: number;
  bigStakeAlert: number;
  sameSelectionAlert: number;
  realMoneyEnabled: boolean;
  igjLicenceNo: string;
  /** data de emissão da licença IGJ (AAAA-MM-DD) */
  igjLicenceDate: string;
  /** data de validade da licença IGJ (AAAA-MM-DD) */
  igjLicenceExpiry: string;
  // Dinheiro real (MT) — limites próprios, separados dos TXAP Pontos
  mtMinStake: number;
  mtMaxStake: number;
  mtMaxPayout: number;
  mtMinWithdraw: number;
  mtMaxWithdrawDaily: number;
}

export type Currency = 'pontos' | 'mt';

export const DEFAULT_SETTINGS: BetSettings = {
  betsEnabled: true, margin: 0.07, minStake: 10, maxStake: 5000, maxPayout: 100000, maxLegs: 10, weeklyAllowance: 1000,
  eloK: 32, bigStakeAlert: 2000, sameSelectionAlert: 20, realMoneyEnabled: false, igjLicenceNo: '', igjLicenceDate: '', igjLicenceExpiry: '',
  mtMinStake: 10, mtMaxStake: 2000, mtMaxPayout: 50000, mtMinWithdraw: 50, mtMaxWithdrawDaily: 20000,
};

export const FOOTBALL: BetGame[] = ['ef', 'dls'];
export const isFootball = (g: BetGame) => FOOTBALL.includes(g);

/** Golos/kills/coroas esperados num jogo (soma das duas equipas) e linha do mercado Mais/Menos. Valores fixos, à mão. */
export const TOTAL_MEAN: Record<BetGame, number> = { ef: 2.7, dls: 3.1, ff: 20, cr: 2.6, outros: 3 };
export const TOTAL_LINE: Record<BetGame, number> = { ef: 2.5, dls: 2.5, ff: 19.5, cr: 2.5, outros: 2.5 };
export const TOTAL_UNIT: Record<BetGame, string> = { ef: 'golos', dls: 'golos', ff: 'kills', cr: 'coroas', outros: 'pontos' };
/** Resultados exatos oferecidos (0-0 … 3-3) + "Outro". */
export const EXACT_SCORES: string[] = (() => { const r: string[] = []; for (let h = 0; h <= 3; h++) for (let a = 0; a <= 3; a++) r.push(`${h}-${a}`); return r; })();
const MAX_GOALS = 10;

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function clampOdds(o: number): number {
  return Math.min(ODDS_MAX, Math.max(ODDS_MIN, o));
}

/** Probabilidade justa → odd com margem: 1 / (p × (1 + margem)), 2 casas, entre 1.05 e 50. */
export function priceOdds(p: number, margin: number): number {
  if (!(p > 0)) return ODDS_MAX;
  return clampOdds(round2(1 / (p * (1 + margin))));
}

/** Elo: resultado esperado da equipa A contra B (0–1). */
export function eloExpected(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** Atualização Elo. scoreA: 1 vitória, 0.5 empate, 0 derrota. Devolve [deltaA, deltaB] arredondados a 2 casas. */
export function eloDelta(ra: number, rb: number, scoreA: number, k: number): [number, number] {
  const d = round2(k * (scoreA - eloExpected(ra, rb)));
  return [d, -d];
}

export function poissonPmf(lambda: number, max: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= max; k++) { out.push(p); p = (p * lambda) / (k + 1); }
  return out;
}

/** P(total > linha) com total ~ Poisson(λ). */
export function probOver(lambda: number, line: number): number {
  const n = Math.floor(line);
  const pmf = poissonPmf(lambda, n);
  let cdf = 0;
  for (let k = 0; k <= n; k++) cdf += pmf[k];
  return Math.min(1, Math.max(0, 1 - cdf));
}

/** Matriz de resultados (golos casa × fora) para futebol, a partir do Elo. Normalizada para somar 1. */
export function scoreMatrix(rh: number, ra: number, game: BetGame): number[][] {
  const e = eloExpected(rh, ra);
  const mean = TOTAL_MEAN[game];
  const ph = poissonPmf(mean * e, MAX_GOALS);
  const pa = poissonPmf(mean * (1 - e), MAX_GOALS);
  let sum = 0;
  const m: number[][] = [];
  for (let h = 0; h <= MAX_GOALS; h++) { m.push([]); for (let a = 0; a <= MAX_GOALS; a++) { const v = ph[h] * pa[a]; m[h].push(v); sum += v; } }
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) m[h][a] /= sum;
  return m;
}

export interface SelSpec { code: string; label: string; prob: number }
export interface MarketSpec { kind: MarketKind; line: number | null; title: string; selections: SelSpec[] }

export function marketTitle(kind: MarketKind, game: BetGame, line: number | null): string {
  if (kind === '1x2' || kind === '12') return 'Vencedor';
  if (kind === 'total') return `Total de ${TOTAL_UNIT[game]} · Mais/Menos ${line}`;
  if (kind === 'exact') return 'Resultado exato';
  return 'Vencedor do torneio';
}

/** Probabilidades justas de todos os mercados de um jogo (antes da margem). Determinístico. */
export function matchMarkets(game: BetGame, home: string, away: string, rh: number, ra: number): MarketSpec[] {
  const line = TOTAL_LINE[game];
  const over = probOver(TOTAL_MEAN[game], line);
  const total: MarketSpec = {
    kind: 'total', line, title: marketTitle('total', game, line),
    selections: [{ code: 'over', label: `Mais de ${line}`, prob: over }, { code: 'under', label: `Menos de ${line}`, prob: 1 - over }],
  };
  if (!isFootball(game)) {
    const e = eloExpected(rh, ra);
    return [{ kind: '12', line: null, title: 'Vencedor', selections: [{ code: '1', label: home, prob: e }, { code: '2', label: away, prob: 1 - e }] }, total];
  }
  const m = scoreMatrix(rh, ra, game);
  let p1 = 0, px = 0, p2 = 0;
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) { if (h > a) p1 += m[h][a]; else if (h === a) px += m[h][a]; else p2 += m[h][a]; }
  let listed = 0;
  const exact: SelSpec[] = EXACT_SCORES.map((c) => { const [h, a] = c.split('-').map(Number); listed += m[h][a]; return { code: c, label: c, prob: m[h][a] }; });
  exact.push({ code: 'outro', label: 'Outro resultado', prob: Math.max(0, 1 - listed) });
  return [
    { kind: '1x2', line: null, title: 'Vencedor', selections: [{ code: '1', label: home, prob: p1 }, { code: 'X', label: 'Empate', prob: px }, { code: '2', label: away, prob: p2 }] },
    total,
    { kind: 'exact', line: null, title: 'Resultado exato', selections: exact },
  ];
}

/** Vencedor do torneio: p_i ∝ 10^(Elo_i/400). */
export function outrightProbs(teams: { name: string; rating: number }[]): SelSpec[] {
  const w = teams.map((t) => Math.pow(10, t.rating / 400));
  const s = w.reduce((a, b) => a + b, 0) || 1;
  return teams.map((t, i) => ({ code: t.name, label: t.name, prob: w[i] / s }));
}

/** Resultado de uma seleção dado o resultado final do jogo. */
export function selectionResult(kind: MarketKind, code: string, line: number | null, h: number, a: number): SelResult {
  if (kind === '1x2') return code === (h > a ? '1' : h === a ? 'X' : '2') ? 'ganha' : 'perdida';
  if (kind === '12') { if (h === a) return 'anulada'; return code === (h > a ? '1' : '2') ? 'ganha' : 'perdida'; }
  if (kind === 'total') { const over = h + a > (line ?? 0); return (code === 'over') === over ? 'ganha' : 'perdida'; }
  if (kind === 'exact') { const c = h <= 3 && a <= 3 ? `${h}-${a}` : 'outro'; return code === c ? 'ganha' : 'perdida'; }
  return 'pendente';
}

/** Odd total de uma múltipla: produto das odds (anuladas contam 1.00), 2 casas. */
export function comboOdds(odds: number[]): number {
  return round2(odds.reduce((a, b) => a * b, 1));
}

export function potentialReturn(stake: number, odds: number, maxPayout: number): number {
  return Math.min(Math.floor(stake * odds + 1e-9), maxPayout);
}

/** Estado de uma aposta a partir das pernas: perdida se alguma perdeu; pendente se falta alguma; senão ganha (ou anulada se todas anuladas). */
export function evalBet(legs: { odds: number; result: SelResult }[], stake: number, maxPayout: number): { status: BetStatus; payout: number; odds: number } {
  if (legs.some((l) => l.result === 'perdida')) return { status: 'perdida', payout: 0, odds: 0 };
  if (legs.some((l) => l.result === 'pendente')) return { status: 'aberta', payout: 0, odds: 0 };
  if (legs.every((l) => l.result === 'anulada')) return { status: 'anulada', payout: stake, odds: 1 };
  const o = comboOdds(legs.map((l) => (l.result === 'anulada' ? 1 : l.odds)));
  return { status: 'ganha', payout: potentialReturn(stake, o, maxPayout), odds: o };
}

export interface PersonalLimits {
  maxStake: number | null;
  maxDaily: number | null;
  maxWeekly: number | null;
  selfExcludedUntil: string | null;
  ageConfirmedAt: string | null;
  /** limites pessoais em dinheiro real (MT) */
  mtMaxStake?: number | null;
  mtMaxDaily?: number | null;
  mtMaxWeekly?: number | null;
}
export const NO_LIMITS: PersonalLimits = { maxStake: null, maxDaily: null, maxWeekly: null, selfExcludedUntil: null, ageConfirmedAt: null, mtMaxStake: null, mtMaxDaily: null, mtMaxWeekly: null };

export interface SlipLeg { selectionId: string; groupId: string; odds: number; open: boolean }
export type SlipError =
  | 'NO_AGE' | 'SELF_EXCLUDED' | 'EMPTY' | 'TOO_MANY_LEGS' | 'SAME_MATCH' | 'CLOSED' | 'STAKE_MIN' | 'STAKE_MAX'
  | 'LIMIT_STAKE' | 'LIMIT_DAILY' | 'LIMIT_WEEKLY' | 'BALANCE' | 'REAL_OFF' | 'KYC' | 'BETS_OFF';

export const SLIP_ERROR_TEXT: Record<SlipError, string> = {
  NO_AGE: 'Confirma que tens 18 anos ou mais antes da primeira aposta.',
  SELF_EXCLUDED: 'Estás em autoexclusão. Não podes apostar até ao fim do período.',
  EMPTY: 'Escolhe pelo menos uma seleção.',
  TOO_MANY_LEGS: 'Uma múltipla pode ter no máximo 10 seleções.',
  SAME_MATCH: 'Não podes juntar duas seleções do mesmo jogo numa múltipla.',
  CLOSED: 'Uma das seleções já não está aberta.',
  STAKE_MIN: 'Valor abaixo do mínimo por aposta.',
  STAKE_MAX: 'Valor acima do máximo por aposta.',
  LIMIT_STAKE: 'Passa o teu limite pessoal por aposta.',
  LIMIT_DAILY: 'Passa o teu limite pessoal diário.',
  LIMIT_WEEKLY: 'Passa o teu limite pessoal semanal.',
  BALANCE: 'Saldo insuficiente.',
  REAL_OFF: 'As apostas com dinheiro real não estão ativas.',
  BETS_OFF: 'As apostas estão desativadas neste momento.',
  KYC: 'Para apostar com dinheiro tens de ter a verificação de identidade (KYC) aprovada.',
};

/** Validação do boletim (mesmas regras que bets_place no servidor). */
export function validateSlip(
  legs: SlipLeg[], stake: number, cfg: BetSettings, lim: PersonalLimits,
  ctx: { balance: number; stakedToday: number; stakedWeek: number; now: number },
): SlipError[] {
  const e: SlipError[] = [];
  if (!lim.ageConfirmedAt) e.push('NO_AGE');
  if (lim.selfExcludedUntil && Date.parse(lim.selfExcludedUntil) > ctx.now) e.push('SELF_EXCLUDED');
  if (!legs.length) e.push('EMPTY');
  if (legs.length > Math.min(cfg.maxLegs, 10)) e.push('TOO_MANY_LEGS');
  if (new Set(legs.map((l) => l.groupId)).size !== legs.length) e.push('SAME_MATCH');
  if (legs.some((l) => !l.open)) e.push('CLOSED');
  if (!(stake >= cfg.minStake)) e.push('STAKE_MIN');
  if (stake > cfg.maxStake) e.push('STAKE_MAX');
  if (lim.maxStake != null && stake > lim.maxStake) e.push('LIMIT_STAKE');
  if (lim.maxDaily != null && ctx.stakedToday + stake > lim.maxDaily) e.push('LIMIT_DAILY');
  if (lim.maxWeekly != null && ctx.stakedWeek + stake > lim.maxWeekly) e.push('LIMIT_WEEKLY');
  if (stake > ctx.balance) e.push('BALANCE');
  return e;
}

export const REAL_MONEY_CONFIRM = 'CONFIRMO';
/** Interruptor de dinheiro real: só liga com nº da licença IGJ, data de emissão, validade futura e confirmação explícita. */
export function realMoneyUnlockable(
  cfg: Pick<BetSettings, 'igjLicenceNo' | 'igjLicenceDate' | 'igjLicenceExpiry'>, confirm: string, today: string,
): { ok: boolean; reason: string } {
  const d = /^\d{4}-\d{2}-\d{2}$/;
  if (!cfg.igjLicenceNo.trim()) return { ok: false, reason: 'Indica o número da licença da IGJ.' };
  if (!d.test(cfg.igjLicenceDate)) return { ok: false, reason: 'Indica a data de emissão da licença.' };
  if (!d.test(cfg.igjLicenceExpiry)) return { ok: false, reason: 'Indica a data de validade da licença.' };
  if (cfg.igjLicenceDate > today) return { ok: false, reason: 'A data de emissão não pode ser no futuro.' };
  if (cfg.igjLicenceExpiry <= today) return { ok: false, reason: 'A licença está fora da validade.' };
  if (cfg.igjLicenceExpiry <= cfg.igjLicenceDate) return { ok: false, reason: 'A validade tem de ser depois da emissão.' };
  if (confirm.trim().toUpperCase() !== REAL_MONEY_CONFIRM) return { ok: false, reason: `Escreve ${REAL_MONEY_CONFIRM} para confirmar.` };
  return { ok: true, reason: '' };
}

/** Configuração efetiva para uma moeda (limites MT separados dos pontos). */
export function cfgFor(cfg: BetSettings, cur: Currency): BetSettings {
  return cur === 'mt' ? { ...cfg, minStake: cfg.mtMinStake, maxStake: cfg.mtMaxStake, maxPayout: cfg.mtMaxPayout } : cfg;
}
export function limitsFor(l: PersonalLimits, cur: Currency): PersonalLimits {
  return cur === 'mt' ? { ...l, maxStake: l.mtMaxStake ?? null, maxDaily: l.mtMaxDaily ?? null, maxWeekly: l.mtMaxWeekly ?? null } : l;
}

/* ---------- KYC (dinheiro real) ---------- */
export type IdType = 'BI' | 'NUIT';
export interface KycInput { fullName: string; birthDate: string; idType: IdType; idNumber: string; phone: string }
export type KycStatus = 'pendente' | 'aprovado' | 'recusado';
export interface Kyc extends KycInput { status: KycStatus; note: string; submittedAt: string }

export function ageOn(birth: string, today: string): number {
  const [y, m, d] = birth.split('-').map(Number); const [ty, tm, td] = today.split('-').map(Number);
  let a = ty - y; if (tm < m || (tm === m && td < d)) a--; return a;
}
/** BI moçambicano: 12 dígitos + 1 letra (ex.: 110100123456A). NUIT: 9 dígitos. Telefone: 84–87 + 7 dígitos. */
export function validateKyc(k: KycInput, today: string): string[] {
  const e: string[] = [];
  const name = k.fullName.trim();
  if (name.length < 5 || !/\s/.test(name)) e.push('Nome completo (nome e apelido).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k.birthDate) || isNaN(Date.parse(k.birthDate))) e.push('Data de nascimento inválida.');
  else if (ageOn(k.birthDate, today) < 18) e.push('Tens de ter 18 anos ou mais.');
  const id = k.idNumber.replace(/\s/g, '').toUpperCase();
  if (k.idType === 'BI' && !/^\d{12}[A-Z]$/.test(id)) e.push('BI: 12 dígitos e 1 letra (ex.: 110100123456A).');
  if (k.idType === 'NUIT' && !/^\d{9}$/.test(id)) e.push('NUIT: 9 dígitos.');
  if (!/^(\+?258)?8[4-7]\d{7}$/.test(k.phone.replace(/[\s-]/g, ''))) e.push('Telefone M-Pesa/e-Mola: 84–87 e 9 dígitos.');
  return e;
}

export function fmtMt(n: number): string {
  return `${Math.round(n).toLocaleString('pt-PT')} MT`;
}
export function fmtAmount(n: number, cur: Currency): string {
  return cur === 'mt' ? fmtMt(n) : fmtPts(n);
}

/** Semana ISO (Maputo, UTC+2 sem horário de verão) usada para o bónus semanal: "2026-W41". */
export function isoWeekRef(now: number): string {
  const d = new Date(now + 2 * 3600 * 1000); // Africa/Maputo
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

/** Início do dia e da semana (segunda-feira) em Maputo, em ms UTC. */
export function maputoDayStart(now: number): number {
  const off = 2 * 3600 * 1000;
  return Math.floor((now + off) / 86400000) * 86400000 - off;
}
export function maputoWeekStart(now: number): number {
  const ds = maputoDayStart(now);
  const dow = (new Date(ds + 2 * 3600 * 1000).getUTCDay() + 6) % 7; // 0 = segunda
  return ds - dow * 86400000;
}

export function fmtPts(n: number): string {
  return `${Math.round(n).toLocaleString('pt-PT')} pts`;
}
export function fmtOdds(o: number): string {
  return o.toFixed(2);
}
