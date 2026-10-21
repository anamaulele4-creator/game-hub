// Painel de valor da aposta (estilo Aviator) — lógica pura, sem React, testada em tests/stake.test.mjs.
// NÃO decide nada sobre dinheiro: o servidor (bets_place) volta a validar tudo. Aqui só se calcula o que mostrar
// (retorno, lucro, mínimo/máximo, chips) e porque é que um botão 1 / 2 está fechado.
import type { BetSettings, MarketStatus, MatchStatus, PersonalLimits } from './bets.ts';
import { potentialReturn } from './bets.ts';

/** Valores rápidos em MT (mais "Máx." = saldo, limitado ao máximo do mercado). */
export const STAKE_CHIPS = [10, 20, 50, 100, 500] as const;
export const STAKE_DEFAULT = 50;
export const STAKE_LAST_KEY = 'txap-stake-last';

/** Inteiro ≥ 0 a partir do que o utilizador escreveu ("1 000", "50 MT", "abc" → 0). */
export function parseStake(txt: string | number): number {
  const n = typeof txt === 'number' ? txt : Number(String(txt).replace(/\D/g, '').slice(0, 7));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Retorno potencial = valor × odd (limitado ao pagamento máximo, igual ao servidor); lucro = retorno − valor. */
export function stakeMath(stake: number, odds: number, maxPayout: number): { retorno: number; lucro: number; capped: boolean } {
  const s = Math.max(0, Math.floor(stake || 0));
  if (!s || !(odds > 1)) return { retorno: 0, lucro: 0, capped: false };
  const raw = Math.floor(s * odds + 1e-9);
  const retorno = potentialReturn(s, odds, maxPayout);
  return { retorno, lucro: retorno - s, capped: raw > retorno };
}

export interface StakeCtx {
  /** definições já para a moeda (cfgFor(settings, 'mt')) */
  cfg: Pick<BetSettings, 'minStake' | 'maxStake' | 'maxPayout'>;
  /** limites pessoais já para a moeda (limitsFor(limits, 'mt')); null = sem sessão */
  limits?: Pick<PersonalLimits, 'maxStake' | 'maxDaily' | 'maxWeekly'> | null;
  balance?: number | null;
  stakedToday?: number;
  stakedWeek?: number;
}

/** Máximo que se pode apostar agora: máximo do mercado, limites pessoais (aposta/dia/semana). O saldo fica de fora
 *  de propósito, para o aviso "Saldo insuficiente" aparecer (com o link para a Carteira) em vez de um valor cortado. */
export function maxAllowed(c: StakeCtx): number {
  let m = c.cfg.maxStake;
  const l = c.limits;
  if (l?.maxStake != null) m = Math.min(m, l.maxStake);
  if (l?.maxDaily != null) m = Math.min(m, l.maxDaily - (c.stakedToday ?? 0));
  if (l?.maxWeekly != null) m = Math.min(m, l.maxWeekly - (c.stakedWeek ?? 0));
  return Math.max(0, Math.floor(m));
}

/** "Máx." = saldo, sem passar o máximo permitido. 0 quando não há saldo. */
export function maxChip(c: StakeCtx): number {
  const bal = Math.max(0, Math.floor(c.balance ?? 0));
  return Math.min(bal, maxAllowed(c));
}

/** Mantém o valor dentro de [mínimo, máximo permitido]. */
export function clampStake(stake: number, c: StakeCtx): number {
  const hi = maxAllowed(c);
  const lo = Math.min(c.cfg.minStake, hi);
  return Math.min(Math.max(Math.floor(stake || 0), lo), hi);
}

/** Passo dos botões − / +: 10 MT até 200, 50 até 1000, depois 100. */
export function stakeStep(stake: number): number {
  return stake < 200 ? 10 : stake < 1000 ? 50 : 100;
}
export function stepStake(stake: number, dir: 1 | -1, c: StakeCtx): number {
  const s = Math.floor(stake || 0);
  const step = stakeStep(dir === 1 ? s : Math.max(0, s - 1));
  // alinha ao passo (ex.: 37 + → 40, 37 − → 30) e respeita mínimo/máximo
  const next = dir === 1 ? Math.floor(s / step) * step + step : Math.ceil(s / step) * step - step;
  return clampStake(next, c);
}

export type ChipState = { value: number; label: string; disabled: boolean; why: string };
/** Chips rápidos: desativados quando ficam abaixo do mínimo ou acima do máximo permitido. */
export function stakeChips(c: StakeCtx): ChipState[] {
  const hi = maxAllowed(c);
  const out: ChipState[] = STAKE_CHIPS.map((v) => ({
    value: v, label: String(v),
    disabled: v < c.cfg.minStake || v > hi,
    why: v < c.cfg.minStake ? `Mínimo ${c.cfg.minStake} MT` : v > hi ? `Máximo ${hi} MT` : '',
  }));
  const mx = maxChip(c);
  out.push({ value: mx, label: 'Máx.', disabled: mx < c.cfg.minStake, why: mx < c.cfg.minStake ? 'Saldo insuficiente' : '' });
  return out;
}

export type StakeIssue = 'STAKE_MIN' | 'STAKE_MAX' | 'LIMIT' | 'BALANCE';
export const STAKE_ISSUE_TEXT: Record<StakeIssue, string> = {
  STAKE_MIN: 'Valor abaixo do mínimo por aposta.',
  STAKE_MAX: 'Valor acima do máximo por aposta.',
  LIMIT: 'Passa um dos teus limites de jogo responsável.',
  BALANCE: 'Saldo insuficiente.',
};
/** Problemas do valor escolhido (o servidor volta a verificar). */
export function stakeIssues(stake: number, c: StakeCtx): StakeIssue[] {
  const e: StakeIssue[] = [];
  if (!(stake >= c.cfg.minStake)) e.push('STAKE_MIN');
  else if (stake > c.cfg.maxStake) e.push('STAKE_MAX');
  else if (stake > maxAllowed(c)) e.push('LIMIT');
  if (c.balance != null && stake > c.balance) e.push('BALANCE');
  return e;
}

/* ---------- Porque é que um botão 1 / 2 está fechado ---------- */
export interface ReasonInput {
  settings?: Pick<BetSettings, 'betsEnabled' | 'realMoneyEnabled'> | null;
  readOnly?: boolean;
  market?: { status: MarketStatus; closesAt: string | null; autoSuspended?: boolean; matchId: string | null } | null;
  match?: { status: MatchStatus; startsAt: string; voided?: boolean } | null;
  odds?: number;
  now: number;
}
/** Horas "ao vivo" a partir das quais se diz que falta o resultado do organizador. */
export const AWAIT_RESULT_HOURS = 6;

/** null = aberto; senão o texto a mostrar quando se toca no botão. Segue só o que o servidor reporta. */
export function closedReason(x: ReasonInput): string | null {
  if (x.settings && !x.settings.realMoneyEnabled) return 'Apostas indisponíveis neste momento.';
  if (x.settings && x.settings.betsEnabled === false) return 'As apostas foram desativadas pela plataforma neste momento.';
  if (x.readOnly) return 'Exemplo: não é possível apostar.';
  const mk = x.market;
  if (!mk) return 'Mercado indisponível.';
  const m = x.match;
  if (m) {
    if (m.voided || m.status === 'cancelado') return 'Jogo cancelado — as apostas foram anuladas e reembolsadas.';
    if (m.status === 'terminado') return 'Jogo terminado — mercado fechado.';
    if (m.status === 'adiado') return 'Jogo adiado — apostas suspensas até haver nova hora.';
    const started = Date.parse(m.startsAt) <= x.now;
    if (m.status === 'ao_vivo' || started) {
      const h = (x.now - Date.parse(m.startsAt)) / 3600e3;
      return h >= AWAIT_RESULT_HOURS ? 'Mercado fechado — o jogo já começou (a aguardar o resultado do organizador).' : 'Mercado fechado — o jogo já começou.';
    }
  }
  if (mk.status === 'liquidado') return 'Mercado já liquidado.';
  if (mk.status === 'anulado') return 'Mercado anulado.';
  if (mk.status === 'suspenso') return mk.autoSuspended ? 'Mercado fechado.' : 'Mercado suspenso pela equipa neste momento.';
  if (mk.closesAt && Date.parse(mk.closesAt) <= x.now) return 'Mercado fechado.';
  if (x.odds != null && !(x.odds > 1)) return 'Ainda sem odd para esta seleção.';
  return null;
}

/** Texto para os códigos devolvidos por bets_place. */
export const PLACE_CODE_TEXT: Record<string, string> = {
  BALANCE: 'Saldo insuficiente. Carrega a Carteira e tenta outra vez.',
  CLOSED: 'Mercado fechado — o jogo já começou ou o mercado foi suspenso.',
  MARKET: 'Mercado fechado.',
  BETS_OFF: 'As apostas foram desativadas pela plataforma neste momento.',
  REAL_OFF: 'Apostas indisponíveis neste momento.',
  KYC: 'Para apostar tens de ter a identidade verificada (Carteira MT › KYC).',
  NO_AGE: 'Confirma que tens 18 anos ou mais antes da primeira aposta.',
  MINOR: 'A tua conta indica menos de 18 anos. As apostas não estão disponíveis para ti.',
  SELF_EXCLUDED: 'Estás em autoexclusão. Não podes apostar até ao fim do período.',
  STAKE_MIN: 'Valor abaixo do mínimo por aposta.',
  STAKE_MAX: 'Valor acima do máximo por aposta.',
  LIMIT_STAKE: 'Passa o teu limite pessoal por aposta.',
  LIMIT_DAILY: 'Passa o teu limite pessoal diário.',
  LIMIT_WEEKLY: 'Passa o teu limite pessoal semanal.',
  AUTH: 'Entra na tua conta para apostar.',
  ODDS_CHANGED: 'A odd mudou. Confirma com a nova odd.',
};
