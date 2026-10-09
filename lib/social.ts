// Perfis públicos, contagens de seguidores e listas (Seguidores / A seguir).
// MODO REAL: lê profiles + follows do Supabase (follows tem leitura pública por RLS).
// MODO DEMO: usa os ídolos de demonstração.
import { GAMES, IS_DEMO } from './config';
export const isGame = (g: string) => (GAMES as readonly string[]).includes(g);
import { AUTHORS, IDOLS, Idol } from './data';

const sbMod = () => import('./supabase').then((m) => m.sb());
const COLS = 'id,handle,display_name,avatar_url,bio,verified,followers_count,following_count,main_game,division,team,role,interests';

export interface ProfileInfo extends Idol { role?: string; games: string[]; followingCount?: number }

function rowToProfile(r: Record<string, unknown>): ProfileInfo {
  const games = Array.from(new Set([String(r.main_game ?? ''), ...((r.interests as string[]) ?? []).filter(isGame)].filter(Boolean))).slice(0, 4);
  return {
    id: String(r.id), name: String(r.display_name || r.handle || 'Utilizador'), handle: '@' + (r.handle ?? 'utilizador'), game: String(r.main_game ?? ''),
    avatar: String(r.avatar_url || ''), color: '#FFC20E', followers: Number(r.followers_count ?? 0), followingCount: Number(r.following_count ?? 0),
    verified: !!r.verified, bio: String(r.bio ?? ''), division: (r.division as Idol['division']) ?? 'Bronze', rank: 0, achievements: [], team: (r.team as string) || undefined,
    role: String(r.role ?? 'user'), games,
  };
}

export function fromIdol(i: Idol): ProfileInfo {
  return { ...i, games: [i.game].filter(Boolean), role: 'creator' };
}

/** Perfil por id (ou @handle). Primeiro do catálogo carregado; senão do Supabase. */
export async function fetchProfile(idOrHandle: string): Promise<ProfileInfo | null> {
  const local = IDOLS.find((x) => x.id === idOrHandle) ?? AUTHORS.find((x) => x.id === idOrHandle);
  if (IS_DEMO) return local ? fromIdol(local) : null;
  try {
    const c = await sbMod();
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrHandle);
    const q = c.from('profiles').select(COLS);
    const { data } = isUuid ? await q.eq('id', idOrHandle).maybeSingle() : await q.ilike('handle', idOrHandle.replace(/^@/, '')).maybeSingle();
    if (data) return rowToProfile(data as Record<string, unknown>);
  } catch {}
  return local ? fromIdol(local) : null;
}

/** Contagens reais: seguidores e a seguir (conta linhas em follows). */
export async function followCounts(id: string): Promise<{ followers: number; following: number } | null> {
  if (IS_DEMO || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const c = await sbMod();
    const [a, b] = await Promise.all([
      c.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', id),
      c.from('follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', id),
    ]);
    return { followers: a.count ?? 0, following: b.count ?? 0 };
  } catch { return null; }
}

export interface Person { id: string; name: string; handle: string; avatar: string; verified: boolean }
const toPerson = (i: Idol): Person => ({ id: i.id, name: i.name, handle: i.handle, avatar: i.avatar, verified: i.verified });

/** Lista de seguidores ou de pessoas que um perfil segue. */
export async function followList(id: string, kind: 'seguidores' | 'a-seguir', demoFollowing: string[] = []): Promise<Person[]> {
  if (IS_DEMO) {
    if (kind === 'a-seguir') return IDOLS.filter((i) => demoFollowing.includes(i.id)).map(toPerson);
    return IDOLS.filter((i) => i.id !== id).slice(0, 4).map(toPerson);
  }
  try {
    const c = await sbMod();
    const col = kind === 'seguidores' ? 'follower_id' : 'followed_id';
    const { data } = await c.from('follows').select(col).eq(kind === 'seguidores' ? 'followed_id' : 'follower_id', id).order('created_at', { ascending: false }).limit(200);
    const ids = (data ?? []).map((r) => String((r as Record<string, unknown>)[col]));
    if (!ids.length) return [];
    const { data: profs } = await c.from('profiles').select('id,handle,display_name,avatar_url,verified').in('id', ids);
    return (profs ?? []).map((p) => ({ id: p.id, name: p.display_name || p.handle, handle: '@' + p.handle, avatar: p.avatar_url || '', verified: !!p.verified }));
  } catch { return []; }
}

/** Pessoas que EU sigo (para "Nova mensagem"). */
export async function peopleIFollow(following: string[]): Promise<Person[]> {
  if (IS_DEMO) return IDOLS.filter((i) => following.includes(i.id)).map(toPerson);
  if (!following.length) return [];
  try {
    const c = await sbMod();
    const { data } = await c.from('profiles').select('id,handle,display_name,avatar_url,verified').in('id', following.slice(0, 300));
    return (data ?? []).map((p) => ({ id: p.id, name: p.display_name || p.handle, handle: '@' + p.handle, avatar: p.avatar_url || '', verified: !!p.verified }));
  } catch { return []; }
}

// ---- Bio + link ----
// O link do perfil fica guardado na última linha da bio ("https://…"): não precisa de coluna nova.
const LINK_RE = /\n?\s*(\S+)\s*$/;
export function splitBio(bio: string): { text: string; link: string } {
  const m = (bio || '').match(LINK_RE);
  return m ? { text: bio.replace(LINK_RE, '').trim(), link: m[1] } : { text: (bio || '').trim(), link: '' };
}
export function joinBio(text: string, link: string): string {
  const l = link.trim();
  return (text.trim() + (l ? `\n ${l}` : '')).slice(0, 300);
}
export function normalizeLink(l: string) {
  const t = l.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
}

/** Muda o @username (precisa da migração supabase/migrations/2026-10-08-profile-handle.sql). */
export async function setHandle(handle: string): Promise<{ ok: boolean; error?: string }> {
  const h = handle.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_.]{3,30}$/.test(h)) return { ok: false, error: 'Usa 3 a 30 letras minúsculas, números, _ ou .' };
  if (IS_DEMO) return { ok: true };
  try {
    const c = await sbMod();
    const { error } = await c.rpc('set_my_handle', { p_handle: h });
    if (error) {
      if (/function|does not exist|schema cache/i.test(error.message)) return { ok: false, error: 'Mudar o @username ainda não está disponível. Volta a tentar em breve.' };
      return { ok: false, error: /exist|uso|taken|unique/i.test(error.message) ? 'Esse @username já está a ser usado.' : error.message };
    }
    return { ok: true };
  } catch { return { ok: false, error: 'Sem ligação. Tenta de novo.' }; }
}

/** Guarda o jogo principal (as outras alterações vão pelo espelho do perfil em lib/sync.ts). */
export async function setMainGame(game: string) {
  if (IS_DEMO) return;
  try {
    const c = await sbMod();
    const { data } = await c.auth.getUser();
    if (data.user) await c.from('profiles').update({ main_game: game || null }).eq('id', data.user.id);
  } catch {}
}
