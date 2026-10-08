// Autenticação do Social POIPAK.
// - MODO DEMO (sem NEXT_PUBLIC_SUPABASE_URL/ANON_KEY no build): códigos OTP gerados no navegador e MOSTRADOS NO ECRÃ.
// - MODO REAL: Supabase Auth via @supabase/supabase-js (email + palavra-passe, email OTP / link mágico, SMS OTP).
//   Email: grátis no Supabase (limite baixo de envios com o SMTP incluído → configurar SMTP próprio para produção).
//   SMS OTP: exige fornecedor de SMS PAGO (Twilio, MessageBird, Vonage, Textlocal) em Auth → Providers → Phone.
// Fiabilidade: repetição com backoff exponencial em falhas de rede/5xx/429, mensagens de erro claras em português,
// e limitação de pedidos no cliente (o Supabase também limita no servidor: Auth → Rate Limits).

import { IS_DEMO, MIN_AGE, SITE_URL } from './config';
import { sb } from './supabase';

export type Channel = 'email' | 'phone';
export interface Session { access_token: string; refresh_token?: string; user: { id: string; email?: string; phone?: string } }
export interface AuthResult { ok: boolean; error?: string; demoCode?: string; session?: Session; needsConfirm?: boolean; retryAfter?: number }

const SESSION_KEY = 'gamehub-session';
const OTP_KEY = 'gamehub-demo-otp';
const RL_KEY = 'gamehub-auth-rl';

// ---------- Validação ----------
export function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/** Normaliza números moçambicanos para E.164 (+2588XXXXXXXX). Aceita 84 123 4567, 258841234567, +258 84… */
export function normalizePhone(v: string): string | null {
  let d = v.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && /^8[2-7]/.test(d)) d = '258' + d;
  if (/^2588[2-7]\d{7}$/.test(d)) return '+' + d;
  if (/^\d{8,15}$/.test(d) && !d.startsWith('258')) return '+' + d;
  return null;
}

import { ageFrom } from './age';
export { ageFrom };
export function meetsAgeGate(birth: string) { return ageFrom(birth) >= MIN_AGE; }

// ---------- Limitação de pedidos (cliente) ----------
// OTP: 1 pedido / 60 s por destino e máx. 5 / hora. Registo: máx. 3 / hora por dispositivo. Login: máx. 10 / 15 min.
const LIMITS: Record<string, { max: number; windowMs: number; cooldownMs: number }> = {
  otp: { max: 5, windowMs: 3600_000, cooldownMs: 60_000 },
  signup: { max: 3, windowMs: 3600_000, cooldownMs: 20_000 },
  login: { max: 10, windowMs: 900_000, cooldownMs: 0 },
  recover: { max: 3, windowMs: 3600_000, cooldownMs: 60_000 },
};
function rateCheck(kind: keyof typeof LIMITS, target: string): number {
  if (typeof window === 'undefined') return 0;
  const l = LIMITS[kind];
  const now = Date.now();
  let all: Record<string, number[]> = {};
  try { all = JSON.parse(localStorage.getItem(RL_KEY) || '{}'); } catch {}
  const k = `${kind}:${target}`;
  const hits = (all[k] ?? []).filter((t) => now - t < l.windowMs);
  const last = hits[hits.length - 1] ?? 0;
  if (l.cooldownMs && now - last < l.cooldownMs) return Math.ceil((l.cooldownMs - (now - last)) / 1000);
  if (hits.length >= l.max) return Math.ceil((l.windowMs - (now - hits[0])) / 1000);
  hits.push(now);
  all[k] = hits;
  try { localStorage.setItem(RL_KEY, JSON.stringify(all)); } catch {}
  return 0;
}
function limited(sec: number): AuthResult {
  const t = sec >= 120 ? `${Math.ceil(sec / 60)} min` : `${sec} s`;
  return { ok: false, error: `Demasiados pedidos. Tenta novamente daqui a ${t}.`, retryAfter: sec };
}

