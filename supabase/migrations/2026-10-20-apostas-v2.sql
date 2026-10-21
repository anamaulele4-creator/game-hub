-- =====================================================================
-- TXAPILOG · Apostas v2 (2026-10-20). IDEMPOTENTE — pode correr várias vezes.
--
-- • Apostas individuais com valor escolhido pelo utilizador (mín./máx., positivo, ≤ saldo).
-- • A odd fica TRANCADA no momento da confirmação (cópia na própria aposta). Se a odd mudou desde que o
--   utilizador a viu, a aposta é recusada e o servidor devolve a odd nova.
-- • Cada aposta é liquidada sozinha (ganha / perdida / anulada / reembolsada), no servidor, sem nunca
--   creditar duas vezes (livro-razão com chave única utilizador+motivo+referência).
-- • Permissões por pessoa (mercados, odds, liquidação, ligar/desligar, permissões) impostas aqui (RLS +
--   funções SECURITY DEFINER), não só na interface. Registo de auditoria só de acréscimos.
-- • SALDO DE TESTE APENAS (moeda 'teste'): não tem valor, não se compra nem se levanta. Não toca na carteira
--   de dinheiro real, pagamentos, ClicPay nem licenças.
-- • Interruptor global app_settings.apostas_enabled — DESLIGADO por omissão. Desligado: todas as funções de
--   apostas do utilizador recusam no servidor, e novas linhas em public.bets (apostas clássicas e de desafios)
--   também são recusadas. O dono liga em Admin › Apostas.
--
-- Corre DEPOIS de schema.sql (precisa de public.profiles e public.is_admin()). Não altera tabelas do marketplace.
-- =====================================================================

create extension if not exists pgcrypto;

-- 1. Interruptores globais e auditoria ---------------------------------------------------
create table if not exists public.app_settings (
  key text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  value jsonb not null,
  -- quem pode mudar: 'admin' (role admin) ou 'apostas:<permissão>' (Admin › Apostas › Permissões)
  perm text not null default 'admin',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.app_settings (key, value, perm) values ('apostas_enabled', 'false'::jsonb, 'apostas:toggle') on conflict (key) do nothing;
insert into public.app_settings (key, value, perm) values ('apostas_limits', '{"min_stake":10,"max_stake":5000,"initial_test_balance":1000}'::jsonb, 'apostas:toggle') on conflict (key) do nothing;

create table if not exists public.app_audit_log (
  id bigint generated always as identity primary key,
  area text not null,
  action text not null,
  target text not null default '',
  actor_id uuid,
  actor_handle text not null default '',
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists app_audit_log_area_idx on public.app_audit_log (area, created_at desc);

create or replace function public.app__tg_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'AUDIT_IMMUTABLE'; end $$;
drop trigger if exists app_audit_immutable on public.app_audit_log;
create trigger app_audit_immutable before update or delete on public.app_audit_log for each row execute function public.app__tg_audit_immutable();

create or replace function public.app__audit(p_area text, p_action text, p_target text, p_before jsonb, p_after jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into app_audit_log (area, action, target, actor_id, actor_handle, before, after)
  values (p_area, p_action, coalesce(p_target, ''), auth.uid(),
          coalesce((select handle from profiles where id = auth.uid()), case when auth.uid() is null then 'sistema' else '' end), p_before, p_after);
end $$;

-- 2. Permissões de Apostas ---------------------------------------------------------------
create table if not exists public.apv2_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  perm text not null check (perm in ('markets','odds','settle','toggle','permissions')),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, perm)
);

-- Admin (role) tem sempre 'permissions' (para poder distribuir as outras, incluindo a si próprio).
-- As restantes têm de ser dadas explicitamente. Só admins e moderadores podem ter permissões.
create or replace function public.apv2__has_perm(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from profiles where id = auth.uid() and not banned and role in ('admin','moderator'))
    and ((p_perm = 'permissions' and public.is_admin())
         or exists (select 1 from apv2_permissions where user_id = auth.uid() and perm = p_perm)) $$;

create or replace function public.apv2__staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (auth.uid() is not null and exists (select 1 from apv2_permissions where user_id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and not banned and role in ('admin','moderator'))) $$;

create or replace function public.apv2__enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = 'apostas_enabled'), false) $$;

create or replace function public.apv2__limits() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_settings where key = 'apostas_limits'), '{"min_stake":10,"max_stake":5000,"initial_test_balance":1000}'::jsonb) $$;

