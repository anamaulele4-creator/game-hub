// Afiliados e verificação de vendedores — acesso aos dados.
// Modo real: RPCs do Supabase (migrations/2026-10-20-moderador-afiliados.sql) + bucket PRIVADO "verificacoes".
// Modo demo: localStorage (nada sai do navegador).
import { BASE_PATH, IS_DEMO, SITE_URL } from './config';
import { sb } from './supabase';
import {
  AffDB, DEFAULT_COMMISSION_PCT, GainKind, VerificationStatus, affiliateLink, betGain, codeBase, creditCommission, normalizeCode, saleGain, validCode,
} from './affiliates';

export interface Invitee { handle: string; name: string; joined: string; earned: number }
export interface CommissionRow { id: string; kind: GainKind; gain: number; pct: number; amount: number; status: 'creditado' | 'anulado'; at: string; invitee: string }
export interface AffiliateView {
  eligible: boolean; code: string | null; link: string | null; pct: number; enabled: boolean;
  invitedCount: number; invitees: Invitee[]; commissions: CommissionRow[]; total: number; pending: number; referredBy: string | null;
}
export interface Verification { status: VerificationStatus; reason: string; submittedAt: string | null }
export interface VerificationItem { userId: string; handle: string; name: string; docPath: string; selfiePath: string; status: VerificationStatus; reason: string; submittedAt: string }
export interface AffOverview { pct: number; enabled: boolean; totalPaid: number; pendingVerifications: number; referrers: { handle: string; role: string; invited: number; earned: number }[]; recent: { kind: GainKind; gain: number; amount: number; status: string; at: string; referrer: string; invitee: string }[] }
export type Res = { ok: true } | { ok: false; code: string };

/** Base do link de convite: o domínio onde a app está aberta (GitHub Pages /game-hub ou Vercel na raiz). */
const siteBase = () => (typeof window !== 'undefined' ? window.location.origin + BASE_PATH : SITE_URL);
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PENDING_REF_KEY = 'txap-ref-pending';

/* ---------------- Demo ---------------- */
const DEMO_KEY = 'txap-aff-demo-v1';
interface Demo {
  pct: number; enabled: boolean; code: string; referredBy: string | null;
  verification: Verification & { doc?: string; selfie?: string };
  invitees: Invitee[]; commissions: CommissionRow[];
}
function seedDemo(): Demo {
  // Simulação com o MESMO motor das regras (lib/affiliates.ts): 3 convidados, ganhos e perdas.
  const db: AffDB = { users: [{ id: 'me', role: 'admin', referredBy: null }, ...['kiara', 'dercio', 'shaira'].map((id) => ({ id, role: 'utilizador' as const, referredBy: 'me' }))], commissions: [], wallet: {}, pct: DEFAULT_COMMISSION_PCT, enabled: true };
  const t0 = Date.UTC(2026, 9, 18, 9);
  creditCommission(db, 'kiara', 'aposta', 'b1:1', betGain({ status: 'ganha', stake: 150, payout: 300, currency: 'mt' }), t0);
  creditCommission(db, 'dercio', 'venda', 'o1', saleGain({ status: 'concluido', totalMzn: 800, feePct: null }), t0 + 3600e3);
  creditCommission(db, 'kiara', 'perda', 'b2:1', 200, t0 + 7200e3); // perda: não gera nada
  creditCommission(db, 'shaira', 'torneio', 'p1', 500, t0 + 86400e3);
  const handle: Record<string, string> = { kiara: '@kiara', dercio: '@dercio', shaira: '@shaira' };
  const commissions = db.commissions.map((c) => ({ id: c.id, kind: c.kind, gain: c.gain, pct: c.pct, amount: c.amount, status: c.status, at: c.at, invitee: handle[c.inviteeId] })).reverse();
  const invitees = ['kiara', 'dercio', 'shaira'].map((id, i) => ({ handle: handle[id], name: id[0].toUpperCase() + id.slice(1), joined: new Date(t0 - (3 - i) * 86400e3).toISOString(), earned: db.commissions.filter((c) => c.inviteeId === id).reduce((a, c) => a + c.amount, 0) }));
  return { pct: DEFAULT_COMMISSION_PCT, enabled: true, code: codeBase('@ana') + 'DEMO', referredBy: null, verification: { status: 'nenhuma', reason: '', submittedAt: null }, invitees, commissions };
}
function demo(): Demo { try { const d = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); if (d?.code) return d; } catch {} return seedDemo(); }
function withDemo<T>(fn: (d: Demo) => T): T { const d = demo(); const r = fn(d); try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch {} return r; }

