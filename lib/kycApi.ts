// KYC unificado — acesso aos dados.
// Modo real: RPCs do Supabase (migrations/2026-10-21-kyc-unificado.sql) + bucket PRIVADO "verificacoes" (links temporários).
// Modo demo: localStorage (nada sai do navegador).
import { IS_DEMO } from './config';
import { sb } from './supabase';
import {
  KycAction, KycDocType, KycPurpose, KycSide, KycStatus, canTransition, filePath, missingDocs, validReason, verifiedFor,
} from './kyc';

export interface KycFile { id: string; bucket: string; path: string; docType: KycDocType; side: KycSide; at: string }
export interface KycEvent { action: string; from: string | null; to: string | null; reason: string; at: string; actor?: string; requestId?: string }
export interface KycRequest {
  id: string; purpose: KycPurpose; docType: KycDocType; status: KycStatus; note: string; reason: string; source: string;
  submittedAt: string; updatedAt: string; reviewedAt: string | null; files: KycFile[]; events: KycEvent[];
}
export interface KycMe { verified: Record<KycPurpose, boolean>; level: number; requests: KycRequest[] }
export interface KycQueueItem {
  kind: 'kyc' | 'apostas'; id: string; userId: string; handle: string; name: string; purpose: KycPurpose; docType: string; docTypes: string[];
  status: KycStatus; source: string; reason: string; note: string; submittedAt: string; updatedAt: string; files: number;
}
export interface KycDetail {
  request: KycRequest & { userId: string; handle: string; name: string; reviewer: string | null };
  files: KycFile[]; history: { id: string; purpose: KycPurpose; status: KycStatus; reason: string; submittedAt: string; source: string }[];
  events: KycEvent[]; level: number; verified: { identidade: boolean; vendedor: boolean };
  betKyc: { status: string; idType: string; fullName: string; submittedAt: string } | null;
}
export interface KycFilters { status?: string; purpose?: string; docType?: string; from?: string; to?: string; q?: string }
export interface NewFile { file: File; docType: KycDocType; side: KycSide }
export type Res = { ok: true; id?: string } | { ok: false; code: string };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MAX_MB = 8;

/* ---------------- Ficheiros: imagens reduzidas no telemóvel (sem EXIF), PDF tal como está ---------------- */
async function prepare(file: File): Promise<Blob> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) { if (file.size > MAX_MB * 1024 * 1024) throw new Error('TOO_BIG'); return file.slice(0, file.size, 'application/pdf'); }
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) throw new Error('FORMAT');
  if (file.size > 20 * 1024 * 1024) throw new Error('TOO_BIG');
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const webp = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.85));
    if (webp && webp.type === 'image/webp') return webp;
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('FORMAT'))), 'image/jpeg', 0.85));
  } finally { bmp.close(); }
}
const extOf = (b: Blob) => (b.type === 'application/pdf' ? 'pdf' : b.type === 'image/webp' ? 'webp' : b.type === 'image/png' ? 'png' : 'jpg');
const toDataUrl = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b); });

/* ---------------- Demo ---------------- */
const DEMO_KEY = 'txap-kyc-demo-v1';
interface Demo { requests: (KycRequest & { userId: string; handle: string })[] }
function demo(): Demo { try { const d = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); if (d?.requests) return d; } catch {} return { requests: [] }; }
function withDemo<T>(fn: (d: Demo) => T): T { const d = demo(); const r = fn(d); try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch {} return r; }
const now = () => new Date().toISOString();

