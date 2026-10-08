// Música legal para publicações: pesquisa no Openverse (catálogo aberto da WordPress Foundation),
// só faixas com licenças que permitem usar a música sincronizada com vídeo, inclusive comercialmente:
// CC0, Domínio Público e CC BY (exige atribuição, que guardamos com a publicação).
// Excluídas: NC (não comercial), ND (sincronizar com vídeo conta como obra derivada) e SA.
// Nunca usamos áudio do TikTok/Instagram/YouTube.
import { moderate } from './poipakAI';
import type { MusicRef } from './media';

export interface Track extends Omit<MusicRef, 'start' | 'vol'> { dur: number }

const API = 'https://api.openverse.org/v1/audio/';
const LICENSES = 'cc0,pdm,by';
const LABEL: Record<string, string> = { cc0: 'CC0', pdm: 'Domínio público', by: 'CC BY' };

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toTrack(r: Row): Track | null {
  const lic = String(r.license ?? '').toLowerCase();
  if (!['cc0', 'pdm', 'by'].includes(lic)) return null;
  if (r.mature) return null;
  const url = String(r.url ?? '');
  if (!/^https:\/\//.test(url)) return null;
  const title = String(r.title ?? '').replace(/\.(wav|mp3|ogg|flac|aiff?)$/i, '').trim().slice(0, 120);
  const artist = String(r.creator ?? '').trim().slice(0, 80) || 'Desconhecido';
  if (!title || moderate(`${title} ${artist}`).level !== 'ok') return null;
  const dur = Number(r.duration ?? 0) / 1000;
  if (dur && dur < 8) return null; // efeitos curtos não servem como música
  const license = `${LABEL[lic] ?? lic.toUpperCase()}${lic === 'by' && r.license_version ? ' ' + r.license_version : ''}`;
  return {
    id: String(r.id), url, title, artist, license, licenseUrl: r.license_url ?? undefined,
    attribution: String(r.attribution ?? `"${title}" de ${artist} (${license})`).slice(0, 400),
    source: String(r.source ?? r.provider ?? 'openverse'), landing: r.foreign_landing_url ?? undefined, dur: dur || 0,
  };
}

const cacheKey = (q: string, music: boolean, page: number) => `gh-music:${music ? 'm' : 'a'}:${page}:${q.toLowerCase()}`;

export class MusicError extends Error {}

async function query(q: string, music: boolean, page = 1, size = 20): Promise<Track[]> {
  const key = cacheKey(q, music, page);
  try { const hit = sessionStorage.getItem(key); if (hit) return JSON.parse(hit) as Track[]; } catch {}
  const p = new URLSearchParams({ q, license: LICENSES, page_size: String(size), page: String(page), mature: 'false' });
  if (music) p.set('category', 'music');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  let res: Response;
  try { res = await fetch(`${API}?${p}`, { signal: ctl.signal, headers: { Accept: 'application/json' } }); }
  catch { throw new MusicError('Sem ligação ao catálogo de música. Verifica a internet e tenta outra vez.'); }
  finally { clearTimeout(t); }
  if (res.status === 429) throw new MusicError('Muitas pesquisas seguidas. Espera um minuto e tenta outra vez.');
  if (!res.ok) throw new MusicError('O catálogo de música não respondeu. Tenta mais tarde.');
  const data = await res.json().catch(() => ({ results: [] }));
  const out = ((data.results ?? []) as Row[]).map(toTrack).filter(Boolean) as Track[];
  try { sessionStorage.setItem(key, JSON.stringify(out)); } catch {}
  return out;
}

/** Pesquisa livre ("Pesquisar música"). Primeiro só música; se vier pouco, inclui loops/sons. */
export async function searchMusic(q: string, page = 1): Promise<Track[]> {
  const term = q.trim().slice(0, 80);
  if (!term) return [];
  let list = await query(term, true, page);
  if (list.length < 6 && page === 1) {
    const more = await query(term, false, 1).catch(() => [] as Track[]);
    const ids = new Set(list.map((x) => x.id));
    list = list.concat(more.filter((x) => !ids.has(x.id)));
  }
  return list;
}

/** POIPAK IA: 5 sugestões a partir dos termos do humor do vídeo, preferindo faixas de 20 s a 5 min. */
export async function suggestMusic(queries: string[], videoSec?: number | null): Promise<Track[]> {
  const seen = new Set<string>();
  const pool: Track[] = [];
  for (const q of queries.slice(0, 3)) {
    try {
      const r = await query(q, true, 1, 12);
      for (const t of r) if (!seen.has(t.id)) { seen.add(t.id); pool.push(t); }
    } catch (e) { if (!pool.length && q === queries[queries.length - 1]) throw e; }
    if (pool.length >= 15) break;
  }
  const min = Math.max(15, Math.min(60, videoSec ?? 20));
  const good = (t: Track) => (t.dur >= min && t.dur <= 360 ? 2 : t.dur >= 15 ? 1 : 0);
  // Mistura os termos: intercala por ordem de chegada, mas puxa as faixas com boa duração para cima
  return pool.map((t, i) => ({ t, s: good(t) * 100 - i })).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.t);
}

export const SOURCE_NAME: Record<string, string> = { jamendo: 'Jamendo', freesound: 'Freesound', ccmixter: 'ccMixter', wikimedia_audio: 'Wikimedia' };
