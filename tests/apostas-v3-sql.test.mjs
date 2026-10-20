// Testes do SQL de Apostas v3 (supabase/migrations/2026-10-21-apostas-v3.sql) numa base Postgres real em memória
// (PGlite). Corre por cima da v2 e verifica também o rollback. Não toca em nenhuma base remota.
// Nota honesta: o PGlite tem uma só ligação, por isso "pedidos simultâneos" aqui são pedidos disparados ao mesmo tempo
// e executados em série pelo motor; a garantia real em produção vem das trancas (FOR UPDATE + advisory lock) e do
// CHECK balance_after >= 0 do livro-razão, que também são exercitados aqui.
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

const V2 = 'supabase/migrations/2026-10-20-apostas-v2.sql';
const V3 = 'supabase/migrations/2026-10-21-apostas-v3.sql';
const DOWN = 'supabase/migrations/rollback/2026-10-21-apostas-v3-down.sql';
const FILES = [
  'tests/sql/supabase-stub.sql', 'supabase/schema.sql',
  'supabase/migrations/2026-10-08-profile-handle.sql', 'supabase/migrations/2026-10-08-clip-media.sql', 'supabase/migrations/2026-10-08-chat-groups-calls.sql',
  'supabase/migrations/2026-10-09-ai-core.sql', 'supabase/migrations/2026-10-10-tournaments-market.sql', 'supabase/migrations/2026-10-10-market-escrow.sql',
  'supabase/migrations/2026-10-10-bets.sql', 'supabase/migrations/2026-10-10-bets-money.sql', 'supabase/migrations/2026-10-10-team-logos.sql',
  'supabase/competitive.sql', 'supabase/migrations/2026-10-20-moderador-afiliados.sql',
  V2, V3, V3, // duas vezes = idempotente
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
async function mk(k, role = 'user', birth = '1995-01-01') {
  await asService();
  const id = crypto.randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${k}@t.mz`, JSON.stringify({ handle: k, name: k, birth, province: 'Maputo Cidade' })]);
  if (role !== 'user') await db.query(`update profiles set role = $2 where id = $1`, [id, role]);
  U[k] = id; return id;
}
const balance = async (u) => (await q(`select public.apv2__balance($1) as b`, [u]))[0].b;
const C4 = [null, 'numeric', 'numeric', 'uuid'];
const confirm = (sel, stake, odds, req = crypto.randomUUID()) => rpc('apv2_bet_confirm', [sel, stake, odds, req], C4);
const future = (h = 48) => new Date(Date.now() + h * 3600e3).toISOString();
async function newMatch(extra = {}) {
  const p = { game: 'valorant', team_a_name: 'Mambas', team_b_name: 'Leões', starts_at: future(), odds_a: 1.8, odds_b: 2.1, organizer_name: 'TXAPILOG', rules: 'BO3', ...extra };
  const r = await rpc('apv2_admin_match_save', [null, JSON.stringify(p), null], ['uuid', 'jsonb', 'text']);
  assert.equal(r.ok, true, JSON.stringify(r));
  const sels = await q(`select id, side, odds from apv2_selections where market_id = $1 order by sort`, [r.market]);
  return { id: r.id, market: r.market, a: sels.find((s) => s.side === 'a').id, b: sels.find((s) => s.side === 'b').id, draw: sels.find((s) => s.side === 'empate')?.id };
}
const status = (m, s, motivo = 'teste automático') => rpc('apv2_admin_match_status', [m, s, motivo]);

before(async () => {
  if (skip) return;
  db = new PGlite({ extensions: { pgcrypto } });
  for (const f of FILES) await db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  await mk('dono', 'admin'); await mk('rev', 'admin'); await mk('mod', 'moderator');
  await mk('jog'); await mk('jog2'); await mk('jog3'); await mk('menor', 'user', '2011-05-05'); await mk('excl');
  await asUser(U.dono);
  for (const p of ['markets', 'odds', 'settle', 'toggle', 'permissions']) assert.equal((await rpc('apv2_admin_grant', [U.dono, p, true])).ok, true);
  assert.equal((await rpc('apv2_admin_grant', [U.rev, 'settle', true])).ok, true);
  assert.equal((await rpc('app_setting_set', ['apostas_enabled', 'true'], [null, 'jsonb'])).ok, true);
  for (const k of ['jog', 'jog2', 'jog3', 'menor', 'excl']) { await asUser(U[k]); await rpc('apv2_claim_test_balance'); }
});

let M; // confronto principal

test('v3: migração idempotente, novos jogos e valores sugeridos por omissão', { skip }, async () => {
  await asService();
  await q(`insert into bet_teams (game_key, name) values ('fortnite', 'Equipa FN')`);
  await q(`insert into apv2_markets (title, game_key) values ('Mercado CoD', 'cod')`);
  await assert.rejects(q(`insert into bet_teams (game_key, name) values ('xbox', 'X')`));
  await asUser(U.jog);
  const me = await rpc('apv2_v3_me');
  assert.equal(me.v3, true);
  assert.deepEqual(me.chips, [50, 100, 200, 500, 1000]);
  assert.equal(me.block, null);
});

test('v3: admin cria confronto (mercado + seleção por equipa); utilizador normal e moderador sem permissão não', { skip }, async () => {
  await asUser(U.jog);
  assert.equal((await rpc('apv2_admin_match_save', [null, JSON.stringify({ team_a_name: 'A', team_b_name: 'B', starts_at: future(), odds_a: 2, odds_b: 2 }), null], ['uuid', 'jsonb', 'text'])).code, 'FORBIDDEN');
  await asUser(U.mod);
  assert.equal((await status(crypto.randomUUID(), 'apostas_abertas')).code, 'FORBIDDEN');
  await asUser(U.dono);
  assert.equal((await rpc('apv2_admin_match_save', [null, JSON.stringify({ team_a_name: 'A', team_b_name: 'a', starts_at: future(), odds_a: 2, odds_b: 2 }), null], ['uuid', 'jsonb', 'text'])).code, 'INVALID');
  assert.equal((await rpc('apv2_admin_match_save', [null, JSON.stringify({ team_a_name: 'A', team_b_name: 'B', starts_at: new Date(Date.now() - 6e4).toISOString(), odds_a: 2, odds_b: 2 }), null], ['uuid', 'jsonb', 'text'])).code, 'PAST_DATE');
  M = await newMatch();
  const [mk] = await q(`select status, match_id, game_key from apv2_markets where id = $1`, [M.market]);
  assert.equal(mk.status, 'fechado'); assert.equal(mk.match_id, M.id); assert.equal(mk.game_key, 'valorant');
  assert.equal((await status(M.id, 'apostas_abertas', '')).code, 'MOTIVO', 'mudança de estado exige motivo');
});

test('v3: mercado ainda não aberto / suspenso → recusado; aberto → aceite com estado confirmada e histórico', { skip }, async () => {
  await asUser(U.jog);
  assert.equal((await confirm(M.a, 100, 1.8)).code, 'CLOSED');
  await asUser(U.dono);
  assert.equal((await status(M.id, 'suspenso')).ok, true);
  await asUser(U.jog);
  assert.equal((await confirm(M.a, 100, 1.8)).code, 'SUSPENDED');
  await asUser(U.dono);
  assert.equal((await status(M.id, 'apostas_abertas')).ok, true);
  await asUser(U.jog);
  const r = await confirm(M.a, 100, 1.8);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.status, 'confirmada'); assert.equal(r.potential, 180);
  assert.equal(await balance(U.jog), 900);
  const ev = await q(`select from_status, to_status from apv2_bet_events where bet_id = $1 order by id`, [r.bet]);
  assert.deepEqual(ev.map((e) => `${e.from_status}>${e.to_status}`), ['null>pendente_confirmacao', 'pendente_confirmacao>confirmada']);
  const [b] = await q(`select confirmed_at, match_id, selection_label from apv2_bets where id = $1`, [r.bet]);
  assert.ok(b.confirmed_at); assert.equal(b.match_id, M.id); assert.equal(b.selection_label, 'Mambas');
});

test('v3: saldo insuficiente, valor inválido/negativo/decimal, request_id obrigatório', { skip }, async () => {
  await asUser(U.jog);
  assert.equal((await confirm(M.a, 0, 1.8)).code, 'STAKE_POSITIVE');
  assert.equal((await confirm(M.a, -50, 1.8)).code, 'STAKE_POSITIVE');
  assert.equal((await confirm(M.a, 10.5, 1.8)).code, 'STAKE_INT');
  assert.equal((await confirm(M.a, 5, 1.8)).code, 'STAKE_MIN');
  assert.equal((await confirm(M.a, 4000, 1.8)).code, 'BALANCE');
  assert.equal((await rpc('apv2_bet_confirm', [M.a, 50, 1.8, null], C4)).code, 'REQUEST_ID');
  assert.equal(await balance(U.jog), 900, 'nada debitado');
});

test('v3: multiplicador alterado → recusa com a odd nova; confirmada mantém a odd congelada', { skip }, async () => {
  await asUser(U.dono);
  assert.equal((await rpc('apv2_admin_set_odds', [M.b, 2.4], [null, 'numeric'])).ok, true);
  await asUser(U.jog2);
  const r = await confirm(M.b, 100, 2.1);
  assert.equal(r.code, 'ODDS_CHANGED'); assert.equal(Number(r.odds), 2.4);
  const ok = await confirm(M.b, 100, 2.4);
  assert.equal(ok.ok, true); assert.equal(ok.potential, 240);
  await asUser(U.dono);
  await rpc('apv2_admin_set_odds', [M.b, 3], [null, 'numeric']);
  const [b] = await q(`select odds_locked, potential from apv2_bets where id = $1`, [ok.bet]);
  assert.equal(Number(b.odds_locked), 2.4); assert.equal(b.potential, 240);
});

test('v3: duplo clique e nova tentativa após falha de rede (mesmo request_id) → uma só aposta, um só débito', { skip }, async () => {
  await asUser(U.jog3);
  const req = crypto.randomUUID();
  const before = await balance(U.jog3);
  const [a, b] = await Promise.all([confirm(M.a, 50, 1.8, req), confirm(M.a, 50, 1.8, req)]);
  assert.equal(a.bet, b.bet);
  const c = await confirm(M.a, 50, 1.8, req); // "rede falhou, tenta outra vez"
  assert.equal(c.replay, true); assert.equal(c.bet, a.bet);
  assert.equal(await balance(U.jog3), before - 50);
  assert.equal((await confirm(M.a, 70, 1.8, req)).code, 'REQUEST_REUSED', 'mesmo id com outro valor é recusado');
});

test('v3: pedidos simultâneos com saldo apertado → saldo nunca negativo', { skip }, async () => {
  await asUser(U.jog3);
  const bal = await balance(U.jog3);
  const n = Math.floor(bal / 200) + 3;
  const rs = await Promise.all(Array.from({ length: n }, () => confirm(M.a, 200, 1.8)));
  const ok = rs.filter((r) => r.ok).length;
  assert.equal(ok, Math.floor(bal / 200));
  assert.ok(rs.some((r) => r.code === 'BALANCE'));
  const after = await balance(U.jog3);
  assert.ok(after >= 0); assert.equal(after, bal - ok * 200);
  await asService();
  const neg = await q(`select count(*)::int as n from apv2_test_ledger where balance_after < 0`);
  assert.equal(neg[0].n, 0);
});

test('v3: conta não autorizada — menor de idade, autoexcluída, banida', { skip }, async () => {
  await asUser(U.menor);
  assert.equal((await confirm(M.a, 50, 1.8)).code, 'UNDERAGE');
  await asService();
  await q(`insert into bet_limits (user_id, self_excluded_until) values ($1, now() + interval '7 days')`, [U.excl]);
  await asUser(U.excl);
  assert.equal((await confirm(M.a, 50, 1.8)).code, 'SELF_EXCLUDED');
  assert.equal((await rpc('apv2_v3_me')).block, 'SELF_EXCLUDED');
  await asService();
  await q(`update profiles set banned = true where id = $1`, [U.menor]);
  await asUser(U.menor);
  assert.equal((await confirm(M.a, 50, 1.8)).code, 'FORBIDDEN');
});

test('v3: RLS — não vê apostas/histórico/carteira de outro utilizador; cliente não altera saldo nem apostas', { skip }, async () => {
  await asUser(U.jog);
  assert.deepEqual((await q(`select distinct user_id from apv2_bets`)).map((r) => r.user_id), [U.jog]);
  assert.deepEqual((await q(`select distinct user_id from apv2_bet_events`)).map((r) => r.user_id), [U.jog]);
  assert.deepEqual((await q(`select distinct user_id from apv2_test_ledger`)).map((r) => r.user_id), [U.jog]);
  assert.equal((await q(`select * from apv2_limits`)).length, 0);
  await assert.rejects(q(`insert into apv2_test_ledger (user_id, delta, reason, ref, balance_after) values ($1, 99999, 'hack', 'x', 99999)`, [U.jog]));
  await assert.rejects(q(`update apv2_bets set status = 'ganha', payout = 99999 where user_id = $1`, [U.jog]));
  await assert.rejects(q(`insert into apv2_bet_events (bet_id, user_id, to_status) select id, user_id, 'ganha' from apv2_bets limit 1`));
  await assert.rejects(q(`update apv2_matches set status = 'finalizado'`));
  await assert.rejects(q(`select public.apv2__post($1, 1000, 'hack', 'x')`, [U.jog]));
  await assert.rejects(q(`select public.apv2__settle_x(id, 'ganha', null, null) from apv2_bets limit 1`));
  const w = await rpc('apv2_wallet');
  assert.equal(w.ok, true); assert.equal(w.available, 900); assert.equal(w.reserved, 100); assert.equal(w.pending, 1);
});

test('v3: liquidação manual de aposta de confronto recusada (resultado não validado)', { skip }, async () => {
  await asUser(U.dono);
  const [b] = await q(`select id from apv2_bets where match_id = $1 limit 1`, [M.id]);
  assert.equal((await rpc('apv2_admin_settle_bet', [b.id, 'won'])).code, 'RESULT_NOT_VALIDATED');
  assert.equal((await rpc('apv2_admin_settle_market', [M.market, M.a], [null, 'uuid'])).code, 'RESULT_NOT_VALIDATED');
});

test('v3: limites — valor máximo por utilizador e exposição do mercado (suspende automaticamente)', { skip }, async () => {
  await asUser(U.mod);
  assert.equal((await rpc('apv2_admin_limit_set', ['market', M.market, null, 10, true, true, 'teste'])).code, 'FORBIDDEN');
  await asUser(U.dono);
  const M2 = await newMatch({ team_a_name: 'Fênix', team_b_name: 'Raio', game: 'ff' });
  await status(M2.id, 'apostas_abertas');
  assert.equal((await rpc('apv2_admin_limit_set', ['user', '', 300, null, true, true, 'máx. por aposta'])).ok, true);
  assert.equal((await rpc('apv2_admin_limit_set', ['market', M2.market, null, 100, true, true, 'exposição'])).ok, true);
  await asUser(U.jog2);
  assert.equal((await confirm(M2.a, 400, 1.8)).code, 'LIMIT_STAKE');
  assert.equal((await confirm(M2.a, 100, 1.8)).ok, true); // exposição 80
  const hedge = await confirm(M2.b, 100, 2.1); // exposição max(180,210)-200 = 10
  assert.equal(hedge.ok, true);
  const big = await confirm(M2.b, 200, 2.1); // 630 - 400 = 230 > 100
  assert.equal(big.code, 'LIMIT_EXPOSURE'); assert.equal(big.scope, 'market');
  await asUser(U.jog);
  const r = await confirm(M2.b, 150, 2.1); // 525 - 350 = 175 > 100
  assert.equal(r.code, 'LIMIT_EXPOSURE');
  await asUser(U.dono);
  const v = await rpc('apv2_admin_v3_view');
  const e = v.exposure.find((x) => x.market_id === M2.market);
  assert.equal(e.exposure, 10);
  // atingir o limite: mercado suspenso automaticamente
  assert.equal((await rpc('apv2_admin_limit_set', ['market', M2.market, null, 10, true, true, 'baixar'])).ok, true);
  await asUser(U.jog);
  assert.equal((await confirm(M2.b, 20, 2.1)).code, 'LIMIT_EXPOSURE');
  assert.equal((await q(`select status from apv2_markets where id = $1`, [M2.market]))[0].status, 'suspenso');
  assert.equal((await confirm(M2.b, 20, 2.1)).code, 'SUSPENDED');
  await asUser(U.dono);
  assert.equal((await rpc('apv2_admin_limit_set', ['user', '', null, null, true, false, 'desligar'])).ok, true);
  assert.ok((await q(`select 1 from app_audit_log where action = 'auto_suspender_limite'`)).length);
});

test('v3: valores sugeridos configuráveis só pelo admin com permissão (validados)', { skip }, async () => {
  await asUser(U.jog);
  assert.equal((await rpc('apv2_admin_set_stake_chips', ['[10,20]'], ['jsonb'])).code, 'FORBIDDEN');
  assert.equal((await rpc('app_setting_set', ['apostas_stake_chips', '[1]'], [null, 'jsonb'])).code, 'FORBIDDEN');
  await asUser(U.dono);
  assert.equal((await rpc('app_setting_set', ['apostas_stake_chips', '"lixo"'], [null, 'jsonb'])).code, 'FORBIDDEN', 'caminho genérico fechado');
  assert.equal((await rpc('apv2_admin_set_stake_chips', ['[100,50]'], ['jsonb'])).code, 'INVALID');
  assert.equal((await rpc('apv2_admin_set_stake_chips', ['[25,50.5]'], ['jsonb'])).code, 'INVALID');
  assert.equal((await rpc('apv2_admin_set_stake_chips', ['[25,50,100,250,500]'], ['jsonb'])).ok, true);
  await asUser(U.jog);
  assert.deepEqual((await rpc('apv2_v3_me')).chips, [25, 50, 100, 250, 500]);
});

test('v3: resultado — inválido recusado, proponente não pode rever, outro admin aprova e liquida (sem duplicar)', { skip }, async () => {
  await asUser(U.dono);
  assert.equal((await rpc('apv2_admin_result_propose', [M.id, 'a', 2, 0, '', 'cedo demais', null], [null, null, null, null, null, null, 'uuid'])).code, 'STATE', 'só depois de começar');
  assert.equal((await status(M.id, 'em_andamento')).ok, true);
  const [ev] = await q(`select status from apv2_bets where match_id = $1 and user_id = $2 limit 1`, [M.id, U.jog]);
  assert.equal(ev.status, 'em_andamento');
  await asUser(U.jog);
  assert.equal((await confirm(M.a, 50, 1.8)).code, 'CLOSED', 'confronto em andamento não aceita apostas');
  await asUser(U.dono);
  const P = (w, a, b, req = null) => rpc('apv2_admin_result_propose', [M.id, w, a, b, 'print', 'resultado oficial', req], [null, null, null, null, null, null, 'uuid']);
  assert.equal((await P('x', 1, 0)).code, 'INVALID_RESULT');
  assert.equal((await P('empate', 1, 1)).code, 'INVALID_RESULT', 'sem seleção empate');
  assert.equal((await P('a', 0, 2)).code, 'INVALID_RESULT', 'placar não bate certo');
  const req = crypto.randomUUID();
  const pr = await P('a', 2, 1, req);
  assert.equal(pr.ok, true);
  assert.equal((await P('a', 2, 1, req)).replay, true, 'proposta idempotente');
  assert.equal((await P('b', 1, 2)).code, 'STATE');
  const [an] = await q(`select status from apv2_bets where match_id = $1 and user_id = $2 limit 1`, [M.id, U.jog]);
  assert.equal(an.status, 'em_analise');
  assert.equal((await rpc('apv2_admin_result_review', [pr.id, true, 'eu mesmo'])).code, 'SAME_REVIEWER');
  await asUser(U.mod);
  assert.equal((await rpc('apv2_admin_result_review', [pr.id, true, 'sem permissão'])).code, 'FORBIDDEN');
  await asUser(U.jog);
  assert.equal((await rpc('apv2_admin_result_review', [pr.id, true, 'hack'])).code, 'FORBIDDEN');
  const b1 = { jog: await balance(U.jog), jog2: await balance(U.jog2) };
  await asUser(U.rev);
  const ap = await rpc('apv2_admin_result_review', [pr.id, true, 'confirmado com prints']);
  assert.equal(ap.ok, true, JSON.stringify(ap));
  assert.equal(await balance(U.jog), b1.jog + 180, 'Mambas ganhou: 100 × 1.8');
  assert.equal(await balance(U.jog2), b1.jog2, 'aposta em Leões perdeu');
  assert.equal((await rpc('apv2_admin_result_review', [pr.id, true, 'outra vez'])).already, true, 'liquidação duplicada não credita');
  assert.equal((await rpc('apv2_admin_result_review', [pr.id, false, 'mudar'])).code, 'STATE');
  assert.equal(await balance(U.jog), b1.jog + 180);
  const [b] = await q(`select status, settled_amount, official_result, settled_at from apv2_bets where match_id = $1 and user_id = $2 and status = 'ganha'`, [M.id, U.jog]);
  assert.equal(b.settled_amount, 180); assert.match(b.official_result, /Mambas \(2-1\)/); assert.ok(b.settled_at);
  const [mt] = await q(`select status, result from apv2_matches where id = $1`, [M.id]);
  assert.equal(mt.status, 'finalizado'); assert.equal(mt.result, 'a');
  await asService();
  await assert.rejects(q(`update apv2_bets set status = 'perdida' where match_id = $1 and status = 'ganha'`, [M.id]), /ALREADY_SETTLED/);
  await assert.rejects(q(`update apv2_results set reviewed_by = proposed_by where id = $1`, [pr.id]));
  await assert.rejects(q(`update apv2_matches set status = 'em_andamento' where id = $1`, [M.id]), /MATCH_TRANSITION/);
});

test('v3: resultado rejeitado volta a aguardar; reembolso individual idempotente; confronto cancelado → reembolso de tudo', { skip }, async () => {
  await asUser(U.dono);
  const M3 = await newMatch({ team_a_name: 'Lobos', team_b_name: 'Tubarões', game: 'cod', odds_draw: 3.2 });
  await status(M3.id, 'apostas_abertas');
  await asUser(U.jog);
  const x = await confirm(M3.a, 100, 1.8);
  const y = await confirm(M3.draw, 50, 3.2);
  await asUser(U.jog2);
  const z = await confirm(M3.b, 60, 2.1);
  const base = { jog: await balance(U.jog), jog2: await balance(U.jog2) };
  await asUser(U.dono);
  await status(M3.id, 'em_andamento');
  const pr = await rpc('apv2_admin_result_propose', [M3.id, 'empate', 1, 1, '', 'empate oficial', null], [null, null, null, null, null, null, 'uuid']);
  assert.equal(pr.ok, true);
  await asUser(U.rev);
  assert.equal((await rpc('apv2_admin_result_review', [pr.id, false, 'prova insuficiente'])).status, 'rejeitado');
  assert.equal((await q(`select status from apv2_matches where id = $1`, [M3.id]))[0].status, 'aguarda_resultado');
  assert.equal((await q(`select status from apv2_bets where id = $1`, [x.bet]))[0].status, 'em_andamento');
  // reembolso individual
  assert.equal((await rpc('apv2_admin_refund_bet', [y.bet, ''])).code, 'MOTIVO');
  const r1 = await rpc('apv2_admin_refund_bet', [y.bet, 'pedido do utilizador']);
  assert.equal(r1.payout, 50);
  assert.equal((await rpc('apv2_admin_refund_bet', [y.bet, 'outra vez'])).already, true, 'reembolso duplicado não credita');
  await asUser(U.jog);
  assert.equal(await balance(U.jog), base.jog + 50);
  // cancelar
  await asUser(U.mod);
  assert.equal((await rpc('apv2_admin_match_cancel', [M3.id, 'tentativa'])).code, 'FORBIDDEN');
  await asUser(U.dono);
  const c = await rpc('apv2_admin_match_cancel', [M3.id, 'equipa não compareceu']);
  assert.equal(c.ok, true); assert.equal(c.refunds, 2);
  assert.equal((await rpc('apv2_admin_match_cancel', [M3.id, 'de novo'])).already, true);
  assert.equal(await balance(U.jog), base.jog + 50 + 100);
  assert.equal(await balance(U.jog2), base.jog2 + 60);
  const st = await q(`select status from apv2_bets where id = any($1::uuid[]) order by status`, [[x.bet, z.bet]]);
  assert.deepEqual(st.map((s) => s.status), ['reembolsada', 'reembolsada']);
  const refunds = await q(`select count(*)::int as n from apv2_test_ledger where reason = 'liquidacao' and ref = any($1::text[])`, [[x.bet, y.bet, z.bet]]);
  assert.equal(refunds[0].n, 3);
  assert.ok((await q(`select 1 from app_audit_log where action = 'cancelar_confronto' and after->>'motivo' = 'equipa não compareceu'`)).length);
});

test('v3: reclamações — utilizador abre sobre a própria aposta; não sobre a de outro; admin responde com auditoria', { skip }, async () => {
  await asUser(U.jog2);
  const [other] = await q(`select id from apv2_bets limit 1`);
  await asUser(U.jog);
  const [mine] = await q(`select id from apv2_bets limit 1`);
  assert.equal((await rpc('apv2_complaint_open', [other.id, null, 'não é minha'], ['uuid', 'uuid', 'text'])).code, 'NOT_FOUND');
  assert.equal((await rpc('apv2_complaint_open', [mine.id, null, 'x'], ['uuid', 'uuid', 'text'])).code, 'INVALID');
  const c = await rpc('apv2_complaint_open', [mine.id, null, 'O resultado parece errado'], ['uuid', 'uuid', 'text']);
  assert.equal(c.ok, true);
  await asUser(U.jog2);
  assert.equal((await q(`select * from apv2_complaints`)).length, 0);
  assert.equal((await rpc('apv2_admin_complaint_update', [c.id, 'resolvida', 'ok'])).code, 'FORBIDDEN');
  await asUser(U.dono);
  assert.equal((await rpc('apv2_admin_complaint_update', [c.id, 'resolvida', ''])).code, 'INVALID');
  assert.equal((await rpc('apv2_admin_complaint_update', [c.id, 'resolvida', 'Verificado: resultado correto'])).ok, true);
  assert.equal((await rpc('apv2_admin_complaint_update', [c.id, 'rejeitada', 'mudar'])).code, 'STATE');
});

test('v3: acesso admin não autorizado — utilizador normal recusado em todas as funções admin', { skip }, async () => {
  await asUser(U.jog);
  const id = crypto.randomUUID();
  assert.equal((await rpc('apv2_admin_v3_view')).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_admin_team_save', [null, 'ff', 'Hack', null], ['uuid', null, null, 'text'])).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_admin_match_status', [id, 'apostas_abertas', 'hack'])).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_admin_match_cancel', [id, 'hack'])).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_admin_result_propose', [id, 'a', 1, 0, '', 'hack', null], [null, null, null, null, null, null, 'uuid'])).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_admin_refund_bet', [id, 'hack'])).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_admin_limit_set', ['global_exposure', '', null, 1, true, true, 'hack'])).code, 'FORBIDDEN');
  assert.equal((await rpc('apv2_tick')).code, 'FORBIDDEN');
});

test('v3: equipas com logótipo (só URL do storage), início automático (apv2_tick) e mercados antigos continuam', { skip }, async () => {
  await asUser(U.dono);
  assert.equal((await rpc('apv2_admin_team_save', [null, 'minecraft', 'Blocos FC', 'https://evil.example/x.png'], ['uuid', null, null, 'text'])).code, 'LOGO_URL');
  const t = await rpc('apv2_admin_team_save', [null, 'minecraft', 'Blocos FC', 'https://x.supabase.co/storage/v1/object/public/media/teams/a/logo.png'], ['uuid', null, null, 'text']);
  assert.equal(t.ok, true);
  const t2 = await rpc('apv2_admin_team_save', [null, 'minecraft', 'Pedra SC', null], ['uuid', null, null, 'text']);
  const m = await rpc('apv2_admin_match_save', [null, JSON.stringify({ game: 'minecraft', team_a_id: t.id, team_b_id: t2.id, starts_at: future(1), odds_a: 1.5, odds_b: 2.5 }), null], ['uuid', 'jsonb', 'text']);
  assert.equal(m.ok, true);
  const [row] = await q(`select team_a_name, team_a_logo from apv2_matches where id = $1`, [m.id]);
  assert.equal(row.team_a_name, 'Blocos FC'); assert.match(row.team_a_logo, /media\/teams/);
  await status(m.id, 'apostas_abertas');
  await asService();
  await q(`alter table apv2_matches disable trigger apv2_match_state`);
  await q(`update apv2_matches set starts_at = now() - interval '1 minute' where id = $1`, [m.id]);
  await q(`alter table apv2_matches enable trigger apv2_match_state`);
  assert.equal((await rpc('apv2_tick')).started, 1);
  assert.equal((await q(`select status from apv2_matches where id = $1`, [m.id]))[0].status, 'em_andamento');
  // mercado antigo (sem confronto): apv2_place continua a funcionar e passa pelas mesmas regras
  await asUser(U.dono);
  const old = await rpc('apv2_admin_create_market', ['Mercado antigo', 'ef', null, JSON.stringify([{ label: 'Sim', odds: 2 }, { label: 'Não', odds: 1.7 }])], [null, null, 'timestamptz', 'jsonb']);
  const [s1] = await q(`select id from apv2_selections where market_id = $1 order by sort`, [old.id]);
  await asUser(U.jog2);
  const p = await rpc('apv2_place', [s1.id, 50, 2], [null, 'numeric', 'numeric']);
  assert.equal(p.ok, true); assert.equal(p.potential, 100);
  await asUser(U.dono);
  assert.equal((await rpc('apv2_admin_settle_bet', [p.bet, 'won'])).payout, 100, 'mercados antigos: liquidação manual mantém-se');
});

test('v3: rollback reverte o v3 sem perder apostas da v2, e o v3 volta a instalar', { skip }, async () => {
  await asService();
  const nBets = (await q(`select count(*)::int as n from apv2_bets`))[0].n;
  await db.exec(fs.readFileSync(path.join(ROOT, DOWN), 'utf8'));
  assert.equal((await q(`select to_regclass('public.apv2_matches') as t`))[0].t, null);
  assert.equal((await q(`select count(*)::int as n from apv2_bets`))[0].n, nBets, 'apostas mantidas');
  const st = await q(`select distinct status from apv2_bets`);
  assert.ok(st.every((r) => ['aberta', 'ganha', 'perdida', 'anulada', 'reembolsada'].includes(r.status)));
  assert.equal((await q(`select count(*)::int as n from information_schema.columns where table_name = 'apv2_bets' and column_name = 'match_id'`))[0].n, 0);
  // v2 continua a funcionar depois do rollback
  await asUser(U.dono);
  const old = await rpc('apv2_admin_create_market', ['Depois do rollback', 'ff', null, JSON.stringify([{ label: 'A', odds: 2 }, { label: 'B', odds: 2 }])], [null, null, 'timestamptz', 'jsonb']);
  const [s1] = await q(`select id from apv2_selections where market_id = $1 order by sort`, [old.id]);
  await asUser(U.jog2);
  const p = await rpc('apv2_place', [s1.id, 20, 2], [null, 'numeric', 'numeric']);
  assert.equal(p.ok, true);
  await asUser(U.dono);
  assert.equal((await rpc('apv2_admin_settle_bet', [p.bet, 'lost'])).ok, true);
  await asService();
  await db.exec(fs.readFileSync(path.join(ROOT, V3), 'utf8'));
  assert.ok((await q(`select to_regclass('public.apv2_matches') as t`))[0].t);
});
