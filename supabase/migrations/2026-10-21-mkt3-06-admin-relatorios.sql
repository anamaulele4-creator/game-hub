-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 6/6 — Painel do criador (indicadores reais), painel administrativo
-- (indicadores, listas por módulo, permissões), auditoria (consulta e exportação registada), relatórios,
-- revisão de risco e suspensão temporária com motivo. IDEMPOTENTE.
-- =====================================================================

do $$ begin
  if to_regclass('public.mkt_disputes') is null then raise exception 'Corre primeiro a Parte 5 (mensagens, avaliações e disputas).'; end if;
end $$;

-- 1. Permissões: atribuir/retirar (só admin), predefinição "suporte" ------------------------------------------
create or replace function public.mkt_admin_set_perm(p_user uuid, p_perm text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare perms text[] := case when p_perm = 'PRESET_SUPORTE' then array['USERS_VIEW','ORDERS_VIEW','STORES_VIEW','PRODUCTS_VIEW','DISPUTES_VIEW','DISPUTES_MANAGE']
                              when p_perm = 'PRESET_FINANCEIRO' then array['ORDERS_VIEW','PAYMENTS_VIEW','REFUNDS_MANAGE','PAYOUTS_VIEW','PAYOUTS_MANAGE','REPORTS_VIEW']
                              when p_perm = 'PRESET_MODERACAO' then array['STORES_VIEW','STORES_MANAGE','PRODUCTS_VIEW','PRODUCTS_MODERATE','CREATORS_VIEW']
                              else array[p_perm] end; x text;
begin
  if not public.is_admin() then return public.mkt__deny('SETTINGS_MANAGE', 'permissao_' || case when p_on then 'dar' else 'tirar' end, coalesce(p_user::text, '') || ':' || coalesce(p_perm, '')); end if;
  if not exists (select 1 from profiles where id = p_user and not banned) then return public.mkt__err('NOT_FOUND'); end if;
  begin
    foreach x in array perms loop
      if p_on then insert into mkt_staff_perms (user_id, perm, granted_by) values (p_user, x, auth.uid()) on conflict do nothing;
      else delete from mkt_staff_perms where user_id = p_user and perm = x; end if;
    end loop;
  exception when check_violation then return public.mkt__err('INVALID');
  end;
  perform public.mkt__audit('permissao_' || case when p_on then 'dar' else 'tirar' end, p_user::text, 'ok', null, null, jsonb_build_object('perms', perms));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mkt_admin_staff() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return public.mkt__deny('SETTINGS_MANAGE', 'equipa_ver'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(x order by x.handle) from (
    select p.id, p.handle, p.display_name, p.role, (select coalesce(jsonb_agg(s.perm order by s.perm), '[]') from mkt_staff_perms s where s.user_id = p.id) as perms
    from profiles p where p.role = 'admin' or exists (select 1 from mkt_staff_perms s where s.user_id = p.id)) x), '[]'));
end $$;

create or replace function public.mkt_admin_find_user(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.mkt__can('USERS_VIEW')) then return public.mkt__err('FORBIDDEN'); end if;
  return coalesce((select jsonb_build_object('ok', true, 'id', id, 'handle', handle, 'display_name', display_name, 'role', role, 'banned', banned, 'suspended_until', suspended_until)
    from profiles where lower(handle) = lower(ltrim(trim(coalesce(p_handle, '')), '@'))), public.mkt__err('NOT_FOUND'));
end $$;

