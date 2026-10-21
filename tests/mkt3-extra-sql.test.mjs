// Marketplace 3.0 · Partes 7–10 em PGlite: agendamento de prazos, equipa da loja, pagamento direto M-Pesa/e-Mola
// (depósito ligado ao pedido, pago pelo servidor depois da confirmação do fornecedor) e Creator OS.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDb, ROOT } from './sql/mkt3-db.mjs';

let h; const U = {}; const S = {};
const skip = !(await import('@electric-sql/pglite').then(() => true).catch(() => false));
const idem = (s) => `${s}-${'x'.repeat(16)}`;
async function err(p) { try { await p; return null; } catch (e) { return e.message; } }
async function flag(key, on) { await h.asUser(U.chefe); const r = await h.rpc('app_setting_set', [key, JSON.stringify(on)]); assert.equal(r.ok, true, JSON.stringify(r)); }
async function product(seller, extra = {}) {
  await h.asUser(seller);
  const cols = { seller_id: seller, category: 'ff', kind: 'itens', delivery: 'manual', title: 'Pacote de diamantes', description: 'Entrega rápida', price_mzn: 200, stock: 20, photos: '{art:ff}', status: 'ativo', ...extra };
  const k = Object.keys(cols); const v = Object.values(cols);
  const [r] = await h.q(`insert into market_products (${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')}) returning id, status`, v);
  return r;
}
async function buy(user, prod, qty, key) {
  await h.asUser(user);
  assert.equal((await h.rpc('mkt_cart_set', [prod, null, qty])).ok, true);
  const r = await h.rpc('mkt_checkout', [idem(key), '{}', [], '']);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
async function confirmDeposit(dep, ref, amount, status = 'success') {
  await h.asService();
  return (await h.q(`select public.comp__confirm_deposit($1, 'mpesa', $2, $3, $4, $5, true, 'teste') as r`, [dep, 'clicpay:' + ref, ref, status, amount]))[0].r;
}

before(async () => {
  if (skip) return;
  h = await makeDb();
  for (const [k, role] of [['chefe', 'admin'], ['cria', 'creator'], ['comp', 'user'], ['ges', 'user'], ['atd', 'user'], ['fora', 'user'], ['comp2', 'user']]) U[k] = await h.mk(k, role);
  await flag('mkt3_enabled', true);
  await flag('mkt3_store_review_required', false);
  await h.asUser(U.chefe);
  assert.equal((await h.rpc('mkt_admin_commission_set', ['global', null, null, 10, 0, 'Taxa base'])).ok, true);
  await h.asUser(U.cria);
  const s = await h.rpc('mkt_store_save', [JSON.stringify({ slug: 'loja-equipa', name: 'Loja Equipa', category: 'ff' })]);
  assert.equal(s.ok, true); S.store = s.id;
  assert.equal((await h.rpc('mkt_store_owner_action', ['submeter'])).status, 'ativa');
  S.prod = (await product(U.cria, { store_id: S.store })).id;
  await flag('mkt3_checkout_enabled', true);
});

/* ---------------------------- Parte 7: agendamento ---------------------------- */
test('Parte 7: agenda mkt_sweep no pg_cron só se existir (nunca falha); estado no painel; botão mantém-se', { skip }, async () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/2026-10-21-mkt3-07-agendar-prazos.sql'), 'utf8');
  assert.match(sql, /to_regnamespace\('cron'\)/);
  assert.match(sql, /pg_available_extensions where name = 'pg_cron'/);
  assert.match(sql, /cron\.schedule\('mkt-sweep', '\*\/5 \* \* \* \*', 'select public\.mkt_sweep\(\)'\)/);
  assert.match(sql, /cron\.unschedule\(jobid\) from cron\.job where jobname = 'mkt-sweep'/, 'não duplica o job');
  await h.asUser(U.chefe);
  const st = await h.rpc('mkt_admin_sweep_status');
  assert.equal(st.ok, true); assert.equal(st.cron, false, 'PGlite não tem pg_cron: a migração correu na mesma (2x)');
  await h.asUser(U.fora);
  assert.equal((await h.rpc('mkt_admin_sweep_status')).code, 'FORBIDDEN');
  assert.equal((await h.rpc('mkt_sweep')).code, 'FORBIDDEN');
  await h.asService();
  const sw = await h.rpc('mkt_sweep');
  assert.equal(sw.ok, true, 'o job corre sem sessão (como o pg_cron)');
  assert.ok(fs.readFileSync(path.join(ROOT, 'components/mkt3/Admin.tsx'), 'utf8').includes('Processar prazos agora'));
});

