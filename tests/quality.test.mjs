// Testes da qualidade adaptativa e das capas dos jogos (node:test). Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { detectLevel, resolveLevel, isPref, videoPolicy, cameraProfile, imageWidthFor } from '../lib/qualityCore.ts';
import { GAME_KEYS, gameCover, gameCoverSrcSet, gameIconSrc } from '../lib/jogos.ts';

test('rede fraca ou poupar dados → poupança', () => {
  assert.equal(detectLevel({ saveData: true, effectiveType: '4g', deviceMemory: 8 }), 'poupanca');
  assert.equal(detectLevel({ effectiveType: '2g' }), 'poupanca');
  assert.equal(detectLevel({ effectiveType: 'slow-2g' }), 'poupanca');
  assert.equal(detectLevel({ effectiveType: '4g', downlink: 0.4 }), 'poupanca');
  assert.equal(detectLevel({ effectiveType: '4g', deviceMemory: 1 }), 'poupanca');
});

test('3G ou telemóvel modesto → equilibrada', () => {
  assert.equal(detectLevel({ effectiveType: '3g', deviceMemory: 8 }), 'equilibrada');
  assert.equal(detectLevel({ effectiveType: '4g', deviceMemory: 2, cores: 8 }), 'equilibrada');
  assert.equal(detectLevel({ effectiveType: '4g', deviceMemory: 8, cores: 4 }), 'equilibrada');
});

test('bom telemóvel e boa rede (ou sinais desconhecidos) → alta', () => {
  assert.equal(detectLevel({ effectiveType: '4g', downlink: 10, deviceMemory: 8, cores: 8 }), 'alta');
  assert.equal(detectLevel({}), 'alta');
});

test('escolha do utilizador manda sobre o automático', () => {
  assert.equal(resolveLevel('poupanca', { effectiveType: '4g', deviceMemory: 8 }), 'poupanca');
  assert.equal(resolveLevel('alta', { saveData: true }), 'alta');
  assert.equal(resolveLevel('auto', { saveData: true }), 'poupanca');
  assert.ok(isPref('auto') && isPref('equilibrada') && !isPref('max') && !isPref(null));
});

test('políticas de vídeo, câmara e imagem por nível', () => {
  assert.deepEqual(videoPolicy('poupanca'), { autoplay: false, preload: 'none', preloadNeighbours: false });
  assert.equal(videoPolicy('alta').autoplay, true);
  assert.equal(cameraProfile('poupanca').short, 540);
  assert.equal(cameraProfile('alta').short, 720);
  assert.equal(imageWidthFor('alta', 400, 3), 800);
  assert.equal(imageWidthFor('poupanca', 400, 3), 400);
});

test('cada jogo tem capa WebP (640 e 1280) e ícone real (exceto Outros)', () => {
  for (const k of GAME_KEYS) {
    assert.ok(existsSync(new URL('../public' + gameCover(k, 640), import.meta.url)), k + ' 640');
    assert.ok(existsSync(new URL('../public' + gameCover(k, 1280), import.meta.url)), k + ' 1280');
    const ic = gameIconSrc(k);
    if (k === 'outros') assert.equal(ic, null); else assert.ok(existsSync(new URL('../public' + ic, import.meta.url)), k + ' ícone');
  }
  assert.equal(gameCoverSrcSet('ff', '/game-hub'), '/game-hub/img/games/ff-640.webp 640w, /game-hub/img/games/ff-1280.webp 1280w');
});

test('script inline (antes da pintura) segue a mesma regra que detectLevel', async () => {
  const { QUALITY_BOOT } = await import('../lib/qualityCore.ts');
  const vm = await import('node:vm');
  const cases = [
    [{ effectiveType: '4g', downlink: 10 }, 8, 8, null],
    [{ effectiveType: '3g' }, 8, 8, null],
    [{ saveData: true }, 8, 8, null],
    [{ effectiveType: '4g' }, 2, 8, null],
    [{ effectiveType: '2g' }, 8, 8, 'alta'],
  ];
  for (const [connection, deviceMemory, cores, pref] of cases) {
    const ds = {};
    const ctx = { document: { documentElement: { dataset: ds } }, navigator: { connection, deviceMemory, hardwareConcurrency: cores }, localStorage: { getItem: () => pref }, matchMedia: () => ({ matches: false }) };
    vm.runInNewContext(QUALITY_BOOT, ctx);
    const want = pref ?? detectLevel({ ...connection, deviceMemory, cores });
    assert.equal(ds.quality, want, JSON.stringify(connection));
    assert.equal(ds.motion, want === 'poupanca' ? 'reduce' : 'full');
  }
});