-- 2. Suspensão temporária para investigação (manual, com motivo, sempre revista por uma pessoa) ---------------------
create or replace function public.mkt_admin_user_suspend(p_user uuid, p_hours integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr profiles;
begin
  if not public.mkt__can('USERS_MANAGE') then return public.mkt__deny('USERS_MANAGE', 'utilizador_suspender', p_user::text); end if;
  select * into pr from profiles where id = p_user for update;
  if pr.id is null then return public.mkt__err('NOT_FOUND'); end if;
  if pr.role = 'admin' or pr.id = auth.uid() then return public.mkt__err('FORBIDDEN'); end if;
  if p_hours is null or p_hours < 0 or p_hours > 720 then return public.mkt__err('INVALID'); end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then return public.mkt__err('REASON'); end if;
  perform set_config('gamehub.trusted', '1', true);
  update profiles set suspended_until = case when p_hours = 0 then null else now() + make_interval(hours => p_hours) end where id = p_user;
  perform set_config('gamehub.trusted', '', true);
  perform public.mkt__audit(case when p_hours = 0 then 'utilizador_levantar_suspensao' else 'utilizador_suspender' end, p_user::text, 'ok', p_reason,
    jsonb_build_object('suspended_until', pr.suspended_until), jsonb_build_object('horas', p_hours));
  perform public.mkt__notify(p_user, 'seguranca', case when p_hours = 0 then 'A suspensão temporária da tua conta foi levantada.'
    else 'A tua conta foi suspensa temporariamente (' || p_hours || ' h) para verificação: ' || left(trim(p_reason), 120) || '. Podes contestar pelo suporte.' end,
    '/seguranca', 'suspend:' || p_user || ':' || extract(epoch from now())::bigint);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mkt_admin_risk_action(p_id bigint, p_action text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mkt__can('SECURITY_MANAGE') then return public.mkt__deny('SECURITY_MANAGE', 'risco_' || coalesce(p_action, ''), p_id::text); end if;
  if p_action not in ('em_revisao','confirmado','descartado') then return public.mkt__err('STATE'); end if;
  update mkt_risk_events set status = p_action, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if not found then return public.mkt__err('NOT_FOUND'); end if;
  perform public.mkt__audit('risco_' || p_action, p_id::text, 'ok', p_note);
  return jsonb_build_object('ok', true);
end $$;

-- 3. Painel do criador/vendedor (indicadores 1–14 do Creator OS, tudo a partir de registos reais) ---------------
create or replace function public.mkt_creator_dashboard(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); f timestamptz := coalesce(p_from, current_date - 29)::timestamptz; t timestamptz := (coalesce(p_to, current_date) + 1)::timestamptz;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  return jsonb_build_object('ok', true, 'from', f, 'to', t,
    'store', (select jsonb_build_object('id', id, 'slug', slug, 'name', name, 'status', status, 'status_reason', status_reason) from mkt_stores where owner_id = uid),
    'can_sell', public.mkt__can_sell(uid), 'seller_verified', public.seller__verified(uid),
    'kpi', (select jsonb_build_object(
        'sales_count', count(*) filter (where status in ('concluido','parcialmente_reembolsado')),
        'orders', count(*) filter (where status not in ('criado','aguarda_pagamento','cancelado') or not v3),
        'pending', count(*) filter (where status in ('pago','em_preparacao','enviado','em_execucao','entregue','disputa','aguarda_pagamento') and (v3 or status <> 'aguarda_pagamento')),
        'completed', count(*) filter (where status = 'concluido'),
        'cancelled', count(*) filter (where status in ('cancelado','reembolsado')),
        'gross', coalesce(sum(total_mzn) filter (where v3 and settled_at is not null and status <> 'reembolsado'), 0),
        'commissions', coalesce(sum(settled_commission_mzn) filter (where v3 and settled_at is not null), 0),
        'net_settled', coalesce(sum(settled_net_mzn) filter (where v3 and settled_at is not null), 0),
        'net_pending', coalesce(sum(seller_net_mzn) filter (where v3 and settled_at is null and status in ('pago','em_preparacao','enviado','em_execucao','entregue','disputa')), 0),
        'refunds', coalesce(sum(refunded_mzn) filter (where v3), 0))
      from market_orders where seller_id = uid and created_at >= f and created_at < t),
    'payouts', (select jsonb_build_object('pending', coalesce(sum(amount_mzn) filter (where status in ('pedido','em_processamento')), 0),
        'done', coalesce(sum(amount_mzn) filter (where status = 'pago'), 0)) from mkt_payouts where seller_id = uid),
    'rating', (select jsonb_build_object('avg', round(avg(rating)::numeric, 1), 'count', count(*)) from market_reviews where seller_id = uid and not hidden),
    'top_products', (select coalesce(jsonb_agg(x), '[]') from (
        select product_id, max(product_title) as title, sum(qty)::integer as qty, coalesce(sum(total_mzn - refunded_mzn), 0)::integer as revenue
        from market_orders where seller_id = uid and status in ('concluido','parcialmente_reembolsado') and created_at >= f and created_at < t
        group by product_id order by sum(qty) desc limit 5) x),
    'series', (select coalesce(jsonb_agg(x order by x.day), '[]') from (
        select (created_at at time zone 'Africa/Maputo')::date as day, count(*)::integer as orders,
          coalesce(sum(total_mzn - refunded_mzn) filter (where status in ('concluido','parcialmente_reembolsado')), 0)::integer as sales
        from market_orders where seller_id = uid and created_at >= f and created_at < t and status not in ('criado','aguarda_pagamento','cancelado')
        group by 1) x),
    'repeat_customers', (select count(*) from (select buyer_id from market_orders where seller_id = uid and status in ('concluido','parcialmente_reembolsado')
        group by buyer_id having count(*) >= 2) r),
    'customers', (select count(distinct buyer_id) from market_orders where seller_id = uid and status in ('concluido','parcialmente_reembolsado')),
    'open_disputes', (select count(*) from mkt_disputes where seller_id = uid and status not in ('resolvida','rejeitada','encerrada')),
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'stock', stock)), '[]') from market_products
        where seller_id = uid and kind <> 'servico' and status in ('ativo','esgotado') and stock <= low_stock_threshold),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('event', event, 'status', status, 'body', body, 'href', href, 'at', created_at) order by id desc), '[]')
        from (select * from mkt_notification_log where user_id = uid order by id desc limit 20) n),
    'automation_errors', (select count(*) from mkt_notification_log where user_id = uid and status = 'falhou'));
