-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 8 — Equipa da loja (vários membros). 2026-10-21. IDEMPOTENTE. ADITIVO.
--
-- O dono da loja convida/remove membros pelo @utilizador, com uma função:
--   gestor       produtos da loja (editar dados, preço, stock, publicar/arquivar, variantes) + pedidos da loja
--                (ver e avançar: preparar, enviar, iniciar, entregar) + mensagens dos pedidos da loja
--   atendimento  ver pedidos da loja + mensagens dos pedidos da loja (sem mexer em produtos nem em estados)
-- Nunca: dinheiro (pagamentos ao vendedor, finanças, cancelar/reembolsar venda), dados da loja, equipa, cupões.
-- Tudo verificado no servidor (funções SECURITY DEFINER + RLS) e registado na auditoria (área marketplace).
-- =====================================================================

do $$ begin
  if to_regclass('public.mkt_order_messages') is null or to_regprocedure('public.mkt_order_action(uuid,text,text,jsonb)') is null then
    raise exception 'Corre primeiro as Partes 1–6 do Marketplace 3.0.';
  end if;
end $$;

-- 1. Membros ---------------------------------------------------------------------------------------------------
create table if not exists public.mkt_store_members (
  store_id uuid not null references public.mkt_stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('gestor','atendimento')),
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index if not exists mkt_store_members_user_idx on public.mkt_store_members (user_id);

-- Função do utilizador atual numa loja: 'dono' | 'gestor' | 'atendimento' | null (contas banidas/apagadas: null)
create or replace function public.mkt__store_role(p_store uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_store is null then null
    when not exists (select 1 from profiles where id = auth.uid() and not banned and deleted_at is null) then null
    when exists (select 1 from mkt_stores where id = p_store and owner_id = auth.uid()) then 'dono'
    else (select m.role from mkt_store_members m join mkt_stores s on s.id = m.store_id
          where m.store_id = p_store and m.user_id = auth.uid() and s.status in ('configuracao','pendente','ativa')) end $$;

-- É membro (gestor/atendimento) da loja? (para RLS; o dono já tem as regras antigas)
create or replace function public.mkt__store_member(p_store uuid, p_roles text[] default array['gestor','atendimento']) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mkt__store_role(p_store) = any(p_roles), false) $$;

-- 2. Gestão da equipa (só o dono; o admin com STORES_VIEW pode ver) ----------------------------------------------
create or replace function public.mkt_store_team(p_store uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st mkt_stores; my text;
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  if p_store is null then select * into st from mkt_stores where owner_id = auth.uid();
  else select * into st from mkt_stores where id = p_store; end if;
  if st.id is null then return public.mkt__err('NOT_FOUND'); end if;
  my := public.mkt__store_role(st.id);
  if my is null and not public.mkt__can('STORES_VIEW') then return public.mkt__err('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'store_id', st.id, 'store_name', st.name, 'my_role', coalesce(my, 'staff'),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'handle', p.handle, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
        'role', m.role, 'since', m.created_at) order by m.created_at), '[]') from mkt_store_members m join profiles p on p.id = m.user_id where m.store_id = st.id));
end $$;

