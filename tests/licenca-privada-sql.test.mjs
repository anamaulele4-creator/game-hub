// Testes do SQL "Licença IGJ privada" (supabase/migrations/2026-10-21-licenca-privada.sql) numa base Postgres real em
// memória (PGlite). Verifica que a API (anon/authenticated) já não lê igj_licence_*, que as colunas públicas continuam
// legíveis, que só o admin lê tudo por bets_admin_settings(), que ligar o dinheiro real deixa de gravar o nº no registo,
// que os registos antigos são limpos (a linha fica) e o rollback. Não toca em nenhuma base remota.
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

const MIG = 'supabase/migrations/2026-10-21-licenca-privada.sql';
const DOWN = 'supabase/migrations/rollback/2026-10-21-licenca-privada-down.sql';
const BASE = [
  'tests/sql/supabase-stub.sql', 'supabase/schema.sql',
  'supabase/migrations/2026-10-08-profile-handle.sql', 'supabase/migrations/2026-10-08-clip-media.sql', 'supabase/migrations/2026-10-08-chat-groups-calls.sql',
  'supabase/migrations/2026-10-09-ai-core.sql', 'supabase/migrations/2026-10-10-tournaments-market.sql', 'supabase/migrations/2026-10-10-market-escrow.sql',
  'supabase/migrations/2026-10-10-bets.sql', 'supabase/migrations/2026-10-10-bets-money.sql', 'supabase/migrations/2026-10-10-team-logos.sql',
  'supabase/competitive.sql',
];
const LIC = 'TESTE-PRIVADA-123';
const PUBLIC_COLS = 'id,bets_enabled,real_money_enabled,margin,min_stake,max_stake,max_payout,max_legs,weekly_allowance,elo_k,big_stake_alert,same_selection_alert,mt_min_stake,mt_max_stake,mt_max_payout,mt_min_withdraw,mt_max_withdraw_daily,updated_at';
const skip = !PGlite;
let db;
const U = {};
const run = (f) => db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const day = (d) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);

async function asUser(id) {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [id ?? '', JSON.stringify({ sub: id, aal: 'aal1' })]);
  if (id) await db.query(`set role authenticated`);
}
async function asAnon() { await asUser(null); await db.query(`set role anon`); }
async function asService() {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '{}', false)`);
}
async function q(sql, args = []) { return (await db.query(sql, args)).rows; }
async function rpc(fn, args = []) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await db.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r;
}
async function mk(k, role = 'user') {
  await asService();
  const id = crypto.randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${k}@t.mz`, JSON.stringify({ handle: k, name: k, birth: '1990-01-01', province: 'Maputo Cidade' })]);
  if (role !== 'user') await db.query(`update profiles set role = $2 where id = $1`, [id, role]);
  U[k] = id; return id;
}

before(async () => {
  if (skip) return;
  db = new PGlite({ extensions: { pgcrypto } });
  for (const f of BASE) await run(f);
  await mk('dono', 'admin'); await mk('jog'); await mk('mod', 'moderator');
  // estado ANTES da correção: ligar dinheiro real gravava o nº e as datas no registo; v1 gravava 'licenca' + 'data'
  await asUser(U.dono);
  const r = await rpc('bets_admin_set_real_money', [true, LIC, day(-30), day(300), 'CONFIRMO']);
  assert.equal(r.ok, true, JSON.stringify(r));
  await asService();
  await db.query(`insert into bet_admin_log (actor_id, action, target, details) values ($1, 'dinheiro_real_desligado', 'bet_settings', $2)`,
    [U.dono, JSON.stringify({ licenca: 'ANTIGA-V1-9', data: '2026-01-01' })]);
  await db.query(`insert into bet_admin_log (actor_id, action, target, details) values ($1, 'definicoes_apostas', 'bet_settings', '{"margin":0.08}')`, [U.dono]);
  const [leak] = await q(`select count(*)::int as n from bet_admin_log where details::text like '%' || $1 || '%'`, [LIC]);
  assert.equal(leak.n, 1, 'pré-condição: o registo antigo tem o nº');
  // antes da correção a API lia a licença
  await asAnon();
  assert.equal((await q(`select igj_licence_no from bet_settings`))[0].igj_licence_no, LIC);
  await asService();
  await run(MIG); await run(MIG); // duas vezes = idempotente
});

