// Recarregar a página com sessão iniciada: a pessoa continua com sessão, mesmo com rede lenta.
// Usa o cliente de autenticação REAL do supabase-js (@supabase/auth-js) com o fetch da app (lib/net.ts) e um servidor simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GoTrueClient } from '@supabase/auth-js';
import { fetchWithRetry, isTokenRefresh } from '../lib/net.ts';
import { AUTH_STORAGE_KEY, ME_KEY, readIdentity, readStoredSession, resolveBoot, retryDelay, saveIdentitySnapshot, withSoftTimeout } from '../lib/sessionCache.ts';

const URL_ = 'https://x.supabase.co/auth/v1';
const uid = '00000000-0000-4000-8000-000000000abc';
const user = { id: uid, aud: 'authenticated', email: 'joga@txapzone.test', app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Joga Bem', avatar_url: 'https://x/a.png' } };
const now = () => Math.floor(Date.now() / 1000);
const ses = (expIn, rt = 'rt-1') => ({ access_token: 'at-' + rt, token_type: 'bearer', expires_in: expIn, expires_at: now() + expIn, refresh_token: rt, user });

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
/** Um "recarregamento": cliente novo a ler a mesma storage (como o browser ao abrir a página). */
function boot(storage) {
  const events = [];
  const c = new GoTrueClient({ url: URL_, storageKey: AUTH_STORAGE_KEY, storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, fetch: fetchWithRetry });
  c.onAuthStateChange((ev) => events.push(ev));
  return { c, events };
}
// Nunca ir à rede real neste ficheiro (pedidos que fiquem pendurados de um cliente antigo falham logo, offline).
const OFFLINE = async () => { throw new TypeError('offline (teste)'); };
globalThis.fetch = OFFLINE;
console.error = () => {}; // o auth-js escreve os erros de rede na consola
async function withFetch(fn, body) {
  globalThis.fetch = fn;
  try { return await body(); } finally { globalThis.fetch = OFFLINE; }
}
// Relógio: o auth-js repete a renovação durante 30 s; avançar o relógio a cada falha mantém o teste rápido.
const realNow = Date.now; let skew = 0;
Date.now = () => realNow() + skew;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

test('sessão guardada: lida de forma síncrona, com nome/@ só da mesma conta', () => {
  const st = memStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(ses(3600)) });
  const s = readStoredSession(st);
  assert.equal(s.uid, uid); assert.equal(s.email, 'joga@txapzone.test'); assert.equal(s.name, 'Joga Bem');
  assert.equal(readIdentity(st).handle, '');
  saveIdentitySnapshot({ uid, name: 'Joga', avatar: '🎮', handle: '@joga' }, st);
  assert.deepEqual([readIdentity(st).name, readIdentity(st).handle], ['Joga', '@joga']);
  // outra conta no mesmo navegador: não mostra o nome da anterior
  st.setItem(ME_KEY, JSON.stringify({ uid: 'outra', name: 'Outra', handle: '@outra' }));
  assert.equal(readIdentity(st).handle, ''); assert.equal(readIdentity(st).name, 'Joga Bem');
  // sem sessão / sessão inválida / lixo
  assert.equal(readStoredSession(memStorage()), null);
  assert.equal(readStoredSession(memStorage({ [AUTH_STORAGE_KEY]: '{"access_token":"a"}' })), null);
  assert.equal(readStoredSession(memStorage({ [AUTH_STORAGE_KEY]: 'not json' })), null);
});

test('arranque: decisão e novas tentativas', async () => {
  const stored = { uid };
  assert.equal(resolveBoot({ session: { user }, stored }), 'signed-in');
  assert.equal(resolveBoot({ session: null, stored }), 'pending');
  assert.equal(resolveBoot({ session: null, stored: null }), 'signed-out');
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelay), [2000, 4000, 8000, 16000, 30000, 30000]);
  const slow = new Promise((r) => setTimeout(() => r('fim'), 200));
  assert.deepEqual(await withSoftTimeout(slow, 20), { timedOut: true });
  assert.deepEqual(await withSoftTimeout(Promise.resolve(1), 1000), { timedOut: false, value: 1 });
  assert.equal(await slow, 'fim'); // não foi cancelada
});

test('recarregar com sessão válida: getSession devolve-a sem ir à rede', async () => {
  const st = memStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(ses(3600)) });
  let calls = 0;
  await withFetch(async () => { calls++; return json({}); }, async () => {
    const { c } = boot(st);
    const { data } = await c.getSession();
    assert.equal(data.session.user.id, uid);
    assert.equal(calls, 0);
    c.stopAutoRefresh();
  });
});

