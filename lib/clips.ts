// Clipes dos utilizadores (modo real): publicar (Storage + tabela clips), visualizações, "Em alta", estatísticas e moderação.
import type { SupabaseClient } from '@supabase/supabase-js';
import { GRADIENTS, Clip, Idol, upsertClips, removeClip } from './data';
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { sb } from './supabase';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Limites do plano grátis. O bucket do Supabase (plano grátis) aceita no máximo 50 MB por ficheiro. */
export const LIMITS = { maxMB: 50, maxSec: 180, maxSecPro: 600, dailyDefault: 10 };
export const BUCKET = 'clips';
const CLIP_COLS_BASE = 'id,author_id,title,description,game,video_url,thumb_url,duration,visibility,status,featured,score,storage_path,likes_count,comments_count,shares_count,views_count,tags,created_at';
/** Com as colunas kind/image_url (fotos e momentos). Se a base de dados ainda não as tiver, passa para as colunas base. */
let hasKind = true;
export const CLIP_COLS = CLIP_COLS_BASE + ',kind,image_url';
const cols = () => (hasKind ? CLIP_COLS : CLIP_COLS_BASE) as '*';

const hash = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 0);
const EMO: Record<string, string> = { 'Free Fire': '🔥', eFootball: '⚽', 'PUBG Mobile': '🪂', 'Call of Duty Mobile': '💥', 'Mobile Legends': '⚔️', 'FIFA / FC Mobile': '⚽' };

export function rowToClip(r: Row): Clip {
  return {
    id: String(r.id), idolId: String(r.author_id), title: String(r.title ?? ''), game: String(r.game ?? ''), video: r.video_url ?? undefined,
    gradient: GRADIENTS[Math.abs(hash(String(r.id))) % GRADIENTS.length], emoji: EMO[r.game] ?? '🎮',
    likes: Number(r.likes_count ?? 0), comments: Number(r.comments_count ?? 0), shares: Number(r.shares_count ?? 0), views: Number(r.views_count ?? 0),
    tags: (r.tags as string[]) ?? [], thumb: r.thumb_url ?? undefined, description: r.description ?? undefined, duration: r.duration != null ? Number(r.duration) : undefined,
    visibility: r.visibility ?? 'public', status: r.status ?? 'published', createdAt: r.created_at ?? undefined, featured: !!r.featured, score: Number(r.score ?? 0),
    storagePath: r.storage_path ?? undefined, kind: (r.kind === 'photo' || r.kind === 'text') ? r.kind : 'video', image: r.image_url ?? undefined,
  };
}

export function rowToAuthor(r: Row): Idol {
  return {
    id: String(r.id), name: String(r.display_name || r.handle || 'Utilizador'), handle: '@' + (r.handle ?? 'utilizador'), game: String(r.main_game ?? ''),
    avatar: String(r.avatar_url || '🙂'), color: ['#b14dff', '#00e5ff', '#9dff3a', '#ff2bd6', '#ffc14d'][Math.abs(hash(String(r.id))) % 5],
    followers: Number(r.followers_count ?? 0), verified: !!r.verified, bio: String(r.bio ?? ''), division: (r.division ?? 'Bronze'), rank: 0, achievements: [],
  };
}

/** Perfis dos autores (leitura pública de perfis não banidos). */
export async function fetchAuthors(c: SupabaseClient, ids: string[]): Promise<Idol[]> {
  const uniq = Array.from(new Set(ids)).filter(Boolean);
  if (!uniq.length) return [];
  const { data } = await c.from('profiles').select('id,handle,display_name,avatar_url,bio,verified,followers_count,main_game,division').in('id', uniq.slice(0, 300));
  return (data ?? []).map(rowToAuthor);
}

