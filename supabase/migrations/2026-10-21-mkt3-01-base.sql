-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 1/6 — Base: interruptores, permissões administrativas, auditoria,
-- limites de utilização, idempotência, notificações e registo de risco. 2026-10-21. IDEMPOTENTE (pode repetir-se).
--
-- ADITIVO: não apaga tabelas nem dados. Não altera o formulário de anúncios nem a auditoria existentes.
-- Reutiliza public.app_settings, public.app_audit_log e public.app__audit (criados pelo SQL de Apostas v2,
-- sql-apostas.html). Interruptores novos (todos DESLIGADOS por omissão, mudados em Admin › Marketplace 3.0):
--   mkt3_enabled                 lojas, carrinho, painel do criador e pedidos novos visíveis para todos
--   mkt3_checkout_enabled        pagamento de pedidos com dinheiro real (saldo da carteira)
--   mkt3_payouts_enabled         pedidos de pagamento aos vendedores
--   mkt3_store_review_required   lojas novas passam por verificação (LIGADO)
--   mkt3_product_review_required produtos novos passam por revisão antes de publicar (desligado)
-- =====================================================================

do $$ begin
  if to_regclass('public.app_settings') is null or to_regprocedure('public.app__audit(text,text,text,jsonb,jsonb)') is null then
    raise exception 'Corre primeiro o SQL de Apostas v2 (sql-apostas.html): cria app_settings e a auditoria.';
  end if;
  if to_regclass('public.market_orders') is null or to_regclass('public.money_ledger') is null then
    raise exception 'Faltam as tabelas do marketplace/carteira (market_orders, money_ledger). Corre primeiro as migrações anteriores.';
  end if;
  if to_regprocedure('public.seller__verified(uuid)') is null then
    raise exception 'Corre primeiro o SQL de afiliados/verificação (sql-afiliados.html).';
  end if;
end $$;

create extension if not exists pgcrypto;

-- 1. Interruptores (app_settings, só o admin muda; app_setting_set regista na auditoria) -------------
insert into public.app_settings (key, value, perm) values
  ('mkt3_enabled', 'false'::jsonb, 'admin'),
  ('mkt3_checkout_enabled', 'false'::jsonb, 'admin'),
  ('mkt3_payouts_enabled', 'false'::jsonb, 'admin'),
  ('mkt3_store_review_required', 'true'::jsonb, 'admin'),
  ('mkt3_product_review_required', 'false'::jsonb, 'admin')
on conflict (key) do nothing;

create or replace function public.mkt__flag(p_key text, p_default boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = p_key), p_default) $$;

-- 2. Auditoria: colunas extra (resultado, motivo, metadados) na tabela já existente ---------------------
alter table public.app_audit_log add column if not exists result text not null default 'ok';
alter table public.app_audit_log add column if not exists reason text;
alter table public.app_audit_log add column if not exists meta jsonb;
create index if not exists app_audit_log_created_idx on public.app_audit_log (created_at desc);
create index if not exists app_audit_log_actor_idx on public.app_audit_log (actor_id, created_at desc);
create index if not exists app_audit_log_action_idx on public.app_audit_log (action, created_at desc);

-- Nunca guardar segredos: chaves com nomes sensíveis são retiradas dos metadados.
create or replace function public.mkt__scrub(p jsonb) returns jsonb language sql immutable as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then p else
    coalesce((select jsonb_object_agg(k, v) from jsonb_each(p) e(k, v)
      where k !~* '(password|senha|pin|token|secret|segredo|card|cartao|cvv|iban)'), '{}'::jsonb) end $$;

create or replace function public.mkt__audit(p_action text, p_target text, p_result text default 'ok', p_reason text default null,
  p_before jsonb default null, p_after jsonb default null, p_meta jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into app_audit_log (area, action, target, actor_id, actor_handle, before, after, result, reason, meta)
  values ('marketplace', left(p_action, 80), left(coalesce(p_target, ''), 200), auth.uid(),
          coalesce((select handle from profiles where id = auth.uid()), case when auth.uid() is null then 'sistema' else '' end),
          public.mkt__scrub(p_before), public.mkt__scrub(p_after), left(coalesce(p_result, 'ok'), 20), left(p_reason, 500),
          public.mkt__scrub(coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('ip', nullif(left(coalesce(nullif(current_setting('request.headers', true), '')::jsonb->>'x-forwarded-for', ''), 60), ''))));
end $$;

-- 3. Permissões administrativas granulares ---------------------------------------------------------
create table if not exists public.mkt_staff_perms (
  user_id uuid not null references public.profiles(id) on delete cascade,
  perm text not null check (perm in ('USERS_VIEW','USERS_MANAGE','CREATORS_VIEW','CREATORS_MANAGE','STORES_VIEW','STORES_MANAGE',
    'PRODUCTS_VIEW','PRODUCTS_MODERATE','ORDERS_VIEW','PAYMENTS_VIEW','REFUNDS_MANAGE','PAYOUTS_VIEW','PAYOUTS_MANAGE',
    'DISPUTES_VIEW','DISPUTES_MANAGE','REPORTS_VIEW','AUDIT_LOGS_VIEW','AUDIT_LOGS_EXPORT','SECURITY_MANAGE','SETTINGS_MANAGE')),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, perm)
);

