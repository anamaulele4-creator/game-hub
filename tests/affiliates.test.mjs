// Regras puras de afiliados, permissões por função, verificação de vendedores e valor da aposta (lib/affiliates.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCreateTournament, canFeatureListing, canEarnCommission, roleFromDb, normalizeCode, validCode, affiliateLink, refFromSearch, codeBase,
  betGain, saleGain, commissionOf, creditCommission, applyReferral, needsSellerVerification, canCreateListing, validateStake, DEFAULT_COMMISSION_PCT,
} from '../lib/affiliates.ts';

const mkDb = (pct = DEFAULT_COMMISSION_PCT) => ({
  users: [
    { id: 'mod', role: 'moderador', referredBy: null }, { id: 'adm', role: 'admin', referredBy: null },
    { id: 'usr', role: 'utilizador', referredBy: null }, { id: 'cri', role: 'criador', referredBy: null },
    { id: 'a', role: 'utilizador', referredBy: 'mod' }, { id: 'b', role: 'utilizador', referredBy: 'usr' },
    { id: 'c', role: 'utilizador', referredBy: 'cri' }, { id: 'd', role: 'utilizador', referredBy: 'adm' }, { id: 'e', role: 'utilizador', referredBy: null },
  ],
  commissions: [], wallet: {}, pct, enabled: true,
});

test('papéis: só moderador e admin criam torneios/campeonatos; utilizador e criador só participam', () => {
  assert.equal(canCreateTournament('moderador'), true);
  assert.equal(canCreateTournament('admin'), true);
  assert.equal(canCreateTournament('utilizador'), false);
  assert.equal(canCreateTournament('criador'), false);
  assert.equal(canCreateTournament(undefined), false);
  assert.deepEqual(['admin', 'moderator', 'creator', 'user', null].map(roleFromDb), ['admin', 'moderador', 'criador', 'utilizador', 'utilizador']);
});

test('papéis: destaque automático para moderador (revogável pelo admin); utilizador nunca', () => {
  assert.equal(canFeatureListing('moderador'), true);
  assert.equal(canFeatureListing('moderador', true), false);
  assert.equal(canFeatureListing('admin', true), true);
  assert.equal(canFeatureListing('utilizador'), false);
  assert.equal(canFeatureListing('criador'), false);
  assert.equal(canEarnCommission('moderador'), true);
  assert.equal(canEarnCommission('utilizador'), false);
  assert.equal(canEarnCommission('criador'), false);
});

test('código e link de afiliado', () => {
  assert.equal(normalizeCode(' nyx-ff 12 '), 'NYXFF12');
  assert.equal(validCode('ABCD'), true);
  assert.equal(validCode('ab'), false);
  assert.equal(validCode(''), false);
  assert.equal(affiliateLink('https://site.mz/', 'nyx1'), 'https://site.mz/registar/?ref=NYX1');
  assert.equal(refFromSearch('?ref=nyx1234'), 'NYX1234');
  assert.equal(refFromSearch('https://x.mz/registar/?a=1&ref=AB12CD'), 'AB12CD');
  assert.equal(refFromSearch('?ref=x'), null);
  assert.equal(refFromSearch(''), null);
  assert.equal(codeBase('@nyx_ff.official'), 'NYXFFOFF');
});

test('comissão: 10 % só do LUCRO líquido de apostas em MT ganhas (não do valor devolvido)', () => {
  assert.equal(betGain({ status: 'ganha', stake: 100, payout: 200, currency: 'mt' }), 100);
  assert.equal(betGain({ status: 'perdida', stake: 100, payout: 0, currency: 'mt' }), 0);
  assert.equal(betGain({ status: 'anulada', stake: 100, payout: 100, currency: 'mt' }), 0);
  assert.equal(betGain({ status: 'ganha', stake: 100, payout: 200, currency: 'pontos' }), 0);
  assert.equal(commissionOf(100, 10), 10);
  assert.equal(commissionOf(9, 10), 0);
  assert.equal(commissionOf(155, 10), 15);
  assert.equal(commissionOf(-50, 10), 0);
  assert.equal(commissionOf(100, 60), 0, 'percentagem inválida');
  const db = mkDb();
  const r = creditCommission(db, 'a', 'aposta', 'bet1:1', betGain({ status: 'ganha', stake: 100, payout: 200, currency: 'mt' }));
  assert.deepEqual(r.ok && r.amount, 10);
  assert.equal(db.wallet.mod, 10);
  assert.equal(db.wallet.a, undefined, 'o convidado fica com 100 % (nada é descontado)');
});

