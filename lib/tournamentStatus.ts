// Estado de apresentação dos torneios (sem dependências; testado em tests/jogos.test.mjs).
export type TournamentStatus = 'aberto' | 'a decorrer' | 'terminado';
export interface TournamentLike { status: TournamentStatus; date: string }

/** Dia de hoje em Maputo (AAAA-MM-DD). */
const maputoDay = (ms: number) => new Date(ms + 2 * 3600e3).toISOString().slice(0, 10);
/** Regra de apresentação (21/10/2026): um torneio cuja data já passou nunca aparece como "aberto".
 *  Começou hoje → "a decorrer"; começou num dia anterior → "terminado". Datas "AAAA-MM-DD HH:MM" lidas como hora de Maputo. */
export function effectiveTournamentStatus(t: TournamentLike, now = Date.now()): TournamentStatus {
  if (t.status !== 'aberto') return t.status;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(t.date || '');
  if (!m) return t.status;
  const start = Date.parse(`${m[1]}T${m[2] ?? '23'}:${m[3] ?? '59'}:00+02:00`);
  if (isNaN(start) || start > now) return t.status;
  return m[1] === maputoDay(now) ? 'a decorrer' : 'terminado';
}
export function withEffectiveStatus<T extends TournamentLike>(t: T, now = Date.now()): T {
  const st = effectiveTournamentStatus(t, now);
  return st === t.status ? t : { ...t, status: st };
}