/** Catálogo de clipes: recentes + "Em alta" + autores. Usado por lib/sync.ts. */
export async function loadClipCatalog(c: SupabaseClient) {
  const latestQ = () => c.from('clips').select(cols()).eq('status', 'published').eq('hidden', false).order('created_at', { ascending: false }).limit(100);
  let [latest, trend] = await Promise.all([
    latestQ(),
    c.rpc('trending_clips', { p_limit: 30 }),
  ]);
  if (latest.error && hasKind) { hasKind = false; latest = await latestQ(); }
  if (latest.error) {
    // Base de dados ainda sem a secção 12 (clips-upload.sql): usa as colunas antigas.
    const old = await c.from('clips').select('id,author_id,title,game,video_url,likes_count,comments_count,shares_count,views_count,tags,created_at').eq('hidden', false).order('created_at', { ascending: false }).limit(100);
    if (old.error) throw old.error;
    const authors = await fetchAuthors(c, (old.data ?? []).map((r) => String(r.author_id)));
    return { clips: (old.data ?? []).map(rowToClip), trending: [] as string[], authors };
  }
  const tr = (trend.data ?? []) as Row[];
  const map = new Map<string, Row>();
  for (const r of [...tr, ...(latest.data ?? [])]) map.set(String(r.id), r);
  const rows = Array.from(map.values()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const authors = await fetchAuthors(c, rows.map((r) => String(r.author_id)));
  return { clips: rows.map(rowToClip), trending: tr.map((r) => String(r.id)), authors };
}

/** Abre um clipe por id (link direto / clipe antigo). */
export async function fetchClip(id: string): Promise<Clip | null> {
  if (IS_DEMO) return null;
  const c = await sb();
  const { data } = await c.from('clips').select(cols()).eq('id', id).maybeSingle();
  if (!data) return null;
  const clip = rowToClip(data);
  upsertClips([clip], await fetchAuthors(c, [clip.idolId]));
  return clip;
}

export async function myClips(uid?: string): Promise<Clip[]> {
  if (IS_DEMO) return [];
  const c = await sb();
  const id = uid ?? (await c.auth.getSession()).data.session?.user.id;
  if (!id) return [];
  const { data } = await c.from('clips').select(cols()).eq('author_id', id).neq('status', 'processing').order('created_at', { ascending: false }).limit(200);
  return (data ?? []).map(rowToClip);
}

/** Clipes de um autor visíveis para mim (RLS aplica público / só seguidores). */
export async function authorClips(authorId: string): Promise<Clip[]> {
  if (IS_DEMO) return [];
  const c = await sb();
  const { data } = await c.from('clips').select(cols()).eq('author_id', authorId).eq('status', 'published').eq('hidden', false).order('created_at', { ascending: false }).limit(60);
  return (data ?? []).map(rowToClip);
}

// ---------- Visualizações ----------
function deviceId() {
  try { let d = localStorage.getItem('gh-device'); if (!d) { d = crypto.randomUUID(); localStorage.setItem('gh-device', d); } return d; } catch { return null; }
}
const isUuidish = (id: string) => id.length > 10;
/** Conta 1 visualização (servidor: 1 por utilizador por clipe a cada 24 h) e/ou atualiza o tempo visto. Devolve o total. */
export async function recordView(id: string, watchMs: number, completed: boolean): Promise<number | null> {
  if (IS_DEMO || !isUuidish(id)) return null;
  try {
    const c = await sb();
    const { data } = await c.rpc('clip_view', { p_id: id, p_watch_ms: Math.round(watchMs), p_completed: completed, p_device: deviceId() });
    return typeof data === 'number' ? data : data != null ? Number(data) : null;
  } catch { return null; }
}
export async function recordShare(id: string) {
  if (IS_DEMO || !isUuidish(id)) return;
  try { await (await sb()).rpc('clip_share', { p_id: id }); } catch {}
}

export interface ClipStats { views: number; likes: number; comments: number; shares: number; avg_watch_s: number; completion: number; duration: number | null; views_24h: number; views_7d: number; rank: number; featured: boolean; status: string }
export async function clipStats(id: string): Promise<ClipStats | null> {
  const c = await sb();
  const { data, error } = await c.rpc('clip_stats', { p_id: id });
  if (error) throw new Error(error.message);
  return data as ClipStats | null;
}

// ---------- Quota, diretrizes ----------
export async function quota(): Promise<{ limit: number; used: number; rules: boolean; active: boolean }> {
  const c = await sb();
  const { data, error } = await c.rpc('clip_quota');
  if (error) return { limit: LIMITS.dailyDefault, used: 0, rules: false, active: true };
  return data;
}
export async function acceptRules() { const c = await sb(); const { error } = await c.rpc('accept_clip_rules'); if (error) throw new Error(error.message); }

// ---------- Análise do ficheiro: duração + miniatura do 1.º fotograma ----------
export function probeVideo(file: File): Promise<{ duration: number | null; width: number; height: number; thumb: Blob | null; url: string }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;
    let done = false;
    const finish = (thumb: Blob | null) => { if (done) return; done = true; resolve({ duration: isFinite(v.duration) ? v.duration : null, width: v.videoWidth, height: v.videoHeight, thumb, url }); };
    const timer = setTimeout(() => finish(null), 8000);
    v.onerror = () => { clearTimeout(timer); finish(null); };
    v.onloadedmetadata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 4); } catch { clearTimeout(timer); finish(null); } };
    v.onseeked = () => {
      try {
        const w = v.videoWidth || 360, h = v.videoHeight || 640, scale = Math.min(1, 540 / Math.max(w, h));
        const cv = document.createElement('canvas'); cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
        cv.getContext('2d')!.drawImage(v, 0, 0, cv.width, cv.height);
        cv.toBlob((b) => { clearTimeout(timer); finish(b); }, 'image/jpeg', 0.8);
      } catch { clearTimeout(timer); finish(null); }
    };
  });
}

