// Marketplace 3.0 — regras puras (lib/mkt3.ts), sincronização cliente/servidor, página do SQL e verificações estáticas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  V3_EDGES, edgeOk, sellerActions, buyerActions, commissionAmount, toCsv, pushHistory, slugify, validSlug, validYoutube, errText, PERMISSIONS, ORDER_STATUS, mzPhone,
} from '../lib/mkt3.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MIG = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^2026-10-21-mkt3-0\d-/.test(f)).sort();

test('mkt3: transições do cliente = transições do servidor (mkt__edge_ok)', () => {
  const sql = read('supabase/migrations/' + MIG.find((f) => f.includes('-03-')));
  const body = sql.slice(sql.indexOf('function public.mkt__edge_ok'), sql.indexOf('$$;', sql.indexOf('function public.mkt__edge_ok')));
  const pairs = [...body.matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  assert.deepEqual(V3_EDGES.map(([a, b]) => `${a}>${b}`).sort(), pairs);
  for (const [a, b] of V3_EDGES) { assert.ok(ORDER_STATUS[a] && ORDER_STATUS[b]); }
  assert.equal(edgeOk('pago', 'concluido'), false, 'não se conclui sem entrega');
  assert.equal(edgeOk('concluido', 'reembolsado'), false, 'concluído é final');
});

test('mkt3: ações visíveis por papel e tipo de produto', () => {
  assert.deepEqual(sellerActions({ status: 'pago', kind: 'itens', physical: false }), ['preparar', 'entregar', 'cancelar_venda']);
  assert.deepEqual(sellerActions({ status: 'pago', kind: 'itens', physical: true }), ['preparar', 'enviar', 'cancelar_venda']);
  assert.deepEqual(sellerActions({ status: 'enviado', kind: 'itens', physical: true }), ['entregar']);
  assert.deepEqual(sellerActions({ status: 'pago', kind: 'servico' }), ['iniciar', 'entregar', 'cancelar_venda']);
  assert.deepEqual(sellerActions({ status: 'aguarda_pagamento', kind: 'itens' }), [], 'vendedor nunca confirma pagamentos');
  assert.deepEqual(buyerActions({ status: 'entregue', kind: 'servico', revision_count: 1 }), ['confirmar', 'pedir_revisao', 'abrir_disputa']);
  assert.deepEqual(buyerActions({ status: 'entregue', kind: 'servico', revision_count: 3 }), ['confirmar', 'abrir_disputa']);
  assert.deepEqual(buyerActions({ status: 'disputa' }, true), []);
  assert.deepEqual(buyerActions({ status: 'aguarda_pagamento' }), ['cancelar']);
});

test('mkt3: comissão igual à do servidor (arredondamento, fixa, teto)', () => {
  assert.equal(commissionAmount(450, 10, 0), 45);
  assert.equal(commissionAmount(270, 10, 0), 27);
  assert.equal(commissionAmount(5, 10, 0), 1, '0,5 arredonda para cima');
  assert.equal(commissionAmount(100, 20, 5), 25);
  assert.equal(commissionAmount(3, 50, 10), 3, 'nunca acima da base');
  assert.equal(commissionAmount(-10, 10, 0), 0);
  assert.equal(commissionAmount(100, null, 0), 0);
});

test('mkt3: CSV seguro (aspas, ; e fórmulas neutralizadas)', () => {
  const csv = toCsv([{ a: 'x;y', b: '=HYPERLINK("http://x")', c: 'diz "olá"', d: null, e: { k: 1 } }], ['a', 'b', 'c', 'd', 'e']);
  const [head, row] = csv.split('\r\n');
  assert.equal(head, 'a;b;c;d;e');
  assert.ok(row.startsWith('"x;y";'));
  assert.ok(row.includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(row.includes('"diz ""olá"""'));
  assert.ok(row.endsWith(';"{""k"":1}"'));
});

test('mkt3: utilitários (histórico, slug, YouTube, telefone, erros)', () => {
  assert.deepEqual(pushHistory(['ff', 'cr'], 'CR'), ['CR', 'ff']);
  assert.deepEqual(pushHistory([], 'a'), []);
  assert.equal(pushHistory(Array.from({ length: 10 }, (_, i) => 'q' + i), 'novo').length, 10);
  assert.equal(slugify('Loja do Zé — Free Fire!'), 'loja-do-ze-free-fire');
  assert.ok(validSlug('loja-ze')); assert.ok(!validSlug('-x')); assert.ok(!validSlug('ab')); assert.ok(!validSlug('Loja'));
  assert.ok(validYoutube('https://youtu.be/abcdefgh12')); assert.ok(validYoutube('https://www.youtube.com/watch?v=abcdefgh12&t=3'));
  assert.ok(!validYoutube('http://youtu.be/abcdefgh12')); assert.ok(!validYoutube('https://evil.com/watch?v=abcdefgh12'));
  assert.equal(mzPhone('+258 84 123 4567'), '841234567');
  assert.equal(errText('PAYMENT_UNAVAILABLE'), 'Pagamento ainda não disponível. Nada foi cobrado.');
  assert.equal(errText('ERROR: STOCK (P0001)'), 'Stock insuficiente.');
  assert.equal(errText('qualquer coisa'), 'qualquer coisa');
  assert.equal(PERMISSIONS.length, 20);
});

test('mkt3: lista de permissões igual no cliente e no servidor', () => {
  const sql = read('supabase/migrations/' + MIG[0]);
  const m = sql.match(/perm text not null check \(perm in \(([^)]+)\)\)/);
  const server = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
  assert.deepEqual([...PERMISSIONS], server);
});

test('mkt3: página pública do SQL contém as 6 partes, por ordem, sem alterações', () => {
  const page = read('public/sql-marketplace.html');
  const parts = JSON.parse(page.match(/const parts=(\[.*?\]);\n/s)[1]);
  assert.equal(parts.length, 6);
  MIG.forEach((f, i) => assert.equal(parts[i], read('supabase/migrations/' + f), `parte ${i + 1} desatualizada: corre scripts/sql-marketplace-page.py`));
  assert.ok(page.includes('sql-apostas.html'), 'indica o pré-requisito');
});

test('mkt3: SQL aditivo — nunca apaga tabelas/dados e é idempotente', () => {
  for (const f of MIG) {
    const sql = read('supabase/migrations/' + f).toLowerCase();
    assert.ok(!/\bdrop\s+table\b/.test(sql), `${f}: drop table`);
    assert.ok(!/\btruncate\s+(table\s+)?public\./.test(sql), `${f}: truncate`);
    assert.ok(!/\bdelete\s+from\s+(public\.)?(market_|money_|payments|profiles)/.test(sql), `${f}: delete de dados existentes`);
    assert.ok(!/create table (?!if not exists)/.test(sql), `${f}: create table sem if not exists`);
    assert.ok(!/create index (?!if not exists)/.test(sql) && !/create unique index (?!if not exists)/.test(sql), `${f}: índice não idempotente`);
  }
});

test('mkt3: sem segredos nem confirmações simuladas no cliente', () => {
  const files = ['lib/mkt3.ts', 'lib/mkt3Api.ts', ...fs.readdirSync(path.join(ROOT, 'components/mkt3')).map((f) => 'components/mkt3/' + f),
    ...['carrinho', 'checkout', 'pedido', 'pesquisa', 'loja', 'criador', 'gestao', 'reclamacoes'].map((p) => `app/marketplace/${p}/page.tsx`)];
  for (const f of files) {
    const src = read(f);
    assert.ok(!/service_role|SUPABASE_SERVICE|CLICPAY_TOKEN|MPESA_BEARER|sk_live|secret_key/i.test(src), `${f}: possível segredo`);
    assert.ok(!/status:\s*['"]confirmado['"]/.test(src) || f.endsWith('mkt3.ts'), `${f}: não pode marcar pagamentos como confirmados no cliente`);
    assert.ok(!/\.from\('(market_orders|mkt_payments|money_ledger|mkt_journal|mkt_payouts)'\)\.(insert|update|upsert|delete)/.test(src), `${f}: escrita direta em tabela financeira`);
  }
  const checkout = read('app/marketplace/checkout/page.tsx');
  assert.ok(checkout.includes('Pagamento ainda não disponível'));
  assert.ok(read('lib/mkt3.ts').includes("PAYMENT_UNAVAILABLE: 'Pagamento ainda não disponível. Nada foi cobrado.'"));
});

test('mkt3: botões do Marketplace 3.0 escondidos até o interruptor estar ligado', () => {
  const kit = read('components/market/Kit.tsx');
  assert.match(kit, /if \(m\.open\) items\.push\(\['pesquisa'/);
  assert.match(kit, /if \(m\.installed && m\.isStaff\) items\.push\(\['gestao'/);
  const anuncio = read('app/marketplace/anuncio/page.tsx');
  assert.match(anuncio, /!mine && m3\.open \? <BuyBox3/);
});
