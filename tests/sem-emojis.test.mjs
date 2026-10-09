// A TXAPZONE não usa emojis na interface (regra do dono). Falha se aparecer algum em app/ ou components/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u;
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css|md|json|svg|html)$/.test(f) ? [p] : [];
});

test('nenhum emoji em app/ nem components/', () => {
  const hits = [];
  for (const dir of ['app', 'components']) {
    for (const file of walk(join(root, dir))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (EMOJI.test(line)) hits.push(`${file.slice(root.length)}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
  }
  assert.deepEqual(hits, [], `Emojis encontrados:\n${hits.join('\n')}`);
});

test('nenhum emoji no manifest nem na página offline', () => {
  for (const f of ['scripts/gen-manifest.mjs', 'public/offline.html', 'public/sw.js']) {
    assert.ok(!EMOJI.test(readFileSync(join(root, f), 'utf8')), f);
  }
});
