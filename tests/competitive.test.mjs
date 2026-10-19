// Testes das regras do módulo competitivo (lib/competitive.ts + lib/competitiveCore.ts). Correr: npm test
// Máquina de estados, reconciliação de resultados/disputas, livro-razão e idempotência, termos de aposta, gating e elegibilidade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGE_STATES, TRANSITIONS, canTransition, assertTransition, cancelAllowed, reconcileResults, teamEloDelta, eligibility, DEFAULT_RULES, DEFAULT_FLAGS,
  monetaryOn, bettingOn, licenceValid, flagChangeError, gate, postEntry, deriveBalance, walletSummary, ledgerConsistent, snapshotTerms, payoutFromTerms,
  assertTermsUnchanged, validateLicence, validateTeam, ageAt,
} from '../lib/competitive.ts';
import * as core from '../lib/competitiveCore.ts';
import fs from 'node:fs';

const NOW = Date.parse('2026-10-19T13:00:00Z');
const H = 3600e3;
const LIC = { id: 'l1', scope: 'apostas', authority: 'Inspecção Geral de Jogos', licenceNo: 'X-1', validFrom: '2026-01-01', validUntil: '2027-01-01', revokedAt: null };

test('máquina de estados: exatamente os 11 estados e transições do SQL', () => {
  assert.deepEqual([...CHALLENGE_STATES], ['DRAFT', 'OPEN', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_RESULT', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED', 'DISPUTED']);
  assert.ok(canTransition('PENDING_RESULT', 'COMPLETED'));
  assert.ok(canTransition('PENDING_RESULT', 'DISPUTED'));
  assert.ok(canTransition('DISPUTED', 'UNDER_REVIEW'));
  assert.ok(canTransition('UNDER_REVIEW', 'COMPLETED'));
  assert.ok(!canTransition('SCHEDULED', 'COMPLETED'));
  assert.ok(!canTransition('OPEN', 'SCHEDULED'));
  assert.ok(!canTransition('COMPLETED', 'CANCELLED'));
  assert.equal(TRANSITIONS.COMPLETED.length + TRANSITIONS.CANCELLED.length, 0);
  assert.throws(() => assertTransition('DRAFT', 'COMPLETED'), /COMP_TRANSITION/);
  // o SQL (comp__can_transition) tem exatamente a mesma lista
  const sql = fs.readFileSync(new URL('../supabase/competitive.sql', import.meta.url), 'utf8');
  const i = sql.indexOf('comp__can_transition(f text');
  const body = sql.slice(i, sql.indexOf('$$;', i));
  const pairs = [...body.matchAll(/\('([A-Z_]+)','([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  const ts = Object.entries(TRANSITIONS).flatMap(([f, l]) => l.map((t) => `${f}>${t}`)).sort();
  assert.deepEqual(pairs, ts);
});

test('cancelamento: desafiante antes da aceitação; ambos até 2 h antes; depois só admin', () => {
  const at = new Date(NOW + 5 * H).toISOString();
  assert.ok(cancelAllowed('OPEN', 'challenger', at, 2, NOW));
  assert.ok(!cancelAllowed('OPEN', 'opponent', at, 2, NOW));
  assert.ok(cancelAllowed('SCHEDULED', 'opponent', at, 2, NOW));
  assert.ok(!cancelAllowed('SCHEDULED', 'opponent', at, 2, NOW + 4 * H));
  assert.ok(!cancelAllowed('IN_PROGRESS', 'challenger', at, 2, NOW));
  assert.ok(cancelAllowed('IN_PROGRESS', 'admin', at, 2, NOW));
  assert.ok(!cancelAllowed('COMPLETED', 'admin', at, 2, NOW));
});

test('reconciliação: 1 submissão espera; iguais concluem; diferentes abrem disputa', () => {
  assert.equal(reconcileResults([{ teamId: 'a', challengerScore: 2, opponentScore: 1 }]).status, 'PENDING_RESULT');
  assert.deepEqual(reconcileResults([{ teamId: 'a', challengerScore: 2, opponentScore: 1 }, { teamId: 'b', challengerScore: 2, opponentScore: 1 }]),
    { status: 'COMPLETED', challengerScore: 2, opponentScore: 1 });
  const d = reconcileResults([{ teamId: 'a', challengerScore: 2, opponentScore: 1 }, { teamId: 'b', challengerScore: 1, opponentScore: 2 }]);
  assert.equal(d.status, 'DISPUTED');
  assert.equal(teamEloDelta(1500, 1500, 1, 0), 16);
  assert.equal(teamEloDelta(1500, 1500, 1, 1), 0);
});

test('elegibilidade: 18+, KYC, província de Moçambique, autoexclusão e pausa', () => {
  const ok = { active: true, birthDate: '1990-01-01', kycStatus: 'aprovado', province: 'Gaza' };
  assert.deepEqual(eligibility(ok, DEFAULT_RULES, NOW), { ok: true, reasons: [] });
  assert.ok(eligibility({ ...ok, birthDate: '2010-01-01' }, DEFAULT_RULES, NOW).reasons.includes('MINOR'));
  assert.ok(eligibility({ ...ok, kycStatus: 'pendente' }, DEFAULT_RULES, NOW).reasons.includes('KYC'));
  assert.ok(eligibility({ ...ok, kycStatus: null, kycLevel: 2 }, DEFAULT_RULES, NOW).ok);
  assert.ok(eligibility({ ...ok, province: 'Lisboa' }, DEFAULT_RULES, NOW).reasons.includes('LOCATION'));
  assert.ok(eligibility({ ...ok, country: 'ZA' }, DEFAULT_RULES, NOW).reasons.includes('COUNTRY'));
  assert.ok(eligibility({ ...ok, selfExcludedUntil: new Date(NOW + H).toISOString() }, DEFAULT_RULES, NOW).reasons.includes('SELF_EXCLUDED'));
  assert.ok(eligibility({ ...ok, coolOffUntil: new Date(NOW + H).toISOString() }, DEFAULT_RULES, NOW).reasons.includes('COOL_OFF'));
  assert.equal(ageAt('2008-10-19', NOW), 18);
  assert.equal(ageAt('2008-10-20', NOW), 17);
});

test('gating: por omissão tudo o que é dinheiro/apostas é recusado', () => {
  assert.equal(DEFAULT_FLAGS.monetaryFeaturesEnabled, false);
  assert.equal(DEFAULT_FLAGS.bettingEnabled, false);
  const base = { flags: DEFAULT_FLAGS, licences: [LIC], providerReady: true, eligible: true, now: NOW };
  assert.equal(gate('deposit', base), 'MONETARY_OFF');
  assert.equal(gate('withdraw', base), 'MONETARY_OFF');
  assert.equal(gate('bet', base), 'BETTING_OFF');
  // ligado mas sem licença válida → continua desligado
  const on = { ...DEFAULT_FLAGS, monetaryFeaturesEnabled: true, bettingEnabled: true };
  assert.ok(!monetaryOn(on, [], NOW));
  assert.ok(!bettingOn(on, [{ ...LIC, validUntil: '2026-06-01' }], NOW));
  assert.ok(!bettingOn(on, [{ ...LIC, revokedAt: '2026-10-01' }], NOW));
  assert.ok(bettingOn(on, [LIC], NOW));
  assert.equal(gate('deposit', { ...base, flags: on, providerReady: false }), 'PROVIDER_NOT_CONFIGURED');
  assert.equal(gate('bet', { ...base, flags: on, eligible: false }), 'NOT_ELIGIBLE');
  assert.equal(gate('deposit', { ...base, flags: on }), null);
  assert.equal(licenceValid([LIC], 'pagamentos', NOW), null);
});

test('ativação: só admin, com MFA aal2, palavra ATIVAR e licença válida', () => {
  const p = { monetary: true, betting: true, confirm: 'ATIVAR', isAdmin: true, aal: 'aal2', licences: [LIC], now: NOW };
  assert.equal(flagChangeError({ ...p, isAdmin: false }), 'FORBIDDEN');
  assert.equal(flagChangeError({ ...p, aal: 'aal1' }), 'MFA_REQUIRED');
  assert.equal(flagChangeError({ ...p, confirm: 'sim' }), 'CONFIRM');
  assert.equal(flagChangeError({ ...p, licences: [] }), 'LICENCE');
  assert.equal(flagChangeError({ ...p, monetary: false }), 'BETTING_NEEDS_MONETARY');
  assert.equal(flagChangeError(p), null);
  assert.equal(flagChangeError({ ...p, monetary: false, betting: false, confirm: '', licences: [] }), null); // desligar é sempre possível
  assert.equal(validateLicence({ authority: 'IGJ', licenceNo: '1', validFrom: '2026-01-01', validUntil: '2027-01-01' }, NOW), 'NUMBER');
  assert.equal(validateLicence({ authority: 'Inspecção Geral de Jogos', licenceNo: 'A1', validFrom: '2025-01-01', validUntil: '2026-01-01' }, NOW), 'EXPIRED');
});

test('livro-razão: só acréscimos, idempotente, saldo derivado, nunca negativo', () => {
  const L = []; let i = 0; const id = () => `e${i++}`;
  const a = postEntry(L, { userId: 'u', delta: 500, reason: 'deposito', ref: 'mpesa:R1' }, NOW, id);
  const b = postEntry(L, { userId: 'u', delta: 500, reason: 'deposito', ref: 'mpesa:R1' }, NOW, id);
  assert.equal(b.duplicate, true); assert.equal(b.entry.entryId, a.entry.entryId);
  assert.equal(L.length, 1);
  postEntry(L, { userId: 'u', delta: -200, reason: 'levantamento', ref: 'w1' }, NOW, id);
  assert.throws(() => postEntry(L, { userId: 'u', delta: -1000, reason: 'aposta', ref: 'b1' }, NOW, id), /BALANCE/);
  assert.equal(deriveBalance(L, 'u'), 300);
  assert.ok(ledgerConsistent(L, 'u'));
  assert.deepEqual(walletSummary(L, 'u', 200, 50), { available: 300, reserved: 250, total: 550 });
});

test('termos da aposta: instantâneo na confirmação; pagamento só a partir dos termos; sem mudança retroativa', () => {
  const t = snapshotTerms(100, [{ selectionId: 's1', label: 'Mambas', odds: 1.85 }], 50000, 'mt', 'v1', NOW);
  assert.equal(t.totalOdds, 1.85); assert.equal(t.potential, 185);
  assert.throws(() => { t.stake = 1; }, TypeError); // congelado
  assert.deepEqual(payoutFromTerms(t, ['ganha']), { status: 'ganha', payout: 185 });
  assert.deepEqual(payoutFromTerms(t, ['perdida']), { status: 'perdida', payout: 0 });
  assert.deepEqual(payoutFromTerms(t, ['anulada']), { status: 'anulada', payout: 100 });
  const t2 = snapshotTerms(100, [{ selectionId: 's1', label: 'Mambas', odds: 2.5 }], 50000, 'mt', 'v1', NOW);
  assert.throws(() => assertTermsUnchanged(t, t2), /COMP_TERMS_LOCKED/);
  assert.equal(snapshotTerms(1000, [{ selectionId: 'x', label: 'x', odds: 50 }], 20000, 'mt', 'v1', NOW).potential, 20000);
});

test('equipas: validação de nome/sigla', () => {
  assert.equal(validateTeam({ name: 'ab' }), 'NAME');
  assert.equal(validateTeam({ name: 'Mambas', tag: 'M' }), 'TAG');
  assert.equal(validateTeam({ name: 'Mambas', tag: 'MAM' }), null);
});

/* ---------- Fluxo completo no motor em memória (demo) ---------- */
function world() {
  const db = core.emptyCDB();
  const U = (id, extra = {}) => db.users.push({ id, handle: id, name: id, birthDate: '1995-01-01', province: 'Maputo Cidade', kyc: null, ...extra });
  ['capa', 'mema', 'capb', 'memb', 'fan'].forEach((u) => U(u)); U('admin', { admin: true, kyc: 'aprovado' });
  const a = core.createTeam(db, 'capa', { name: 'Mambas FC', game: 'eFootball' }, NOW).teamId;
  const b = core.createTeam(db, 'capb', { name: 'Leões', game: 'eFootball' }, NOW).teamId;
  core.respondInvite(db, 'mema', core.invite(db, 'capa', a, '@mema', NOW).inviteId, true, NOW);
  core.respondInvite(db, 'memb', core.invite(db, 'capb', b, 'memb', NOW).inviteId, true, NOW);
  return { db, a, b };
}
const at = (h) => new Date(NOW + h * H).toISOString();

test('motor: equipa → convite → desafio → aceitar → jogar → resultados iguais → concluído', () => {
  const { db, a, b } = world();
  assert.equal(core.invite(db, 'mema', a, 'fan', NOW).code, 'FORBIDDEN');
  assert.equal(core.createTeam(db, 'mema', { name: 'Outra', game: 'eFootball' }, NOW).code, 'ALREADY_IN_GAME');
  const c = core.createChallenge(db, 'capa', { teamId: a, opponentId: b, title: '', rules: 'MD1', players: 2, bestOf: 1, scheduledAt: at(3), publish: true, idem: 'k'.repeat(16) }, NOW);
  assert.equal(core.createChallenge(db, 'capa', { teamId: a, opponentId: b, title: '', rules: '', players: 2, bestOf: 1, scheduledAt: at(3), publish: true, idem: 'k'.repeat(16) }, NOW).duplicate, true);
  assert.equal(db.challenges.length, 1);
  assert.equal(core.respondChallenge(db, 'memb', c.challengeId, true, null, '', NOW).code, 'FORBIDDEN');
  assert.equal(core.respondChallenge(db, 'capb', c.challengeId, true, null, '', NOW).status, 'SCHEDULED');
  assert.equal(core.submitResult(db, 'capa', c.challengeId, a, 1, 0, [], NOW).code, 'STATE');
  core.sweep(db, NOW + 3 * H + 1);
  assert.equal(db.challenges[0].status, 'IN_PROGRESS');
  assert.equal(core.submitResult(db, 'capa', c.challengeId, a, 2, 1, [], NOW + 4 * H).status, 'PENDING_RESULT');
  assert.equal(core.submitResult(db, 'capb', c.challengeId, b, 2, 1, [], NOW + 4 * H).status, 'COMPLETED');
  assert.equal(db.teams.find((t) => t.id === a).wins, 1);
  assert.deepEqual(db.events.filter((e) => e.challengeId === c.challengeId).map((e) => e.to),
    ['DRAFT', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_RESULT', 'COMPLETED']);
});

test('motor: recusa, desafio aberto e disputa resolvida pelo admin com MFA', () => {
  const { db, a, b } = world();
  const c1 = core.createChallenge(db, 'capa', { teamId: a, opponentId: b, title: '', rules: '', players: 1, bestOf: 1, scheduledAt: null, publish: true, idem: null }, NOW).challengeId;
  assert.equal(core.respondChallenge(db, 'capb', c1, false, null, 'sem tempo', NOW).status, 'CANCELLED');
  const c2 = core.createChallenge(db, 'capa', { teamId: a, opponentId: null, title: '', rules: '', players: 1, bestOf: 1, scheduledAt: null, publish: true, idem: null }, NOW).challengeId;
  assert.equal(db.challenges.find((c) => c.id === c2).status, 'OPEN');
  assert.equal(core.respondChallenge(db, 'capb', c2, true, b, '', NOW).status, 'ACCEPTED');
  assert.equal(core.scheduleChallenge(db, 'capb', c2, at(1), NOW).ok, true);
  assert.equal(core.startChallenge(db, 'capa', c2, NOW + H).ok, true);
  core.submitResult(db, 'capa', c2, a, 3, 0, [], NOW + 2 * H);
  assert.equal(core.submitResult(db, 'capb', c2, b, 0, 3, [], NOW + 2 * H).status, 'DISPUTED');
  assert.equal(db.disputes.length, 1);
  assert.equal(core.adminChallenge(db, 'capa', 'aal2', c2, 'analisar', null, null, '', NOW).code, 'FORBIDDEN');
  assert.equal(core.adminChallenge(db, 'admin', 'aal1', c2, 'analisar', null, null, 'ver', NOW).ok, true);
  assert.equal(core.adminChallenge(db, 'admin', 'aal1', c2, 'resolver', 3, 0, 'vídeo confirma', NOW).code, 'MFA_REQUIRED');
  assert.equal(core.adminChallenge(db, 'admin', 'aal2', c2, 'resolver', 3, 0, 'vídeo confirma', NOW).ok, true);
  assert.equal(db.disputes[0].status, 'resolvida');
});

test('motor: dinheiro bloqueado → ativado com licença → depósito só por webhook verificado, sem duplicados', () => {
  const { db } = world();
  db.users.find((u) => u.id === 'fan').kyc = 'aprovado';
  const idem = 'd'.repeat(20);
  assert.equal(core.depositIntent(db, 'fan', 100, 'M-Pesa', '841234567', idem, NOW).code, 'MONETARY_OFF');
  assert.equal(core.setFlags(db, 'admin', 'aal2', true, true, 'ATIVAR', NOW).code, 'LICENCE');
  assert.equal(core.recordLicence(db, 'admin', 'aal2', { scope: 'apostas', authority: 'Inspecção Geral de Jogos', licenceNo: 'IGJ-1', validFrom: '2026-01-01', validUntil: '2027-12-31' }, NOW).ok, true);
  assert.equal(core.setFlags(db, 'admin', 'aal1', true, true, 'ATIVAR', NOW).code, 'MFA_REQUIRED');
  assert.equal(core.setFlags(db, 'admin', 'aal2', true, true, 'ATIVAR', NOW).ok, true);
  assert.equal(core.depositIntent(db, 'fan', 100, 'M-Pesa', '841234567', idem, NOW).code, 'PROVIDER_NOT_CONFIGURED');
  db.providerReady = true;
  const d = core.depositIntent(db, 'fan', 100, 'M-Pesa', '841234567', idem, NOW);
  assert.equal(core.depositIntent(db, 'fan', 100, 'M-Pesa', '841234567', idem, NOW).paymentId, d.paymentId);
  assert.equal(core.wallet(db, 'fan').available, 0); // pedido não credita nada
  const seen = new Set();
  assert.equal(core.confirmDeposit(db, d.paymentId, { eventId: 'e1', providerRef: 'R1', status: 'success', amount: 100, signatureOk: false }, seen, NOW).code, 'SIGNATURE');
  assert.equal(core.confirmDeposit(db, d.paymentId, { eventId: 'e2', providerRef: 'R1', status: 'success', amount: 100, signatureOk: true }, seen, NOW).ok, true);
  assert.equal(core.confirmDeposit(db, d.paymentId, { eventId: 'e2', providerRef: 'R1', status: 'success', amount: 100, signatureOk: true }, seen, NOW).duplicate, true);
  assert.equal(core.confirmDeposit(db, d.paymentId, { eventId: 'e3', providerRef: 'R1', status: 'success', amount: 100, signatureOk: true }, seen, NOW).duplicate, true);
  assert.equal(core.wallet(db, 'fan').available, 100);
  assert.equal(db.ledger.length, 1);
  const menor = core.emptyCDB(); menor.users.push({ id: 'm', handle: 'm', name: 'm', birthDate: '2012-01-01', province: 'Gaza', kyc: 'aprovado' });
  assert.ok(core.eligibilityOf(menor, 'm', NOW).reasons.includes('MINOR'));
});

test('motor: apostas no desafio — membros bloqueados, termos fixos, liquidação só após validação', () => {
  const { db, a, b } = world();
  db.users.forEach((u) => { u.kyc = 'aprovado'; });
  core.recordLicence(db, 'admin', 'aal2', { scope: 'apostas', authority: 'Inspecção Geral de Jogos', licenceNo: 'IGJ-1', validFrom: '2026-01-01', validUntil: '2027-12-31' }, NOW);
  const c = core.createChallenge(db, 'capa', { teamId: a, opponentId: b, title: '', rules: '', players: 1, bestOf: 1, scheduledAt: at(3), publish: true, idem: null }, NOW).challengeId;
  core.respondChallenge(db, 'capb', c, true, null, '', NOW);
  assert.equal(core.openMarket(db, 'admin', 'aal2', c, NOW).code, 'BETTING_OFF');
  core.setFlags(db, 'admin', 'aal2', true, true, 'ATIVAR', NOW);
  assert.equal(core.openMarket(db, 'admin', 'aal2', c, NOW).ok, true);
  db.providerReady = true;
  const d = core.depositIntent(db, 'fan', 500, 'M-Pesa', '841234567', 'x'.repeat(16), NOW);
  core.confirmDeposit(db, d.paymentId, { eventId: 'e', providerRef: 'R', status: 'success', amount: 500, signatureOk: true }, new Set(), NOW);
  const ch = db.challenges.find((x) => x.id === c);
  const o = ch.market.odds.challenger;
  assert.equal(core.placeChallengeBet(db, 'mema', c, 'challenger', 10, o, 'mt', true, 'y'.repeat(16), NOW).code, 'COMP_OWN_CHALLENGE');
  assert.equal(core.placeChallengeBet(db, 'fan', c, 'challenger', 100, o, 'mt', false, 'z'.repeat(16), NOW).code, 'CONFIRM');
  assert.equal(core.placeChallengeBet(db, 'fan', c, 'challenger', 100, o + 1, 'mt', true, 'z'.repeat(16), NOW).code, 'ODDS_CHANGED');
  const bet = core.placeChallengeBet(db, 'fan', c, 'challenger', 100, o, 'mt', true, 'z'.repeat(16), NOW);
  assert.equal(bet.ok, true);
  assert.equal(core.placeChallengeBet(db, 'fan', c, 'challenger', 100, o, 'mt', true, 'z'.repeat(16), NOW).duplicate, true);
  assert.deepEqual(core.wallet(db, 'fan'), { available: 400, reserved: 100, total: 500, reservedWithdrawals: 0, reservedBets: 100 });
  ch.market.odds.challenger = 9.99; // mudar odds depois NÃO mexe na aposta confirmada
  core.sweep(db, NOW + 3 * H + 1);
  assert.equal(core.placeChallengeBet(db, 'fan', c, 'opponent', 10, ch.market.odds.opponent, 'mt', true, 'w'.repeat(16), NOW + 3 * H + 2).code, 'COMP_CLOSED');
  core.submitResult(db, 'capa', c, a, 1, 0, [], NOW + 4 * H);
  core.submitResult(db, 'capb', c, b, 1, 0, [], NOW + 4 * H);
  assert.equal(db.bets[0].status, 'aberta'); // ainda não validado
  core.adminChallenge(db, 'admin', 'aal2', c, 'verificar', null, null, 'ok', NOW + 5 * H);
  assert.equal(db.bets[0].status, 'ganha');
  assert.equal(db.bets[0].payout, Math.floor(100 * o));
  assert.equal(core.wallet(db, 'fan').available, 400 + Math.floor(100 * o));
});
