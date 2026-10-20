-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 2/6 — Lojas, produtos (estados, variantes, serviços), pesquisa. IDEMPOTENTE.
-- Os anúncios existentes continuam válidos: 'ativo' = Publicado. Estados novos são acrescentados (superconjunto).
-- O formulário /marketplace/anunciar continua a funcionar sem alterações.
-- =====================================================================

do $$ begin
  if to_regprocedure('public.mkt__can(text)') is null then raise exception 'Corre primeiro a Parte 1 (base).'; end if;
end $$;

-- 1. Lojas -----------------------------------------------------------------------------------------
create table if not exists public.mkt_stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$'),
  name text not null check (length(trim(name)) between 2 and 60),
  logo_url text,
  cover_url text,
  description text not null default '' check (length(description) <= 2000),
  category text not null default 'outros' check (length(category) between 2 and 40),
  location text not null default '' check (length(location) <= 120),
  business_info text not null default '' check (length(business_info) <= 500),
  hours text not null default '' check (length(hours) <= 200),
  delivery_policy text not null default '' check (length(delivery_policy) <= 1000),
  return_policy text not null default '' check (length(return_policy) <= 1000),
  payment_methods text[] not null default array['carteira'] check (payment_methods <@ array['carteira']),
  contact_public text not null default '' check (length(contact_public) <= 120),
  status text not null default 'configuracao' check (status in ('configuracao','pendente','ativa','suspensa','encerrada')),
  status_reason text not null default '',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists mkt_stores_slug_uq on public.mkt_stores (lower(slug));
create index if not exists mkt_stores_status_idx on public.mkt_stores (status, created_at desc);

