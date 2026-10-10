// Inscrições em torneios. Modo real: funções tournament_register / tournament_unregister / tournament_entry_admin.
// Modo demo: guardadas neste navegador.
import { IS_DEMO } from './config';
import { sb } from './supabase';
import type { Entry, EntryForm, EntryStatus } from './registration';

const DEMO_KEY = 'txap-entries-v1';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type RegResult = { ok: true } | { ok: false; code: string };

const demo = (): Entry[] => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch { return []; } };
const saveDemo = (e: Entry[]) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(e)); } catch {} };
const mapEntry = (r: Row): Entry => ({
  tournamentId: r.tournament_id, userId: r.user_id, handle: r.profiles?.handle ? '@' + r.profiles.handle : undefined,
  playerName: r.player_name ?? '', gameId: r.game_id ?? '', team: r.team ?? '', contact: r.contact ?? '', discordUsername: r.discord_username ?? '',
  discordJoined: !!r.discord_joined, discordVerified: !!r.discord_verified, teamLogo: r.team_logo_url ?? '', status: (r.status ?? 'confirmada') as EntryStatus, createdAt: r.created_at,
});

export const entriesApi = {
  async register(tournamentId: string, f: EntryForm, discord: { username: string; joined: boolean }, teamLogo = ''): Promise<RegResult> {
    if (IS_DEMO) {
      const all = demo();
      if (all.some((e) => e.tournamentId === tournamentId)) return { ok: false, code: 'ALREADY' };
      all.unshift({ ...f, tournamentId, userId: 'demo', handle: '@ana', discordUsername: discord.username.trim(), discordJoined: discord.joined, discordVerified: false, status: 'confirmada', createdAt: new Date().toISOString(), teamLogo });
      saveDemo(all);
      return { ok: true };
    }
    const c = await sb();
    const { data, error } = await c.rpc('tournament_register', {
      p_tournament: tournamentId, p_player_name: f.playerName, p_game_id: f.gameId, p_team: f.team, p_contact: f.contact,
      p_discord_username: discord.username.trim() || null, p_discord_joined: discord.joined, p_team_logo: teamLogo || null,
    });
    if (error) return { ok: false, code: error.message };
    return data?.ok ? { ok: true } : { ok: false, code: data?.code ?? 'ERRO' };
  },
  async unregister(tournamentId: string): Promise<RegResult> {
    if (IS_DEMO) { saveDemo(demo().filter((e) => e.tournamentId !== tournamentId)); return { ok: true }; }
    const c = await sb();
    const { data, error } = await c.rpc('tournament_unregister', { p_tournament: tournamentId });
    if (error) return { ok: false, code: error.message };
    return data?.ok ? { ok: true } : { ok: false, code: data?.code ?? 'ERRO' };
  },
  async mine(): Promise<Entry[]> {
    if (IS_DEMO) return demo();
    const c = await sb();
    const { data: s } = await c.auth.getSession();
    if (!s.session) return [];
    const { data } = await c.from('tournament_entries').select('*').eq('user_id', s.session.user.id).order('created_at', { ascending: false });
    return (data ?? []).map(mapEntry);
  },
  async forTournament(tournamentId: string): Promise<Entry[]> {
    if (IS_DEMO) return demo().filter((e) => e.tournamentId === tournamentId);
    const c = await sb();
    const { data, error } = await c.from('tournament_entries').select('*, profiles(handle)').eq('tournament_id', tournamentId).order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapEntry);
  },
  async adminAction(userId: string, tournamentId: string, action: 'discord_ok' | 'discord_nao' | 'confirmar' | 'pendente' | 'cancelar'): Promise<RegResult> {
    if (IS_DEMO) {
      const all = demo(); const e = all.find((x) => x.tournamentId === tournamentId && x.userId === userId);
      if (!e) return { ok: false, code: 'NOT_FOUND' };
      if (action === 'discord_ok' || action === 'discord_nao') e.discordVerified = action === 'discord_ok';
      else e.status = action === 'confirmar' ? 'confirmada' : action === 'pendente' ? 'pendente' : 'cancelada';
      saveDemo(all); return { ok: true };
    }
    const c = await sb();
    const { data, error } = await c.rpc('tournament_entry_admin', { p_user: userId, p_tournament: tournamentId, p_action: action });
    if (error) return { ok: false, code: error.message };
    return data?.ok ? { ok: true } : { ok: false, code: data?.code ?? 'ERRO' };
  },
};
