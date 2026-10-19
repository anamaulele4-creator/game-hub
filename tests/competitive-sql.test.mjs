// Testes do SQL do módulo competitivo (supabase/competitive.sql) numa base Postgres real em memória (PGlite / WASM).
// Corre schema.sql + migrações + competitive.sql (duas vezes = idempotente) e exercita RPCs, triggers e RLS.
// Não toca em nenhuma base de dados remota. Correr: npm test
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
} catch { /* sem PGlite instalado: os testes são ignorados */ }

// push.sql fica de fora (precisa da extensão pg_net, que não existe no PGlite)
const FILES = [
  'tests/sql/supabase-stub.sql', 'supabase/schema.sql',
  'supabase/migrations/2026-10-08-profile-handle.sql', 'supabase/migrations/2026-10-08-clip-media.sql', 'supabase/migrations/2026-10-08-chat-groups-calls.sql',
  'supabase/migrations/2026-10-09-ai-core.sql', 'supabase/migrations/2026-10-10-tournaments-market.sql', 'supabase/migrations/2026-10-10-market-escrow.sql',
  'supabase/migrations/2026-10-10-bets.sql', 'supabase/migrations/2026-10-10-bets-money.sql', 'supabase/migrations/2026-10-10-team-logos.sql',
  'supabase/competitive.sql', 'supabase/competitive.sql',
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
  const r = await db.query(`select public.${fn}(${ph}) as r`, args);
  return r.rows[0].r;
}
async function q(sql, args = []) { return (await db.query(sql, args)).rows; }
const idem = (s) => `${s}-${'x'.repeat(16)}`;

before(async () => {
  if (skip) return;
  db = new PGlite({ extensions: { pgcrypto } });
  for (const f of FILES) await db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const mk = async (k, email, birth, province) => {
    const id = crypto.randomUUID();
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email, JSON.stringify({ handle: k, name: k, birth, province })]);
    U[k] = id;
  };
  await mk('capa', 'capa@t.mz', '1999-01-01', 'Maputo Cidade');
  await mk('mema', 'mema@t.mz', '2000-01-01', 'Gaza');
  await mk('capb', 'capb@t.mz', '1998-01-01', 'Sofala');
  await mk('memb', 'memb@t.mz', '2001-01-01', 'Tete');
  await mk('apostador', 'apostador@t.mz', '1995-05-05', 'Nampula');
  await mk('menor', 'menor@t.mz', '2012-01-01', 'Maputo Cidade');
  await mk('chefe', 'anamaulele4@gmail.com', '1990-01-01', 'Maputo Cidade');
});

const T = {};
test('SQL: migração aplica-se duas vezes (idempotente) e flags ficam desligadas', { skip }, async () => {
  const [s] = await q(`select monetary_features_enabled, betting_enabled from comp_settings`);
  assert.equal(s.monetary_features_enabled, false);
  assert.equal(s.betting_enabled, false);
  const [p] = await q(`select role from profiles where id = $1`, [U.chefe]);
  assert.equal(p.role, 'admin');
});

test('SQL: equipas, convites e permissões do capitão', { skip }, async () => {
  await asUser(U.capa);
  let r = await rpc('comp_team_create', ['Mambas FC', 'MAM', 'eFootball', 'Maputo Cidade', '', null]);
  assert.equal(r.ok, true); T.a = r.team_id;
  r = await rpc('comp_team_create', ['mambas fc', null, 'eFootball', '', '', null]);
  assert.equal(r.code, 'NAME_TAKEN');
  r = await rpc('comp_team_invite', [T.a, '@mema']); assert.equal(r.ok, true);
  await asUser(U.mema);
  r = await rpc('comp_team_invite', [T.a, 'memb']); assert.equal(r.code, 'FORBIDDEN');
  const [inv] = await q(`select id from comp_team_invites where user_id = $1`, [U.mema]);
  r = await rpc('comp_invite_respond', [inv.id, true]); assert.equal(r.ok, true);
  await asUser(U.capb);
  r = await rpc('comp_team_create', ['Leões de Maputo', 'LEO', 'eFootball', 'Sofala', '', null]); T.b = r.team_id;
  await rpc('comp_team_invite', [T.b, 'memb']);
  await asUser(U.memb);
  const [inv2] = await q(`select id from comp_team_invites where user_id = $1`, [U.memb]);
  assert.equal((await rpc('comp_invite_respond', [inv2.id, true])).ok, true);
  // cliente não escreve diretamente
  await assert.rejects(db.query(`update comp_teams set rating = 9999 where id = $1`, [T.b]), /permission denied/);
  await assert.rejects(db.query(`insert into comp_team_members (team_id, user_id, role) values ($1, $2, 'capitao')`, [T.a, U.memb]), /permission denied/);
});

