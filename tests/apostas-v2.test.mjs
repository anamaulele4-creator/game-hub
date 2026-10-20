// Testes das regras puras de Apostas v2 e da venda de contas (lib/apostasV2.ts) — o mesmo comportamento do SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  V2_DEFAULT_LIMITS, canSellAccounts, claimTest, createMarket, emptyV2, grant, hasPerm, normResult, placeV2, potentialV2,
  setEnabled, setOdds, settleBetV2, settleMarketV2, validateStakeV2, balanceV2,
} from '../lib/apostasV2.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
function setup() {
  const d = emptyV2();
  d.roles = { dono: 'admin', mod: 'moderator', jog: 'user', cri: 'creator' };
  for (const p of ['markets', 'odds', 'settle', 'toggle']) assert.equal(grant(d, 'dono', 'dono', p, true, NOW).ok, true);
  return d;
}

test('v2: valor — inteiro, positivo, mín./máx., ≤ saldo', () => {
  const L = V2_DEFAULT_LIMITS;
  assert.equal(validateStakeV2(10.5, L, 100), 'STAKE_INT');
  assert.equal(validateStakeV2(NaN, L, 100), 'STAKE_INT');
  assert.equal(validateStakeV2(0, L, 100), 'STAKE_POSITIVE');
  assert.equal(validateStakeV2(-3, L, 100), 'STAKE_POSITIVE');
  assert.equal(validateStakeV2(5, L, 100), 'STAKE_MIN');
  assert.equal(validateStakeV2(5001, L, 1e6), 'STAKE_MAX');
  assert.equal(validateStakeV2(200, L, 100), 'BALANCE');
  assert.equal(validateStakeV2(100, L, 100), null);
  assert.equal(potentialV2(100, 1.8), 180);
  assert.equal(potentialV2(33, 1.15), 37);
});

test('v2: desligado por omissão — tudo do utilizador recusa', () => {
  const d = setup();
  assert.equal(d.enabled, false);
  assert.equal(claimTest(d, 'jog').code, 'DISABLED');
  assert.equal(placeV2(d, 'jog', 'x', 50, 2, NOW).code, 'DISABLED');
  assert.equal(setEnabled(d, 'jog', true, NOW).code, 'FORBIDDEN');
  assert.equal(setEnabled(d, 'mod', true, NOW).code, 'FORBIDDEN');
  assert.equal(setEnabled(d, 'dono', true, NOW).ok, true);
  assert.equal(d.audit[0].action, 'definicao:apostas_enabled');
  assert.deepEqual(d.audit[0].before, { value: false });
});

test('v2: permissões — admin tem só "permissions" implícita; utilizador normal não recebe', () => {
  const d = emptyV2(); d.roles = { a: 'admin', m: 'moderator', u: 'user' };
  assert.equal(hasPerm(d, 'a', 'permissions'), true);
  assert.equal(hasPerm(d, 'a', 'settle'), false);
  assert.equal(grant(d, 'u', 'u', 'settle', true, NOW).code, 'FORBIDDEN');
  assert.equal(grant(d, 'a', 'u', 'settle', true, NOW).code, 'ROLE');
  assert.equal(grant(d, 'a', 'm', 'odds', true, NOW).ok, true);
  assert.equal(hasPerm(d, 'm', 'odds'), true);
  assert.equal(createMarket(d, 'm', 'Mercado', 'ff', null, [{ label: 'A', odds: 2 }, { label: 'B', odds: 2 }], NOW).code, 'FORBIDDEN');
});

test('v2: odd trancada; se mudou, recusa e devolve a nova', () => {
  const d = setup(); setEnabled(d, 'dono', true, NOW);
  const m = createMarket(d, 'dono', 'Final', 'ff', null, [{ label: 'A', odds: 1.8 }, { label: 'B', odds: 2.1 }], NOW);
  const [a, b] = d.selections.filter((s) => s.marketId === m.id);
  claimTest(d, 'jog');
  setOdds(d, 'dono', b.id, 2.5, NOW);
  const r = placeV2(d, 'jog', b.id, 100, 2.1, NOW);
  assert.equal(r.code, 'ODDS_CHANGED'); assert.equal(r.odds, 2.5);
  assert.equal(balanceV2(d, 'jog'), 1000);
  const ok = placeV2(d, 'jog', b.id, 100, 2.5, NOW, 'req-1');
  assert.equal(ok.ok, true); assert.equal(ok.potential, 250);
  assert.equal(placeV2(d, 'jog', b.id, 100, 2.5, NOW, 'req-1').replay, true);
  assert.equal(balanceV2(d, 'jog'), 900);
  setOdds(d, 'dono', b.id, 4, NOW);
  assert.equal(d.bets.find((x) => x.id === ok.bet).oddsLocked, 2.5);
  assert.equal(placeV2(d, 'jog', a.id, 1, 1.8, NOW).code, 'STAKE_MIN');
});

