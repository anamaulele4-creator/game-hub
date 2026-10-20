// Testes do SQL de moderadores/afiliados/verificação (supabase/migrations/2026-10-20-moderador-afiliados.sql)
// numa base Postgres real em memória (PGlite). Não toca em nenhuma base de dados remota. Correr: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let PGlite, pgcrypto;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
  ({ pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto'));
} catch { /* sem PGlite: testes ignorados */ }

const MIG = 'supabase/migrations/2026-10-20-moderador-afiliados.sql';
const FILES = [
  'tests/sql/supabase-stub.sql', 'supabase/schema.sql',
  'supabase/migrations/2026-10-08-profile-handle.sql', 'supabase/migrations/2026-10-08-clip-media.sql', 'supabase/migrations/2026-10-08-chat-groups-calls.sql',
  'supabase/migrations/2026-10-09-ai-core.sql', 'supabase/migrations/2026-10-10-tournaments-market.sql', 'supabase/migrations/2026-10-10-market-escrow.sql',
  'supabase/migrations/2026-10-10-bets.sql', 'supabase/migrations/2026-10-10-bets-money.sql', 'supabase/migrations/2026-10-10-team-logos.sql',
  'supabase/competitive.sql', MIG, MIG, // duas vezes = idempotente
];
const skip = !PGlite;
let db;
const U = {};

async function asUser(id, aal = 'aal1') {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [id ?? '', JSON.stringify({ sub: id, aal })]);
  if (id) await db.query(`set role authenticated`);
}
async function asService() {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{}', false)`);
}
async function rpc(fn, args = []) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await db.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r;
}
async function q(sql, args = []) { return (await db.query(sql, args)).rows; }
async function mk(k, meta = {}) {
  await asService();
  const id = crypto.randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${k}@t.mz`, JSON.stringify({ handle: k, name: k, birth: '1995-01-01', province: 'Maputo Cidade', ...meta })]);
  U[k] = id; return id;
}
const ledger = (u) => q(`select delta, reason, ref from money_ledger where user_id = $1 order by id`, [u]);

before(async () => {
  if (skip) return;
  db = new PGlite({ extensions: { pgcrypto } });
  for (const f of FILES) await db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  await mk('chefe'); await db.query(`update profiles set role = 'admin' where id = $1`, [U.chefe]);
  await mk('influ'); await db.query(`update profiles set role = 'moderator' where id = $1`, [U.influ]);
  await mk('normal');
  await mk('criad'); await db.query(`update profiles set role = 'creator' where id = $1`, [U.criad]);
});

test('SQL afiliados: migração idempotente, comissão por omissão 10 %', { skip }, async () => {
  const [s] = await q(`select commission_pct, enabled from affiliate_settings`);
  assert.equal(Number(s.commission_pct), 10); assert.equal(s.enabled, true);
});

test('SQL afiliados: só moderador/admin têm código; registo com ?ref= guarda o padrinho uma vez', { skip }, async () => {
  await asUser(U.influ);
  const me = await rpc('affiliate_me');
  assert.equal(me.eligible, true); assert.match(me.code, /^[A-Z0-9]{4,16}$/);
  U.code = me.code;
  assert.equal((await rpc('affiliate_me')).code, U.code, 'código estável');
  await asUser(U.normal);
  const n = await rpc('affiliate_me'); assert.equal(n.eligible, false); assert.equal(n.code, null);
  // registo pelo link
  await mk('conv', { ref: U.code.toLowerCase() });
  const [p] = await q(`select referred_by from profiles where id = $1`, [U.conv]); assert.equal(p.referred_by, U.influ);
  // cliente não consegue mudar o padrinho nem o código
  await asUser(U.conv);
  await db.query(`update profiles set referred_by = $1, affiliate_code = 'HACK1234' where id = $2`, [U.normal, U.conv]);
  const [p2] = await q(`select referred_by, affiliate_code from profiles where id = $1`, [U.conv]); assert.equal(p2.referred_by, U.influ); assert.equal(p2.affiliate_code, null);
  assert.equal((await rpc('affiliate_apply_code', [U.code])).code, 'ALREADY');
  // código escrito depois do registo (Google/OTP): uma vez, sem auto-convite
  await mk('tardio');
  await asUser(U.influ); assert.equal((await rpc('affiliate_apply_code', [U.code])).code, 'SELF');
  await asUser(U.tardio);
  assert.equal((await rpc('affiliate_apply_code', ['NAOEXISTE1'])).code, 'NOT_FOUND');
  assert.equal((await rpc('affiliate_apply_code', ['a'])).code, 'INVALID');
  assert.equal((await rpc('affiliate_apply_code', [U.code])).ok, true);
  assert.equal((await rpc('affiliate_apply_code', [U.code])).code, 'ALREADY');
  // auto-referência impossível mesmo no registo
  await asService();
  await assert.rejects(db.query(`update profiles set referred_by = id where id = $1`, [U.normal]), /no_self_referral/);
});

test('SQL afiliados: 10 % só do lucro de apostas ganhas; nada em perdas; idempotente; reabrir anula', { skip }, async () => {
  await asService();
  const [b] = await q(`insert into bets (user_id, kind, stake, total_odds, potential, currency) values ($1, 'simples', 100, 2.00, 200, 'mt') returning id, version`, [U.conv]);
  await db.query(`update bets set status = 'ganha', payout = 200 where id = $1`, [b.id]);
  let c = await q(`select * from affiliate_commissions where source_ref = $1`, [`${b.id}:1`]);
  assert.equal(c.length, 1); assert.equal(c[0].gain_mzn, 100); assert.equal(c[0].amount_mzn, 10); assert.equal(c[0].referrer_id, U.influ);
  assert.deepEqual((await ledger(U.influ)).map((l) => [l.delta, l.reason]), [[10, 'comissao_afiliado']]);
  assert.equal((await ledger(U.conv)).length, 0, 'o convidado não perde nada (a plataforma paga a comissão)');
  // idempotência
  await db.query(`update bets set status = 'ganha' where id = $1`, [b.id]);
  assert.equal(await rpc('affiliate__credit', [U.conv, 'aposta', `${b.id}:1`, 100]), 0);
  assert.equal((await q(`select count(*)::int n from affiliate_commissions`))[0].n, 1);
  // aposta perdida e aposta em pontos: nada
  const [l] = await q(`insert into bets (user_id, kind, stake, total_odds, potential, currency) values ($1, 'simples', 100, 2.00, 200, 'mt') returning id`, [U.conv]);
  await db.query(`update bets set status = 'perdida' where id = $1`, [l.id]);
  const [pts] = await q(`insert into bets (user_id, kind, stake, total_odds, potential, currency) values ($1, 'simples', 100, 2.00, 200, 'pontos') returning id`, [U.conv]);
  await db.query(`update bets set status = 'ganha', payout = 200 where id = $1`, [pts.id]);
  assert.equal((await q(`select count(*)::int n from affiliate_commissions`))[0].n, 1);
  // aposta reaberta (resultado corrigido) → comissão anulada com lançamento de correção
  await db.query(`update bets set version = version + 1, status = 'aberta', payout = 0 where id = $1`, [b.id]);
  c = await q(`select status from affiliate_commissions where source_ref = $1`, [`${b.id}:1`]); assert.equal(c[0].status, 'anulado');
  assert.deepEqual((await ledger(U.influ)).map((x) => x.delta), [10, -10]);
});

test('SQL afiliados: depósitos, compras e registos não pagam; padrinho não-moderador não ganha', { skip }, async () => {
  await asService();
  for (const k of ['deposito', 'compra', 'registo', 'perda']) assert.equal(await rpc('affiliate__credit', [U.conv, k, 'x-' + k, 500]), 0);
  assert.equal(await rpc('affiliate__credit', [U.conv, 'aposta', 'neg', -5]), 0);
  // convidado de um utilizador normal (padrinho sem função de moderador)
  await mk('amigo');
  await db.query(`update profiles set referred_by = $1 where id = $2`, [U.normal, U.amigo]);
  assert.equal(await rpc('affiliate__credit', [U.amigo, 'aposta', 'amigo-1', 1000]), 0);
  // criador também não ganha
  await mk('fa'); await db.query(`update profiles set referred_by = $1 where id = $2`, [U.criad, U.fa]);
  assert.equal(await rpc('affiliate__credit', [U.fa, 'venda', 'fa-1', 1000]), 0);
  assert.equal((await ledger(U.normal)).length, 0);
  // moderador despromovido deixa de ganhar
  await db.query(`update profiles set role = 'user' where id = $1`, [U.influ]);
  assert.equal(await rpc('affiliate__credit', [U.conv, 'aposta', 'demoted', 1000]), 0);
  await db.query(`update profiles set role = 'moderator' where id = $1`, [U.influ]);
});

test('SQL afiliados: venda concluída (sem taxa), prémio de campeonato e % configurável pelo admin', { skip }, async () => {
  await asService();
  await db.query(`update market_settings set fee_pct = 10 where id = 1`);
  const [p] = await q(`insert into market_products (seller_id, category, kind, title, price_mzn, photos, status) values ($1, 'ff', 'itens', 'Skin rara', 500, array['art:ff'], 'ativo') returning id`, [U.conv]);
  const [o] = await q(`insert into market_orders (product_id, product_title, buyer_id, seller_id, qty, unit_price_mzn, total_mzn, fee_pct, status) values ($1, 'Skin rara', $2, $3, 2, 500, 1000, 10, 'entregue') returning id`, [p.id, U.normal, U.conv]);
  await asUser(U.influ);
  assert.equal((await rpc('affiliate_me')).pending, 90, 'pendente = 10 % de (1000 − 10 %)');
  await asUser(U.normal);
  assert.equal((await rpc('market_order_action', [o.id, 'confirmar_rececao', ''])).ok, true);
  await asService();
  let [c] = await q(`select gain_mzn, amount_mzn, source_kind from affiliate_commissions where source_ref = $1`, [o.id]);
  assert.deepEqual([c.gain_mzn, c.amount_mzn, c.source_kind], [900, 90, 'venda']);
  // admin muda para 20 %; não-admin não pode
  await asUser(U.influ); assert.equal((await rpc('affiliate_admin_set_settings', [20, true])).code, 'FORBIDDEN');
  await asUser(U.chefe); assert.equal((await rpc('affiliate_admin_set_settings', [60, true])).code, 'PCT');
  assert.equal((await rpc('affiliate_admin_set_settings', [20, true])).ok, true);
  await asService();
  await db.query(`insert into tournaments (id, name, game, kind, prize_mzn) values ('camp1', 'Campeonato FF', 'Free Fire', 'campeonato', 300)`);
  await db.query(`insert into tournament_prizes (tournament_id, user_id, place, amount_mzn) values ('camp1', $1, 1, 300)`, [U.conv]);
  [c] = await q(`select amount_mzn, source_kind, pct from affiliate_commissions where source_kind = 'campeonato'`);
  assert.deepEqual([c.amount_mzn, c.source_kind, Number(c.pct)], [60, 'campeonato', 20]);
  await asUser(U.influ);
  const me = await rpc('affiliate_me');
  assert.equal(me.invited_count, 2); assert.equal(me.total, 150); assert.equal(me.pending, 0);
  assert.ok(me.commissions.some((x) => x.status === 'anulado'));
  // ninguém escreve diretamente no livro de comissões
  await assert.rejects(db.query(`insert into affiliate_commissions (referrer_id, invitee_id, source_kind, source_ref, gain_mzn, pct, amount_mzn) values ($1, $2, 'aposta', 'x', 1, 10, 1)`, [U.influ, U.conv]), /permission denied/);
  await asUser(U.conv);
  assert.equal((await q(`select * from affiliate_commissions`)).length, 0, 'o convidado não vê as comissões do padrinho');
  await asUser(U.chefe); await rpc('affiliate_admin_set_settings', [10, true]);
});

test('SQL permissões: só moderador/admin criam torneios e campeonatos; utilizador e criador só participam', { skip }, async () => {
  await asUser(U.normal);
  await assert.rejects(db.query(`insert into tournaments (id, name, game) values ('tn1', 'X', 'Free Fire')`), /row-level security/);
  await asUser(U.criad);
  await assert.rejects(db.query(`insert into tournaments (id, name, game) values ('tc1', 'X', 'Free Fire')`), /row-level security/);
  await asUser(U.influ);
  await db.query(`insert into tournaments (id, name, game, kind, organizer, entries_count) values ('tm1', 'Taça Influ', 'Free Fire', 'campeonato', 'TXAPILOG', 99)`);
  let [t] = await q(`select created_by, organizer, entries_count, kind from tournaments where id = 'tm1'`);
  assert.equal(t.created_by, U.influ); assert.equal(t.organizer, '@influ'); assert.equal(t.entries_count, 0); assert.equal(t.kind, 'campeonato');
  await db.query(`update tournaments set name = 'Taça Influ 2', status = 'a decorrer', created_by = $1 where id = 'tm1'`, [U.chefe]);
  [t] = await q(`select name, created_by from tournaments where id = 'tm1'`); assert.equal(t.name, 'Taça Influ 2'); assert.equal(t.created_by, U.influ);
  const r = await db.query(`update tournaments set name = 'roubado' where id = 'camp1'`); assert.equal(r.affectedRows, 0, 'não edita torneios de outros');
  await db.query(`update tournaments set status = 'aberto' where id = 'tm1'`);
  // utilizador inscreve-se (participa) e o moderador gere a inscrição do seu torneio
  await asUser(U.normal);
  assert.equal((await rpc('tournament_register', ['tm1', 'Normal', '123456', '', '841234567', null, false])).ok, true);
  await asUser(U.influ);
  assert.equal((await q(`select * from tournament_entries where tournament_id = 'tm1'`)).length, 1);
  assert.equal((await rpc('tournament_entry_admin', [U.normal, 'tm1', 'confirmar'])).ok, true);
  assert.equal((await rpc('tournament_entry_admin', [U.normal, 'camp1', 'confirmar'])).code, 'FORBIDDEN');
  const [cnt] = await q(`select entries_count from tournaments where id = 'tm1'`); assert.equal(cnt.entries_count, 1);
  await asUser(U.chefe);
  await db.query(`insert into tournaments (id, name, game) values ('ta1', 'Admin Cup', 'Free Fire')`);
});

test('SQL verificação: contas e diamantes só com documento + selfie aprovados', { skip }, async () => {
  await asUser(U.normal);
  await assert.rejects(db.query(`insert into market_products (category, kind, title, price_mzn, photos) values ('ff', 'conta', 'Conta FF', 100, array['art:ff'])`), /SELLER_VERIFICATION/);
  await assert.rejects(db.query(`insert into market_products (category, kind, title, price_mzn, photos) values ('moedas', 'itens', 'Diamantes', 100, array['art:ff'])`), /SELLER_VERIFICATION/);
  const [ok] = await q(`insert into market_products (category, kind, title, price_mzn, photos) values ('ff', 'itens', 'Skin', 100, array['art:ff']) returning id`);
  await assert.rejects(db.query(`update market_products set kind = 'conta' where id = $1`, [ok.id]), /SELLER_VERIFICATION/);
  assert.equal((await rpc('seller_verification_me')).status, 'nenhuma');
  assert.equal((await rpc('seller_verification_submit', [`${U.normal}/doc.webp`, `${U.normal}/selfie.webp`])).code, 'FILES', 'ficheiros têm de existir');
  await asService();
  await db.query(`insert into storage.objects (bucket_id, name) values ('verificacoes', $1), ('verificacoes', $2)`, [`${U.normal}/doc.webp`, `${U.normal}/selfie.webp`]);
  await asUser(U.normal);
  assert.equal((await rpc('seller_verification_submit', [`${U.chefe}/doc.webp`, `${U.normal}/selfie.webp`])).code, 'FILES', 'pasta de outro utilizador');
  assert.equal((await rpc('seller_verification_submit', [`${U.normal}/doc.webp`, `${U.normal}/selfie.webp`])).ok, true);
  assert.equal((await rpc('seller_verification_review', [U.normal, true, ''])).code, 'FORBIDDEN');
  await assert.rejects(db.query(`insert into market_products (category, kind, title, price_mzn, photos) values ('ff', 'conta', 'Conta FF', 100, array['art:ff'])`), /SELLER_VERIFICATION/, 'pendente ainda não vende');
  await asUser(U.chefe);
  const list = await rpc('seller_verification_admin_list', ['pendente']); assert.equal(list.items.length, 1);
  assert.equal((await rpc('seller_verification_review', [U.normal, false, 'x'])).code, 'REASON');
  assert.equal((await rpc('seller_verification_review', [U.normal, false, 'Foto do documento ilegível'])).ok, true);
  await asUser(U.normal);
  assert.equal((await rpc('seller_verification_me')).status, 'rejeitado');
  assert.equal((await rpc('seller_verification_submit', [`${U.normal}/doc.webp`, `${U.normal}/selfie.webp`])).status, 'pendente');
  await asUser(U.chefe); assert.equal((await rpc('seller_verification_review', [U.normal, true, ''])).ok, true);
  await asUser(U.normal);
  await db.query(`insert into market_products (category, kind, title, price_mzn, photos) values ('ff', 'conta', 'Conta FF', 100, array['art:ff'])`);
  await asService();
  assert.equal((await q(`select count(*)::int n from storage.objects o where o.bucket_id = 'verificacoes'`))[0].n, 2);
  const [bk] = await q(`select public from storage.buckets where id = 'verificacoes'`); assert.equal(bk.public, false, 'bucket privado');
});

test('SQL destaque: moderador destaca os seus anúncios; utilizador não; admin pode retirar', { skip }, async () => {
  await asUser(U.normal);
  const [n] = await q(`select id from market_products where seller_id = $1 and kind = 'itens' limit 1`, [U.normal]);
  await assert.rejects(db.query(`update market_products set featured = true where id = $1`, [n.id]), /FEATURE_FORBIDDEN/);
  await asUser(U.influ);
  const [m] = await q(`insert into market_products (category, kind, title, price_mzn, photos, featured) values ('ff', 'itens', 'Pack', 50, array['art:ff'], true) returning id, featured`);
  assert.equal(m.featured, true);
  await db.query(`update market_products set featured = false where id = $1`, [m.id]);
  await db.query(`update market_products set featured = true where id = $1`, [m.id]);
  const r = await db.query(`update market_products set featured = false where id = $1`, [n.id]); assert.equal(r.affectedRows, 0, 'nunca o anúncio de outro');
  await asUser(U.chefe);
  await db.query(`update profiles set feature_revoked = true where id = $1`, [U.influ]);
  await asUser(U.influ);
  const [after] = await q(`select featured from market_products where id = $1`, [m.id]); assert.equal(after.featured, false);
  await assert.rejects(db.query(`update market_products set featured = true where id = $1`, [m.id]), /FEATURE_FORBIDDEN/);
  await db.query(`update profiles set feature_revoked = false where id = $1`, [U.influ]);
  const [still] = await q(`select feature_revoked from profiles where id = $1`, [U.influ]); assert.equal(still.feature_revoked, true, 'só o admin devolve a permissão');
});
