-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 10 — Creator OS completo. 2026-10-21. IDEMPOTENTE. ADITIVO.
--   • Perfil do criador (nome, fotografia, apresentação) editável no painel
--   • Métodos de recebimento guardados (M-Pesa / e-Mola) para os pedidos de pagamento
--   • Reclamações/disputas sobre as vendas do criador
--   • Automações do criador: "Novo pedido" quando o pedido é criado; estados de execução por automação;
--     nova tentativa automática (até 3) de avisos que falharam, feita pelo mkt_sweep agendado
-- =====================================================================

do $$ begin
  if to_regprocedure('public.mkt__direct_settle_pending()') is null then raise exception 'Corre primeiro as Partes 7–9.'; end if;
end $$;

-- 1. Perfil -------------------------------------------------------------------------------------------------
create or replace function public.mkt_creator_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then public.mkt__err('AUTH') else
    (select jsonb_build_object('ok', true, 'handle', handle, 'display_name', display_name, 'avatar_url', avatar_url, 'bio', bio, 'role', role,
       'store', (select jsonb_build_object('slug', slug, 'name', name, 'logo_url', logo_url, 'cover_url', cover_url, 'status', status) from mkt_stores where owner_id = p.id))
     from profiles p where id = auth.uid()) end $$;

-- Fotografia: só imagens carregadas pelo próprio (pasta products/<uid>/ do bucket media) ou um emoji curto.
create or replace function public.mkt_creator_profile_save(p_display_name text, p_bio text, p_avatar_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text := trim(coalesce(p_display_name, '')); b text := trim(coalesce(p_bio, '')); av text := nullif(trim(coalesce(p_avatar_url, '')), '');
  before jsonb;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if not public.is_active_user() then return public.mkt__err('ACCOUNT'); end if;
  if length(nm) not between 2 and 50 or length(b) > 500 then return public.mkt__err('INVALID'); end if;
  if av is not null and not (public.mkt__own_media(av, uid) or (length(av) <= 8 and av !~ '[/:.]')) then return public.mkt__err('PHOTOS'); end if;
  if not public.mkt__rate('profile:' || uid, 20, 3600) then return public.mkt__err('RATE'); end if;
  select jsonb_build_object('display_name', display_name, 'bio', left(bio, 80), 'avatar', avatar_url is not null) into before from profiles where id = uid;
  update profiles set display_name = nm, bio = b, avatar_url = coalesce(av, avatar_url) where id = uid;
  perform public.mkt__audit('perfil_criador', uid::text, 'ok', null, before, jsonb_build_object('display_name', nm, 'bio', left(b, 80), 'avatar', av is not null));
  return jsonb_build_object('ok', true);
end $$;

-- 2. Métodos de recebimento ---------------------------------------------------------------------------------
create table if not exists public.mkt_payout_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  method text not null check (method in ('M-Pesa','e-Mola')),
  phone text not null check (phone ~ '^8[4-7][0-9]{7}$'),
  holder_name text not null default '' check (length(holder_name) <= 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, method, phone)
);
create index if not exists mkt_payout_methods_user_idx on public.mkt_payout_methods (user_id);

create or replace function public.mkt_payout_methods_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', auth.uid() is not null, 'rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'method', method, 'phone', phone,
      'holder_name', holder_name, 'is_default', is_default) order by is_default desc, created_at) from mkt_payout_methods where user_id = auth.uid()), '[]')) $$;

create or replace function public.mkt_payout_method_save(p_method text, p_phone text, p_holder text, p_default boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ph text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '^\+?258', ''); mid uuid;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if p_method not in ('M-Pesa','e-Mola') or (p_method = 'M-Pesa' and ph !~ '^8[45][0-9]{7}$') or (p_method = 'e-Mola' and ph !~ '^8[67][0-9]{7}$') then return public.mkt__err('PHONE'); end if;
  if not public.mkt__rate('payout_method:' || uid, 20, 3600) then return public.mkt__err('RATE'); end if;
  if (select count(*) from mkt_payout_methods where user_id = uid) >= 3 and not exists (select 1 from mkt_payout_methods where user_id = uid and method = p_method and phone = ph) then
    return public.mkt__err('LIMIT');
  end if;
  insert into mkt_payout_methods (user_id, method, phone, holder_name) values (uid, p_method, ph, left(trim(coalesce(p_holder, '')), 80))
    on conflict (user_id, method, phone) do update set holder_name = excluded.holder_name returning id into mid;
  if coalesce(p_default, false) or not exists (select 1 from mkt_payout_methods where user_id = uid and is_default) then
    update mkt_payout_methods set is_default = (id = mid) where user_id = uid;
  end if;
  perform public.mkt__audit('metodo_recebimento_guardar', uid::text, 'ok', null, null, jsonb_build_object('metodo', p_method, 'numero', left(ph, 2) || '•••' || right(ph, 2)));
  perform public.mkt__notify(uid, 'conta', 'Método de recebimento guardado: ' || p_method || ' ' || left(ph, 2) || '•••' || right(ph, 2) || '. Se não foste tu, contacta o suporte.',
    '/marketplace/criador', 'payout-method:' || mid || ':' || extract(epoch from now())::bigint);
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

