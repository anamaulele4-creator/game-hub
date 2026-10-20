// Testes do SQL de Apostas v2 (supabase/migrations/2026-10-20-apostas-v2.sql) e da venda de contas só por criadores
// (supabase/migrations/2026-10-20-venda-contas.sql) numa base Postgres real em memória (PGlite). Não toca em nenhuma base remota.
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

const MIG = 'supabase/migrations/2026-10-20-apostas-v2.sql';
const CONTAS = 'supabase/migrations/2026-10-20-venda-contas.sql';
const FILES = [
  'tests/sql/supabase-stub.sql', 'supabase/schema.sql',
  'supabase/migrations/2026-10-08-profile-handle.sql', 'supabase/migrations/2026-10-08-clip-media.sql', 'supabase/migrations/2026-10-08-chat-groups-calls.sql',
  'supabase/migrations/2026-10-09-ai-core.sql', 'supabase/migrations/2026-10-10-tournaments-market.sql', 'supabase/migrations/2026-10-10-market-escrow.sql',
  'supabase/migrations/2026-10-10-bets.sql', 'supabase/migrations/2026-10-10-bets-money.sql', 'supabase/migrations/2026-10-10-team-logos.sql',
  'supabase/competitive.sql', 'supabase/migrations/2026-10-20-moderador-afiliados.sql',
  MIG, MIG, CONTAS, CONTAS, // duas vezes = idempotente
];
const skip = !PGlite;
let db;
const U = {};

