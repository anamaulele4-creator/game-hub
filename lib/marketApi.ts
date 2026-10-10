// Marketplace — acesso aos dados. Modo real: Supabase (tabelas market_* com RLS + funções). Modo demo: localStorage.
import { IS_DEMO } from './config';
import { sb } from './supabase';
import {
  Currency, Delivery, FX_CACHE_MS, ListingKind, MznRates, OrderAction, OrderStatus, Role, Rounding, applyOverride, mznRatesFromUsd, nextStatus,
} from './market';
import { MARKET_SEED } from './marketSeed';

export type ListingStatus = 'rascunho' | 'ativo' | 'removido';
export interface Listing {
  id: string; sellerId: string; sellerName: string; category: string; kind: ListingKind; delivery: Delivery; title: string; description: string;
  priceMzn: number; priceCurrency: Currency; priceOriginal: number; stock: number; photos: string[]; whatsapp: string;
  status: ListingStatus; featured: boolean; sales: number; createdAt: string;
}
export interface SeedListing { id: string; category: string; kind: string; delivery: string; title: string; description: string; photos: string[]; stock: number }
export interface Question { id: string; productId: string; askerName: string; question: string; answer: string | null; createdAt: string }
export interface Order {
  id: string; productId: string; productTitle: string; buyerId: string; sellerId: string; qty: number; unitPriceMzn: number; totalMzn: number;
  feePct: number | null; status: OrderStatus; paymentRef: string; deliveryNote: string; disputeReason: string; resolution: string; createdAt: string;
}
export interface Review { orderId: string; productId: string; sellerId: string; buyerName: string; rating: number; comment: string; createdAt: string }
export interface MarketSettings { feePct: number | null; deliveryHours: number | null; autoReleaseDays: number | null; fxOverride: Partial<Record<Currency, number | null>>; rounding: Rounding }
export type ListingInput = Pick<Listing, 'category' | 'kind' | 'delivery' | 'title' | 'description' | 'priceMzn' | 'priceCurrency' | 'priceOriginal' | 'stock' | 'photos' | 'whatsapp'> & { id?: string; status?: ListingStatus };
export type Res = { ok: true; id?: string } | { ok: false; code: string };

export const DEFAULT_MARKET_SETTINGS: MarketSettings = { feePct: null, deliveryHours: null, autoReleaseDays: null, fxOverride: {}, rounding: 1 };

/* ---------------- Câmbio (open.er-api.com, cache 12 h) ---------------- */
const FX_KEY = 'txap-fx-v1';
export const FX_SOURCE = { name: 'ExchangeRate-API', url: 'https://www.exchangerate-api.com' };
export async function fetchRates(override: MarketSettings['fxOverride']): Promise<{ rates: MznRates | null; at: number | null }> {
  let api: MznRates | null = null; let at: number | null = null;
  try {
    const c = JSON.parse(localStorage.getItem(FX_KEY) || 'null') as { at: number; rates: MznRates } | null;
    if (c && Date.now() - c.at < FX_CACHE_MS) { api = c.rates; at = c.at; }
  } catch {}
  if (!api) {
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD');
      const d = await r.json();
      if (d?.result === 'success') { api = mznRatesFromUsd(d.rates); at = Date.now(); if (api) localStorage.setItem(FX_KEY, JSON.stringify({ at, rates: api })); }
    } catch {}
  }
  return { rates: applyOverride(api, override), at };
}

/* ---------------- Demo ---------------- */
const DEMO_KEY = 'txap-market-demo-v1';
const ME = 'demo';
interface DemoDB { listings: Listing[]; questions: Question[]; orders: Order[]; reviews: Review[]; settings: MarketSettings }
function seedListing(s: SeedListing, i: number, status: ListingStatus): Listing {
  return {
    ...s, kind: s.kind as ListingKind, delivery: s.delivery as Delivery, sellerId: 'txapilog', sellerName: 'TXAPILOG', priceMzn: 0, priceCurrency: 'MZN', priceOriginal: 0,
    whatsapp: '', status, featured: i % 6 === 0, sales: 0, createdAt: new Date(Date.UTC(2026, 9, 10, 8, 0) - i * 3600e3).toISOString(),
  };
}
function demoDB(): DemoDB {
  try { const d = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); if (d?.listings) return d; } catch {}
  // Na demo o catálogo inicial aparece publicado (com a etiqueta "Dados de exemplo") para se ver a loja a funcionar.
  return { listings: MARKET_SEED.map((s, i) => seedListing(s, i, 'ativo')), questions: [], orders: [], reviews: [], settings: { ...DEFAULT_MARKET_SETTINGS } };
}
function withDemo<T>(fn: (d: DemoDB) => T): T { const d = demoDB(); const r = fn(d); try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch {} return r; }
const nid = () => Math.random().toString(36).slice(2, 10);