end $$;

-- Relatório do vendedor (exportação CSV no navegador): só os pedidos dele
create or replace function public.mkt_creator_report(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', auth.uid() is not null, 'rows', coalesce((select jsonb_agg(x order by x.created_at) from (
    select o.id, o.created_at, o.product_title, o.qty, o.status, o.total_mzn, o.refunded_mzn, o.commission_pct, o.commission_mzn, o.seller_net_mzn,
      o.settled_commission_mzn, o.settled_net_mzn, o.settled_at, o.v3
    from market_orders o where o.seller_id = auth.uid() and o.created_at >= coalesce(p_from, current_date - 29) and o.created_at < coalesce(p_to, current_date) + 1
    limit 5000) x), '[]')) $$;

-- 4. Painel administrativo -----------------------------------------------------------------------------------
create or replace function public.mkt_admin_dashboard(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f timestamptz := coalesce(p_from, current_date - 29)::timestamptz; t timestamptz := (coalesce(p_to, current_date) + 1)::timestamptz;
begin
  if not (public.mkt__can('REPORTS_VIEW') or public.mkt__is_staff()) then return public.mkt__err('FORBIDDEN'); end if;
  return jsonb_build_object('ok', true, 'from', f, 'to', t,
    'users_total', (select count(*) from profiles where deleted_at is null),
    'users_new', (select count(*) from profiles where created_at >= f and created_at < t),
    'users_active', (select count(distinct user_id) from login_events where created_at >= f and created_at < t),
    'creators_active', (select count(*) from profiles p where p.role = 'creator' and not p.banned and exists (select 1 from market_products m where m.seller_id = p.id and m.status = 'ativo')),
    'stores_active', (select count(*) from mkt_stores where status = 'ativa'),
    'stores_pending', (select count(*) from mkt_stores where status = 'pendente'),
    'products_published', (select count(*) from market_products where status = 'ativo'),
    'products_pending', (select count(*) from market_products where status = 'pendente'),
    'orders', (select count(*) from market_orders where v3 and created_at >= f and created_at < t and status not in ('criado','aguarda_pagamento','cancelado')),
    'orders_completed', (select count(*) from market_orders where v3 and created_at >= f and created_at < t and status = 'concluido'),
    'payments_confirmed', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount_mzn), 0)) from mkt_payments
        where confirmed_at >= f and confirmed_at < t),
    'sales_volume', (select coalesce(sum(total_mzn - refunded_mzn), 0) from market_orders where v3 and settled_at >= f and settled_at < t),
    'commissions', (select coalesce(sum(amount), 0) from mkt_journal where account = 'receita' and created_at >= f and created_at < t),
    'refunds', (select coalesce(-sum(amount), 0) from mkt_journal where account = 'escrow' and kind = 'reembolso' and created_at >= f and created_at < t),
    'disputes_open', (select count(*) from mkt_disputes where status not in ('resolvida','rejeitada','encerrada')),
    'payouts_pending', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount_mzn), 0)) from mkt_payouts where status in ('pedido','em_processamento')),
    'reports_open', (select count(*) from mkt_reports where status in ('aberta','em_analise')),
    'security_incidents', (select count(*) from mkt_risk_events where status in ('aberto','em_revisao')),
    'denied_attempts', (select count(*) from app_audit_log where result = 'negado' and created_at >= f and created_at < t),
    'flags', (select jsonb_object_agg(key, value) from app_settings where key like 'mkt3_%'));
