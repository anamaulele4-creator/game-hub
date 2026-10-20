// Testes do SQL do Marketplace 3.0 (supabase/migrations/2026-10-21-mkt3-*.sql) numa base Postgres real em memória (PGlite).
// Corre todo o SQL anterior + as 6 partes duas vezes (idempotente) e exercita permissões, estados, dinheiro e segurança.
// Não toca em nenhuma base de dados remota. Correr: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './sql/mkt3-db.mjs';

let h; const U = {}; const S = {};
const skip = !(await import('@electric-sql/pglite').then(() => true).catch(() => false));
const idem = (s) => `${s}-${'k'.repeat(16)}`;

async function flag(key, on) { await h.asUser(U.chefe); const r = await h.rpc('app_setting_set', [key, JSON.stringify(on)]); assert.equal(r.ok, true, JSON.stringify(r)); }
async function product(seller, extra = {}) {
  await h.asUser(seller);
  const cols = { seller_id: seller, category: 'ff', kind: 'itens', delivery: 'manual', title: 'Pacote de diamantes', description: 'Entrega rápida', price_mzn: 250, stock: 3, photos: '{art:ff}', status: 'ativo', ...extra };
  const k = Object.keys(cols); const v = Object.values(cols);
  const [r] = await h.q(`insert into market_products (${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')}) returning id, status`, v);
  return r;
}
async function err(p) { try { await p; return null; } catch (e) { return e.message; } }

before(async () => {
  if (skip) return;
  h = await makeDb();
  for (const [k, role] of [['chefe', 'admin'], ['cria', 'creator'], ['comp', 'user'], ['nor', 'user'], ['sup', 'user'], ['outro', 'user'], ['cria2', 'creator']]) U[k] = await h.mk(k, role);
});

test('MKT3 base: migração idempotente, interruptores desligados por omissão, mkt_me', { skip }, async () => {
  const flags = await h.q(`select key, value from app_settings where key like 'mkt3_%' order by key`);
  assert.deepEqual(Object.fromEntries(flags.map((f) => [f.key, f.value])), {
    mkt3_checkout_enabled: false, mkt3_enabled: false, mkt3_payouts_enabled: false, mkt3_product_review_required: false, mkt3_store_review_required: true });
  await h.asUser(U.nor);
  const me = await h.rpc('mkt_me');
  assert.equal(me.enabled, false); assert.equal(me.open, false); assert.deepEqual(me.perms, []);
  await h.asUser(U.chefe);
  const adm = await h.rpc('mkt_me');
  assert.equal(adm.open, true, 'staff testa com o interruptor desligado'); assert.equal(adm.perms.length, 20);
  await h.asAnon();
  assert.equal((await h.rpc('mkt_me')).open, false);
});

test('MKT3 segurança: só o admin muda interruptores; clientes não escrevem nas tabelas', { skip }, async () => {
  await h.asUser(U.nor);
  assert.equal((await h.rpc('app_setting_set', ['mkt3_enabled', 'true'])).code, 'FORBIDDEN');
  assert.match(await err(h.q(`insert into mkt_staff_perms (user_id, perm) values ($1, 'USERS_VIEW')`, [U.nor])), /permission denied/);
  assert.match(await err(h.q(`update app_settings set value = 'true' where key = 'mkt3_enabled'`)) ?? 'sem efeito', /permission denied|sem efeito/);
  await h.asService();
  assert.equal((await h.q(`select value from app_settings where key = 'mkt3_enabled'`))[0].value, false);
});

test('MKT3 lojas: fechado com interruptor desligado; criar, slug único, verificação e permissões', { skip }, async () => {
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_store_save', [JSON.stringify({ slug: 'loja-cria', name: 'Loja Cria' })])).code, 'MKT3_OFF');
  await flag('mkt3_enabled', true);
  await h.asUser(U.nor);
  assert.equal((await h.rpc('mkt_store_save', [JSON.stringify({ slug: 'loja-nor', name: 'Nor' })])).code, 'NOT_SELLER');
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_store_save', [JSON.stringify({ slug: 'x', name: 'Curto' })])).code, 'INVALID');
  assert.equal((await h.rpc('mkt_store_save', [JSON.stringify({ slug: 'loja-cria', name: 'Loja Cria', logo_url: 'https://evil.example/x.png' })])).code, 'PHOTOS');
  const s = await h.rpc('mkt_store_save', [JSON.stringify({ slug: 'loja-cria', name: 'Loja Cria', description: 'Diamantes e contas', category: 'ff' })]);
  assert.equal(s.ok, true); assert.equal(s.status, 'configuracao'); S.store = s.id;
  await h.asUser(U.cria2);
  assert.equal((await h.rpc('mkt_store_save', [JSON.stringify({ slug: 'LOJA-CRIA', name: 'Copia' })])).code, 'SLUG_TAKEN');
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_store_owner_action', ['submeter'])).status, 'pendente');
  // ainda não é pública
  await h.asAnon();
  assert.equal((await h.rpc('mkt_store_public', ['loja-cria'])).code, 'NOT_FOUND');
  // suporte sem permissão: recusado e registado
  await h.asUser(U.sup);
  assert.equal((await h.rpc('mkt_admin_store_action', [S.store, 'aprovar', ''])).code, 'FORBIDDEN');
  await h.asService();
  const [den] = await h.q(`select result, action, actor_id from app_audit_log where area = 'marketplace' and result = 'negado' order by id desc limit 1`);
  assert.equal(den.action, 'loja_aprovar'); assert.equal(den.actor_id, U.sup);
  await h.q(`insert into mkt_staff_perms (user_id, perm) values ($1, 'STORES_MANAGE'), ($1, 'STORES_VIEW')`, [U.sup]);
  await h.asUser(U.sup);
  assert.equal((await h.rpc('mkt_admin_store_action', [S.store, 'suspender', 'x'])).code, 'REASON');
  assert.equal((await h.rpc('mkt_admin_store_action', [S.store, 'aprovar', ''])).status, 'ativa');
  const hist = await h.q(`select from_status, to_status, action from mkt_store_decisions where store_id = $1 order by id`, [S.store]);
  assert.deepEqual(hist.map((x) => x.action), ['criar', 'submeter', 'aprovar']);
  assert.match(await err(h.q(`delete from mkt_store_decisions`)) ?? '', /permission denied|IMMUTABLE/);
  await h.asAnon();
  assert.equal((await h.rpc('mkt_store_public', ['loja-cria'])).store.name, 'Loja Cria');
});