/* ---------------------------- Parte 8: equipa ---------------------------- */
test('Parte 8: o dono convida/remove por @utilizador; regras e auditoria', { skip }, async () => {
  await h.asUser(U.fora);
  assert.equal((await h.rpc('mkt_store_member_set', ['@ges', 'gestor'])).code, 'FORBIDDEN', 'sem loja = não é dono');
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_store_member_set', ['@cria', 'gestor'])).code, 'SELF');
  assert.equal((await h.rpc('mkt_store_member_set', ['@ninguem', 'gestor'])).code, 'USER_NOT_FOUND');
  assert.equal((await h.rpc('mkt_store_member_set', ['@ges', 'dono'])).code, 'INVALID');
  assert.equal((await h.rpc('mkt_store_member_set', ['@ges', 'gestor'])).ok, true);
  assert.equal((await h.rpc('mkt_store_member_set', ['atd', 'gestor'])).ok, true);
  assert.equal((await h.rpc('mkt_store_member_set', ['ATD', 'atendimento'])).role, 'atendimento');
  const t = await h.rpc('mkt_store_team');
  assert.deepEqual(t.members.map((m) => [m.handle, m.role]), [['ges', 'gestor'], ['atd', 'atendimento']]);
  // clientes não escrevem na tabela
  assert.match(await err(h.q(`insert into mkt_store_members (store_id, user_id, role) values ($1, $2, 'gestor')`, [S.store, U.fora])), /permission denied/);
  await h.asUser(U.ges);
  assert.equal((await h.rpc('mkt_store_member_set', ['@fora', 'gestor'])).code, 'FORBIDDEN', 'gestor não gere a equipa');
  const mine = await h.rpc('mkt_team_stores');
  assert.equal(mine.rows[0].role, 'gestor'); assert.equal(mine.rows[0].products.length, 1);
  await h.asUser(U.atd);
  assert.equal((await h.rpc('mkt_team_stores')).rows[0].products.length, 0, 'atendimento não gere produtos');
  await h.asService();
  const au = await h.q(`select action from app_audit_log where area = 'marketplace' and action like 'loja_equipa%' and result = 'ok' order by id`);
  assert.deepEqual(au.map((a) => a.action), ['loja_equipa_adicionar', 'loja_equipa_adicionar', 'loja_equipa_funcao']);
  const [den] = await h.q(`select actor_id from app_audit_log where action = 'loja_equipa_adicionar' and result = 'negado' order by id limit 1`);
  assert.equal(den.actor_id, U.fora);
  assert.ok((await h.q(`select 1 from notifications where user_id = $1`, [U.ges])).length >= 1, 'membro avisado');
});

