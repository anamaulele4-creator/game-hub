// Coach IA · cliente da Edge Function "coach-ai" com fallback automático por regras.
// Qualquer falha (sem rede, função não publicada, timeout, erro) → resposta por regras. Nunca lança erro.
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { ruleAnswer } from './coachRules';
import { helpAnswer } from './poipakAI';

export type CoachRole = 'user' | 'assistant';
export interface CoachMsg { id: string; role: CoachRole; text: string; at: string; fallback?: boolean; reason?: string; failed?: boolean }
export interface CoachLimit { plan: 'free' | 'coach'; perDay: number; usedDay: number; remaining: number }
export interface CoachReply { text: string; fallback: boolean; reason?: string; limit?: CoachLimit; model?: string; networkError?: boolean }
export interface CoachHealth { reachable: boolean; configured: boolean; enabled: boolean }

const FN = `${SUPABASE_URL}/functions/v1/coach-ai`;
const sbMod = () => import('./supabase').then((m) => m.sb());

async function withTimeout(url: string, init: RequestInit, ms: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(t); }
}

export async function health(): Promise<CoachHealth> {
  if (IS_DEMO) return { reachable: false, configured: false, enabled: false };
  try {
    const r = await withTimeout(FN, { headers: { apikey: SUPABASE_ANON_KEY } }, 8000);
    if (!r.ok) return { reachable: false, configured: false, enabled: false };
    const j = await r.json();
    return { reachable: true, configured: !!j.configured, enabled: j.enabled !== false };
  } catch { return { reachable: false, configured: false, enabled: false }; }
}

async function token(): Promise<string | null> {
  try { const c = await sbMod(); const { data } = await c.auth.getSession(); return data.session?.access_token ?? null; } catch { return null; }
}

/** Pergunta ao Coach. `history` inclui a pergunta nova como última mensagem. */
export async function ask(history: { role: CoachRole; content: string }[]): Promise<CoachReply> {
  const question = history[history.length - 1]?.content ?? '';
  const local = (reason: string, networkError = false): CoachReply => ({ text: ruleAnswer(question), fallback: true, reason, networkError });
  // Perguntas sobre a própria plataforma: a TXAPILOG IA responde localmente (grátis, offline)
  const help = helpAnswer(question);
  if (help) return { text: help, fallback: true, reason: 'local' };
  if (IS_DEMO) return local('demo');
  if (typeof navigator !== 'undefined' && !navigator.onLine) return local('offline', true);
  const tk = await token();
  if (!tk) return local('no_session');
  try {
    const r = await withTimeout(FN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ messages: history.slice(-12) }),
    }, 55_000);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok || typeof j.reply !== 'string') return local(r.status === 401 ? 'no_session' : 'error', r.status >= 500 || r.status === 404);
    return { text: j.reply, fallback: !!j.fallback, reason: j.reason, limit: j.limit, model: j.model };
  } catch {
    return local('error', true);
  }
}

export async function loadRemote(): Promise<CoachMsg[]> {
  if (IS_DEMO) return [];
  try {
    const c = await sbMod();
    const { data } = await c.from('ai_messages').select('id,role,content,fallback,created_at').order('created_at', { ascending: false }).limit(40);
    return (data ?? []).reverse().map((r) => ({ id: 'r' + r.id, role: r.role as CoachRole, text: String(r.content), at: String(r.created_at), fallback: !!r.fallback }));
  } catch { return []; }
}

export async function clearRemote(): Promise<void> {
  if (IS_DEMO) return;
  try {
    const c = await sbMod();
    const { data } = await c.auth.getUser();
    if (data.user) await c.from('ai_messages').delete().eq('user_id', data.user.id);
  } catch { /* opcional */ }
}

export async function usageStats(): Promise<Record<string, unknown> | null> {
  if (IS_DEMO) return { today: 42, today_ai: 37, today_fallback: 5, users_today: 18, week: 260, total: 1290, avg_latency_ms: 2100, by_model: { 'gemini-2.5-flash': 231, regras: 29 } };
  try {
    const c = await sbMod();
    const { data, error } = await c.rpc('ai_usage_stats');
    return error ? null : (data as Record<string, unknown>);
  } catch { return null; }
}
