// Lives (modo real): criar, terminar e abrir lives guardadas em public.lives.
// A transmissão em si é feita na app do YouTube / TikTok / Facebook / Twitch; o TXAPILOG mostra-a aos seguidores.
import { GRADIENTS, Live, upsertClips, upsertLive } from './data';
import { IS_DEMO } from './config';
import { youtubeId } from './feed';

export type Platform = 'poipak' | 'youtube' | 'tiktok' | 'facebook' | 'twitch';
export const PLATFORM_NAME: Record<Platform, string> = { poipak: 'Câmara TXAPILOG', youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook', twitch: 'Twitch' };
export const PLATFORM_ICON: Record<Platform, string> = { poipak: '📷', youtube: '▶️', tiktok: '🎵', facebook: '📘', twitch: '🟣' };
/** Domínio onde o site está publicado (o leitor da Twitch exige o parâmetro parent). */
const TWITCH_PARENTS = ['anamaulele4-creator.github.io'];

export interface StreamInfo { platform: Platform; url: string; embed?: string; room?: string }

/** Reconhece e valida o link da transmissão. Devolve null se não for um link aceite. */
export function parseStream(raw?: string | null): StreamInfo | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const pk = v.match(/^poipak:\/\/([A-Za-z0-9_-]{6,80})$/);
  if (pk) return { platform: 'poipak', url: v, room: pk[1] };
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|web\.|mobile\.)/, '');
  const path = u.pathname.replace(/\/+$/, '');
  const url = 'https://' + u.host + u.pathname + u.search;
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const id = youtubeId(url);
    if (id) return { platform: 'youtube', url, embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&modestbranding=1&autoplay=1&mute=1` };
    const ch = path.match(/^\/channel\/(UC[\w-]{20,})(\/live)?$/);
    if (ch) return { platform: 'youtube', url, embed: `https://www.youtube-nocookie.com/embed/live_stream?channel=${ch[1]}&autoplay=1&mute=1` };
    if (/^\/(@[\w.-]+|c\/[\w.-]+|user\/[\w.-]+)(\/live|\/streams)?$/.test(path)) return { platform: 'youtube', url };
    return null;
  }
  if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    return /^\/(@[\w.-]+(\/live|\/video\/\d+)?|[\w-]+)$/.test(path) || host !== 'tiktok.com' ? { platform: 'tiktok', url } : null;
  }
  if (host === 'facebook.com' || host === 'fb.watch' || host === 'fb.gg' || host === 'fb.com') {
    return path.length > 1 ? { platform: 'facebook', url, embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true&mute=true&allowfullscreen=true` } : null;
  }
  if (host === 'twitch.tv' || host === 'player.twitch.tv') {
    const parents = TWITCH_PARENTS.map((p) => `&parent=${p}`).join('');
    const vid = path.match(/^\/videos\/(\d+)$/);
    if (vid) return { platform: 'twitch', url, embed: `https://player.twitch.tv/?video=${vid[1]}${parents}&muted=true` };
    const chn = path.match(/^\/([A-Za-z0-9_]{3,25})$/);
    if (chn && !['directory', 'videos', 'settings', 'search'].includes(chn[1].toLowerCase())) return { platform: 'twitch', url, embed: `https://player.twitch.tv/?channel=${chn[1]}${parents}&muted=true` };
    return null;
  }
  return null;
}

/** O leitor da Twitch só funciona no domínio registado em parent. */
export function canEmbed(s: StreamInfo) {
  if (!s.embed || s.platform === 'poipak') return false;
  if (s.platform !== 'twitch') return true;
  return typeof window !== 'undefined' && TWITCH_PARENTS.includes(window.location.hostname);
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hash = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 0);
export function rowToLive(r: Row): Live {
  const live = r.status === 'ao vivo';
  return {
    id: String(r.id), idolId: String(r.host_id ?? ''), title: String(r.title ?? ''), game: String(r.game ?? ''), viewers: Number(r.viewers ?? 0),
    gradient: GRADIENTS[Math.abs(hash(String(r.id))) % GRADIENTS.length],
    startedMin: live && r.started_at ? Math.max(0, Math.round((Date.now() - new Date(r.started_at).getTime()) / 60000)) : 0,
    streamUrl: r.stream_url ?? undefined, status: r.status ?? 'agendada', startsAt: r.started_at ?? r.created_at ?? undefined,
  };
}