test('Parte 8: permissões do gestor e do atendimento nos produtos, pedidos e mensagens (RPC + RLS)', { skip }, async () => {
  // produtos
  await h.asUser(U.ges);
  const ok = await h.rpc('mkt_team_product_save', [S.prod, JSON.stringify({ price_mzn: 250, stock: 15, title: 'Pacote de diamantes XL' })]);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal((await h.rpc('mkt_team_product_save', [S.prod, JSON.stringify({ status: 'suspenso' })])).code, 'STATUS_FORBIDDEN');
  assert.equal((await h.rpc('mkt_variant_save', [S.prod, null, '520 💎', 300, 2, true])).ok, true, 'gestor cria variantes');
  assert.match(await err(h.q(`update market_products set price_mzn = 1 where id = $1`, [S.prod])) ?? 'sem efeito', /permission denied|sem efeito/);
  await h.asUser(U.atd);
  assert.equal((await h.rpc('mkt_team_product_save', [S.prod, JSON.stringify({ price_mzn: 1 })])).code, 'FORBIDDEN');
  await h.asUser(U.fora);
  assert.equal((await h.rpc('mkt_variant_save', [S.prod, null, 'x', 1, 1, true])).code, 'FORBIDDEN');
  await h.asService();
  const [p] = await h.q(`select price_mzn, stock, title from market_products where id = $1`, [S.prod]);
  assert.deepEqual([p.price_mzn, p.stock, p.title], [250, 15, 'Pacote de diamantes XL']);
  await h.q(`delete from mkt_product_variants where product_id = $1`, [S.prod]);

  // pedido real pago com a carteira
  await h.fund(U.comp, 1000, 'clicpay:EQ-1');
  const c = await buy(U.comp, S.prod, 1, 'eq1');
  await h.asUser(U.comp);
  assert.equal((await h.rpc('mkt_pay', [c.payment_id, idem('eqp1')])).ok, true);
  await h.asService();
  S.order = (await h.q(`select id from market_orders where checkout_id = $1`, [c.checkout_id]))[0].id;

  await h.asUser(U.atd);
  const lst = await h.rpc('mkt_team_orders', [null, null, 1]);
  assert.equal(lst.rows.length, 1); assert.equal(lst.rows[0].my_role, 'atendimento');
  const ga = await h.rpc('mkt_order_get', [S.order]);
  assert.equal(ga.role, 'equipa'); assert.equal(ga.team_role, 'atendimento');
  assert.equal(ga.order.commission_mzn, undefined, 'atendimento não vê comissões');
  assert.equal((await h.q(`select count(*)::int n from market_orders where id = $1`, [S.order]))[0].n, 1, 'RLS: lê o pedido da loja');
  assert.equal((await h.rpc('mkt_order_action', [S.order, 'entregar', 'Código enviado no chat', '{}'])).code, 'FORBIDDEN');
  assert.equal((await h.rpc('mkt_message_send', [S.order, 'Olá! Vamos tratar do teu pedido.', null])).ok, true, 'atendimento responde ao cliente');

  await h.asUser(U.ges);
  assert.equal((await h.rpc('mkt_order_get', [S.order])).order.commission_mzn, 25);
  assert.equal((await h.rpc('mkt_order_action', [S.order, 'cancelar_venda', 'Sem stock afinal', '{}'])).code, 'FORBIDDEN', 'reembolso só pelo dono');
  assert.equal((await h.rpc('mkt_order_action', [S.order, 'entregar', 'Código enviado no chat', '{}'])).status, 'entregue');

  await h.asUser(U.fora);
  assert.equal((await h.rpc('mkt_order_get', [S.order])).code, 'NOT_FOUND');
  assert.equal((await h.rpc('mkt_message_send', [S.order, 'olá', null])).code, 'FORBIDDEN');
  assert.equal((await h.q(`select count(*)::int n from market_orders where id = $1`, [S.order]))[0].n, 0);
  assert.equal((await h.q(`select count(*)::int n from mkt_order_messages where order_id = $1`, [S.order]))[0].n, 0);

  await h.asUser(U.comp);
  const msgs = await h.rpc('mkt_messages', [S.order]);
  assert.equal(msgs.rows[0].sender, 'atd');
  await h.asService();
  const [ev] = await h.q(`select actor_role, actor_id from mkt_order_events where order_id = $1 and to_status = 'entregue'`, [S.order]);
  assert.deepEqual([ev.actor_role, ev.actor_id], ['equipa', U.ges]);
  assert.ok((await h.q(`select 1 from app_audit_log where action = 'loja_equipa_pedido_entregar' and actor_id = $1`, [U.ges])).length === 1);
  assert.ok((await h.q(`select 1 from app_audit_log where action = 'loja_equipa_produto' and actor_id = $1`, [U.ges])).length === 1);
});