test('MKT3 produtos: estados, guarda do vendedor, vídeos, variantes, duplicar, pesquisa', { skip }, async () => {
  const p = await product(U.cria, { store_id: S.store });
  assert.equal(p.status, 'ativo'); S.prod = p.id;
  // vendedor não suspende nem mexe em visualizações; produto de loja alheia recusado
  assert.match(await err(h.q(`update market_products set status = 'suspenso' where id = $1`, [p.id])), /STATUS_FORBIDDEN/);
  await h.q(`update market_products set views = 999 where id = $1`, [p.id]);
  assert.equal((await h.q(`select views from market_products where id = $1`, [p.id]))[0].views, 0);
  assert.match(await err(h.q(`update market_products set videos = '{https://evil.example/v}' where id = $1`, [p.id])), /VIDEOS/);
  await h.q(`update market_products set videos = '{https://youtu.be/abcdefgh12}' where id = $1`, [p.id]);
  assert.match(await err(product(U.cria2, { store_id: S.store })), /STORE/);
  assert.match(await err(product(U.cria2, { title: 'Conta roubada barata' })), /PROHIBITED/);
  // stock 0 → esgotado; volta a publicado com stock
  const e = await product(U.cria, { title: 'Gift card', stock: 0 });
  assert.equal(e.status, 'esgotado');
  await h.q(`update market_products set stock = 2 where id = $1`, [e.id]);
  assert.equal((await h.q(`select status from market_products where id = $1`, [e.id]))[0].status, 'ativo');
  // variantes (só o dono)
  await h.asUser(U.nor);
  assert.equal((await h.rpc('mkt_variant_save', [S.prod, null, '100 💎', 100, 5, true])).code, 'FORBIDDEN');
  const vp = await product(U.cria, { title: 'Diamantes por pacote', price_mzn: 0, stock: 10 });
  S.vprod = vp.id;
  const v = await h.rpc('mkt_variant_save', [vp.id, null, '520 💎', 300, 2, true]);
  assert.equal(v.ok, true); S.variant = v.id;
  assert.equal((await h.rpc('mkt_variant_save', [vp.id, null, '520 💎', 300, 2, true])).code, 'DUPLICATE');
  // duplicar → rascunho
  const d = await h.rpc('mkt_product_duplicate', [S.prod]);
  assert.equal(d.ok, true);
  assert.equal((await h.q(`select status from market_products where id = $1`, [d.id]))[0].status, 'rascunho');
  // pesquisa: só publicados, filtros, ordenação, paginação; injeção de LIKE inofensiva
  await h.asAnon();
  const r = await h.rpc('mkt_search', ['diamantes', 'produtos', 'ff', null, 'preco_asc', null, null, 1, 1]);
  assert.equal(r.total, 2); assert.equal(r.rows.length, 1);
  assert.equal((await h.rpc('mkt_search', ['diam%zzz', 'produtos', null, null, 'recentes', null, null, 1, 24])).total, 0, '% não é curinga');
  assert.equal((await h.rpc('mkt_search', ['', 'lojas', null, null, 'recentes', null, null, 1, 24])).rows[0].slug, 'loja-cria');
  assert.ok((await h.rpc('mkt_suggest', ['diam'])).products.length >= 1);
  assert.ok((await h.rpc('mkt_related', [S.prod, 8])).length >= 1);
  await h.rpc('mkt_product_view', [S.prod]);
  // moderação: rejeitar exige motivo; suspender esconde da pesquisa
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_product_action', [[e.id], 'suspender', ''])).code, 'REASON');
  assert.equal((await h.rpc('mkt_admin_product_action', [[e.id], 'suspender', 'Fotos enganosas'])).count, 1);
  await h.asUser(U.cria);
  await h.q(`update market_products set status = 'ativo' where id = $1`, [e.id]);
  assert.equal((await h.q(`select status from market_products where id = $1`, [e.id]))[0].status, 'suspenso', 'vendedor não reativa');
});

