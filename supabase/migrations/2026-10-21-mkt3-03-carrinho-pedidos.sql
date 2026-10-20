-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 3/6 — Comissões (regras com instantâneo), cupões, carrinho, checkout e pedidos
-- (máquina de estados controlada + histórico imutável). IDEMPOTENTE.
-- Pedidos antigos (compra segura) continuam a funcionar com market_order_action: as colunas novas têm valores por
-- omissão e os estados novos são acrescentados ao conjunto existente. Pedidos novos têm v3 = true.
-- =====================================================================

do $$ begin
  if to_regclass('public.mkt_stores') is null then raise exception 'Corre primeiro a Parte 2 (lojas e produtos).'; end if;
end $$;

-- 1. Regras de comissão (nunca editadas: uma regra nova desativa a anterior; cada pedido guarda a regra usada) ------
create table if not exists public.mkt_commission_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','categoria','vendedor')),
  category text,
  seller_id uuid references public.profiles(id) on delete restrict,
  pct numeric(5,2) not null check (pct >= 0 and pct <= 50),
  fixed_mzn integer not null default 0 check (fixed_mzn between 0 and 100000),
  active boolean not null default true,
  note text not null default '' check (length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint mkt_commission_scope_ck check ((scope = 'global' and category is null and seller_id is null)
    or (scope = 'categoria' and category is not null and seller_id is null) or (scope = 'vendedor' and seller_id is not null and category is null))
);
create unique index if not exists mkt_commission_active_uq on public.mkt_commission_rules (scope, coalesce(category, ''), coalesce(seller_id, '00000000-0000-0000-0000-000000000000'::uuid)) where active;

create or replace function public.mkt__tg_rule_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE'; end if;
  if (to_jsonb(new) - 'active' - 'deactivated_at') is distinct from (to_jsonb(old) - 'active' - 'deactivated_at') or (old.active = false and new.active = true) then
    raise exception 'IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists mkt_commission_rules_guard on public.mkt_commission_rules;
create trigger mkt_commission_rules_guard before update or delete on public.mkt_commission_rules for each row execute function public.mkt__tg_rule_guard();

-- Regra aplicável: vendedor > categoria > global > taxa antiga do marketplace (market_settings.fee_pct). null = não definida.
create or replace function public.mkt__commission_for(p_seller uuid, p_category text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('rule_id', id, 'pct', pct, 'fixed', fixed_mzn, 'scope', scope) from mkt_commission_rules
      where active and ((scope = 'vendedor' and seller_id = p_seller) or (scope = 'categoria' and category = p_category) or scope = 'global')
      order by case scope when 'vendedor' then 1 when 'categoria' then 2 else 3 end limit 1),
    (select jsonb_build_object('rule_id', null, 'pct', fee_pct, 'fixed', 0, 'scope', 'market_settings') from market_settings where id = 1 and fee_pct is not null)) $$;

-- Cálculo verificável (inteiros em MT): comissão = arredondamento de (base × pct / 100) + fixa, nunca acima da base.
create or replace function public.mkt__commission_amount(p_base integer, p_pct numeric, p_fixed integer) returns integer language sql immutable as $$
  select least(greatest(p_base, 0), floor(greatest(p_base, 0) * coalesce(p_pct, 0) / 100 + 0.5)::integer + coalesce(p_fixed, 0)) $$;