-- Admin (role admin) tem todas. Restantes (ex.: suporte) só as que lhe forem dadas. Conta banida não tem nenhuma.
create or replace function public.mkt__can(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from profiles where id = auth.uid() and not banned and deleted_at is null)
    and (public.is_admin() or exists (select 1 from mkt_staff_perms where user_id = auth.uid() and perm = p_perm)) $$;

create or replace function public.mkt__is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (auth.uid() is not null and exists (select 1 from mkt_staff_perms where user_id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and not banned)) $$;

-- Recusa registada (tentativa de acesso negada) + resposta de erro consistente
create or replace function public.mkt__deny(p_perm text, p_action text, p_target text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.mkt__audit(p_action, p_target, 'negado', 'sem permissão ' || coalesce(p_perm, ''));
  return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'perm', p_perm);
end $$;

create or replace function public.mkt__err(p_code text, p_extra jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'code', p_code) || coalesce(p_extra, '{}'::jsonb) $$;

-- Marketplace 3.0 aberto a este utilizador? (staff testa mesmo com o interruptor desligado)
create or replace function public.mkt__open() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mkt__flag('mkt3_enabled') or public.mkt__is_staff() $$;

create or replace function public.mkt_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true,
    'user_id', auth.uid(),
    'enabled', public.mkt__flag('mkt3_enabled'), 'checkout_enabled', public.mkt__flag('mkt3_checkout_enabled'),
    'payouts_enabled', public.mkt__flag('mkt3_payouts_enabled'), 'open', public.mkt__open(),
    'role', (select role from profiles where id = auth.uid()),
    'is_admin', public.is_admin(), 'is_staff', public.mkt__is_staff(),
    'seller_verified', case when auth.uid() is null then false else public.seller__verified(auth.uid()) end,
    'perms', (select coalesce(jsonb_agg(p order by p), '[]'::jsonb) from unnest(array['USERS_VIEW','USERS_MANAGE','CREATORS_VIEW','CREATORS_MANAGE','STORES_VIEW','STORES_MANAGE',
      'PRODUCTS_VIEW','PRODUCTS_MODERATE','ORDERS_VIEW','PAYMENTS_VIEW','REFUNDS_MANAGE','PAYOUTS_VIEW','PAYOUTS_MANAGE','DISPUTES_VIEW','DISPUTES_MANAGE',
      'REPORTS_VIEW','AUDIT_LOGS_VIEW','AUDIT_LOGS_EXPORT','SECURITY_MANAGE','SETTINGS_MANAGE']) p where public.mkt__can(p))) $$;