const COLS = 'id,host_id,title,game,viewers,started_at,ended_at,status,stream_url,created_at';

async function client() {
  const m = await import('./supabase');
  return m.sb();
}

/** Abre uma live pelo ID (e o perfil do anfitrião). Nunca lança erro: devolve null. */
export async function fetchLive(id: string): Promise<Live | null> {
  if (IS_DEMO || !id) return null;
  try {
    const c = await client();
    const { data } = await c.from('lives').select(COLS).eq('id', id).maybeSingle();
    if (!data) return null;
    const l = rowToLive(data);
    if (l.idolId) {
      const m = await import('./clips');
      const authors = await m.fetchAuthors(c, [l.idolId]).catch(() => []);
      if (authors.length) upsertClips([], authors);
    }
    if (l.status === 'ao vivo' || l.status === 'agendada') upsertLive(l);
    return l;
  } catch {
    return null;
  }
}

export async function myUid(): Promise<string | null> {
  if (IS_DEMO) return null;
  try { const c = await client(); return (await c.auth.getSession()).data.session?.user.id ?? null; } catch { return null; }
}

export interface NewLive { title: string; game: string; streamUrl: string; when: 'now' | 'later'; at?: string; poipak?: boolean }

/** Cria a live (RLS: host_id = auth.uid()). Devolve o ID ou uma mensagem de erro em português. */
export async function createLive(n: NewLive): Promise<{ id?: string; error?: string }> {
  try {
    const c = await client();
    const uid = (await c.auth.getSession()).data.session?.user.id;
    if (!uid) return { error: 'Entra na tua conta para criar uma live.' };
    let streamUrl = n.streamUrl;
    if (n.poipak) { const m = await import('./livekit'); streamUrl = 'poipak://' + m.newRoomName(); }
    const s = parseStream(streamUrl);
    if (!s) return { error: 'Link da transmissão inválido.' };
    const row = {
      host_id: uid, title: n.title.trim().slice(0, 120), game: n.game, stream_url: s.url,
      status: n.when === 'now' ? 'ao vivo' : 'agendada',
      started_at: n.when === 'now' ? new Date().toISOString() : n.at ? new Date(n.at).toISOString() : null,
    };
    const { data, error } = await c.from('lives').insert(row).select('id').single();
    if (error || !data) return { error: 'Não foi possível criar a live agora. Verifica a ligação e tenta outra vez.' + (error?.message ? ` (${error.message})` : '') };
    return { id: String(data.id) };
  } catch (e) {
    return { error: 'Não foi possível criar a live agora. ' + ((e as Error)?.message ?? '') };
  }
}

/** Muda o estado da live (anfitrião): começar agora ou terminar. */
export async function setLiveStatus(id: string, status: 'ao vivo' | 'terminada'): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = await client();
    const now = new Date().toISOString();
    const patch = status === 'terminada' ? { status, ended_at: now } : { status, started_at: now };
    const { error } = await c.from('lives').update(patch).eq('id', id);
    if (error) return { ok: false, error: 'Não foi possível atualizar a live. ' + error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Não foi possível atualizar a live. ' + ((e as Error)?.message ?? '') };
  }
}

/** Data/hora curta em português (ex.: "Hoje 21:00", "Amanhã 19:30", "sáb., 12/10 15:00"). */
export function whenLabel(iso?: string) {
  if (!iso) return 'Em breve';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Em breve';
  const hm = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); const tm = new Date(); tm.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `Hoje ${hm}`;
  if (d.toDateString() === tm.toDateString()) return `Amanhã ${hm}`;
  return `${d.toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${hm}`;
}
