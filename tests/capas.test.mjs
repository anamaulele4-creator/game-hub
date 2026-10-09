// Testes da imagem de capa dos torneios e do fundo próprio (node:test). Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  validateCoverFile, validateCoverSize, cropRect16x9, coverOutputSize, nextCoverQuality, isSafeCoverUrl, tournamentCover,
  coverPath, coverPathFromUrl, coverVariants, isMissingColumnError, COVER_MAX_W, COVER_TARGET_BYTES,
} from '../lib/cover.ts';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

test('validação do ficheiro: só JPG/PNG/WebP e com tamanho limite', () => {
  assert.equal(validateCoverFile({ type: 'image/jpeg', size: 2e6 }), null);
  assert.equal(validateCoverFile({ type: 'image/png', size: 1 }), null);
  assert.equal(validateCoverFile({ type: 'image/webp', size: 5e5 }), null);
  assert.equal(validateCoverFile({ type: '', size: 10, name: 'foto.JPG' }), null);
  assert.match(validateCoverFile({ type: 'image/gif', size: 100 }), /Formato/);
  assert.match(validateCoverFile({ type: 'image/svg+xml', size: 100 }), /Formato/);
  assert.match(validateCoverFile({ type: 'image/jpeg', size: 0 }), /vazio/);
  assert.match(validateCoverFile({ type: 'image/jpeg', size: 50 * 1024 * 1024 }), /grande/);
  assert.match(validateCoverSize(200, 100), /pequena/);
  assert.equal(validateCoverSize(1920, 1080), null);
});

test('recorte central 16:9', () => {
  // larga demais → corta os lados
  assert.deepEqual(cropRect16x9(4000, 1000), { sx: 1111, sy: 0, sw: 1778, sh: 1000 });
  // alta (foto de telemóvel em pé) → corta em cima e em baixo
  assert.deepEqual(cropRect16x9(1080, 1920), { sx: 0, sy: 656, sw: 1080, sh: 608 });
  // já 16:9 → sem corte
  assert.deepEqual(cropRect16x9(1920, 1080), { sx: 0, sy: 0, sw: 1920, sh: 1080 });
  // quadrada
  const r = cropRect16x9(1000, 1000);
  assert.equal(r.sw, 1000); assert.equal(r.sh, 563); assert.equal(r.sy, 218);
  for (const [w, h] of [[640, 480], [3000, 2000], [800, 3000]]) {
    const c = cropRect16x9(w, h);
    assert.ok(Math.abs(c.sw / c.sh - 16 / 9) < 0.01, `${w}x${h}`);
    assert.ok(c.sx >= 0 && c.sy >= 0 && c.sx + c.sw <= w && c.sy + c.sh <= h);
  }
});

test('tamanho final: no máximo 1280 px de largura, nunca amplia, sempre 16:9', () => {
  assert.deepEqual(coverOutputSize(4000), { w: COVER_MAX_W, h: 720 });
  assert.deepEqual(coverOutputSize(800), { w: 800, h: 450 });
  assert.deepEqual(coverOutputSize(1280, 1024), { w: 1024, h: 576 });
});

test('compressão: desce a qualidade até ~300 KB e para no mínimo', () => {
  assert.equal(nextCoverQuality(COVER_TARGET_BYTES - 1, 0.82), null);
  assert.equal(nextCoverQuality(600 * 1024, 0.82), 0.72);
  assert.equal(nextCoverQuality(600 * 1024, 0.52), 0.42);
  assert.equal(nextCoverQuality(600 * 1024, 0.42), null);
});

