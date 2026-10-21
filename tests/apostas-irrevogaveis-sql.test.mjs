// Apostas confirmadas são irrevogáveis (supabase/migrations/2026-10-21-apostas-irrevogaveis.sql), numa base Postgres
// real em memória (PGlite). O utilizador não retira, não cancela e não reduz uma aposta confirmada; só o admin/organizador
// anula (pelas funções existentes, com reembolso no razão). Não toca em bases remotas.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDb, ROOT } from './sql/mkt3-db.mjs';

const MIG = fs.readFileSync(path.join(ROOT, 'supabase/migrations/2026-10-21-apostas-irrevogaveis.sql'), 'utf8');
let h; let skip = false;
let U = {}; let betId; let matchId;

async function asAdmin(id) {
  await h.db.query('reset role');
  await h.db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [id, JSON.stringify({ sub: id, aal: 'aal2' })]);
  await h.db.query('set role authenticated');
}

before(async () => {
  h = await makeDb();
  if (!h) { skip = true; return; }
  await h.db.exec(MIG); await h.db.exec(MIG); // idempotente
  U.ana = await h.mk('ana'); U.beto = await h.mk('beto'); U.chefe = await h.mk('chefe', 'admin');
  await h.asService();
  // ambiente de teste: dinheiro real ligado só nesta base em memória (para conseguir colocar uma aposta real)
  await h.db.query(`update bet_settings set bets_enabled = true, real_money_enabled = true, igj_licence_no = 'TESTE', igj_licence_date = '2026-01-01', igj_licence_expiry = '2030-12-31' where id = 1`);
  await h.db.query(`insert into comp_licences (scope, authority, licence_no, valid_from, valid_until) values ('apostas', 'Teste IGJ', 'TESTE-1', '2026-01-01', '2030-12-31')`);
  await h.db.query(`insert into comp_settings (id, monetary_features_enabled, betting_enabled) values (1, true, true) on conflict (id) do update set monetary_features_enabled = true, betting_enabled = true`);
  await h.db.query(`insert into app_settings (key, value) values ('apostas_enabled', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb`).catch(() => null);
  await h.db.query(`insert into bet_kyc (user_id, full_name, birth_date, id_type, id_number, phone, status) values ($1, 'Ana Teste', '1995-05-05', 'NUIT', '123456789', '841234567', 'aprovado') on conflict (user_id) do update set status = 'aprovado'`, [U.ana]);
  await h.fund(U.ana, 1000, 'dep-ana-1');
  const [m] = await h.q(`insert into bet_matches (game_key, home_team_id, away_team_id, home, away, starts_at, original_starts_at)
    values ('ff', public.bets__team('ff', 'Renegados'), public.bets__team('ff', 'Squad RP'), 'Renegados', 'Squad RP', now() + interval '3 hours', now() + interval '3 hours') returning id`);
  matchId = m.id;
  await h.q(`select public.bets__ensure_markets($1)`, [matchId]);
});

test('SQL irrevogável: aposta confirmada fica com o valor debitado', { skip }, async () => {
  await h.asUser(U.ana);
  await h.rpc('bets_confirm_age', []).catch(() => null);
  await h.asService();
  const [sel] = await h.q(`select s.id, s.odds from bet_selections s join bet_markets k on k.id = s.market_id where k.match_id = $1 and k.kind in ('12','1x2') and s.code = '1'`, [matchId]);
  assert.ok(sel, 'mercado 1/2 criado');
  await h.asUser(U.ana);
  const r = (await h.db.query(`select public.bets_place(array[$1]::uuid[], 100, array[$2]::numeric[], false, 'mt') as r`, [sel.id, sel.odds])).rows[0].r;
  assert.equal(r.ok, true, JSON.stringify(r));
  await h.asService();
  [{ id: betId }] = await h.q(`select id from bets where user_id = $1 and status = 'aberta'`, [U.ana]);
  assert.equal(await h.balance(U.ana), 900);
});