test('Parte 8: remover membro (dono) e sair da equipa (membro) cortam o acesso', { skip }, async () => {
  await h.asUser(U.atd);
  assert.equal((await h.rpc('mkt_store_member_remove', [S.store, U.ges])).code, 'FORBIDDEN', 'membro não remove outros');
  assert.equal((await h.rpc('mkt_store_member_remove', [S.store, U.atd])).ok, true, 'pode sair');
  assert.equal((await h.rpc('mkt_order_get', [S.order])).code, 'NOT_FOUND');
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_store_member_remove', [null, U.ges])).ok, true);
  await h.asUser(U.ges);
  assert.equal((await h.rpc('mkt_team_product_save', [S.prod, JSON.stringify({ price_mzn: 1 })])).code, 'FORBIDDEN');
  assert.equal((await h.rpc('mkt_team_orders', [null, null, 1])).rows.length, 0);
  await h.asService();
  const au = await h.q(`select action from app_audit_log where action in ('loja_equipa_sair','loja_equipa_remover') and result = 'ok' order by id`);
  assert.deepEqual(au.map((a) => a.action), ['loja_equipa_sair', 'loja_equipa_remover']);
});

/* ---------------------------- Parte 9: pagamento direto ---------------------------- */
test('Parte 9: sem fornecedor configurado → "Pagamento ainda não disponível"; sem interruptor também', { skip }, async () => {
  const c = await buy(U.comp2, S.prod, 1, 'd0');
  S.d0 = c;
  await h.asUser(U.comp2);
  assert.equal((await h.rpc('mkt_pay_direct_start', [c.payment_id, 'M-Pesa', '841234567', idem('ds0')])).code, 'PAYMENT_UNAVAILABLE');
  const o = await h.rpc('mkt_pay_direct_options');
  assert.equal(o.mpesa, false); assert.equal(o.enabled, true);
  await h.asService();
  await h.q(`insert into comp_provider_status (provider, configured, live) values ('mpesa', true, true), ('emola', false, false)
             on conflict (provider) do update set configured = excluded.configured, live = excluded.live`);
  await h.asUser(U.comp2);
  assert.equal((await h.rpc('mkt_pay_direct_options')).mpesa, true);
  assert.equal((await h.rpc('mkt_pay_direct_start', [c.payment_id, 'e-Mola', '861234567', idem('ds0')])).code, 'PAYMENT_UNAVAILABLE', 'e-Mola não configurado');
  assert.equal((await h.rpc('mkt_pay_direct_start', [c.payment_id, 'M-Pesa', '861234567', idem('ds0')])).code, 'PHONE');
  await flag('mkt3_checkout_enabled', false);
  await h.asUser(U.comp2);
  assert.equal((await h.rpc('mkt_pay_direct_start', [c.payment_id, 'M-Pesa', '841234567', idem('ds0')])).code, 'PAYMENT_UNAVAILABLE');
  await flag('mkt3_checkout_enabled', true);
  await h.asUser(U.fora);
  assert.equal((await h.rpc('mkt_pay_direct_start', [c.payment_id, 'M-Pesa', '841234567', idem('ds-f')])).code, 'NOT_FOUND', 'só o comprador');
});