test('MKT3 produtos: revisão prévia ligada → publicar fica pendente; formulário antigo continua a funcionar', { skip }, async () => {
  await flag('mkt3_product_review_required', true);
  const p = await product(U.cria, { title: 'Coaching FF' , kind: 'servico', stock: 1 });
  assert.equal(p.status, 'pendente');
  await h.q(`update market_products set status = 'ativo' where id = $1`, [p.id]);
  assert.equal((await h.q(`select status from market_products where id = $1`, [p.id]))[0].status, 'pendente');
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_product_action', [[p.id], 'aprovar', ''])).count, 1);
  await flag('mkt3_product_review_required', false);
  // anúncio antigo (sem colunas novas) ainda entra como antes
  await h.asUser(U.nor);
  const [old] = await h.q(`insert into market_products (seller_id, category, kind, delivery, title, price_mzn, stock, photos) values ($1, 'cr', 'itens', 'manual', 'Cartas raras', 50, 1, '{art:cr}') returning status`, [U.nor]);
  assert.equal(old.status, 'ativo');
});

test('MKT3 carrinho: validação no servidor (stock, próprio, variante obrigatória) e totais', { skip }, async () => {
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_cart_set', [S.prod, null, 5])).code, 'STOCK');
  assert.equal((await h.rpc('mkt_cart_set', [S.vprod, null, 1])).code, 'VARIANT_REQUIRED');
  assert.equal((await h.rpc('mkt_cart_set', [S.prod, null, 2])).ok, true);
  assert.equal((await h.rpc('mkt_cart_set', [S.vprod, S.variant, 1])).ok, true);
  const c = await h.rpc('mkt_cart_view', [[]]);
  assert.equal(c.lines.length, 2); assert.equal(c.items_mzn, 2 * 250 + 300); assert.equal(c.total_mzn, 800); assert.equal(c.issues, 0);
  assert.equal(c.checkout_enabled, false);
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_cart_set', [S.prod, null, 1])).code, 'OWN');
  // cupão do vendedor (10%)
  assert.equal((await h.rpc('mkt_coupon_save', ['PROMO10', 10, 5, null, true])).ok, true);
  await h.asUser(U.comp);
  const c2 = await h.rpc('mkt_cart_view', [['promo10']]);
  assert.equal(c2.discount_mzn, 80); assert.equal(c2.total_mzn, 720);
  // cliente não escreve diretamente no carrinho
  assert.match(await err(h.q(`insert into mkt_cart_items (user_id, product_id, qty) values ($1, $2, 1)`, [U.comp, S.prod])), /permission denied/);
});

test('MKT3 checkout: pagamento indisponível bloqueia; comissão obrigatória; recálculo e reserva de stock; idempotente', { skip }, async () => {
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_checkout', [idem('c1'), '{}', [], ''])).code, 'PAYMENT_UNAVAILABLE');
  await flag('mkt3_checkout_enabled', true);
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_checkout', [idem('c1'), '{}', [], ''])).code, 'COMMISSION_UNDEFINED');
  await h.asUser(U.nor);
  assert.equal((await h.rpc('mkt_admin_commission_set', ['global', null, null, 10, 0, ''])).code, 'FORBIDDEN');
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_commission_set', ['global', null, null, 10, 0, 'Taxa base'])).ok, true);
  await h.asUser(U.comp);
  const r = await h.rpc('mkt_checkout', [idem('c1'), '{}', ['PROMO10'], 'obrigado']);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.orders, 2); assert.equal(r.total_mzn, 720);
  S.pay = r.payment_id; S.checkout = r.checkout_id;
  const again = await h.rpc('mkt_checkout', [idem('c1'), '{}', [], '']);
  assert.equal(again.duplicate, true); assert.equal(again.payment_id, S.pay);
  await h.asService();
  const orders = await h.q(`select id, status, total_mzn, items_mzn, discount_mzn, commission_mzn, seller_net_mzn, commission_pct, variant_id from market_orders where checkout_id = $1 order by total_mzn`, [S.checkout]);
  assert.deepEqual(orders.map((o) => [o.status, o.total_mzn, o.commission_mzn, o.seller_net_mzn]), [['aguarda_pagamento', 270, 27, 243], ['aguarda_pagamento', 450, 45, 405]]);
  S.o1 = orders.find((o) => !o.variant_id).id; S.o2 = orders.find((o) => o.variant_id).id;
  assert.equal((await h.q(`select stock from market_products where id = $1`, [S.prod]))[0].stock, 1, 'stock reservado');
  assert.equal((await h.q(`select stock from mkt_product_variants where id = $1`, [S.variant]))[0].stock, 1);
  assert.equal((await h.q(`select count(*)::int n from mkt_cart_items where user_id = $1`, [U.comp]))[0].n, 0);
  // a regra de comissão muda depois: o pedido guarda a anterior
  await h.asUser(U.chefe);
  await h.rpc('mkt_admin_commission_set', ['global', null, null, 20, 5, 'Nova taxa']);
  await h.asService();
  assert.equal(Number((await h.q(`select commission_pct from market_orders where id = $1`, [S.o1]))[0].commission_pct), 10);
  assert.match(await err(h.q(`update mkt_commission_rules set pct = 1`)), /IMMUTABLE/);
});