create or replace function public.mkt_payout_method_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m mkt_payout_methods;
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  delete from mkt_payout_methods where id = p_id and user_id = auth.uid() returning * into m;
  if m.id is null then return public.mkt__err('NOT_FOUND'); end if;
  if m.is_default then
    update mkt_payout_methods set is_default = true where id = (select id from mkt_payout_methods where user_id = auth.uid() order by created_at limit 1);
  end if;
  perform public.mkt__audit('metodo_recebimento_remover', auth.uid()::text, 'ok', null, jsonb_build_object('metodo', m.method, 'numero', left(m.phone, 2) || '•••' || right(m.phone, 2)), null);
  return jsonb_build_object('ok', true);
end $$;

-- 3. Reclamações sobre as minhas vendas ----------------------------------------------------------------------
create or replace function public.mkt_creator_disputes(p_open_only boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', auth.uid() is not null, 'rows', coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select d.id, d.order_id, d.status, d.reason_code, left(d.description, 300) as description, d.decision, d.decision_amount, d.created_at, d.updated_at,
      o.product_title, o.total_mzn, (select handle from profiles where id = d.buyer_id) as buyer_handle
    from mkt_disputes d join market_orders o on o.id = d.order_id
    where d.seller_id = auth.uid() and (not coalesce(p_open_only, false) or d.status not in ('resolvida','rejeitada','encerrada'))
    order by d.created_at desc limit 100) x), '[]')) $$;

-- 4. Automações do criador -----------------------------------------------------------------------------------
-- 4a. "Novo pedido" logo que o pedido é criado (o "Pagamento confirmado" segue quando é pago).
create or replace function public.mkt__tg_order_new() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.v3 then
    begin
      perform public.mkt__notify(new.seller_id, 'novo_pedido', 'Novo pedido: "' || left(new.product_title, 60) || '" (' || new.total_mzn || ' MT) — a aguardar pagamento do comprador.',
        '/marketplace/pedido/?id=' || new.id, 'new:' || new.id);
    exception when others then raise warning 'mkt novo_pedido %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists market_orders_mkt3_new on public.market_orders;
create trigger market_orders_mkt3_new after insert on public.market_orders for each row execute function public.mkt__tg_order_new();

-- 4b. Nova tentativa dos avisos que falharam (máx. 3 tentativas, até 24 h). Chamado pelo mkt_sweep.
create or replace function public.mkt__notify_retry() returns integer
language plpgsql security definer set search_path = public as $$
declare l record; n integer := 0;
begin
  for l in select * from mkt_notification_log where status = 'falhou' and attempts < 3 and created_at > now() - interval '24 hours' order by id limit 200 for update skip locked loop
    begin
      insert into notifications (user_id, type, body, href) values (l.user_id, 'compra', l.body, l.href);
      update mkt_notification_log set status = 'enviada', attempts = attempts + 1, error = null where id = l.id;
      n := n + 1;
    exception when others then
      update mkt_notification_log set attempts = attempts + 1, error = left(sqlerrm, 200) where id = l.id;
    end;
  end loop;
  return n;
end $$;

