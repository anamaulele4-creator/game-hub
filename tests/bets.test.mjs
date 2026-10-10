// Testes das Apostas TXAP Pontos (node:test). Correr: npm test
// Motor de odds, múltiplas, liquidação/anulação, correções, limites e jogo responsável. Tudo determinístico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceOdds, eloExpected, eloDelta, probOver, matchMarkets, outrightProbs, selectionResult, comboOdds, evalBet, validateSlip,
  realMoneyUnlockable, validateKyc, isoWeekRef, DEFAULT_SETTINGS, NO_LIMITS, ODDS_MIN, ODDS_MAX, maputoDayStart, maputoWeekStart,
} from '../lib/bets.ts';
import * as core from '../lib/betsCore.ts';

const T0 = Date.parse('2026-10-10T10:00:00Z');
const H = 3600e3;
const U = 'u1';

function setup() {
  const db = core.emptyDB();
  core.claimWeekly(db, U, T0);
  const m = core.createMatch(db, { game: 'ef', home: 'Mambas', away: 'Leões', startsAt: new Date(T0 + 5 * H).toISOString(), tournamentId: 'tA', tournamentName: 'Taça A' }, 'admin', T0);
  core.confirmAge(db, U, '2000-01-01', T0);
  return { db, m };
}
const sel = (db, matchId, kind, code) => {
  const mk = db.markets.find((x) => x.matchId === matchId && x.kind === kind);
  return db.selections.find((s) => s.marketId === mk.id && s.code === code);
};
const place = (db, ids, stake, extra = {}) => core.placeBet(db, U, { selectionIds: ids.map((s) => s.id), stake, odds: ids.map((s) => s.odds), ...extra }, T0 + H);

test('odds: margem, arredondamento a 2 casas e limites 1.05–50', () => {
  assert.equal(priceOdds(0.5, 0), 2);
  assert.equal(priceOdds(0.5, 0.07), 1.87); // 1/(0.5×1.07)=1.869…
  assert.equal(priceOdds(0.99, 0.07), ODDS_MIN);
  assert.equal(priceOdds(0.001, 0.07), ODDS_MAX);
  assert.equal(priceOdds(0, 0.07), ODDS_MAX);
});

test('Elo: equipas iguais 50 %, atualização simétrica e soma zero', () => {
  assert.equal(eloExpected(1500, 1500), 0.5);
  assert.ok(eloExpected(1700, 1500) > 0.75);
  const [a, b] = eloDelta(1500, 1500, 1, 32);
  assert.equal(a, 16); assert.equal(b, -16);
  const [c, d] = eloDelta(1600, 1400, 0.5, 32);
  assert.ok(c < 0 && d > 0 && Math.abs(c + d) < 1e-9);
});

test('mercados de futebol: 1X2, total e resultado exato somam 100 % antes da margem', () => {
  const ms = matchMarkets('ef', 'A', 'B', 1550, 1450);
  assert.deepEqual(ms.map((m) => m.kind), ['1x2', 'total', 'exact']);
  for (const m of ms) assert.ok(Math.abs(m.selections.reduce((s, x) => s + x.prob, 0) - 1) < 1e-9, m.kind);
  const [p1, px, p2] = ms[0].selections.map((s) => s.prob);
  assert.ok(p1 > p2 && px > 0.1);
  assert.equal(ms[2].selections.length, 17);
  // determinístico: mesma entrada → mesma saída
  assert.deepEqual(matchMarkets('ef', 'A', 'B', 1550, 1450), ms);
});

test('FF/CR: mercado de 2 resultados + total de kills/coroas', () => {
  const ff = matchMarkets('ff', 'A', 'B', 1500, 1500);
  assert.deepEqual(ff.map((m) => m.kind), ['12', 'total']);
  assert.equal(ff[0].selections[0].prob, 0.5);
  assert.equal(ff[1].line, 19.5);
  assert.ok(Math.abs(probOver(20, 19.5) - ff[1].selections[0].prob) < 1e-12);
  const cr = matchMarkets('cr', 'A', 'B', 1500, 1600);
  assert.equal(cr[0].kind, '12');
  assert.ok(cr[0].selections[1].prob > 0.6);
});