-- 3. Mercados, seleções e apostas --------------------------------------------------------
create table if not exists public.apv2_markets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 3 and 120),
  game_key text not null default 'outros' check (game_key in ('ff','cr','ef','dls','outros')),
  status text not null default 'aberto' check (status in ('aberto','suspenso','fechado','liquidado','anulado')),
  closes_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists apv2_markets_status_idx on public.apv2_markets (status, created_at desc);

create table if not exists public.apv2_selections (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.apv2_markets(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 60),
  odds numeric(8,2) not null check (odds >= 1.01 and odds <= 1000),
  odds_version integer not null default 1,
  result text not null default 'pendente' check (result in ('pendente','ganha','perdida','anulada','reembolsada')),
  sort integer not null default 0
);
create index if not exists apv2_selections_market_idx on public.apv2_selections (market_id, sort);

create table if not exists public.apv2_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  market_id uuid not null references public.apv2_markets(id),
  selection_id uuid not null references public.apv2_selections(id),
  stake integer not null check (stake > 0),
  odds_locked numeric(8,2) not null,
  odds_version_locked integer not null,
  potential integer not null check (potential >= stake),
  status text not null default 'aberta' check (status in ('aberta','ganha','perdida','anulada','reembolsada')),
  payout integer not null default 0 check (payout >= 0),
  currency text not null default 'teste' check (currency = 'teste'),
  request_id uuid,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  settled_by uuid
);
create index if not exists apv2_bets_user_idx on public.apv2_bets (user_id, created_at desc);
create index if not exists apv2_bets_sel_idx on public.apv2_bets (selection_id, status);
create unique index if not exists apv2_bets_request_uq on public.apv2_bets (user_id, request_id) where request_id is not null;

-- Odd, valor e retorno nunca mudam depois de confirmados; uma aposta liquidada não volta atrás.
create or replace function public.apv2__tg_bet_lock() returns trigger language plpgsql as $$
begin
  if new.stake <> old.stake or new.odds_locked <> old.odds_locked or new.odds_version_locked <> old.odds_version_locked
     or new.potential <> old.potential or new.user_id <> old.user_id or new.selection_id <> old.selection_id or new.market_id <> old.market_id then
    raise exception 'BET_LOCKED';
  end if;
  if old.status <> 'aberta' and (new.status <> old.status or new.payout <> old.payout) then raise exception 'ALREADY_SETTLED'; end if;
  return new;
end $$;
drop trigger if exists apv2_bet_lock on public.apv2_bets;
create trigger apv2_bet_lock before update on public.apv2_bets for each row execute function public.apv2__tg_bet_lock();

-- 4. Saldo de teste (livro-razão só de acréscimos, nunca negativo, nunca credita 2x) --------
create table if not exists public.apv2_test_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta integer not null,
  reason text not null,
  ref text not null,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, reason, ref)
);
drop trigger if exists apv2_ledger_immutable on public.apv2_test_ledger;
create trigger apv2_ledger_immutable before update or delete on public.apv2_test_ledger for each row execute function public.app__tg_audit_immutable();

create or replace function public.apv2__balance(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select balance_after from apv2_test_ledger where user_id = p_user order by id desc limit 1), 0) $$;

create or replace function public.apv2__post(p_user uuid, p_delta integer, p_reason text, p_ref text) returns integer
language plpgsql security definer set search_path = public as $$
declare b integer;
begin
  perform pg_advisory_xact_lock(hashtext('apv2:' || p_user::text));
  if exists (select 1 from apv2_test_ledger where user_id = p_user and reason = p_reason and ref = p_ref) then
    return public.apv2__balance(p_user);
  end if;
  b := public.apv2__balance(p_user) + p_delta;
  if b < 0 then raise exception 'BALANCE'; end if;
  insert into apv2_test_ledger (user_id, delta, reason, ref, balance_after) values (p_user, p_delta, p_reason, p_ref, b);
  return b;
end $$;

-- 5. Funções do utilizador ---------------------------------------------------------------
create or replace function public.apv2_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  return jsonb_build_object('ok', true, 'enabled', public.apv2__enabled(), 'limits', public.apv2__limits(),
    'balance', case when u is null then 0 else public.apv2__balance(u) end,
    'claimed', u is not null and exists (select 1 from apv2_test_ledger where user_id = u and reason = 'inicial'),
    'staff', public.apv2__staff());
