// Organização dos clipes (estilo YouTube): tipos, filtros do feed e prateleiras do Início. Tudo no navegador, sobre o catálogo já carregado.
import { Clip, TRENDING } from './data';

export const GAMES = ['Free Fire', 'eFootball', 'PUBG Mobile', 'Call of Duty Mobile', 'Mobile Legends', 'FIFA / FC Mobile', 'Memes', 'Geral'];

export type ClipType = 'long' | 'video' | 'meme' | 'photo' | 'text';
const hasTag = (c: Clip, t: string) => (c.tags ?? []).some((x) => x.toLowerCase() === t);
/** Um clipe é meme quando tem a etiqueta #meme (os memes são publicados como foto). */
export const isMeme = (c: Clip) => hasTag(c, 'meme');
/** Vídeo longo (área "Vídeos", estilo YouTube): etiqueta #longo ou link do YouTube. Nunca entra no feed vertical. */
export const isLong = (c: Clip) => hasTag(c, 'longo') || !!youtubeId(c.video);
export function clipType(c: Clip): ClipType {
  if (isLong(c)) return 'long';
  if (isMeme(c)) return 'meme';
  const k = c.kind ?? 'video';
  return k === 'photo' ? 'photo' : k === 'text' ? 'text' : 'video';
}
export const TYPE_LABEL: Record<ClipType, string> = { long: 'Vídeos longos', video: 'Clipes', meme: 'Memes', photo: 'Fotos', text: 'Momentos' };
export const TYPE_ICON: Record<ClipType, string> = { long: '📺', video: '🎬', meme: '😂', photo: '📷', text: '💭' };

/** Pontuação "Em alta" local: destacados, ordem do servidor, depois interação recente. */
export function hot(c: Clip) {
  const h = c.createdAt ? (Date.now() - new Date(c.createdAt).getTime()) / 3600000 : 72;
  const k = TRENDING.indexOf(c.id);
  return (c.featured ? 1e6 : 0) + (k >= 0 ? 1e4 - k : 0) + (Math.log(1 + c.views) + c.likes * 3 + c.comments * 5 + c.shares * 8) / Math.pow(h + 2, 1.4);
}
export const byHot = (list: Clip[]) => [...list].sort((a, b) => hot(b) - hot(a));
export const byNew = (list: Clip[]) => [...list].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

export interface FeedFilter { key: string; label: string }
const BASE_FILTERS: FeedFilter[] = [
  { key: 'para-ti', label: 'Para ti' },
  { key: 'em-alta', label: '🔥 Em alta' },
  { key: 'videos', label: '🎬 Clipes' },
  { key: 'memes', label: '😂 Memes' },
  { key: 'fotos', label: '📷 Fotos' },
  { key: 'momentos', label: '💭 Momentos' },
  { key: 'seguir', label: 'A seguir' },
];
/** Filtros fixos + um por jogo (os do catálogo primeiro, depois os conhecidos). */
export function feedFilters(clips: Clip[]): FeedFilter[] {
  const present = Array.from(new Set(clips.map((c) => c.game).filter((g) => g && g !== 'Memes')));
  const games = [...present, ...GAMES.filter((g) => g !== 'Memes' && g !== 'Geral' && !present.includes(g))];
  return [...BASE_FILTERS, ...games.map((g) => ({ key: 'g:' + g, label: g }))];
}

export function applyFilter(clips: Clip[], key: string, following: string[]): Clip[] {
  switch (key) {
    case 'em-alta': return byHot(clips);
    case 'videos': return clips.filter((c) => clipType(c) === 'video');
    case 'memes': return clips.filter(isMeme);
    case 'fotos': return clips.filter((c) => clipType(c) === 'photo');
    case 'momentos': return clips.filter((c) => clipType(c) === 'text');
    case 'seguir': return clips.filter((c) => following.includes(c.idolId));
    default:
      if (key.startsWith('g:')) { const g = key.slice(2); return clips.filter((c) => c.game === g); }
      return clips;
  }
}

/** Endereço do feed já filtrado (ex.: "Ver tudo" das prateleiras). */
export const feedHref = (key: string) => `/clipes?f=${encodeURIComponent(key)}`;

// ---------- YouTube (vídeos longos por link: sem envio para o Storage) ----------
/** Extrai o ID de youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/. */
export function youtubeId(url?: string | null): string | null {
  if (!url) return null;
  const m = String(url).trim().match(/^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
export const ytEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&modestbranding=1`;
export const ytThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const ytWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
/** Página de um vídeo longo. */
export const videoHref = (id: string) => `/videos?v=${encodeURIComponent(id)}`;
export function fmtDuration(sec?: number | null) {
  if (!sec || !isFinite(sec)) return '';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
export function ago(iso?: string) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 3600) return `há ${Math.max(1, Math.round(d / 60))} min`;
  if (d < 86400) return `há ${Math.round(d / 3600)} h`;
  if (d < 86400 * 30) return `há ${Math.round(d / 86400)} dias`;
  return new Date(iso).toLocaleDateString('pt-PT');
}