test('MKT3 segurança: preços, estados e saldos não se manipulam fora das funções', { skip }, async () => {
  await h.asUser(U.comp);
  assert.match(await err(h.q(`update market_orders set total_mzn = 1 where id = $1`, [S.o1])), /permission denied/);
  assert.match(await err(h.q(`insert into money_ledger (user_id, delta, reason, ref, balance_after) values ($1, 100000, 'ajuste', 'x', 100000)`, [U.comp])), /permission denied/);
  assert.match(await err(h.q(`update mkt_payments set status = 'confirmado' where id = $1`, [S.pay])), /permission denied/);
  await h.asService();
  assert.match(await err(h.q(`update market_orders set total_mzn = 1 where id = $1`, [S.o1])), /ORDER_MONEY_IMMUTABLE/);
  assert.match(await err(h.q(`update market_orders set status = 'pago' where id = $1`, [S.o1])), /ORDER_LOCKED/);
  assert.match(await err(h.q(`update mkt_payments set status = 'confirmado' where id = $1`, [S.pay])), /PAYMENT_LOCKED/);
  // a função antiga não confirma pagamentos de pedidos novos
  await h.asUser(U.chefe);
  const legacy = await h.rpc('market_order_action', [S.o1, 'confirmar_pagamento', 'REF123']).catch((e) => ({ ok: false, code: e.message }));
  assert.equal(legacy.ok, false);
  await h.asService();
  assert.equal((await h.q(`select status from market_orders where id = $1`, [S.o1]))[0].status, 'aguarda_pagamento');
  // vendedor não pode marcar entregue antes de pago; terceiros não veem
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_order_action', [S.o1, 'entregar', 'feito', '{}'])).code, 'STATE');
  await h.asUser(U.outro);
  assert.equal((await h.rpc('mkt_order_get', [S.o1])).code, 'NOT_FOUND');
  assert.equal((await h.q(`select count(*)::int n from market_orders where id = $1`, [S.o1]))[0].n, 0, 'RLS esconde pedidos de terceiros');
});

test('MKT3 pagamento: saldo insuficiente recusa; pagar debita uma vez; repetição não duplica', { skip }, async () => {
  await h.asUser(U.comp);
  const r0 = await h.rpc('mkt_pay', [S.pay, idem('p0')]);
  assert.equal(r0.code, 'BALANCE');
  await h.asService();
  assert.equal((await h.q(`select status from mkt_payments where id = $1`, [S.pay]))[0].status, 'recusado');
  await h.fund(U.comp, 1000, 'clicpay:TESTE-1');
  await h.asUser(U.comp);
  const r1 = await h.rpc('mkt_pay', [S.pay, idem('p1')]);
  assert.equal(r1.ok, true, JSON.stringify(r1)); assert.equal(r1.balance, 280);
  assert.equal((await h.rpc('mkt_pay', [S.pay, idem('p1')])).duplicate, true);
  assert.equal((await h.rpc('mkt_pay', [S.pay, idem('p2')])).duplicate, true);
  assert.equal(await h.balance(U.comp), 280, 'debitado uma só vez');
  const st = await h.q(`select status from market_orders where checkout_id = $1`, [S.checkout]);
  assert.ok(st.every((o) => o.status === 'pago'));
  const ev = await h.q(`select to_status from mkt_payment_events where payment_id = $1 order by id`, [S.pay]);
  assert.deepEqual(ev.map((e) => e.to_status), ['pendente', 'recusado', 'pendente', 'confirmado']);
  await h.asService();
  const [n] = await h.q(`select count(*)::int n from notifications where user_id = $1`, [U.cria]);
  assert.ok(n.n >= 2, 'vendedor notificado');
});

test('MKT3 pedido: entrega exige evidência; comprador confirma; vendedor recebe o líquido; reconciliação certa', { skip }, async () => {
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_order_action', [S.o1, 'entregar', '', '{}'])).code, 'EVIDENCE');
  assert.equal((await h.rpc('mkt_order_action', [S.o1, 'entregar', 'Diamantes enviados para o ID 12345', '{}'])).status, 'entregue');
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_order_action', [S.o1, 'entregar', 'x', '{}'])).code, 'STATE');
  const before = await h.balance(U.cria);
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_order_action', [S.o1, 'confirmar', '', '{}'])).status, 'concluido');
  assert.equal(await h.balance(U.cria) - before, 405);
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_order_action', [S.o1, 'confirmar', '', '{}'])).code, 'STATE');
  assert.equal(await h.balance(U.cria) - before, 405, 'sem crédito duplicado');
  const g = await h.rpc('mkt_order_get', [S.o1]);
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(g.order.commission_mzn, undefined, 'comprador não vê comissão');
  assert.deepEqual(g.events.map((e) => e.to), ['criado', 'aguarda_pagamento', 'pago', 'entregue', 'concluido']);
  await h.asUser(U.chefe);
  const rec = await h.rpc('mkt_admin_reconcile');
  assert.deepEqual(rec.issues, []); assert.equal(rec.escrow, 270); assert.equal(rec.revenue, 45);
});

