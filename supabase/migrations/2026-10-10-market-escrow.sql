-- =====================================================================
-- TXAPILOG · Marketplace completo — 2026-10-10. IDEMPOTENTE. Corre depois de 2026-10-10-tournaments-market.sql.
-- Anúncios (categoria, tipo, stock, entrega, preço em MZN/BRL/USD/ZAR convertido para MT), perguntas e respostas,
-- compra segura (valor retido até o comprador confirmar; disputas resolvidas pelo admin), avaliações e moderação.
-- Pagamento desligado até haver API M-Pesa/e-Mola: só o admin regista um pagamento já confirmado (com referência).
-- Taxas e prazos ficam NULL ("A definir") até o admin os definir.
-- =====================================================================

-- 1. Anúncios ---------------------------------------------------------------------------------
alter table public.market_products drop constraint if exists market_products_category_check;
alter table public.market_products drop constraint if exists market_products_game_key_check;
alter table public.market_products add constraint market_products_category_check check (category in ('ff','cr','ef','dls','fortnite','valorant','minecraft','cod','steam','giftcards','moedas','outros'));
alter table public.market_products alter column game_key drop not null;
alter table public.market_products add column if not exists kind text not null default 'itens';
alter table public.market_products drop constraint if exists market_products_kind_check;
alter table public.market_products add constraint market_products_kind_check check (kind in ('conta','itens','moedas','giftcard','servico'));
alter table public.market_products add column if not exists stock integer not null default 1;
alter table public.market_products add column if not exists delivery text not null default 'manual';
alter table public.market_products drop constraint if exists market_products_delivery_check;
alter table public.market_products add constraint market_products_delivery_check check (delivery in ('automatica','manual'));
alter table public.market_products add column if not exists price_currency text not null default 'MZN';
alter table public.market_products drop constraint if exists market_products_price_currency_check;
alter table public.market_products add constraint market_products_price_currency_check check (price_currency in ('MZN','BRL','USD','ZAR'));
alter table public.market_products add column if not exists price_original numeric(12,2) not null default 0;
alter table public.market_products add column if not exists fx_rate numeric(14,6) not null default 1;
alter table public.market_products add column if not exists featured boolean not null default false;
alter table public.market_products add column if not exists sales integer not null default 0;
alter table public.market_products drop constraint if exists market_products_stock_check;
alter table public.market_products add constraint market_products_stock_check check (stock >= 0 and stock <= 100000);
alter table public.market_products drop constraint if exists market_products_status_check;
alter table public.market_products add constraint market_products_status_check check (status in ('rascunho','ativo','removido'));
create index if not exists market_products_cat_idx on public.market_products (category, status, created_at desc);

-- Fotos: do próprio vendedor no bucket "media" ou arte oficial dos jogos do site ("art:<id>").
create or replace function public.market__tg_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from unnest(new.photos) p
    where p !~ '^art:[a-z0-9-]{2,12}$' and p !~ ('/storage/v1/object/public/media/products/' || new.seller_id::text || '/')) then
    raise exception 'PHOTOS';
  end if;
  if not public.is_admin() then
    if tg_op = 'UPDATE' then new.featured := old.featured; new.sales := old.sales;
      if old.status = 'removido' then new.status := 'removido'; end if;
    else new.featured := false; new.sales := 0; end if;
  end if;
  new.seller_name := coalesce((select display_name from profiles where id = new.seller_id), '');
  new.updated_at := now();
  return new;
end $$;

-- 2. Definições ---------------------------------------------------------------------------------
create table if not exists public.market_settings (
  id integer primary key default 1 check (id = 1),
  fee_pct numeric(5,2) check (fee_pct is null or (fee_pct >= 0 and fee_pct <= 50)),
  delivery_hours integer check (delivery_hours is null or delivery_hours between 1 and 720),
  auto_release_days integer check (auto_release_days is null or auto_release_days between 1 and 60),
  fx_override jsonb not null default '{}',
  rounding integer not null default 1 check (rounding in (1, 5, 10)),
  updated_at timestamptz not null default now()
);
insert into public.market_settings (id) values (1) on conflict (id) do nothing;

-- 3. Perguntas, pedidos, avaliações ------------------------------------------------------------
create table if not exists public.market_questions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.market_products(id) on delete cascade,
  asker_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  asker_name text not null default '',
  question text not null check (length(trim(question)) between 3 and 500),
  answer text check (answer is null or length(answer) <= 1000),
  answered_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists market_questions_product_idx on public.market_questions (product_id, created_at desc);

create table if not exists public.market_orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.market_products(id) on delete restrict,
  product_title text not null,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  qty integer not null check (qty between 1 and 100),
  unit_price_mzn integer not null check (unit_price_mzn > 0),
  total_mzn integer not null,
  fee_pct numeric(5,2),
  status text not null default 'aguarda_pagamento' check (status in ('aguarda_pagamento','pago','entregue','concluido','disputa','reembolsado','cancelado')),
  payment_ref text not null default '',
  delivery_note text not null default '',
  dispute_reason text not null default '',
  resolution text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz, delivered_at timestamptz, closed_at timestamptz
);
create index if not exists market_orders_buyer_idx on public.market_orders (buyer_id, created_at desc);
create index if not exists market_orders_seller_idx on public.market_orders (seller_id, created_at desc);
create index if not exists market_orders_status_idx on public.market_orders (status, created_at desc);