test('Parte 9: depósito do valor EXATO em falta; só o servidor paga o pedido depois da confirmação; idempotente', { skip }, async () => {
  const c = S.d0; // total 250
  await h.fund(U.comp2, 100, 'clicpay:SALDO-100');
  await h.asUser(U.comp2);
  const s1 = await h.rpc('mkt_pay_direct_start', [c.payment_id, 'M-Pesa', '+258 84 123 4567', idem('ds1')]);
  assert.equal(s1.ok, true, JSON.stringify(s1)); assert.equal(s1.amount_mzn, 150, 'total 250 − saldo 100'); S.dep1 = s1.deposit_id;
  assert.equal((await h.rpc('mkt_pay_direct_start', [c.payment_id, 'M-Pesa', '841234567', idem('ds1')])).duplicate, true);
  assert.equal((await h.rpc('mkt_pay_direct_start', [c.payment_id, 'M-Pesa', '841234567', idem('ds2')])).deposit_id, S.dep1, 'reutiliza o depósito pendente');
  await h.asService();
  const [dep] = await h.q(`select kind, status, amount_mzn, user_id, method from payments where id = $1`, [S.dep1]);
  assert.deepEqual([dep.kind, dep.status, dep.amount_mzn, dep.user_id, dep.method], ['carteira', 'pendente', 150, U.comp2, 'M-Pesa'], 'mesma linha que /wallet-deposit e /reconcile usam');
  // o cliente não consegue marcar nada como pago
  await h.asUser(U.comp2);
  assert.match(await err(h.q(`update payments set status = 'pago' where id = $1`, [S.dep1])) ?? 'sem efeito', /permission denied|sem efeito/);
  assert.match(await err(h.q(`update mkt_direct_deposits set status = 'pago_pedido'`)) ?? 'sem efeito', /permission denied|sem efeito/);
  assert.match(await err(h.q(`select public.mkt__direct_settle($1)`, [S.dep1])), /permission denied/);
  assert.equal((await h.rpc('mkt_pay_direct_status', [c.payment_id])).payment_status, 'pendente');
  // valor diferente do pedido → não credita nem paga
  assert.equal((await confirmDeposit(S.dep1, 'REF-X', 999)).code, 'AMOUNT_MISMATCH');
  await h.asService();
  await h.q(`update payments set status = 'em processamento', failure_reason = null where id = $1`, [S.dep1]);
  // confirmação do fornecedor (como o webhook / reconcile) → crédito + pagamento automático do pedido
  const r = await confirmDeposit(S.dep1, 'REF-1', 150);
  assert.equal(r.ok, true, JSON.stringify(r));
  await h.asService();
  assert.equal((await h.q(`select status from mkt_payments where id = $1`, [c.payment_id]))[0].status, 'confirmado');
  assert.equal((await h.q(`select status from market_orders where checkout_id = $1`, [c.checkout_id]))[0].status, 'pago');
  assert.equal((await h.q(`select status from mkt_direct_deposits where deposit_id = $1`, [S.dep1]))[0].status, 'pago_pedido');
  assert.equal(await h.balance(U.comp2), 0, '100 + 150 − 250');
  const journal = (await h.q(`select count(*)::int n from mkt_journal where payment_id = $1`, [c.payment_id]))[0].n;
  // repetição do evento / reconcile em paralelo → nada duplica
  assert.equal((await confirmDeposit(S.dep1, 'REF-1', 150)).duplicate, true);
  await h.asService();
  await h.rpc('mkt_sweep');
  assert.equal(await h.balance(U.comp2), 0);
  assert.equal((await h.q(`select count(*)::int n from mkt_journal where payment_id = $1`, [c.payment_id]))[0].n, journal);
  const [src] = await h.q(`select source from mkt_payment_events where payment_id = $1 and to_status = 'confirmado'`, [c.payment_id]);
  assert.equal(src.source, 'deposito_direto');
  await h.asUser(U.comp2);
  const st = await h.rpc('mkt_pay_direct_status', [c.payment_id]);
  assert.equal(st.payment_status, 'confirmado'); assert.equal(st.deposit.link_status, 'pago_pedido');
});