test('vencedor do torneio: probabilidades pelo Elo somam 1', () => {
  const p = outrightProbs([{ name: 'A', rating: 1600 }, { name: 'B', rating: 1500 }, { name: 'C', rating: 1400 }]);
  assert.ok(Math.abs(p.reduce((s, x) => s + x.prob, 0) - 1) < 1e-12);
  assert.ok(p[0].prob > p[1].prob && p[1].prob > p[2].prob);
});

test('resultado das seleções', () => {
  assert.equal(selectionResult('1x2', 'X', null, 1, 1), 'ganha');
  assert.equal(selectionResult('1x2', '1', null, 0, 2), 'perdida');
  assert.equal(selectionResult('12', '1', null, 2, 2), 'anulada');
  assert.equal(selectionResult('total', 'over', 2.5, 2, 1), 'ganha');
  assert.equal(selectionResult('total', 'under', 19.5, 10, 10), 'perdida');
  assert.equal(selectionResult('exact', '2-1', null, 2, 1), 'ganha');
  assert.equal(selectionResult('exact', 'outro', null, 4, 0), 'ganha');
});

test('múltiplas: produto das odds, anuladas a 1.00, todas anuladas = reembolso, teto de pagamento', () => {
  assert.equal(comboOdds([1.5, 2, 1.8]), 5.4);
  assert.deepEqual(evalBet([{ odds: 2, result: 'ganha' }, { odds: 3, result: 'anulada' }], 100, 1e6), { status: 'ganha', payout: 200, odds: 2 });
  assert.equal(evalBet([{ odds: 2, result: 'ganha' }, { odds: 3, result: 'perdida' }], 100, 1e6).status, 'perdida');
  assert.equal(evalBet([{ odds: 2, result: 'ganha' }, { odds: 3, result: 'pendente' }], 100, 1e6).status, 'aberta');
  assert.deepEqual(evalBet([{ odds: 2, result: 'anulada' }], 100, 1e6), { status: 'anulada', payout: 100, odds: 1 });
  assert.equal(evalBet([{ odds: 50, result: 'ganha' }, { odds: 50, result: 'ganha' }], 5000, 100000).payout, 100000);
});

test('boletim: limites, mesmo jogo, máx. 10 seleções, idade e autoexclusão', () => {
  const leg = (i, g = 'm' + i) => ({ selectionId: 's' + i, groupId: g, odds: 2, open: true });
  const lim = { ...NO_LIMITS, ageConfirmedAt: '2026-01-01' };
  const ctx = { balance: 1000, stakedToday: 0, stakedWeek: 0, now: T0 };
  assert.deepEqual(validateSlip([leg(1)], 100, DEFAULT_SETTINGS, lim, ctx), []);
  assert.ok(validateSlip([leg(1)], 100, DEFAULT_SETTINGS, NO_LIMITS, ctx).includes('NO_AGE'));
  assert.ok(validateSlip([leg(1, 'x'), leg(2, 'x')], 100, DEFAULT_SETTINGS, lim, ctx).includes('SAME_MATCH'));
  assert.ok(validateSlip(Array.from({ length: 11 }, (_, i) => leg(i)), 100, DEFAULT_SETTINGS, lim, ctx).includes('TOO_MANY_LEGS'));
  assert.ok(validateSlip([leg(1)], 5, DEFAULT_SETTINGS, lim, ctx).includes('STAKE_MIN'));
  assert.ok(validateSlip([leg(1)], 6000, DEFAULT_SETTINGS, lim, { ...ctx, balance: 9999 }).includes('STAKE_MAX'));
  assert.ok(validateSlip([leg(1)], 2000, DEFAULT_SETTINGS, lim, ctx).includes('BALANCE'));
  assert.ok(validateSlip([leg(1)], 300, DEFAULT_SETTINGS, { ...lim, maxStake: 200 }, ctx).includes('LIMIT_STAKE'));
  assert.ok(validateSlip([leg(1)], 300, DEFAULT_SETTINGS, { ...lim, maxDaily: 500 }, { ...ctx, stakedToday: 300 }).includes('LIMIT_DAILY'));
  assert.ok(validateSlip([leg(1)], 300, DEFAULT_SETTINGS, { ...lim, maxWeekly: 500 }, { ...ctx, stakedWeek: 300 }).includes('LIMIT_WEEKLY'));
  assert.ok(validateSlip([leg(1)], 100, DEFAULT_SETTINGS, { ...lim, selfExcludedUntil: new Date(T0 + 86400e3).toISOString() }, ctx).includes('SELF_EXCLUDED'));
});