test('MKT3 reembolso parcial: comprador recebe a parte, vendedor o resto com comissão proporcional', { skip }, async () => {
  await h.asUser(U.nor);
  assert.equal((await h.rpc('mkt_admin_refund', [S.o2, 100, 'Faltou parte'])).code, 'FORBIDDEN');
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_refund', [S.o2, 100, 'x'])).code, 'REASON');
  assert.equal((await h.rpc('mkt_admin_refund', [S.o2, 271, 'Valor demasiado alto'])).code, 'AMOUNT');
  const c0 = await h.balance(U.comp); const s0 = await h.balance(U.cria);
  const r = await h.rpc('mkt_admin_refund', [S.o2, 150, 'Faltou metade do pacote']);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.full, false);
  assert.equal(await h.balance(U.comp) - c0, 150);
  // resta 120; comissão 27 × 120/270 = 12 → vendedor 108
  assert.equal(await h.balance(U.cria) - s0, 108);
  await h.asService();
  assert.equal((await h.q(`select status from market_orders where id = $1`, [S.o2]))[0].status, 'parcialmente_reembolsado');
  assert.equal((await h.q(`select status, refunded_mzn from mkt_payments where id = $1`, [S.pay]))[0].status, 'parcialmente_reembolsado');
  await h.asUser(U.chefe);
  assert.deepEqual((await h.rpc('mkt_admin_reconcile')).issues, []);
});

test('MKT3 cancelamento e expiração devolvem o stock; vendedor cancela venda paga = reembolso total', { skip }, async () => {
  await h.asUser(U.comp);
  await h.rpc('mkt_cart_set', [S.prod, null, 1]);
  const r = await h.rpc('mkt_checkout', [idem('c2'), '{}', [], '']);
  assert.equal(r.ok, true);
  await h.asService();
  assert.equal((await h.q(`select stock from market_products where id = $1`, [S.prod]))[0].stock, 0);
  assert.equal((await h.q(`select status from market_products where id = $1`, [S.prod]))[0].status, 'esgotado');
  const [o] = await h.q(`select id from market_orders where checkout_id = $1`, [r.checkout_id]);
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_order_action', [o.id, 'cancelar', '', '{}'])).status, 'cancelado');
  await h.asService();
  assert.equal((await h.q(`select stock, status from market_products where id = $1`, [S.prod]))[0].stock, 1);
  assert.equal((await h.q(`select status from mkt_payments where id = $1`, [r.payment_id]))[0].status, 'cancelado');
  // expiração
  await h.asUser(U.comp);
  await h.rpc('mkt_cart_set', [S.prod, null, 1]);
  const r2 = await h.rpc('mkt_checkout', [idem('c3'), '{}', [], '']);
  await h.asService();
  await h.q(`select set_config('mkt.ctx', '1', false)`);
  await h.q(`update market_orders set expires_at = now() - interval '1 minute' where checkout_id = $1`, [r2.checkout_id]);
  await h.q(`select set_config('mkt.ctx', '', false)`);
  const sw = await h.rpc('mkt_sweep');
  assert.equal(sw.expired, 1);
  assert.equal((await h.q(`select status from mkt_payments where id = $1`, [r2.payment_id]))[0].status, 'expirado');
  assert.equal((await h.q(`select stock from market_products where id = $1`, [S.prod]))[0].stock, 1);
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_pay', [r2.payment_id, idem('p3')])).code, 'STATE');
  // vendedor cancela uma venda paga → reembolso total ao comprador
  await h.rpc('mkt_cart_set', [S.prod, null, 1]);
  const r3 = await h.rpc('mkt_checkout', [idem('c4'), '{}', [], '']);
  assert.equal((await h.rpc('mkt_pay', [r3.payment_id, idem('p4')])).ok, true);
  const b0 = await h.balance(U.comp);
  await h.asService();
  const [o3] = await h.q(`select id from market_orders where checkout_id = $1`, [r3.checkout_id]);
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_order_action', [o3.id, 'cancelar_venda', 'Sem stock real', '{}'])).status, 'reembolsado');
  assert.equal(await h.balance(U.comp) - b0, 250);
  await h.asService();
  assert.equal((await h.q(`select stock from market_products where id = $1`, [S.prod]))[0].stock, 1, 'stock devolvido');
  await h.asUser(U.chefe);
  assert.deepEqual((await h.rpc('mkt_admin_reconcile')).issues, []);
});

test('MKT3 pagamentos ao vendedor: interruptor, identidade, saldo, referência do operador, sem duplicados', { skip }, async () => {
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_payout_request', [200, 'M-Pesa', '841234567', idem('w1')])).code, 'PAYOUTS_OFF');
  await flag('mkt3_payouts_enabled', true);
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_payout_request', [200, 'M-Pesa', '841234567', idem('w1')])).code, 'IDENTITY');
  await h.asService();
  await h.q(`insert into seller_verifications (user_id, doc_path, selfie_path, status) values ($1, $2, $3, 'aprovado')`, [U.cria, `kyc/${U.cria}/doc.jpg`, `kyc/${U.cria}/selfie.jpg`]);
  await h.asUser(U.cria);
  const bal = await h.balance(U.cria);
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_payout_request', [bal + 1, 'M-Pesa', '841234567', idem('w1')])).code, 'BALANCE');
  assert.equal((await h.rpc('mkt_payout_request', [200, 'M-Pesa', '861234567', idem('w1')])).code, 'PHONE');
  const p = await h.rpc('mkt_payout_request', [200, 'M-Pesa', '841234567', idem('w2')]);
  assert.equal(p.ok, true, JSON.stringify(p)); assert.equal(p.balance, bal - 200);
  assert.equal((await h.rpc('mkt_payout_request', [100, 'M-Pesa', '841234567', idem('w3')])).code, 'PAYOUT_OPEN');
  assert.equal((await h.rpc('mkt_admin_payout_action', [p.id, 'pago', 'ABC123', ''])).code, 'FORBIDDEN', 'o próprio não aprova');
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_payout_action', [p.id, 'pago', '12', ''])).code, 'REF');
  assert.equal((await h.rpc('mkt_admin_payout_action', [p.id, 'pago', 'MP-998877', ''])).status, 'pago');
  assert.equal((await h.rpc('mkt_admin_payout_action', [p.id, 'recusar', '', 'tarde demais'])).code, 'STATE');
  const fin = await (async () => { await h.asUser(U.cria); return h.rpc('mkt_seller_finance'); })();
  assert.equal(fin.payouts_done, 200); assert.equal(fin.gross, 450 + 270, 'bruto liquidado (sem reembolsos totais)'); assert.equal(fin.commissions, 45 + 12);
  // recusado devolve o valor
  const p2 = await h.rpc('mkt_payout_request', [100, 'M-Pesa', '841234567', idem('w4')]);
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_payout_action', [p2.id, 'recusar', '', 'Número não coincide'])).status, 'recusado');
  assert.equal(await h.balance(U.cria), bal - 200);
  assert.deepEqual((await h.rpc('mkt_admin_reconcile')).issues, []);
  await h.asService();
  assert.match(await err(h.q(`update mkt_journal set amount = 1`)), /IMMUTABLE/);
  assert.match(await err(h.q(`update mkt_payouts set status = 'pedido' where id = $1`, [p.id])), /PAYOUT_IMMUTABLE/);
});