test('Parte 9: pedido já não pagável → dinheiro fica na carteira e o comprador é avisado; falha do fornecedor não cobra', { skip }, async () => {
  const c = await buy(U.comp2, S.prod, 1, 'd3');
  await h.asUser(U.comp2);
  const s = await h.rpc('mkt_pay_direct_start', [c.payment_id, 'M-Pesa', '841234567', idem('ds3')]);
  assert.equal(s.amount_mzn, 250);
  await h.asService();
  const oid = (await h.q(`select id from market_orders where checkout_id = $1`, [c.checkout_id]))[0].id;
  await h.asUser(U.comp2);
  assert.equal((await h.rpc('mkt_order_action', [oid, 'cancelar', '', '{}'])).status, 'cancelado');
  await confirmDeposit(s.deposit_id, 'REF-3', 250);
  await h.asService();
  assert.equal((await h.q(`select status from mkt_direct_deposits where deposit_id = $1`, [s.deposit_id]))[0].status, 'saldo_na_carteira');
  assert.equal(await h.balance(U.comp2), 250, 'o depósito ficou no saldo');
  assert.ok((await h.q(`select 1 from notifications where user_id = $1 and body like '%saldo da tua carteira%'`, [U.comp2])).length === 1);

  const c4 = await buy(U.comp2, S.prod, 2, 'd4'); // 500, saldo 250 → falta 250
  await h.asUser(U.comp2);
  const s4 = await h.rpc('mkt_pay_direct_start', [c4.payment_id, 'M-Pesa', '841234567', idem('ds4')]);
  assert.equal(s4.amount_mzn, 250);
  await confirmDeposit(s4.deposit_id, 'REF-4', 250, 'failed');
  await h.asService();
  assert.equal((await h.q(`select status from mkt_direct_deposits where deposit_id = $1`, [s4.deposit_id]))[0].status, 'falhou');
  assert.equal(await h.balance(U.comp2), 250, 'nada cobrado');
  assert.equal((await h.q(`select status from mkt_payments where id = $1`, [c4.payment_id]))[0].status, 'pendente', 'pode tentar de novo');
});

test('Parte 9: Edge Function payments inalterada; cliente nunca confirma pagamentos', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'lib/mkt3Api.ts'), 'utf8');
  assert.match(ui, /functions\/v1\/payments\/wallet-deposit`/);
  assert.match(ui, /mkt_pay_direct_start/);
  assert.ok(!/comp__confirm_deposit|mkt__direct_settle/.test(ui));
});

/* ---------------------------- Parte 10: Creator OS ---------------------------- */
test('Parte 10: perfil (nome, fotografia própria, apresentação) e métodos de recebimento', { skip }, async () => {
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_creator_profile_save', ['Cria Oficial', 'Vendo diamantes há 3 anos.', 'https://evil.example/a.png'])).code, 'PHOTOS');
  assert.equal((await h.rpc('mkt_creator_profile_save', ['C', '', null])).code, 'INVALID');
  const own = `https://x.supabase.co/storage/v1/object/public/media/products/${U.cria}/avatar.webp`;
  assert.equal((await h.rpc('mkt_creator_profile_save', ['Cria Oficial', 'Vendo diamantes há 3 anos.', own])).ok, true);
  const pr = await h.rpc('mkt_creator_profile');
  assert.deepEqual([pr.display_name, pr.bio, pr.avatar_url, pr.store.slug], ['Cria Oficial', 'Vendo diamantes há 3 anos.', own, 'loja-equipa']);
  assert.equal((await h.rpc('mkt_payout_method_save', ['M-Pesa', '861234567', 'Cria', false])).code, 'PHONE');
  const m1 = await h.rpc('mkt_payout_method_save', ['M-Pesa', '84 123 4567', 'Cria', false]);
  const m2 = await h.rpc('mkt_payout_method_save', ['e-Mola', '871234567', 'Cria', true]);
  assert.equal(m1.ok && m2.ok, true);
  let l = (await h.rpc('mkt_payout_methods_list')).rows;
  assert.deepEqual(l.map((x) => [x.method, x.phone, x.is_default]), [['e-Mola', '871234567', true], ['M-Pesa', '841234567', false]]);
  await h.asUser(U.fora);
  assert.equal((await h.rpc('mkt_payout_methods_list')).rows.length, 0);
  assert.equal((await h.rpc('mkt_payout_method_remove', [m1.id])).code, 'NOT_FOUND');
  assert.equal((await h.q(`select count(*)::int n from mkt_payout_methods`))[0].n, 0, 'RLS: não vê os de outros');
  await h.asUser(U.cria);
  assert.equal((await h.rpc('mkt_payout_method_remove', [m2.id])).ok, true);
  l = (await h.rpc('mkt_payout_methods_list')).rows;
  assert.equal(l[0].is_default, true, 'o restante passa a principal');
});

