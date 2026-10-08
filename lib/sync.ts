// MODO REAL: espelho entre o estado da app e as tabelas do Supabase (com RLS).
// - load(): lê do Supabase tudo o que o utilizador pode ver (perfil, social, notificações, anúncios, catálogo; admin vê tudo).
// - sync(): depois de cada alteração local, calcula as diferenças por tabela e faz upsert/delete.
//   As permissões são garantidas no servidor pelas políticas RLS (supabase/schema.sql): o cliente nunca é a autoridade.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { State, Report, AuditEntry, Broadcast, Order, Payout, Comment as Cmt, NotifPref } from './store';
import type { AdminUser, Clip, Idol, Live, Notif, Post, Product, Tournament, GHEvent, Division } from './data';
import { GRADIENTS, setCatalog } from './data';
import type { Ad, AdSet, Campaign, AdStat } from './ads';
import { fetchAuthors, loadClipCatalog } from './clips';

export interface Ctx { uid: string; handle: string; isAdmin: boolean; isMod: boolean }
type Row = Record<string, unknown>;

interface Spec<I> {
  key: string;
  table: string;
  when: (c: Ctx) => boolean;
  query?: (q: any, c: Ctx) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  get: (s: State) => I[];
  put: (s: State, items: I[]) => State;
  id: (i: I) => string;
  from: (r: Row, c: Ctx) => I;
  to?: (i: I, c: Ctx) => Row;
  pk?: string[];
  writeWhen?: (c: Ctx) => boolean;
  noDelete?: boolean;
  onConflict?: string;
  single?: boolean;
}

const g = (i: number) => GRADIENTS[Math.abs(i) % GRADIENTS.length];
const hash = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 0);
const roleFrom = (r: string): AdminUser['role'] => (r === 'admin' ? 'admin' : r === 'moderator' ? 'moderador' : r === 'creator' ? 'criador' : 'utilizador');
const roleTo = (r?: string) => (r === 'admin' ? 'admin' : r === 'moderador' ? 'moderator' : r === 'criador' ? 'creator' : 'user');
const day = (t?: unknown) => (typeof t === 'string' ? t.slice(0, 10) : '');
const when = (t?: unknown) => (typeof t === 'string' ? new Date(t).toLocaleString('pt-PT') : '');
const ago = (t?: unknown) => {
  if (typeof t !== 'string') return '';
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
};

const one = <T,>(get: (s: State) => T, put: (s: State, v: T) => State) => ({ get: (s: State) => [get(s)], put: (s: State, v: T[]) => (v[0] ? put(s, v[0]) : s), id: () => '1', single: true });