/* ---------------- Real ---------------- */
async function rpc(fn: string, args: Row = {}): Promise<Row> {
  const c = await sb(); const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(/does not exist|Could not find/i.test(error.message) ? 'NOT_INSTALLED' : error.code === '42501' || /permission denied|JWT/i.test(error.message) ? 'AUTH' : error.message);
  return data as Row;
}
const res = (d: Row): Res => (d?.ok ? { ok: true, id: d.id } : { ok: false, code: d?.code ?? 'ERRO' });
const mapFile = (f: Row): KycFile => ({ id: f.id, bucket: f.bucket ?? 'verificacoes', path: f.path, docType: f.doc_type, side: f.side ?? 'unico', at: f.at ?? f.created_at });
const mapEv = (e: Row): KycEvent => ({ action: e.action, from: e.from ?? null, to: e.to ?? null, reason: e.reason ?? '', at: e.at, actor: e.actor ?? undefined, requestId: e.request_id });
const mapReq = (r: Row): KycRequest => ({
  id: r.id, purpose: r.purpose, docType: r.doc_type, status: r.status, note: r.note ?? '', reason: r.reason ?? '', source: r.source ?? 'perfil',
  submittedAt: r.submitted_at, updatedAt: r.updated_at ?? r.submitted_at, reviewedAt: r.reviewed_at ?? null,
  files: (r.files ?? []).map(mapFile), events: (r.events ?? []).map(mapEv),
});

async function uploadAll(files: NewFile[]): Promise<{ path: string; doc_type: KycDocType; side: KycSide; data?: string }[]> {
  const blobs = await Promise.all(files.map((f) => prepare(f.file)));
  const stamp = Date.now().toString(36);
  if (IS_DEMO) return Promise.all(blobs.map(async (b, i) => ({ path: filePath('demo', files[i].docType, files[i].side, extOf(b), `${stamp}${i}`), doc_type: files[i].docType, side: files[i].side, data: await toDataUrl(b) })));
  const c = await sb(); const { data } = await c.auth.getSession(); const uid = data.session?.user.id; if (!uid) throw new Error('AUTH');
  const out: { path: string; doc_type: KycDocType; side: KycSide }[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const p = filePath(uid, files[i].docType, files[i].side, extOf(blobs[i]), `${stamp}${i}`);
    const { error } = await c.storage.from('verificacoes').upload(p, blobs[i], { contentType: blobs[i].type, upsert: false });
    if (error) throw new Error(error.message);
    out.push({ path: p, doc_type: files[i].docType, side: files[i].side });
  }
  return out;
}