end $$;

create or replace function public.apv2_claim_test_balance() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); amt integer;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if not public.apv2__enabled() then return jsonb_build_object('ok', false, 'code', 'DISABLED'); end if;
  amt := greatest(0, coalesce((public.apv2__limits()->>'initial_test_balance')::integer, 1000));
  return jsonb_build_object('ok', true, 'balance', public.apv2__post(u, amt, 'inicial', 'v2'));
end $$;

create or replace function public.apv2_place(p_selection uuid, p_stake numeric, p_seen_odds numeric, p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); lim jsonb := public.apv2__limits(); s apv2_selections; m apv2_markets; b uuid; pot integer; bal integer; prev apv2_bets;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if not public.apv2__enabled() then return jsonb_build_object('ok', false, 'code', 'DISABLED'); end if;
  if exists (select 1 from profiles where id = u and banned) then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_request is not null then
    select * into prev from apv2_bets where user_id = u and request_id = p_request;
    if found then return jsonb_build_object('ok', true, 'bet', prev.id, 'odds', prev.odds_locked, 'potential', prev.potential, 'balance', public.apv2__balance(u), 'replay', true); end if;
  end if;
  if p_stake is null or p_stake <> trunc(p_stake) then return jsonb_build_object('ok', false, 'code', 'STAKE_INT'); end if;
  if p_stake <= 0 then return jsonb_build_object('ok', false, 'code', 'STAKE_POSITIVE'); end if;
  if p_stake < (lim->>'min_stake')::integer then return jsonb_build_object('ok', false, 'code', 'STAKE_MIN', 'min', (lim->>'min_stake')::integer); end if;
  if p_stake > (lim->>'max_stake')::integer then return jsonb_build_object('ok', false, 'code', 'STAKE_MAX', 'max', (lim->>'max_stake')::integer); end if;
  -- trava a seleção: a mudança de odds espera por esta transação (e vice-versa)
  select * into s from apv2_selections where id = p_selection for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into m from apv2_markets where id = s.market_id;
  if m.status <> 'aberto' or (m.closes_at is not null and m.closes_at <= now()) or s.result <> 'pendente' then
    return jsonb_build_object('ok', false, 'code', 'CLOSED');
  end if;
  if p_seen_odds is null or round(p_seen_odds, 2) <> s.odds then
    return jsonb_build_object('ok', false, 'code', 'ODDS_CHANGED', 'odds', s.odds, 'odds_version', s.odds_version);
  end if;
  if public.apv2__balance(u) < p_stake then return jsonb_build_object('ok', false, 'code', 'BALANCE', 'balance', public.apv2__balance(u)); end if;
  pot := floor(p_stake * s.odds)::integer;
  b := gen_random_uuid();
  insert into apv2_bets (id, user_id, market_id, selection_id, stake, odds_locked, odds_version_locked, potential, request_id)
  values (b, u, m.id, s.id, p_stake::integer, s.odds, s.odds_version, pot, p_request);
  bal := public.apv2__post(u, -p_stake::integer, 'aposta', b::text);
  return jsonb_build_object('ok', true, 'bet', b, 'odds', s.odds, 'potential', pot, 'balance', bal);
end $$;

-- 6. Liquidação (servidor; idempotente; cada aposta sozinha) --------------------------------
create or replace function public.apv2__norm_result(p text) returns text language sql immutable as $$
  select case lower(coalesce(p, '')) when 'won' then 'ganha' when 'lost' then 'perdida' when 'void' then 'anulada' when 'refund' then 'reembolsada'
    when 'ganha' then 'ganha' when 'perdida' then 'perdida' when 'anulada' then 'anulada' when 'reembolsada' then 'reembolsada' else null end $$;