test('comissão: vendas concluídas (valor do vendedor sem taxa), prémios e desafios; nada em perdas, depósitos, compras, registos', () => {
  assert.equal(saleGain({ status: 'concluido', totalMzn: 1000, feePct: 10 }), 900);
  assert.equal(saleGain({ status: 'concluido', totalMzn: 1000, feePct: null }), 1000);
  assert.equal(saleGain({ status: 'entregue', totalMzn: 1000, feePct: 10 }), 0);
  const db = mkDb();
  assert.equal(creditCommission(db, 'a', 'venda', 'o1', 900).amount, 90);
  assert.equal(creditCommission(db, 'a', 'torneio', 'p1', 300).amount, 30);
  assert.equal(creditCommission(db, 'a', 'campeonato', 'p2', 500).amount, 50);
  assert.equal(creditCommission(db, 'a', 'desafio', 'b9:1', 120).amount, 12);
  for (const k of ['registo', 'deposito', 'perda', 'compra', 'aposta_perdida', 'reembolso']) {
    const x = creditCommission(db, 'a', k, 'z-' + k, 1000);
    assert.equal(x.ok, false); assert.equal(x.reason, 'NOT_GAIN_KIND', k);
  }
  assert.equal(creditCommission(db, 'a', 'aposta', 'zero', 0).reason, 'NO_GAIN');
  assert.equal(db.wallet.mod, 182);
});

test('comissão: só padrinhos moderador/admin; utilizador e criador não ganham; sem padrinho nada', () => {
  const db = mkDb();
  assert.equal(creditCommission(db, 'b', 'aposta', 'x1', 1000).reason, 'REFERRER_NOT_ELIGIBLE');
  assert.equal(creditCommission(db, 'c', 'aposta', 'x2', 1000).reason, 'REFERRER_NOT_ELIGIBLE');
  assert.equal(creditCommission(db, 'e', 'aposta', 'x3', 1000).reason, 'NO_REFERRER');
  assert.equal(creditCommission(db, 'd', 'aposta', 'x4', 1000).amount, 100, 'admin também ganha');
  db.users.find((u) => u.id === 'mod').banned = true;
  assert.equal(creditCommission(db, 'a', 'aposta', 'x5', 1000).reason, 'REFERRER_NOT_ELIGIBLE');
  db.enabled = false;
  assert.equal(creditCommission(db, 'd', 'aposta', 'x6', 1000).reason, 'DISABLED');
});

test('comissão: idempotente por evento de origem e percentagem configurável', () => {
  const db = mkDb(20);
  assert.equal(creditCommission(db, 'a', 'venda', 'o1', 500).amount, 100);
  assert.equal(creditCommission(db, 'a', 'venda', 'o1', 500).reason, 'DUPLICATE');
  assert.equal(creditCommission(db, 'a', 'venda', 'o1', 999).reason, 'DUPLICATE');
  assert.equal(db.commissions.length, 1);
  assert.equal(db.wallet.mod, 100);
});

test('referência: definida uma vez, sem auto-convite nem ciclo, só nos primeiros 7 dias', () => {
  const db = mkDb();
  const now = Date.now();
  db.users.push({ id: 'n', role: 'utilizador', referredBy: null, createdAt: now - 3600e3 }, { id: 'old', role: 'utilizador', referredBy: null, createdAt: now - 10 * 86400e3 });
  assert.equal(applyReferral(db, 'mod', 'mod', now).code, 'SELF');
  assert.equal(applyReferral(db, 'n', 'nao-existe', now).code, 'NOT_FOUND');
  assert.equal(applyReferral(db, 'old', 'mod', now).code, 'TOO_LATE');
  assert.equal(applyReferral(db, 'n', 'mod', now).ok, true);
  assert.equal(applyReferral(db, 'n', 'adm', now).code, 'ALREADY');
  assert.equal(applyReferral(db, 'mod', 'a', now).code, 'CYCLE');
  assert.equal(creditCommission(db, 'n', 'aposta', 'n1', 50).amount, 5);
});

test('verificação de vendedor: contas e diamantes exigem aprovação', () => {
  assert.equal(needsSellerVerification('conta', 'ff'), true);
  assert.equal(needsSellerVerification('moedas', 'ff'), true);
  assert.equal(needsSellerVerification('itens', 'moedas'), true);
  assert.equal(needsSellerVerification('servico', 'ff'), false);
  assert.equal(canCreateListing('conta', 'ff', 'nenhuma'), false);
  assert.equal(canCreateListing('conta', 'ff', 'pendente'), false);
  assert.equal(canCreateListing('conta', 'ff', 'rejeitado'), false);
  assert.equal(canCreateListing('conta', 'ff', 'aprovado'), true);
  assert.equal(canCreateListing('itens', 'ff', 'nenhuma'), true);
  assert.equal(canCreateListing('moedas', 'moedas', 'nenhuma', 'admin'), true);
});

test('valor da aposta escolhido pelo utilizador: inteiro entre os limites (e o limite pessoal)', () => {
  assert.equal(validateStake(50, 10, 2000), null);
  assert.equal(validateStake(5, 10, 2000), 'STAKE_MIN');
  assert.equal(validateStake(2001, 10, 2000), 'STAKE_MAX');
  assert.equal(validateStake(12.5, 10, 2000), 'STAKE_INT');
  assert.equal(validateStake(600, 10, 2000, 500), 'STAKE_MAX');
  assert.equal(validateStake(500, 10, 2000, null), null);
});
