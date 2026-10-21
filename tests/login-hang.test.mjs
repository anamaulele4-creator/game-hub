// "Palavra-passe errada mostra o erro; com a certa não acontece nada" (2026-10-21).
// Causa: uma sessão antiga guardada (expirada) estava a ser renovada numa rede presa. O supabase-js segura o cadeado da
// sessão durante a renovação, e o passo a seguir ao login (2FA: getAuthenticatorAssuranceLevel / perfil) esperava para
// sempre. Usa o cliente REAL (@supabase/auth-js) com o fetch da app (lib/net.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GoTrueClient } from '@supabase/auth-js';
import { boundedLock, dropStaleRefresh, fetchWithRetry, isTokenRefresh, REFRESH_TIMEOUT_MS } from '../lib/net.ts';
import { AUTH_STORAGE_KEY, runtimeBase, staleRefreshToken, verifiedTotp, withSoftTimeout } from '../lib/sessionCache.ts';

const URL_ = 'https://x.supabase.co/auth/v1';
const now = () => Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const oldUser = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', email: 'antiga@txapzone.test', app_metadata: {}, user_metadata: {} };
const newUser = { id: '00000000-0000-4000-8000-0000000000bb', aud: 'authenticated', email: 'dono@gmail.com', app_metadata: {}, user_metadata: {}, factors: [{ id: 'fac-1', factor_type: 'totp', status: 'verified' }] };
const ses = (user, expIn, rt) => ({ access_token: jwt({ sub: user.id, exp: now() + expIn, aal: 'aal1', amr: [{ method: 'password', timestamp: now() }] }), token_type: 'bearer', expires_in: expIn, expires_at: now() + expIn, refresh_token: rt, user });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
function memStorage(init = {}) { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; }
console.error = () => {};

/** Servidor simulado: a renovação do token NUNCA responde (só termina se for cancelada); o login com palavra-passe responde. */
function hungServer(log) {
  return (u, init) => {
    const url = String(u);
    log.push(url.replace(URL_, ''));
    if (isTokenRefresh(url)) return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (url.includes('grant_type=password')) return Promise.resolve(json(ses(newUser, 3600, 'rt-novo')));
    if (url.endsWith('/user')) return Promise.resolve(json(newUser));
    return Promise.resolve(json({}));
  };
}
function client(st) {
  return new GoTrueClient({ url: URL_, storageKey: AUTH_STORAGE_KEY, storage: st, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, fetch: fetchWithRetry });
}

test('reprodução: sem pôr a sessão antiga de lado, o 2FA depois do login fica à espera (era o "não acontece nada")', async () => {
  const log = []; globalThis.fetch = hungServer(log);
  const st = memStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(ses(oldUser, -600, 'rt-antigo')) });
  const c = client(st);
  void c.getSession(); // o arranque da app começa a renovar a sessão antiga
  await new Promise((r) => setTimeout(r, 20));
  const { error } = await c.signInWithPassword({ email: 'dono@gmail.com', password: 'certa' });
  assert.equal(error, null, 'a palavra-passe está certa');
  const aal = await withSoftTimeout(c.mfa.getAuthenticatorAssuranceLevel(), 300);
  assert.equal(aal.timedOut, true, 'o passo do 2FA não responde enquanto a renovação estiver pendurada');
  dropStaleRefresh('rt-antigo')(); // limpar (cancela a renovação pendurada; o token volta a ser aceite)
  await new Promise((r) => setTimeout(r, 50));
});

test('correção: antes de entrar, a sessão antiga é posta de lado e o login segue (2FA pedido logo)', async () => {
  const log = []; globalThis.fetch = hungServer(log);
  const st = memStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(ses(oldUser, -600, 'rt-antigo')) });
  const c = client(st);
  const events = []; c.onAuthStateChange((e) => events.push(e));
  void c.getSession();
  await new Promise((r) => setTimeout(r, 20));
  // = lib/auth.ts › freshSignIn
  const rt = staleRefreshToken(st.getItem(AUTH_STORAGE_KEY));
  assert.equal(rt, 'rt-antigo');
  const allow = dropStaleRefresh(rt);
  const settled = await withSoftTimeout(c.getSession(), 4000);
  assert.equal(settled.timedOut, false, 'o cadeado foi libertado');
  const { data, error } = await c.signInWithPassword({ email: 'dono@gmail.com', password: 'certa' });
  allow();
  assert.equal(error, null);
  assert.equal(verifiedTotp(data.user), 'fac-1', 'o próprio login diz que há 2FA');
  const aal = await withSoftTimeout(c.mfa.getAuthenticatorAssuranceLevel(), 2000);
  assert.equal(aal.timedOut, false);
  assert.equal(aal.value.data.nextLevel, 'aal2');
  assert.equal(JSON.parse(st.getItem(AUTH_STORAGE_KEY)).refresh_token, 'rt-novo', 'fica guardada a sessão nova');
  assert.ok(events.includes('SIGNED_IN'));
  assert.equal(log.filter((u) => u.includes('refresh_token')).length >= 1, true);
});