-- 4. Limites de utilização (anti-abuso) e idempotência ----------------------------------------------
create table if not exists public.mkt_rate_hits (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists mkt_rate_hits_idx on public.mkt_rate_hits (key, at desc);

create or replace function public.mkt__rate(p_key text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from mkt_rate_hits where key = p_key and at < now() - make_interval(secs => p_window_seconds);
  select count(*) into n from mkt_rate_hits where key = p_key and at >= now() - make_interval(secs => p_window_seconds);
  if n >= p_max then return false; end if;
  insert into mkt_rate_hits (key) values (p_key);
  return true;
end $$;

create table if not exists public.mkt_idempotency (
  key text primary key,
  user_id uuid,
  op text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
create or replace function public.mkt__idem_get(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select response from mkt_idempotency where key = p_key and (user_id is not distinct from auth.uid()) $$;
create or replace function public.mkt__idem_put(p_key text, p_op text, p_resp jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into mkt_idempotency (key, user_id, op, response) values (p_key, auth.uid(), p_op, p_resp) on conflict (key) do nothing;
  return p_resp;
end $$;

-- 5. Risco e atividade suspeita (sem bloqueio automático: só sinaliza para revisão humana) -------------
create table if not exists public.mkt_risk_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  ref text not null default '',
  score integer not null default 0 check (score between 0 and 100),
  detail jsonb not null default '{}',
  status text not null default 'aberto' check (status in ('aberto','em_revisao','confirmado','descartado')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mkt_risk_events_status_idx on public.mkt_risk_events (status, created_at desc);

create or replace function public.mkt__risk(p_user uuid, p_kind text, p_ref text, p_score integer, p_detail jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into mkt_risk_events (user_id, kind, ref, score, detail) values (p_user, left(p_kind, 60), left(coalesce(p_ref, ''), 120), least(greatest(p_score, 0), 100), public.mkt__scrub(p_detail));
end $$;

-- 6. Notificações: preferências, prevenção de duplicados e histórico ---------------------------------
-- Canal ativo: dentro da plataforma (tabela notifications existente; o push já existente dispara a partir dela).
-- Email/SMS NÃO são enviados: não há integração configurada (fica registado como 'canal_indisponivel').
create table if not exists public.mkt_notification_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (event in ('novo_pedido','pedido_atualizado','pagamento_confirmado','pagamento_recusado','pedido_cancelado','pedido_concluido',
    'reembolso','nova_mensagem','nova_avaliacao','reclamacao','disputa_resolvida','pagamento_vendedor','stock_baixo','conta','seguranca')),
  in_app boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, event)
);

create table if not exists public.mkt_notification_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null,
  dedupe_key text not null,
  channel text not null default 'in_app',
  status text not null check (status in ('enviada','ignorada_preferencia','falhou','canal_indisponivel')),
  attempts integer not null default 1,
  error text,
  body text not null default '',
  href text,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key, channel)
);
create index if not exists mkt_notification_log_user_idx on public.mkt_notification_log (user_id, created_at desc);

create or replace function public.mkt__notify(p_user uuid, p_event text, p_body text, p_href text, p_dedupe text) returns void
language plpgsql security definer set search_path = public as $$
declare want boolean; lid bigint;
begin
  if p_user is null then return; end if;
  select in_app into want from mkt_notification_prefs where user_id = p_user and event = p_event;
  insert into mkt_notification_log (user_id, event, dedupe_key, status, body, href)
    values (p_user, p_event, p_dedupe, case when coalesce(want, true) then 'enviada' else 'ignorada_preferencia' end, left(p_body, 280), p_href)
    on conflict (user_id, dedupe_key, channel) do nothing returning id into lid;
  if lid is null or not coalesce(want, true) then return; end if;   -- duplicado ou desligado pelo utilizador
  begin
    insert into notifications (user_id, type, body, href) values (p_user, 'compra', left(p_body, 280), p_href);
  exception when others then
    update mkt_notification_log set status = 'falhou', error = left(sqlerrm, 200) where id = lid;
  end;
end $$;

create or replace function public.mkt_notification_prefs_set(p_event text, p_in_app boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  if p_event in ('seguranca','conta') and not coalesce(p_in_app, true) then return public.mkt__err('MANDATORY'); end if;
  insert into mkt_notification_prefs (user_id, event, in_app) values (auth.uid(), p_event, coalesce(p_in_app, true))
    on conflict (user_id, event) do update set in_app = excluded.in_app, updated_at = now();
  return jsonb_build_object('ok', true);
exception when check_violation then return public.mkt__err('INVALID');
end $$;

-- 7. RLS e permissões ---------------------------------------------------------------------------------
alter table public.mkt_staff_perms enable row level security;
alter table public.mkt_rate_hits enable row level security;
alter table public.mkt_idempotency enable row level security;
alter table public.mkt_risk_events enable row level security;
alter table public.mkt_notification_prefs enable row level security;
alter table public.mkt_notification_log enable row level security;
drop policy if exists mkt_staff_perms_read on public.mkt_staff_perms;
create policy mkt_staff_perms_read on public.mkt_staff_perms for select using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists mkt_notification_prefs_read on public.mkt_notification_prefs;
create policy mkt_notification_prefs_read on public.mkt_notification_prefs for select using (user_id = (select auth.uid()));
drop policy if exists mkt_notification_log_read on public.mkt_notification_log;
create policy mkt_notification_log_read on public.mkt_notification_log for select using (user_id = (select auth.uid()));
-- mkt_rate_hits, mkt_idempotency e mkt_risk_events: sem políticas = ninguém lê diretamente (só pelas funções).
revoke all on public.mkt_staff_perms, public.mkt_rate_hits, public.mkt_idempotency, public.mkt_risk_events,
  public.mkt_notification_prefs, public.mkt_notification_log from anon, authenticated;
grant select on public.mkt_staff_perms, public.mkt_notification_prefs, public.mkt_notification_log to authenticated;

revoke all on function public.mkt__audit(text, text, text, text, jsonb, jsonb, jsonb), public.mkt__deny(text, text, text),
  public.mkt__rate(text, integer, integer), public.mkt__idem_get(text), public.mkt__idem_put(text, text, jsonb),
  public.mkt__risk(uuid, text, text, integer, jsonb), public.mkt__notify(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.mkt__flag(text, boolean), public.mkt__open(), public.mkt_me() to anon, authenticated;
grant execute on function public.mkt__can(text), public.mkt__is_staff(), public.mkt_notification_prefs_set(text, boolean) to authenticated;

notify pgrst, 'reload schema';