-- Adicionar ou mudar a função de um membro pelo @utilizador
create or replace function public.mkt_store_member_set(p_handle text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st mkt_stores; target profiles; prev text; h text := lower(regexp_replace(trim(coalesce(p_handle, '')), '^@', ''));
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  select * into st from mkt_stores where owner_id = auth.uid() for update;
  if st.id is null then return public.mkt__deny('STORE_OWNER', 'loja_equipa_adicionar', h); end if;
  if st.status not in ('configuracao','pendente','ativa') then return public.mkt__err('STORE_SUSPENDED'); end if;
  if p_role not in ('gestor','atendimento') then return public.mkt__err('INVALID'); end if;
  if not public.mkt__rate('team:' || auth.uid(), 30, 3600) then return public.mkt__err('RATE'); end if;
  select * into target from profiles where lower(handle) = h and deleted_at is null;
  if target.id is null then return public.mkt__err('USER_NOT_FOUND'); end if;
  if target.id = auth.uid() then return public.mkt__err('SELF'); end if;
  if target.banned then return public.mkt__err('ACCOUNT'); end if;
  select role into prev from mkt_store_members where store_id = st.id and user_id = target.id;
  if prev is null and (select count(*) from mkt_store_members where store_id = st.id) >= 10 then return public.mkt__err('LIMIT'); end if;
  if prev = p_role then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  insert into mkt_store_members (store_id, user_id, role, added_by) values (st.id, target.id, p_role, auth.uid())
    on conflict (store_id, user_id) do update set role = excluded.role, updated_at = now();
  perform public.mkt__audit(case when prev is null then 'loja_equipa_adicionar' else 'loja_equipa_funcao' end, st.id::text, 'ok', null,
    case when prev is null then null else jsonb_build_object('user', target.handle, 'role', prev) end, jsonb_build_object('user', target.handle, 'role', p_role));
  perform public.mkt__notify(target.id, 'conta', case when prev is null then 'Foste adicionado à equipa da loja "' || st.name || '" como ' else 'A tua função na loja "' || st.name || '" passou a ' end
    || case p_role when 'gestor' then 'gestor(a).' else 'atendimento.' end, '/marketplace/criador', 'team:' || st.id || ':' || target.id || ':' || p_role || ':' || extract(epoch from now())::bigint);
  return jsonb_build_object('ok', true, 'user_id', target.id, 'role', p_role);
end $$;

-- Remover: o dono remove qualquer membro; um membro pode sair da equipa
create or replace function public.mkt_store_member_remove(p_store uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st mkt_stores; m mkt_store_members; h text;
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  select * into st from mkt_stores where id = coalesce(p_store, (select id from mkt_stores where owner_id = auth.uid()));
  if st.id is null then return public.mkt__err('NOT_FOUND'); end if;
  if st.owner_id <> auth.uid() and p_user is distinct from auth.uid() then return public.mkt__deny('STORE_OWNER', 'loja_equipa_remover', st.id::text); end if;
  delete from mkt_store_members where store_id = st.id and user_id = p_user returning * into m;
  if m.user_id is null then return public.mkt__err('NOT_FOUND'); end if;
  select handle into h from profiles where id = p_user;
  perform public.mkt__audit(case when p_user = auth.uid() and st.owner_id <> auth.uid() then 'loja_equipa_sair' else 'loja_equipa_remover' end, st.id::text, 'ok', null,
    jsonb_build_object('user', h, 'role', m.role), null);
  if p_user <> auth.uid() then
    perform public.mkt__notify(p_user, 'conta', 'Deixaste de fazer parte da equipa da loja "' || st.name || '".', '/marketplace', 'team-out:' || st.id || ':' || p_user || ':' || extract(epoch from now())::bigint);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 3. Lojas onde sou membro (painel da equipa) ------------------------------------------------------------------
create or replace function public.mkt_team_stores() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(jsonb_build_object('store_id', s.id, 'slug', s.slug, 'name', s.name, 'logo_url', s.logo_url,
      'status', s.status, 'role', m.role, 'owner_handle', (select handle from profiles where id = s.owner_id),
      'products', case when m.role = 'gestor' then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'price_mzn', p.price_mzn, 'stock', p.stock,
          'status', p.status, 'kind', p.kind, 'description', p.description, 'delivery_info', p.delivery_info, 'low_stock_threshold', p.low_stock_threshold) order by p.created_at desc), '[]')
        from market_products p where p.store_id = s.id and p.status <> 'removido') else '[]'::jsonb end,
      'open_orders', (select count(*) from market_orders o where o.store_id = s.id and o.v3 and o.status in ('pago','em_preparacao','em_execucao','enviado','disputa'))) order by s.name)
    from mkt_store_members m join mkt_stores s on s.id = m.store_id
    where m.user_id = auth.uid() and s.status in ('configuracao','pendente','ativa') and public.mkt__store_role(s.id) is not null), '[]')) $$;

