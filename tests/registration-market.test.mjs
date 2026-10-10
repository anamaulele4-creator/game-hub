// Testes das regras puras de inscrição (Discord) e do marketplace (câmbio, arredondamento, compra segura, CSV).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validDiscordInvite, validDiscordUsername, discordRule, discordStepOk, isTeamMode, validateEntry, validContact } from '../lib/registration.ts';
import { mznRatesFromUsd, applyOverride, roundMzn, toMzn, fromMzn, nextStatus, actionsFor, feeOf, avgRating, parseCatalogCsv, splitCsvLine } from '../lib/market.ts';
import { fitWithin, squareCrop, mediaSrcSet } from '../lib/mediaPure.ts';

test('convites Discord: só discord.gg e discord.com/invite em https', () => {
  assert.ok(validDiscordInvite('https://discord.gg/abc123'));
  assert.ok(validDiscordInvite('https://discord.com/invite/Mambas-FF'));
  assert.ok(validDiscordInvite('https://www.discord.com/invite/xyz'));
  for (const bad of ['http://discord.gg/abc', 'https://discord.gg/', 'https://evil.com/discord.gg/abc', 'https://discord.gg/abc?x=1', 'discord.gg/abc', '', null]) assert.equal(validDiscordInvite(bad), false, String(bad));
});

test('username Discord: formato novo e antigo', () => {
  assert.ok(validDiscordUsername('mambas_ff'));
  assert.ok(validDiscordUsername('Kaze#1234'));
  assert.equal(validDiscordUsername('a'), false);
  assert.equal(validDiscordUsername('Com Espaço'), false);
  assert.equal(validDiscordUsername('dois..pontos'), false);
});

test('regra do Discord: convite do torneio > padrão; obrigatório sem convite bloqueia', () => {
  const g = 'https://discord.gg/global1';
  assert.deepEqual(discordRule({ discordInvite: 'https://discord.gg/torneio', requireDiscord: true }, g), { invite: 'https://discord.gg/torneio', required: true, missing: false });
  assert.deepEqual(discordRule({ requireDiscord: true }, g), { invite: g, required: true, missing: false });
  assert.deepEqual(discordRule({ requireDiscord: true }, ''), { invite: null, required: true, missing: true });
  assert.deepEqual(discordRule({ discordInvite: 'https://x.com', requireDiscord: false }), { invite: null, required: false, missing: false });
});

test('passo do Discord: "Continuar inscrição" só com username válido e "Já entrei"', () => {
  const req = { invite: 'https://discord.gg/a1', required: true, missing: false };
  assert.equal(discordStepOk(req, '', false), false);
  assert.equal(discordStepOk(req, 'lucas', false), false);
  assert.equal(discordStepOk(req, 'lucas', true), true);
  assert.equal(discordStepOk({ ...req, required: false }, '', false), true);
  assert.equal(discordStepOk({ invite: null, required: true, missing: true }, 'lucas', true), false);
  assert.equal(discordStepOk({ invite: null, required: false, missing: false }, '', false), true);
});

test('formulário de inscrição', () => {
  assert.ok(isTeamMode('Squad') && isTeamMode('Clash Squad 4v4') && isTeamMode('Duo'));
  assert.ok(!isTeamMode('Solo') && !isTeamMode('1v1'));
  const t = { game: 'Free Fire', mode: 'Squad' };
  assert.deepEqual(Object.keys(validateEntry({ playerName: '', gameId: 'abc', team: '', contact: 'x' }, t)).sort(), ['contact', 'gameId', 'playerName', 'team']);
  assert.deepEqual(validateEntry({ playerName: 'Lucas', gameId: '123456789', team: 'Mambas', contact: '84 123 4567' }, t), {});
  assert.ok(validContact('ana@exemplo.co.mz') && validContact('+258 86 123 4567') && !validContact('12345'));
});