const SPECS: Spec<any>[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
  // ---------- Perfil do próprio utilizador ----------
  {
    key: 'me', table: 'profiles', when: (c) => !!c.uid, pk: ['id'],
    query: (q, c) => q.eq('id', c.uid),
    ...one((s) => ({ user: s.user, account: s.account }), (s, v) => ({ ...s, user: v.user, account: v.account })),
    from: (r) => ({
      user: { name: String(r.display_name ?? ''), handle: '@' + r.handle, avatar: String(r.avatar_url || '🙂'), role: r.role === 'admin' ? 'admin' : 'user', bio: String(r.bio ?? '') },
      account: { loggedIn: true, method: r.phone && !r.email ? 'phone' : 'email', email: String(r.email ?? ''), phone: String(r.phone ?? ''), birth: String(r.birth_date ?? ''), province: String(r.province ?? 'Maputo Cidade'), interests: (r.interests as string[]) ?? [] },
    }),
    to: (v, c) => ({ id: c.uid, display_name: v.user.name, avatar_url: v.user.avatar, bio: v.user.bio, province: v.account.province, interests: v.account.interests }),
    noDelete: true,
  },
  // ---------- Preferências, consentimento e progresso ----------
  {
    key: 'settings', table: 'user_settings', when: (c) => !!c.uid, pk: ['user_id'], query: (q, c) => q.eq('user_id', c.uid),
    ...one((s) => ({ notifPrefs: s.notifPrefs, wellbeing: s.wellbeing, pushEnabled: s.pushEnabled, consent: s.consent, installDismissed: s.installDismissed, progress: { xp: s.xp, streak: s.streak, lastDay: s.lastDay, missions: s.missions, achievements: s.achievements, stats: s.stats, screen: s.screen, lessonsDone: s.lessonsDone, challenges: s.challenges, cart: s.cart } }),
      (s, v) => ({ ...s, notifPrefs: { ...s.notifPrefs, ...(v.notifPrefs ?? {}) }, wellbeing: { ...s.wellbeing, ...(v.wellbeing ?? {}) }, pushEnabled: !!v.pushEnabled, consent: { ...s.consent, ...(v.consent ?? {}) }, installDismissed: !!v.installDismissed, ...(v.progress ?? {}) })),
    from: (r) => ({ notifPrefs: r.notif_prefs as Record<string, NotifPref>, wellbeing: r.wellbeing, pushEnabled: r.push_enabled, consent: r.consent, installDismissed: r.install_dismissed, progress: r.progress }),
    to: (v, c) => ({ user_id: c.uid, notif_prefs: v.notifPrefs, wellbeing: v.wellbeing, push_enabled: v.pushEnabled, consent: v.consent, install_dismissed: v.installDismissed, progress: v.progress }),
    noDelete: true,
  },
  // ---------- Social ----------
  { key: 'follows', table: 'follows', when: (c) => !!c.uid, pk: ['follower_id', 'followed_id'], query: (q, c) => q.eq('follower_id', c.uid), get: (s) => s.following, put: (s, v) => ({ ...s, following: v }), id: (x) => x, from: (r) => String(r.followed_id), to: (x, c) => ({ follower_id: c.uid, followed_id: x }) },
  { key: 'likes', table: 'likes', when: (c) => !!c.uid, pk: ['user_id', 'target'], query: (q, c) => q.eq('user_id', c.uid).limit(2000), get: (s) => s.liked, put: (s, v) => ({ ...s, liked: v }), id: (x) => x, from: (r) => String(r.target), to: (x, c) => ({ user_id: c.uid, target: x }) },
  { key: 'saves', table: 'saves', when: (c) => !!c.uid, pk: ['user_id', 'kind', 'target'], query: (q, c) => q.eq('user_id', c.uid), get: (s) => s.saved, put: (s, v) => ({ ...s, saved: v }), id: (x) => x.kind + ':' + x.id, from: (r) => ({ kind: r.kind, id: String(r.target) }), to: (x, c) => ({ user_id: c.uid, kind: x.kind, target: x.id }) },
  { key: 'blocks', table: 'blocks', when: (c) => !!c.uid, pk: ['user_id', 'blocked'], query: (q, c) => q.eq('user_id', c.uid), get: (s) => s.blocked, put: (s, v) => ({ ...s, blocked: v }), id: (x) => x, from: (r) => String(r.blocked), to: (x, c) => ({ user_id: c.uid, blocked: x }) },
  {
    key: 'reactions', table: 'reactions', when: (c) => !!c.uid, pk: ['user_id', 'target'], query: (q, c) => q.eq('user_id', c.uid),
    get: (s) => Object.entries(s.reactions), put: (s, v: [string, string][]) => ({ ...s, reactions: Object.fromEntries(v) as State['reactions'] }), id: (x) => x[0],
    from: (r) => [String(r.target), String(r.emoji)], to: (x, c) => ({ user_id: c.uid, target: x[0], emoji: x[1] }), onConflict: 'user_id,target',
  },
  {
    key: 'comments', table: 'comments', when: () => true, pk: ['id'], query: (q) => q.eq('hidden', false).order('created_at', { ascending: false }).limit(500),
    get: (s) => Object.entries(s.comments).flatMap(([target, list]) => list.flatMap((c) => [{ ...c, target, parent: null as string | null }, ...c.replies.map((r) => ({ ...r, likes: 0, replies: [], target, parent: c.id }))])),
    put: (s, rows: (Cmt & { target: string; parent: string | null })[]) => {
      const out: Record<string, Cmt[]> = {};
      for (const r of rows.filter((x) => !x.parent)) (out[r.target] ??= []).push({ id: r.id, author: r.author, avatar: r.avatar, text: r.text, likes: r.likes, replies: [] });
      for (const r of rows.filter((x) => x.parent)) { const p = out[r.target]?.find((c) => c.id === r.parent); if (p) p.replies.push({ id: r.id, author: r.author, avatar: r.avatar, text: r.text }); }
      return { ...s, comments: out };
    },
    id: (x) => x.id, from: (r) => ({ id: String(r.id), target: String(r.target), parent: (r.parent_id as string) ?? null, author: String(r.author_name), avatar: String(r.author_avatar ?? '🙂'), text: String(r.body), likes: Number(r.likes_count ?? 0), replies: [] }),
    to: (x, c) => ({ id: x.id, target: x.target, parent_id: x.parent, author_id: c.uid, author_name: x.author, author_avatar: x.avatar, body: x.text }),
    writeWhen: (c) => !!c.uid, noDelete: true,
  },
  {
    key: 'notifs', table: 'notifications', when: (c) => !!c.uid, pk: ['id'], query: (q, c) => q.eq('user_id', c.uid).order('created_at', { ascending: false }).limit(100),
    get: (s) => s.notifs, put: (s, v) => ({ ...s, notifs: v }), id: (x: Notif) => x.id,
    from: (r) => ({ id: String(r.id), type: r.type, text: String(r.body), href: String(r.href ?? '/'), read: !!r.read, time: ago(r.created_at), at: String(r.created_at) }),
    to: (x: Notif, c) => ({ id: x.id, user_id: c.uid, type: x.type, body: x.text, href: x.href, read: x.read, ...(x.at ? { created_at: x.at } : {}) }),
    onConflict: 'id,created_at',
  },
  {
    key: 'myReports', table: 'reports', when: (c) => !!c.uid && !c.isAdmin, pk: ['id'], query: (q, c) => q.eq('reporter_id', c.uid).limit(100),
    get: (s) => s.myReports, put: (s, v) => ({ ...s, myReports: v }), id: (x: Report) => x.id,
    from: (r) => ({ id: String(r.id), kind: r.kind, target: String(r.target), label: String(r.label ?? ''), reason: String(r.reason), by: '', date: when(r.created_at), status: r.status }),
    to: (x: Report, c) => ({ id: x.id, reporter_id: c.uid, kind: x.kind, target: x.target, label: x.label, reason: x.reason }), noDelete: true,
  },
  { key: 'entries', table: 'tournament_entries', when: (c) => !!c.uid, pk: ['user_id', 'tournament_id'], query: (q, c) => q.eq('user_id', c.uid), get: (s) => s.entries, put: (s, v) => ({ ...s, entries: v }), id: (x) => x, from: (r) => String(r.tournament_id), to: (x, c) => ({ user_id: c.uid, tournament_id: x }) },
  // Leitura apenas: compras, bilhetes e planos são criados pelo servidor (Edge Function payments) após pagamento confirmado.
  { key: 'purchases', table: 'payments', when: (c) => !!c.uid, query: (q, c) => q.eq('user_id', c.uid).order('created_at', { ascending: false }).limit(50), get: (s) => s.purchases, put: (s, v) => ({ ...s, purchases: v }), id: (x) => x.id, from: (r) => ({ id: String(r.id), item: String(r.item), total: Number(r.amount_mzn), method: String(r.method), date: when(r.created_at), status: r.status === 'pago' ? 'demo-pago' : 'cancelado' }) },
  { key: 'tickets', table: 'tickets', when: (c) => !!c.uid, query: (q, c) => q.eq('user_id', c.uid), get: (s) => s.tickets, put: (s, v) => ({ ...s, tickets: v }), id: (x) => x.id, from: (r) => ({ id: String(r.id), eventId: String(r.event_id), tier: r.tier, qty: Number(r.qty ?? 1) }) },
  { key: 'plans', table: 'subscriptions', when: (c) => !!c.uid, query: (q, c) => q.eq('user_id', c.uid).eq('status', 'ativa'), get: (s) => s.plans, put: (s, v) => ({ ...s, plans: v }), id: (x) => x, from: (r) => String(r.plan_id) },

  // ---------- Configuração pública da plataforma (leitura por todos, escrita só admin) ----------
  {
    key: 'platform', table: 'platform_settings', when: () => true, pk: ['id'], writeWhen: (c) => c.isAdmin, noDelete: true,
    ...one((s) => ({ settings: s.admin.settings, planPrices: s.admin.planPrices, adPricing: s.admin.adPricing, commissions: s.admin.commissions, gifts: s.admin.gifts, coinPacks: s.admin.coinPacks }),
      (s, v) => ({ ...s, admin: { ...s.admin, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x != null)), settings: { ...s.admin.settings, ...(v.settings ?? {}) } } })),
    from: (r) => r.data as Row, to: (v) => ({ id: 1, data: v }),
  },
  { key: 'policies', table: 'policies', when: () => true, pk: ['slug'], writeWhen: (c) => c.isAdmin, get: (s) => Object.entries(s.admin.policies), put: (s, v: [string, string][]) => ({ ...s, admin: { ...s.admin, policies: Object.fromEntries(v) } }), id: (x) => x[0], from: (r) => [String(r.slug), String(r.body)], to: (x) => ({ slug: x[0], body: x[1] }), onConflict: 'slug' },
  { key: 'hidden', table: 'hidden_content', when: () => true, pk: ['target'], writeWhen: (c) => c.isMod, get: (s) => Array.from(new Set([...s.admin.hiddenClips, ...s.admin.removed])), put: (s, v: string[]) => ({ ...s, admin: { ...s.admin, hiddenClips: v, removed: v } }), id: (x) => x, from: (r) => String(r.target), to: (x) => ({ target: x }) },
  {
    key: 'tournaments', table: 'tournaments', when: () => true, pk: ['id'], writeWhen: (c) => c.isAdmin, query: (q) => q.order('starts_at', { ascending: true }).limit(200),
    get: (s) => s.admin.tournaments, put: (s, v) => ({ ...s, admin: { ...s.admin, tournaments: v } }), id: (x: Tournament) => x.id,
    from: (r) => ({ id: String(r.id), name: String(r.name), game: String(r.game), mode: String(r.mode ?? 'Squad'), fee: Number(r.entry_fee_mzn ?? 0), prize: Number(r.prize_mzn ?? 0), slots: Number(r.slots ?? 0), filled: Number(r.entries_count ?? 0), date: String(r.starts_at ?? '').replace('T', ' ').slice(0, 16), status: r.status, organizer: String(r.organizer ?? 'Social POIPAK'), rules: (r.rules as string[]) ?? [], gradient: g(hash(String(r.id))) }),
    to: (x: Tournament) => ({ id: x.id, name: x.name, game: x.game, mode: x.mode, entry_fee_mzn: x.fee, prize_mzn: x.prize, slots: x.slots, starts_at: /^\d{4}-\d{2}-\d{2}/.test(x.date) ? x.date.replace(' ', 'T') : null, status: x.status, organizer: x.organizer, rules: x.rules }),
  },
  {
    key: 'products', table: 'products', when: () => true, pk: ['id'], writeWhen: (c) => c.isAdmin, query: (q) => q.limit(500),
    get: (s) => s.admin.products, put: (s, v) => ({ ...s, admin: { ...s.admin, products: v } }), id: (x: Product) => x.id,
    from: (r) => ({ id: String(r.id), name: String(r.name), price: Number(r.price_mzn), category: r.category, seller: String(r.seller_name ?? 'Social POIPAK'), emoji: String(r.emoji ?? '📦'), stock: Number(r.stock ?? 0), rating: Number(r.rating ?? 5) }),
    to: (x: Product) => ({ id: x.id, name: x.name, price_mzn: x.price, category: x.category, seller_name: x.seller, emoji: x.emoji, stock: x.stock }),
  },
  {
    key: 'events', table: 'events', when: () => true, pk: ['id'], writeWhen: (c) => c.isAdmin, query: (q) => q.limit(100),
    get: (s) => s.admin.events, put: (s, v) => ({ ...s, admin: { ...s.admin, events: v } }), id: (x: GHEvent) => x.id,
    from: (r) => ({ id: String(r.id), name: String(r.name), place: String(r.place), date: String(r.starts_at ?? '').replace('T', ' ').slice(0, 16), price: Number(r.price_mzn ?? 0), vipPrice: Number(r.vip_price_mzn ?? 0), emoji: String(r.emoji ?? '🎟️'), desc: String(r.description ?? ''), left: Number(r.tickets_left ?? 0) }),
    to: (x: GHEvent) => ({ id: x.id, name: x.name, place: x.place, price_mzn: x.price, vip_price_mzn: x.vipPrice, emoji: x.emoji, description: x.desc, tickets_left: x.left }),
  },
  { key: 'liveStatus', table: 'lives', when: () => true, pk: ['id'], writeWhen: (c) => c.isMod, noDelete: true, query: (q) => q.select('id,status').limit(200), get: (s) => Object.entries(s.admin.liveStatus), put: (s, v: [string, string][]) => ({ ...s, admin: { ...s.admin, liveStatus: Object.fromEntries(v) as State['admin']['liveStatus'] } }), id: (x) => x[0], from: (r) => [String(r.id), String(r.status)], to: (x) => ({ id: x[0], status: x[1] }) },

  // ---------- Anúncios ----------
  {
    key: 'campaigns', table: 'ad_campaigns', when: () => true, pk: ['id'], query: (q) => q.limit(500),
    get: (s) => s.adsMgr.campaigns, put: (s, v) => ({ ...s, adsMgr: { ...s.adsMgr, campaigns: v } }), id: (x: Campaign) => x.id, writeWhen: (c) => !!c.uid,
    from: (r) => ({ id: String(r.id), owner: '@' + r.owner_handle, ownerId: String(r.owner_id), name: String(r.name), objective: r.objective, status: r.status, budgetType: r.budget_type, budget: Number(r.budget_mzn), start: String(r.start_date), end: String(r.end_date), createdAt: day(r.created_at) }),
    to: (x: Campaign & { ownerId?: string }, c) => ({ id: x.id, owner_id: x.ownerId ?? c.uid, owner_handle: x.owner.replace(/^@/, ''), name: x.name, objective: x.objective, status: x.status, budget_type: x.budgetType, budget_mzn: x.budget, start_date: x.start, end_date: x.end }),
  },
  {
    key: 'adsets', table: 'ad_sets', when: () => true, pk: ['id'], query: (q) => q.limit(1000), writeWhen: (c) => !!c.uid,
    get: (s) => s.adsMgr.adsets, put: (s, v) => ({ ...s, adsMgr: { ...s.adsMgr, adsets: v } }), id: (x: AdSet) => x.id,
    from: (r) => ({ id: String(r.id), campaignId: String(r.campaign_id), name: String(r.name), ageMin: Number(r.age_min), ageMax: Number(r.age_max), provinces: r.provinces ?? [], games: r.games ?? [], interests: r.interests ?? [], placements: r.placements ?? ['feed'], bid: Number(r.bid_mzn), status: r.status }),
    to: (x: AdSet) => ({ id: x.id, campaign_id: x.campaignId, name: x.name, age_min: x.ageMin, age_max: x.ageMax, provinces: x.provinces, games: x.games, interests: x.interests, placements: x.placements, bid_mzn: x.bid, status: x.status }),
  },
  {
    key: 'ads', table: 'ad_creatives', when: () => true, pk: ['id'], query: (q) => q.limit(1000), writeWhen: (c) => !!c.uid,
    get: (s) => s.adsMgr.ads, put: (s, v) => ({ ...s, adsMgr: { ...s.adsMgr, ads: v } }), id: (x: Ad) => x.id,
    from: (r) => ({ id: String(r.id), adSetId: String(r.ad_set_id), campaignId: String(r.campaign_id), name: String(r.name), format: r.format, media: (r.media_url as string) || undefined, emoji: String(r.emoji ?? '🎮'), gradient: g(hash(String(r.id))), headline: String(r.headline), text: String(r.body), cta: r.cta, url: String(r.url), review: r.review, reviewNote: (r.review_note as string) || undefined, status: r.status }),
    to: (x: Ad) => ({ id: x.id, ad_set_id: x.adSetId, campaign_id: x.campaignId, name: x.name, format: x.format, media_url: x.media && !x.media.startsWith('blob:') ? x.media : null, emoji: x.emoji, headline: x.headline, body: x.text, cta: x.cta, url: x.url, review: x.review, review_note: x.reviewNote ?? null, status: x.status }),
  },
  // Estatísticas agregadas por dia (tabela de contadores alimentada pela função record_ad_event). Só leitura.
  {
    key: 'adstats', table: 'ad_stats_daily', when: () => true, query: (q) => q.gte('day', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).limit(5000),
    get: (s) => Object.entries(s.adsMgr.stats), id: (x) => x[0],
    put: (s, rows: { ad: string; day: string; imp: number; clicks: number; results: number; spend: number }[]) => {
      const stats: Record<string, AdStat> = {};
      for (const r of rows as unknown as { ad: string; day: string; imp: number; clicks: number; results: number; spend: number }[]) {
        const x = (stats[r.ad] ??= { imp: 0, clicks: 0, results: 0, spend: 0, byDay: {} });
        x.imp += r.imp; x.clicks += r.clicks; x.results += r.results; x.spend += r.spend;
        x.byDay[r.day] = { imp: r.imp, clicks: r.clicks, results: r.results, spend: r.spend };
      }
      return { ...s, adsMgr: { ...s.adsMgr, stats } };
    },
    from: (r) => ({ ad: String(r.ad_id), day: String(r.day), imp: Number(r.impressions), clicks: Number(r.clicks), results: Number(r.results), spend: Number(r.spend_mzn) }),
  },
  { key: 'wallet', table: 'ad_wallets', when: (c) => !!c.uid, query: (q, c) => q.eq('user_id', c.uid), ...one((s) => s.adsMgr.wallet, (s, v) => ({ ...s, adsMgr: { ...s.adsMgr, wallet: v } })), from: (r) => Number(r.balance_mzn) },
  { key: 'invoices', table: 'payments', when: (c) => !!c.uid, query: (q, c) => q.eq('user_id', c.uid).eq('kind', 'ad_topup').limit(50), get: (s) => s.adsMgr.invoices, put: (s, v) => ({ ...s, adsMgr: { ...s.adsMgr, invoices: v } }), id: (x) => x.id, from: (r) => ({ id: String(r.id), amount: Number(r.amount_mzn), date: day(r.created_at), method: String(r.method), status: 'demo-pago' }) },

  // ---------- Administração (RLS: só role admin/moderator) ----------
  {
    key: 'users', table: 'profiles', when: (c) => c.isAdmin, pk: ['id'], noDelete: true, query: (q) => q.order('created_at', { ascending: false }).limit(1000),
    get: (s) => s.admin.users, put: (s, v) => ({ ...s, admin: { ...s.admin, users: v } }), id: (x: AdminUser) => x.id,
    from: (r) => ({ id: String(r.id), name: String(r.display_name), handle: '@' + r.handle, plan: String(r.plan ?? 'Grátis'), verified: !!r.verified, banned: !!r.banned, premium: !!r.is_premium, joined: day(r.created_at), role: roleFrom(String(r.role)), suspended: !!r.suspended_until && new Date(String(r.suspended_until)) > new Date(), deleted: !!r.deleted_at, province: String(r.province ?? '') }),
    to: (x: AdminUser) => ({ id: x.id, verified: x.verified, banned: x.banned, is_premium: x.premium, plan: x.plan, role: roleTo(x.role), suspended_until: x.suspended ? new Date(Date.now() + 7 * 86400000).toISOString() : null, deleted_at: x.deleted ? new Date().toISOString() : null }),
  },
  {
    key: 'reports', table: 'reports', when: (c) => c.isMod, pk: ['id'], noDelete: true, query: (q) => q.order('created_at', { ascending: false }).limit(500),
    get: (s) => s.admin.reports, put: (s, v) => ({ ...s, admin: { ...s.admin, reports: v } }), id: (x: Report) => x.id,
    from: (r) => ({ id: String(r.id), kind: r.kind, target: String(r.target), label: String(r.label ?? ''), reason: String(r.reason), by: '@' + (r.reporter_handle ?? '?'), date: when(r.created_at), status: r.status }),
    to: (x: Report, c) => ({ id: x.id, kind: x.kind, target: x.target, label: x.label, reason: x.reason, status: x.status, ...(x.by === c.handle ? { reporter_id: c.uid } : {}) }),
  },
  {
    key: 'audit', table: 'audit_log', when: (c) => c.isMod, pk: ['id'], noDelete: true, query: (q) => q.order('created_at', { ascending: false }).limit(300),
    get: (s) => s.admin.audit, put: (s, v) => ({ ...s, admin: { ...s.admin, audit: v } }), id: (x: AuditEntry) => x.id,
    from: (r) => ({ id: String(r.id), at: when(r.created_at), actor: '@' + r.actor_handle, action: String(r.action), target: String(r.target) }),
    to: (x: AuditEntry, c) => ({ id: x.id, actor_id: c.uid, actor_handle: c.handle.replace(/^@/, ''), action: x.action, target: x.target }),
  },
  {
    key: 'broadcasts', table: 'broadcasts', when: (c) => c.isAdmin, pk: ['id'], query: (q) => q.order('created_at', { ascending: false }).limit(100),
    get: (s) => s.admin.broadcasts, put: (s, v) => ({ ...s, admin: { ...s.admin, broadcasts: v } }), id: (x: Broadcast) => x.id,
    from: (r) => ({ id: String(r.id), title: String(r.title), body: String(r.body), segment: String(r.segment), url: String(r.url), category: r.category, schedule: r.send_at ? String(r.send_at).slice(0, 16) : '', status: r.status, reach: Number(r.reach ?? 0) }),
    to: (x: Broadcast) => ({ id: x.id, title: x.title, body: x.body, segment: x.segment, url: x.url, category: x.category, send_at: x.schedule ? new Date(x.schedule).toISOString() : null, status: x.status, reach: x.reach }),
  },
  {
    key: 'orders', table: 'orders', when: (c) => c.isAdmin, pk: ['id'], noDelete: true, query: (q) => q.order('created_at', { ascending: false }).limit(300),
    get: (s) => s.admin.orders, put: (s, v) => ({ ...s, admin: { ...s.admin, orders: v } }), id: (x: Order) => x.id,
    from: (r) => ({ id: String(r.id), user: '@' + (r.buyer_handle ?? '?'), items: String(r.summary ?? ''), total: Number(r.total_mzn), status: r.status, date: day(r.created_at) }),
    to: (x: Order) => ({ id: x.id, status: x.status }),
  },
  {
    key: 'payouts', table: 'payouts', when: (c) => c.isAdmin, pk: ['id'], noDelete: true, query: (q) => q.order('created_at', { ascending: false }).limit(300),
    get: (s) => s.admin.payouts, put: (s, v) => ({ ...s, admin: { ...s.admin, payouts: v } }), id: (x: Payout) => x.id,
    from: (r) => ({ id: String(r.id), creator: '@' + r.creator_handle, amount: Number(r.amount_mzn), method: String(r.method), status: r.status, date: day(r.created_at) }),
    to: (x: Payout) => ({ id: x.id, status: x.status }),
  },
  {
    key: 'payments', table: 'payments', when: (c) => c.isAdmin, pk: ['id'], noDelete: true, query: (q) => q.order('created_at', { ascending: false }).limit(300),
    get: (s) => s.admin.payments, put: (s, v) => ({ ...s, admin: { ...s.admin, payments: v } }), id: (x) => x.id,
    from: (r) => ({ id: String(r.id), user: '@' + (r.user_handle ?? '?'), item: String(r.item), amount: Number(r.amount_mzn), method: String(r.method), status: String(r.status) }),
    to: (x: { id: string; status: string }) => ({ id: x.id, status: x.status }),
  },
];