test('rede lenta: a renovação do token não é cancelada pelo limite de tempo e a sessão nunca é apagada', async () => {
  assert.ok(isTokenRefresh(`${URL_}/token?grant_type=refresh_token`));
  assert.ok(!isTokenRefresh(`${URL_}/token?grant_type=password`));
  const st = memStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(ses(-600, 'rt-old')) });
  const seen = [];
  await withFetch(async (u, init) => {
    seen.push({ u: String(u), signal: init?.signal });
    await new Promise((r) => setTimeout(r, 300)); // rede lenta
    return json(ses(3600, 'rt-new'));
  }, async () => {
    const { c, events } = boot(st);
    // a app espera pouco e continua com a sessão guardada
    const got = await withSoftTimeout(c.getSession(), 30);
    assert.equal(got.timedOut, true);
    assert.equal(resolveBoot({ session: null, stored: readStoredSession(st) }), 'pending');
    assert.equal(readIdentity(st).uid, uid, 'a pessoa continua com sessão iniciada');
    // a resposta chega mais tarde: sessão renovada e guardada, sem SIGNED_OUT
    const { data } = await c.getSession();
    assert.equal(data.session.refresh_token, 'rt-new');
    assert.equal(JSON.parse(st.getItem(AUTH_STORAGE_KEY)).refresh_token, 'rt-new');
    assert.ok(!events.includes('SIGNED_OUT'));
    assert.ok(events.includes('TOKEN_REFRESHED'));
    c.stopAutoRefresh();
  });
  const refresh = seen.filter((x) => isTokenRefresh(x.u));
  assert.equal(refresh.length, 1, 'uma só renovação (sem repetir com o token antigo)');
  assert.equal(refresh[0].signal, undefined, 'sem AbortController do limite de tempo');
});

test('sem rede: a renovação falha mas a sessão guardada fica (pendente, tenta de novo depois)', async () => {
  const st = memStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(ses(-600, 'rt-old')) });
  await withFetch(async () => { skew += 31_000; throw new TypeError('Failed to fetch'); }, async () => {
    const { c, events } = boot(st);
    const { data } = await c.getSession();
    assert.equal(data.session, null);
    assert.equal(resolveBoot({ session: null, stored: readStoredSession(st) }), 'pending');
    assert.ok(st.getItem(AUTH_STORAGE_KEY), 'sessão continua guardada');
    assert.ok(!events.includes('SIGNED_OUT'));
    c.stopAutoRefresh();
  });
  // a rede volta: nova tentativa renova a sessão
  await withFetch(async () => json(ses(3600, 'rt-new')), async () => {
    const { c } = boot(st);
    const { data } = await c.getSession();
    assert.equal(data.session.refresh_token, 'rt-new');
    c.stopAutoRefresh();
  });
});

test('refresh token recusado pelo servidor: aí sim, termina a sessão (vai para /entrar)', async () => {
  const st = memStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(ses(-600, 'rt-revogado')), [ME_KEY]: JSON.stringify({ uid, handle: '@joga' }) });
  await withFetch(async () => json({ code: 'refresh_token_not_found', error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' }, 400), async () => {
    const { c, events } = boot(st);
    await c.getSession();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(st.getItem(AUTH_STORAGE_KEY), null, 'o supabase-js apagou a sessão');
    assert.equal(resolveBoot({ session: null, stored: readStoredSession(st) }), 'signed-out');
    assert.ok(events.includes('SIGNED_OUT'));
    c.stopAutoRefresh();
  });
});

test('UI: cabeçalho e portão usam a sessão guardada; /entrar só quando se sabe que não há sessão', () => {
  const gate = fs.readFileSync(new URL('../components/AuthGate.tsx', import.meta.url), 'utf8');
  assert.match(gate, /if \(ready && !allowed\)/);
  assert.match(gate, /if \(prot && !ready && !\(slow && s\.account\.loggedIn\)\) return <Splash \/>/);
  assert.match(gate, /if \(ready && s\.account\.loggedIn && !s\.account\.birth\) return <BirthGate \/>/);
  const hdr = fs.readFileSync(new URL('../components/SiteHeader.tsx', import.meta.url), 'utf8');
  assert.match(hdr, /const logged = mounted && \(IS_DEMO \|\| s\.account\.loggedIn\);/);
  const store = fs.readFileSync(new URL('../lib/store.tsx', import.meta.url), 'utf8');
  assert.match(store, /useBrowserLayoutEffect\(\(\) => \{\s*if \(IS_DEMO\) return;\s*const id = readIdentity\(\);/);
  assert.match(store, /=== 'pending'\) \{/);
  assert.match(store, /ev === 'TOKEN_REFRESHED' && authPending\.current/);
  assert.match(store, /if \(!pending\) setReady\(true\)/);
  // HTML estático: com sessão guardada, "Criar Conta / Entrar" fica escondido até o JS carregar
  const layout = fs.readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /localStorage\.getItem\('gamehub-auth'\)[^\n]*refresh_token[^\n]*setAttribute\('data-auth','1'\)/);
  const css = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-auth="1"\] \.auth-guest \{ display: none !important; \}/);
  assert.match(hdr, /setAttribute\('data-auth', logged \? '1' : '0'\)/);
  assert.equal((hdr.match(/className="auth-guest /g) || []).length, 2);
  // a função (admin/moderador) nunca vem da cache
  assert.doesNotMatch(fs.readFileSync(new URL('../lib/sessionCache.ts', import.meta.url), 'utf8'), /role:/);
});