test('agendar um jogo abre mercados; início suspende; bónus semanal só 1× por semana', () => {
  const { db, m } = setup();
  assert.equal(core.balanceOf(db, U), 1000);
  assert.equal(core.claimWeekly(db, U, T0 + H).credited, false);
  assert.equal(core.claimWeekly(db, U, T0 + 7 * 86400e3).credited, true);
  const mk = db.markets.filter((x) => x.matchId === m.id);
  assert.equal(mk.length, 3);
  assert.ok(mk.every((x) => x.status === 'aberto'));
  assert.ok(db.markets.some((x) => x.kind === 'outright' && x.tournamentId === 'tA'), 'vencedor do torneio abre com 2+ equipas');
  core.sweep(db, T0 + 5 * H);
  assert.ok(db.markets.filter((x) => x.matchId === m.id).every((x) => x.status === 'suspenso'));
  assert.equal(m.status, 'ao_vivo');
  core.sweep(db, T0 + 5 * H); // idempotente
  assert.equal(core.ledgerConsistent(db, U), true);
});

test('aposta simples: odds bloqueadas, alteração de odds pede aceitação, liquidação idempotente', () => {
  const { db, m } = setup();
  const s1 = sel(db, m.id, '1x2', '1');
  const oldOdds = s1.odds;
  core.overrideOdds(db, s1.id, oldOdds + 0.4, 'admin', T0);
  const r0 = core.placeBet(db, U, { selectionIds: [s1.id], stake: 100, odds: [oldOdds] }, T0 + H);
  assert.equal(r0.ok, false); assert.equal(r0.code, 'ODDS_CHANGED');
  const r = core.placeBet(db, U, { selectionIds: [s1.id], stake: 100, odds: [oldOdds], acceptChanges: true }, T0 + H);
  assert.equal(r.ok, true);
  assert.equal(core.balanceOf(db, U), 900);
  const bet = db.bets[0];
  assert.equal(bet.totalOdds, Math.round((oldOdds + 0.4) * 100) / 100);
  core.overrideOdds(db, s1.id, 9, 'admin', T0 + 2 * H); // odds mudam depois: a aposta fica com as antigas
  core.recordResult(db, m.id, 2, 1, 'admin', T0 + 7 * H);
  assert.equal(bet.status, 'ganha');
  assert.equal(core.balanceOf(db, U), 900 + Math.floor(100 * bet.totalOdds));
  const n = db.ledger.length;
  core.settleBet(db, bet.id, T0 + 8 * H); core.sweep(db, T0 + 8 * H);
  assert.equal(db.ledger.length, n, 'nada pago duas vezes');
  assert.equal(core.ledgerConsistent(db, U), true);
  assert.ok(db.log.some((l) => l.action === 'odd_alterada'));
});

test('correção de resultado reverte e volta a liquidar (Elo incluído)', () => {
  const { db, m } = setup();
  const s1 = sel(db, m.id, '1x2', '1');
  place(db, [s1], 100);
  core.recordResult(db, m.id, 2, 0, 'admin', T0 + 7 * H);
  const won = core.balanceOf(db, U);
  assert.ok(won > 900);
  const rHome = db.teams.find((t) => t.name === 'Mambas').rating;
  core.recordResult(db, m.id, 0, 1, 'admin', T0 + 8 * H);
  assert.equal(db.bets[0].status, 'perdida');
  assert.equal(core.balanceOf(db, U), 900);
  assert.ok(db.teams.find((t) => t.name === 'Mambas').rating < rHome);
  assert.equal(core.ledgerConsistent(db, U), true);
  assert.ok(db.log.some((l) => l.action === 'resultado_corrigido'));
});