// ---------- Erros claros ----------
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; status?: number; code?: string } | undefined;
  const m = (err?.message || '').toLowerCase();
  const st = err?.status ?? 0;
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) return 'Sem ligação à internet. Verifica os dados móveis ou o Wi-Fi e tenta de novo.';
  if (st === 429 || m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) return 'Demasiadas tentativas. Aguarda um minuto e tenta de novo.';
  if (m.includes('invalid login credentials')) return 'Email/telemóvel ou palavra-passe incorretos.';
  if (m.includes('email not confirmed')) return 'Confirma primeiro o teu email (vê a caixa de entrada e o spam).';
  if (m.includes('phone not confirmed')) return 'Confirma primeiro o teu número com o código SMS.';
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already exists')) return 'Já existe uma conta com este contacto. Entra ou recupera a palavra-passe.';
  if (m.includes('duplicate key') && m.includes('handle')) return 'Esse nome de utilizador já está ocupado. Escolhe outro.';
  if (m.includes('token has expired') || m.includes('expired')) return 'O código expirou. Pede um novo.';
  if (m.includes('invalid') && (m.includes('otp') || m.includes('token'))) return 'Código incorreto. Confirma os 6 dígitos.';
  if (m.includes('password should be') || m.includes('weak password')) return 'Palavra-passe fraca: usa pelo menos 8 caracteres com letras e números.';
  if (m.includes('signups not allowed for otp') || err?.code === 'otp_disabled') return 'Ainda não existe conta com este contacto. Toca em "Criar conta" primeiro.';
  if (m.includes('phone signups are disabled') || m.includes('unsupported phone provider') || err?.code === 'phone_provider_disabled') return 'O envio de SMS ainda não está ativo. Usa o email por agora.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'Os registos estão temporariamente fechados.';
  if (m.includes('sms') || m.includes('phone provider')) return 'O envio de SMS ainda não está ativo. Usa o email por agora.';
  if (m.includes('user not found')) return 'Não encontrámos nenhuma conta com esse contacto.';
  if (st >= 500) return 'O servidor está ocupado. Tentámos várias vezes — tenta de novo daqui a pouco.';
  return err?.message || 'Algo correu mal. Tenta de novo.';
}

const retriable = (e: unknown) => {
  const x = e as { message?: string; status?: number } | undefined;
  const m = (x?.message || '').toLowerCase();
  return !x?.status || x.status >= 500 || x.status === 429 || m.includes('fetch') || m.includes('network');
};

/** Repete com backoff exponencial + jitter (0,5 s → 1 s → 2 s) em falhas de rede/5xx/429. */
export async function withRetry<T extends { error: unknown }>(fn: () => PromiseLike<T>, tries = 3): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < tries; i++) {
    try {
      last = await fn();
      if (!last.error || !retriable(last.error)) return last;
    } catch (e) {
      last = { error: e } as T;
      if (!retriable(e)) return last;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i + Math.random() * 250));
  }
  return last!;
}

function toSession(s: { access_token: string; refresh_token?: string; user: { id: string; email?: string; phone?: string } } | null | undefined): Session | undefined {
  return s ? { access_token: s.access_token, refresh_token: s.refresh_token, user: { id: s.user.id, email: s.user.email, phone: s.user.phone } } : undefined;
}

// ---------- Demo ----------
function demoIssue(target: string): AuthResult {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  try { sessionStorage.setItem(OTP_KEY, JSON.stringify({ target, code, exp: Date.now() + 10 * 60000 })); } catch {}
  return { ok: true, demoCode: code };
}
function demoVerify(target: string, code: string): AuthResult {
  try {
    const x = JSON.parse(sessionStorage.getItem(OTP_KEY) || 'null');
    if (!x || x.target !== target) return { ok: false, error: 'Pede um novo código.' };
    if (Date.now() > x.exp) return { ok: false, error: 'Código expirado. Pede outro.' };
    if (x.code !== code.trim()) return { ok: false, error: 'Código incorreto.' };
    sessionStorage.removeItem(OTP_KEY);
  } catch { return { ok: false, error: 'Erro ao validar.' }; }
  const session: Session = { access_token: 'demo-' + Date.now(), user: { id: 'demo-user', ...(target.includes('@') ? { email: target } : { phone: target }) } };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  return { ok: true, session };
}
export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