-- Pedidos das lojas onde sou membro (gestor/atendimento). Sem valores de comissão para o atendimento.
create or replace function public.mkt_team_orders(p_store uuid default null, p_status text default null, p_page integer default 1) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(x) from (
    select o.id, o.store_id, o.product_title, o.qty, o.total_mzn, o.status, o.created_at, o.updated_at, o.kind,
      (select handle from profiles where id = o.buyer_id) as other_handle, public.mkt__store_role(o.store_id) as my_role
    from market_orders o
    where o.v3 and o.store_id is not null and public.mkt__store_member(o.store_id)
      and (p_store is null or o.store_id = p_store) and (p_status is null or o.status = p_status)
    order by o.created_at desc limit 30 offset (greatest(coalesce(p_page, 1), 1) - 1) * 30) x), '[]')) $$;

-- 4. Produtos: o gestor edita os produtos da loja (campos de catálogo; fotos e loja ficam com o dono) -----------------
create or replace function public.mkt_team_product_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr market_products; st text;
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  select * into pr from market_products where id = p_id for update;
  if pr.id is null or pr.store_id is null or not public.mkt__store_member(pr.store_id, array['gestor']) then
    return public.mkt__deny('STORE_GESTOR', 'loja_equipa_produto', coalesce(p_id::text, ''));
  end if;
  if not public.mkt__rate('team_prod:' || auth.uid(), 120, 3600) then return public.mkt__err('RATE'); end if;
  st := coalesce(nullif(p->>'status', ''), pr.status);
  if st not in ('rascunho','ativo','arquivado') and st is distinct from pr.status then return public.mkt__err('STATUS_FORBIDDEN'); end if;
  begin
    update market_products set
      title = coalesce(nullif(trim(p->>'title'), ''), title),
      description = coalesce(p->>'description', description),
      price_mzn = coalesce((p->>'price_mzn')::integer, price_mzn),
      stock = coalesce((p->>'stock')::integer, stock),
      delivery_info = coalesce(p->>'delivery_info', delivery_info),
      low_stock_threshold = coalesce((p->>'low_stock_threshold')::integer, low_stock_threshold),
      status = st
    where id = pr.id;
  exception
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then return public.mkt__err('INVALID');
    when raise_exception then
      if sqlerrm in ('PROHIBITED','STATUS_FORBIDDEN','PHOTOS','STORE','VIDEOS','CONTAS_CRIADOR','CONTAS_OFF','FEATURE_FORBIDDEN') then return public.mkt__err(sqlerrm); end if;
      raise;
  end;
  perform public.mkt__audit('loja_equipa_produto', pr.id::text, 'ok', null,
    jsonb_build_object('title', pr.title, 'price', pr.price_mzn, 'stock', pr.stock, 'status', pr.status),
    (select jsonb_build_object('title', title, 'price', price_mzn, 'stock', stock, 'status', status) from market_products where id = pr.id),
    jsonb_build_object('store', pr.store_id));
  return jsonb_build_object('ok', true, 'status', (select status from market_products where id = pr.id));
end $$;

