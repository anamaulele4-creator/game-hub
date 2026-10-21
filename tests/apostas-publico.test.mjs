// Apostas públicas: só dinheiro real (MT) e a licença IGJ nunca chega ao público (decisão do proprietário, 21/10/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('a leitura pública de bet_settings não pede colunas da licença', () => {
  const api = read('lib/betsApi.ts');
  const cols = api.match(/PUBLIC_SETTINGS_COLUMNS = '([^']+)'/)?.[1] ?? '';
  assert.ok(cols.includes('real_money_enabled'));
  assert.ok(!/igj/i.test(cols), 'colunas igj_* não podem ser pedidas pelo público');
  // público: lista explícita; Admin: função bets_admin_settings() (com recurso a select('*') se o SQL ainda não correu)
  assert.match(api, /admin \? loadAdminSettings\(c\)[^\n]*: c\.from\('bet_settings'\)\.select\(PUBLIC_SETTINGS_COLUMNS\)/);
});

test('Admin lê definições por bets_admin_settings() com recurso quando a função ainda não existe', () => {
  const api = code('lib/betsApi.ts');
  const fn = api.slice(api.indexOf('export async function loadAdminSettings'), api.indexOf('async function realLoad'));
  assert.ok(fn.length > 0, 'loadAdminSettings existe');
  const iRpc = fn.indexOf("c.rpc('bets_admin_settings')");
  const iAll = fn.indexOf(".select('*')");
  const iPub = fn.indexOf('.select(PUBLIC_SETTINGS_COLUMNS)');
  assert.ok(iRpc >= 0 && iAll > iRpc && iPub > iAll, 'ordem: RPC → select(*) (SQL por correr) → colunas públicas');
  assert.match(fn, /if \(!error && d\?\.ok\) return/);
  assert.match(fn, /if \(error\) \{/, 'select(*) só quando a RPC falha (ex.: ainda não existe)');
  // o select('*') de bet_settings só existe aqui
  assert.equal((api.match(/from\('bet_settings'\)\.select\('\*'\)/g) ?? []).length, 1);
});

test('demo: ligar dinheiro real não regista nº nem datas da licença', () => {
  const core = code('lib/betsCore.ts');
  assert.ok(!/licenca: cand\.igjLicenceNo/.test(core));
  assert.ok(!/emissao: lic\.issue|validade: lic\.expiry/.test(core));
});

test('interface pública de apostas sem moedas de teste nem licença', () => {
  for (const f of ['components/bets/Bets.tsx', 'app/apostas/page.tsx', 'components/comp/Wallet.tsx', 'app/perfil/page.tsx', 'app/page.tsx', 'components/jogos/GamePage.tsx']) {
    const s = code(f);
    for (const bad of ['TXAP Pontos', 'pts grátis', 'saldo de teste', 'Licença IGJ', 'igjLicenceNo}', 'igjLicenceDate)', 'WalletApostas', 'ApostasV3', 'fmtPts']) {
      assert.ok(!s.includes(bad), `${f} não pode conter "${bad}"`);
    }
  }
  assert.match(read('components/bets/Bets.tsx'), /Apostas em dinheiro real disponíveis em breve\./);
});

test('nenhum número de licença de exemplo no código', () => {
  const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of ['lib', 'components', 'app', 'public'].flatMap(walk).filter((f) => /\.(tsx?|mjs|js|json|html)$/.test(f))) {
    assert.ok(!read(f).includes('TXP-2026'), `${f} contém um número de licença de exemplo`);
  }
});

test('admin: ligar dinheiro real exige número da licença; número escondido por omissão', () => {
  const a = read('components/admin/BetsAdmin.tsx');
  assert.match(a, /disabled=\{noEmpty \|\| !gate\.ok\}/);
  assert.match(a, /type=\{showNo \? 'text' : 'password'\}/);
});
