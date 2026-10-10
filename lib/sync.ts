// MODO REAL: espelho entre o estado da app e as tabelas do Supabase (com RLS).
// - load(): lê do Supabase o perfil, preferências, notificações, inscrições, torneios e definições (admin vê também utilizadores e auditoria).
// - sync(): depois de cada alteração local, calcula as diferenças por tabela e faz upsert/delete.
//   As permissões são garantidas no servidor pelas políticas RLS (supabase/schema.sql): o cliente nunca é a autoridade.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { State, AuditEntry, Broadcast, NotifPref } from './store';
import type { AdminUser, Notif, Tournament } from './data';
import { GRADIENTS } from './data';

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
  {
    key: 'notifs', table: 'notifications', when: (c) => !!c.uid, pk: ['id'], query: (q, c) => q.eq('user_id', c.uid).order('created_at', { ascending: false }).limit(100),
    get: (s) => s.notifs, put: (s, v) => ({ ...s, notifs: v }), id: (x: Notif) => x.id,
    from: (r) => ({ id: String(r.id), type: r.type, text: String(r.body), href: String(r.href ?? '/'), read: !!r.read, time: ago(r.created_at), at: String(r.created_at) }),
    to: (x: Notif, c) => ({ id: x.id, user_id: c.uid, type: x.type, body: x.text, href: x.href, read: x.read, ...(x.at ? { created_at: x.at } : {}) }),
    onConflict: 'id,created_at',
  },
  { key: 'entries', table: 'tournament_entries', when: (c) => !!c.uid, pk: ['user_id', 'tournament_id'], query: (q, c) => q.eq('user_id', c.uid), get: (s) => s.entries, put: (s, v) => ({ ...s, entries: v }), id: (x) => x, from: (r) => String(r.tournament_id) }, // escrita só via tournament_register / tournament_unregister
  // Leitura apenas: compras, bilhetes e planos são criados pelo servidor (Edge Function payments) após pagamento confirmado.
  // ---------- Configuração pública da plataforma (leitura por todos, escrita só admin) ----------
  {
    key: 'platform', table: 'platform_settings', when: () => true, pk: ['id'], writeWhen: (c) => c.isAdmin, noDelete: true,
    ...one((s) => ({ settings: s.admin.settings, planPrices: s.admin.planPrices, commissions: s.admin.commissions, gifts: s.admin.gifts, coinPacks: s.admin.coinPacks }),
      (s, v) => ({ ...s, admin: { ...s.admin, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x != null)), settings: { ...s.admin.settings, ...(v.settings ?? {}) } } })),
    from: (r) => r.data as Row, to: (v) => ({ id: 1, data: v }),
  },
  { key: 'policies', table: 'policies', when: () => true, pk: ['slug'], writeWhen: (c) => c.isAdmin, get: (s) => Object.entries(s.admin.policies), put: (s, v: [string, string][]) => ({ ...s, admin: { ...s.admin, policies: Object.fromEntries(v) } }), id: (x) => x[0], from: (r) => [String(r.slug), String(r.body)], to: (x) => ({ slug: x[0], body: x[1] }), onConflict: 'slug' },
  {
    key: 'tournaments', table: 'tournaments', when: () => true, pk: ['id'], writeWhen: (c) => c.isAdmin, query: (q) => q.order('starts_at', { ascending: true }).limit(200),
    get: (s) => s.admin.tournaments, put: (s, v) => ({ ...s, admin: { ...s.admin, tournaments: v } }), id: (x: Tournament) => x.id,
    from: (r) => ({ id: String(r.id), name: String(r.name), game: String(r.game), mode: String(r.mode ?? 'Squad'), fee: Number(r.entry_fee_mzn ?? 0), prize: Number(r.prize_mzn ?? 0), slots: Number(r.slots ?? 0), filled: Number(r.entries_count ?? 0), date: String(r.starts_at ?? '').replace('T', ' ').slice(0, 16), status: r.status, organizer: String(r.organizer ?? 'TXAPILOG'), rules: (r.rules as string[]) ?? [], gradient: g(hash(String(r.id))), cover: r.cover_url ? String(r.cover_url) : undefined, discordInvite: r.discord_invite ? String(r.discord_invite) : undefined, requireDiscord: !!r.require_discord }),
    to: (x: Tournament) => ({ id: x.id, name: x.name, game: x.game, mode: x.mode, entry_fee_mzn: x.fee, prize_mzn: x.prize, slots: x.slots, starts_at: /^\d{4}-\d{2}-\d{2}/.test(x.date) ? x.date.replace(' ', 'T') : null, status: x.status, organizer: x.organizer, rules: x.rules, cover_url: x.cover ?? null, discord_invite: x.discordInvite || null, require_discord: !!x.requireDiscord }),
  },
  // ---------- Anúncios ----------
  // Estatísticas agregadas por dia (tabela de contadores alimentada pela função record_ad_event). Só leitura.
  // ---------- Administração (RLS: só role admin/moderator) ----------
  {
    key: 'users', table: 'profiles', when: (c) => c.isAdmin, pk: ['id'], noDelete: true, query: (q) => q.order('created_at', { ascending: false }).limit(1000),
    get: (s) => s.admin.users, put: (s, v) => ({ ...s, admin: { ...s.admin, users: v } }), id: (x: AdminUser) => x.id,
    from: (r) => ({ id: String(r.id), name: String(r.display_name), handle: '@' + r.handle, plan: String(r.plan ?? 'Grátis'), verified: !!r.verified, banned: !!r.banned, premium: !!r.is_premium, joined: day(r.created_at), role: roleFrom(String(r.role)), suspended: !!r.suspended_until && new Date(String(r.suspended_until)) > new Date(), deleted: !!r.deleted_at, province: String(r.province ?? '') }),
    to: (x: AdminUser) => ({ id: x.id, verified: x.verified, banned: x.banned, is_premium: x.premium, plan: x.plan, role: roleTo(x.role), suspended_until: x.suspended ? new Date(Date.now() + 7 * 86400000).toISOString() : null, deleted_at: x.deleted ? new Date().toISOString() : null }),
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
];


let snap: Record<string, Map<string, string>> = {};
const applies = (sp: Spec<unknown>, c: Ctx) => sp.when(c);

/** Lê tudo do Supabase e devolve o novo estado. */
export async function loadAll(c: SupabaseClient, base: State, ctx: Ctx): Promise<{ state: State; errors: string[] }> {
  const errors: string[] = [];
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