// ---------- Catálogo público (só leitura) ----------
async function loadCatalog(c: SupabaseClient) {
  const [creators, clips, lives, posts] = await Promise.all([
    c.from('profiles').select('id,handle,display_name,avatar_url,bio,verified,followers_count,main_game,division,team').in('role', ['creator', 'admin']).eq('banned', false).is('deleted_at', null).order('followers_count', { ascending: false }).limit(200),
    loadClipCatalog(c).catch((e) => { console.warn('[Social POIPAK] clipes:', e?.message ?? e); return { clips: [] as Clip[], trending: [] as string[], authors: [] as Idol[] }; }),
    c.from('lives').select('id,host_id,title,game,viewers,started_at,status,stream_url,created_at').in('status', ['ao vivo', 'agendada']).order('started_at', { ascending: true, nullsFirst: false }).limit(80),
    c.from('posts').select('id,author_id,body,likes_count,comments_count,created_at').eq('hidden', false).order('created_at', { ascending: false }).limit(50),
  ]);
  const idols: Idol[] = (creators.data ?? []).map((r, k) => ({
    id: r.id, name: r.display_name, handle: '@' + r.handle, game: r.main_game ?? '', avatar: r.avatar_url || '🎮', color: ['#5b9bd5', '#4fb3a9', '#8fbf8f', '#d98a8a', '#d9b56c'][k % 5],
    followers: r.followers_count ?? 0, verified: !!r.verified, bio: r.bio ?? '', division: (r.division ?? 'Bronze') as Division, rank: k + 1, achievements: [], team: r.team ?? undefined,
  }));
  const liveRows = lives.data ?? [];
  const toLive = (r: Record<string, any>, k: number): Live => ({ id: String(r.id), idolId: String(r.host_id), title: String(r.title ?? ''), game: String(r.game ?? ''), viewers: r.viewers ?? 0, gradient: g(k), featured: k === 0, startedMin: r.started_at && r.status === 'ao vivo' ? Math.max(0, Math.round((Date.now() - new Date(r.started_at).getTime()) / 60000)) : 0, streamUrl: r.stream_url ?? undefined, status: r.status, startsAt: r.started_at ?? r.created_at ?? undefined }); // eslint-disable-line @typescript-eslint/no-explicit-any
  // Anfitriões das lives que não são criadores (perfis normais): junta aos autores para mostrar nome e avatar
  const known = new Set([...idols.map((i) => i.id), ...clips.authors.map((a) => a.id)]);
  const hostIds = liveRows.map((r) => String(r.host_id)).filter((id) => id && !known.has(id));
  const hosts = hostIds.length ? await fetchAuthors(c, hostIds).catch(() => [] as Idol[]) : [];
  const nowLives = liveRows.filter((r) => r.status === 'ao vivo').sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
  const soon = liveRows.filter((r) => r.status === 'agendada' && (!r.started_at || new Date(r.started_at).getTime() > Date.now() - 6 * 3600_000));
  setCatalog({
    idols,
    clips: clips.clips, trending: clips.trending, authors: [...clips.authors, ...hosts],
    lives: nowLives.map(toLive),
    upcoming: soon.map((r, k) => toLive(r, k + 1)),
    posts: (posts.data ?? []).map((r): Post => ({ id: r.id, idolId: r.author_id, text: r.body, emoji: '📣', likes: r.likes_count ?? 0, comments: r.comments_count ?? 0, time: ago(r.created_at) })),
    ranking: idols.slice(0, 10).map((i) => ({ name: i.name, avatar: i.avatar, xp: i.followers })),
    players: idols.slice(0, 20).map((i) => ({ id: i.id, name: i.name, avatar: i.avatar, division: i.division })),
  });
}

