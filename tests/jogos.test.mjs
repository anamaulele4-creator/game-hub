// Testes de Jogos & Torneios (node:test). Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameKeyOf, normalizeMzPhone, fmtWhen, mtOrTba, validPlayerId, GAMES_CFG, GAME_KEYS } from '../lib/jogos.ts';

test('gameKeyOf associa o texto do jogo à categoria', () => {
  assert.equal(gameKeyOf('Free Fire'), 'ff');
  assert.equal(gameKeyOf('FREE FIRE MAX'), 'ff');
  assert.equal(gameKeyOf('Clash Royale'), 'cr');
  assert.equal(gameKeyOf('eFootball 2026'), 'ef');
  assert.equal(gameKeyOf('Dream League Soccer'), 'dls');
  assert.equal(gameKeyOf('DLS 25'), 'dls');
  assert.equal(gameKeyOf('PUBG Mobile'), 'outros');
  assert.equal(gameKeyOf(''), 'outros');
});

test('números M-Pesa/e-Mola: 84–87 + 7 dígitos', () => {
  assert.equal(normalizeMzPhone('84 123 4567'), '841234567');
  assert.equal(normalizeMzPhone('+258 87 123 4567'), '871234567');
  assert.equal(normalizeMzPhone('258861234567'), '861234567');
  assert.equal(normalizeMzPhone('82 123 4567'), null);
  assert.equal(normalizeMzPhone('88 123 4567'), null);
  assert.equal(normalizeMzPhone('84 123 456'), null);
  assert.equal(normalizeMzPhone('84 123 45678'), null);
  assert.equal(normalizeMzPhone(''), null);
});

test('valores sem dado real ficam "A anunciar"', () => {
  assert.equal(mtOrTba(0), 'A anunciar');
  assert.equal(mtOrTba(null), 'A anunciar');
  assert.match(mtOrTba(5000), /^5.?000 MT$/);
});

test('fmtWhen formata datas e não inventa', () => {
  assert.equal(fmtWhen('2026-10-17 15:00'), 'Sáb 17 Out · 15h');
  assert.equal(fmtWhen('2026-10-18 15:30'), 'Dom 18 Out · 15h30');
  assert.equal(fmtWhen(''), 'Data a anunciar');
  assert.equal(fmtWhen('Sáb, 20:00'), 'Sáb, 20:00');
});

test('IDs de jogador', () => {
  assert.ok(validPlayerId('ff', '123456789'));
  assert.ok(!validPlayerId('ff', '12ab'));
  assert.ok(validPlayerId('cr', '#2PYQ8L0'));
  assert.ok(!validPlayerId('cr', '#XYZ!'));
  assert.ok(validPlayerId('ef', 'ABCD-123'));
});

test('todos os jogos têm 6 pacotes e 5 produtos do marketplace', () => {
  for (const k of GAME_KEYS) {
    assert.equal(GAMES_CFG[k].packs.length, 6, k);
    assert.ok(GAMES_CFG[k].packs.includes(GAMES_CFG[k].defaultPack), k);
    assert.equal(GAMES_CFG[k].market.length, 5, k);
  }
  assert.deepEqual(GAMES_CFG.ff.packs, [100, 310, 520, 1060, 2180, 5600]);
  assert.equal(GAMES_CFG.ff.defaultPack, 310);
});