create or replace function public.mkt_admin_commission_set(p_scope text, p_category text, p_seller uuid, p_pct numeric, p_fixed integer, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_r mkt_commission_rules; rid uuid;
begin
  if not public.mkt__can('SETTINGS_MANAGE') then return public.mkt__deny('SETTINGS_MANAGE', 'comissao_definir', coalesce(p_scope, '')); end if;
  select * into old_r from mkt_commission_rules where active and scope = p_scope and coalesce(category, '') = coalesce(p_category, '')
    and coalesce(seller_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_seller, '00000000-0000-0000-0000-000000000000'::uuid) for update;
  if old_r.id is not null then update mkt_commission_rules set active = false, deactivated_at = now() where id = old_r.id; end if;
  begin
    if p_pct is not null then
      insert into mkt_commission_rules (scope, category, seller_id, pct, fixed_mzn, note)
        values (p_scope, nullif(p_category, ''), p_seller, p_pct, coalesce(p_fixed, 0), coalesce(p_note, '')) returning id into rid;
    end if;
  exception when check_violation or not_null_violation then return public.mkt__err('INVALID');
  end;
  perform public.mkt__audit('comissao_definir', coalesce(p_scope, '') || ':' || coalesce(p_category, p_seller::text, '*'), 'ok', p_note,
    case when old_r.id is null then null else jsonb_build_object('pct', old_r.pct, 'fixed', old_r.fixed_mzn) end,
    case when p_pct is null then jsonb_build_object('removida', true) else jsonb_build_object('pct', p_pct, 'fixed', coalesce(p_fixed, 0)) end);
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

-- 2. Cupões (descontos autorizados pelo vendedor) ---------------------------------------------------------
create table if not exists public.mkt_coupons (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{4,16}$'),
  pct integer not null check (pct between 1 and 90),
  max_uses integer not null default 100 check (max_uses between 1 and 100000),
  used integer not null default 0 check (used >= 0),
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (seller_id, code)
);

create or replace function public.mkt_coupon_save(p_code text, p_pct integer, p_max integer, p_valid_until timestamptz, p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  if not public.mkt__can_sell(auth.uid()) then return public.mkt__err('NOT_SELLER'); end if;
  begin
    insert into mkt_coupons (seller_id, code, pct, max_uses, valid_until, active) values (auth.uid(), upper(trim(p_code)), p_pct, coalesce(p_max, 100), p_valid_until, coalesce(p_active, true))
      on conflict (seller_id, code) do update set pct = excluded.pct, max_uses = excluded.max_uses, valid_until = excluded.valid_until, active = excluded.active;
  exception when check_violation or not_null_violation then return public.mkt__err('INVALID');
  end;
  return jsonb_build_object('ok', true);
end $$;

-- 3. Pedidos: colunas novas (valores por omissão → pedidos antigos não mudam) e estados (superconjunto) -------------
alter table public.market_orders add column if not exists v3 boolean not null default false;
alter table public.market_orders add column if not exists checkout_id uuid;
alter table public.market_orders add column if not exists payment_id uuid;
alter table public.market_orders add column if not exists store_id uuid references public.mkt_stores(id) on delete set null;
alter table public.market_orders add column if not exists variant_id uuid references public.mkt_product_variants(id) on delete set null;
alter table public.market_orders add column if not exists variant_name text;
alter table public.market_orders add column if not exists kind text;
alter table public.market_orders add column if not exists physical boolean not null default false;
alter table public.market_orders add column if not exists items_mzn integer;
alter table public.market_orders add column if not exists discount_mzn integer not null default 0;
alter table public.market_orders add column if not exists shipping_mzn integer not null default 0;
alter table public.market_orders add column if not exists coupon_code text;
alter table public.market_orders add column if not exists commission_rule_id uuid references public.mkt_commission_rules(id) on delete restrict;
alter table public.market_orders add column if not exists commission_scope text;
alter table public.market_orders add column if not exists commission_pct numeric(5,2);
alter table public.market_orders add column if not exists commission_fixed_mzn integer;
alter table public.market_orders add column if not exists commission_mzn integer;
alter table public.market_orders add column if not exists seller_net_mzn integer;
alter table public.market_orders add column if not exists refunded_mzn integer not null default 0;
alter table public.market_orders add column if not exists settled_commission_mzn integer;
alter table public.market_orders add column if not exists settled_net_mzn integer;
alter table public.market_orders add column if not exists settled_at timestamptz;
alter table public.market_orders add column if not exists delivery jsonb;
alter table public.market_orders add column if not exists tracking_code text;
alter table public.market_orders add column if not exists carrier text;
alter table public.market_orders add column if not exists shipped_at timestamptz;
alter table public.market_orders add column if not exists service_due_at timestamptz;
alter table public.market_orders add column if not exists revision_count integer not null default 0;
alter table public.market_orders add column if not exists buyer_note text not null default '';
alter table public.market_orders add column if not exists expires_at timestamptz;
alter table public.market_orders add column if not exists cancel_reason text not null default '';
alter table public.market_orders drop constraint if exists market_orders_status_check;
alter table public.market_orders add constraint market_orders_status_check check (status in ('criado','aguarda_pagamento','pagamento_processamento','pago','em_preparacao',
  'enviado','em_execucao','entregue','concluido','cancelado','disputa','reembolsado','parcialmente_reembolsado'));
alter table public.market_orders drop constraint if exists market_orders_v3_money_check;
alter table public.market_orders add constraint market_orders_v3_money_check check (not v3 or (items_mzn is not null and commission_mzn is not null and seller_net_mzn is not null
  and total_mzn = items_mzn - discount_mzn + shipping_mzn and seller_net_mzn = total_mzn - commission_mzn and commission_mzn >= 0 and seller_net_mzn >= 0
  and discount_mzn >= 0 and discount_mzn <= items_mzn and shipping_mzn >= 0 and refunded_mzn between 0 and total_mzn));
create index if not exists market_orders_checkout_idx on public.market_orders (checkout_id) where checkout_id is not null;
create index if not exists market_orders_v3_status_idx on public.market_orders (v3, status, created_at desc);
create index if not exists market_orders_expires_idx on public.market_orders (expires_at) where status = 'aguarda_pagamento';

create table if not exists public.mkt_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.market_orders(id) on delete cascade,
  from_status text, to_status text not null,
  action text not null,
  actor_id uuid,
  actor_role text not null default 'sistema',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists mkt_order_events_order_idx on public.mkt_order_events (order_id, id);
drop trigger if exists mkt_order_events_immutable on public.mkt_order_events;
create trigger mkt_order_events_immutable before update or delete on public.mkt_order_events for each row execute function public.mkt__tg_immutable();

-- Grafo de estados dos pedidos v3 (igual a V3_EDGES em lib/mkt3.ts)
create or replace function public.mkt__edge_ok(p_from text, p_to text) returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('criado','aguarda_pagamento'), ('criado','cancelado'),
    ('aguarda_pagamento','pagamento_processamento'), ('aguarda_pagamento','pago'), ('aguarda_pagamento','cancelado'),
    ('pagamento_processamento','pago'), ('pagamento_processamento','aguarda_pagamento'), ('pagamento_processamento','cancelado'),
    ('pago','em_preparacao'), ('pago','em_execucao'), ('pago','enviado'), ('pago','entregue'), ('pago','disputa'), ('pago','reembolsado'), ('pago','parcialmente_reembolsado'),
    ('em_preparacao','enviado'), ('em_preparacao','em_execucao'), ('em_preparacao','entregue'), ('em_preparacao','disputa'), ('em_preparacao','reembolsado'), ('em_preparacao','parcialmente_reembolsado'),
    ('enviado','entregue'), ('enviado','concluido'), ('enviado','disputa'), ('enviado','reembolsado'), ('enviado','parcialmente_reembolsado'),
    ('em_execucao','entregue'), ('em_execucao','disputa'), ('em_execucao','reembolsado'), ('em_execucao','parcialmente_reembolsado'),
    ('entregue','concluido'), ('entregue','em_execucao'), ('entregue','disputa'), ('entregue','reembolsado'), ('entregue','parcialmente_reembolsado'),
    ('disputa','concluido'), ('disputa','reembolsado'), ('disputa','parcialmente_reembolsado')) $$;

-- Proteção no servidor: valores financeiros nunca mudam depois de criados; nos pedidos v3 o estado só muda pelas
-- funções do marketplace (contexto mkt.ctx) e só por transições válidas. Pedidos antigos mantêm as regras antigas.
create or replace function public.mkt__tg_order_guard() returns trigger language plpgsql as $$
begin
  if new.buyer_id is distinct from old.buyer_id or new.seller_id is distinct from old.seller_id or new.product_id is distinct from old.product_id
     or new.qty is distinct from old.qty or new.unit_price_mzn is distinct from old.unit_price_mzn or new.total_mzn is distinct from old.total_mzn
     or new.fee_pct is distinct from old.fee_pct or new.v3 is distinct from old.v3 or new.items_mzn is distinct from old.items_mzn
     or new.discount_mzn is distinct from old.discount_mzn or new.shipping_mzn is distinct from old.shipping_mzn
     or new.commission_rule_id is distinct from old.commission_rule_id or new.commission_pct is distinct from old.commission_pct
     or new.commission_fixed_mzn is distinct from old.commission_fixed_mzn or new.commission_mzn is distinct from old.commission_mzn
     or new.seller_net_mzn is distinct from old.seller_net_mzn or new.checkout_id is distinct from old.checkout_id or new.payment_id is distinct from old.payment_id then
    raise exception 'ORDER_MONEY_IMMUTABLE';
  end if;
  if old.v3 then
    if coalesce(current_setting('mkt.ctx', true), '') <> '1' then raise exception 'ORDER_LOCKED'; end if;
    if new.status is distinct from old.status and not public.mkt__edge_ok(old.status, new.status) then raise exception 'ORDER_TRANSITION'; end if;
    if new.refunded_mzn < old.refunded_mzn then raise exception 'ORDER_MONEY_IMMUTABLE'; end if;
  elsif new.status is distinct from old.status and new.status not in ('aguarda_pagamento','pago','entregue','concluido','disputa','reembolsado','cancelado') then
    raise exception 'ORDER_TRANSITION';
  end if;
  return new;
end $$;
drop trigger if exists market_orders_mkt3_guard on public.market_orders;
create trigger market_orders_mkt3_guard before update on public.market_orders for each row execute function public.mkt__tg_order_guard();

-- Mudança de estado interna (única porta para pedidos v3) + histórico
create or replace function public.mkt__set_status(p_order uuid, p_to text, p_action text, p_role text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare o market_orders;
begin
  select * into o from market_orders where id = p_order for update;
  if o.status = p_to then return; end if;
  if not public.mkt__edge_ok(o.status, p_to) then raise exception 'ORDER_TRANSITION'; end if;
  perform set_config('mkt.ctx', '1', true);
  update market_orders set status = p_to, updated_at = now(),
    paid_at = case when p_to = 'pago' then now() else paid_at end,
    delivered_at = case when p_to = 'entregue' then now() else delivered_at end,
    shipped_at = case when p_to = 'enviado' then now() else shipped_at end,
    closed_at = case when p_to in ('concluido','cancelado','reembolsado','parcialmente_reembolsado') then now() else closed_at end
  where id = p_order;
  insert into mkt_order_events (order_id, from_status, to_status, action, actor_id, actor_role, note)
    values (p_order, o.status, p_to, p_action, auth.uid(), coalesce(p_role, 'sistema'), left(coalesce(p_note, ''), 500));
  perform set_config('mkt.ctx', '', true);
end $$;

-- Liberta a reserva de stock de um pedido não pago (cancelado/expirado)
create or replace function public.mkt__release_stock(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o market_orders;
begin
  select * into o from market_orders where id = p_order;
  perform set_config('mkt.sys', '1', true);
  if o.variant_id is not null then update mkt_product_variants set stock = stock + o.qty, updated_at = now() where id = o.variant_id;
  elsif o.kind is distinct from 'servico' then update market_products set stock = least(stock + o.qty, 100000) where id = o.product_id; end if;
end $$;

-- 4. Carrinho (guardado no servidor: recupera-se em qualquer dispositivo depois de entrar) --------------------------
create table if not exists public.mkt_cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.market_products(id) on delete cascade,
  variant_id uuid references public.mkt_product_variants(id) on delete cascade,
  qty integer not null check (qty between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists mkt_cart_items_uq on public.mkt_cart_items (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function public.mkt_cart_set(p_product uuid, p_variant uuid, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p market_products; v mkt_product_variants; avail integer;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if not public.mkt__open() then return public.mkt__err('MKT3_OFF'); end if;
  if not public.mkt__rate('cart:' || uid, 120, 600) then return public.mkt__err('RATE'); end if;
  if coalesce(p_qty, 0) <= 0 then
    delete from mkt_cart_items where user_id = uid and product_id = p_product and variant_id is not distinct from p_variant;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;
  select * into p from market_products where id = p_product and status = 'ativo' and public.mkt__store_ok(store_id);
  if p.id is null then return public.mkt__err('NOT_FOUND'); end if;
  if p.seller_id = uid then return public.mkt__err('OWN'); end if;
  if p_variant is not null then
    select * into v from mkt_product_variants where id = p_variant and product_id = p.id and active;
    if v.id is null then return public.mkt__err('VARIANT'); end if;
    avail := v.stock;
  else
    if exists (select 1 from mkt_product_variants where product_id = p.id and active) then return public.mkt__err('VARIANT_REQUIRED'); end if;
    if p.price_mzn <= 0 then return public.mkt__err('NO_PRICE'); end if;
    avail := case when p.kind = 'servico' then 100 else p.stock end;
  end if;
  if p_qty > least(avail, 100) then return public.mkt__err('STOCK', jsonb_build_object('available', avail)); end if;
  if (select count(*) from mkt_cart_items where user_id = uid) >= 50
     and not exists (select 1 from mkt_cart_items where user_id = uid and product_id = p.id and variant_id is not distinct from p_variant) then return public.mkt__err('CART_FULL'); end if;
  insert into mkt_cart_items (user_id, product_id, variant_id, qty) values (uid, p.id, p_variant, p_qty)
    on conflict (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set qty = excluded.qty, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Cálculo do carrinho NO SERVIDOR: preços, stock, portes e descontos atuais (o navegador nunca envia preços).
create or replace function public.mkt__cart_lines(p_user uuid, p_coupons text[]) returns table (
  cart_id uuid, product_id uuid, variant_id uuid, variant_name text, title text, photo text, seller_id uuid, seller_name text, store_id uuid, category text, kind text,
  physical boolean, qty integer, unit_mzn integer, items_mzn integer, discount_mzn integer, coupon text, shipping_mzn integer, total_mzn integer, available integer, issue text, lead_time_days integer)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with base as (
    select c.id as cart_id, p.id as product_id, v.id as variant_id, v.name as variant_name, p.title, p.photos[1] as photo, p.seller_id, p.seller_name, p.store_id, p.category, p.kind,
      (p.condition in ('novo','usado')) as physical, c.qty,
      coalesce(v.price_mzn, p.price_mzn) as unit_mzn,
      case when c.variant_id is not null then coalesce(v.stock, 0) when p.kind = 'servico' then 100 else p.stock end as available,
      case when p.id is null or p.status <> 'ativo' or not public.mkt__store_ok(p.store_id) then 'INDISPONIVEL'
           when c.variant_id is not null and (v.id is null or not v.active) then 'INDISPONIVEL'
           when c.variant_id is null and exists (select 1 from mkt_product_variants x where x.product_id = p.id and x.active) then 'VARIANT_REQUIRED'
           when coalesce(v.price_mzn, p.price_mzn) <= 0 then 'NO_PRICE'
           when c.qty > (case when c.variant_id is not null then coalesce(v.stock, 0) when p.kind = 'servico' then 100 else p.stock end) then 'STOCK'
           when p.seller_id = p_user then 'OWN'
           else null end as issue,
      p.shipping_mzn as ship, p.lead_time_days
    from mkt_cart_items c join market_products p on p.id = c.product_id left join mkt_product_variants v on v.id = c.variant_id
    where c.user_id = p_user
  ), cp as (
    select b.cart_id, (select k.code from mkt_coupons k where k.seller_id = b.seller_id and k.active and k.used < k.max_uses and (k.valid_until is null or k.valid_until > now())
                        and k.code = any(array(select upper(trim(x)) from unnest(coalesce(p_coupons, '{}'::text[])) x)) order by k.pct desc limit 1) as code
    from base b
  )
  select b.cart_id, b.product_id, b.variant_id, b.variant_name, b.title, b.photo, b.seller_id, b.seller_name, b.store_id, b.category, b.kind, b.physical, b.qty, b.unit_mzn,
    b.unit_mzn * b.qty,
    coalesce(floor(b.unit_mzn * b.qty * (select k.pct from mkt_coupons k where k.seller_id = b.seller_id and k.code = cp.code) / 100.0)::integer, 0),
    cp.code,
    case when b.physical then b.ship else 0 end,
    b.unit_mzn * b.qty - coalesce(floor(b.unit_mzn * b.qty * (select k.pct from mkt_coupons k where k.seller_id = b.seller_id and k.code = cp.code) / 100.0)::integer, 0) + case when b.physical then b.ship else 0 end,
    b.available, b.issue, b.lead_time_days
  from base b join cp on cp.cart_id = b.cart_id;
end $$;

create or replace function public.mkt_cart_view(p_coupons text[] default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); lines jsonb; agg record;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.seller_name, l.title), '[]') into lines from public.mkt__cart_lines(uid, (select array_agg(upper(trim(x))) from unnest(coalesce(p_coupons, '{}')) x)) l;
  select coalesce(sum(items_mzn), 0)::integer as items, coalesce(sum(discount_mzn), 0)::integer as disc, coalesce(sum(shipping_mzn), 0)::integer as ship,
         coalesce(sum(total_mzn), 0)::integer as total, count(*) filter (where issue is not null) as issues, bool_or(physical) as physical
    into agg from public.mkt__cart_lines(uid, (select array_agg(upper(trim(x))) from unnest(coalesce(p_coupons, '{}')) x));
  return jsonb_build_object('ok', true, 'lines', lines, 'items_mzn', agg.items, 'discount_mzn', agg.disc, 'shipping_mzn', agg.ship, 'tax_mzn', 0,
    'total_mzn', agg.total, 'issues', agg.issues, 'needs_address', coalesce(agg.physical, false), 'currency', 'MZN',
    'checkout_enabled', public.mkt__flag('mkt3_checkout_enabled'), 'wallet_balance', public.bets__balance_mt(uid));
end $$;

-- 5. Checkout: recalcula tudo, reserva stock, cria os pedidos (um por linha) e o pagamento. Idempotente.
create or replace function public.mkt_checkout(p_idem text, p_delivery jsonb default '{}', p_coupons text[] default '{}', p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); prev jsonb; l record; ck uuid := gen_random_uuid(); pay_id uuid := gen_random_uuid(); oid uuid; n integer := 0; tot integer := 0;
  rule jsonb; comm integer; d jsonb := coalesce(p_delivery, '{}'); needs_addr boolean; r jsonb; ph text; due timestamptz;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if p_idem is null or length(p_idem) < 16 or length(p_idem) > 80 then return public.mkt__err('IDEMPOTENCY'); end if;
  prev := public.mkt__idem_get('checkout:' || p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  if not public.mkt__open() then return public.mkt__err('MKT3_OFF'); end if;
  if not public.is_active_user() then return public.mkt__err('ACCOUNT'); end if;
  -- Sem pagamento disponível não se cria nada (nem reserva de stock)
  if not public.mkt__flag('mkt3_checkout_enabled') then return public.mkt__err('PAYMENT_UNAVAILABLE'); end if;
  if not public.mkt__rate('checkout:' || uid, 10, 3600) then perform public.mkt__risk(uid, 'checkout_rate', '', 40); return public.mkt__err('RATE'); end if;
  perform public.mkt_sweep_expired(uid);
  perform pg_advisory_xact_lock(hashtextextended('mkt-checkout:' || uid::text, 0));
  if not exists (select 1 from mkt_cart_items where user_id = uid) then return public.mkt__err('EMPTY'); end if;
  if exists (select 1 from public.mkt__cart_lines(uid, p_coupons) where issue is not null) then return public.mkt__err('CART_ISSUES'); end if;
  select bool_or(physical) into needs_addr from public.mkt__cart_lines(uid, p_coupons);
  if needs_addr then
    ph := regexp_replace(regexp_replace(coalesce(d->>'phone', ''), '[\s-]', '', 'g'), '^\+?258', '');
    if length(trim(coalesce(d->>'name', ''))) < 2 or length(trim(coalesce(d->>'address', ''))) < 5 or length(trim(coalesce(d->>'city', ''))) < 2 or ph !~ '^8[2-7][0-9]{7}$' then
      return public.mkt__err('ADDRESS');
    end if;
    d := jsonb_build_object('name', left(trim(d->>'name'), 80), 'phone', ph, 'address', left(trim(d->>'address'), 200), 'city', left(trim(d->>'city'), 60), 'notes', left(coalesce(d->>'notes', ''), 300));
  else
    d := jsonb_build_object('notes', left(coalesce(d->>'notes', ''), 300), 'service_date', d->>'service_date');
  end if;
  for l in select * from public.mkt__cart_lines(uid, p_coupons) loop
    rule := public.mkt__commission_for(l.seller_id, l.category);
    if rule is null then return public.mkt__err('COMMISSION_UNDEFINED'); end if;
    comm := public.mkt__commission_amount(l.items_mzn - l.discount_mzn, (rule->>'pct')::numeric, (rule->>'fixed')::integer);
    -- reserva de stock (falha se outro comprador levou entretanto)
    perform set_config('mkt.sys', '1', true);
    if l.variant_id is not null then
      update mkt_product_variants set stock = stock - l.qty, updated_at = now() where id = l.variant_id and stock >= l.qty;
      if not found then raise exception 'STOCK'; end if;
    elsif l.kind <> 'servico' then
      update market_products set stock = stock - l.qty where id = l.product_id and stock >= l.qty;
      if not found then raise exception 'STOCK'; end if;
    end if;
    due := case when l.kind <> 'servico' then null
                when coalesce(d->>'service_date', '') ~ '^\d{4}-\d{2}-\d{2}$' and (d->>'service_date')::date between current_date and current_date + 365 then (d->>'service_date')::date + time '12:00'
                else now() + make_interval(days => coalesce(l.lead_time_days, 7)) end;
    insert into market_orders (product_id, product_title, buyer_id, seller_id, qty, unit_price_mzn, total_mzn, fee_pct, status, v3, checkout_id, payment_id, store_id,
      variant_id, variant_name, kind, physical, items_mzn, discount_mzn, shipping_mzn, coupon_code, commission_rule_id, commission_scope, commission_pct, commission_fixed_mzn,
      commission_mzn, seller_net_mzn, delivery, service_due_at, buyer_note, expires_at)
    values (l.product_id, l.title || coalesce(' · ' || l.variant_name, ''), uid, l.seller_id, l.qty, l.unit_mzn, l.total_mzn, (rule->>'pct')::numeric, 'criado', true, ck, pay_id, l.store_id,
      l.variant_id, l.variant_name, l.kind, l.physical, l.items_mzn, l.discount_mzn, l.shipping_mzn, l.coupon, (rule->>'rule_id')::uuid, rule->>'scope', (rule->>'pct')::numeric,
      (rule->>'fixed')::integer, comm, l.total_mzn - comm, case when l.physical then d else d - 'name' - 'phone' - 'address' - 'city' end, due, left(coalesce(p_note, ''), 500),
      now() + interval '30 minutes')
    returning id into oid;
    insert into mkt_order_events (order_id, from_status, to_status, action, actor_id, actor_role) values (oid, null, 'criado', 'checkout', uid, 'comprador');
    perform public.mkt__set_status(oid, 'aguarda_pagamento', 'checkout', 'sistema', '');
    if l.coupon is not null then update mkt_coupons set used = used + 1 where seller_id = l.seller_id and code = l.coupon; end if;
    n := n + 1; tot := tot + l.total_mzn;
  end loop;
  insert into mkt_payments (id, checkout_id, buyer_id, amount_mzn, status, idempotency_key, expires_at) values (pay_id, ck, uid, tot, 'criado', 'checkout:' || p_idem, now() + interval '30 minutes');
  perform public.mkt__payment_status(pay_id, 'pendente', 'checkout', '{}');
  delete from mkt_cart_items where user_id = uid;
  r := jsonb_build_object('ok', true, 'checkout_id', ck, 'payment_id', pay_id, 'orders', n, 'total_mzn', tot);
  return public.mkt__idem_put('checkout:' || p_idem, 'checkout', r);
exception when raise_exception then
  if sqlerrm = 'STOCK' then return public.mkt__err('STOCK'); end if;
  raise;
end $$;

-- 6. Ações sobre pedidos v3 (vendedor e comprador). O que mexe em dinheiro passa pelas funções da Parte 4.
create or replace function public.mkt_order_action(p_order uuid, p_action text, p_note text default '', p_extra jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders; who text; nxt text; note text := left(trim(coalesce(p_note, '')), 1000); r jsonb;
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  select * into o from market_orders where id = p_order for update;
  if o.id is null or not o.v3 then return public.mkt__err('NOT_FOUND'); end if;
  who := case when auth.uid() = o.buyer_id then 'comprador' when auth.uid() = o.seller_id then 'vendedor' else null end;
  if who is null then return public.mkt__deny('ORDERS_VIEW', 'pedido_' || coalesce(p_action, ''), p_order::text); end if;
  if not public.mkt__rate('order_action:' || auth.uid(), 60, 600) then return public.mkt__err('RATE'); end if;

  if who = 'vendedor' then
    nxt := case
      when p_action = 'preparar' and o.status = 'pago' and o.kind <> 'servico' then 'em_preparacao'
      when p_action = 'enviar' and o.status in ('pago','em_preparacao') and o.physical then 'enviado'
      when p_action = 'iniciar' and o.status in ('pago','em_preparacao') and o.kind = 'servico' then 'em_execucao'
      when p_action = 'entregar' and o.status in ('pago','em_preparacao','em_execucao') and not o.physical then 'entregue'
      when p_action = 'entregar' and o.status = 'enviado' and o.physical then 'entregue'
      when p_action = 'cancelar_venda' and o.status in ('pago','em_preparacao','em_execucao') then 'reembolsado'
      else null end;
  else
    nxt := case
      when p_action = 'confirmar' and o.status in ('enviado','entregue') then 'concluido'
      when p_action = 'pedir_revisao' and o.status = 'entregue' and o.kind = 'servico' then 'em_execucao'
      when p_action = 'cancelar' and o.status in ('criado','aguarda_pagamento') then 'cancelado'
      else null end;
  end if;
  if nxt is null then return public.mkt__err('STATE'); end if;

  if p_action = 'enviar' then
    if length(trim(coalesce(p_extra->>'carrier', ''))) < 2 then return public.mkt__err('CARRIER'); end if;
    perform set_config('mkt.ctx', '1', true);
    update market_orders set carrier = left(trim(p_extra->>'carrier'), 60), tracking_code = nullif(left(trim(coalesce(p_extra->>'tracking', '')), 60), '') where id = o.id;
  elsif p_action = 'entregar' then
    -- Entrega só fica registada com evidência (nota de entrega / resultado / comprovativo)
    if length(note) < 5 then return public.mkt__err('EVIDENCE'); end if;
    perform set_config('mkt.ctx', '1', true);
    update market_orders set delivery_note = note where id = o.id;
  elsif p_action = 'pedir_revisao' then
    if length(note) < 5 then return public.mkt__err('REASON'); end if;
    if o.revision_count >= 3 then return public.mkt__err('REVISIONS'); end if;
    perform set_config('mkt.ctx', '1', true);
    update market_orders set revision_count = revision_count + 1 where id = o.id;
  elsif p_action in ('cancelar','cancelar_venda') then
    if p_action = 'cancelar_venda' and length(note) < 5 then return public.mkt__err('REASON'); end if;
    perform set_config('mkt.ctx', '1', true);
    update market_orders set cancel_reason = coalesce(nullif(note, ''), 'cancelado pelo ' || who) where id = o.id;
  end if;

  if p_action = 'confirmar' then
    r := public.mkt__complete_order(o.id, 'comprador', 'confirmar', note);
    if not (r->>'ok')::boolean then return r; end if;
  elsif p_action = 'cancelar_venda' then
    r := public.mkt__refund_order(o.id, o.total_mzn - o.refunded_mzn, 'vendedor', 'Venda cancelada pelo vendedor: ' || note);
    if not (r->>'ok')::boolean then return r; end if;
  elsif p_action = 'cancelar' then
    perform public.mkt__set_status(o.id, 'cancelado', 'cancelar', who, note);
    perform public.mkt__release_stock(o.id);
    perform public.mkt__payment_after_order_change(o.payment_id);
  else
    perform public.mkt__set_status(o.id, nxt, p_action, who, note);
  end if;

  perform public.mkt__notify(case when who = 'vendedor' then o.buyer_id else o.seller_id end,
    case when nxt = 'concluido' then 'pedido_concluido' when nxt in ('cancelado','reembolsado') then 'pedido_cancelado' else 'pedido_atualizado' end,
    '"' || left(o.product_title, 60) || '": ' || public.mkt__status_label(nxt), '/marketplace/pedido/?id=' || o.id, 'order:' || o.id || ':' || nxt || ':' || o.revision_count);
  return jsonb_build_object('ok', true, 'status', nxt);
end $$;

create or replace function public.mkt__status_label(p text) returns text language sql immutable as $$
  select case p when 'criado' then 'Criado' when 'aguarda_pagamento' then 'Aguardando pagamento' when 'pagamento_processamento' then 'Pagamento em processamento'
    when 'pago' then 'Pago' when 'em_preparacao' then 'Em preparação' when 'enviado' then 'Enviado' when 'em_execucao' then 'Em execução'
    when 'entregue' then 'Entregue · a aguardar confirmação' when 'concluido' then 'Concluído' when 'cancelado' then 'Cancelado' when 'disputa' then 'Em disputa'
    when 'reembolsado' then 'Reembolsado' when 'parcialmente_reembolsado' then 'Parcialmente reembolsado' else p end $$;

-- Detalhe de um pedido (comprador, vendedor ou staff com ORDERS_VIEW)
create or replace function public.mkt_order_get(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o market_orders; who text;
begin
  select * into o from market_orders where id = p_order;
  if o.id is null then return public.mkt__err('NOT_FOUND'); end if;
  who := case when auth.uid() = o.buyer_id then 'comprador' when auth.uid() = o.seller_id then 'vendedor' when public.mkt__can('ORDERS_VIEW') then 'staff' else null end;
  if who is null then return public.mkt__err('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'role', who,
    'order', to_jsonb(o) - case when who = 'comprador' then array['commission_rule_id','commission_scope','commission_pct','commission_fixed_mzn','commission_mzn','seller_net_mzn','settled_commission_mzn','settled_net_mzn']
                                else array[]::text[] end,
    'buyer', (select jsonb_build_object('handle', handle, 'display_name', display_name) from profiles where id = o.buyer_id),
    'seller', (select jsonb_build_object('handle', handle, 'display_name', display_name) from profiles where id = o.seller_id),
    'store', (select jsonb_build_object('slug', slug, 'name', name) from mkt_stores where id = o.store_id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('from', from_status, 'to', to_status, 'action', action, 'role', actor_role, 'note', note, 'at', created_at) order by id), '[]')
               from mkt_order_events where order_id = o.id),
    'payment', (select jsonb_build_object('id', id, 'status', status, 'amount_mzn', amount_mzn, 'method', method, 'expires_at', expires_at, 'confirmed_at', confirmed_at)
                from mkt_payments where id = o.payment_id and (who <> 'vendedor' or status in ('confirmado','reembolsado','parcialmente_reembolsado'))));
end $$;

-- Lista paginada dos meus pedidos (compras ou vendas)
create or replace function public.mkt_orders_mine(p_side text default 'compras', p_status text default null, p_page integer default 1) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(x) from (
    select o.id, o.product_id, o.product_title, o.qty, o.total_mzn, o.status, o.v3, o.created_at, o.updated_at, o.checkout_id, o.payment_id, o.kind,
      case when p_side = 'vendas' then o.seller_net_mzn end as seller_net_mzn,
      (select handle from profiles where id = case when p_side = 'vendas' then o.buyer_id else o.seller_id end) as other_handle
    from market_orders o
    where o.v3 and auth.uid() is not null and ((p_side = 'vendas' and o.seller_id = auth.uid()) or (p_side <> 'vendas' and o.buyer_id = auth.uid()))
      and (p_status is null or o.status = p_status)
    order by o.created_at desc limit 30 offset (greatest(coalesce(p_page, 1), 1) - 1) * 30) x), '[]')) $$;

-- 7. RLS -------------------------------------------------------------------------------------------
alter table public.mkt_commission_rules enable row level security;
alter table public.mkt_coupons enable row level security;
alter table public.mkt_order_events enable row level security;
alter table public.mkt_cart_items enable row level security;
drop policy if exists mkt_commission_rules_read on public.mkt_commission_rules;
create policy mkt_commission_rules_read on public.mkt_commission_rules for select using (seller_id is null or seller_id = (select auth.uid()) or (select public.mkt__can('SETTINGS_MANAGE')));
drop policy if exists mkt_coupons_read on public.mkt_coupons;
create policy mkt_coupons_read on public.mkt_coupons for select using (seller_id = (select auth.uid()) or (select public.mkt__can('ORDERS_VIEW')));
drop policy if exists mkt_order_events_read on public.mkt_order_events;
create policy mkt_order_events_read on public.mkt_order_events for select using (
  exists (select 1 from public.market_orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid()))) or (select public.mkt__can('ORDERS_VIEW')));
drop policy if exists mkt_cart_items_read on public.mkt_cart_items;
create policy mkt_cart_items_read on public.mkt_cart_items for select using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.mkt_commission_rules, public.mkt_coupons, public.mkt_order_events, public.mkt_cart_items from anon, authenticated;
revoke all on public.mkt_commission_rules, public.mkt_coupons, public.mkt_order_events, public.mkt_cart_items from anon;
grant select on public.mkt_commission_rules, public.mkt_coupons, public.mkt_order_events, public.mkt_cart_items to authenticated;

-- Leitura dos pedidos: comprador, vendedor, admin e staff com ORDERS_VIEW
drop policy if exists market_orders_read on public.market_orders;
create policy market_orders_read on public.market_orders for select using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select public.is_admin()) or (select public.mkt__can('ORDERS_VIEW')));

