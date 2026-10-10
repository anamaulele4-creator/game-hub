// Inscrição em torneios: regras puras (testadas em tests/registration.test.mjs).
import type { Tournament } from './data';
import { gameKeyOf, normalizeMzPhone, validPlayerId } from './jogos.ts';

const INVITE_RE = /^https:\/\/(discord\.gg|(www\.)?discord\.com\/invite)\/[A-Za-z0-9-]{2,32}\/?$/;
/** Usernames novos do Discord (2–32, minúsculas, números, _ e .) ou o formato antigo nome#1234. */
const USERNAME_RE = /^([a-z0-9_.]{2,32}|.{2,32}#\d{4})$/;

export function validDiscordInvite(url: string | null | undefined): boolean {
  return !!url && INVITE_RE.test(url.trim());
}

export function validDiscordUsername(u: string): boolean {
  const v = u.trim();
  return USERNAME_RE.test(v) && !v.includes('..');
}

export interface DiscordRule {
  /** convite a usar (o do torneio ou o padrão global), ou null */
  invite: string | null;
  /** o passo do Discord é obrigatório */
  required: boolean;
  /** obrigatório mas sem convite configurado: inscrição bloqueada e aviso no admin */
  missing: boolean;
}

export function discordRule(t: Pick<Tournament, 'discordInvite' | 'requireDiscord'>, globalInvite?: string): DiscordRule {
  const invite = validDiscordInvite(t.discordInvite) ? t.discordInvite!.trim() : validDiscordInvite(globalInvite) ? globalInvite!.trim() : null;
  const required = !!t.requireDiscord;
  return { invite, required, missing: required && !invite };
}

/** Modo de equipa (Squad, Duo, 4v4, Clash Squad…) pede nome da equipa; Solo e 1v1 não. */
export function isTeamMode(mode: string): boolean {
  const m = mode.toLowerCase();
  if (/solo|1v1|1 v 1/.test(m)) return false;
  return /squad|duo|equipa|team|[2-5]v[2-5]/.test(m);
}

export interface EntryForm { playerName: string; gameId: string; team: string; contact: string }
export type EntryField = keyof EntryForm;

/** Contacto: número moçambicano (84–87) ou email. */
export function validContact(c: string): boolean {
  const v = c.trim();
  return !!normalizeMzPhone(v) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export function validateEntry(f: EntryForm, t: Pick<Tournament, 'game' | 'mode'>): Partial<Record<EntryField, string>> {
  const e: Partial<Record<EntryField, string>> = {};
  const key = gameKeyOf(t.game);
  if (f.playerName.trim().length < 2) e.playerName = 'Indica o teu nome de jogador.';
  if (!validPlayerId(key, f.gameId)) e.gameId = key === 'ff' ? 'O ID Free Fire tem só números (6 a 12).' : key === 'cr' ? 'Tag inválida. Ex.: #2PYQ8L0' : 'Indica o teu ID no jogo.';
  if (isTeamMode(t.mode) && f.team.trim().length < 2) e.team = 'Indica o nome da equipa.';
  if (!validContact(f.contact)) e.contact = 'Número M-Pesa/e-Mola (84–87) ou email.';
  return e;
}

/** O passo do Discord deixa continuar? */
export function discordStepOk(rule: DiscordRule, username: string, joined: boolean): boolean {
  if (rule.missing) return false;
  if (!rule.invite) return true;
  if (!rule.required && !username.trim() && !joined) return true;
  return validDiscordUsername(username) && joined;
}

export type EntryStatus = 'pendente' | 'confirmada' | 'cancelada';
export interface Entry extends EntryForm {
  tournamentId: string; userId: string; handle?: string; discordUsername: string; discordJoined: boolean; discordVerified: boolean;
  status: EntryStatus; createdAt: string; teamLogo?: string;
}

export const REG_ERROR: Record<string, string> = {
  AUTH: 'Entra na tua conta para te inscreveres.', NOT_FOUND: 'Torneio não encontrado.', ALREADY: 'Já estás inscrito neste torneio.',
  CLOSED: 'As inscrições estão fechadas.', PAID: 'Pagamentos M-Pesa/e-Mola em breve – Nada foi cobrado.', FULL: 'Vagas esgotadas.',
  FORM: 'Verifica os teus dados.', DISCORD: 'Indica o teu username do Discord e confirma que entraste no grupo.',
  LOGO: 'Logótipo inválido. Envia outra imagem.',
  DISCORD_MISSING: 'O grupo do Discord deste torneio ainda não foi configurado. Tenta mais tarde.', FORBIDDEN: 'Sem permissão.',
};
