// Marketplace 3.0 — acesso ao servidor. Tudo o que escreve passa por funções SECURITY DEFINER no Supabase
// (permissões, preços, estados e dinheiro validados lá). Sem base de dados (modo demo) ou sem o SQL instalado,
// as funções devolvem { ok:false, code:'DEMO' | 'NOT_INSTALLED' } e os ecrãs mostram isso em vez de simular.
import { useEffect, useState } from 'react';
import { IS_DEMO } from './config';
import { sb } from './supabase';
import type { Perm } from './mkt3';
import { AppSettingKey, setAppSetting } from './appSettings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = Record<string, any>;
export type R<T = J> = ({ ok: true } & T) | { ok: false; code: string; [k: string]: unknown };

const missing = (m: string) => /does not exist|could not find|schema cache|PGRST20[0-9]|42P01|42883/i.test(m);

export async function call<T = J>(fn: string, args: J = {}): Promise<R<T>> {
  if (IS_DEMO) return { ok: false, code: 'DEMO' };
  try {
    const c = await sb();
    const { data, error } = await c.rpc(fn, args);
    if (error) return { ok: false, code: missing(error.message) ? 'NOT_INSTALLED' : error.message };
    if (data && typeof data === 'object' && 'ok' in data) return data as R<T>;
    return { ok: true, data } as unknown as R<T>;
  } catch (e) { return { ok: false, code: (e as Error).message || 'NETWORK' }; }
}

export const newIdem = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

/* ---------------- Estado do Marketplace 3.0 para este utilizador (cache partilhada) ---------------- */
export interface Mkt3Me {
  installed: boolean; open: boolean; enabled: boolean; checkoutEnabled: boolean; payoutsEnabled: boolean; userId: string | null;
  role: string | null; isAdmin: boolean; isStaff: boolean; sellerVerified: boolean; perms: Perm[];
}
const NONE: Mkt3Me = { installed: false, open: false, enabled: false, checkoutEnabled: false, payoutsEnabled: false, userId: null, role: null, isAdmin: false, isStaff: false, sellerVerified: false, perms: [] };
let meCache: { at: number; p: Promise<Mkt3Me> } | null = null;
export function loadMe(force = false): Promise<Mkt3Me> {
  if (!force && meCache && Date.now() - meCache.at < 60_000) return meCache.p;
  const p = call('mkt_me').then((r): Mkt3Me => (r.ok ? {
    installed: true, open: !!r.open, enabled: !!r.enabled, checkoutEnabled: !!r.checkout_enabled, payoutsEnabled: !!r.payouts_enabled, userId: r.user_id ?? null,
    role: r.role ?? null, isAdmin: !!r.is_admin, isStaff: !!r.is_staff, sellerVerified: !!r.seller_verified, perms: (r.perms ?? []) as Perm[],
  } : NONE));
  meCache = { at: Date.now(), p };
  return p;
}
export function useMkt3(): Mkt3Me & { loading: boolean; can: (p: Perm) => boolean; reload: () => void } {
  const [me, setMe] = useState<Mkt3Me | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; loadMe(n > 0).then((m) => { if (live) setMe(m); }); return () => { live = false; }; }, [n]);
  const m = me ?? NONE;
  return { ...m, loading: me === null, can: (p: Perm) => m.isAdmin || m.perms.includes(p), reload: () => setN((x) => x + 1) };
}