end $$;

-- Listas paginadas por módulo (cada uma exige a sua permissão)
create or replace function public.mkt_admin_list(p_entity text, p_status text default null, p_q text default '', p_page integer default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q text := replace(replace(lower(trim(left(coalesce(p_q, ''), 60))), '%', ''), '_', ' '); off integer := (greatest(coalesce(p_page, 1), 1) - 1) * 50; rows jsonb; need text;
begin
  need := case p_entity when 'lojas' then 'STORES_VIEW' when 'produtos' then 'PRODUCTS_VIEW' when 'pedidos' then 'ORDERS_VIEW' when 'pagamentos' then 'PAYMENTS_VIEW'
    when 'payouts' then 'PAYOUTS_VIEW' when 'disputas' then 'DISPUTES_VIEW' when 'risco' then 'SECURITY_MANAGE' when 'criadores' then 'CREATORS_VIEW'
    when 'utilizadores' then 'USERS_VIEW' when 'denuncias' then 'PRODUCTS_VIEW' when 'avaliacoes' then 'PRODUCTS_VIEW' when 'comissoes' then 'SETTINGS_MANAGE' else null end;
  if need is null then return public.mkt__err('INVALID'); end if;
  if not public.mkt__can(need) then return public.mkt__deny(need, 'listar_' || p_entity); end if;
  if p_entity = 'lojas' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select s.id, s.slug, s.name, s.status, s.status_reason, s.category, s.created_at, p.handle as owner,
        (select count(*) from market_products m where m.store_id = s.id) as products,
        (select coalesce(jsonb_agg(jsonb_build_object('from', d.from_status, 'to', d.to_status, 'action', d.action, 'reason', d.reason, 'at', d.created_at) order by d.id desc), '[]')
           from (select * from mkt_store_decisions where store_id = s.id order by id desc limit 10) d) as history
      from mkt_stores s join profiles p on p.id = s.owner_id
      where (p_status is null or s.status = p_status) and (q = '' or lower(s.name) like '%' || q || '%' or lower(p.handle) like '%' || q || '%')
      order by case when s.status = 'pendente' then 0 else 1 end, s.created_at desc limit 50 offset off) x;
  elsif p_entity = 'produtos' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select m.id, m.title, m.status, m.kind, m.category, m.price_mzn, m.stock, m.sales, m.views, m.moderation_reason, m.created_at,
        m.seller_name, (select count(*) from mkt_reports r where r.kind = 'produto' and r.target_id = m.id::text and r.status in ('aberta','em_analise')) as reports
      from market_products m where (p_status is null or m.status = p_status) and (q = '' or lower(m.title) like '%' || q || '%' or lower(m.seller_name) like '%' || q || '%')
      order by case when m.status = 'pendente' then 0 else 1 end, m.created_at desc limit 50 offset off) x;
  elsif p_entity = 'pedidos' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select o.id, o.product_title, o.status, o.total_mzn, o.refunded_mzn, o.commission_mzn, o.seller_net_mzn, o.v3, o.created_at,
        b.handle as buyer, s.handle as seller
      from market_orders o join profiles b on b.id = o.buyer_id join profiles s on s.id = o.seller_id
      where (p_status is null or o.status = p_status) and (q = '' or lower(o.product_title) like '%' || q || '%' or lower(b.handle) like '%' || q || '%' or lower(s.handle) like '%' || q || '%' or o.id::text = q)
      order by o.created_at desc limit 50 offset off) x;
  elsif p_entity = 'pagamentos' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select p.id, p.status, p.amount_mzn, p.refunded_mzn, p.method, p.provider_ref, p.failure_reason, p.created_at, p.confirmed_at, b.handle as buyer,
        (select coalesce(jsonb_agg(jsonb_build_object('to', e.to_status, 'source', e.source, 'at', e.created_at) order by e.id), '[]') from mkt_payment_events e where e.payment_id = p.id) as events
      from mkt_payments p join profiles b on b.id = p.buyer_id
      where (p_status is null or p.status = p_status) and (q = '' or lower(b.handle) like '%' || q || '%' or p.id::text = q)
      order by p.created_at desc limit 50 offset off) x;
  elsif p_entity = 'payouts' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select w.id, w.status, w.amount_mzn, w.method,
        case when public.mkt__can('PAYOUTS_MANAGE') then w.phone else left(w.phone, 2) || '•••' || right(w.phone, 2) end as phone,
        w.provider_ref, w.reason, w.requested_at, w.decided_at, s.handle as seller, public.seller__verified(w.seller_id) as identity_ok
      from mkt_payouts w join profiles s on s.id = w.seller_id
      where (p_status is null or w.status = p_status) and (q = '' or lower(s.handle) like '%' || q || '%')
      order by case when w.status in ('pedido','em_processamento') then 0 else 1 end, w.requested_at desc limit 50 offset off) x;
    if public.mkt__can('PAYOUTS_MANAGE') then perform public.mkt__audit('payouts_ver', '', 'ok', 'consulta com contactos'); end if;
  elsif p_entity = 'disputas' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select d.id, d.order_id, d.status, d.reason_code, left(d.description, 300) as description, d.proposal, d.decision, d.decision_amount,
        d.created_at, d.response_due_at, o.product_title, o.total_mzn, o.refunded_mzn, b.handle as buyer, s.handle as seller
      from mkt_disputes d join market_orders o on o.id = d.order_id join profiles b on b.id = d.buyer_id join profiles s on s.id = d.seller_id
      where (p_status is null or d.status = p_status) order by case when d.status in ('resolvida','rejeitada','encerrada') then 1 else 0 end, d.created_at limit 50 offset off) x;
  elsif p_entity = 'risco' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select r.id, r.kind, r.ref, r.score, r.detail, r.status, r.created_at, p.handle
      from mkt_risk_events r left join profiles p on p.id = r.user_id where (p_status is null or r.status = p_status) order by r.created_at desc limit 50 offset off) x;
  elsif p_entity = 'denuncias' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select r.id, r.kind, r.target_id, r.reason, r.status, r.resolution, r.created_at, p.handle as reporter
      from mkt_reports r join profiles p on p.id = r.reporter_id where (p_status is null or r.status = p_status) order by r.created_at desc limit 50 offset off) x;
  elsif p_entity = 'avaliacoes' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select r.order_id, r.rating, r.comment, r.seller_reply, r.hidden, r.hidden_reason, r.created_at, r.edited_at,
        b.handle as buyer, s.handle as seller from market_reviews r join profiles b on b.id = r.buyer_id join profiles s on s.id = r.seller_id
      where (p_status is null or (p_status = 'ocultas' and r.hidden) or (p_status = 'visiveis' and not r.hidden)) order by r.created_at desc limit 50 offset off) x;
  elsif p_entity = 'comissoes' then
    select coalesce(jsonb_agg(x), '[]') into rows from (select c.id, c.scope, c.category, c.pct, c.fixed_mzn, c.active, c.note, c.created_at, c.deactivated_at,
        (select handle from profiles where id = c.seller_id) as seller from mkt_commission_rules c order by c.active desc, c.created_at desc limit 50 offset off) x;
  else -- criadores / utilizadores
    select coalesce(jsonb_agg(x), '[]') into rows from (select p.id, p.handle, p.display_name, p.role, p.banned, p.suspended_until, p.created_at, p.verified,
        public.seller__verified(p.id) as seller_verified, (select slug from mkt_stores where owner_id = p.id) as store,
        (select count(*) from market_products m where m.seller_id = p.id and m.status = 'ativo') as products
      from profiles p where (p_entity = 'utilizadores' or p.role = 'creator') and p.deleted_at is null
        and (q = '' or lower(p.handle) like '%' || q || '%' or lower(p.display_name) like '%' || q || '%')
      order by p.created_at desc limit 50 offset off) x;
  end if;
  return jsonb_build_object('ok', true, 'rows', rows, 'page', greatest(coalesce(p_page, 1), 1));