test('v2: liquidação individual idempotente — nunca credita 2x', () => {
  const d = setup(); setEnabled(d, 'dono', true, NOW);
  const m = createMarket(d, 'dono', 'Final', 'ff', null, [{ label: 'A', odds: 2 }, { label: 'B', odds: 2 }], NOW);
  const [a, b] = d.selections.filter((s) => s.marketId === m.id);
  claimTest(d, 'jog'); claimTest(d, 'jog');
  assert.equal(balanceV2(d, 'jog'), 1000);
  const x = placeV2(d, 'jog', a.id, 100, 2, NOW); const y = placeV2(d, 'jog', a.id, 100, 2, NOW); const z = placeV2(d, 'jog', b.id, 100, 2, NOW);
  assert.equal(settleBetV2(d, 'mod', x.bet, 'won', NOW).code, 'FORBIDDEN');
  assert.equal(settleBetV2(d, 'dono', x.bet, 'won', NOW).payout, 200);
  assert.equal(settleBetV2(d, 'dono', x.bet, 'won', NOW).already, true);
  assert.equal(settleBetV2(d, 'dono', x.bet, 'refund', NOW).code, 'ALREADY_SETTLED');
  assert.equal(settleBetV2(d, 'dono', y.bet, 'refund', NOW).payout, 100);
  assert.equal(balanceV2(d, 'jog'), 700 + 200 + 100);
  assert.equal(settleMarketV2(d, 'dono', m.id, b.id, NOW).bets, 1);
  assert.equal(settleMarketV2(d, 'dono', m.id, b.id, NOW).already, true);
  assert.equal(balanceV2(d, 'jog'), 1200);
  assert.equal(d.bets.find((q) => q.id === z.bet).status, 'ganha');
  assert.equal(normResult('void'), 'anulada'); assert.equal(normResult('xyz'), null);
});

test('contas: só criador (e admin); desligado só admin', () => {
  assert.equal(canSellAccounts('utilizador', true), false);
  assert.equal(canSellAccounts('moderador', true), false);
  assert.equal(canSellAccounts('criador', true), true);
  assert.equal(canSellAccounts('admin', true), true);
  assert.equal(canSellAccounts('criador', false), false);
  assert.equal(canSellAccounts('admin', false), true);
});

test('páginas SQL: sql-apostas.html e sql-contas.html mostram a migração inteira com botão de copiar', () => {
  for (const [page, mig] of [['public/sql-apostas.html', 'supabase/migrations/2026-10-20-apostas-v2.sql'], ['public/sql-contas.html', 'supabase/migrations/2026-10-20-venda-contas.sql']]) {
    const html = fs.readFileSync(page, 'utf8');
    const sql = fs.readFileSync(mig, 'utf8');
    assert.ok(html.includes('Copiar tudo e abrir o Supabase'));
    const full = JSON.parse(html.match(/const full=(".*?");\n/s)[1]);
    assert.equal(full, sql, `${page} desatualizada: corre scripts/sql-page.py`);
    assert.ok(!/marketplace 3|market_v3/i.test(sql.replace(/^--.*$/gm, '')), 'sem SQL do Marketplace 3.0');
  }
});

test('migração: idempotente por construção e sem caminhos de dinheiro real', () => {
  const sql = fs.readFileSync('supabase/migrations/2026-10-20-apostas-v2.sql', 'utf8');
  assert.ok(!/create table (?!if not exists)/i.test(sql));
  assert.equal(sql.match(/create policy/g).length, sql.match(/drop policy if exists/g).length);
  assert.equal(sql.match(/create trigger/g).length, sql.match(/drop trigger if exists/g).length);
  assert.ok(!/money_ledger|bets__post_mt|clicpay|igj|payments/i.test(sql.replace(/^--.*$/gm, '')));
  assert.match(sql, /\('apostas_enabled', 'false'::jsonb/);
});