// ---------- API pública ----------

/** Registo idempotente: repetir o mesmo pedido não cria contas duplicadas (unicidade no Supabase Auth + profiles). */
export async function signUp(channel: Channel, id: string, password: string, meta: Record<string, unknown>): Promise<AuthResult> {
  const wait = rateCheck('signup', id);
  if (wait) return limited(wait);
  if (IS_DEMO) return demoIssue(channel === 'email' ? id.trim().toLowerCase() : id);
  const c = await sb();
  const r = await withRetry(() => (channel === 'email'
    ? c.auth.signUp({ email: id, password, options: { data: meta, emailRedirectTo: SITE_URL + '/confirmar/' } })
    : c.auth.signUp({ phone: id, password, options: { data: meta, channel: 'sms' } })));
  if (r.error) return { ok: false, error: friendlyError(r.error) };
  // Supabase devolve user sem identities quando o contacto já existe (proteção contra enumeração)
  if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) return { ok: false, error: friendlyError({ message: 'already registered' }) };
  return { ok: true, session: toSession(r.data.session), needsConfirm: !r.data.session };
}
export const signUpEmail = (email: string, pw: string, meta: Record<string, unknown>) => signUp('email', email, pw, meta);
export const signUpPhone = (phone: string, pw: string, meta: Record<string, unknown>) => signUp('phone', phone, pw, meta);

export async function signInPassword(channel: Channel, id: string, password: string): Promise<AuthResult> {
  const wait = rateCheck('login', id);
  if (wait) return limited(wait);
  if (IS_DEMO) {
    if (password.length < 6) return { ok: false, error: 'Palavra-passe com pelo menos 6 caracteres.' };
    const session: Session = { access_token: 'demo-' + Date.now(), user: { id: 'demo-user', [channel === 'email' ? 'email' : 'phone']: id } };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
    return { ok: true, session };
  }
  const c = await sb();
  const r = await withRetry(() => c.auth.signInWithPassword(channel === 'email' ? { email: id, password } : { phone: id, password }));
  return r.error ? { ok: false, error: friendlyError(r.error) } : { ok: true, session: toSession(r.data.session) };
}

/** Envia código de 6 dígitos (email OTP — o email também traz link mágico) ou SMS OTP. */
export async function sendOtp(channel: Channel, id: string, createUser = false): Promise<AuthResult> {
  const wait = rateCheck('otp', id);
  if (wait) return limited(wait);
  if (IS_DEMO) return demoIssue(channel === 'email' ? id.trim().toLowerCase() : id);
  const c = await sb();
  const r = await withRetry(() => (channel === 'email'
    ? c.auth.signInWithOtp({ email: id, options: { shouldCreateUser: createUser, emailRedirectTo: SITE_URL + '/' } })
    : c.auth.signInWithOtp({ phone: id, options: { shouldCreateUser: createUser, channel: 'sms' } })));
  return r.error ? { ok: false, error: friendlyError(r.error) } : { ok: true };
}

export async function verifyOtp(channel: Channel, id: string, token: string, purpose: 'signup' | 'login' | 'recovery' = 'login'): Promise<AuthResult> {
  if (IS_DEMO) return demoVerify(channel === 'email' ? id.trim().toLowerCase() : id, token);
  const c = await sb();
  const r = await withRetry(() => (channel === 'phone'
    ? c.auth.verifyOtp({ phone: id, token, type: 'sms' })
    : c.auth.verifyOtp({ email: id, token, type: purpose === 'signup' ? 'signup' : purpose === 'recovery' ? 'recovery' : 'email' })));
  return r.error ? { ok: false, error: friendlyError(r.error) } : { ok: true, session: toSession(r.data.session) };
}

