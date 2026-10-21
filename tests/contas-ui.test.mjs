// Venda de contas na interface: a opção "Conta" só existe para criador/admin, com a função lida do servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleFromDb, stateRole, appRole } from '../lib/affiliates.ts';
import { canSellAccounts } from '../lib/apostasV2.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('papéis do servidor → app (creator/criador, moderator/moderador; resto = utilizador)', () => {
  assert.equal(roleFromDb('creator'), 'criador');
  assert.equal(roleFromDb('criador'), 'criador');
  assert.equal(roleFromDb('Creator '), 'criador');
  assert.equal(roleFromDb('moderator'), 'moderador');
  assert.equal(roleFromDb('admin'), 'admin');
  assert.equal(roleFromDb('user'), 'utilizador');
  assert.equal(roleFromDb(null), 'utilizador');
  assert.equal(stateRole(roleFromDb('user')), 'user');
  assert.equal(appRole(stateRole(roleFromDb('creator'))), 'criador');
});

test('só criador e admin podem vender contas', () => {
  assert.equal(canSellAccounts('utilizador', true), false);
  assert.equal(canSellAccounts('moderador', true), false);
  assert.equal(canSellAccounts('criador', true), true);
  assert.equal(canSellAccounts('criador', false), false);
  assert.equal(canSellAccounts('admin', false), true);
});

test('/marketplace/anunciar: tipo por omissão "itens", função do servidor, opção "Conta" removida (não só desativada)', () => {
  const src = read('app/marketplace/anunciar/page.tsx');
  assert.match(src, /kind: 'itens' as ListingKind/);
  assert.ok(!/kind: 'conta' as ListingKind/.test(src), 'o estado inicial não pode ser "conta"');
  assert.match(src, /useServerRole\(/);
  assert.ok(!/appRole\(s\.user\.role\)/.test(src), 'a função não pode vir só do estado local');
  assert.match(src, /mayContas = roleLoaded && canSellAccounts\(role, contasOn\)/, 'até carregar a função: sem permissão');
  assert.match(src, /LISTING_KINDS\.filter\(\(k\) => k\.key !== 'conta' \|\| mayContas\)/);
  assert.ok(!/disabled=\{k\.key === 'conta'/.test(src), 'a opção não é só desativada: é removida');
  assert.ok(!/só criadores\)`/.test(src));
});

test('estado: função sempre do servidor (profiles.role), nunca do estado de demonstração', () => {
  const store = read('lib/store.tsx');
  assert.match(store, /role: uid \? stateRole\(roleFromDb\(role\)\) : 'user'/);
  const sync = read('lib/sync.ts');
  assert.match(sync, /role: stateRole\(roleFromDb\(String\(r\.role \?\? ''\)\)\)/);
  const sr = read('lib/serverRole.ts');
  assert.match(sr, /from\('profiles'\)\.select\('role'\)\.eq\('id', uid\)/);
  assert.match(sr, /useState<\{ role: AppRole; loaded: boolean \}>\(\{ role: 'utilizador', loaded: false \}\)/);
});

test('servidor continua a bloquear contas para quem não é criador/admin', () => {
  const sql = read('supabase/migrations/2026-10-20-venda-contas.sql');
  assert.match(sql, /role in \('creator','admin'\)/);
  assert.match(sql, /raise exception 'CONTAS_CRIADOR'/);
});