test('anon e authenticated já não leem igj_licence_* (nem select *)', { skip }, async () => {
  for (const who of [asAnon, () => asUser(U.jog), () => asUser(U.mod), () => asUser(U.dono)]) {
    await who();
    for (const col of ['igj_licence_no', 'igj_licence_date', 'igj_licence_expiry', '*']) {
      await assert.rejects(db.query(`select ${col} from public.bet_settings where id = 1`), /permission denied/, `${col} devia ser recusado`);
    }
    await assert.rejects(db.query(`select to_jsonb(s) from public.bet_settings s`), /permission denied/);
  }
  await asService();
  const [p] = await q(`select has_column_privilege('anon', 'public.bet_settings', 'igj_licence_no', 'select') as a,
    has_column_privilege('authenticated', 'public.bet_settings', 'igj_licence_no', 'select') as b,
    has_table_privilege('anon', 'public.bet_settings', 'select') as c, has_column_privilege('anon', 'public.bet_settings', 'real_money_enabled', 'select') as d`);
  assert.deepEqual(p, { a: false, b: false, c: false, d: true });
});

test('colunas públicas (PUBLIC_SETTINGS_COLUMNS + updated_at) continuam legíveis por anon e authenticated', { skip }, async () => {
  // a lista do teste tem de bater com a da app
  const api = fs.readFileSync(path.join(ROOT, 'lib/betsApi.ts'), 'utf8');
  const appCols = api.match(/PUBLIC_SETTINGS_COLUMNS = '([^']+)'/)[1];
  for (const c of appCols.split(',')) assert.ok(PUBLIC_COLS.split(',').includes(c), `coluna ${c} pedida pela app tem de estar concedida`);
  for (const who of [asAnon, () => asUser(U.jog)]) {
    await who();
    const [row] = await q(`select ${appCols}, updated_at from public.bet_settings where id = 1`);
    assert.equal(row.id, 1); assert.equal(row.real_money_enabled, true); assert.equal(row.bets_enabled, true);
    assert.ok(!('igj_licence_no' in row));
  }
  await asService();
});

test('funções SECURITY DEFINER continuam a ler bet_settings', { skip }, async () => {
  await asService(); // competitive.sql: dinheiro real também exige os interruptores competitivos
  await db.query(`insert into comp_licences (scope, authority, licence_no, valid_from, valid_until) values ('apostas', 'IGJ', 'COMP-LIC-0', $1, $2)`, [day(-5), day(100)]);
  await db.query(`update comp_settings set monetary_features_enabled = true, betting_enabled = true where id = 1`);
  await asUser(U.jog);
  // bets_withdraw_request passa por bets__real_active() (lê bet_settings): chega à verificação de KYC, não a REAL_OFF/erro
  assert.equal((await rpc('bets_withdraw_request', [100, 'M-Pesa', '841234567'])).code, 'KYC');
  const me = await rpc('bets_me');
  assert.equal(me.ok, true, JSON.stringify(me));
  await asUser(U.dono);
  assert.equal((await rpc('bets_admin_overview')).ok, true);
  await asService();
});

test('admin lê a linha completa por bets_admin_settings()', { skip }, async () => {
  await asUser(U.dono);
  const r = await rpc('bets_admin_settings');
  assert.equal(r.ok, true);
  assert.equal(r.settings.igj_licence_no, LIC);
  assert.equal(r.settings.igj_licence_expiry, day(300));
  assert.equal(r.settings.real_money_enabled, true);
  await asService();
});

test('não-admin em bets_admin_settings() recebe erro e nunca a licença', { skip }, async () => {
  for (const k of ['jog', 'mod']) {
    await asUser(U[k]);
    const r = await rpc('bets_admin_settings');
    assert.deepEqual(r, { ok: false, code: 'FORBIDDEN' });
  }
  await asAnon();
  await assert.rejects(db.query(`select public.bets_admin_settings()`), /permission denied/);
  await asService();
});

