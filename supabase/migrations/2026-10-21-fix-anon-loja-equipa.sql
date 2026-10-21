-- Correção (2026-10-21): visitantes sem sessão não viam o Marketplace (GET market_products → 401
-- "permission denied for function mkt__store_member").
-- As regras RLS de leitura de market_products, mkt_product_variants e market_orders (Parte 8, equipa da loja)
-- chamam public.mkt__store_member(), mas a Parte 8 tirou o EXECUTE ao anon. Para o anon a função devolve sempre
-- false (auth.uid() é null), por isso dar-lhe EXECUTE não abre nada: só deixa a regra 'status = ativo' funcionar.
-- Idempotente. Instalar depois de 2026-10-21-mkt3-08-equipa-loja.sql.
grant execute on function public.mkt__store_role(uuid), public.mkt__store_member(uuid, text[]) to anon;
notify pgrst, 'reload schema';