-- Interna (sem verificação de permissões): chamada pelas funções admin abaixo.
create or replace function public.apv2__settle(p_bet uuid, p_result text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b apv2_bets; r text := public.apv2__norm_result(p_result); pay integer; bal integer;
begin
  if r is null then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  select * into b from apv2_bets where id = p_bet for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if b.status <> 'aberta' then
    if b.status = r then return jsonb_build_object('ok', true, 'already', true, 'status', b.status, 'payout', b.payout); end if;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SETTLED', 'status', b.status);
  end if;
  pay := case r when 'ganha' then b.potential when 'perdida' then 0 else b.stake end;
  -- uma só referência por aposta: mesmo que alguém tente outro resultado, nunca há segundo crédito
  if pay > 0 then bal := public.apv2__post(b.user_id, pay, 'liquidacao', b.id::text); end if;
  update apv2_bets set status = r, payout = pay, settled_at = now(), settled_by = auth.uid() where id = b.id;
  perform public.app__audit('apostas', 'liquidar_aposta', b.id::text, jsonb_build_object('status', 'aberta'), jsonb_build_object('status', r, 'payout', pay, 'user', b.user_id));
  return jsonb_build_object('ok', true, 'already', false, 'status', r, 'payout', pay);
end $$;

create or replace function public.apv2_admin_settle_bet(p_bet uuid, p_result text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return public.apv2__settle(p_bet, p_result);
end $$;

-- Liquida um mercado: a seleção vencedora fica 'ganha', as outras 'perdida'; p_winner nulo = anular tudo (devolve o valor).
create or replace function public.apv2_admin_settle_market(p_market uuid, p_winner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m apv2_markets; x record; n integer := 0; r text;
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into m from apv2_markets where id = p_market for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if m.status in ('liquidado','anulado') then return jsonb_build_object('ok', true, 'already', true, 'status', m.status); end if;
  if p_winner is not null and not exists (select 1 from apv2_selections where id = p_winner and market_id = p_market) then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  update apv2_selections set result = case when p_winner is null then 'anulada' when id = p_winner then 'ganha' else 'perdida' end
   where market_id = p_market and result = 'pendente';
  for x in select b.id, s.result from apv2_bets b join apv2_selections s on s.id = b.selection_id where b.market_id = p_market and b.status = 'aberta' loop
    perform public.apv2__settle(x.id, x.result); n := n + 1;
  end loop;
  update apv2_markets set status = case when p_winner is null then 'anulado' else 'liquidado' end, updated_at = now() where id = p_market;
  perform public.app__audit('apostas', case when p_winner is null then 'anular_mercado' else 'liquidar_mercado' end, p_market::text,
    jsonb_build_object('status', m.status), jsonb_build_object('winner', p_winner, 'bets', n));
  return jsonb_build_object('ok', true, 'already', false, 'bets', n);
end $$;

-- 7. Mercados e odds (admin) -------------------------------------------------------------
create or replace function public.apv2_admin_create_market(p_title text, p_game text, p_closes_at timestamptz, p_selections jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mid uuid; x jsonb; i integer := 0;
begin
  if not public.apv2__has_perm('markets') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_selections is null or jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) < 2 or jsonb_array_length(p_selections) > 20 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  insert into apv2_markets (title, game_key, closes_at, created_by) values (trim(p_title), coalesce(nullif(p_game, ''), 'outros'), p_closes_at, auth.uid()) returning id into mid;
  for x in select * from jsonb_array_elements(p_selections) loop
    insert into apv2_selections (market_id, label, odds, sort) values (mid, trim(x->>'label'), round((x->>'odds')::numeric, 2), i);
    i := i + 1;
  end loop;
  perform public.app__audit('apostas', 'criar_mercado', mid::text, null, jsonb_build_object('title', p_title, 'game', p_game, 'closes_at', p_closes_at, 'selections', p_selections));
  return jsonb_build_object('ok', true, 'id', mid);
exception when check_violation or invalid_text_representation or not_null_violation then
  return jsonb_build_object('ok', false, 'code', 'INVALID');
end $$;

create or replace function public.apv2_admin_market_status(p_market uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m apv2_markets;
begin
  if not public.apv2__has_perm('markets') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_status not in ('aberto','suspenso','fechado') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  select * into m from apv2_markets where id = p_market for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if m.status in ('liquidado','anulado') then return jsonb_build_object('ok', false, 'code', 'STATE'); end if;
  update apv2_markets set status = p_status, updated_at = now() where id = p_market;
  perform public.app__audit('apostas', 'estado_mercado', p_market::text, jsonb_build_object('status', m.status), jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.apv2_admin_set_odds(p_selection uuid, p_odds numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s apv2_selections; m apv2_markets; o numeric := round(p_odds, 2);
begin
  if not public.apv2__has_perm('odds') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if o is null or o < 1.01 or o > 1000 then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  select * into s from apv2_selections where id = p_selection for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into m from apv2_markets where id = s.market_id;
  if m.status in ('liquidado','anulado') or s.result <> 'pendente' then return jsonb_build_object('ok', false, 'code', 'STATE'); end if;
  if o = s.odds then return jsonb_build_object('ok', true, 'odds', o, 'odds_version', s.odds_version); end if;
  update apv2_selections set odds = o, odds_version = odds_version + 1 where id = p_selection;
  perform public.app__audit('apostas', 'mudar_odd', p_selection::text, jsonb_build_object('odds', s.odds, 'version', s.odds_version), jsonb_build_object('odds', o, 'version', s.odds_version + 1));
  return jsonb_build_object('ok', true, 'odds', o, 'odds_version', s.odds_version + 1);
end $$;

-- 8. Permissões, saldo de teste e interruptores (admin) ----------------------------------
create or replace function public.apv2_admin_grant(p_user uuid, p_perm text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare had boolean;
begin
  if not public.apv2__has_perm('permissions') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_perm not in ('markets','odds','settle','toggle','permissions') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  if not exists (select 1 from profiles where id = p_user and role in ('admin','moderator') and not banned) then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  had := exists (select 1 from apv2_permissions where user_id = p_user and perm = p_perm);
  if p_on and not had then insert into apv2_permissions (user_id, perm, granted_by) values (p_user, p_perm, auth.uid()); end if;
  if not p_on and had then delete from apv2_permissions where user_id = p_user and perm = p_perm; end if;
  if had is distinct from p_on then
    perform public.app__audit('apostas', case when p_on then 'dar_permissao' else 'tirar_permissao' end, p_user::text,
      jsonb_build_object('perm', p_perm, 'on', had), jsonb_build_object('perm', p_perm, 'on', p_on));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.apv2_admin_test_credit(p_user uuid, p_amount integer, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bal integer;
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 or length(coalesce(trim(p_ref), '')) < 3 then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  if not exists (select 1 from profiles where id = p_user) then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  bal := public.apv2__post(p_user, p_amount, 'admin', trim(p_ref));
  perform public.app__audit('apostas', 'credito_teste', p_user::text, null, jsonb_build_object('amount', p_amount, 'ref', trim(p_ref), 'balance', bal));
  return jsonb_build_object('ok', true, 'balance', bal);
end $$;

-- Mudar um interruptor/definição: só quem tem a permissão indicada na própria linha. Fica na auditoria.
create or replace function public.app_setting_set(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st app_settings; allowed boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into st from app_settings where key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  allowed := case when st.perm = 'admin' then public.is_admin()
                  when st.perm like 'apostas:%' then public.apv2__has_perm(substr(st.perm, 9)) else false end;
  if not allowed then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if jsonb_typeof(st.value) = 'boolean' and jsonb_typeof(p_value) is distinct from 'boolean' then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  if p_key = 'apostas_limits' then
    if jsonb_typeof(p_value) <> 'object'
       or coalesce((p_value->>'min_stake')::numeric, 0) < 1 or coalesce((p_value->>'max_stake')::numeric, 0) < (p_value->>'min_stake')::numeric
       or coalesce((p_value->>'initial_test_balance')::numeric, -1) < 0 or (p_value->>'max_stake')::numeric > 1000000 then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
  end if;
  if st.value = p_value then return jsonb_build_object('ok', true, 'value', p_value); end if;
  update app_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform public.app__audit(case when p_key like 'apostas%' then 'apostas' else 'definicoes' end, 'definicao:' || p_key, p_key,
    jsonb_build_object('value', st.value), jsonb_build_object('value', p_value));
  return jsonb_build_object('ok', true, 'value', p_value);
exception when invalid_text_representation then return jsonb_build_object('ok', false, 'code', 'INVALID');
end $$;

-- Painel do admin: tudo de uma vez (só para quem tem alguma permissão de Apostas ou é admin).
create or replace function public.apv2_admin_view() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.apv2__staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true,
    'enabled', public.apv2__enabled(), 'limits', public.apv2__limits(),
    'my_perms', (select coalesce(jsonb_agg(p), '[]') from unnest(array['markets','odds','settle','toggle','permissions']) p where public.apv2__has_perm(p)),
    'bets', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
        select b.id, b.user_id, coalesce(pr.handle, '') as handle, b.market_id, b.selection_id, s.label, m.title as market, b.stake, b.odds_locked, b.potential, b.status, b.payout, b.created_at, b.settled_at
        from apv2_bets b join apv2_selections s on s.id = b.selection_id join apv2_markets m on m.id = b.market_id left join profiles pr on pr.id = b.user_id
        order by b.created_at desc limit 300) x),
    'staff', (select coalesce(jsonb_agg(x order by x.role, x.handle), '[]') from (
        select pr.id, pr.handle, pr.display_name, pr.role, (select coalesce(jsonb_agg(perm order by perm), '[]') from apv2_permissions ap where ap.user_id = pr.id) as perms
        from profiles pr where pr.role in ('admin','moderator') and not pr.banned) x),
    'audit', (select coalesce(jsonb_agg(x order by x.id desc), '[]') from (
        select id, action, target, actor_handle, before, after, created_at from app_audit_log where area = 'apostas' order by id desc limit 300) x));
end $$;

-- 9. Interruptor também nas apostas clássicas/desafios (public.bets): desligado = não entram novas apostas -----
do $$ begin
  if to_regclass('public.bets') is not null then
    create or replace function public.apv2__tg_bets_flag() returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      if not public.apv2__enabled() then raise exception 'APOSTAS_DESATIVADAS'; end if;
      return new;
    end $f$;
    drop trigger if exists apv2_bets_flag on public.bets;
    create trigger apv2_bets_flag before insert on public.bets for each row execute function public.apv2__tg_bets_flag();
  end if;
end $$;

-- 10. RLS e permissões de execução ------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.app_audit_log enable row level security;
alter table public.apv2_permissions enable row level security;
alter table public.apv2_markets enable row level security;
alter table public.apv2_selections enable row level security;
alter table public.apv2_bets enable row level security;
alter table public.apv2_test_ledger enable row level security;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (true);
drop policy if exists app_audit_read on public.app_audit_log;
create policy app_audit_read on public.app_audit_log for select using ((select public.is_admin()) or (area = 'apostas' and (select public.apv2__staff())));
drop policy if exists apv2_permissions_read on public.apv2_permissions;
create policy apv2_permissions_read on public.apv2_permissions for select using (user_id = (select auth.uid()) or (select public.apv2__staff()));
drop policy if exists apv2_markets_read on public.apv2_markets;
create policy apv2_markets_read on public.apv2_markets for select using (true);
drop policy if exists apv2_selections_read on public.apv2_selections;
create policy apv2_selections_read on public.apv2_selections for select using (true);
drop policy if exists apv2_bets_read on public.apv2_bets;
create policy apv2_bets_read on public.apv2_bets for select using (user_id = (select auth.uid()) or (select public.apv2__staff()));
drop policy if exists apv2_ledger_read on public.apv2_test_ledger;
create policy apv2_ledger_read on public.apv2_test_ledger for select using (user_id = (select auth.uid()) or (select public.apv2__staff()));

-- Clientes só LÊEM; tudo o que escreve passa pelas funções acima.
revoke insert, update, delete on public.app_settings, public.app_audit_log, public.apv2_permissions, public.apv2_markets,
  public.apv2_selections, public.apv2_bets, public.apv2_test_ledger from anon, authenticated;
grant select on public.app_settings, public.apv2_markets, public.apv2_selections to anon, authenticated;
grant select on public.app_audit_log, public.apv2_permissions, public.apv2_bets, public.apv2_test_ledger to authenticated;

revoke execute on function public.app__audit(text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.apv2__post(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.apv2__settle(uuid, text) from public, anon, authenticated;
grant execute on function public.apv2_me() to anon, authenticated;
grant execute on function public.apv2_claim_test_balance() to authenticated;
grant execute on function public.apv2_place(uuid, numeric, numeric, uuid) to authenticated;
grant execute on function public.apv2_admin_settle_bet(uuid, text) to authenticated;
grant execute on function public.apv2_admin_settle_market(uuid, uuid) to authenticated;
grant execute on function public.apv2_admin_create_market(text, text, timestamptz, jsonb) to authenticated;
grant execute on function public.apv2_admin_market_status(uuid, text) to authenticated;
grant execute on function public.apv2_admin_set_odds(uuid, numeric) to authenticated;
grant execute on function public.apv2_admin_grant(uuid, text, boolean) to authenticated;
grant execute on function public.apv2_admin_test_credit(uuid, integer, text) to authenticated;
grant execute on function public.apv2_admin_view() to authenticated;
grant execute on function public.app_setting_set(text, jsonb) to authenticated;

select key, value from public.app_settings where key like 'apostas%' order by key;
