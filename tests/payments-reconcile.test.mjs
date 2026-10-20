// Depósitos ClicPay: reconciliação no servidor, recuperação da referência e resposta 'pago' só depois do RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const envVars = { CLICPAY_TOKEN: 't', CLICPAY_WALLET_MPESA: '111', CLICPAY_SPLIT_MPESA: '7', PAYMENTS_LIVE: 'true' };
globalThis.Deno = { env: { get: (k) => envVars[k] } };
const { clicpay } = await import('../supabase/functions/payments/providers.ts');
const idx = readFileSync(new URL('../supabase/functions/payments/index.ts', import.meta.url), 'utf8');
const mig = readFileSync(new URL('../supabase/migrations/2026-10-20-reconcile-cron.sql', import.meta.url), 'utf8');

test('/reconcile usa o fornecedor configurado (não mpesa.queryStatus) e o mesmo event_id que /wallet-deposit-check', () => {
  const rec = idx.slice(idx.indexOf("endsWith('/reconcile')"), idx.indexOf('Webhook do agregador'));
  assert.ok(rec.includes('settleDeposit('));
  assert.ok(!rec.includes('mpesa.queryStatus'));
  assert.ok(rec.includes('2 * 60e3'));
  const chk = idx.slice(idx.indexOf("endsWith('/wallet-deposit-check')"), idx.indexOf("endsWith('/reconcile')"));
  assert.ok(chk.includes('settleDeposit('));
  const helper = idx.slice(idx.indexOf('async function settleDeposit'), idx.indexOf('Deno.serve'));
  assert.ok(helper.includes("depositProvider()"));
  assert.ok(helper.includes("'clicpay:' + st.providerRef"));
  assert.ok(helper.includes('r.ok === false'), "verifica o resultado do RPC antes de responder 'pago'");
  assert.equal((idx.match(/'reconcile:'/g) ?? []).length, 0);
});

test('migração do cron: pg_cron + pg_net a cada 2 min, segredo lido do Vault (nada escrito no ficheiro)', () => {
  assert.match(mig, /cron\.schedule\('payments-reconcile', '\*\/2 \* \* \* \*'/);
  assert.match(mig, /net\.http_post/);
  assert.match(mig, /vault\.decrypted_secrets where name = 'reconcile_secret'/);
  assert.match(mig, /'x-reconcile-secret'/);
  assert.ok(!/x-reconcile-secret',\s*'[^']/.test(mig), 'sem segredo literal');
  const page = readFileSync(new URL('../public/sql-reconcile.html', import.meta.url), 'utf8');
  assert.ok(page.includes('Copiar tudo e abrir o Supabase'));
});

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); const r = responses.shift(); return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers ?? {} }); };
  return calls;
}

test('ClicPay 409: repete com a MESMA Idempotency-Key e guarda o clicpay_reference', async () => {
  const calls = mockFetch([{ status: 409, headers: { 'retry-after': '1' } }, { status: 200, body: { clicpay_reference: 'CPAYMPESAC2B1' } }]);
  const r = await clicpay.startDeposit({ paymentId: 'abcdef12-0000', amount: 100, msisdn: '258841234567', reference: 'x', callbackUrl: '', idempotencyKey: 'key-123456789012345', method: 'M-Pesa' });
  assert.equal(r.ok, true);
  assert.equal(r.providerRef, 'CPAYMPESAC2B1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers['Idempotency-Key'], calls[1].init.headers['Idempotency-Key']);
  assert.equal(calls[0].init.body, calls[1].init.body);
});

test('findReference: só devolve a referência com exatamente uma correspondência (descrição, valor, telefone)', async () => {
  const base = { paymentId: 'abcdef12-3456', amount: 100, method: 'M-Pesa', createdAt: '2026-10-20T12:00:00Z', phoneMasked: '84•••67' };
  const row = (ref, extra = {}) => ({ clicpay_reference: ref, description: 'TXAP abcdef12', amount: '100.00', customer_msisdn: '+258841234567', ...extra });
  mockFetch([{ status: 200, body: { data: [row('R1'), row('R2', { amount: '50.00' }), row('R3', { description: 'TXAP zzzzzzzz' })] } }]);
  assert.equal(await clicpay.findReference(base), 'R1');
  mockFetch([{ status: 200, body: { data: [row('R1'), row('R2')] } }]);
  assert.equal(await clicpay.findReference(base), null, 'ambíguo → nada');
  mockFetch([{ status: 200, body: { data: [row('R1', { customer_msisdn: '+258849999999' })] } }]);
  assert.equal(await clicpay.findReference(base), null, 'telefone diferente → nada');
  mockFetch([{ status: 500 }]);
  assert.equal(await clicpay.findReference(base), null);
});