test('SQL irrevogável: o utilizador não apaga, não edita, não reduz nem trunca (API pública)', { skip }, async () => {
  for (const who of ['ana', 'anon']) {
    if (who === 'anon') await h.asAnon(); else await h.asUser(U.ana);
    await assert.rejects(h.db.query(`delete from bets where id = $1`, [betId]), /permission denied/);
    await assert.rejects(h.db.query(`update bets set stake = 10 where id = $1`, [betId]), /permission denied/);
    await assert.rejects(h.db.query(`update bets set status = 'anulada' where id = $1`, [betId]), /permission denied/);
    await assert.rejects(h.db.query(`delete from bet_legs where bet_id = $1`, [betId]), /permission denied/);
    await assert.rejects(h.db.query(`insert into money_ledger (user_id, delta, reason, ref, balance_after) values ($1, 100, 'reembolso', 'x', 1000)`, [U.ana]), /permission denied/);
    await assert.rejects(h.db.query(`truncate bets cascade`), /permission denied/);
  }
  await h.asService();
  const tabs = (await h.q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and (c.relname like 'bet%' or c.relname like 'apv2%')`)).map((x) => x.relname);
  for (const t of tabs) {
    const [p] = await h.q(`select has_table_privilege('authenticated', $1, 'TRUNCATE') a, has_table_privilege('anon', $1, 'TRUNCATE') b`, ['public.' + t]);
    assert.equal(p.a || p.b, false, `TRUNCATE em ${t}`);
  }
});

test('SQL irrevogável: nem uma função com privilégios apaga ou reduz uma aposta em aberto', { skip }, async () => {
  await h.asService(); // superutilizador (como uma função SECURITY DEFINER futura)
  await assert.rejects(h.db.query(`delete from bets where id = $1`, [betId]), /BET_LOCKED/);
  await assert.rejects(h.db.query(`delete from bet_legs where bet_id = $1`, [betId]), /BET_LOCKED/);
  await assert.rejects(h.db.query(`update bets set stake = 50 where id = $1`, [betId]), /LOCKED/);
  await assert.rejects(h.db.query(`update bets set user_id = $2 where id = $1`, [betId, U.beto]), /LOCKED/);
  await assert.rejects(h.db.query(`update money_ledger set delta = 0 where user_id = $1`, [U.ana]), /acréscimos/);
  const [b] = await h.q(`select stake, status from bets where id = $1`, [betId]);
  assert.equal(b.stake, 100); assert.equal(b.status, 'aberta');
});

test('SQL irrevogável: não há RPC de utilizador para cancelar, editar ou fazer cashout', { skip }, async () => {
  await h.asService();
  const fns = await h.q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'bets%' or p.proname like 'apv2%' or p.proname like 'comp_bet%')
      and p.proname ~ '(cancel|cashout|cash_out|retirar|remove|edit|reduz|anular|levantar_aposta)' and p.proname !~ '(admin|__)'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
  assert.deepEqual(fns, []);
});

test('SQL irrevogável: o utilizador não levanta o valor apostado (já saiu do saldo)', { skip }, async () => {
  await h.asUser(U.ana);
  const r = await h.rpc('bets_withdraw_request', [950, 'M-Pesa', '841234567']);
  assert.equal(r.ok, false); assert.equal(r.code, 'BALANCE');
});

test('SQL irrevogável: o admin continua a anular, com reembolso no razão', { skip }, async () => {
  await h.asUser(U.ana);
  assert.equal((await h.rpc('bets_admin_match_action', [matchId, 'anular', null, null, null])).code, 'FORBIDDEN');
  await asAdmin(U.chefe);
  const r = await h.rpc('bets_admin_match_action', [matchId, 'anular', null, null, null]);
  assert.equal(r.ok, true, JSON.stringify(r));
  await h.asService();
  const [b] = await h.q(`select status, payout, stake from bets where id = $1`, [betId]);
  assert.equal(b.status, 'anulada'); assert.equal(b.stake, 100);
  assert.equal(await h.balance(U.ana), 1000);
  const led = await h.q(`select reason, delta from money_ledger where user_id = $1 order by id`, [U.ana]);
  assert.ok(led.some((x) => x.delta === 100 && /reembolso|anul/.test(x.reason)), JSON.stringify(led));
  // depois de liquidada/anulada, a regra de "não apagar em aberto" já não se aplica (ex.: eliminação de conta em cascata)
  await h.db.query('begin');
  await h.db.query(`delete from bet_legs where bet_id = $1`, [betId]);
  await h.db.query('rollback');
});