test('múltipla com jogo cancelado: perna anulada a 1.00; jogo cancelado = reembolso', () => {
  const { db, m } = setup();
  const m2 = core.createMatch(db, { game: 'ff', home: 'Fênix', away: 'Raio', startsAt: new Date(T0 + 6 * H).toISOString() }, 'admin', T0);
  const a = sel(db, m.id, 'total', 'over'), b = sel(db, m2.id, '12', '1');
  assert.equal(place(db, [a, sel(db, m.id, '1x2', '1')], 50).code, 'SAME_MATCH');
  const r = place(db, [a, b], 100);
  assert.equal(r.ok, true);
  assert.equal(db.bets[0].totalOdds, comboOdds([a.odds, b.odds]));
  core.cancelMatch(db, m2.id, 'admin', T0 + 2 * H);
  assert.equal(m2.voided, true);
  core.recordResult(db, m.id, 2, 2, 'admin', T0 + 7 * H);
  assert.equal(db.bets[0].status, 'ganha');
  assert.equal(db.bets[0].payout, Math.floor(100 * a.odds));
  // simples num jogo cancelado → reembolso
  const { db: db2, m: mm } = setup();
  place(db2, [sel(db2, mm.id, '1x2', 'X')], 200);
  core.cancelMatch(db2, mm.id, 'admin', T0 + 2 * H);
  assert.equal(db2.bets[0].status, 'anulada');
  assert.equal(core.balanceOf(db2, U), 1000);
});

test('adiamento: até 48 h reabre mercados; mais de 48 h anula e reembolsa', () => {
  const { db, m } = setup();
  place(db, [sel(db, m.id, '1x2', '2')], 100);
  core.sweep(db, T0 + 5 * H);
  core.rescheduleMatch(db, m.id, new Date(T0 + 30 * H).toISOString(), 'admin', T0 + 5.5 * H);
  assert.equal(m.status, 'agendado');
  assert.ok(db.markets.filter((x) => x.matchId === m.id).every((x) => x.status === 'aberto'));
  core.rescheduleMatch(db, m.id, new Date(T0 + 60 * H).toISOString(), 'admin', T0 + 6 * H);
  assert.equal(m.voided, true);
  assert.equal(db.bets[0].status, 'anulada');
  assert.equal(core.balanceOf(db, U), 1000);
  // adiado sem nova data: anulado quando passam 48 h
  const { db: d2, m: m2 } = setup();
  core.postponeMatch(d2, m2.id, 'admin', T0 + H);
  assert.equal(m2.voided, false);
  core.sweep(d2, T0 + 5 * H + 49 * H);
  assert.equal(m2.voided, true);
});

test('não se aposta depois do início, em autoexclusão ou sem confirmar 18+', () => {
  const { db, m } = setup();
  const s = sel(db, m.id, '1x2', '1');
  assert.equal(core.placeBet(db, U, { selectionIds: [s.id], stake: 100, odds: [s.odds] }, T0 + 5 * H).code, 'CLOSED');
  core.selfExclude(db, U, 7, T0);
  assert.equal(place(db, [s], 100).code, 'SELF_EXCLUDED');
  core.selfExclude(db, U, 7, T0 + 86400e3 * 30); // pedidos novos não encurtam
  assert.throws(() => core.selfExclude(db, U, 3, T0));
  const db3 = core.emptyDB(); core.claimWeekly(db3, 'x', T0);
  const mm = core.createMatch(db3, { game: 'cr', home: 'A', away: 'B', startsAt: new Date(T0 + 5 * H).toISOString() }, 'admin', T0);
  const s3 = sel(db3, mm.id, '12', '1');
  assert.equal(core.placeBet(db3, 'x', { selectionIds: [s3.id], stake: 50, odds: [s3.odds] }, T0).code, 'NO_AGE');
  assert.throws(() => core.confirmAge(db3, 'x', '2012-05-01', T0), /MINOR/);
});

test('vencedor do torneio e exposição/alertas do admin', () => {
  const { db, m } = setup();
  core.createMatch(db, { game: 'ef', home: 'Águias', away: 'Mambas', startsAt: new Date(T0 + 8 * H).toISOString(), tournamentId: 'tA', tournamentName: 'Taça A' }, 'admin', T0);
  const out = db.markets.find((x) => x.kind === 'outright' && x.tournamentId === 'tA');
  const sels = db.selections.filter((s) => s.marketId === out.id);
  assert.equal(sels.length, 3);
  assert.equal(out.closesAt, m.startsAt);
  const mamb = sels.find((s) => s.code === 'Mambas');
  db.settings.bigStakeAlert = 300;
  place(db, [mamb], 300);
  const ov = core.overview(db);
  assert.equal(ov.alerts[0].kind, 'aposta_grande');
  assert.equal(ov.exposure[0].liability, db.bets[0].potential);
  core.settleOutright(db, out.id, mamb.id, 'admin', T0 + 50 * H);
  assert.equal(db.bets[0].status, 'ganha');
});