end $$;

-- 5. Auditoria: consulta (AUDIT_LOGS_VIEW) e exportação (AUDIT_LOGS_EXPORT, fica registada) -----------------------
create or replace function public.mkt__audit_rows(p_actor text, p_action text, p_resource text, p_result text, p_area text, p_from date, p_to date, p_limit integer, p_offset integer)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select id, area, action, target, actor_handle, result, reason, before, after, meta, created_at from app_audit_log
    where (coalesce(p_actor, '') = '' or lower(actor_handle) = lower(ltrim(p_actor, '@')))
      and (coalesce(p_action, '') = '' or action ilike '%' || replace(replace(p_action, '%', ''), '_', '\_') || '%')
      and (coalesce(p_resource, '') = '' or target ilike '%' || replace(replace(p_resource, '%', ''), '_', '\_') || '%')
      and (coalesce(p_result, '') = '' or result = p_result or (p_result = 'erro' and result like 'erro%'))
      and (coalesce(p_area, '') = '' or area = p_area)
      and created_at >= coalesce(p_from, current_date - 30) and created_at < coalesce(p_to, current_date) + 1
    order by id desc limit least(greatest(p_limit, 1), 5000) offset greatest(p_offset, 0)) x $$;

create or replace function public.mkt_admin_audit(p_actor text default '', p_action text default '', p_resource text default '', p_result text default '',
  p_area text default '', p_from date default null, p_to date default null, p_page integer default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.mkt__can('AUDIT_LOGS_VIEW') then return public.mkt__deny('AUDIT_LOGS_VIEW', 'auditoria_ver'); end if;
  return jsonb_build_object('ok', true, 'page', greatest(coalesce(p_page, 1), 1),
    'rows', coalesce((select jsonb_agg(r) from public.mkt__audit_rows(p_actor, p_action, p_resource, p_result, p_area, p_from, p_to, 50, (greatest(coalesce(p_page, 1), 1) - 1) * 50) r), '[]'),
    'legacy', case when coalesce(p_area, '') in ('', 'legado') and greatest(coalesce(p_page, 1), 1) = 1 then
      coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from (select action, target, actor_handle, created_at from audit_log
        where created_at >= coalesce(p_from, current_date - 30) and created_at < coalesce(p_to, current_date) + 1
          and (coalesce(p_actor, '') = '' or lower(actor_handle) = lower(ltrim(p_actor, '@')))
          and (coalesce(p_action, '') = '' or action ilike '%' || replace(replace(p_action, '%', ''), '_', '\_') || '%')
        order by created_at desc limit 50) l), '[]') else '[]'::jsonb end);
