// Monetização de criadores: candidatura, ganhos (livro-razão), membros, presentes, saldo e levantamentos.
import { IS_DEMO } from './config';
import { friendlyError } from './auth';

export interface MonRules { minFollowers: number; minWatchHours: number; minAge: number; coinValueMzn: number; giftCreatorPct: number; subCreatorPct: number; adsCreatorPct: number; tournamentFeePct: number; minPayoutMzn: number }
export const DEFAULT_RULES: MonRules = { minFollowers: 1000, minWatchHours: 100, minAge: 18, coinValueMzn: 0.5, giftCreatorPct: 70, subCreatorPct: 80, adsCreatorPct: 50, tournamentFeePct: 15, minPayoutMzn: 200 };
export interface Earning { at: string; source: 'presente' | 'subscricao' | 'anuncios' | 'torneio' | 'ajuste'; gross: number; fee: number; net: number }
export interface PayoutRow { id: string; amount: number; method: string; status: string; at: string }
export interface MonState { approved: boolean; application?: { status: string; note?: string; at: string }; followers: number; watchHours: number; balance: number; earnings: Earning[]; payouts: PayoutRow[]; members: number; subPrice: number; rules: MonRules }

const sbMod = () => import('./supabase').then((m) => m.sb());
const DK = 'gamehub-mon-demo-v1';

function demoState(): MonState {
  try { const r = localStorage.getItem(DK); if (r) return JSON.parse(r); } catch {}
  const now = Date.now();
  const e = (d: number, source: Earning['source'], gross: number, pct: number): Earning => ({ at: new Date(now - d * 86400000).toISOString(), source, gross, fee: +(gross * (100 - pct) / 100).toFixed(2), net: +(gross * pct / 100).toFixed(2) });
  const earnings = [e(1, 'presente', 420, 70), e(2, 'subscricao', 990, 80), e(3, 'anuncios', 310, 100), e(5, 'presente', 760, 70), e(8, 'torneio', 3000, 100), e(10, 'subscricao', 891, 80)];
  const st: MonState = { approved: true, followers: 2380, watchHours: 164, balance: 0, earnings, payouts: [{ id: 'p0', amount: 1500, method: 'M-Pesa 84•••21', status: 'pago', at: new Date(now - 6 * 86400000).toISOString() }], members: 23, subPrice: 99, rules: DEFAULT_RULES };
  st.balance = +(earnings.reduce((t, x) => t + x.net, 0) - 1500).toFixed(2);
  return st;
}
function saveDemo(s: MonState) { try { localStorage.setItem(DK, JSON.stringify(s)); } catch {} }

export async function load(): Promise<MonState | null> {
  if (IS_DEMO) return demoState();
  const c = await sbMod();
  const { data: u } = await c.auth.getUser();
  if (!u.user) return null;
  const id = u.user.id;
  const [prof, app, prog, earn, pays, mem, bal, ps] = await Promise.all([
    c.from('profiles').select('followers_count').eq('id', id).maybeSingle(),
    c.from('creator_applications').select('status,note,created_at,watch_hours').eq('user_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    c.from('creator_programs').select('active,sub_price_mzn').eq('creator_id', id).maybeSingle(),
    c.from('creator_earnings').select('created_at,source,gross_mzn,platform_fee_mzn,net_mzn').eq('creator_id', id).order('created_at', { ascending: false }).limit(500),
    c.from('payouts').select('id,amount_mzn,method,status,created_at').eq('creator_id', id).order('created_at', { ascending: false }).limit(50),
    c.from('fan_subscriptions').select('id', { count: 'exact', head: true }).eq('creator_id', id).eq('status', 'ativa'),
    c.rpc('creator_balance', { p_user: id }),
    c.from('platform_settings').select('data').eq('id', 1).maybeSingle(),
  ]);
  return {
    approved: !!prog.data?.active, application: app.data ? { status: app.data.status, note: app.data.note ?? undefined, at: app.data.created_at } : undefined,
    followers: prof.data?.followers_count ?? 0, watchHours: Number(app.data?.watch_hours ?? 0), balance: Number(bal.data ?? 0),
    earnings: (earn.data ?? []).map((r) => ({ at: r.created_at, source: r.source, gross: Number(r.gross_mzn), fee: Number(r.platform_fee_mzn), net: Number(r.net_mzn) })),
    payouts: (pays.data ?? []).map((r) => ({ id: r.id, amount: r.amount_mzn, method: r.method, status: r.status, at: r.created_at })),
    members: mem.count ?? 0, subPrice: prog.data?.sub_price_mzn ?? 99, rules: { ...DEFAULT_RULES, ...((ps.data?.data as { monetization?: Partial<MonRules> })?.monetization ?? {}) },
  };
}

export async function apply(category: string, pitch: string): Promise<{ ok: boolean; error?: string }> {
  if (IS_DEMO) { const s = demoState(); s.application = { status: 'pendente', at: new Date().toISOString() }; saveDemo(s); return { ok: true }; }
  const c = await sbMod();
  const { error } = await c.rpc('apply_creator', { p_category: category, p_pitch: pitch });
  return error ? { ok: false, error: friendlyError(error) } : { ok: true };
}

export async function setSubPrice(price: number): Promise<{ ok: boolean; error?: string }> {
  if (price < 25 || price > 5000) return { ok: false, error: 'Entre 25 e 5000 MZN.' };
  if (IS_DEMO) { const s = demoState(); s.subPrice = price; saveDemo(s); return { ok: true }; }
  const c = await sbMod();
  const { data: u } = await c.auth.getUser();
  const { error } = await c.from('creator_programs').update({ sub_price_mzn: price }).eq('creator_id', u.user?.id ?? '');
  return error ? { ok: false, error: friendlyError(error) } : { ok: true };
}

/** Envia presente/doação em moedas a um criador (live, clipe ou perfil). */
export async function sendGift(creatorId: string, kind: 'live' | 'clipe' | 'perfil', targetId: string, giftId: string, coins: number): Promise<{ ok: boolean; error?: string; coins?: number }> {
  if (IS_DEMO) return { ok: true };
  const c = await sbMod();
  const { data, error } = await c.rpc('send_gift', { p_creator: creatorId, p_target_kind: kind, p_target_id: targetId, p_gift: giftId, p_coins: coins });
  return error ? { ok: false, error: friendlyError(error) } : { ok: true, coins: data?.coins };
}

export function demoRecordPayout(amount: number, method: string) {
  if (!IS_DEMO) return;
  const s = demoState();
  s.payouts.unshift({ id: 'p' + Date.now(), amount, method, status: amount > 10000 ? 'em revisão' : 'pendente', at: new Date().toISOString() });
  s.balance = +(s.balance - amount).toFixed(2);
  saveDemo(s);
}