/** Reenvia a confirmação de registo (email com link+código, ou SMS). */
export async function resendConfirmation(channel: Channel, id: string): Promise<AuthResult> {
  const wait = rateCheck('otp', 'confirm:' + id);
  if (wait) return limited(wait);
  if (IS_DEMO) return demoIssue(channel === 'email' ? id.trim().toLowerCase() : id);
  const c = await sb();
  const r = await withRetry(() => (channel === 'email'
    ? c.auth.resend({ type: 'signup', email: id, options: { emailRedirectTo: SITE_URL + '/' } })
    : c.auth.resend({ type: 'sms', phone: id })));
  return r.error ? { ok: false, error: friendlyError(r.error) } : { ok: true };
}

/** Recuperação por link no email → abre /recuperar/ com sessão de recuperação. */
export async function sendRecoveryLink(email: string): Promise<AuthResult> {
  const wait = rateCheck('recover', email);
  if (wait) return limited(wait);
  if (IS_DEMO) return demoIssue(email.trim().toLowerCase());
  const c = await sb();
  const r = await withRetry(() => c.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL + '/recuperar/' }));
  return r.error ? { ok: false, error: friendlyError(r.error) } : { ok: true };
}

export async function updatePassword(password: string): Promise<AuthResult> {
  if (IS_DEMO) return password.length >= 6 ? { ok: true } : { ok: false, error: 'Mínimo 6 caracteres.' };
  const c = await sb();
  const r = await withRetry(() => c.auth.updateUser({ password }));
  return r.error ? { ok: false, error: friendlyError(r.error) } : { ok: true };
}

export async function signOut() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  if (!IS_DEMO) { const c = await sb(); await c.auth.signOut(); }
}

/** Sessão atual (modo real). */
export async function currentSession(): Promise<Session | null> {
  if (IS_DEMO) return getSession();
  const c = await sb();
  const { data } = await c.auth.getSession();
  return toSession(data.session) ?? null;
}

/** Eliminação de conta: Edge Function `delete-account` (usa service role no servidor). */
export async function deleteAccount(reason: string): Promise<AuthResult> {
  if (IS_DEMO) { try { localStorage.removeItem(SESSION_KEY); } catch {} return { ok: true }; }
  const c = await sb();
  const r = await withRetry(() => c.functions.invoke('delete-account', { body: { reason } }));
  if (r.error) return { ok: false, error: friendlyError(r.error) };
  await c.auth.signOut();
  return { ok: true };
}

/** Pedido público de eliminação (sem sessão) — insere em public.deletion_requests (RLS permite insert anónimo). */
export async function requestDeletionPublic(contact: string, handle: string, reason: string): Promise<AuthResult> {
  if (IS_DEMO) {
    try {
      const list = JSON.parse(localStorage.getItem('gamehub-deletion-requests') || '[]');
      list.unshift({ contact, handle, reason, at: new Date().toISOString() });
      localStorage.setItem('gamehub-deletion-requests', JSON.stringify(list));
    } catch {}
    return { ok: true };
  }
  const wait = rateCheck('recover', 'del:' + contact);
  if (wait) return limited(wait);
  const c = await sb();
  const r = await withRetry(() => c.from('deletion_requests').insert({ contact, handle, reason }));
  return r.error ? { ok: false, error: friendlyError(r.error) } : { ok: true };
}

// ---------- Google (OAuth) ----------
export const GOOGLE_OFF_MSG = 'Entrar com Google ainda não está ativo. Usa outra opção.';

/** O fornecedor Google está ligado no Supabase? (GET /auth/v1/settings → external.google). Em caso de dúvida devolve null. */
async function googleEnabled(): Promise<boolean | null> {
  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('./config');
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const j = await r.json();
    return !!j?.external?.google;
  } catch { return null; }
}