async function forceStart(id) {
  // só no teste: recua a data para o relógio (comp_sweep) iniciar o jogo
  await asService();
  await db.exec(`alter table comp_challenges disable trigger comp_challenge_guard`);
  await db.query(`update comp_challenges set scheduled_at = now() - interval '1 minute' where id = $1`, [id]);
  await db.exec(`alter table comp_challenges enable trigger comp_challenge_guard`);
  return rpc('comp_sweep');
}
const future = () => new Date(Date.now() + 3 * 3600e3).toISOString();

test('SQL: desafio completo — enviar, aceitar, agendar, iniciar, resultados iguais → COMPLETED', { skip }, async () => {
  await asUser(U.capa);
  let r = await rpc('comp_challenge_create', [T.a, T.b, 'Amigável', 'Melhor de 1', 2, 1, future(), true, idem('c1')]);
  assert.equal(r.ok, true); T.c1 = r.challenge_id;
  const again = await rpc('comp_challenge_create', [T.a, T.b, 'Amigável', 'Melhor de 1', 2, 1, future(), true, idem('c1')]);
  assert.equal(again.challenge_id, T.c1); assert.equal(again.duplicate, true);
  await asUser(U.memb);
  assert.equal((await rpc('comp_challenge_respond', [T.c1, true, null, null])).code, 'FORBIDDEN');
  await asUser(U.capb);
  r = await rpc('comp_challenge_respond', [T.c1, true, null, null]);
  assert.equal(r.status, 'SCHEDULED');
  await assert.rejects(db.query(`update comp_challenges set status = 'COMPLETED' where id = $1`, [T.c1]), /permission denied/);
  await asService();
  await assert.rejects(db.query(`update comp_challenges set status = 'COMPLETED' where id = $1`, [T.c1]), /COMP_TRANSITION/);
  await forceStart(T.c1);
  const [c] = await q(`select status from comp_challenges where id = $1`, [T.c1]); assert.equal(c.status, 'IN_PROGRESS');
  await asUser(U.capa);
  r = await rpc('comp_challenge_submit_result', [T.c1, T.a, 2, 1, []]); assert.equal(r.status, 'PENDING_RESULT');
  assert.equal((await rpc('comp_challenge_submit_result', [T.c1, T.a, 2, 1, []])).code, 'ALREADY_SUBMITTED');
  await asUser(U.capb);
  r = await rpc('comp_challenge_submit_result', [T.c1, T.b, 2, 1, []]); assert.equal(r.status, 'COMPLETED');
  await asService();
  const [ta] = await q(`select wins, rating from comp_teams where id = $1`, [T.a]);
  assert.equal(ta.wins, 1); assert.ok(Number(ta.rating) > 1500);
  const ev = await q(`select to_status, action from comp_challenge_events where challenge_id = $1 order by id`, [T.c1]);
  assert.deepEqual(ev.map((e) => e.to_status), ['DRAFT', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_RESULT', 'COMPLETED']);
  await assert.rejects(db.query(`update comp_challenge_events set action = 'x' where challenge_id = $1`, [T.c1]), /COMP_IMMUTABLE/);
  await assert.rejects(db.query(`update comp_challenges set challenger_score = 9 where id = $1`, [T.c1]), /COMP_TERMINAL/);
  const pub = await rpc('comp_challenge_public', [T.c1]);
  assert.equal(pub.ok, true); assert.equal(pub.events.length, 7);
});

test('SQL: resultados diferentes → DISPUTED → admin analisa e resolve (exige MFA aal2)', { skip }, async () => {
  await asUser(U.capa);
  const r = await rpc('comp_challenge_create', [T.a, T.b, '', '', 1, 1, future(), true, idem('c2')]); T.c2 = r.challenge_id;
  await asUser(U.capb); await rpc('comp_challenge_respond', [T.c2, true, null, null]);
  await forceStart(T.c2);
  await asUser(U.capa); await rpc('comp_challenge_submit_result', [T.c2, T.a, 3, 0, []]);
  await asUser(U.capb);
  assert.equal((await rpc('comp_challenge_submit_result', [T.c2, T.b, 0, 3 + 1, []])).status, 'DISPUTED');
  await asUser(U.chefe);
  assert.equal((await rpc('comp_admin_challenge_action', [T.c2, 'analisar', null, null, 'a ver provas'])).ok, true);
  assert.equal((await rpc('comp_admin_challenge_action', [T.c2, 'resolver', 3, 0, 'Prova vídeo confirma 3-0'])).code, 'MFA_REQUIRED');
  await asUser(U.chefe, 'aal2');
  assert.equal((await rpc('comp_admin_challenge_action', [T.c2, 'resolver', 3, 0, 'Prova vídeo confirma 3-0'])).ok, true);
  await asService();
  const [c] = await q(`select status, result_source, result_verified_at from comp_challenges where id = $1`, [T.c2]);
  assert.equal(c.status, 'COMPLETED'); assert.equal(c.result_source, 'admin'); assert.ok(c.result_verified_at);
  const [d] = await q(`select status from comp_disputes where challenge_id = $1`, [T.c2]); assert.equal(d.status, 'resolvida');
});

test('SQL: dinheiro bloqueado por omissão; ativação exige admin + aal2 + licença; depósito exige fornecedor', { skip }, async () => {
  await asUser(U.apostador);
  assert.equal((await rpc('comp_wallet_deposit_intent', [100, 'M-Pesa', '841234567', idem('d0')])).code, 'MONETARY_OFF');
  assert.equal((await rpc('comp_bet_place', [crypto.randomUUID(), 10, 1.5, 'pontos', true, idem('b0')])).code, 'BETTING_OFF');
  assert.equal((await rpc('comp_admin_set_flags', [true, true, 'ATIVAR'])).code, 'FORBIDDEN');
  await asUser(U.chefe);
  assert.equal((await rpc('comp_admin_set_flags', [true, true, 'ATIVAR'])).code, 'MFA_REQUIRED');
  await asUser(U.chefe, 'aal2');
  assert.equal((await rpc('comp_admin_set_flags', [true, true, 'ATIVAR'])).code, 'LICENCE');
  const today = new Date().toISOString().slice(0, 10);
  const lic = await rpc('comp_admin_record_licence', ['apostas', 'Inspecção Geral de Jogos', 'TESTE-LIC-001', '2026-01-01', '2027-12-31', 'apenas teste']);
  assert.equal(lic.ok, true, JSON.stringify(lic));
  assert.equal((await rpc('comp_admin_set_flags', [true, true, ''])).code, 'CONFIRM');
  assert.equal((await rpc('comp_admin_set_flags', [true, true, 'ATIVAR'])).ok, true);
  await asService();
  const [bs] = await q(`select real_money_enabled, igj_licence_no from bet_settings`);
  assert.equal(bs.real_money_enabled, true); assert.equal(bs.igj_licence_no, 'TESTE-LIC-001');
  assert.ok(today);
  await assert.rejects(db.query(`delete from comp_licences`), /COMP_IMMUTABLE/);
  await asUser(U.apostador);
  assert.equal((await rpc('comp_wallet_deposit_intent', [100, 'M-Pesa', '841234567', idem('d1')])).code, 'PROVIDER_NOT_CONFIGURED');
  await asService();
  await db.query(`insert into comp_provider_status (provider, configured, live) values ('mpesa', true, true) on conflict (provider) do update set configured = true, live = true`);
  await asUser(U.apostador);
  const ne = await rpc('comp_wallet_deposit_intent', [100, 'M-Pesa', '841234567', idem('d1')]);
  assert.equal(ne.code, 'NOT_ELIGIBLE'); assert.ok(ne.reasons.includes('KYC'));
  await asUser(U.menor);
  assert.ok((await rpc('comp_eligibility', [U.menor])).reasons.includes('MINOR'));
});

test('SQL: depósito só creditado por webhook verificado; sem duplicados; livro-razão imutável', { skip }, async () => {
  await asService();
  for (const u of [U.apostador, U.mema]) {
    await db.query(`insert into bet_kyc (user_id, full_name, birth_date, id_type, id_number, phone, status) values ($1, 'Nome Teste', '1995-05-05', 'NUIT', '123456789', '841234567', 'aprovado') on conflict (user_id) do update set status = 'aprovado'`, [u]);
  }
  await asUser(U.apostador);
  const d = await rpc('comp_wallet_deposit_intent', [500, 'M-Pesa', '+258 84 123 4567', idem('d2')]);
  assert.equal(d.ok, true, JSON.stringify(d));
  const d2 = await rpc('comp_wallet_deposit_intent', [500, 'M-Pesa', '841234567', idem('d2')]);
  assert.equal(d2.payment_id, d.payment_id); assert.equal(d2.duplicate, true);
  let w = await rpc('comp_wallet_me'); assert.equal(w.available, 0);
  // cliente não consegue chamar a confirmação nem escrever no ledger
  await assert.rejects(db.query(`select public.comp__confirm_deposit($1, 'mpesa', 'e1', 'MP1', 'success', 500, true, 'h')`, [d.payment_id]), /permission denied/);
  await assert.rejects(db.query(`insert into money_ledger (user_id, delta, reason, ref, balance_after) values ($1, 1000, 'deposito', 'x', 1000)`, [U.apostador]), /permission denied/);
  await asService();
  assert.equal((await rpc('comp__confirm_deposit', [d.payment_id, 'mpesa', 'e0', 'MP0', 'success', 500, false, 'h'])).code, 'SIGNATURE');
  assert.equal((await rpc('comp__confirm_deposit', [d.payment_id, 'mpesa', 'e1', 'MP1', 'success', 500, true, 'h'])).ok, true);
  assert.equal((await rpc('comp__confirm_deposit', [d.payment_id, 'mpesa', 'e1', 'MP1', 'success', 500, true, 'h'])).duplicate, true);
  assert.equal((await rpc('comp__confirm_deposit', [d.payment_id, 'mpesa', 'e2', 'MP1', 'success', 500, true, 'h'])).duplicate, true);
  await asUser(U.apostador);
  w = await rpc('comp_wallet_me'); assert.equal(w.available, 500); assert.equal(w.ledger.length, 1);
  const d3 = await rpc('comp_wallet_deposit_intent', [200, 'M-Pesa', '841234567', idem('d3')]);
  await asService();
  assert.equal((await rpc('comp__confirm_deposit', [d3.payment_id, 'mpesa', 'e3', 'MP3', 'success', 2000, true, 'h'])).code, 'AMOUNT_MISMATCH');
  const flags = await q(`select rules from risk_flags where kind = 'deposito'`); assert.ok(flags.some((f) => f.rules.includes('valor_webhook_diferente')));
  await assert.rejects(db.query(`update money_ledger set delta = 99999`), /só de acréscimos/);
  const [led] = await q(`select entry_id, idempotency_key from money_ledger where user_id = $1`, [U.apostador]);
  assert.ok(led.entry_id); assert.ok(led.idempotency_key.endsWith(':deposito:mpesa:MP1'));
  await asUser(U.chefe);
  const rec = await rpc('comp_admin_reconcile');
  assert.equal(rec.paid_without_ledger.length, 0); assert.equal(rec.ledger_without_payment.length, 0);
});

test('SQL: apostas num desafio — antifraude, termos imutáveis, liquidação só após validação', { skip }, async () => {
  await asUser(U.capa);
  const r = await rpc('comp_challenge_create', [T.a, T.b, '', '', 1, 1, future(), true, idem('c3')]); T.c3 = r.challenge_id;
  await asUser(U.capb); await rpc('comp_challenge_respond', [T.c3, true, null, null]);
  await asUser(U.chefe);
  assert.equal((await rpc('comp_admin_open_market', [T.c3])).code, 'MFA_REQUIRED');
  await asUser(U.chefe, 'aal2');
  const m = await rpc('comp_admin_open_market', [T.c3]); assert.equal(m.ok, true, JSON.stringify(m));
  const [sel] = await q(`select s.id, s.odds from bet_selections s join bet_markets k on k.id = s.market_id where k.match_id = $1 and k.kind = '1x2' and s.code = '1'`, [m.match_id]);
  // membro da equipa não aposta no próprio desafio (nem pelo wrapper nem por bets_place direto)
  await asUser(U.mema);
  await rpc('bets_confirm_age'); await rpc('bets_claim_weekly');
  assert.equal(Number(sel.odds), 2, 'desafio paga o dobro (odd fixa 2.00)');
  const others = await q(`select s.code from bet_selections s join bet_markets k on k.id = s.market_id where k.match_id = $1 order by s.code`, [m.match_id]);
  assert.deepEqual(others.map((x) => x.code), ['1', '2'], 'só equipa vencedora, sem empate nem outros mercados');
  assert.equal((await rpc('comp_bet_place', [sel.id, 10, sel.odds, 'pontos', true, idem('b1')])).code, 'COMP_OWN_CHALLENGE');
  await assert.rejects(db.query(`select public.bets_place(array[$1]::uuid[], 10, array[$2]::numeric[], false, 'pontos')`, [sel.id, sel.odds]), /COMP_OWN_CHALLENGE/);
  await asUser(U.apostador);
  await rpc('bets_confirm_age');
  assert.equal((await rpc('comp_bet_place', [sel.id, 100, sel.odds, 'mt', false, idem('b2')])).code, 'CONFIRM');
  const b = await rpc('comp_bet_place', [sel.id, 100, sel.odds, 'mt', true, idem('b2')]);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.terms.legs.length, 1); assert.equal(Number(b.terms.legs[0].odds), Number(sel.odds));
  assert.equal(b.terms.potential, Math.floor(100 * Number(sel.odds)));
  assert.equal((await rpc('comp_bet_place', [sel.id, 100, sel.odds, 'mt', true, idem('b2')])).duplicate, true);
  let w = await rpc('comp_wallet_me'); assert.equal(w.available, 400); assert.equal(w.reserved_bets, 100);
  await asService();
  await assert.rejects(db.query(`update bets set potential = 1 where id = $1`, [b.bet_id]), /COMP_TERMS_LOCKED/);
  await assert.rejects(db.query(`update bet_legs set odds = 9 where bet_id = $1`, [b.bet_id]), /COMP_TERMS_LOCKED/);
  await assert.rejects(db.query(`update comp_bet_terms set potential = 1 where bet_id = $1`, [b.bet_id]), /COMP_IMMUTABLE/);
  // jogo e resultado por acordo: aposta continua aberta até o admin VALIDAR
  await forceStart(T.c3);
  await asUser(U.capa); await rpc('comp_challenge_submit_result', [T.c3, T.a, 2, 0, []]);
  await asUser(U.capb); assert.equal((await rpc('comp_challenge_submit_result', [T.c3, T.b, 2, 0, []])).status, 'COMPLETED');
  await asService();
  let [bet] = await q(`select status from bets where id = $1`, [b.bet_id]); assert.equal(bet.status, 'aberta');
  await asUser(U.chefe, 'aal2');
  assert.equal((await rpc('comp_admin_challenge_action', [T.c3, 'verificar', null, null, 'ok'])).ok, true);
  await asService();
  [bet] = await q(`select status, payout from bets where id = $1`, [b.bet_id]);
  assert.equal(bet.status, 'ganha'); assert.equal(bet.payout, 200);
  await asUser(U.apostador);
  w = await rpc('comp_wallet_me'); assert.equal(w.available, 400 + bet.payout); assert.equal(w.reserved_bets, 0);
  // desligar → apostas recusadas outra vez
  await asUser(U.chefe, 'aal2');
  assert.equal((await rpc('comp_admin_set_flags', [false, false, ''])).ok, true);
  await asUser(U.apostador);
  assert.equal((await rpc('comp_bet_place', [sel.id, 10, sel.odds, 'pontos', true, idem('b3')])).code, 'BETTING_OFF');
  assert.equal((await rpc('comp_wallet_deposit_intent', [100, 'M-Pesa', '841234567', idem('d9')])).code, 'MONETARY_OFF');
  await asService();
  const aud = await q(`select action from comp_audit where action in ('funcionalidades_monetarias','licenca_registada','admin_desafio_resolver','deposito_confirmado')`);
  assert.ok(aud.length >= 4);
});

test('SQL: cancelamento segue as regras; previsões grátis fecham ao começar', { skip }, async () => {
  await asUser(U.capa);
  const r = await rpc('comp_challenge_create', [T.a, null, 'Aberto', '', 1, 1, future(), true, idem('c4')]); T.c4 = r.challenge_id;
  await asUser(U.apostador);
  assert.equal((await rpc('comp_predict', [T.c4, 'challenger'])).ok, true);
  await asUser(U.capb);
  assert.equal((await rpc('comp_challenge_cancel', [T.c4, 'x'])).code, 'CANCEL_NOT_ALLOWED');
  assert.equal((await rpc('comp_challenge_respond', [T.c4, true, T.b, null])).status, 'SCHEDULED');
  assert.equal((await rpc('comp_challenge_cancel', [T.c4, 'imprevisto'])).ok, true);
  await asUser(U.capa);
  assert.equal((await rpc('comp_challenge_cancel', [T.c4, 'outra vez'])).code, 'CANCEL_NOT_ALLOWED');
});