async function paidOrder(tag, qty = 1) {
  await h.asUser(U.comp);
  const add = await h.rpc('mkt_cart_set', [S.prod2, null, qty]);
  assert.equal(add.ok, true, JSON.stringify(add));
  const c = await h.rpc('mkt_checkout', [idem(tag), '{}', [], '']);
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal((await h.rpc('mkt_pay', [c.payment_id, idem(tag + 'p')])).ok, true);
  await h.asService();
  const [o] = await h.q(`select id, total_mzn from market_orders where checkout_id = $1`, [c.checkout_id]);
  return o;
}

test('MKT3 mensagens do pedido: só as partes, bloqueio, imagens validadas, denúncia e moderação', { skip }, async () => {
  S.prod2 = (await product(U.cria, { title: 'Serviço de subida de nível', kind: 'servico', stock: 1, price_mzn: 100 })).id;
  await h.fund(U.comp, 2000, 'clicpay:TESTE-2');
  const o = await paidOrder('m1'); S.mo = o.id;
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_message_send', [o.id, 'Olá, quando começa?', null])).ok, true);
  assert.equal((await h.rpc('mkt_message_send', [o.id, '', 'https://evil.example/a.png'])).code, 'PHOTOS');
  await h.asUser(U.outro);
  assert.equal((await h.rpc('mkt_message_send', [o.id, 'spam', null])).code, 'FORBIDDEN');
  assert.equal((await h.rpc('mkt_messages', [o.id])).code, 'FORBIDDEN');
  assert.equal((await h.q(`select count(*)::int n from mkt_order_messages`))[0].n, 0, 'RLS: terceiros não leem');
  await h.asUser(U.cria);
  const m = await h.rpc('mkt_messages', [o.id]);
  assert.equal(m.rows.length, 1); assert.equal(m.rows[0].mine, false);
  assert.equal((await h.rpc('mkt_message_send', [o.id, 'Paga por fora no meu M-Pesa direto', null])).ok, true);
  await h.asService();
  assert.equal((await h.q(`select count(*)::int n from mkt_risk_events where kind = 'pagamento_fora_plataforma'`))[0].n, 1);
  const [msg] = await h.q(`select id from mkt_order_messages where sender_id = $1`, [U.cria]);
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_report', ['mensagem', msg.id, 'Pede pagamento fora da plataforma'])).ok, true);
  assert.equal((await h.rpc('mkt_report', ['mensagem', msg.id, 'Outra vez'])).code, 'ALREADY');
  await h.q(`insert into blocks (user_id, blocked) values ($1, $2)`, [U.comp, U.cria]);
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_message_send', [o.id, 'olá?', null])).code, 'BLOCKED');
  await h.asUser(U.comp);
  await h.q(`delete from blocks where user_id = $1`, [U.comp]);
  await h.asUser(U.chefe);
  const [rep] = await h.q(`select id from mkt_reports where target_id = $1`, [msg.id]);
  assert.equal((await h.rpc('mkt_admin_report_action', [rep.id, 'procedente', 'Tentativa de pagamento por fora'])).ok, true);
  await h.asUser(U.comp);
  const m2 = await h.rpc('mkt_messages', [o.id]);
  assert.equal(m2.rows.find((x) => !x.mine).hidden, true); assert.equal(m2.rows.find((x) => !x.mine).body, '');
});