create table if not exists public.market_reviews (
  order_id uuid primary key references public.market_orders(id) on delete cascade,
  product_id uuid not null references public.market_products(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  buyer_name text not null default '',
  rating integer not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists market_reviews_seller_idx on public.market_reviews (seller_id, created_at desc);
create index if not exists market_reviews_recent_idx on public.market_reviews (created_at desc);

create or replace view public.market_seller_stats with (security_invoker = true) as
  select seller_id, round(avg(rating)::numeric, 1) as rating, count(*)::integer as reviews from public.market_reviews group by seller_id;

-- 4. Funções -------------------------------------------------------------------------------------
create or replace function public.market__log(p_action text, p_target text) returns void
language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, actor_handle, action, target) values (auth.uid(), (select handle from profiles where id = auth.uid()), 'marketplace:' || p_action, p_target) $$;

create or replace function public.market_ask(p_product uuid, p_question text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.is_active_user() then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if not exists (select 1 from market_products where id = p_product and status = 'ativo') then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if length(trim(coalesce(p_question, ''))) < 3 then return jsonb_build_object('ok', false, 'code', 'TEXT'); end if;
  if (select count(*) from market_questions where asker_id = uid and created_at > now() - interval '1 hour') >= 10 then return jsonb_build_object('ok', false, 'code', 'RATE'); end if;
  insert into market_questions (product_id, asker_id, asker_name, question) values (p_product, uid, coalesce((select display_name from profiles where id = uid), ''), trim(p_question));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.market_answer(p_question uuid, p_answer text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from market_questions q join market_products p on p.id = q.product_id where q.id = p_question and (p.seller_id = auth.uid() or public.is_admin())) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  update market_questions set answer = nullif(trim(coalesce(p_answer, '')), ''), answered_at = now() where id = p_question;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.market_order_create(p_product uuid, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p market_products; s market_settings; oid uuid;
begin
  if uid is null or not public.is_active_user() then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into p from market_products where id = p_product and status = 'ativo';
  if p.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if p.seller_id = uid then return jsonb_build_object('ok', false, 'code', 'OWN'); end if;
  if p.price_mzn <= 0 then return jsonb_build_object('ok', false, 'code', 'NO_PRICE'); end if;
  if p_qty is null or p_qty < 1 or p_qty > least(p.stock, 100) then return jsonb_build_object('ok', false, 'code', 'STOCK'); end if;
  select * into s from market_settings where id = 1;
  insert into market_orders (product_id, product_title, buyer_id, seller_id, qty, unit_price_mzn, total_mzn, fee_pct)
    values (p.id, p.title, uid, p.seller_id, p_qty, p.price_mzn, p.price_mzn * p_qty, s.fee_pct) returning id into oid;
  return jsonb_build_object('ok', true, 'order_id', oid);
end $$;

-- Máquina de estados da compra segura (igual a nextStatus em lib/market.ts)
create or replace function public.market_order_action(p_order uuid, p_action text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders; role text; nxt text; adm boolean := public.is_admin();
begin
  select * into o from market_orders where id = p_order for update;
  if o.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  role := case when auth.uid() = o.buyer_id then 'comprador' when auth.uid() = o.seller_id then 'vendedor' when adm then 'admin' else null end;
  if adm and p_action in ('confirmar_pagamento','reembolsar','liberar') then role := 'admin'; end if;
  if role is null then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  nxt := case
    when p_action = 'confirmar_pagamento' and o.status = 'aguarda_pagamento' and role = 'admin' then 'pago'
    when p_action = 'entregar' and o.status = 'pago' and role = 'vendedor' then 'entregue'
    when p_action = 'confirmar_rececao' and o.status = 'entregue' and role = 'comprador' then 'concluido'
    when p_action = 'abrir_disputa' and o.status in ('pago','entregue') and role = 'comprador' then 'disputa'
    when p_action = 'cancelar' and o.status = 'aguarda_pagamento' then 'cancelado'
    when p_action = 'reembolsar' and o.status in ('disputa','pago') and role = 'admin' then 'reembolsado'
    when p_action = 'liberar' and o.status = 'disputa' and role = 'admin' then 'concluido'
    else null end;
  if nxt is null then return jsonb_build_object('ok', false, 'code', 'STATE'); end if;
  if p_action = 'confirmar_pagamento' then
    if length(trim(coalesce(p_note, ''))) < 3 then return jsonb_build_object('ok', false, 'code', 'REF'); end if;
    update market_products set stock = stock - o.qty where id = o.product_id and stock >= o.qty;
    if not found then return jsonb_build_object('ok', false, 'code', 'STOCK'); end if;
  end if;
  if p_action = 'abrir_disputa' and length(trim(coalesce(p_note, ''))) < 5 then return jsonb_build_object('ok', false, 'code', 'REASON'); end if;
  update market_orders set status = nxt, updated_at = now(),
    payment_ref = case when p_action = 'confirmar_pagamento' then trim(p_note) else payment_ref end,
    paid_at = case when p_action = 'confirmar_pagamento' then now() else paid_at end,
    delivery_note = case when p_action = 'entregar' then coalesce(trim(p_note), '') else delivery_note end,
    delivered_at = case when p_action = 'entregar' then now() else delivered_at end,
    dispute_reason = case when p_action = 'abrir_disputa' then trim(p_note) else dispute_reason end,
    resolution = case when p_action in ('reembolsar','liberar') then coalesce(trim(p_note), '') else resolution end,
    closed_at = case when nxt in ('concluido','reembolsado','cancelado') then now() else closed_at end
  where id = p_order;
  if p_action = 'reembolsar' then update market_products set stock = stock + o.qty where id = o.product_id; end if;
  if nxt = 'concluido' then update market_products set sales = sales + o.qty where id = o.product_id; end if;
  if role = 'admin' then perform public.market__log('pedido_' || p_action, p_order::text); end if;
  return jsonb_build_object('ok', true, 'status', nxt);
end $$;

create or replace function public.market_review(p_order uuid, p_rating integer, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders;
begin
  select * into o from market_orders where id = p_order;
  if o.id is null or o.buyer_id <> auth.uid() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if o.status <> 'concluido' then return jsonb_build_object('ok', false, 'code', 'STATE'); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then return jsonb_build_object('ok', false, 'code', 'RATING'); end if;
  insert into market_reviews (order_id, product_id, seller_id, buyer_id, buyer_name, rating, comment)
    values (o.id, o.product_id, o.seller_id, o.buyer_id, coalesce((select display_name from profiles where id = o.buyer_id), ''), p_rating, left(coalesce(trim(p_comment), ''), 500))
    on conflict (order_id) do nothing;
  if not found then return jsonb_build_object('ok', false, 'code', 'ALREADY'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.market_admin_listings(p_ids uuid[], p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  update market_products set
    status = case p_action when 'publicar' then 'ativo' when 'rascunho' then 'rascunho' when 'remover' then 'removido' else status end,
    featured = case p_action when 'destacar' then true when 'nao_destacar' then false else featured end
  where id = any(p_ids);
  get diagnostics n = row_count;
  perform public.market__log('anuncios_' || p_action, n || ' anúncio(s)');
  return jsonb_build_object('ok', true, 'count', n);
end $$;

create or replace function public.market_admin_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  begin
    update market_settings set
      fee_pct = case when p ? 'fee_pct' then (p->>'fee_pct')::numeric else fee_pct end,
      delivery_hours = case when p ? 'delivery_hours' then (p->>'delivery_hours')::integer else delivery_hours end,
      auto_release_days = case when p ? 'auto_release_days' then (p->>'auto_release_days')::integer else auto_release_days end,
      fx_override = case when p ? 'fx_override' then p->'fx_override' else fx_override end,
      rounding = coalesce((p->>'rounding')::integer, rounding), updated_at = now()
    where id = 1;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end;
  perform public.market__log('definicoes', p::text);
  return jsonb_build_object('ok', true);
end $$;

-- 5. RLS -------------------------------------------------------------------------------------------
alter table public.market_settings enable row level security;
alter table public.market_questions enable row level security;
alter table public.market_orders enable row level security;
alter table public.market_reviews enable row level security;
drop policy if exists market_settings_read on public.market_settings;
create policy market_settings_read on public.market_settings for select using (true);
drop policy if exists market_questions_read on public.market_questions;
create policy market_questions_read on public.market_questions for select using (not hidden or (select public.is_admin()));
drop policy if exists market_orders_read on public.market_orders;
create policy market_orders_read on public.market_orders for select using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists market_reviews_read on public.market_reviews;
create policy market_reviews_read on public.market_reviews for select using (true);
revoke insert, update, delete, truncate on public.market_settings, public.market_questions, public.market_orders, public.market_reviews from anon, authenticated;
grant select on public.market_settings, public.market_questions, public.market_reviews, public.market_seller_stats to anon, authenticated;
grant select on public.market_orders to authenticated;

revoke all on function public.market__log(text, text) from public, anon, authenticated;
revoke all on function public.market_ask(uuid, text), public.market_answer(uuid, text), public.market_order_create(uuid, integer),
  public.market_order_action(uuid, text, text), public.market_review(uuid, integer, text), public.market_admin_listings(uuid[], text),
  public.market_admin_settings(jsonb) from public, anon;
grant execute on function public.market_ask(uuid, text), public.market_answer(uuid, text), public.market_order_create(uuid, integer),
  public.market_order_action(uuid, text, text), public.market_review(uuid, integer, text), public.market_admin_listings(uuid[], text),
  public.market_admin_settings(jsonb) to authenticated;

notify pgrst, 'reload schema';