end $$;

create or replace function public.mkt_admin_audit_export(p_actor text default '', p_action text default '', p_resource text default '', p_result text default '',
  p_area text default '', p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rows jsonb;
begin
  if not public.mkt__can('AUDIT_LOGS_EXPORT') then return public.mkt__deny('AUDIT_LOGS_EXPORT', 'auditoria_exportar'); end if;
  rows := coalesce((select jsonb_agg(r) from public.mkt__audit_rows(p_actor, p_action, p_resource, p_result, p_area, p_from, p_to, 5000, 0) r), '[]');
  perform public.mkt__audit('auditoria_exportar', '', 'ok', null, null, null,
    jsonb_build_object('filtros', jsonb_build_object('actor', p_actor, 'action', p_action, 'resource', p_resource, 'result', p_result, 'area', p_area, 'from', p_from, 'to', p_to), 'linhas', jsonb_array_length(rows)));
  return jsonb_build_object('ok', true, 'rows', rows);
end $$;

-- 6. Relatórios administrativos (séries diárias reais; exportação no navegador) ----------------------------------
create or replace function public.mkt_admin_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f date := coalesce(p_from, current_date - 29); t date := coalesce(p_to, current_date);
begin
  if not public.mkt__can('REPORTS_VIEW') then return public.mkt__deny('REPORTS_VIEW', 'relatorio'); end if;
  perform public.mkt__audit('relatorio_ver', f || '..' || t, 'ok', null);
  return jsonb_build_object('ok', true, 'from', f, 'to', t, 'rows', coalesce((select jsonb_agg(x order by x.day) from (
    select d as day,
      (select count(*) from profiles where created_at >= d and created_at < d + 1) as new_users,
      (select count(*) from mkt_stores where created_at >= d and created_at < d + 1) as new_stores,
      (select count(*) from mkt_payments where confirmed_at >= d and confirmed_at < d + 1) as payments,
      (select coalesce(sum(amount_mzn), 0) from mkt_payments where confirmed_at >= d and confirmed_at < d + 1) as payments_mzn,
      (select coalesce(sum(total_mzn - refunded_mzn), 0) from market_orders where v3 and settled_at >= d and settled_at < d + 1) as sales_mzn,
      (select coalesce(sum(amount), 0) from mkt_journal where account = 'receita' and created_at >= d and created_at < d + 1) as commissions_mzn,
      (select coalesce(-sum(amount), 0) from mkt_journal where account = 'escrow' and kind = 'reembolso' and created_at >= d and created_at < d + 1) as refunds_mzn,
      (select count(*) from mkt_disputes where created_at >= d and created_at < d + 1) as disputes,
      (select count(*) from mkt_risk_events where status = 'confirmado' and created_at >= d and created_at < d + 1) as fraud_confirmed,
      (select count(*) from market_orders where v3 and created_at >= d and created_at < d + 1) as checkouts_started,
      (select count(*) from market_orders where v3 and created_at >= d and created_at < d + 1 and paid_at is not null) as checkouts_paid,
      (select round(avg(extract(epoch from closed_at - paid_at) / 3600)::numeric, 1) from market_orders where v3 and status = 'concluido' and closed_at >= d and closed_at < d + 1) as avg_hours_to_complete
    from (select g::date as d from generate_series(f::timestamp, t::timestamp, interval '1 day') g) s) x), '[]'));
end $$;

-- 7. Estado da instalação (para o painel mostrar "SQL por instalar" em vez de erros) ---------------------------------
create or replace function public.mkt_install_status() returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'version', '3.0.0', 'parts', jsonb_build_array(
    to_regprocedure('public.mkt__can(text)') is not null, to_regclass('public.mkt_stores') is not null, to_regclass('public.mkt_cart_items') is not null,
    to_regclass('public.mkt_journal') is not null, to_regclass('public.mkt_disputes') is not null, to_regprocedure('public.mkt_admin_dashboard(date,date)') is not null)) $$;