test('MKT3 disputa: abrir bloqueia o dinheiro; proposta aceite = reembolso pelo processo financeiro', { skip }, async () => {
  await h.asUser(U.outro);
  assert.equal((await h.rpc('mkt_dispute_open', [S.mo, 'nao_recebido', 'Nunca recebi nada do vendedor', []])).code, 'FORBIDDEN');
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_dispute_open', [S.mo, 'nao_recebido', 'curto', []])).code, 'INVALID');
  const d = await h.rpc('mkt_dispute_open', [S.mo, 'servico_incompleto', 'O serviço não começou no prazo combinado', []]);
  assert.equal(d.ok, true, JSON.stringify(d)); S.disp = d.id;
  assert.equal((await h.rpc('mkt_dispute_open', [S.mo, 'outro', 'Segunda reclamação igual', []])).code, 'ALREADY');
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_order_action', [S.mo, 'entregar', 'Feito tudo', '{}'])).code, 'STATE', 'em disputa o vendedor não conclui');
  assert.equal((await h.rpc('mkt_dispute_action', [S.disp, 'propor', 'Devolvo metade', [], 1000])).code, 'AMOUNT');
  assert.equal((await h.rpc('mkt_dispute_action', [S.disp, 'propor', 'Devolvo metade', [], 50])).ok, true);
  await h.asUser(U.comp);
  const b0 = await h.balance(U.comp);
  assert.equal((await h.rpc('mkt_dispute_action', [S.disp, 'aceitar', '', [], null])).ok, true);
  assert.equal(await h.balance(U.comp) - b0, 50);
  const g = await h.rpc('mkt_dispute_get', [S.mo]);
  assert.equal(g.dispute.status, 'resolvida'); assert.equal(g.dispute.decision, 'acordo');
  await h.asUser(U.chefe);
  assert.deepEqual((await h.rpc('mkt_admin_reconcile')).issues, []);
});

test('MKT3 disputa decidida pela equipa: permissões separadas para decidir e reembolsar', { skip }, async () => {
  await h.asService();
  await h.q(`update market_products set stock = 1 where id = $1`, [S.prod2]);
  const o = await paidOrder('m2');
  await h.asUser(U.comp);
  const d = await h.rpc('mkt_dispute_open', [o.id, 'nao_recebido', 'O vendedor não respondeu às mensagens', []]);
  await h.asService();
  await h.q(`insert into mkt_staff_perms (user_id, perm) values ($1, 'DISPUTES_MANAGE'), ($1, 'DISPUTES_VIEW')`, [U.sup]);
  await h.asUser(U.sup);
  assert.equal((await h.rpc('mkt_admin_dispute_action', [d.id, 'pedir_provas', '', null])).ok, true);
  assert.equal((await h.rpc('mkt_admin_dispute_action', [d.id, 'reembolso_total', 'Vendedor sem resposta em 72 h', null])).code, 'FORBIDDEN', 'precisa de REFUNDS_MANAGE');
  assert.equal((await h.rpc('mkt_admin_dispute_action', [d.id, 'rejeitar', 'curto', null])).code, 'REASON');
  const s0 = await h.balance(U.cria);
  assert.equal((await h.rpc('mkt_admin_dispute_action', [d.id, 'rejeitar', 'Provas mostram que o serviço foi feito', null])).ok, true);
  assert.equal(await h.balance(U.cria) - s0, o.total_mzn - Math.floor(o.total_mzn * 0.2 + 0.5) - 5, 'liberta ao vendedor com a comissão guardada (20% + 5)');
  await h.asService();
  assert.equal((await h.q(`select status from market_orders where id = $1`, [o.id]))[0].status, 'concluido');
});

test('MKT3 avaliações: só compra verificada, uma por pedido, edição com histórico, resposta, média sem ocultas', { skip }, async () => {
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_review_save', [S.o1, 6, ''])).code, 'RATING');
  assert.equal((await h.rpc('mkt_review_save', [S.o1, 2, 'Demorou'])).ok, true);
  assert.equal((await h.rpc('mkt_review_save', [S.o1, 4, 'Afinal tudo certo'])).ok, true, 'uma edição');
  assert.equal((await h.rpc('mkt_review_save', [S.o1, 5, 'Mais uma'])).code, 'EDIT_LOCKED');
  await h.asUser(U.outro);
  assert.equal((await h.rpc('mkt_review_save', [S.o1, 1, 'Falsa'])).code, 'FORBIDDEN');
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_review_reply', [S.o1, 'Obrigado!'])).ok, true);
  assert.match(await err(h.q(`delete from market_reviews where order_id = $1`, [S.o1])), /permission denied/);
  await h.asService();
  assert.equal((await h.q(`select count(*)::int n from mkt_review_history where order_id = $1`, [S.o1]))[0].n, 1);
  const [st] = await h.q(`select rating from market_seller_stats where seller_id = $1`, [U.cria]);
  assert.equal(Number(st.rating), 4);
});