test('ligar/desligar dinheiro real já não grava nº nem datas em bet_admin_log; regras iguais', { skip }, async () => {
  await asUser(U.jog);
  assert.equal((await rpc('bets_admin_set_real_money', [true, LIC, day(-1), day(10), 'CONFIRMO'])).code, 'FORBIDDEN');
  await asUser(U.dono);
  assert.equal((await rpc('bets_admin_set_real_money', [true, '', day(-1), day(10), 'CONFIRMO'])).code, 'IGJ');
  assert.equal((await rpc('bets_admin_set_real_money', [true, 'NOVA-456', day(-1), day(10), 'nao'])).code, 'IGJ');
  assert.equal((await rpc('bets_admin_set_real_money', [false, 'NOVA-456', day(-1), day(10), ''])).ok, true);
  assert.equal((await rpc('bets_admin_set_real_money', [true, 'NOVA-456', day(-1), day(10), 'CONFIRMO'])).ok, true);
  assert.equal((await rpc('bets_admin_settings')).settings.igj_licence_no, 'NOVA-456', 'a licença continua a ser guardada em bet_settings');
  await asService();
  const logs = await q(`select action, details from bet_admin_log where action like 'dinheiro_real_%' order by id`);
  const txt = JSON.stringify(logs);
  for (const bad of [LIC, 'NOVA-456', 'ANTIGA-V1-9', day(-1), day(10), day(-30), day(300), '"emissao"', '"validade"', '"data"']) {
    assert.ok(!txt.includes(bad), `bet_admin_log não pode conter ${bad}`);
  }
  const last = logs.at(-1);
  assert.equal(last.action, 'dinheiro_real_ligado');
  assert.deepEqual(last.details, { licenca_indicada: true });
});

test('registos antigos: nº → "[removido]", datas fora, linhas mantidas; outros registos intactos', { skip }, async () => {
  const rows = await q(`select action, details from bet_admin_log order by id`);
  const old = rows.filter((r) => r.details.licenca === '[removido]');
  assert.equal(old.length, 2, JSON.stringify(rows)); // o ligado de antes + o v1 inserido à mão
  assert.ok(rows.some((r) => r.action === 'definicoes_apostas' && r.details.margin === 0.08));
});

test('organizador/moderador que lê bet_admin_log não vê a licença', { skip }, async () => {
  await asUser(U.dono);
  const txt = JSON.stringify(await q(`select details from bet_admin_log`));
  assert.ok(!txt.includes(LIC) && !txt.includes('NOVA-456'));
  await asService();
});

test('comp_licences continua só para admin', { skip }, async () => {
  await asService(); // comp_admin_record_licence exige MFA: inserimos como serviço
  await db.query(`insert into comp_licences (scope, authority, licence_no, valid_from, valid_until) values ('apostas', 'IGJ', 'COMP-LIC-1', $1, $2)`, [day(-5), day(100)]);
  await asUser(U.jog);
  assert.equal((await q(`select * from comp_licences`)).length, 0);
  await asUser(U.mod);
  assert.equal((await q(`select * from comp_licences`)).length, 0);
  await asAnon();
  await assert.rejects(db.query(`select * from comp_licences`), /permission denied/);
  await asUser(U.dono);
  assert.ok((await q(`select licence_no from comp_licences`)).some((r) => r.licence_no === 'COMP-LIC-1'));
  await asService();
});

test('correr grants.sql de novo não volta a abrir a licença', { skip }, async () => {
  await asService();
  await run('supabase/grants.sql');
  for (const who of [asAnon, () => asUser(U.jog)]) {
    await who();
    await assert.rejects(db.query(`select igj_licence_no from public.bet_settings`), /permission denied/);
    assert.equal((await q(`select real_money_enabled from public.bet_settings`)).length, 1);
  }
  await asService();
});

test('rollback repõe a leitura antiga sem apagar dados e a migração volta a aplicar-se', { skip }, async () => {
  await asService();
  await run(DOWN); await run(DOWN);
  await asAnon();
  assert.equal((await q(`select igj_licence_no from bet_settings`))[0].igj_licence_no, 'NOVA-456');
  await asService();
  assert.equal((await q(`select count(*)::int as n from pg_proc where proname = 'bets_admin_settings'`))[0].n, 0);
  assert.ok((await q(`select count(*)::int as n from bet_admin_log`))[0].n >= 5);
  await run(MIG);
  await asAnon();
  await assert.rejects(db.query(`select igj_licence_no from bet_settings`), /permission denied/);
  await asService();
});

test('página pública sql-licenca-privada.html mostra a migração inteira', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/sql-licenca-privada.html'), 'utf8');
  const sql = fs.readFileSync(path.join(ROOT, MIG), 'utf8');
  const m = html.match(/const full=("(?:[^"\\]|\\.)*")/);
  assert.ok(m, 'tem o SQL em const full');
  assert.equal(JSON.parse(m[1]), sql);
  assert.match(html, /Copiar tudo e abrir o Supabase/);
});