-- Variantes: dono ou gestor da loja do produto
create or replace function public.mkt_variant_save(p_product uuid, p_id uuid, p_name text, p_price integer, p_stock integer, p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare vid uuid; pr market_products;
begin
  select * into pr from market_products where id = p_product;
  if pr.id is null or not (pr.seller_id = auth.uid() or (pr.store_id is not null and public.mkt__store_member(pr.store_id, array['gestor']))) then return public.mkt__err('FORBIDDEN'); end if;
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
  if pr.seller_id <> auth.uid() then
    perform public.mkt__audit('loja_equipa_variante', p_product::text, 'ok', null, null, jsonb_build_object('variant', vid, 'name', trim(p_name), 'price', p_price, 'stock', p_stock), jsonb_build_object('store', pr.store_id));
  end if;
  return jsonb_build_object('ok', true, 'id', vid);
end $$;

-- 5. Pedidos: quem é quem (comprador, vendedor/dono, equipa) -----------------------------------------------------
-- Mensagens (mkt_message_send/mkt_messages/mkt_report) usam esta função: a equipa fala do lado do vendedor.
create or replace function public.mkt__party(p_order uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() = o.buyer_id then 'comprador' when auth.uid() = o.seller_id then 'vendedor'
              when o.store_id is not null and public.mkt__store_member(o.store_id) then 'equipa' else null end
  from market_orders o where o.id = p_order $$;

create or replace function public.mkt_order_action(p_order uuid, p_action text, p_note text default '', p_extra jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders; who text; nxt text; note text := left(trim(coalesce(p_note, '')), 1000); r jsonb; team text;
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  select * into o from market_orders where id = p_order for update;
  if o.id is null or not o.v3 then return public.mkt__err('NOT_FOUND'); end if;
  who := case when auth.uid() = o.buyer_id then 'comprador' when auth.uid() = o.seller_id then 'vendedor' else null end;
  if who is null and o.store_id is not null then
    team := public.mkt__store_role(o.store_id);
    if team = 'gestor' then
      if p_action not in ('preparar','enviar','iniciar','entregar') then return public.mkt__deny('STORE_OWNER', 'pedido_' || coalesce(p_action, ''), p_order::text); end if;
      who := 'vendedor';
    elsif team = 'atendimento' then
      return public.mkt__deny('STORE_GESTOR', 'pedido_' || coalesce(p_action, ''), p_order::text);
    end if;
  end if;
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
    perform public.mkt__set_status(o.id, nxt, p_action, case when team is not null then 'equipa' else who end, note);
  end if;
  if team is not null then
    perform public.mkt__audit('loja_equipa_pedido_' || p_action, o.id::text, 'ok', null, jsonb_build_object('status', o.status), jsonb_build_object('status', nxt), jsonb_build_object('store', o.store_id, 'role', team));
    perform public.mkt__notify(o.seller_id, 'pedido_atualizado', 'Equipa: "' || left(o.product_title, 60) || '" → ' || public.mkt__status_label(nxt), '/marketplace/pedido/?id=' || o.id, 'order-team:' || o.id || ':' || nxt);
  end if;

  perform public.mkt__notify(case when who = 'vendedor' then o.buyer_id else o.seller_id end,
    case when nxt = 'concluido' then 'pedido_concluido' when nxt in ('cancelado','reembolsado') then 'pedido_cancelado' else 'pedido_atualizado' end,
    '"' || left(o.product_title, 60) || '": ' || public.mkt__status_label(nxt), '/marketplace/pedido/?id=' || o.id, 'order:' || o.id || ':' || nxt || ':' || o.revision_count);
  return jsonb_build_object('ok', true, 'status', nxt);
end $$;

-- Detalhe: a equipa vê o pedido da loja como o vendedor; o atendimento não vê comissões nem valores líquidos.
create or replace function public.mkt_order_get(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o market_orders; who text; team text;
begin
  select * into o from market_orders where id = p_order;
  if o.id is null then return public.mkt__err('NOT_FOUND'); end if;
  who := case when auth.uid() = o.buyer_id then 'comprador' when auth.uid() = o.seller_id then 'vendedor' else null end;
  if who is null and o.store_id is not null then
    team := public.mkt__store_role(o.store_id);
    if team in ('gestor','atendimento') then who := 'equipa'; else team := null; end if;
  end if;
  if who is null and public.mkt__can('ORDERS_VIEW') then who := 'staff'; end if;
  if who is null then return public.mkt__err('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'role', who, 'team_role', team,
    'order', to_jsonb(o) - case when who = 'comprador' or team = 'atendimento' then array['commission_rule_id','commission_scope','commission_pct','commission_fixed_mzn','commission_mzn','seller_net_mzn','settled_commission_mzn','settled_net_mzn']
                                else array[]::text[] end,
    'buyer', (select jsonb_build_object('handle', handle, 'display_name', display_name) from profiles where id = o.buyer_id),
    'seller', (select jsonb_build_object('handle', handle, 'display_name', display_name) from profiles where id = o.seller_id),
    'store', (select jsonb_build_object('slug', slug, 'name', name) from mkt_stores where id = o.store_id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('from', from_status, 'to', to_status, 'action', action, 'role', actor_role, 'note', note, 'at', created_at) order by id), '[]')
               from mkt_order_events where order_id = o.id),
    'payment', (select jsonb_build_object('id', id, 'status', status, 'amount_mzn', amount_mzn, 'method', method, 'expires_at', expires_at, 'confirmed_at', confirmed_at)
                from mkt_payments where id = o.payment_id and (who not in ('vendedor','equipa') or status in ('confirmado','reembolsado','parcialmente_reembolsado'))));
end $$;

-- 6. RLS: a equipa lê o que a sua função permite --------------------------------------------------------------------
alter table public.mkt_store_members enable row level security;
drop policy if exists mkt_store_members_read on public.mkt_store_members;
create policy mkt_store_members_read on public.mkt_store_members for select using (
  user_id = (select auth.uid()) or exists (select 1 from public.mkt_stores s where s.id = store_id and s.owner_id = (select auth.uid())) or (select public.mkt__can('STORES_VIEW')));
revoke all on public.mkt_store_members from anon, authenticated;
grant select on public.mkt_store_members to authenticated;

drop policy if exists market_read on public.market_products;
create policy market_read on public.market_products for select using (status = 'ativo' or seller_id = (select auth.uid()) or (select public.is_admin())
  or (select public.mkt__can('PRODUCTS_VIEW')) or (store_id is not null and public.mkt__store_member(store_id, array['gestor'])));
drop policy if exists mkt_product_variants_read on public.mkt_product_variants;
create policy mkt_product_variants_read on public.mkt_product_variants for select using (
  exists (select 1 from public.market_products p where p.id = product_id and (p.status = 'ativo' or p.seller_id = (select auth.uid())
    or (p.store_id is not null and public.mkt__store_member(p.store_id, array['gestor'])))) or (select public.mkt__can('PRODUCTS_VIEW')));
drop policy if exists market_orders_read on public.market_orders;
create policy market_orders_read on public.market_orders for select using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select public.is_admin())
  or (select public.mkt__can('ORDERS_VIEW')) or (v3 and store_id is not null and public.mkt__store_member(store_id)));