let snap: Record<string, Map<string, string>> = {};
const applies = (sp: Spec<unknown>, c: Ctx) => sp.when(c);

/** Lê tudo do Supabase e devolve o novo estado. */
export async function loadAll(c: SupabaseClient, base: State, ctx: Ctx): Promise<{ state: State; errors: string[] }> {
  const errors: string[] = [];
  await loadCatalog(c).catch((e) => errors.push('catálogo: ' + e.message));
  const specs = SPECS.filter((sp) => applies(sp, ctx));
  const results = await Promise.all(specs.map(async (sp) => {
    let q = c.from(sp.table).select('*');
    if (sp.query) q = sp.query(q, ctx);
    const { data, error } = await q;
    return { sp, data: (data ?? []) as Row[], error };
  }));
  let st = base;
  snap = {};
  for (const { sp, data, error } of results) {
    if (error) { errors.push(`${sp.table}: ${error.message}`); continue; }
    const items = data.map((r) => sp.from(r, ctx));
    if (!sp.single || items.length) st = sp.put(st, items);
    snap[sp.key] = new Map(sp.get(st).map((i) => [sp.id(i), JSON.stringify(sp.to ? sp.to(i, ctx) : i)]));
  }
  return { state: st, errors };
}

/** Envia para o Supabase o que mudou desde a última sincronização. */
export async function syncDiff(c: SupabaseClient, s: State, ctx: Ctx): Promise<string[]> {
  const errors: string[] = [];
  await Promise.all(SPECS.filter((sp) => sp.to && applies(sp, ctx) && (!sp.writeWhen || sp.writeWhen(ctx))).map(async (sp) => {
    const prev = snap[sp.key] ?? new Map<string, string>();
    const cur = new Map<string, string>();
    const items = sp.get(s);
    const ins: Row[] = [];
    const upd: Row[] = [];
    for (const it of items) {
      const row = sp.to!(it, ctx);
      const js = JSON.stringify(row);
      const id = sp.id(it);
      cur.set(id, js);
      if (!prev.has(id)) ins.push(row); else if (prev.get(id) !== js) upd.push(row);
    }
    const removed = sp.noDelete ? [] : [...prev.keys()].filter((k) => !cur.has(k));
    snap[sp.key] = cur;
    // Novos registos → upsert (idempotente); registos existentes alterados → update só das colunas enviadas.
    if (ins.length) {
      const { error } = await c.from(sp.table).upsert(ins, { onConflict: sp.onConflict ?? (sp.pk ?? ['id']).join(',') });
      if (error) errors.push(`${sp.table}: ${error.message}`);
    }
    for (const row of upd) {
      const match = Object.fromEntries((sp.pk ?? ['id']).map((col) => [col, row[col]]));
      const { error } = await c.from(sp.table).update(row).match(match);
      if (error) errors.push(`${sp.table}: ${error.message}`);
    }
    for (const k of removed) {
      const row = JSON.parse(prev.get(k)!) as Row;
      const match = Object.fromEntries((sp.pk ?? ['id']).map((col) => [col, row[col]]));
      const { error } = await c.from(sp.table).delete().match(match);
      if (error) errors.push(`${sp.table}: ${error.message}`);
    }
  }));
  return errors;
}

export function resetSnapshot() { snap = {}; }