/* ---------------- Real ---------------- */
async function rpc(fn: string, args: Row = {}): Promise<Row> {
  const c = await sb(); const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(/does not exist|Could not find/i.test(error.message) ? 'NOT_INSTALLED' : error.message);
  return data as Row;
}
const res = (d: Row): Res => (d?.ok ? { ok: true } : { ok: false, code: d?.code ?? 'ERRO' });
const safe = async (p: Promise<Res>): Promise<Res> => p.catch((e) => ({ ok: false as const, code: (e as Error).message }));

/** Reduz a foto no telemóvel (máx. 1600 px, WebP/JPEG) antes de enviar. Não guarda metadados EXIF (o canvas descarta-os). */
async function compress(file: File): Promise<Blob> {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) throw new Error('Formato não suportado. Usa JPG, PNG ou WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Foto acima de 15 MB.');
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const webp = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.82));
    if (webp && webp.type === 'image/webp') return webp;
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('IMG'))), 'image/jpeg', 0.82));
  } finally { bmp.close(); }
}
async function toDataUrl(b: Blob): Promise<string> { return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b); }); }

const mapView = (d: Row): AffiliateView => ({
  eligible: !!d.eligible, code: d.code ?? null, link: d.code ? affiliateLink(siteBase(), d.code) : null, pct: Number(d.pct ?? DEFAULT_COMMISSION_PCT), enabled: d.enabled !== false,
  invitedCount: Number(d.invited_count ?? 0), total: Number(d.total ?? 0), pending: Number(d.pending ?? 0), referredBy: d.referred_by ? '@' + d.referred_by : null,
  invitees: (d.invitees ?? []).map((x: Row) => ({ handle: '@' + x.handle, name: x.name ?? '', joined: x.joined, earned: Number(x.earned ?? 0) })),
  commissions: (d.commissions ?? []).map((x: Row) => ({ id: x.id, kind: x.kind, gain: x.gain, pct: Number(x.pct), amount: x.amount, status: x.status, at: x.at, invitee: '@' + x.invitee })),
});

