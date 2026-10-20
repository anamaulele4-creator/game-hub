// Creator OS (secção 03 da especificação): painel em destaque e todos os módulos presentes e ligados a funções reais.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('Painel do criador em destaque: menu da conta, Mais, Marketplace (cartão e navegação) — sem depender do interruptor público', () => {
  const api = read('lib/mkt3Api.ts');
  assert.match(api, /export const canSeeCreatorPanel = .*\n.*m\.installed && \(m\.isAdmin \|\| m\.role === 'creator' \|\| m\.role === 'criador' \|\| m\.role === 'admin' \|\| m\.sellerVerified\)/);
  assert.ok(!/canSeeCreatorPanel[^\n]*\n[^\n]*m\.open/.test(api), 'não depende de mkt3_enabled');
  assert.match(read('components/SiteHeader.tsx'), /creator && <Link role="menuitem" href="\/marketplace\/criador\/"/);
  assert.match(read('app/mais/page.tsx'), /creator \? \[\['\/marketplace\/criador', 'star', 'Painel do criador'\]/);
  assert.match(read('app/marketplace/page.tsx'), /\{creator && \(\s*<Link href="\/marketplace\/criador"/);
  assert.match(read('components/market/Kit.tsx'), /if \(canSeeCreatorPanel\(m\)\) items\.splice\(1, 0, \['criador'/);
  assert.match(read('app/marketplace/criador/page.tsx'), /<Mkt3Gate allowClosed>/);
});

test('Secção 03: todos os módulos do painel existem e chamam funções do servidor', () => {
  const page = read('app/marketplace/criador/page.tsx');
  for (const t of ['resumo', 'perfil', 'loja', 'produtos', 'vendas', 'financas', 'avaliacoes', 'reclamacoes', 'cupoes', 'equipa', 'relatorios', 'avisos']) assert.ok(page.includes(`['${t}',`), t);
  const c = read('components/mkt3/Creator.tsx');
  for (const fn of ['creatorDashboard', 'creatorProfileSave', 'payoutMethodSave', 'creatorDisputes', 'creatorAutomations', 'creatorReport', 'sellerFinance', 'payoutRequest', 'reviewReply', 'notifPrefSet', 'storeSave'])
    assert.ok(c.includes(`mkt3.${fn}(`), fn);
  for (const k of ['Total de vendas', 'Pedidos', 'Pendentes', 'Concluídos', 'Cancelamentos', 'Valor bruto vendido', 'Comissões cobradas', 'Valor líquido estimado',
    'Pagamentos pendentes', 'Pagamentos concluídos', 'Avaliação média', 'Produtos mais vendidos', 'Evolução das vendas', 'Clientes recorrentes']) assert.ok(c.includes(k), `KPI ${k}`);
  assert.ok(read('components/mkt3/Team.tsx').includes('mkt3.memberSet('));
  const sql = read('supabase/migrations/2026-10-21-mkt3-10-creator-os.sql');
  for (const e of ['novo_pedido', 'pagamento_confirmado', 'pedido_cancelado', 'pedido_concluido', 'nova_avaliacao', 'nova_mensagem', 'reclamacao', 'pagamento_vendedor', 'stock_baixo', 'conta'])
    assert.ok(sql.includes(`('${e}',`), `automação ${e}`);
});