export const kycApi = {
  async me(): Promise<KycMe | null> {
    if (IS_DEMO) {
      const rs = demo().requests;
      const approved = rs.filter((r) => r.status === 'aprovado').map((r) => r.purpose);
      const verified = Object.fromEntries((['identidade', 'vendedor', 'afiliado', 'levantamento', 'criador'] as KycPurpose[]).map((p) => [p, verifiedFor(p, approved)])) as Record<KycPurpose, boolean>;
      return { verified, level: approved.length ? 2 : 0, requests: rs };
    }
    try {
      const d = await rpc('kyc_me'); if (!d?.ok) return null;
      return { verified: d.verified, level: Number(d.kyc_level ?? 0), requests: (d.requests ?? []).map(mapReq) };
    } catch { return null; }
  },

  async submit(purpose: KycPurpose, files: NewFile[], note = ''): Promise<Res> {
    const miss = missingDocs(purpose, files.map((f) => f.docType));
    if (miss) return { ok: false, code: miss };
    try {
      const up = await uploadAll(files);
      if (IS_DEMO) return withDemo((d) => {
        if (d.requests.some((r) => r.purpose === purpose && ['pendente', 'em_analise', 'mais_documentos'].includes(r.status))) return { ok: false, code: 'OPEN' } as Res;
        const id = 'k' + Date.now().toString(36);
        d.requests.unshift({ id, userId: 'demo', handle: '@tu', purpose, docType: files[0].docType, status: 'pendente', note, reason: '', source: 'perfil', submittedAt: now(), updatedAt: now(), reviewedAt: null,
          files: up.map((u, i) => ({ id: id + i, bucket: 'demo', path: u.data!, docType: u.doc_type, side: u.side, at: now() })), events: [{ action: 'enviado', from: null, to: 'pendente', reason: '', at: now() }] });
        return { ok: true, id } as Res;
      });
      return res(await rpc('kyc_submit', { p_purpose: purpose, p_files: up, p_note: note }));
    } catch (e) { return { ok: false, code: (e as Error).message }; }
  },

  async addFiles(requestId: string, files: NewFile[], note = ''): Promise<Res> {
    if (!files.length) return { ok: false, code: 'FILES' };
    try {
      const up = await uploadAll(files);
      if (IS_DEMO) return withDemo((d) => {
        const r = d.requests.find((x) => x.id === requestId); if (!r) return { ok: false, code: 'NOT_FOUND' } as Res;
        if (!['mais_documentos', 'pendente'].includes(r.status)) return { ok: false, code: 'STATE' } as Res;
        r.files.push(...up.map((u, i) => ({ id: r.id + 'x' + i + Date.now(), bucket: 'demo', path: u.data!, docType: u.doc_type, side: u.side, at: now() })));
        r.events.push({ action: 'documentos_adicionados', from: r.status, to: 'pendente', reason: note, at: now() }); r.status = 'pendente'; r.updatedAt = now();
        return { ok: true } as Res;
      });
      return res(await rpc('kyc_add_files', { p_request: requestId, p_files: up, p_note: note }));
    } catch (e) { return { ok: false, code: (e as Error).message }; }
  },

  /** Link temporário (2 min) para ver um ficheiro. O Storage só o dá ao dono e aos revisores (RLS). */
  async signedUrl(f: Pick<KycFile, 'bucket' | 'path'>): Promise<string | null> {
    if (IS_DEMO || f.bucket === 'demo') return f.path || null;
    try { const c = await sb(); const { data } = await c.storage.from(f.bucket).createSignedUrl(f.path, 120); return data?.signedUrl ?? null; } catch { return null; }
  },

  /* ----- Revisores (admin ou KYC_REVIEW) ----- */
  async canReview(): Promise<boolean> {
    if (IS_DEMO) return true;
    try { const c = await sb(); const { data } = await c.rpc('kyc__can_review'); return data === true; } catch { return false; }
  },
  async queue(f: KycFilters = {}): Promise<{ items: KycQueueItem[]; counts: Record<string, number> } | { ok: false; code: string }> {
    if (IS_DEMO) {
      const rs = demo().requests.filter((r) => (!f.status || r.status === f.status) && (!f.purpose || r.purpose === f.purpose)
        && (!f.docType || r.files.some((x) => x.docType === f.docType)) && (!f.q || r.handle.includes(f.q.replace('@', ''))));
      const counts: Record<string, number> = {}; demo().requests.forEach((r) => { counts[r.status] = (counts[r.status] ?? 0) + 1; });
      return { counts, items: rs.map((r) => ({ kind: 'kyc', id: r.id, userId: r.userId, handle: r.handle, name: 'Tu (demo)', purpose: r.purpose, docType: r.docType, docTypes: r.files.map((x) => x.docType),
        status: r.status, source: r.source, reason: r.reason, note: r.note, submittedAt: r.submittedAt, updatedAt: r.updatedAt, files: r.files.length })) };
    }
    try {
      const d = await rpc('kyc_admin_list', { p_status: f.status || null, p_purpose: f.purpose || null, p_doc_type: f.docType || null,
        p_from: f.from ? new Date(f.from + 'T00:00:00').toISOString() : null, p_to: f.to ? new Date(new Date(f.to + 'T00:00:00').getTime() + 864e5).toISOString() : null,
        p_q: f.q?.trim() || null, p_limit: 200, p_offset: 0 });
      if (!d?.ok) return { ok: false, code: d?.code ?? 'ERRO' };
      return { counts: d.counts ?? {}, items: (d.items ?? []).map((x: Row) => ({ kind: x.kind, id: x.id, userId: x.user_id, handle: '@' + (x.handle ?? '?'), name: x.display_name ?? '', purpose: x.purpose,
        docType: x.doc_type, docTypes: x.doc_types ?? [], status: x.status, source: x.source, reason: x.reason ?? '', note: x.note ?? '', submittedAt: x.submitted_at, updatedAt: x.updated_at, files: Number(x.files ?? 0) })) };
    } catch (e) { return { ok: false, code: (e as Error).message }; }
  },
  async detail(id: string): Promise<KycDetail | { ok: false; code: string }> {
    if (IS_DEMO) {
      const r = demo().requests.find((x) => x.id === id); if (!r) return { ok: false, code: 'NOT_FOUND' };
      return { request: { ...r, name: 'Tu (demo)', reviewer: null }, files: r.files, history: demo().requests.map((h) => ({ id: h.id, purpose: h.purpose, status: h.status, reason: h.reason, submittedAt: h.submittedAt, source: h.source })),
        events: r.events, level: 0, verified: { identidade: false, vendedor: false }, betKyc: null };
    }
    try {
      const d = await rpc('kyc_admin_get', { p_request: id }); if (!d?.ok) return { ok: false, code: d?.code ?? 'ERRO' };
      const q = d.request as Row;
      return {
        request: { ...mapReq({ ...q, files: d.files }), userId: q.user_id, handle: '@' + (q.handle ?? '?'), name: q.display_name ?? '', reviewer: q.reviewer ? '@' + q.reviewer : null },
        files: (d.files ?? []).map(mapFile), events: (d.events ?? []).map(mapEv), level: Number(d.kyc_level ?? 0), verified: d.verified ?? { identidade: false, vendedor: false },
        history: (d.history ?? []).map((h: Row) => ({ id: h.id, purpose: h.purpose, status: h.status, reason: h.reason ?? '', submittedAt: h.submitted_at, source: h.source })),
        betKyc: d.bet_kyc ? { status: d.bet_kyc.status, idType: d.bet_kyc.id_type, fullName: d.bet_kyc.full_name, submittedAt: d.bet_kyc.submitted_at } : null,
      };
    } catch (e) { return { ok: false, code: (e as Error).message }; }
  },
  async review(id: string, action: KycAction, reason: string): Promise<Res> {
    if (!validReason(action, reason)) return { ok: false, code: 'REASON' };
    if (IS_DEMO) return withDemo((d) => {
      const r = d.requests.find((x) => x.id === id); if (!r) return { ok: false, code: 'NOT_FOUND' } as Res;
      if (!canTransition(r.status, action)) return { ok: false, code: 'STATE' } as Res;
      r.events.push({ action: 'decisao:' + action, from: r.status, to: action, reason, at: now(), actor: '@admin' });
      r.status = action; if (action !== 'em_analise') r.reason = reason.trim(); r.updatedAt = now(); if (action === 'aprovado' || action === 'recusado') r.reviewedAt = now();
      return { ok: true } as Res;
    });
    try { return res(await rpc('kyc_admin_review', { p_request: id, p_action: action, p_reason: reason })); } catch (e) { return { ok: false, code: (e as Error).message }; }
  },
  async staff(): Promise<{ userId: string; handle: string; grantedAt: string }[]> {
    if (IS_DEMO) return [];
    try { const d = await rpc('kyc_admin_staff'); return d?.ok ? (d.items ?? []).map((x: Row) => ({ userId: x.user_id, handle: '@' + x.handle, grantedAt: x.granted_at })) : []; } catch { return []; }
  },
  /** Dar/tirar KYC_REVIEW por @handle (só admin). */
  async grant(handle: string, grant: boolean): Promise<Res> {
    if (IS_DEMO) return { ok: true };
    try {
      const c = await sb(); const { data } = await c.from('profiles').select('id').ilike('handle', handle.replace(/^@/, '').trim()).maybeSingle();
      if (!data?.id) return { ok: false, code: 'NOT_FOUND' };
      return res(await rpc('kyc_admin_grant', { p_user: data.id, p_grant: grant }));
    } catch (e) { return { ok: false, code: (e as Error).message }; }
  },
};