/* ---------------- Real ---------------- */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mapListing = (r: Row): Listing => ({
  id: r.id, sellerId: r.seller_id, sellerName: r.seller_name || 'Vendedor', category: r.category, kind: r.kind, delivery: r.delivery, title: r.title, description: r.description ?? '',
  priceMzn: r.price_mzn ?? 0, priceCurrency: r.price_currency ?? 'MZN', priceOriginal: Number(r.price_original ?? 0), stock: r.stock ?? 0, photos: r.photos ?? [], whatsapp: r.whatsapp ?? '',
  status: r.status, featured: !!r.featured, sales: r.sales ?? 0, createdAt: r.created_at,
});
const mapOrder = (r: Row): Order => ({
  id: r.id, productId: r.product_id, productTitle: r.product_title, buyerId: r.buyer_id, sellerId: r.seller_id, qty: r.qty, unitPriceMzn: r.unit_price_mzn, totalMzn: r.total_mzn,
  feePct: r.fee_pct == null ? null : Number(r.fee_pct), status: r.status, paymentRef: r.payment_ref ?? '', deliveryNote: r.delivery_note ?? '', disputeReason: r.dispute_reason ?? '', resolution: r.resolution ?? '', createdAt: r.created_at,
});
const mapReview = (r: Row): Review => ({ orderId: r.order_id, productId: r.product_id, sellerId: r.seller_id, buyerName: r.buyer_name || 'Comprador', rating: r.rating, comment: r.comment ?? '', createdAt: r.created_at });
const toRow = (l: ListingInput) => ({
  category: l.category, kind: l.kind, delivery: l.delivery, title: l.title.trim(), description: l.description.trim(), price_mzn: l.priceMzn, price_currency: l.priceCurrency,
  price_original: l.priceOriginal, stock: l.stock, photos: l.photos, whatsapp: l.whatsapp.trim() || null, ...(l.status ? { status: l.status } : {}),
});
async function rpc(fn: string, args: Row): Promise<Row> {
  const c = await sb(); const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as Row;
}
const res = (d: Row): Res => (d?.ok ? { ok: true, id: d.order_id } : { ok: false, code: d?.code ?? 'ERRO' });
async function uid(): Promise<string | null> { const c = await sb(); const { data } = await c.auth.getSession(); return data.session?.user.id ?? null; }