export const affApi = {
  /** Painel de afiliado. `eligibleDemo` = papel atual na demo (a demo não tem servidor). */
  async me(eligibleDemo = true): Promise<AffiliateView | { ok: false; code: string }> {
    if (IS_DEMO) {
      const d = demo();
      const total = d.commissions.filter((c) => c.status === 'creditado').reduce((a, c) => a + c.amount, 0);
      return { eligible: eligibleDemo, code: eligibleDemo ? d.code : null, link: eligibleDemo ? affiliateLink(siteBase(), d.code) : null, pct: d.pct, enabled: d.enabled,
        invitedCount: d.invitees.length, invitees: d.invitees, commissions: d.commissions, total, pending: 24, referredBy: d.referredBy };
    }
    try { const d = await rpc('affiliate_me'); return d?.ok ? mapView(d) : { ok: false, code: d?.code ?? 'ERRO' }; }
    catch (e) { return { ok: false, code: (e as Error).message }; }
  },
  async applyCode(code: string): Promise<Res> {
    const c = normalizeCode(code);
    if (!validCode(c)) return { ok: false, code: 'INVALID' };
    if (IS_DEMO) return withDemo((d) => (d.referredBy ? { ok: false, code: 'ALREADY' } : c === d.code ? { ok: false, code: 'SELF' } : ((d.referredBy = '@influenciador'), { ok: true })));
    return safe(rpc('affiliate_apply_code', { p_code: c }).then(res));
  },
  /** Guarda o ?ref= até haver sessão (registo com Google/OTP não leva metadados). */
  rememberRef(code: string | null) { try { if (code && validCode(code)) localStorage.setItem(PENDING_REF_KEY, normalizeCode(code)); } catch {} },
  pendingRef(): string | null { try { return localStorage.getItem(PENDING_REF_KEY); } catch { return null; } },
  clearPendingRef() { try { localStorage.removeItem(PENDING_REF_KEY); } catch {} },

  /* ----- Verificação de vendedor ----- */
  async myVerification(): Promise<Verification> {
    if (IS_DEMO) { const v = demo().verification; return { status: v.status, reason: v.reason, submittedAt: v.submittedAt }; }
    try { const d = await rpc('seller_verification_me'); return { status: (d?.status ?? 'nenhuma') as VerificationStatus, reason: d?.reason ?? '', submittedAt: d?.submitted_at ?? null }; }
    catch { return { status: 'nenhuma', reason: '', submittedAt: null }; }
  },
  async submitVerification(doc: File, selfie: File): Promise<Res> {
    try {
      const [a, b] = await Promise.all([compress(doc), compress(selfie)]);
      if (IS_DEMO) { const [da, db] = await Promise.all([toDataUrl(a), toDataUrl(b)]); return withDemo((d) => { d.verification = { status: 'pendente', reason: '', submittedAt: new Date().toISOString(), doc: da, selfie: db }; return { ok: true } as Res; }); }
      const c = await sb(); const { data } = await c.auth.getSession(); const uid = data.session?.user.id; if (!uid) return { ok: false, code: 'AUTH' };
      const ext = (x: Blob) => (x.type === 'image/webp' ? 'webp' : 'jpg'); const t = Date.now().toString(36);
      const pDoc = `${uid}/doc-${t}.${ext(a)}`; const pSelfie = `${uid}/selfie-${t}.${ext(b)}`;
      for (const [p, blob] of [[pDoc, a], [pSelfie, b]] as const) {
        const { error } = await c.storage.from('verificacoes').upload(p, blob, { contentType: blob.type, upsert: false });
        if (error) return { ok: false, code: error.message };
      }
      return res(await rpc('seller_verification_submit', { p_doc: pDoc, p_selfie: pSelfie }));
    } catch (e) { return { ok: false, code: (e as Error).message }; }
  },

  /* ----- Admin ----- */
  async adminOverview(): Promise<AffOverview | null> {
    if (IS_DEMO) { const d = demo(); return { pct: d.pct, enabled: d.enabled, totalPaid: d.commissions.reduce((a, c) => a + (c.status === 'creditado' ? c.amount : 0), 0), pendingVerifications: d.verification.status === 'pendente' ? 1 : 0, referrers: [{ handle: 'ana', role: 'admin', invited: d.invitees.length, earned: d.commissions.reduce((a, c) => a + c.amount, 0) }], recent: d.commissions.map((c) => ({ kind: c.kind, gain: c.gain, amount: c.amount, status: c.status, at: c.at, referrer: 'ana', invitee: c.invitee.replace('@', '') })) }; }
    try {
      const d = await rpc('affiliate_admin_overview'); if (!d?.ok) return null;
      return { pct: Number(d.settings?.pct ?? DEFAULT_COMMISSION_PCT), enabled: d.settings?.enabled !== false, totalPaid: Number(d.total_paid ?? 0), pendingVerifications: Number(d.pending_verifications ?? 0), referrers: d.referrers ?? [], recent: d.recent ?? [] };
    } catch { return null; }
  },
  async adminSetSettings(pct: number, enabled: boolean): Promise<Res> {
    if (!(pct >= 0 && pct <= 50)) return { ok: false, code: 'PCT' };
    if (IS_DEMO) return withDemo((d) => { d.pct = pct; d.enabled = enabled; return { ok: true } as Res; });
    return safe(rpc('affiliate_admin_set_settings', { p_pct: pct, p_enabled: enabled }).then(res));
  },
  async adminVerifications(status: 'pendente' | 'aprovado' | 'rejeitado' | '' = 'pendente'): Promise<VerificationItem[]> {
    if (IS_DEMO) { const v = demo().verification; return v.status === 'nenhuma' || (status && v.status !== status) ? [] : [{ userId: 'demo', handle: '@ana', name: 'Tu (demo)', docPath: v.doc ?? '', selfiePath: v.selfie ?? '', status: v.status, reason: v.reason, submittedAt: v.submittedAt ?? '' }]; }
    try {
      const d = await rpc('seller_verification_admin_list', { p_status: status }); if (!d?.ok) return [];
      return (d.items ?? []).map((x: Row) => ({ userId: x.user_id, handle: '@' + x.handle, name: x.display_name ?? '', docPath: x.doc_path, selfiePath: x.selfie_path, status: x.status, reason: x.reason ?? '', submittedAt: x.submitted_at }));
    } catch { return []; }
  },
  /** URL temporário (5 min) para o admin ver a foto. Na demo o caminho já é a própria imagem. */
  async adminSignedUrl(path: string): Promise<string | null> {
    if (IS_DEMO) return path || null;
    const c = await sb(); const { data } = await c.storage.from('verificacoes').createSignedUrl(path, 300);
    return data?.signedUrl ?? null;
  },
  async adminReview(item: VerificationItem, approve: boolean, reason: string): Promise<Res> {
    if (!approve && reason.trim().length < 5) return { ok: false, code: 'REASON' };
    if (IS_DEMO) return withDemo((d) => { d.verification = { status: approve ? 'aprovado' : 'rejeitado', reason: approve ? '' : reason.trim(), submittedAt: d.verification.submittedAt, ...(approve ? { doc: d.verification.doc, selfie: d.verification.selfie } : {}) }; return { ok: true } as Res; });
    const r = await safe(rpc('seller_verification_review', { p_user: item.userId, p_approve: approve, p_reason: reason }).then(res));
    // Dados mínimos: documentos recusados são apagados logo (o vendedor envia novos se quiser tentar outra vez).
    if (r.ok && !approve) { try { const c = await sb(); await c.storage.from('verificacoes').remove([item.docPath, item.selfiePath]); } catch {} }
    return r;
  },
};