revoke all on function public.mkt__commission_for(uuid, text), public.mkt__set_status(uuid, text, text, text, text), public.mkt__release_stock(uuid),
  public.mkt__cart_lines(uuid, text[]) from public, anon, authenticated;
revoke all on function public.mkt_admin_commission_set(text, text, uuid, numeric, integer, text), public.mkt_coupon_save(text, integer, integer, timestamptz, boolean),
  public.mkt_cart_set(uuid, uuid, integer), public.mkt_cart_view(text[]), public.mkt_checkout(text, jsonb, text[], text), public.mkt_order_action(uuid, text, text, jsonb),
  public.mkt_order_get(uuid), public.mkt_orders_mine(text, text, integer) from public, anon;
grant execute on function public.mkt_admin_commission_set(text, text, uuid, numeric, integer, text), public.mkt_coupon_save(text, integer, integer, timestamptz, boolean),
  public.mkt_cart_set(uuid, uuid, integer), public.mkt_cart_view(text[]), public.mkt_checkout(text, jsonb, text[], text), public.mkt_order_action(uuid, text, text, jsonb),
  public.mkt_order_get(uuid), public.mkt_orders_mine(text, text, integer) to authenticated;
grant execute on function public.mkt__commission_amount(integer, numeric, integer), public.mkt__edge_ok(text, text), public.mkt__status_label(text) to anon, authenticated;

notify pgrst, 'reload schema';