export const marketApi = {
  me: async (): Promise<string | null> => (IS_DEMO ? ME : uid()),

  async settings(): Promise<MarketSettings> {
    if (IS_DEMO) return demoDB().settings;
    const c = await sb(); const { data } = await c.from('market_settings').select('*').eq('id', 1).maybeSingle();
    return data ? { feePct: data.fee_pct == null ? null : Number(data.fee_pct), deliveryHours: data.delivery_hours, autoReleaseDays: data.auto_release_days, fxOverride: data.fx_override ?? {}, rounding: data.rounding ?? 1 } : { ...DEFAULT_MARKET_SETTINGS };
  },
  async listings(opts: { category?: string; limit?: number } = {}): Promise<Listing[]> {
    if (IS_DEMO) return demoDB().listings.filter((l) => l.status === 'ativo' && (!opts.category || l.category === opts.category)).slice(0, opts.limit ?? 200);
    const c = await sb();
    let q = c.from('market_products').select('*').eq('status', 'ativo').order('created_at', { ascending: false }).limit(opts.limit ?? 200);
    if (opts.category) q = q.eq('category', opts.category);
    const { data, error } = await q; if (error) throw new Error(error.message);
    return (data ?? []).map(mapListing);
  },
  async listing(id: string): Promise<{ listing: Listing | null; questions: Question[]; reviews: Review[] }> {
    if (IS_DEMO) { const d = demoDB(); const l = d.listings.find((x) => x.id === id) ?? null; return { listing: l, questions: d.questions.filter((q) => q.productId === id), reviews: d.reviews.filter((r) => l && r.sellerId === l.sellerId) }; }
    const c = await sb();
    const { data: l } = await c.from('market_products').select('*').eq('id', id).maybeSingle();
    if (!l) return { listing: null, questions: [], reviews: [] };
    const [{ data: q }, { data: r }] = await Promise.all([
      c.from('market_questions').select('*').eq('product_id', id).order('created_at', { ascending: false }).limit(50),
      c.from('market_reviews').select('*').eq('seller_id', l.seller_id).order('created_at', { ascending: false }).limit(30),
    ]);
    return { listing: mapListing(l), questions: (q ?? []).map((x: Row) => ({ id: x.id, productId: x.product_id, askerName: x.asker_name || 'Utilizador', question: x.question, answer: x.answer, createdAt: x.created_at })), reviews: (r ?? []).map(mapReview) };
  },
  async recentReviews(limit = 6): Promise<Review[]> {
    if (IS_DEMO) return demoDB().reviews.slice(0, limit);
    const c = await sb(); const { data } = await c.from('market_reviews').select('*').order('created_at', { ascending: false }).limit(limit);
    return (data ?? []).map(mapReview);
  },
  async myListings(): Promise<Listing[]> {
    if (IS_DEMO) return demoDB().listings.filter((l) => l.sellerId === ME);
    const id = await uid(); if (!id) return [];
    const c = await sb(); const { data } = await c.from('market_products').select('*').eq('seller_id', id).order('created_at', { ascending: false });
    return (data ?? []).map(mapListing);
  },
  async save(l: ListingInput): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => {
      if (l.id) { const x = d.listings.find((y) => y.id === l.id); if (!x) return { ok: false, code: 'NOT_FOUND' } as Res; Object.assign(x, l); return { ok: true, id: x.id } as Res; }
      const n: Listing = { ...l, id: nid(), sellerId: ME, sellerName: 'Tu (demo)', status: l.status ?? 'ativo', featured: false, sales: 0, createdAt: new Date().toISOString() };
      d.listings.unshift(n); return { ok: true, id: n.id } as Res;
    });
    const c = await sb();
    if (l.id) { const { error } = await c.from('market_products').update(toRow(l)).eq('id', l.id); return error ? { ok: false, code: error.message } : { ok: true, id: l.id }; }
    const { data, error } = await c.from('market_products').insert({ ...toRow(l), status: l.status ?? 'ativo' }).select('id').single();
    return error ? { ok: false, code: error.message } : { ok: true, id: data.id };
  },
  async ask(productId: string, question: string): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => { d.questions.unshift({ id: nid(), productId, askerName: 'Tu (demo)', question: question.trim(), answer: null, createdAt: new Date().toISOString() }); return { ok: true } as Res; });
    return res(await rpc('market_ask', { p_product: productId, p_question: question }));
  },
  async answer(questionId: string, answer: string): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => { const q = d.questions.find((x) => x.id === questionId); if (q) q.answer = answer.trim(); return { ok: true } as Res; });
    return res(await rpc('market_answer', { p_question: questionId, p_answer: answer }));
  },
  async createOrder(productId: string, qty: number): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => {
      const l = d.listings.find((x) => x.id === productId && x.status === 'ativo');
      if (!l) return { ok: false, code: 'NOT_FOUND' } as Res;
      if (l.sellerId === ME) return { ok: false, code: 'OWN' } as Res;
      if (l.priceMzn <= 0) return { ok: false, code: 'NO_PRICE' } as Res;
      if (qty < 1 || qty > l.stock) return { ok: false, code: 'STOCK' } as Res;
      const o: Order = { id: nid(), productId, productTitle: l.title, buyerId: ME, sellerId: l.sellerId, qty, unitPriceMzn: l.priceMzn, totalMzn: l.priceMzn * qty, feePct: d.settings.feePct, status: 'aguarda_pagamento', paymentRef: '', deliveryNote: '', disputeReason: '', resolution: '', createdAt: new Date().toISOString() };
      d.orders.unshift(o); return { ok: true, id: o.id } as Res;
    });
    return res(await rpc('market_order_create', { p_product: productId, p_qty: qty }));
  },
  async orders(scope: 'mine' | 'all'): Promise<Order[]> {
    if (IS_DEMO) return demoDB().orders.filter((o) => scope === 'all' || o.buyerId === ME || o.sellerId === ME);
    const c = await sb(); let q = c.from('market_orders').select('*').order('created_at', { ascending: false }).limit(200);
    if (scope === 'mine') { const id = await uid(); if (!id) return []; q = q.or(`buyer_id.eq.${id},seller_id.eq.${id}`); }
    const { data } = await q; return (data ?? []).map(mapOrder);
  },
  async orderAction(id: string, action: OrderAction, note = '', role: Role): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => {
      const o = d.orders.find((x) => x.id === id); if (!o) return { ok: false, code: 'NOT_FOUND' } as Res;
      const nx = nextStatus(o.status, action, role); if (!nx) return { ok: false, code: 'STATE' } as Res;
      if (action === 'confirmar_pagamento') { if (note.trim().length < 3) return { ok: false, code: 'REF' } as Res; o.paymentRef = note.trim(); }
      if (action === 'abrir_disputa') { if (note.trim().length < 5) return { ok: false, code: 'REASON' } as Res; o.disputeReason = note.trim(); }
      if (action === 'entregar') o.deliveryNote = note.trim();
      if (action === 'reembolsar' || action === 'liberar') o.resolution = note.trim();
      o.status = nx; return { ok: true } as Res;
    });
    return res(await rpc('market_order_action', { p_order: id, p_action: action, p_note: note }));
  },
  async review(orderId: string, rating: number, comment: string): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => {
      const o = d.orders.find((x) => x.id === orderId); if (!o || o.status !== 'concluido') return { ok: false, code: 'STATE' } as Res;
      if (d.reviews.some((r) => r.orderId === orderId)) return { ok: false, code: 'ALREADY' } as Res;
      d.reviews.unshift({ orderId, productId: o.productId, sellerId: o.sellerId, buyerName: 'Tu (demo)', rating, comment: comment.trim(), createdAt: new Date().toISOString() }); return { ok: true } as Res;
    });
    return res(await rpc('market_review', { p_order: orderId, p_rating: rating, p_comment: comment }));
  },

  /* ----- Admin ----- */
  async adminListings(): Promise<Listing[]> {
    if (IS_DEMO) return demoDB().listings;
    const c = await sb(); const { data, error } = await c.from('market_products').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapListing);
  },
  async bulk(ids: string[], action: 'publicar' | 'rascunho' | 'remover' | 'destacar' | 'nao_destacar'): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => {
      for (const l of d.listings) if (ids.includes(l.id)) {
        if (action === 'publicar') l.status = 'ativo'; else if (action === 'rascunho') l.status = 'rascunho'; else if (action === 'remover') l.status = 'removido';
        else l.featured = action === 'destacar';
      }
      return { ok: true } as Res;
    });
    return res(await rpc('market_admin_listings', { p_ids: ids, p_action: action }));
  },
  async importRows(rows: ListingInput[]): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => { for (const r of rows) d.listings.unshift({ ...r, id: nid(), sellerId: 'txapilog', sellerName: 'TXAPILOG', status: 'rascunho', featured: false, sales: 0, createdAt: new Date().toISOString() }); return { ok: true } as Res; });
    const c = await sb(); const me = await uid();
    const { error } = await c.from('market_products').insert(rows.map((r) => ({ ...toRow(r), seller_id: me, status: 'rascunho' })));
    return error ? { ok: false, code: error.message } : { ok: true };
  },
  async saveSettings(s: MarketSettings): Promise<Res> {
    if (IS_DEMO) return withDemo((d) => { d.settings = s; return { ok: true } as Res; });
    return res(await rpc('market_admin_settings', { p: { fee_pct: s.feePct, delivery_hours: s.deliveryHours, auto_release_days: s.autoReleaseDays, fx_override: s.fxOverride, rounding: s.rounding } }));
  },
};

export const MARKET_ERR: Record<string, string> = {
  AUTH: 'Entra na tua conta.', NOT_FOUND: 'Anúncio não encontrado.', OWN: 'Não podes comprar o teu próprio anúncio.', NO_PRICE: 'O vendedor ainda não definiu o preço.',
  STOCK: 'Quantidade indisponível.', STATE: 'Esta ação já não é possível.', REF: 'Indica a referência do pagamento.', REASON: 'Explica o motivo da disputa.',
  RATING: 'Escolhe de 1 a 5 estrelas.', ALREADY: 'Já avaliaste este pedido.', FORBIDDEN: 'Sem permissão.', TEXT: 'Escreve a pergunta.', RATE: 'Demasiadas perguntas. Tenta daqui a pouco.',
  INVALID: 'Valores inválidos.', PHOTOS: 'Fotos inválidas.',
};