test('Parte 10: automações do criador — novo pedido ao criar, pagamento confirmado, cancelado por prazo; estados e nova tentativa', { skip }, async () => {
  await h.asService();
  const before = (await h.q(`select count(*)::int n from mkt_notification_log where user_id = $1 and event = 'novo_pedido'`, [U.cria]))[0].n;
  const c = await buy(U.comp, S.prod, 1, 'auto1');
  await h.asService();
  assert.equal((await h.q(`select count(*)::int n from mkt_notification_log where user_id = $1 and event = 'novo_pedido'`, [U.cria]))[0].n, before + 1);
  // prazo ultrapassado → cancelado e o criador é avisado
  await h.q(`select set_config('mkt.ctx', '1', false)`);
  await h.q(`update market_orders set expires_at = now() - interval '1 minute' where checkout_id = $1`, [c.checkout_id]);
  await h.q(`select set_config('mkt.ctx', '', false)`);
  await h.rpc('mkt_sweep');
  assert.equal((await h.q(`select status from market_orders where checkout_id = $1`, [c.checkout_id]))[0].status, 'cancelado');
  assert.ok((await h.q(`select 1 from mkt_notification_log where user_id = $1 and event = 'pedido_cancelado' and body like '%prazo%'`, [U.cria])).length === 1);
  // aviso falhado → nova tentativa no mkt_sweep
  await h.q(`insert into mkt_notification_log (user_id, event, dedupe_key, status, body, href, error) values ($1, 'stock_baixo', 'teste-falha', 'falhou', 'Stock baixo: teste', '/marketplace/criador', 'erro simulado')`, [U.cria]);
  const sw = await h.rpc('mkt_sweep');
  assert.ok(sw.notifications_retried >= 1);
  const [lg] = await h.q(`select status, attempts from mkt_notification_log where dedupe_key = 'teste-falha'`);
  assert.deepEqual([lg.status, lg.attempts], ['enviada', 2]);
  await h.asUser(U.cria);
  const a = await h.rpc('mkt_creator_automations');
  assert.equal(a.rows.length, 10);
  const by = Object.fromEntries(a.rows.map((r) => [r.event, r]));
  assert.ok(by.novo_pedido.sent >= 1); assert.ok(by.pagamento_confirmado.sent >= 1); assert.ok(by.pedido_cancelado.sent >= 1);
  assert.equal(by.stock_baixo.last.attempts, 2);
  assert.ok(by.conta.sent >= 1, 'método de recebimento guardado → aviso de conta');
});

test('Parte 10: reclamações sobre as minhas vendas e KPIs a partir de pedidos reais', { skip }, async () => {
  await h.asUser(U.comp);
  const d = await h.rpc('mkt_dispute_open', [S.order, 'diferente', 'O código entregue não funciona no jogo.', []]);
  assert.equal(d.ok, true, JSON.stringify(d));
  await h.asUser(U.cria);
  const r = await h.rpc('mkt_creator_disputes', [true]);
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].buyer_handle, 'comp'); assert.equal(r.rows[0].order_id, S.order);
  await h.asUser(U.fora);
  assert.equal((await h.rpc('mkt_creator_disputes', [false])).rows.length, 0);
  await h.asUser(U.cria);
  const k = (await h.rpc('mkt_creator_dashboard', [null, null])).kpi;
  await h.asService();
  const [real] = await h.q(`select count(*) filter (where status not in ('criado','aguarda_pagamento','cancelado'))::int as orders, count(*) filter (where status = 'cancelado')::int as canc
    from market_orders where seller_id = $1`, [U.cria]);
  assert.equal(k.orders, real.orders); assert.ok(k.cancelled >= real.canc);
});