test('MKT3 admin: permissões granulares, painel, listas, auditoria e exportação registada', { skip }, async () => {
  await h.asUser(U.nor);
  assert.equal((await h.rpc('mkt_admin_dashboard', [null, null])).code, 'FORBIDDEN');
  assert.equal((await h.rpc('mkt_admin_audit', ['', '', '', '', '', null, null, 1])).code, 'FORBIDDEN');
  assert.equal((await h.rpc('mkt_admin_set_perm', [U.nor, 'AUDIT_LOGS_VIEW', true])).code, 'FORBIDDEN');
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_set_perm', [U.nor, 'NAO_EXISTE', true])).code, 'INVALID');
  assert.equal((await h.rpc('mkt_admin_set_perm', [U.nor, 'AUDIT_LOGS_VIEW', true])).ok, true);
  const dash = await h.rpc('mkt_admin_dashboard', [null, null]);
  assert.equal(dash.ok, true); assert.equal(dash.stores_active, 1); assert.ok(dash.commissions > 0); assert.ok(dash.denied_attempts >= 1);
  assert.equal((await h.rpc('mkt_admin_list', ['pedidos', null, '', 1])).ok, true);
  await h.asUser(U.nor);
  const a = await h.rpc('mkt_admin_audit', ['', 'loja', '', '', 'marketplace', null, null, 1]);
  assert.equal(a.ok, true); assert.ok(a.rows.length >= 2);
  assert.ok((await h.rpc('mkt_admin_audit', ['', '', '', 'negado', '', null, null, 1])).rows.every((r) => r.result === 'negado'));
  assert.equal((await h.rpc('mkt_admin_audit_export', ['', '', '', '', '', null, null])).code, 'FORBIDDEN', 'ver ≠ exportar');
  assert.equal((await h.rpc('mkt_admin_list', ['pedidos', null, '', 1])).code, 'FORBIDDEN');
  await h.asUser(U.chefe);
  await h.rpc('mkt_admin_set_perm', [U.nor, 'AUDIT_LOGS_EXPORT', true]);
  await h.asUser(U.nor);
  const ex = await h.rpc('mkt_admin_audit_export', ['', '', '', '', '', null, null]);
  assert.equal(ex.ok, true); assert.ok(ex.rows.length > 5);
  assert.ok(!JSON.stringify(ex.rows).match(/"(pin|password|token)"/i), 'sem segredos nos registos');
  await h.asService();
  const [exp] = await h.q(`select actor_id, meta from app_audit_log where action = 'auditoria_exportar' order by id desc limit 1`);
  assert.equal(exp.actor_id, U.nor); assert.ok(exp.meta.linhas > 5);
  assert.match(await err(h.q(`delete from app_audit_log`)), /AUDIT_IMMUTABLE/);
  // utilizador comum não lê a auditoria diretamente
  await h.asUser(U.outro);
  assert.equal((await h.q(`select count(*)::int n from app_audit_log`))[0].n, 0);
  // relatórios
  await h.asUser(U.chefe);
  const rep = await h.rpc('mkt_admin_report', [null, null]);
  assert.equal(rep.rows.length, 30); assert.ok(rep.rows.some((r) => r.sales_mzn > 0));
});

test('MKT3 suspensão temporária: com motivo, não a admins, só com USERS_MANAGE', { skip }, async () => {
  await h.asUser(U.sup);
  assert.equal((await h.rpc('mkt_admin_user_suspend', [U.outro, 24, 'Investigação de fraude em curso'])).code, 'FORBIDDEN');
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_user_suspend', [U.outro, 24, 'curto'])).code, 'REASON');
  assert.equal((await h.rpc('mkt_admin_user_suspend', [U.chefe, 24, 'Investigação de fraude em curso'])).code, 'FORBIDDEN');
  assert.equal((await h.rpc('mkt_admin_user_suspend', [U.outro, 24, 'Investigação de fraude em curso'])).ok, true);
  await h.asUser(U.outro);
  assert.equal((await h.rpc('mkt_checkout', [idem('susp'), '{}', [], ''])).code, 'ACCOUNT');
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_user_suspend', [U.outro, 0, 'Verificação concluída sem problemas'])).ok, true);
});

test('MKT3 painel do criador: indicadores a partir de registos reais', { skip }, async () => {
  await h.asUser(U.cria);
  const d = await h.rpc('mkt_creator_dashboard', [null, null]);
  assert.equal(d.ok, true); assert.equal(d.store.slug, 'loja-cria');
  assert.ok(d.kpi.sales_count >= 2); assert.ok(d.kpi.gross >= 720); assert.ok(d.kpi.commissions >= 57);
  assert.equal(d.rating.avg, 4); assert.ok(d.top_products.length >= 1); assert.ok(d.series.length >= 1);
  assert.equal(d.repeat_customers, 1, 'o mesmo comprador concluiu vários pedidos');
  const r = await h.rpc('mkt_creator_report', [null, null]);
  assert.ok(r.rows.length >= 3); assert.ok(r.rows.every((x) => x.total_mzn > 0));
  await h.asUser(U.nor);
  const n = await h.rpc('mkt_creator_dashboard', [null, null]);
  assert.equal(n.kpi.orders, 0, 'ninguém vê vendas de outros');
});

test('MKT3 notificações: sem duplicados e preferências respeitadas', { skip }, async () => {
  await h.asService();
  const [{ n }] = await h.q(`select count(*)::int n from (select user_id, dedupe_key from mkt_notification_log group by 1, 2 having count(*) > 1) x`);
  assert.equal(n, 0);
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_notification_prefs_set', ['seguranca', false])).code, 'MANDATORY');
  assert.equal((await h.rpc('mkt_notification_prefs_set', ['nova_mensagem', false])).ok, true);
  await h.asService();
  await h.q(`select public.mkt__notify($1, 'nova_mensagem', 'teste', null, 'pref-test-1')`, [U.cria]);
  await h.q(`select public.mkt__notify($1, 'nova_mensagem', 'teste', null, 'pref-test-1')`, [U.cria]);
  const rows = await h.q(`select status from mkt_notification_log where user_id = $1 and dedupe_key = 'pref-test-1'`, [U.cria]);
  assert.deepEqual(rows.map((r) => r.status), ['ignorada_preferencia']);
});