test('dinheiro real: desligado por omissão; liga só com licença IGJ válida + confirmação explícita', () => {
  const db = core.emptyDB();
  assert.equal(db.settings.realMoneyEnabled, false);
  const today = '2026-10-10';
  assert.equal(realMoneyUnlockable({ igjLicenceNo: '', igjLicenceDate: '2026-01-01', igjLicenceExpiry: '2027-01-01' }, 'CONFIRMO', today).ok, false);
  assert.equal(realMoneyUnlockable({ igjLicenceNo: 'X', igjLicenceDate: '2026-01-01', igjLicenceExpiry: '2026-10-01' }, 'CONFIRMO', today).ok, false, 'licença expirada');
  assert.equal(realMoneyUnlockable({ igjLicenceNo: 'X', igjLicenceDate: '2026-01-01', igjLicenceExpiry: '2027-01-01' }, 'sim', today).ok, false, 'sem confirmação');
  assert.equal(realMoneyUnlockable({ igjLicenceNo: 'X', igjLicenceDate: '2026-01-01', igjLicenceExpiry: '2027-01-01' }, 'confirmo', today).ok, true);
  assert.throws(() => core.setRealMoney(db, true, { licenceNo: 'LIC-TESTE', issue: '2026-01-01', expiry: '2027-01-01', confirm: '' }, 'admin', T0), /IGJ/);
  assert.equal(db.settings.realMoneyEnabled, false);
  assert.ok(db.log.some((l) => l.action === 'dinheiro_real_recusado'));
  core.saveSettings(db, { realMoneyEnabled: true, margin: 0.05 }, 'admin', T0);
  assert.equal(db.settings.realMoneyEnabled, false, 'definições gerais não ligam dinheiro real');
  core.setRealMoney(db, true, { licenceNo: 'LIC-TESTE', issue: '2026-01-01', expiry: '2027-01-01', confirm: 'CONFIRMO' }, 'admin', T0);
  assert.equal(core.realMoneyActive(db, T0), true);
  assert.equal(core.realMoneyActive(db, Date.parse('2027-01-02T00:00:00Z')), false, 'expira sozinho');
  assert.throws(() => core.saveSettings(db, { margin: 0.9 }, 'admin', T0));
});

test('KYC: nome, 18+, BI/NUIT e telefone', () => {
  const ok = { fullName: 'Ana Maulele', birthDate: '2000-05-01', idType: 'BI', idNumber: '110100123456A', phone: '84 123 4567' };
  assert.deepEqual(validateKyc(ok, '2026-10-10'), []);
  assert.equal(validateKyc({ ...ok, birthDate: '2010-01-01' }, '2026-10-10').length, 1);
  assert.equal(validateKyc({ ...ok, idNumber: '12345' }, '2026-10-10').length, 1);
  assert.deepEqual(validateKyc({ ...ok, idType: 'NUIT', idNumber: '123456789' }, '2026-10-10'), []);
  assert.equal(validateKyc({ ...ok, phone: '82 123 4567' }, '2026-10-10').length, 1);
  assert.equal(validateKyc({ ...ok, fullName: 'Ana' }, '2026-10-10').length, 1);
});

