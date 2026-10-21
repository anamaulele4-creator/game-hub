// Visitantes sem sessão viam o Marketplace vazio: as regras RLS de leitura chamam mkt__store_member, sem EXECUTE para o anon.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('anon pode executar mkt__store_member/mkt__store_role (usadas nas regras de leitura pública do Marketplace)', () => {
  const p8 = read('supabase/migrations/2026-10-21-mkt3-08-equipa-loja.sql');
  assert.match(p8, /mkt__store_member\(store_id, array\['gestor'\]\)/, 'a regra de leitura de market_products usa a função');
  const fix = read('supabase/migrations/2026-10-21-fix-anon-loja-equipa.sql');
  assert.match(fix, /grant execute on function public\.mkt__store_role\(uuid\), public\.mkt__store_member\(uuid, text\[\]\) to anon;/);
  // sem sessão a função nunca dá acesso: auth.uid() null → null/false
  assert.match(p8, /when auth\.uid\(\) is null or p_store is null then null/);
  assert.doesNotMatch(fix, /\b(drop|delete|truncate|update)\b/i, 'só um GRANT');
});