test('sessão válida (não expirada) não é tocada ao entrar de novo', () => {
  assert.equal(staleRefreshToken(JSON.stringify(ses(oldUser, 3600, 'rt-ok'))), '');
  assert.equal(staleRefreshToken(JSON.stringify(ses(oldUser, 60, 'rt-quase'))), 'rt-quase');
  assert.equal(staleRefreshToken(null), '');
  assert.equal(staleRefreshToken('lixo'), '');
  assert.equal(verifiedTotp({ factors: [{ id: 'x', factor_type: 'totp', status: 'unverified' }] }), null);
  assert.equal(verifiedTotp(null), null);
});

test('a renovação do token tem limite longo (nunca infinito) e não usa o de 20 s', () => {
  assert.ok(REFRESH_TIMEOUT_MS >= 60_000);
});

test('cadeado entre separadores: espera limitada; "só se estiver livre" (0) continua igual', async () => {
  const timeoutErr = () => Object.assign(new Error('timeout'), { isAcquireTimeout: true });
  const seen = [];
  const busy = async (name, t, fn) => { seen.push(t); if (t !== 0 && t < 0) return new Promise(() => {}); throw timeoutErr(); };
  const lock = boundedLock(busy, 50);
  assert.equal(await lock('l', -1, async () => 'correu'), 'correu', 'outro separador preso não bloqueia para sempre');
  assert.equal(seen[0], 50);
  await assert.rejects(lock('l', 0, async () => 'x'), (e) => e.isAcquireTimeout === true);
  // erros da própria operação não são repetidos
  const free = async (name, t, fn) => fn();
  await assert.rejects(boundedLock(free, 50)('l', -1, async () => { throw timeoutErr(); }));
});

test('Google e links de email voltam ao site onde a pessoa está (Vercel ou GitHub Pages)', () => {
  const F = 'https://anamaulele4-creator.github.io/game-hub';
  assert.equal(runtimeBase({ origin: 'https://txapzone.vercel.app' }, '', F), 'https://txapzone.vercel.app');
  assert.equal(runtimeBase({ origin: 'https://anamaulele4-creator.github.io' }, '/game-hub', F), F);
  assert.equal(runtimeBase(null, '', F), F);
  assert.equal(runtimeBase({ origin: 'null' }, '', F), F);
  const auth = fs.readFileSync(new URL('../lib/auth.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(auth, /redirectTo: SITE_URL/);
  assert.match(auth, /signInWithOAuth\(\{ provider: 'google', options: \{ redirectTo: authBase\(\) \+ '\/'/);
  assert.match(auth, /freshSignIn\(c, \(\) => withRetry\(\(\) => c\.auth\.signInWithPassword/);
});

test('/entrar: erro inesperado aparece no ecrã e o 2FA nunca espera para sempre', () => {
  const p = fs.readFileSync(new URL('../app/entrar/page.tsx', import.meta.url), 'utf8');
  assert.match(p, /withSoftTimeout\(\(await import\('@\/lib\/security'\)\)\.needsMfa\(\), 6000\)/);
  assert.match(p, /\} catch \(e\) \{\s*setErr\('Não foi possível concluir a entrada/);
  assert.match(p, /finally \{ setBusy\(false\); \}/);
  const store = fs.readFileSync(new URL('../lib/store.tsx', import.meta.url), 'utf8');
  assert.match(store, /const gen = \+\+loadGen\.current;/);
  assert.match(store, /if \(gen !== loadGen\.current\) return;\s*setS\(/);
});