test('carteira MT separada: depósito manual auditado, aposta MT, levantamento com aprovação', () => {
  const { db, m } = setup();
  const s1 = sel(db, m.id, '1x2', '1');
  // sem dinheiro real ligado → recusado
  assert.equal(core.placeBet(db, U, { selectionIds: [s1.id], stake: 50, odds: [s1.odds], currency: 'mt' }, T0 + H).code, 'REAL_OFF');
  core.setRealMoney(db, true, { licenceNo: 'LIC-TESTE', issue: '2026-01-01', expiry: '2027-12-31', confirm: 'CONFIRMO' }, 'admin', T0);
  assert.equal(core.placeBet(db, U, { selectionIds: [s1.id], stake: 50, odds: [s1.odds], currency: 'mt' }, T0 + H).code, 'KYC');
  assert.throws(() => core.adminDeposit(db, U, 500, 'M-Pesa', 'ABC1', 'admin', T0), /KYC/);
  core.submitKyc(db, U, { fullName: 'Ana Maulele', birthDate: '2000-05-01', idType: 'NUIT', idNumber: '123456789', phone: '841234567' }, T0);
  core.reviewKyc(db, U, 'aprovado', '', 'admin', T0);
  assert.equal(core.adminDeposit(db, U, 500, 'M-Pesa', 'ABC1', 'admin', T0), 500);
  assert.throws(() => core.adminDeposit(db, U, 500, 'M-Pesa', 'abc1', 'admin', T0), /DUP_REF/, 'mesma referência não credita duas vezes');
  assert.equal(core.balanceOf(db, U, 'mt'), 500);
  assert.equal(core.balanceOf(db, U), 1000, 'pontos não mudam');
  assert.equal(core.placeBet(db, U, { selectionIds: [s1.id], stake: 3000, odds: [s1.odds], currency: 'mt' }, T0 + H).code, 'STAKE_MAX');
  db.limits[U].mtMaxStake = 40;
  assert.equal(core.placeBet(db, U, { selectionIds: [s1.id], stake: 50, odds: [s1.odds], currency: 'mt' }, T0 + H).code, 'LIMIT_STAKE');
  db.limits[U].mtMaxStake = null;
  assert.equal(core.placeBet(db, U, { selectionIds: [s1.id], stake: 100, odds: [s1.odds], currency: 'mt' }, T0 + H).ok, true);
  assert.equal(core.balanceOf(db, U, 'mt'), 400);
  core.recordResult(db, m.id, 1, 0, 'admin', T0 + 7 * H);
  assert.equal(core.balanceOf(db, U, 'mt'), 400 + Math.floor(100 * s1.odds));
  const before = core.balanceOf(db, U, 'mt');
  assert.throws(() => core.requestWithdrawal(db, U, 10, 'M-Pesa', '841234567', T0 + 8 * H), /MIN_WITHDRAW/);
  const w = core.requestWithdrawal(db, U, 200, 'M-Pesa', '841234567', T0 + 8 * H);
  assert.equal(core.balanceOf(db, U, 'mt'), before - 200, 'valor reservado');
  core.decideWithdrawal(db, w.id, 'recusado', 'dados errados', 'admin', T0 + 9 * H);
  assert.equal(core.balanceOf(db, U, 'mt'), before, 'recusado devolve');
  const w2 = core.requestWithdrawal(db, U, 150, 'e-Mola', '861234567', T0 + 9 * H);
  assert.throws(() => core.decideWithdrawal(db, w2.id, 'pago', '', 'admin', T0), /REF/);
  core.decideWithdrawal(db, w2.id, 'pago', 'EMOLA-777', 'admin', T0 + 10 * H);
  assert.equal(core.balanceOf(db, U, 'mt'), before - 150);
  assert.equal(core.ledgerConsistent(db, U, 'mt'), true);
  assert.ok(['deposito_manual', 'levantamento_pago', 'levantamento_recusado', 'kyc_aprovado'].every((a) => db.log.some((l) => l.action === a)));
  // autoexclusão vale para os dois modos
  const s2 = db.selections.find((x) => db.markets.find((mk) => mk.id === x.marketId)?.status === 'aberto');
  core.selfExclude(db, U, 30, T0 + 10 * H);
  if (s2) assert.equal(core.placeBet(db, U, { selectionIds: [s2.id], stake: 50, odds: [s2.odds], currency: 'mt' }, T0 + 10 * H).code, 'SELF_EXCLUDED');
});

test('semana ISO e janelas de Maputo', () => {
  assert.equal(isoWeekRef(Date.parse('2026-10-10T10:00:00Z')), '2026-W41');
  assert.equal(isoWeekRef(Date.parse('2027-01-01T10:00:00Z')), '2026-W53');
  const now = Date.parse('2026-10-10T10:00:00Z'); // sábado
  assert.equal(new Date(maputoDayStart(now)).toISOString(), '2026-10-09T22:00:00.000Z');
  assert.equal(new Date(maputoWeekStart(now)).toISOString(), '2026-10-04T22:00:00.000Z');
});