// ---------- Envio ----------
export interface Upload { promise: Promise<void>; cancel: () => void }
const extOf = (f: File) => (f.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';

/** Envio retomável (TUS, blocos de 6 MB) com recurso a envio normal (XHR) se o TUS falhar. */
function uploadFile(token: string, path: string, file: Blob, type: string, onProgress: (p: number) => void): Upload {
  let cancelFn = () => {};
  let cancelled = false;
  const promise = (async () => {
    try {
      const tus = await import('tus-js-client');
      await new Promise<void>((resolve, reject) => {
        const up = new tus.Upload(file, {
          endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
          retryDelays: [0, 2000, 5000, 10000],
          headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'x-upsert': 'true' },
          uploadDataDuringCreation: true, removeFingerprintOnSuccess: true, chunkSize: 6 * 1024 * 1024,
          metadata: { bucketName: BUCKET, objectName: path, contentType: type, cacheControl: '3600' },
          onError: (e) => reject(e), onProgress: (a, b) => onProgress(b ? a / b : 0), onSuccess: () => resolve(),
        });
        cancelFn = () => { cancelled = true; void up.abort(true).catch(() => {}); reject(new Error('cancelado')); };
        up.findPreviousUploads().then((prev) => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); }).catch(() => up.start());
      });
    } catch (e) {
      if (cancelled) throw new Error('cancelado');
      const msg = String((e as Error)?.message ?? e);
      if (/exceed|too large|413|maximum allowed size/i.test(msg)) throw new Error(`Ficheiro maior do que o permitido (${LIMITS.maxMB} MB).`);
      // Recurso: envio normal com progresso
      await new Promise<void>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
        x.setRequestHeader('authorization', `Bearer ${token}`); x.setRequestHeader('apikey', SUPABASE_ANON_KEY);
        x.setRequestHeader('x-upsert', 'true'); x.setRequestHeader('content-type', type); x.setRequestHeader('cache-control', '3600');
        x.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
        x.onload = () => (x.status < 300 ? resolve() : reject(new Error(x.status === 413 ? `Ficheiro maior do que o permitido (${LIMITS.maxMB} MB).` : `Falha no envio (${x.status}): ${x.responseText.slice(0, 160)}`)));
        x.onerror = () => reject(new Error('Sem ligação. Tenta outra vez.'));
        x.onabort = () => reject(new Error('cancelado'));
        cancelFn = () => { cancelled = true; x.abort(); };
        x.send(file);
      });
    }
  })();
  return { promise, cancel: () => cancelFn() };
}

export interface PublishInput { file: File; thumb: Blob | null; duration: number | null; title: string; description: string; game: string; tags: string[]; visibility: 'public' | 'followers' }

/**
 * Fluxo: 1) cria a linha 'processing' (o servidor valida banido/limite diário/diretrizes antes de gastar dados)
 * 2) envia miniatura + vídeo para Storage clips/<uid>/<id>.ext  3) marca 'published'. Cancelar/erro → apaga tudo.
 */