drop policy if exists mkt_order_events_read on public.mkt_order_events;
create policy mkt_order_events_read on public.mkt_order_events for select using (
  exists (select 1 from public.market_orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())
    or (o.store_id is not null and public.mkt__store_member(o.store_id)))) or (select public.mkt__can('ORDERS_VIEW')));
drop policy if exists mkt_order_messages_read on public.mkt_order_messages;
create policy mkt_order_messages_read on public.mkt_order_messages for select using (
  exists (select 1 from public.market_orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())
    or (o.store_id is not null and public.mkt__store_member(o.store_id)))));

revoke all on function public.mkt__store_role(uuid), public.mkt__store_member(uuid, text[]) from public, anon;
grant execute on function public.mkt__store_role(uuid), public.mkt__store_member(uuid, text[]) to authenticated;
revoke all on function public.mkt_store_team(uuid), public.mkt_store_member_set(text, text), public.mkt_store_member_remove(uuid, uuid), public.mkt_team_stores(),
  public.mkt_team_orders(uuid, text, integer), public.mkt_team_product_save(uuid, jsonb) from public, anon;
grant execute on function public.mkt_store_team(uuid), public.mkt_store_member_set(text, text), public.mkt_store_member_remove(uuid, uuid), public.mkt_team_stores(),
  public.mkt_team_orders(uuid, text, integer), public.mkt_team_product_save(uuid, jsonb) to authenticated;
revoke all on function public.mkt__party(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
