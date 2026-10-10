// Testes da qualidade adaptativa e das imagens dos jogos (node:test). Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { scoreTier, effectiveTier, allowedWidths, pickWidth, videoPolicy, cameraProfile, parsePrefs } from '../lib/deviceQuality.ts';
import { ART, GAME_ART, artsFor, artAt, artUrl, artSrcSet } from '../lib/gameArt.ts';

test('poupança de dados do sistema e redes 2G forçam nível low', () => {
  assert.equal(scoreTier({ saveData: true, memory: 8, cores: 8 }), 'low');
  assert.equal(scoreTier({ effectiveType: '2g' }), 'low');
  assert.equal(scoreTier({ effectiveType: 'slow-2g', memory: 8 }), 'low');
  assert.equal(scoreTier({ fps: 22, memory: 8, cores: 8 }), 'low');
});

test('telemóvel modesto fica em low/medium, topo de gama em high', () => {
  assert.equal(scoreTier({ memory: 1, cores: 4, effectiveType: '4g' }), 'low');
  assert.equal(scoreTier({ memory: 2, cores: 8, effectiveType: '4g' }), 'medium');
  assert.equal(scoreTier({ memory: 3, cores: 4, effectiveType: '3g' }), 'low');
  assert.equal(scoreTier({ memory: 8, cores: 8, effectiveType: '4g', fps: 60 }), 'high');
});

test('sinais desconhecidos (Safari) não penalizam', () => {
  assert.equal(scoreTier({}), 'medium');
  assert.equal(scoreTier({ fps: 60 }), 'high');
});

test('escolha manual vence o automático', () => {
  assert.equal(effectiveTier('auto', 'low'), 'low');
  assert.equal(effectiveTier('high', 'low'), 'high');
  assert.equal(effectiveTier('low', 'high'), 'low');
});

test('imagens: poupança nunca pede a versão grande', () => {
  assert.deepEqual(allowedWidths('low'), [480]);
  assert.deepEqual(allowedWidths('medium'), [480, 960]);
  assert.equal(pickWidth('low', 400, 3), 480);
  assert.equal(pickWidth('medium', 400, 3), 960);
  assert.equal(pickWidth('high', 400, 3), 1600);
  assert.equal(pickWidth('high', 300, 1), 480);
});

test('vídeo e câmara seguem o nível', () => {
  assert.deepEqual(videoPolicy('low'), { preload: 'none', autoplay: false });
  assert.deepEqual(videoPolicy('medium', false), { preload: 'metadata', autoplay: false });
  assert.equal(videoPolicy('high').preload, 'auto');
  assert.deepEqual(cameraProfile('low'), { startLow: true, fps: 24 });
  assert.equal(cameraProfile('high').startLow, false);
});

test('preferências guardadas inválidas voltam ao automático', () => {
  assert.deepEqual(parsePrefs('lixo'), { mode: 'auto', autoplay: true });
  assert.equal(parsePrefs('{"mode":"ultra"}').mode, 'auto');
  assert.equal(parsePrefs('{"mode":"low","autoplay":false}').autoplay, false);
});

test('cada jogo tem arte real com todos os tamanhos em public/games', () => {
  for (const k of ['ff', 'cr', 'ef', 'dls', 'outros']) {
    const ids = artsFor(k);
    assert.ok(ids.length >= 1);
    assert.equal(ids[0], GAME_ART[k]);
    for (const id of ids) {
      assert.equal(ART[id].game, k);
      for (const w of [480, 960, 1600, 'lqip']) {
        const f = new URL('../public' + artUrl('', id, w), import.meta.url);
        assert.ok(existsSync(f), `falta ${f.pathname}`);
      }
    }
  }
  assert.equal(artAt('ff', 4), 'ff-2');
  assert.equal(artAt('cr', 2), 'cr');
  assert.match(artSrcSet('/game-hub', 'ef', [480, 960, 1600]), /ef-1600\.webp 1351w$/);
});