revoke all on function public.mkt__audit_rows(text, text, text, text, text, date, date, integer, integer) from public, anon, authenticated;
revoke all on function public.mkt_admin_set_perm(uuid, text, boolean), public.mkt_admin_staff(), public.mkt_admin_find_user(text), public.mkt_admin_user_suspend(uuid, integer, text),
  public.mkt_admin_risk_action(bigint, text, text), public.mkt_creator_dashboard(date, date), public.mkt_creator_report(date, date), public.mkt_admin_dashboard(date, date),
  public.mkt_admin_list(text, text, text, integer), public.mkt_admin_audit(text, text, text, text, text, date, date, integer),
  public.mkt_admin_audit_export(text, text, text, text, text, date, date), public.mkt_admin_report(date, date) from public, anon;
grant execute on function public.mkt_admin_set_perm(uuid, text, boolean), public.mkt_admin_staff(), public.mkt_admin_find_user(text), public.mkt_admin_user_suspend(uuid, integer, text),
  public.mkt_admin_risk_action(bigint, text, text), public.mkt_creator_dashboard(date, date), public.mkt_creator_report(date, date), public.mkt_admin_dashboard(date, date),
  public.mkt_admin_list(text, text, text, integer), public.mkt_admin_audit(text, text, text, text, text, date, date, integer),
  public.mkt_admin_audit_export(text, text, text, text, text, date, date), public.mkt_admin_report(date, date) to authenticated;
grant execute on function public.mkt_install_status() to anon, authenticated;

notify pgrst, 'reload schema';
select public.mkt_install_status();