/** Redireciona para o Google. Volta a SITE_URL/ com a sessão no endereço (#access_token… ou ?code=…), tratada por consumeAuthRedirect(). */
export async function signInWithGoogle(next?: string, loginHint?: string): Promise<AuthResult> {
  if (IS_DEMO) return { ok: false, error: 'No modo demonstração usa email ou telemóvel.' };
  const on = await googleEnabled();
  if (on === false) return { ok: false, error: GOOGLE_OFF_MSG };
  try {
    if (next && next !== '/') sessionStorage.setItem('gh-auth-next', next);
    const c = await sb();
    const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: SITE_URL + '/', queryParams: { prompt: 'select_account', ...(loginHint && loginHint.includes('@') ? { login_hint: loginHint } : {}) } } });
    if (error) return { ok: false, error: /not enabled|unsupported provider|provider is not/i.test(error.message) ? GOOGLE_OFF_MSG : friendlyError(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: /not enabled|unsupported provider/i.test(String((e as Error)?.message)) ? GOOGLE_OFF_MSG : friendlyError(e) };
  }
}

/**
 * Chamado no arranque (modo real), antes de ler a sessão: trata o regresso do Google/links de email.
 * - #access_token=… (fluxo implícito, o deste cliente): o supabase-js lê-o sozinho (detectSessionInUrl) ao inicializar.
 * - ?code=… (fluxo PKCE): troca o código pela sessão.
 * - #error=… / ?error=…: devolve uma mensagem amigável.
 * Guarda também a sessão na chave 'gamehub-session' (como os outros métodos de entrada) e limpa o endereço.
 */
export async function consumeAuthRedirect(): Promise<{ error?: string; next?: string; signedIn?: boolean }> {
  if (IS_DEMO || typeof window === 'undefined') return {};
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const code = url.searchParams.get('code');
  const errDesc = hash.get('error_description') || url.searchParams.get('error_description') || hash.get('error') || url.searchParams.get('error');
  if (!code && !errDesc && !hash.get('access_token')) return {};
  const out: { error?: string; next?: string; signedIn?: boolean } = {};
  try {
    const c = await sb();
    if (code) {
      const { error } = await c.auth.exchangeCodeForSession(code);
      if (error && !/already|used|verifier/i.test(error.message)) out.error = friendlyError(error);
    }
    const { data } = await c.auth.getSession(); // aguarda a deteção de #access_token
    const s = toSession(data.session);
    if (s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} out.signedIn = true; }
    if (errDesc && !s) out.error = /provider is not enabled|unsupported provider/i.test(errDesc) ? GOOGLE_OFF_MSG : 'Não foi possível entrar: ' + decodeURIComponent(errDesc.replace(/\+/g, ' '));
  } catch (e) { out.error = friendlyError(e); }
  try { out.next = sessionStorage.getItem('gh-auth-next') || undefined; sessionStorage.removeItem('gh-auth-next'); } catch {}
  // Limpa o endereço (tokens/código não ficam no histórico)
  try {
    url.hash = '';
    ['code', 'error', 'error_code', 'error_description', 'state'].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(window.history.state, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  } catch {}
  return out;
}

/** Guarda a data de nascimento (contas criadas pelo Google não a têm). Abaixo da idade mínima: termina a sessão. */
export async function saveBirthDate(birth: string): Promise<AuthResult> {
  if (!meetsAgeGate(birth)) { await signOut().catch(() => {}); return { ok: false, error: `O Social POIPAK exige pelo menos ${MIN_AGE} anos.` }; }
  if (IS_DEMO) return { ok: true };
  const c = await sb();
  const { data } = await c.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return { ok: false, error: 'Sessão expirada. Entra outra vez.' };
  const r = await withRetry(() => c.from('profiles').update({ birth_date: birth }).eq('id', uid));
  return r.error ? { ok: false, error: friendlyError(r.error) } : { ok: true };
}