export function publishClip(inp: PublishInput, onProgress: (p: number, stage: string) => void): { promise: Promise<Clip>; cancel: () => void } {
  let current: Upload | null = null;
  let cancelled = false;
  const promise = (async () => {
    const c = await sb();
    const { data: ses } = await c.auth.getSession();
    const uid = ses.session?.user.id; const token = ses.session?.access_token;
    if (!uid || !token) throw new Error('Entra na tua conta para publicar.');
    onProgress(0, 'A preparar…');
    const { data: row, error } = await c.from('clips').insert({
      author_id: uid, title: inp.title.slice(0, 120), description: inp.description.slice(0, 1000) || null, game: inp.game, tags: inp.tags,
      visibility: inp.visibility, status: 'processing', duration: inp.duration ? Math.round(inp.duration * 100) / 100 : null, size_bytes: inp.file.size,
    }).select('id').single();
    if (error || !row) throw new Error(friendly(error?.message ?? 'Não foi possível criar o clipe.'));
    const id = String(row.id);
    const base = `${uid}/${id}`;
    const vpath = `${base}.${extOf(inp.file)}`;
    const tpath = `${base}.jpg`;
    const cleanup = async () => { await c.storage.from(BUCKET).remove([vpath, tpath]).catch(() => {}); await c.from('clips').delete().eq('id', id); };
    try {
      if (inp.thumb) {
        const t = uploadFile(token, tpath, inp.thumb, 'image/jpeg', () => {}); current = t; await t.promise;
      }
      if (cancelled) throw new Error('cancelado');
      const v = uploadFile(token, vpath, inp.file, inp.file.type || 'video/mp4', (p) => onProgress(p, 'A enviar vídeo…')); current = v; await v.promise;
      if (cancelled) throw new Error('cancelado');
      onProgress(1, 'A publicar…');
      const pub = (p: string) => c.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
      const { data: done, error: e2 } = await c.from('clips').update({ status: 'published', video_url: pub(vpath), thumb_url: inp.thumb ? pub(tpath) : null, storage_path: vpath })
        .eq('id', id).select(cols()).single();
      if (e2 || !done) throw new Error(friendly(e2?.message ?? 'Falha ao publicar.'));
      const clip = rowToClip(done);
      upsertClips([clip], await fetchAuthors(c, [uid]));
      return clip;
    } catch (e) {
      await cleanup();
      throw e;
    }
  })();
  return { promise, cancel: () => { cancelled = true; current?.cancel(); } };
}

/** Reduz a foto (máx. 1440 px, JPEG 85%) para poupar dados. Se falhar, envia o original. */
export function shrinkImage(file: File): Promise<{ blob: Blob; type: string; ext: string }> {
  return new Promise((resolve) => {
    const orig = { blob: file as Blob, type: file.type || 'image/jpeg', ext: extOf(file) === 'png' ? 'png' : extOf(file) === 'webp' ? 'webp' : 'jpg' };
    if (!/^image\/(jpeg|png|webp)/.test(file.type)) { resolve(orig); return; }
    const url = URL.createObjectURL(file); const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(orig); };
    img.onload = () => {
      try {
        const scale = Math.min(1, 1440 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob((b) => { URL.revokeObjectURL(url); resolve(b && b.size < file.size ? { blob: b, type: 'image/jpeg', ext: 'jpg' } : orig); }, 'image/jpeg', 0.85);
      } catch { URL.revokeObjectURL(url); resolve(orig); }
    };
    img.src = url;
  });
}

export interface PostInput { kind: 'photo' | 'text'; file?: File | null; title: string; description: string; game: string; tags: string[]; visibility: 'public' | 'followers' }