test('fallback de capa: sem imagem (ou imagem insegura) usa a capa do jogo', () => {
  assert.deepEqual(tournamentCover({ game: 'Free Fire' }), { kind: 'game', game: 'Free Fire' });
  assert.deepEqual(tournamentCover({ game: 'eFootball', cover: '' }), { kind: 'game', game: 'eFootball' });
  assert.deepEqual(tournamentCover({ game: 'eFootball', cover: 'javascript:alert(1)' }), { kind: 'game', game: 'eFootball' });
  assert.deepEqual(tournamentCover({ game: 'eFootball', cover: 'http://x.pt/a.webp' }), { kind: 'game', game: 'eFootball' });
  const url = 'https://abc.supabase.co/storage/v1/object/public/clips/tournaments/t1-1.webp';
  assert.deepEqual(tournamentCover({ game: 'Free Fire', cover: url }), { kind: 'image', src: url });
  assert.equal(isSafeCoverUrl('data:image/webp;base64,UklGRg=='), true);
  assert.equal(isSafeCoverUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  // as capas dos jogos usadas no fallback existem
  for (const k of ['ff', 'cr', 'ef', 'dls', 'outros']) assert.ok(existsSync(new URL(`public/img/games/${k}-640.webp`, root)), k);
});

test('caminhos no Storage e versão de 640 px', () => {
  assert.equal(coverPath('abc-123', 5), 'tournaments/abc-123-5.webp');
  assert.equal(coverPath('a/../b', 5), 'tournaments/ab-5.webp');
  assert.equal(coverPath('t1', 5, 'uid'), 'uid/tournament-t1-5.webp');
  const base = 'https://abc.supabase.co/storage/v1/object/public/clips/tournaments/t1-5.webp';
  assert.equal(coverPathFromUrl(base), 'tournaments/t1-5.webp');
  assert.equal(coverPathFromUrl(base + '#v640'), 'tournaments/t1-5.webp');
  assert.equal(coverPathFromUrl('https://abc.supabase.co/storage/v1/object/public/clips/uid/avatar-1.jpg'), null);
  assert.deepEqual(coverVariants(base), { src: base });
  assert.deepEqual(coverVariants(base + '#v640'), { src: base, small: base.replace('.webp', '-640.webp') });
});

test('coluna cover_url em falta é reconhecida (a app continua sem ela)', () => {
  assert.equal(isMissingColumnError("Could not find the 'cover_url' column of 'tournaments' in the schema cache", 'cover_url'), true);
  assert.equal(isMissingColumnError('column tournaments.cover_url does not exist', 'cover_url'), true);
  assert.equal(isMissingColumnError('permission denied for table tournaments', 'cover_url'), false);
  const sql = read('supabase/migrations/2026-10-10_tournament_cover.sql');
  assert.match(sql, /add column if not exists cover_url text/);
  assert.match(read('supabase/schema.sql'), /alter table public\.tournaments add column if not exists cover_url text/);
});

test('imagem de capa ligada ao Admin, cartões, página do torneio e destaque do Início', () => {
  assert.match(read('components/admin/Operations.tsx'), /<CoverField/);
  assert.match(read('components/core/Teams.tsx'), /<CoverField/);
  assert.match(read('components/ui.tsx'), /<TournamentCover t=\{t\}/);
  assert.match(read('app/torneios/[id]/TournamentDetail.tsx'), /<TournamentCover t=\{t\} priority/);
  assert.match(read('components/jogos/Home.tsx'), /cover: t\?\.cover/);
  assert.match(read('lib/sync.ts'), /optional: \['cover_url'\]/);
});

test('fundo próprio: atrás de tudo, sem cliques, simplificado em Poupança', () => {
  const css = read('app/globals.css');
  assert.match(css, /\.bd \{[^}]*position: fixed;[^}]*z-index: -1;[^}]*pointer-events: none;/);
  assert.match(css, /html\[data-quality="poupanca"\] \.bd-grid/);
  assert.match(css, /html\[data-quality="alta"\]\[data-motion="full"\] \.bd-glow \{ animation/);
  assert.match(read('app/layout.tsx'), /<BrandBackdrop \/>/);
  assert.doesNotMatch(read('components/BrandBackdrop.tsx'), /<img|url\(\s*['"]?(https?:|data:|\/)/);
});