/* ---------------- Chamadas ---------------- */
export const mkt3 = {
  // Lojas e produtos
  storeSave: (p: J) => call('mkt_store_save', { p }),
  storeOwnerAction: (action: 'submeter' | 'encerrar') => call('mkt_store_owner_action', { p_action: action }),
  storePublic: (slug: string) => call('mkt_store_public', { p_slug: slug }),
  variantSave: (product: string, id: string | null, name: string, price: number, stock: number, active = true) =>
    call('mkt_variant_save', { p_product: product, p_id: id, p_name: name, p_price: price, p_stock: stock, p_active: active }),
  duplicate: (id: string) => call('mkt_product_duplicate', { p_id: id }),
  view: (id: string) => call('mkt_product_view', { p_id: id }),
  search: (a: { q?: string; type?: string; category?: string | null; kind?: string | null; sort?: string; min?: number | null; max?: number | null; page?: number; size?: number }) =>
    call('mkt_search', { p_q: a.q ?? '', p_type: a.type ?? 'produtos', p_category: a.category ?? null, p_kind: a.kind ?? null, p_sort: a.sort ?? 'recentes', p_min: a.min ?? null, p_max: a.max ?? null, p_page: a.page ?? 1, p_size: a.size ?? 24 }),
  suggest: (q: string) => call('mkt_suggest', { p_q: q }),
  related: async (id: string): Promise<J[]> => { const r = await call('mkt_related', { p_id: id, p_limit: 8 }); return r.ok && Array.isArray((r as J).data) ? (r as J).data : []; },
  async variants(product: string): Promise<J[]> {
    if (IS_DEMO) return [];
    try { const c = await sb(); const { data } = await c.from('mkt_product_variants').select('*').eq('product_id', product).order('position'); return data ?? []; } catch { return []; }
  },
  async myProducts(): Promise<J[]> {
    if (IS_DEMO) return [];
    try {
      const c = await sb(); const { data: s } = await c.auth.getSession(); const uid = s.session?.user.id; if (!uid) return [];
      const { data } = await c.from('market_products').select('*').eq('seller_id', uid).order('created_at', { ascending: false }).limit(300); return data ?? [];
    } catch { return []; }
  },
  async productUpdate(id: string, patch: J): Promise<R> {
    if (IS_DEMO) return { ok: false, code: 'DEMO' };
    try { const c = await sb(); const { error } = await c.from('market_products').update(patch).eq('id', id); return error ? { ok: false, code: error.message } : { ok: true }; }
    catch (e) { return { ok: false, code: (e as Error).message }; }
  },
  async product(id: string): Promise<J | null> {
    if (IS_DEMO || !id) return null;
    try { const c = await sb(); const { data } = await c.from('market_products').select('*').eq('id', id).maybeSingle(); return data; } catch { return null; }
  },
  coupons: async (): Promise<J[]> => { if (IS_DEMO) return []; try { const c = await sb(); const { data } = await c.from('mkt_coupons').select('*').order('created_at', { ascending: false }); return data ?? []; } catch { return []; } },
  couponSave: (code: string, pct: number, max: number, until: string | null, active: boolean) => call('mkt_coupon_save', { p_code: code, p_pct: pct, p_max: max, p_valid_until: until, p_active: active }),
  // Carrinho, checkout, pagamento
  cartSet: (product: string, variant: string | null, qty: number) => call('mkt_cart_set', { p_product: product, p_variant: variant, p_qty: qty }),
  cartView: (coupons: string[] = []) => call('mkt_cart_view', { p_coupons: coupons }),
  checkout: (idem: string, delivery: J, coupons: string[], note: string) => call('mkt_checkout', { p_idem: idem, p_delivery: delivery, p_coupons: coupons, p_note: note }),
  pay: (payment: string, idem: string) => call('mkt_pay', { p_payment: payment, p_idem: idem }),
  // Pedidos
  orderGet: (id: string) => call('mkt_order_get', { p_order: id }),
  ordersMine: (side: 'compras' | 'vendas', status: string | null = null, page = 1) => call('mkt_orders_mine', { p_side: side, p_status: status, p_page: page }),
  orderAction: (id: string, action: string, note = '', extra: J = {}) => call('mkt_order_action', { p_order: id, p_action: action, p_note: note, p_extra: extra }),
  // Mensagens, denúncias, avaliações, disputas
  messages: (order: string) => call('mkt_messages', { p_order: order }),
  messageSend: (order: string, body: string, image: string | null) => call('mkt_message_send', { p_order: order, p_body: body, p_image: image }),
  report: (kind: string, target: string, reason: string) => call('mkt_report', { p_kind: kind, p_target: target, p_reason: reason }),
  reviewSave: (order: string, rating: number, comment: string) => call('mkt_review_save', { p_order: order, p_rating: rating, p_comment: comment }),
  reviewReply: (order: string, reply: string) => call('mkt_review_reply', { p_order: order, p_reply: reply }),
  async myReviews(): Promise<J[]> {
    if (IS_DEMO) return [];
    try { const c = await sb(); const { data: s } = await c.auth.getSession(); const uid = s.session?.user.id; if (!uid) return [];
      const { data } = await c.from('market_reviews').select('*').eq('seller_id', uid).order('created_at', { ascending: false }).limit(100); return data ?? []; } catch { return []; }
  },
  async productReviews(product: string): Promise<J[]> {
    if (IS_DEMO) return [];
    try { const c = await sb(); const { data } = await c.from('market_reviews').select('order_id,rating,comment,buyer_name,seller_reply,created_at,edited_at').eq('product_id', product).order('created_at', { ascending: false }).limit(30); return data ?? []; } catch { return []; }
  },
  disputeOpen: (order: string, reason: string, description: string, evidence: string[]) => call('mkt_dispute_open', { p_order: order, p_reason: reason, p_description: description, p_evidence: evidence }),
  disputeAction: (id: string, action: string, note = '', evidence: string[] = [], amount: number | null = null) =>
    call('mkt_dispute_action', { p_dispute: id, p_action: action, p_note: note, p_evidence: evidence, p_amount: amount }),
  disputeGet: (order: string) => call('mkt_dispute_get', { p_order: order }),
  async myDisputes(): Promise<J[]> {
    if (IS_DEMO) return [];
    try { const c = await sb(); const { data } = await c.from('mkt_disputes').select('id,order_id,status,reason_code,created_at,updated_at,buyer_id,seller_id').order('updated_at', { ascending: false }).limit(100); return data ?? []; } catch { return []; }
  },
  // Finanças do vendedor
  sellerFinance: () => call('mkt_seller_finance'),
  payoutRequest: (amount: number, method: string, phone: string, idem: string) => call('mkt_payout_request', { p_amount: amount, p_method: method, p_phone: phone, p_idem: idem }),
  // Painel do criador, relatórios, notificações
  creatorDashboard: (from: string | null, to: string | null) => call('mkt_creator_dashboard', { p_from: from, p_to: to }),
  creatorReport: (from: string | null, to: string | null) => call('mkt_creator_report', { p_from: from, p_to: to }),
  notifPrefSet: (event: string, inApp: boolean) => call('mkt_notification_prefs_set', { p_event: event, p_in_app: inApp }),
  async notifPrefs(): Promise<Record<string, boolean>> {
    if (IS_DEMO) return {};
    try { const c = await sb(); const { data } = await c.from('mkt_notification_prefs').select('event,in_app'); return Object.fromEntries((data ?? []).map((x: J) => [x.event, x.in_app])); } catch { return {}; }
  },
  // Administração (cada função verifica a permissão no servidor e regista recusas)
  admin: {
    dashboard: (from: string | null, to: string | null) => call('mkt_admin_dashboard', { p_from: from, p_to: to }),
    list: (entity: string, status: string | null, q: string, page: number) => call('mkt_admin_list', { p_entity: entity, p_status: status, p_q: q, p_page: page }),
    storeAction: (id: string, action: string, reason: string) => call('mkt_admin_store_action', { p_store: id, p_action: action, p_reason: reason }),
    productAction: (ids: string[], action: string, reason: string) => call('mkt_admin_product_action', { p_ids: ids, p_action: action, p_reason: reason }),
    refund: (order: string, amount: number, reason: string) => call('mkt_admin_refund', { p_order: order, p_amount: amount, p_reason: reason }),
    payoutAction: (id: string, action: string, ref: string, reason: string) => call('mkt_admin_payout_action', { p_id: id, p_action: action, p_ref: ref, p_reason: reason }),
    disputeAction: (id: string, action: string, reason: string, amount: number | null) => call('mkt_admin_dispute_action', { p_dispute: id, p_action: action, p_reason: reason, p_amount: amount }),
    reportAction: (id: string, action: string, note: string) => call('mkt_admin_report_action', { p_id: id, p_action: action, p_note: note }),
    riskAction: (id: number, action: string, note: string) => call('mkt_admin_risk_action', { p_id: id, p_action: action, p_note: note }),
    commissionSet: (scope: string, category: string | null, seller: string | null, pct: number | null, fixed: number, note: string) =>
      call('mkt_admin_commission_set', { p_scope: scope, p_category: category, p_seller: seller, p_pct: pct, p_fixed: fixed, p_note: note }),
    reconcile: () => call('mkt_admin_reconcile'),
    sweep: () => call('mkt_sweep'),
    staff: () => call('mkt_admin_staff'),
    findUser: (handle: string) => call('mkt_admin_find_user', { p_handle: handle }),
    setPerm: (user: string, perm: string, on: boolean) => call('mkt_admin_set_perm', { p_user: user, p_perm: perm, p_on: on }),
    suspend: (user: string, hours: number, reason: string) => call('mkt_admin_user_suspend', { p_user: user, p_hours: hours, p_reason: reason }),
    audit: (f: AuditFilter, page: number) => call('mkt_admin_audit', { p_actor: f.actor, p_action: f.action, p_resource: f.resource, p_result: f.result, p_area: f.area, p_from: f.from || null, p_to: f.to || null, p_page: page }),
    auditExport: (f: AuditFilter) => call('mkt_admin_audit_export', { p_actor: f.actor, p_action: f.action, p_resource: f.resource, p_result: f.result, p_area: f.area, p_from: f.from || null, p_to: f.to || null }),
    report: (from: string | null, to: string | null) => call('mkt_admin_report', { p_from: from, p_to: to }),
    // Reutiliza o mecanismo de interruptores de Apostas v2 (app_settings + app_setting_set, com auditoria)
    setFlag: (key: AppSettingKey, on: boolean) => setAppSetting(key, on),
  },
};
export interface AuditFilter { actor: string; action: string; resource: string; result: string; area: string; from: string; to: string }

/** Descarrega um ficheiro gerado no navegador (CSV). */
export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff' + text], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
