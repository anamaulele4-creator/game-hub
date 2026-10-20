// Testes das regras puras de Apostas v3 (lib/apostasV2.ts, secção v3) — o mesmo comportamento do SQL
// (supabase/migrations/2026-10-21-apostas-v3.sql, testado em tests/apostas-v3-sql.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  emptyV2, grant, balanceV2, claimTest, settleBetV2, settleMarketV2, calcStake, oddsToHundredths, matchNextOk, betNextOk, filterBetsV3, isOpenBet,
  marketExposureOf, createMatchV3, matchStatusV3, confirmV3, proposeResultV3, reviewResultV3, cancelMatchV3, refundBetV3, setLimitV3, setChipsV3,
  openComplaintV3, updateComplaintV3, tickV3, walletV3, marketExposureV3, v3, V3_GAMES, V3_DEFAULT_CHIPS, v2ErrText, V2_RESULT_NAMES,
} from '../lib/apostasV2.ts';

const NOW = Date.parse('2026-10-21T10:00:00+02:00');
const H = 3600e3;
let rq = 0;
const req = () => `req-${++rq}`;
function setup() {
  const d = emptyV2();
  d.roles = { dono: 'admin', rev: 'admin', mod: 'moderator', jog: 'user', jog2: 'user', menor: 'user' };
  for (const p of ['markets', 'odds', 'settle', 'toggle']) grant(d, 'dono', 'dono', p, true, NOW);
  grant(d, 'dono', 'rev', 'settle', true, NOW);
  d.enabled = true;
  for (const u of ['jog', 'jog2', 'menor']) claimTest(d, u);
  return d;
}
function match(d, extra = {}) {
  const r = createMatchV3(d, 'dono', { game: 'ff', teamA: 'Fênix', teamB: 'Raio', startsAt: new Date(NOW + 24 * H).toISOString(), oddsA: 1.8, oddsB: 2.1, ...extra }, NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  const sels = d.selections.filter((s) => s.marketId === r.market);
  return { id: r.id, market: r.market, a: sels.find((s) => s.side === 'a').id, b: sels.find((s) => s.side === 'b').id, draw: sels.find((s) => s.side === 'empate')?.id };
}
const open = (d, m) => assert.equal(matchStatusV3(d, 'dono', m.id, 'apostas_abertas', 'abrir apostas', NOW).ok, true);

test('v3 cálculo: retorno = valor × multiplicador, ganho = retorno − valor, inteiros e sem erros de vírgula flutuante', () => {
  assert.deepEqual(calcStake(100, 1.85), { valor: 100, mult: 1.85, retorno: 185, ganho: 85, retornoExato: '185.00' });
  assert.equal(calcStake(33, 1.15).retorno, 37); // 37.95 → 37 (como o servidor: floor)
  assert.equal(calcStake(33, 1.15).retornoExato, '37.95');
  assert.equal(calcStake(10, 0.1 + 0.2 + 1).retorno, 13); // 1.3000000000000003 → 1.30
  assert.equal(calcStake(3, '1,1').retornoExato, '3.30');
  assert.equal(calcStake(1000, 2.675).mult, 2.68); // arredonda à centésima como round(x,2)
  assert.equal(oddsToHundredths('abc'), NaN);
  assert.equal(calcStake(0, 2), null);
  assert.equal(calcStake(-10, 2), null);
  assert.equal(calcStake(10.5, 2), null);
  assert.equal(calcStake(10, 1), null, 'multiplicador < 1.01 é inválido');
  for (let v = 1; v <= 2000; v += 7) for (const o of [1.01, 1.15, 1.33, 2.05, 2.675, 9.99]) {
    const c = calcStake(v, o);
    assert.equal(c.ganho, c.retorno - c.valor);
    assert.ok(Number.isInteger(c.retorno));
  }
});

test('v3 estados: transições do confronto e da aposta iguais ao SQL', () => {
  assert.equal(matchNextOk('agendado', 'apostas_abertas'), true);
  assert.equal(matchNextOk('finalizado', 'em_andamento'), false);
  assert.equal(matchNextOk('aguarda_resultado', 'apostas_abertas'), false);
  assert.equal(betNextOk('confirmada', 'em_andamento'), true);
  assert.equal(betNextOk('ganha', 'perdida'), false);
  assert.equal(betNextOk('pendente_confirmacao', 'ganha'), false);
  assert.equal(isOpenBet('aberta'), true); assert.equal(isOpenBet('reembolsada'), false);
  assert.equal(V2_RESULT_NAMES.em_analise, 'Em análise');
  assert.deepEqual(V3_GAMES.map((g) => g.key), ['ff', 'ef', 'dls', 'fortnite', 'cod', 'cr', 'valorant', 'minecraft', 'outros']);
  for (const c of ['BALANCE', 'CLOSED', 'NETWORK', 'ODDS_CHANGED', 'RESULT_NOT_VALIDATED']) assert.notEqual(v2ErrText(c), c);
});

test('v3 confirmar: fechado/suspenso, saldo insuficiente, valor inválido, odd mudou, duplo clique', () => {
  const d = setup();
  const m = match(d);
  assert.equal(confirmV3(d, 'jog', m.a, 100, 1.8, NOW, req()).code, 'CLOSED');
  matchStatusV3(d, 'dono', m.id, 'suspenso', 'suspender', NOW);
  assert.equal(confirmV3(d, 'jog', m.a, 100, 1.8, NOW, req()).code, 'SUSPENDED');
  open(d, m);
  assert.equal(confirmV3(d, 'jog', m.a, 100, 1.8, NOW, null).code, 'REQUEST_ID');
  assert.equal(confirmV3(d, 'jog', m.a, -5, 1.8, NOW, req()).code, 'STAKE_POSITIVE');
  assert.equal(confirmV3(d, 'jog', m.a, 12.5, 1.8, NOW, req()).code, 'STAKE_INT');
  assert.equal(confirmV3(d, 'jog', m.a, 4000, 1.8, NOW, req()).code, 'BALANCE');
  assert.equal(confirmV3(d, 'jog', m.a, 100, 1.7, NOW, req()).code, 'ODDS_CHANGED');
  const id = req();
  const r = confirmV3(d, 'jog', m.a, 100, 1.8, NOW, id);
  assert.equal(r.ok, true); assert.equal(r.status, 'confirmada'); assert.equal(r.potential, 180);
  assert.equal(confirmV3(d, 'jog', m.a, 100, 1.8, NOW, id).replay, true);
  assert.equal(confirmV3(d, 'jog', m.a, 200, 1.8, NOW, id).code, 'REQUEST_REUSED');
  assert.equal(balanceV2(d, 'jog'), 900);
  const ev = v3(d).events.filter((e) => e.betId === r.bet).map((e) => `${e.from}>${e.to}`);
  assert.deepEqual(ev, ['null>pendente_confirmacao', 'pendente_confirmacao>confirmada']);
  assert.equal(confirmV3(d, 'jog', m.a, 50, 1.8, NOW + 25 * H, req()).code, 'CLOSED', 'depois da hora de início fecha (relógio do servidor)');
  v3(d).accounts.menor = { block: 'UNDERAGE' };
  assert.equal(confirmV3(d, 'menor', m.a, 50, 1.8, NOW, req()).code, 'UNDERAGE');
});

test('v3 limites: por aposta, por utilizador e exposição do mercado com suspensão automática', () => {
  const d = setup();
  const m = match(d); open(d, m);
  assert.equal(setLimitV3(d, 'mod', { scope: 'market', ref: m.market, maxStake: null, maxExposure: 1, autoSuspend: true, active: true }, 'x', NOW).code, 'FORBIDDEN');
  assert.equal(setLimitV3(d, 'dono', { scope: 'user', ref: '', maxStake: 300, maxExposure: 500, autoSuspend: true, active: true }, 'limite geral', NOW).ok, true);
  assert.equal(setLimitV3(d, 'dono', { scope: 'market', ref: m.market, maxStake: null, maxExposure: 100, autoSuspend: true, active: true }, 'exposição', NOW).ok, true);
  assert.equal(confirmV3(d, 'jog', m.a, 400, 1.8, NOW, req()).code, 'LIMIT_STAKE');
  assert.equal(confirmV3(d, 'jog', m.a, 100, 1.8, NOW, req()).ok, true);
  assert.equal(confirmV3(d, 'jog2', m.b, 100, 2.1, NOW, req()).ok, true);
  assert.equal(marketExposureV3(d, m.market), 10);
  assert.equal(confirmV3(d, 'jog2', m.b, 200, 2.1, NOW, req()).code, 'LIMIT_EXPOSURE');
  setLimitV3(d, 'dono', { scope: 'market', ref: m.market, maxStake: null, maxExposure: 10, autoSuspend: true, active: true }, 'baixar', NOW);
  assert.equal(confirmV3(d, 'jog', m.b, 20, 2.1, NOW, req()).code, 'LIMIT_EXPOSURE');
  assert.equal(d.markets.find((x) => x.id === m.market).status, 'suspenso');
  assert.equal(marketExposureOf([{ id: 'a' }, { id: 'b' }], [{ selectionId: 'a', stake: 100, potential: 180, status: 'confirmada' }], { selectionId: 'b', stake: 100, potential: 210 }), 10);
});

test('v3 resultados: dupla validação, liquidação única, rejeição volta a aguardar', () => {
  const d = setup();
  const m = match(d); open(d, m);
  const a = confirmV3(d, 'jog', m.a, 100, 1.8, NOW, req());
  const b = confirmV3(d, 'jog2', m.b, 100, 2.1, NOW, req());
  assert.equal(settleBetV2(d, 'dono', a.bet, 'won', NOW).code, 'RESULT_NOT_VALIDATED');
  assert.equal(settleMarketV2(d, 'dono', m.market, m.a, NOW).code, 'RESULT_NOT_VALIDATED');
  assert.equal(proposeResultV3(d, 'dono', m.id, 'a', 2, 0, 'cedo', NOW).code, 'STATE');
  matchStatusV3(d, 'dono', m.id, 'em_andamento', 'começou', NOW);
  assert.equal(d.bets.find((x) => x.id === a.bet).status, 'em_andamento');
  assert.equal(proposeResultV3(d, 'dono', m.id, 'empate', 1, 1, 'empate', NOW).code, 'INVALID_RESULT');
  assert.equal(proposeResultV3(d, 'dono', m.id, 'a', 0, 1, 'placar errado', NOW).code, 'INVALID_RESULT');
  const p = proposeResultV3(d, 'dono', m.id, 'b', 0, 2, 'oficial', NOW, 'p1');
  assert.equal(p.ok, true);
  assert.equal(proposeResultV3(d, 'dono', m.id, 'b', 0, 2, 'oficial', NOW, 'p1').replay, true);
  assert.equal(d.bets.find((x) => x.id === a.bet).status, 'em_analise');
  assert.equal(reviewResultV3(d, 'rev', p.id, false, 'falta prova', NOW).status, 'rejeitado');
  assert.equal(d.bets.find((x) => x.id === a.bet).status, 'em_andamento');
  const p2 = proposeResultV3(d, 'rev', m.id, 'b', 0, 2, 'com prova', NOW);
  assert.equal(reviewResultV3(d, 'rev', p2.id, true, 'eu mesmo', NOW).code, 'SAME_REVIEWER');
  assert.equal(reviewResultV3(d, 'jog', p2.id, true, 'hack', NOW).code, 'FORBIDDEN');
  assert.equal(reviewResultV3(d, 'dono', p2.id, true, 'confirmado', NOW).ok, true);
  assert.equal(balanceV2(d, 'jog2'), 900 + 210);
  assert.equal(balanceV2(d, 'jog'), 900);
  assert.equal(reviewResultV3(d, 'dono', p2.id, true, 'de novo', NOW).already, true);
  assert.equal(balanceV2(d, 'jog2'), 1110, 'liquidação duplicada não credita');
  const bb = d.bets.find((x) => x.id === b.bet);
  assert.equal(bb.settledAmount, 210); assert.equal(bb.officialResult, 'Raio (0-2)');
  assert.equal(matchStatusV3(d, 'dono', m.id, 'apostas_abertas', 'reabrir', NOW).code, 'STATE');
});

test('v3 cancelar e reembolsar: idempotentes, nunca 2x', () => {
  const d = setup();
  const m = match(d, { oddsDraw: 3 }); open(d, m);
  const a = confirmV3(d, 'jog', m.a, 100, 1.8, NOW, req());
  const x = confirmV3(d, 'jog', m.draw, 50, 3, NOW, req());
  assert.equal(refundBetV3(d, 'dono', x.bet, '', NOW).code, 'MOTIVO');
  assert.equal(refundBetV3(d, 'dono', x.bet, 'pedido', NOW).payout, 50);
  assert.equal(refundBetV3(d, 'dono', x.bet, 'pedido', NOW).already, true);
  assert.equal(cancelMatchV3(d, 'mod', m.id, 'x', NOW).code, 'FORBIDDEN');
  assert.equal(cancelMatchV3(d, 'dono', m.id, 'falta de comparência', NOW).refunds, 1);
  assert.equal(cancelMatchV3(d, 'dono', m.id, 'de novo', NOW).already, true);
  assert.equal(balanceV2(d, 'jog'), 1000);
  assert.equal(d.bets.find((b) => b.id === a.bet).status, 'reembolsada');
  assert.equal(d.ledger.filter((l) => l.reason === 'liquidacao').length, 2);
});

test('v3 carteira, filtros de Minhas Apostas, valores sugeridos, reclamações e início automático', () => {
  const d = setup();
  const m = match(d); open(d, m);
  const a = confirmV3(d, 'jog', m.a, 100, 1.8, NOW, req());
  assert.deepEqual(walletV3(d, 'jog'), { available: 900, reserved: 100, pending: 1, wonTotal: 0, netWon: 0, refundedTotal: 0 });
  const rows = d.bets.map((b) => ({ ...b, game: 'ff', label: b.selectionLabel, market: 'Fênix vs Raio' }));
  assert.equal(filterBetsV3(rows, { tab: 'pendentes' }).length, 1);
  assert.equal(filterBetsV3(rows, { tab: 'ganhas' }).length, 0);
  assert.equal(filterBetsV3(rows, { game: 'cod' }).length, 0);
  assert.equal(filterBetsV3(rows, { q: 'fênix' }).length, 1);
  assert.equal(filterBetsV3(rows, { from: '2026-10-22' }).length, 0);
  assert.deepEqual(v3(d).chips, V3_DEFAULT_CHIPS);
  assert.equal(setChipsV3(d, 'jog', [1, 2], NOW).code, 'FORBIDDEN');
  assert.equal(setChipsV3(d, 'dono', [100, 50], NOW).code, 'INVALID');
  assert.equal(setChipsV3(d, 'dono', [20, 50, 100], NOW).ok, true);
  assert.equal(openComplaintV3(d, 'jog2', a.bet, null, 'não é minha aposta', NOW).code, 'NOT_FOUND');
  const c = openComplaintV3(d, 'jog', a.bet, null, 'Resultado parece errado', NOW);
  assert.equal(c.ok, true);
  assert.equal(updateComplaintV3(d, 'jog', c.id, 'resolvida', 'ok ok', NOW).code, 'FORBIDDEN');
  assert.equal(updateComplaintV3(d, 'dono', c.id, 'resolvida', 'Verificado', NOW).ok, true);
  assert.equal(tickV3(d, NOW + 25 * H), 1);
  assert.equal(v3(d).matches[0].status, 'em_andamento');
  assert.equal(d.bets[0].status, 'em_andamento');
});

test('v3 SQL: migração e rollback existem, são aditivos e mantêm só saldo de teste', () => {
  const up = fs.readFileSync(new URL('../supabase/migrations/2026-10-21-apostas-v3.sql', import.meta.url), 'utf8');
  const code = up.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const down = fs.readFileSync(new URL('../supabase/migrations/rollback/2026-10-21-apostas-v3-down.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(up, /drop table/i, 'a migração não apaga tabelas');
  assert.doesNotMatch(code, /mkt3_|market_orders|clicpay|comp_wallet/i, 'não toca no marketplace nem em pagamentos');
  assert.doesNotMatch(up, /currency\s*=\s*'mt'|real_money_enabled\s*=\s*true/i);
  assert.match(down, /drop table if exists public\.apv2_matches/);
  for (const f of ['apv2_bet_confirm', 'apv2_admin_result_review', 'apv2_admin_match_cancel', 'apv2_admin_refund_bet', 'apv2_wallet']) assert.match(up, new RegExp(`function public\\.${f}\\(`));
});

test('v3 página SQL: sql-apostas-v3.html mostra a migração inteira com botão de copiar', () => {
  const html = fs.readFileSync('public/sql-apostas-v3.html', 'utf8');
  const sql = fs.readFileSync('supabase/migrations/2026-10-21-apostas-v3.sql', 'utf8');
  assert.ok(html.includes('Copiar tudo e abrir o Supabase'));
  assert.equal(JSON.parse(html.match(/const full=(".*?");\n/s)[1]), sql, 'página desatualizada: corre scripts/sql-page.py');
});