test('câmbio: MT por unidade a partir da tabela USD, override e arredondamento para cima', () => {
  const r = mznRatesFromUsd({ MZN: 63.8, BRL: 5, ZAR: 16 });
  assert.equal(r.MZN, 1); assert.equal(r.USD, 63.8); assert.ok(Math.abs(r.BRL - 12.76) < 1e-9);
  assert.equal(mznRatesFromUsd({ MZN: 63.8 }), null);
  assert.equal(applyOverride(r, { BRL: 13 }).BRL, 13);
  assert.equal(applyOverride(null, {}), null);
  assert.equal(applyOverride(null, { BRL: 13, USD: 64, ZAR: 3.9 }).ZAR, 3.9);
  assert.equal(roundMzn(101.2, 1), 102); assert.equal(roundMzn(101.2, 5), 105); assert.equal(roundMzn(101, 10), 110); assert.equal(roundMzn(100, 10), 100);
  assert.equal(roundMzn(0, 5), 0);
  assert.equal(toMzn(10, 'BRL', r, 1), 128);
  assert.equal(fromMzn(127.6, 'BRL', r), 10);
});

test('compra segura: máquina de estados por papel', () => {
  assert.equal(nextStatus('aguarda_pagamento', 'confirmar_pagamento', 'admin'), 'pago');
  assert.equal(nextStatus('aguarda_pagamento', 'confirmar_pagamento', 'comprador'), null);
  assert.equal(nextStatus('pago', 'entregar', 'vendedor'), 'entregue');
  assert.equal(nextStatus('pago', 'entregar', 'comprador'), null);
  assert.equal(nextStatus('entregue', 'confirmar_rececao', 'comprador'), 'concluido');
  assert.equal(nextStatus('entregue', 'abrir_disputa', 'comprador'), 'disputa');
  assert.equal(nextStatus('concluido', 'abrir_disputa', 'comprador'), null);
  assert.equal(nextStatus('disputa', 'reembolsar', 'admin'), 'reembolsado');
  assert.equal(nextStatus('disputa', 'liberar', 'admin'), 'concluido');
  assert.equal(nextStatus('disputa', 'liberar', 'vendedor'), null);
  assert.deepEqual(actionsFor('entregue', 'comprador').sort(), ['abrir_disputa', 'confirmar_rececao']);
  assert.deepEqual(actionsFor('aguarda_pagamento', 'vendedor'), ['cancelar']);
});

test('taxas "A definir" e média de avaliações', () => {
  assert.equal(feeOf(1000, null), null);
  assert.equal(feeOf(1000, 5), 50);
  assert.equal(avgRating([]), null);
  assert.equal(avgRating([5, 4, 4]), 4.3);
});

test('CSV do catálogo', () => {
  assert.deepEqual(splitCsvLine('a;"b;c";"d ""e"""', ';'), ['a', 'b;c', 'd "e"']);
  const { rows, errors } = parseCatalogCsv('categoria;tipo;titulo;descricao;preco;moeda;stock;entrega\nff;conta;Conta FF nível 70;Passes;2500;MZN;1;manual\nSteam;Gift card;Cartão Steam;;20;usd;5;automática\nxyz;conta;Titulo;;1;MZN;1;manual\nff;conta;ab;;;;;\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { category: 'steam', kind: 'giftcard', title: 'Cartão Steam', description: '', price: 20, currency: 'USD', stock: 5, delivery: 'automatica' });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Linha 4/);
});

test('fotos: redimensionar sem aumentar, recorte quadrado e srcset das variantes', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(fitWithin(400, 300, 1600), { w: 400, h: 300 });
  assert.deepEqual(squareCrop(1200, 800), { sx: 200, sy: 0, side: 800 });
  const u = 'https://x.supabase.co/storage/v1/object/public/media/products/u/abc-960.webp';
  assert.equal(mediaSrcSet(u, [480, 960]), u.replace('-960', '-480') + ' 480w, ' + u + ' 960w');
  assert.equal(mediaSrcSet('art:ff', [480]), undefined);
});
