// Arranque: a app nunca pode ficar presa no ecrã de carregamento quando o Supabase não responde.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchWithTimeout, fetchWithRetry } from '../lib/net.ts';

test('arranque: um pedido sem resposta é cancelado pelo limite de tempo', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  try {
    const t0 = Date.now();
    await assert.rejects(fetchWithTimeout('https://x.supabase.co/rest/v1/t', {}, 50), /aborted/);
    assert.ok(Date.now() - t0 < 1000);
  } finally { globalThis.fetch = real; }
});

test('arranque: o limite de tempo respeita o signal de quem chamou e não afeta respostas rápidas', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('ok', { status: 200 });
  try {
    const r = await fetchWithRetry('https://x.supabase.co/rest/v1/t', { method: 'GET' });
    assert.equal(r.status, 200);
    const ctl = new AbortController(); ctl.abort();
    let seen;
    globalThis.fetch = async (_u, init) => { seen = init.signal.aborted; return new Response('ok'); };
    await fetchWithTimeout('https://x/y', { signal: ctl.signal }, 1000);
    assert.equal(seen, true);
  } finally { globalThis.fetch = real; }
});

test('arranque: o AuthGate mostra as páginas abertas logo e as pessoais ao fim de SPLASH_MAX_MS com sessão guardada', () => {
  const src = fs.readFileSync(new URL('../components/AuthGate.tsx', import.meta.url), 'utf8');
  assert.match(src, /SPLASH_MAX_MS = \d+/);
  assert.match(src, /if \(prot && !ready && !\(slow && s\.account\.loggedIn\)\) return <Splash \/>/);
  assert.doesNotMatch(src, /!ready && \(!slow \|\| PROTECTED/);
});

test('sem sessão: "permission denied" das funções do Supabase vira AUTH (mostra "Entra na tua conta")', () => {
  for (const f of ['lib/affiliatesApi.ts', 'lib/competitiveApi.ts']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(src, /error\.code === '42501' \|\| \/permission denied\|JWT\/i\.test\(error\.message\) \? 'AUTH'/, f);
  }
  const m = fs.readFileSync(new URL('../lib/marketApi.ts', import.meta.url), 'utf8');
  assert.match(m, /if \(!id\) return \{ listing: null/);
});
