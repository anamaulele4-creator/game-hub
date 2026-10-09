// Testes da plataforma TXAPZONE (rede social removida). Correr: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isPlatformNotif, isPublic, isAuthRoute } from '../lib/routes.ts';

const root = new URL('../', import.meta.url);
const has = (p) => existsSync(new URL(p, root));

test('rotas da rede social foram removidas', () => {
  for (const r of ['clipes', 'clipe', 'publicar', 'camera', 'explorar', 'idolos', 'idolo', 'mensagens', 'canais', 'guardados', 'desafios', 'lives', 'poipak-ia', 'pesquisa', 'videos', 'monetizacao', 'bem-estar']) {
    assert.ok(!has(`app/${r}`), `app/${r} ainda existe`);
  }
});

test('rotas principais da TXAPZONE existem', () => {
  for (const r of ['page.tsx', 'jogos/page.tsx', 'jogos/[game]/page.tsx', 'torneios/page.tsx', 'recargas/page.tsx', 'marketplace/page.tsx', 'perfil/page.tsx', 'definicoes/page.tsx', 'admin/page.tsx', 'loja/page.tsx', 'checkout/page.tsx', 'bem-vindo/page.tsx', 'entrar/page.tsx', 'registar/page.tsx', 'confirmar/page.tsx', 'recuperar/page.tsx', 'baixar/page.tsx', 'instalar/page.tsx']) {
    assert.ok(has(`app/${r}`), `falta app/${r}`);
  }
});

test('página inicial é a TXAPZONE', () => {
  const home = readFileSync(new URL('app/page.tsx', root), 'utf8');
  assert.match(home, /components\/jogos\/Home/);
  assert.doesNotMatch(home, /HomeFeed|CLIPS|POSTS/);
});

test('navegação principal: Início, Torneios, Recargas, Marketplace, Perfil', () => {
  const shell = readFileSync(new URL('components/Shell.tsx', root), 'utf8');
  const labels = [...shell.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 5), ['Início', 'Torneios', 'Recargas', 'Marketplace', 'Perfil']);
  assert.doesNotMatch(shell, /\/clipes|\/mensagens|\/explorar|PublishSheet/);
});

test('apostas continuam desativadas', () => {
  const gp = readFileSync(new URL('components/jogos/GamePage.tsx', root), 'utf8');
  assert.match(gp, /Apostas \(desativadas/);
});

test('notificações: só torneios, compras e conta', () => {
  assert.ok(isPlatformNotif({ type: 'torneio' }));
  assert.ok(isPlatformNotif({ type: 'compra' }));
  assert.ok(isPlatformNotif({ type: 'sistema' }));
  assert.ok(!isPlatformNotif({ type: 'social' }));
  assert.ok(!isPlatformNotif({ type: 'live' }));
});

test('portão de autenticação mantém as rotas públicas', () => {
  assert.ok(isAuthRoute('/entrar/'));
  assert.ok(isPublic('/privacidade'));
  assert.ok(!isPublic('/perfil'));
});

test('service worker na versão gh-v11', () => {
  assert.match(readFileSync(new URL('public/sw.js', root), 'utf8'), /VERSION = 'gh-v11'/);
});
