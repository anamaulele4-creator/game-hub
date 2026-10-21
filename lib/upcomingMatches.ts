// Próximos jogos agendados (só leitura, sem odds nem saldos) — para "Jogos em destaque" no Início.
// Lê bet_matches/bet_teams diretamente, sem carregar o módulo de apostas. Em modo demo devolve lista vazia.
import { IS_DEMO } from './config';
import { sb } from './supabase';
import type { GameKey } from './jogos';

export interface UpcomingMatch { id: string; game: GameKey; home: string; away: string; homeTeamId: string; awayTeamId: string; startsAt: string; tournamentName: string }
export interface UpcomingView { matches: UpcomingMatch[]; logos: Record<string, string> }

export async function upcomingMatches(limit = 8): Promise<UpcomingView> {
  if (IS_DEMO) return { matches: [], logos: {} };
  const c = await sb();
  const { data, error } = await c.from('bet_matches').select('id,game_key,home,away,home_team_id,away_team_id,starts_at,tournament_name,status')
    .eq('status', 'agendado').gt('starts_at', new Date().toISOString()).order('starts_at').limit(limit);
  if (error) throw new Error(error.message);
  const matches: UpcomingMatch[] = (data ?? []).map((r) => ({
    id: String(r.id), game: r.game_key as GameKey, home: String(r.home), away: String(r.away), homeTeamId: String(r.home_team_id ?? ''), awayTeamId: String(r.away_team_id ?? ''),
    startsAt: String(r.starts_at), tournamentName: String(r.tournament_name ?? ''),
  }));
  const ids = Array.from(new Set(matches.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter(Boolean)));
  const logos: Record<string, string> = {};
  if (ids.length) {
    const { data: tr } = await c.from('bet_teams').select('id,logo_url').in('id', ids);
    for (const t of tr ?? []) if (t.logo_url) logos[String(t.id)] = String(t.logo_url);
  }
  return { matches, logos };
}