/** Foto ou texto/momento: linha na tabela clips (kind) + imagem no mesmo bucket 'clips'. */
export function publishPost(inp: PostInput, onProgress: (p: number, stage: string) => void): { promise: Promise<Clip>; cancel: () => void } {
  let current: Upload | null = null;
  let cancelled = false;
  const promise = (async () => {
    const c = await sb();
    const { data: ses } = await c.auth.getSession();
    const uid = ses.session?.user.id; const token = ses.session?.access_token;
    if (!uid || !token) throw new Error('Entra na tua conta para publicar.');
    if (inp.kind === 'photo' && !inp.file) throw new Error('Escolhe uma foto.');
    onProgress(0, 'A preparar…');
    const img = inp.kind === 'photo' && inp.file ? await shrinkImage(inp.file) : null;
    if (img && img.blob.size > LIMITS.maxMB * 1024 * 1024) throw new Error(`Foto maior do que ${LIMITS.maxMB} MB.`);
    const { data: row, error } = await c.from('clips').insert({
      author_id: uid, kind: inp.kind, title: inp.title.slice(0, 120), description: inp.description.slice(0, 1000) || null, game: inp.game || 'Geral', tags: inp.tags,
      visibility: inp.visibility, status: img ? 'processing' : 'published', size_bytes: img ? img.blob.size : 0,
    }).select('id').single();
    if (error || !row) throw new Error(friendly(error?.message ?? 'Não foi possível publicar.'));
    const id = String(row.id);
    const path = img ? `${uid}/${id}.${img.ext}` : '';
    try {
      let patch: Record<string, unknown> = {};
      if (img) {
        const u = uploadFile(token, path, img.blob, img.type, (p) => onProgress(p, 'A enviar foto…')); current = u; await u.promise;
        if (cancelled) throw new Error('cancelado');
        const url = c.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        patch = { status: 'published', image_url: url, thumb_url: url, storage_path: path };
      }
      onProgress(1, 'A publicar…');
      const q = img ? c.from('clips').update(patch).eq('id', id).select(cols()).single() : c.from('clips').select(cols()).eq('id', id).single();
      const { data: done, error: e2 } = await q;
      if (e2 || !done) throw new Error(friendly(e2?.message ?? 'Falha ao publicar.'));
      const clip = rowToClip(done);
      upsertClips([clip], await fetchAuthors(c, [uid]));
      return clip;
    } catch (e) {
      if (path) await c.storage.from(BUCKET).remove([path]).catch(() => {});
      await c.from('clips').delete().eq('id', id);
      throw e;
    }
  })();
  return { promise, cancel: () => { cancelled = true; current?.cancel(); } };
}

export async function deleteClip(clip: Clip) {
  const c = await sb();
  const paths = clip.storagePath ? [clip.storagePath, clip.storagePath.replace(/\.[a-z0-9]+$/, '.jpg')] : [];
  if (paths.length) await c.storage.from(BUCKET).remove(paths).catch(() => {});
  const { error } = await c.from('clips').delete().eq('id', clip.id);
  if (error) throw new Error(friendly(error.message));
  removeClip(clip.id);
}

export async function updateClip(id: string, patch: { title?: string; description?: string; visibility?: 'public' | 'followers' }) {
  const c = await sb();
  const { error } = await c.from('clips').update(patch).eq('id', id);
  if (error) throw new Error(friendly(error.message));
}

/** Admin/moderação: destacar (fixar no topo de "Em alta" e do feed). */
export async function setFeatured(id: string, on: boolean) {
  const c = await sb();
  const { error } = await c.from('clips').update({ featured: on }).eq('id', id);
  if (error) throw new Error(friendly(error.message));
}

export function friendly(m: string) {
  if (/row-level security|violates row-level/i.test(m)) return 'A tua conta não pode publicar agora (suspensa/banida ou sessão expirada).';
  if (/relation .*clips|column .* does not exist|function .* does not exist/i.test(m)) return 'Base de dados por atualizar: a administração tem de correr supabase/clips-upload.sql.';
  return m.replace(/^.*?ERROR:\s*/, '');
}

/** Ordenação "Em alta" local (para o feed): destacados, depois servidor, depois pontuação simples. */
export function hotScore(c: Clip) {
  const h = c.createdAt ? (Date.now() - new Date(c.createdAt).getTime()) / 3600000 : 72;
  return (Math.log(1 + c.views) + c.likes * 3 + c.comments * 5 + c.shares * 8) / Math.pow(h + 2, 1.4) + (c.featured ? 1000 : 0);
}
