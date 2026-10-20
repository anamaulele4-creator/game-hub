-- =====================================================================
-- TXAPILOG · Marketplace: venda de CONTAS de jogos só por criadores (2026-10-20). IDEMPOTENTE.
--
-- • Anúncios do tipo 'conta' (market_products.kind = 'conta', diferente de diamantes/moedas e itens) só podem ser
--   criados/publicados por vendedores com Função 'criador' (role 'creator') ou 'admin'. Utilizadores normais e
--   moderadores são recusados no SERVIDOR (CONTAS_CRIADOR), não só no formulário.
-- • Interruptor app_settings.venda_contas_enabled (LIGADO por omissão, como já estava a funcionar). Desligado:
--   ninguém, exceto admin, publica anúncios de contas (CONTAS_OFF). Mudanças só por admin, com auditoria.
-- • Retirar (status 'removido') um anúncio de conta é sempre permitido.
-- • NÃO altera colunas, restrições nem o gatilho market_products_guard já existentes (verificação de vendedor
--   continua a valer). Não inclui nada do Marketplace 3.0.
--
-- Corre DEPOIS de sql-apostas.html (2026-10-20-apostas-v2.sql: app_settings + auditoria) e das migrações do marketplace.
-- =====================================================================

-- 1. Pré-requisitos ------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.app_settings') is null or to_regprocedure('public.app__audit(text,text,text,jsonb,jsonb)') is null then
    raise exception 'Corre primeiro o SQL de Apostas v2 (sql-apostas.html): cria app_settings e a auditoria.';
  end if;
  if to_regclass('public.market_products') is null then
    raise exception 'Falta o marketplace (market_products). Corre primeiro as migrações do marketplace.';
  end if;
end $$;

insert into public.app_settings (key, value, perm) values ('venda_contas_enabled', 'true'::jsonb, 'admin') on conflict (key) do nothing;

-- 2. Regra no servidor ------------------------------------------------------------------------
create or replace function public.market__contas_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = 'venda_contas_enabled'), true) $$;

create or replace function public.market__can_sell_accounts(p_seller uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_seller and role in ('creator','admin') and not banned) $$;

create or replace function public.market__tg_contas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind is distinct from 'conta' or new.status = 'removido' then return new; end if;
  -- serviço (sem sessão) e admin ficam de fora: o admin pode sempre corrigir/moderar anúncios
  if auth.uid() is null or public.is_admin() then return new; end if;
  if not public.market__can_sell_accounts(new.seller_id) then raise exception 'CONTAS_CRIADOR'; end if;
  if not public.market__contas_enabled()
     and (tg_op = 'INSERT' or old.kind is distinct from 'conta' or (new.status = 'ativo' and old.status is distinct from 'ativo')) then
    raise exception 'CONTAS_OFF';
  end if;
  return new;
end $$;
drop trigger if exists market_products_contas on public.market_products;
create trigger market_products_contas before insert or update on public.market_products for each row execute function public.market__tg_contas();

grant execute on function public.market__contas_enabled() to anon, authenticated;
grant execute on function public.market__can_sell_accounts(uuid) to authenticated;

select key, value from public.app_settings where key = 'venda_contas_enabled';