-- 4c. Estado de execução de cada automação (últimos 30 dias)
create or replace function public.mkt_creator_automations() returns jsonb
language sql stable security definer set search_path = public as $$
  with ev(event, label, ord) as (values ('novo_pedido','Novo pedido',1), ('pagamento_confirmado','Pagamento confirmado',2), ('pedido_cancelado','Pedido cancelado',3),
    ('pedido_concluido','Pedido concluído',4), ('nova_avaliacao','Nova avaliação',5), ('nova_mensagem','Nova mensagem',6), ('reclamacao','Reclamação recebida',7),
    ('pagamento_vendedor','Pagamento disponibilizado',8), ('stock_baixo','Produto com stock baixo',9), ('conta','Alterações relevantes na conta',10))
  select case when auth.uid() is null then public.mkt__err('AUTH') else jsonb_build_object('ok', true, 'rows', (select jsonb_agg(jsonb_build_object(
    'event', ev.event, 'label', ev.label,
    'enabled', coalesce((select in_app from mkt_notification_prefs where user_id = auth.uid() and event = ev.event), true),
    'sent', (select count(*) from mkt_notification_log l where l.user_id = auth.uid() and l.event = ev.event and l.status = 'enviada' and l.created_at > now() - interval '30 days'),
    'skipped', (select count(*) from mkt_notification_log l where l.user_id = auth.uid() and l.event = ev.event and l.status = 'ignorada_preferencia' and l.created_at > now() - interval '30 days'),
    'failed', (select count(*) from mkt_notification_log l where l.user_id = auth.uid() and l.event = ev.event and l.status = 'falhou' and l.created_at > now() - interval '30 days'),
    'last', (select jsonb_build_object('status', l.status, 'at', l.created_at, 'attempts', l.attempts, 'error', l.error) from mkt_notification_log l
             where l.user_id = auth.uid() and l.event = ev.event order by l.id desc limit 1)) order by ev.ord) from ev)) end $$;

-- 5. mkt_sweep (agendado na Parte 7): + nova tentativa de avisos ------------------------------------------------
create or replace function public.mkt_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare days integer; o record; done integer := 0; exp integer; direct integer; retried integer;
begin
  if auth.uid() is not null and not public.mkt__can('SETTINGS_MANAGE') then return public.mkt__deny('SETTINGS_MANAGE', 'processar_prazos'); end if;
  direct := public.mkt__direct_settle_pending();
  exp := public.mkt_sweep_expired(null);
  select auto_release_days into days from market_settings where id = 1;
  if days is not null then
    for o in select id from market_orders where v3 and status in ('entregue','enviado') and settled_at is null
             and coalesce(delivered_at, shipped_at) < now() - make_interval(days => days) order by updated_at limit 200 loop
      if (public.mkt__complete_order(o.id, 'sistema', 'conclusao_automatica', 'Sem resposta do comprador em ' || days || ' dia(s)')->>'ok')::boolean then done := done + 1; end if;
    end loop;
  end if;
  retried := public.mkt__notify_retry();
  if auth.uid() is not null then perform public.mkt__audit('processar_prazos', '', 'ok', null, null, jsonb_build_object('expirados', exp, 'concluidos', done, 'pagamentos_diretos', direct, 'avisos_reenviados', retried)); end if;
  return jsonb_build_object('ok', true, 'expired', exp, 'auto_completed', done, 'auto_release_days', days, 'direct_settled', direct, 'notifications_retried', retried);
end $$;

-- 6. RLS e permissões -----------------------------------------------------------------------------------------
alter table public.mkt_payout_methods enable row level security;
drop policy if exists mkt_payout_methods_read on public.mkt_payout_methods;
create policy mkt_payout_methods_read on public.mkt_payout_methods for select using (user_id = (select auth.uid()) or (select public.mkt__can('PAYOUTS_VIEW')));
revoke all on public.mkt_payout_methods from anon, authenticated;
grant select on public.mkt_payout_methods to authenticated;

revoke all on function public.mkt__tg_order_new(), public.mkt__notify_retry() from public, anon, authenticated;
revoke all on function public.mkt_creator_profile(), public.mkt_creator_profile_save(text, text, text), public.mkt_payout_methods_list(), public.mkt_payout_method_save(text, text, text, boolean),
  public.mkt_payout_method_remove(uuid), public.mkt_creator_disputes(boolean), public.mkt_creator_automations() from public, anon;
grant execute on function public.mkt_creator_profile(), public.mkt_creator_profile_save(text, text, text), public.mkt_payout_methods_list(), public.mkt_payout_method_save(text, text, text, boolean),
  public.mkt_payout_method_remove(uuid), public.mkt_creator_disputes(boolean), public.mkt_creator_automations() to authenticated;
revoke all on function public.mkt_sweep() from public, anon;
grant execute on function public.mkt_sweep() to authenticated, service_role;

notify pgrst, 'reload schema';