create table if not exists public.mkt_store_decisions (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.mkt_stores(id) on delete cascade,
  from_status text, to_status text not null,
  action text not null,
  reason text not null default '',
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mkt_store_decisions_store_idx on public.mkt_store_decisions (store_id, id desc);

create or replace function public.mkt__tg_immutable() returns trigger language plpgsql as $$
begin raise exception 'IMMUTABLE'; end $$;
drop trigger if exists mkt_store_decisions_immutable on public.mkt_store_decisions;
create trigger mkt_store_decisions_immutable before update or delete on public.mkt_store_decisions for each row execute function public.mkt__tg_immutable();

-- Imagens: só do próprio utilizador no bucket media (mesma pasta das fotos dos anúncios)
create or replace function public.mkt__own_media(p_url text, p_owner uuid) returns boolean language sql immutable as $$
  select p_url is null or p_url = '' or p_url ~ ('/storage/v1/object/public/media/products/' || p_owner::text || '/[A-Za-z0-9._/-]+$') $$;

-- Pode ter loja: criador, admin ou vendedor verificado (documento + selfie aprovados)
create or replace function public.mkt__can_sell(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_user and not banned and deleted_at is null and (suspended_until is null or suspended_until < now())
    and (role in ('creator','admin') or public.seller__verified(p_user))) $$;

create or replace function public.mkt__store_log(p_store uuid, p_from text, p_to text, p_action text, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into mkt_store_decisions (store_id, from_status, to_status, action, reason, actor_id) values (p_store, p_from, p_to, p_action, coalesce(p_reason, ''), auth.uid()) $$;

create or replace function public.mkt_store_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); st mkt_stores; sl text := lower(trim(coalesce(p->>'slug', '')));
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if not public.mkt__open() then return public.mkt__err('MKT3_OFF'); end if;
  if not public.mkt__can_sell(uid) then return public.mkt__err('NOT_SELLER'); end if;
  if not public.mkt__rate('store_save:' || uid, 30, 3600) then return public.mkt__err('RATE'); end if;
  if not public.mkt__own_media(p->>'logo_url', uid) or not public.mkt__own_media(p->>'cover_url', uid) then return public.mkt__err('PHOTOS'); end if;
  if exists (select 1 from mkt_stores where lower(slug) = sl and owner_id <> uid) then return public.mkt__err('SLUG_TAKEN'); end if;
  select * into st from mkt_stores where owner_id = uid for update;
  if st.id is not null and st.status in ('suspensa') then return public.mkt__err('STORE_SUSPENDED'); end if;
  begin
    if st.id is null then
      insert into mkt_stores (owner_id, slug, name, logo_url, cover_url, description, category, location, business_info, hours, delivery_policy, return_policy, contact_public)
      values (uid, sl, trim(p->>'name'), nullif(p->>'logo_url', ''), nullif(p->>'cover_url', ''), coalesce(p->>'description', ''), coalesce(nullif(p->>'category', ''), 'outros'),
              coalesce(p->>'location', ''), coalesce(p->>'business_info', ''), coalesce(p->>'hours', ''), coalesce(p->>'delivery_policy', ''), coalesce(p->>'return_policy', ''), coalesce(p->>'contact_public', ''))
      returning * into st;
      perform public.mkt__store_log(st.id, null, 'configuracao', 'criar', '');
    else
      update mkt_stores set slug = sl, name = trim(p->>'name'), logo_url = nullif(p->>'logo_url', ''), cover_url = nullif(p->>'cover_url', ''),
        description = coalesce(p->>'description', ''), category = coalesce(nullif(p->>'category', ''), 'outros'), location = coalesce(p->>'location', ''),
        business_info = coalesce(p->>'business_info', ''), hours = coalesce(p->>'hours', ''), delivery_policy = coalesce(p->>'delivery_policy', ''),
        return_policy = coalesce(p->>'return_policy', ''), contact_public = coalesce(p->>'contact_public', ''),
        status = case when status = 'encerrada' then 'configuracao' else status end, updated_at = now()
      where id = st.id returning * into st;
    end if;
  exception when check_violation or not_null_violation then return public.mkt__err('INVALID');
            when unique_violation then return public.mkt__err('SLUG_TAKEN');
  end;
  return jsonb_build_object('ok', true, 'id', st.id, 'status', st.status);
end $$;

-- Dono: submeter (→ pendente ou ativa, conforme o interruptor) ou encerrar
create or replace function public.mkt_store_owner_action(p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st mkt_stores; nxt text;
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  select * into st from mkt_stores where owner_id = auth.uid() for update;
  if st.id is null then return public.mkt__err('NOT_FOUND'); end if;
  nxt := case
    when p_action = 'submeter' and st.status = 'configuracao' then case when public.mkt__flag('mkt3_store_review_required', true) then 'pendente' else 'ativa' end
    when p_action = 'encerrar' and st.status in ('configuracao','pendente','ativa') then 'encerrada'
    else null end;
  if nxt is null then return public.mkt__err('STATE'); end if;
  if p_action = 'submeter' and not public.mkt__can_sell(auth.uid()) then return public.mkt__err('NOT_SELLER'); end if;
  update mkt_stores set status = nxt, status_reason = '', updated_at = now(), verified_at = case when nxt = 'ativa' then now() else verified_at end where id = st.id;
  perform public.mkt__store_log(st.id, st.status, nxt, p_action, '');
  if nxt = 'encerrada' then
    perform set_config('mkt.sys', '1', true);
    update market_products set status = 'arquivado' where store_id = st.id and status in ('ativo','pendente','esgotado');
  end if;
  return jsonb_build_object('ok', true, 'status', nxt);
end $$;

-- Admin (STORES_MANAGE): aprovar, rejeitar, suspender, reativar, encerrar — sempre com histórico e motivo
create or replace function public.mkt_admin_store_action(p_store uuid, p_action text, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare st mkt_stores; nxt text;
begin
  if not public.mkt__can('STORES_MANAGE') then return public.mkt__deny('STORES_MANAGE', 'loja_' || coalesce(p_action, ''), p_store::text); end if;
  select * into st from mkt_stores where id = p_store for update;
  if st.id is null then return public.mkt__err('NOT_FOUND'); end if;
  if p_action in ('rejeitar','suspender','encerrar') and length(trim(coalesce(p_reason, ''))) < 5 then return public.mkt__err('REASON'); end if;
  nxt := case
    when p_action = 'aprovar' and st.status = 'pendente' then 'ativa'
    when p_action = 'rejeitar' and st.status = 'pendente' then 'configuracao'
    when p_action = 'suspender' and st.status in ('pendente','ativa','configuracao') then 'suspensa'
    when p_action = 'reativar' and st.status = 'suspensa' then 'ativa'
    when p_action = 'encerrar' and st.status <> 'encerrada' then 'encerrada'
    else null end;
  if nxt is null then return public.mkt__err('STATE'); end if;
  update mkt_stores set status = nxt, status_reason = coalesce(trim(p_reason), ''), updated_at = now(),
    verified_at = case when nxt = 'ativa' then now() else verified_at end where id = st.id;
  perform public.mkt__store_log(st.id, st.status, nxt, p_action, p_reason);
  perform set_config('mkt.sys', '1', true);
  if nxt in ('suspensa','encerrada') then
    update market_products set status = 'suspenso', moderation_reason = 'loja ' || nxt where store_id = st.id and status in ('ativo','pendente','esgotado');
  elsif nxt = 'ativa' and st.status = 'suspensa' then
    update market_products set status = case when stock > 0 then 'ativo' else 'esgotado' end, moderation_reason = '' where store_id = st.id and status = 'suspenso' and moderation_reason = 'loja suspensa';
  end if;
  perform public.mkt__audit('loja_' || p_action, st.id::text, 'ok', p_reason, jsonb_build_object('status', st.status), jsonb_build_object('status', nxt));
  perform public.mkt__notify(st.owner_id, 'conta', 'A tua loja "' || st.name || '": ' || case nxt when 'ativa' then 'está ativa' when 'configuracao' then 'precisa de correções — ' || left(p_reason, 120)
    when 'suspensa' then 'foi suspensa — ' || left(p_reason, 120) else 'foi encerrada — ' || left(p_reason, 120) end, '/marketplace/criador', 'store:' || st.id || ':' || nxt || ':' || extract(epoch from now())::bigint);
  return jsonb_build_object('ok', true, 'status', nxt);
end $$;

-- Avaliações: coluna de moderação (usada na média; a Parte 5 acrescenta o resto)
alter table public.market_reviews add column if not exists hidden boolean not null default false;

-- 2. Produtos: colunas novas (todas com valor por omissão → anúncios existentes não mudam) -------------------
alter table public.market_products add column if not exists store_id uuid references public.mkt_stores(id) on delete set null;
alter table public.market_products add column if not exists condition text not null default 'digital';
alter table public.market_products add column if not exists videos text[] not null default '{}';
alter table public.market_products add column if not exists delivery_info text not null default '';
alter table public.market_products add column if not exists return_policy text not null default '';
alter table public.market_products add column if not exists shipping_mzn integer not null default 0;
alter table public.market_products add column if not exists views integer not null default 0;
alter table public.market_products add column if not exists published_at timestamptz;
alter table public.market_products add column if not exists moderation_reason text not null default '';
alter table public.market_products add column if not exists service_area text not null default '';
alter table public.market_products add column if not exists lead_time_days integer;
alter table public.market_products add column if not exists requirements text not null default '';
alter table public.market_products add column if not exists terms text not null default '';
alter table public.market_products add column if not exists completion_criteria text not null default '';
alter table public.market_products add column if not exists low_stock_threshold integer not null default 2;
alter table public.market_products drop constraint if exists market_products_condition_check;
alter table public.market_products add constraint market_products_condition_check check (condition in ('novo','usado','digital'));
alter table public.market_products drop constraint if exists market_products_shipping_check;
alter table public.market_products add constraint market_products_shipping_check check (shipping_mzn between 0 and 100000);
alter table public.market_products drop constraint if exists market_products_v3_text_check;
alter table public.market_products add constraint market_products_v3_text_check check (length(delivery_info) <= 500 and length(return_policy) <= 500
  and length(service_area) <= 200 and length(requirements) <= 1000 and length(terms) <= 1000 and length(completion_criteria) <= 1000
  and (lead_time_days is null or lead_time_days between 1 and 365) and low_stock_threshold between 0 and 1000 and coalesce(array_length(videos, 1), 0) <= 3);
-- Estados: superconjunto dos anteriores ('ativo' = Publicado; 'removido' mantém-se para os anúncios antigos)
alter table public.market_products drop constraint if exists market_products_status_check;
alter table public.market_products add constraint market_products_status_check check (status in ('rascunho','pendente','ativo','esgotado','suspenso','arquivado','removido'));
update public.market_products set published_at = created_at where published_at is null and status = 'ativo';
create index if not exists market_products_store_idx on public.market_products (store_id, status);
create index if not exists market_products_status_v3_idx on public.market_products (status, sales desc, created_at desc);
create index if not exists market_products_title_trgm_idx on public.market_products (lower(title));

-- Guarda adicional (corre depois de market_products_guard e market_products_contas): estados, loja, vídeos, moderação.
create or replace function public.mkt__tg_product() returns trigger
language plpgsql security definer set search_path = public as $$
declare trusted boolean := auth.uid() is null or coalesce(current_setting('mkt.sys', true), '') = '1' or public.mkt__can('PRODUCTS_MODERATE');
begin
  if new.store_id is not null and (tg_op = 'INSERT' or new.store_id is distinct from old.store_id)
     and not exists (select 1 from mkt_stores where id = new.store_id and owner_id = new.seller_id and status in ('configuracao','pendente','ativa')) then
    raise exception 'STORE';
  end if;
  if exists (select 1 from unnest(new.videos) v where v !~ '^https://(www\.)?(youtube\.com/(watch\?v=|shorts/)|youtu\.be/)[A-Za-z0-9_-]{6,20}([?&][A-Za-z0-9_=&-]*)?$') then
    raise exception 'VIDEOS';
  end if;
  if not trusted then
    if tg_op = 'UPDATE' then
      new.views := old.views; new.moderation_reason := old.moderation_reason;
      if old.status = 'suspenso' then new.status := 'suspenso'; end if;
      if new.status = 'suspenso' and old.status <> 'suspenso' then raise exception 'STATUS_FORBIDDEN'; end if;
      if old.status = 'pendente' and new.status = 'ativo' then new.status := 'pendente'; end if;
    else
      new.views := 0; new.moderation_reason := '';
      if new.status = 'suspenso' then raise exception 'STATUS_FORBIDDEN'; end if;
    end if;
    -- Revisão prévia (interruptor): publicar → pendente de revisão
    if new.status = 'ativo' and (tg_op = 'INSERT' or old.status not in ('ativo','esgotado')) and public.mkt__flag('mkt3_product_review_required') then
      new.status := 'pendente';
    end if;
    -- Proteção contra publicações proibidas (lista mínima; moderação humana faz o resto)
    if new.status in ('ativo','pendente') and (lower(new.title) || ' ' || lower(new.description)) ~ '(cart[aã]o clonado|conta roubada|hack de pagamento|cvv|carding|bin de cart)' then
      raise exception 'PROHIBITED';
    end if;
  end if;
  -- Esgotado/Publicado automático conforme o stock
  if new.status = 'ativo' and new.stock = 0 and new.kind <> 'servico' then new.status := 'esgotado'; end if;
  if new.status = 'esgotado' and new.stock > 0 then new.status := 'ativo'; end if;
  if new.status = 'ativo' and new.published_at is null then new.published_at := now(); end if;
  return new;
end $$;
drop trigger if exists market_products_mkt3 on public.market_products;
create trigger market_products_mkt3 before insert or update on public.market_products for each row execute function public.mkt__tg_product();

-- Aviso de stock baixo (uma vez por descida abaixo do limite)
create or replace function public.mkt__tg_product_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock <= new.low_stock_threshold and old.stock > new.low_stock_threshold and new.kind <> 'servico' then
    perform public.mkt__notify(new.seller_id, 'stock_baixo', 'Stock baixo: "' || left(new.title, 60) || '" tem ' || new.stock || ' unidade(s).',
      '/marketplace/criador', 'stock:' || new.id || ':' || extract(epoch from now())::bigint / 3600);
  end if;
  return null;
end $$;
drop trigger if exists market_products_mkt3_after on public.market_products;
create trigger market_products_mkt3_after after update of stock on public.market_products for each row execute function public.mkt__tg_product_after();

-- 3. Variantes -------------------------------------------------------------------------------------
create table if not exists public.mkt_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.market_products(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  price_mzn integer not null check (price_mzn > 0 and price_mzn <= 1000000),
  stock integer not null default 0 check (stock between 0 and 100000),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);
create index if not exists mkt_product_variants_product_idx on public.mkt_product_variants (product_id, position);

create or replace function public.mkt_variant_save(p_product uuid, p_id uuid, p_name text, p_price integer, p_stock integer, p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare vid uuid;
begin
  if not exists (select 1 from market_products where id = p_product and seller_id = auth.uid()) then return public.mkt__err('FORBIDDEN'); end if;
  if (select count(*) from mkt_product_variants where product_id = p_product) >= 20 and p_id is null then return public.mkt__err('LIMIT'); end if;
  begin
    if p_id is null then
      insert into mkt_product_variants (product_id, name, price_mzn, stock, active, position)
        values (p_product, trim(p_name), p_price, p_stock, coalesce(p_active, true), (select coalesce(max(position), 0) + 1 from mkt_product_variants where product_id = p_product))
        returning id into vid;
    else
      update mkt_product_variants set name = trim(p_name), price_mzn = p_price, stock = p_stock, active = coalesce(p_active, true), updated_at = now()
        where id = p_id and product_id = p_product returning id into vid;
      if vid is null then return public.mkt__err('NOT_FOUND'); end if;
    end if;
  exception when check_violation or not_null_violation then return public.mkt__err('INVALID');
            when unique_violation then return public.mkt__err('DUPLICATE');
  end;
  return jsonb_build_object('ok', true, 'id', vid);
end $$;

-- 4. Ações do vendedor sobre produtos ---------------------------------------------------------------
create or replace function public.mkt_product_duplicate(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p market_products; nid uuid;
begin
  select * into p from market_products where id = p_id and seller_id = auth.uid();
  if p.id is null then return public.mkt__err('FORBIDDEN'); end if;
  if not public.mkt__rate('dup:' || auth.uid(), 20, 3600) then return public.mkt__err('RATE'); end if;
  insert into market_products (seller_id, category, kind, delivery, title, description, price_mzn, price_currency, price_original, fx_rate, stock, photos, whatsapp, status,
    store_id, condition, videos, delivery_info, return_policy, shipping_mzn, service_area, lead_time_days, requirements, terms, completion_criteria, low_stock_threshold)
  values (p.seller_id, p.category, p.kind, p.delivery, left(p.title || ' (cópia)', 80), p.description, p.price_mzn, p.price_currency, p.price_original, p.fx_rate, p.stock, p.photos, p.whatsapp, 'rascunho',
    case when exists (select 1 from mkt_stores where id = p.store_id and status in ('configuracao','pendente','ativa')) then p.store_id end,
    p.condition, p.videos, p.delivery_info, p.return_policy, p.shipping_mzn, p.service_area, p.lead_time_days, p.requirements, p.terms, p.completion_criteria, p.low_stock_threshold)
  returning id into nid;
  insert into mkt_product_variants (product_id, name, price_mzn, stock, active, position)
    select nid, name, price_mzn, stock, active, position from mkt_product_variants where product_id = p.id;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- Contagem de visualizações (limitada: 1 por utilizador/IP por produto a cada 30 min)
create or replace function public.mkt_product_view(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(auth.uid()::text, nullif(left(coalesce(nullif(current_setting('request.headers', true), '')::jsonb->>'x-forwarded-for', ''), 60), ''), 'anon');
begin
  if public.mkt__rate('view:' || p_id || ':' || who, 1, 1800) then
    update market_products set views = views + 1 where id = p_id and status = 'ativo';
  end if;
end $$;

-- Moderação (PRODUCTS_MODERATE): aprovar, rejeitar, suspender, reativar, arquivar
create or replace function public.mkt_admin_product_action(p_ids uuid[], p_action text, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer; r record;
begin
  if not public.mkt__can('PRODUCTS_MODERATE') then return public.mkt__deny('PRODUCTS_MODERATE', 'produto_' || coalesce(p_action, ''), array_to_string(p_ids, ',')); end if;
  if p_action in ('rejeitar','suspender') and length(trim(coalesce(p_reason, ''))) < 5 then return public.mkt__err('REASON'); end if;
  if p_action not in ('aprovar','rejeitar','suspender','reativar','arquivar') then return public.mkt__err('STATE'); end if;
  update market_products set
    status = case p_action when 'aprovar' then 'ativo' when 'rejeitar' then 'rascunho' when 'suspender' then 'suspenso' when 'reativar' then 'ativo' else 'arquivado' end,
    moderation_reason = case when p_action in ('rejeitar','suspender') then trim(p_reason) else '' end
  where id = any(p_ids) and (
    (p_action = 'aprovar' and status = 'pendente') or (p_action = 'rejeitar' and status = 'pendente') or (p_action = 'suspender' and status in ('ativo','pendente','esgotado','rascunho'))
    or (p_action = 'reativar' and status = 'suspenso') or (p_action = 'arquivar' and status <> 'arquivado'));
  get diagnostics n = row_count;
  perform public.mkt__audit('produto_' || p_action, n || ' produto(s): ' || left(array_to_string(p_ids, ','), 150), 'ok', p_reason);
  for r in select distinct seller_id, title from market_products where id = any(p_ids) and p_action in ('aprovar','rejeitar','suspender') loop
    perform public.mkt__notify(r.seller_id, 'conta', '"' || left(r.title, 60) || '": ' || case p_action when 'aprovar' then 'publicado' when 'rejeitar' then 'precisa de correções — ' || left(p_reason, 100)
      else 'suspenso — ' || left(p_reason, 100) end, '/marketplace/criador', 'prod:' || p_action || ':' || md5(r.title || r.seller_id::text) || ':' || extract(epoch from now())::bigint);
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- 5. Pesquisa e descoberta (só dados reais publicados) ------------------------------------------------
create or replace function public.mkt__store_ok(p_store uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_store is null or exists (select 1 from mkt_stores where id = p_store and status = 'ativa') $$;

create or replace function public.mkt_search(p_q text default '', p_type text default 'produtos', p_category text default null, p_kind text default null,
  p_sort text default 'recentes', p_min integer default null, p_max integer default null, p_page integer default 1, p_size integer default 24) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := lower(trim(coalesce(p_q, ''))); lim integer := least(greatest(coalesce(p_size, 24), 1), 60); off integer := (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_size, 24), 1), 60);
  total integer; rows jsonb;
begin
  if length(q) > 80 then q := left(q, 80); end if;
  q := replace(replace(replace(q, '\', ''), '%', ''), '_', ' ');
  if p_type = 'lojas' then
    select count(*) into total from mkt_stores s where s.status = 'ativa' and (q = '' or lower(s.name) like '%' || q || '%' or lower(s.description) like '%' || q || '%')
      and (p_category is null or s.category = p_category);
    select coalesce(jsonb_agg(x), '[]') into rows from (
      select s.id, s.slug, s.name, s.logo_url, s.cover_url, left(s.description, 200) as description, s.category, s.location,
        (select count(*) from market_products p where p.store_id = s.id and p.status = 'ativo') as products,
        (select round(avg(r.rating)::numeric, 1) from market_reviews r where r.seller_id = s.owner_id and not coalesce(r.hidden, false)) as rating
      from mkt_stores s where s.status = 'ativa' and (q = '' or lower(s.name) like '%' || q || '%' or lower(s.description) like '%' || q || '%')
        and (p_category is null or s.category = p_category)
      order by case when p_sort = 'populares' then (select coalesce(sum(sales), 0) from market_products where store_id = s.id) end desc nulls last, s.created_at desc
      limit lim offset off) x;
  elsif p_type = 'criadores' then
    select count(*) into total from profiles pr where pr.role = 'creator' and not pr.banned and pr.deleted_at is null
      and (q = '' or lower(pr.display_name) like '%' || q || '%' or lower(pr.handle) like '%' || q || '%')
      and exists (select 1 from market_products p where p.seller_id = pr.id and p.status = 'ativo');
    select coalesce(jsonb_agg(x), '[]') into rows from (
      select pr.id, pr.handle, pr.display_name, pr.avatar_url, left(pr.bio, 160) as bio, pr.verified,
        (select slug from mkt_stores where owner_id = pr.id and status = 'ativa') as store_slug,
        (select count(*) from market_products p where p.seller_id = pr.id and p.status = 'ativo') as products
      from profiles pr where pr.role = 'creator' and not pr.banned and pr.deleted_at is null
        and (q = '' or lower(pr.display_name) like '%' || q || '%' or lower(pr.handle) like '%' || q || '%')
        and exists (select 1 from market_products p where p.seller_id = pr.id and p.status = 'ativo')
      order by pr.followers_count desc, pr.created_at desc limit lim offset off) x;
  else
    select count(*) into total from market_products p where p.status = 'ativo' and public.mkt__store_ok(p.store_id)
      and (q = '' or lower(p.title) like '%' || q || '%' or lower(p.description) like '%' || q || '%')
      and (p_category is null or p.category = p_category) and (p_kind is null or p.kind = p_kind)
      and (p_type <> 'servicos' or p.kind = 'servico')
      and (p_min is null or p.price_mzn >= p_min) and (p_max is null or p.price_mzn <= p_max);
    select coalesce(jsonb_agg(x), '[]') into rows from (
      select p.id, p.title, p.category, p.kind, p.delivery, p.price_mzn, p.price_currency, p.price_original, p.photos, p.stock, p.sales, p.views, p.featured,
        p.seller_id, p.seller_name, p.store_id, (select slug from mkt_stores where id = p.store_id) as store_slug, p.created_at,
        exists (select 1 from mkt_product_variants v where v.product_id = p.id and v.active) as has_variants
      from market_products p where p.status = 'ativo' and public.mkt__store_ok(p.store_id)
        and (q = '' or lower(p.title) like '%' || q || '%' or lower(p.description) like '%' || q || '%')
        and (p_category is null or p.category = p_category) and (p_kind is null or p.kind = p_kind)
        and (p_type <> 'servicos' or p.kind = 'servico')
        and (p_min is null or p.price_mzn >= p_min) and (p_max is null or p.price_mzn <= p_max)
      order by case when p_sort = 'preco_asc' then p.price_mzn end asc nulls last,
               case when p_sort = 'preco_desc' then p.price_mzn end desc nulls last,
               case when p_sort = 'populares' then p.sales * 10 + p.views end desc nulls last,
               case when q <> '' and p_sort = 'relevancia' then (lower(p.title) like q || '%')::int end desc nulls last,
               p.featured desc, p.created_at desc
      limit lim offset off) x;
  end if;
  return jsonb_build_object('ok', true, 'total', total, 'page', greatest(coalesce(p_page, 1), 1), 'size', lim, 'rows', rows);
end $$;

create or replace function public.mkt_suggest(p_q text) returns jsonb
language sql stable security definer set search_path = public as $$
  with q as (select replace(replace(lower(trim(left(coalesce(p_q, ''), 40))), '%', ''), '_', ' ') as t)
  select jsonb_build_object('ok', true,
    'products', coalesce((select jsonb_agg(title) from (select distinct p.title from market_products p, q where length(q.t) >= 2 and p.status = 'ativo' and lower(p.title) like '%' || q.t || '%' order by p.title limit 6) a), '[]'),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name)) from (select s.slug, s.name from mkt_stores s, q where length(q.t) >= 2 and s.status = 'ativa' and lower(s.name) like '%' || q.t || '%' order by s.name limit 4) b), '[]')) $$;

create or replace function public.mkt_related(p_id uuid, p_limit integer default 8) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]') from (
    select p.id, p.title, p.category, p.kind, p.delivery, p.price_mzn, p.price_currency, p.price_original, p.photos, p.stock, p.sales, p.seller_name, p.featured, p.created_at
    from market_products p join market_products o on o.id = p_id
    where p.id <> o.id and p.status = 'ativo' and public.mkt__store_ok(p.store_id) and (p.category = o.category or p.seller_id = o.seller_id)
    order by (p.category = o.category and p.kind = o.kind) desc, p.sales desc, p.created_at desc limit least(greatest(coalesce(p_limit, 8), 1), 24)) x $$;

-- Página pública da loja
create or replace function public.mkt_store_public(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s mkt_stores; pr profiles;
begin
  select * into s from mkt_stores where lower(slug) = lower(trim(coalesce(p_slug, '')));
  if s.id is null or (s.status <> 'ativa' and s.owner_id is distinct from auth.uid() and not public.mkt__can('STORES_VIEW')) then return public.mkt__err('NOT_FOUND'); end if;
  select * into pr from profiles where id = s.owner_id;
  return jsonb_build_object('ok', true,
    'store', jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'logo_url', s.logo_url, 'cover_url', s.cover_url, 'description', s.description, 'category', s.category,
      'location', s.location, 'business_info', s.business_info, 'hours', s.hours, 'delivery_policy', s.delivery_policy, 'return_policy', s.return_policy,
      'payment_methods', s.payment_methods, 'contact_public', s.contact_public, 'status', s.status, 'created_at', s.created_at, 'owner_id', s.owner_id),
    'owner', jsonb_build_object('handle', pr.handle, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url, 'bio', left(pr.bio, 300), 'verified', pr.verified, 'role', pr.role),
    'rating', (select jsonb_build_object('avg', round(avg(rating)::numeric, 1), 'count', count(*)) from market_reviews where seller_id = s.owner_id and not coalesce(hidden, false)),
    'products', (select coalesce(jsonb_agg(x), '[]') from (
      select id, title, category, kind, delivery, price_mzn, price_currency, price_original, photos, stock, sales, seller_name, featured, created_at
      from market_products where seller_id = s.owner_id and status = 'ativo' and (store_id = s.id or store_id is null) order by featured desc, created_at desc limit 120) x));
end $$;

-- 6. RLS --------------------------------------------------------------------------------------------
alter table public.mkt_stores enable row level security;
alter table public.mkt_store_decisions enable row level security;
alter table public.mkt_product_variants enable row level security;
drop policy if exists mkt_stores_read on public.mkt_stores;
create policy mkt_stores_read on public.mkt_stores for select using (status = 'ativa' or owner_id = (select auth.uid()) or (select public.mkt__can('STORES_VIEW')));
drop policy if exists mkt_store_decisions_read on public.mkt_store_decisions;
create policy mkt_store_decisions_read on public.mkt_store_decisions for select using (
  exists (select 1 from public.mkt_stores s where s.id = store_id and s.owner_id = (select auth.uid())) or (select public.mkt__can('STORES_VIEW')));
drop policy if exists mkt_product_variants_read on public.mkt_product_variants;
create policy mkt_product_variants_read on public.mkt_product_variants for select using (
  exists (select 1 from public.market_products p where p.id = product_id and (p.status = 'ativo' or p.seller_id = (select auth.uid()))) or (select public.mkt__can('PRODUCTS_VIEW')));
revoke insert, update, delete, truncate on public.mkt_stores, public.mkt_store_decisions, public.mkt_product_variants from anon, authenticated;
grant select on public.mkt_stores, public.mkt_product_variants to anon, authenticated;
grant select on public.mkt_store_decisions to authenticated;

-- A política de leitura dos anúncios passa a incluir moderadores com PRODUCTS_VIEW (o resto fica igual)
drop policy if exists market_read on public.market_products;
create policy market_read on public.market_products for select using (status = 'ativo' or seller_id = (select auth.uid()) or (select public.is_admin()) or (select public.mkt__can('PRODUCTS_VIEW')));

revoke all on function public.mkt__can_sell(uuid), public.mkt__store_log(uuid, text, text, text, text), public.mkt__tg_product(), public.mkt__tg_product_after() from public, anon, authenticated;
revoke all on function public.mkt_store_save(jsonb), public.mkt_store_owner_action(text), public.mkt_admin_store_action(uuid, text, text),
  public.mkt_variant_save(uuid, uuid, text, integer, integer, boolean), public.mkt_product_duplicate(uuid), public.mkt_admin_product_action(uuid[], text, text) from public, anon;
grant execute on function public.mkt_store_save(jsonb), public.mkt_store_owner_action(text), public.mkt_admin_store_action(uuid, text, text),
  public.mkt_variant_save(uuid, uuid, text, integer, integer, boolean), public.mkt_product_duplicate(uuid), public.mkt_admin_product_action(uuid[], text, text) to authenticated;
grant execute on function public.mkt_search(text, text, text, text, text, integer, integer, integer, integer), public.mkt_suggest(text), public.mkt_related(uuid, integer),
  public.mkt_store_public(text), public.mkt_product_view(uuid), public.mkt__store_ok(uuid), public.mkt__own_media(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