async function asUser(id) {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [id ?? '', JSON.stringify({ sub: id, aal: 'aal1' })]);
  if (id) await db.query(`set role authenticated`);
}
async function asService() {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{}', false)`);
}
async function rpc(fn, args = [], casts = []) {
  const ph = args.map((_, i) => `$${i + 1}${casts[i] ? '::' + casts[i] : ''}`).join(', ');
  return (await db.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r;
}
async function q(sql, args = []) { return (await db.query(sql, args)).rows; }
async function mk(k, role = 'user') {
  await asService();
  const id = crypto.randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${k}@t.mz`, JSON.stringify({ handle: k, name: k, birth: '1995-01-01', province: 'Maputo Cidade' })]);
  if (role !== 'user') await db.query(`update profiles set role = $2 where id = $1`, [id, role]);
  U[k] = id; return id;
}
const balance = async (u) => (await q(`select public.apv2__balance($1) as b`, [u]))[0].b;
const ALL = ['markets', 'odds', 'settle', 'toggle', 'permissions'];
let M, S1, S2;

before(async () => {
  if (skip) return;
  db = new PGlite({ extensions: { pgcrypto } });
  for (const f of FILES) await db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  await mk('dono', 'admin'); await mk('mod', 'moderator'); await mk('jog'); await mk('jog2'); await mk('criad', 'creator');
});

test('Apostas v2: interruptor desligado por omissão, legível por todos, só RPC muda', { skip }, async () => {
  await asUser(null);
  const r = await q(`select value from app_settings where key = 'apostas_enabled'`);
  assert.equal(r[0].value, false);
  await asUser(U.jog);
  await assert.rejects(q(`update app_settings set value = 'true' where key = 'apostas_enabled'`));
  assert.equal((await rpc('app_setting_set', ['apostas_enabled', 'true'], [null, 'jsonb'])).code, 'FORBIDDEN');
  // admin sem a permissão 'toggle' também não liga
  await asUser(U.dono);
  assert.equal((await rpc('app_setting_set', ['apostas_enabled', 'true'], [null, 'jsonb'])).code, 'FORBIDDEN');
});

test('Apostas v2: com o sistema desligado as funções do utilizador recusam no servidor (e public.bets também)', { skip }, async () => {
  await asUser(U.jog);
  assert.equal((await rpc('apv2_me')).enabled, false);
  assert.equal((await rpc('apv2_claim_test_balance')).code, 'DISABLED');
  assert.equal((await rpc('apv2_place', [crypto.randomUUID(), 50, 2], [null, 'numeric', 'numeric'])).code, 'DISABLED');
  await asService();
  await assert.rejects(q(`insert into bets (user_id, kind, stake, total_odds, potential) values ($1, 'simples', 10, 2, 20)`, [U.jog]), /APOSTAS_DESATIVADAS/);
});

test('Apostas v2: permissões — admin distribui; utilizador normal nada; só admin/moderador recebem', { skip }, async () => {
  await asUser(U.jog);
  assert.equal((await rpc('apv2_admin_grant', [U.jog, 'markets', true])).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_admin_view')).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_admin_create_market', ['Mercado', 'ff', null, JSON.stringify([{ label: 'A', odds: 2 }, { label: 'B', odds: 2 }])], [null, null, 'timestamptz', 'jsonb'])).code, 'FORBIDDEN');
  await asUser(U.dono);
  for (const p of ALL) assert.equal((await rpc('apv2_admin_grant', [U.dono, p, true])).ok, true);
  assert.equal((await rpc('apv2_admin_grant', [U.jog, 'settle', true])).code, 'ROLE');
  assert.equal((await rpc('apv2_admin_grant', [U.mod, 'odds', true])).ok, true);
  const v = await rpc('apv2_admin_view');
  assert.deepEqual([...v.my_perms].sort(), [...ALL].sort());
  // moderador só com 'odds': não cria mercados nem liga o sistema
  await asUser(U.mod);
  assert.equal((await rpc('apv2_admin_create_market', ['X', 'ff', null, '[]'], [null, null, 'timestamptz', 'jsonb'])).code, 'FORBIDDEN');
  assert.equal((await rpc('app_setting_set', ['apostas_enabled', 'true'], [null, 'jsonb'])).code, 'FORBIDDEN');
  // inserção direta nas tabelas: recusada pelo RLS/grants
  await assert.rejects(q(`insert into apv2_permissions (user_id, perm) values ($1, 'toggle')`, [U.mod]));
  await asUser(U.jog);
  await assert.rejects(q(`insert into apv2_markets (title) values ('hack')`));
});

test('Apostas v2: ligar fica na auditoria (quem, antes/depois)', { skip }, async () => {
  await asUser(U.dono);
  assert.equal((await rpc('app_setting_set', ['apostas_enabled', 'true'], [null, 'jsonb'])).ok, true);
  const a = await q(`select actor_handle, before, after from app_audit_log where action = 'definicao:apostas_enabled' order by id desc limit 1`);
  assert.equal(a[0].actor_handle, 'dono');
  assert.deepEqual(a[0].before, { value: false });
  assert.deepEqual(a[0].after, { value: true });
  await assert.rejects(q(`delete from app_audit_log`));
  const c = await rpc('apv2_admin_create_market', ['Final FF: Fênix vs Raio', 'ff', null, JSON.stringify([{ label: 'Fênix', odds: 1.8 }, { label: 'Raio', odds: 2.1 }])], [null, null, 'timestamptz', 'jsonb']);
  assert.equal(c.ok, true);
  M = c.id;
  [S1, S2] = (await q(`select id from apv2_selections where market_id = $1 order by sort`, [M])).map((r) => r.id);
  assert.ok((await q(`select 1 from app_audit_log where action = 'criar_mercado' and target = $1`, [M])).length);
});

test('Apostas v2: valor escolhido — inteiro, positivo, mín./máx., ≤ saldo de teste', { skip }, async () => {
  await asUser(U.jog);
  assert.equal((await rpc('apv2_claim_test_balance')).balance, 1000);
  assert.equal((await rpc('apv2_claim_test_balance')).balance, 1000, 'saldo inicial só uma vez');
  const place = (stake, odds = 1.8, sel = S1) => rpc('apv2_place', [sel, stake, odds], [null, 'numeric', 'numeric']);
  assert.equal((await place(0)).code, 'STAKE_POSITIVE');
  assert.equal((await place(-5)).code, 'STAKE_POSITIVE');
  assert.equal((await place(10.5)).code, 'STAKE_INT');
  assert.equal((await place(5)).code, 'STAKE_MIN');
  assert.equal((await place(5001)).code, 'STAKE_MAX');
  assert.equal((await place(1500)).code, 'BALANCE');
  const ok = await place(100);
  assert.equal(ok.ok, true); assert.equal(ok.potential, 180); assert.equal(ok.balance, 900);
  assert.equal(await balance(U.jog), 900);
  const [row] = await q(`select currency from apv2_bets where id = $1`, [ok.bet]);
  assert.equal(row.currency, 'teste');
});

test('Apostas v2: odd trancada na confirmação; se mudou, recusa e devolve a nova', { skip }, async () => {
  await asUser(U.mod); // moderador com 'odds'
  assert.equal((await rpc('apv2_admin_set_odds', [S2, 2.5], [null, 'numeric'])).odds_version, 2);
  await asUser(U.jog);
  const r = await rpc('apv2_place', [S2, 100, 2.1], [null, 'numeric', 'numeric']);
  assert.equal(r.ok, false); assert.equal(r.code, 'ODDS_CHANGED'); assert.equal(Number(r.odds), 2.5);
  assert.equal(await balance(U.jog), 900, 'nada debitado');
  const req = crypto.randomUUID();
  const ok = await rpc('apv2_place', [S2, 200, 2.5, req], [null, 'numeric', 'numeric', 'uuid']);
  assert.equal(ok.ok, true); assert.equal(ok.potential, 500);
  const again = await rpc('apv2_place', [S2, 200, 2.5, req], [null, 'numeric', 'numeric', 'uuid']);
  assert.equal(again.replay, true); assert.equal(again.bet, ok.bet);
  assert.equal(await balance(U.jog), 700, 'repetição do mesmo pedido não debita 2x');
  // a odd muda depois: a aposta mantém a cópia
  await asUser(U.dono);
  await rpc('apv2_admin_set_odds', [S2, 3], [null, 'numeric']);
  const [b] = await q(`select odds_locked, potential from apv2_bets where id = $1`, [ok.bet]);
  assert.equal(Number(b.odds_locked), 2.5); assert.equal(b.potential, 500);
  await asService();
  await assert.rejects(q(`update apv2_bets set odds_locked = 9 where id = $1`, [ok.bet]), /BET_LOCKED/);
  assert.ok((await q(`select 1 from app_audit_log where action = 'mudar_odd' and (before->>'odds')::numeric = 2.5`)).length);
});

test('Apostas v2: liquidação individual idempotente (ganha/perdida/anulada/reembolsada) — nunca credita 2x', { skip }, async () => {
  await asUser(U.jog2);
  await rpc('apv2_claim_test_balance');
  const a = await rpc('apv2_place', [S1, 100, 1.8], [null, 'numeric', 'numeric']);
  const b = await rpc('apv2_place', [S1, 50, 1.8], [null, 'numeric', 'numeric']);
  const c = await rpc('apv2_place', [S1, 20, 1.8], [null, 'numeric', 'numeric']);
  assert.equal(await balance(U.jog2), 830);
  assert.equal((await rpc('apv2_admin_settle_bet', [a.bet, 'won'])).code, 'FORBIDDEN');
  await asUser(U.mod);
  assert.equal((await rpc('apv2_admin_settle_bet', [a.bet, 'won'])).code, 'FORBIDDEN', 'moderador sem settle');
  await asUser(U.dono);
  const w = await rpc('apv2_admin_settle_bet', [a.bet, 'won']);
  assert.equal(w.payout, 180);
  const w2 = await rpc('apv2_admin_settle_bet', [a.bet, 'won']);
  assert.equal(w2.already, true);
  assert.equal((await rpc('apv2_admin_settle_bet', [a.bet, 'void'])).code, 'ALREADY_SETTLED');
  assert.equal((await rpc('apv2_admin_settle_bet', [b.bet, 'refund'])).payout, 50);
  assert.equal((await rpc('apv2_admin_settle_bet', [c.bet, 'lost'])).payout, 0);
  assert.equal(await balance(U.jog2), 830 + 180 + 50);
  const credits = await q(`select count(*)::int as n from apv2_test_ledger where user_id = $1 and reason = 'liquidacao'`, [U.jog2]);
  assert.equal(credits[0].n, 2);
  // mercado inteiro: Raio ganha → as apostas abertas em Fênix (do jog) perdem, em Raio ganham
  const m = await rpc('apv2_admin_settle_market', [M, S2], [null, 'uuid']);
  assert.equal(m.ok, true);
  assert.equal(await balance(U.jog), 700 + 500);
  assert.equal((await rpc('apv2_admin_settle_market', [M, S2], [null, 'uuid'])).already, true);
  assert.equal(await balance(U.jog), 1200, 'liquidar o mercado outra vez não paga 2x');
  const n = await q(`select count(*)::int as n from app_audit_log where action = 'liquidar_aposta'`);
  assert.ok(n[0].n >= 5);
  await asUser(U.jog);
  assert.equal((await rpc('apv2_place', [S1, 50, 1.8], [null, 'numeric', 'numeric'])).code, 'CLOSED');
});

test('Apostas v2: utilizador só vê as próprias apostas e o próprio saldo (RLS)', { skip }, async () => {
  await asUser(U.jog);
  const mine = await q(`select distinct user_id from apv2_bets`);
  assert.deepEqual(mine.map((r) => r.user_id), [U.jog]);
  assert.equal((await q(`select * from app_audit_log`)).length, 0);
  // desligar outra vez: volta a recusar
  await asUser(U.dono);
  await rpc('app_setting_set', ['apostas_enabled', 'false'], [null, 'jsonb']);
  await asUser(U.jog);
  assert.equal((await rpc('apv2_place', [S1, 50, 1.8], [null, 'numeric', 'numeric'])).code, 'DISABLED');
});

/* ---------------- Venda de contas só por criadores ---------------- */
let CUR = null;
const as = async (k) => { CUR = U[k]; await asUser(U[k]); };
async function listing(kind, extra = {}) {
  const uid = CUR;
  return q(`insert into market_products (seller_id, game_key, category, kind, title, price_mzn, photos)
            values ($1, 'ff', 'ff', $2, $3, 100, array['art:ff']) returning id`, [uid, kind, extra.title ?? 'Conta FF nível 70']);
}

test('Contas: utilizador normal e moderador recusados no servidor; criador e admin podem', { skip }, async () => {
  await asService();
  for (const k of ['jog', 'criad', 'mod']) await q(`insert into seller_verifications (user_id, status, doc_path, selfie_path) values ($1, 'aprovado', 'd', 's') on conflict do nothing`, [U[k]]);
  await as('jog');
  await assert.rejects(listing('conta'), /CONTAS_CRIADOR/);
  assert.equal((await listing('itens', { title: 'Skin rara' })).length, 1, 'outros tipos continuam a funcionar');
  await as('mod');
  await assert.rejects(listing('conta'), /CONTAS_CRIADOR/);
  await as('dono');
  assert.equal((await listing('conta')).length, 1);
  await as('criad');
  assert.equal((await listing('conta')).length, 1, 'criador verificado publica contas');
});

test('Contas: utilizador normal não muda um anúncio para conta (update)', { skip }, async () => {
  await as('jog');
  const [it] = await q(`select id from market_products where seller_id = $1 and kind = 'itens' limit 1`, [U.jog]);
  await assert.rejects(q(`update market_products set kind = 'conta' where id = $1`, [it.id]), /CONTAS_CRIADOR/);
});

test('Contas: interruptor venda_contas_enabled — só admin muda, com auditoria; desligado bloqueia criadores', { skip }, async () => {
  await asUser(null);
  assert.equal((await q(`select value from app_settings where key = 'venda_contas_enabled'`))[0].value, true);
  await as('criad');
  assert.equal((await rpc('app_setting_set', ['venda_contas_enabled', 'false'], [null, 'jsonb'])).code, 'FORBIDDEN');
  await as('dono');
  assert.equal((await rpc('app_setting_set', ['venda_contas_enabled', 'false'], [null, 'jsonb'])).ok, true);
  assert.equal((await rpc('app_setting_set', ['venda_contas_enabled', '"x"'], [null, 'jsonb'])).code, 'INVALID');
  assert.ok((await q(`select 1 from app_audit_log where area = 'definicoes' and action = 'definicao:venda_contas_enabled'`)).length);
  await asService();
  await q(`update profiles set role = 'creator' where id = $1`, [U.jog2]);
  await as('jog2');
  await assert.rejects(listing('conta'), /CONTAS_OFF/);
  await as('dono');
  assert.equal((await listing('conta', { title: 'Conta do admin' })).length, 1, 'admin continua a poder');
  await rpc('app_setting_set', ['venda_contas_enabled', 'true'], [null, 'jsonb']);
});
