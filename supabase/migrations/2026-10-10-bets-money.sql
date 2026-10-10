-- =====================================================================
-- TXAPILOG · Apostas · modo DINHEIRO REAL (MT) — 2026-10-10. IDEMPOTENTE. Corre depois de 2026-10-10-bets.sql.
-- Fica DESLIGADO por omissão. Só o admin liga, com nº da licença IGJ + data de emissão + validade (futura) + "CONFIRMO".
-- Carteira MT separada dos TXAP Pontos (money_ledger, só acréscimos). KYC obrigatório (nome, nascimento 18+, BI/NUIT, telefone).
-- Depósitos: até haver API M-Pesa/e-Mola, só o admin regista depósitos confirmados (com referência, auditado).
-- Levantamentos: pedido do utilizador reserva o valor; admin marca "pago" (com referência) ou recusa (valor devolvido).
-- Tudo determinístico, escrito à mão. Espelha lib/betsCore.ts (tests/bets.test.mjs).
-- =====================================================================

-- 1. Definições --------------------------------------------------------------------------
alter table public.bet_settings add column if not exists igj_licence_expiry date;
-- Interruptor geral "Apostas ativas" (ligado por omissão; a Ana desliga em Admin › Apostas)
alter table public.bet_settings add column if not exists bets_enabled boolean not null default true;
alter table public.bet_settings add column if not exists mt_min_stake integer not null default 10;
alter table public.bet_settings add column if not exists mt_max_stake integer not null default 2000;
alter table public.bet_settings add column if not exists mt_max_payout integer not null default 50000;
alter table public.bet_settings add column if not exists mt_min_withdraw integer not null default 50;
alter table public.bet_settings add column if not exists mt_max_withdraw_daily integer not null default 20000;
alter table public.bet_settings drop constraint if exists bet_settings_real_money;
alter table public.bet_settings add constraint bet_settings_real_money check (
  not real_money_enabled or (length(trim(igj_licence_no)) > 0 and igj_licence_date is not null and igj_licence_expiry is not null and igj_licence_expiry > igj_licence_date));
alter table public.bet_settings drop constraint if exists bet_settings_mt;
alter table public.bet_settings add constraint bet_settings_mt check (
  mt_min_stake >= 1 and mt_max_stake >= mt_min_stake and mt_max_payout >= mt_max_stake and mt_min_withdraw >= 1 and mt_max_withdraw_daily >= mt_min_withdraw);

alter table public.bets drop constraint if exists bets_currency_check;
alter table public.bets add constraint bets_currency_check check (currency in ('pontos','mt'));
create index if not exists bets_user_cur_idx on public.bets (user_id, currency, created_at desc);

alter table public.bet_limits add column if not exists mt_max_stake integer check (mt_max_stake is null or mt_max_stake >= 1);
alter table public.bet_limits add column if not exists mt_max_daily integer check (mt_max_daily is null or mt_max_daily >= 1);
alter table public.bet_limits add column if not exists mt_max_weekly integer check (mt_max_weekly is null or mt_max_weekly >= 1);

-- 2. Carteira MT, KYC e levantamentos -------------------------------------------------------
create table if not exists public.money_ledger (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  delta integer not null,
  reason text not null check (reason in ('deposito','levantamento','levantamento_recusado','aposta','ganho','reembolso','correcao','ajuste')),
  ref text not null,
  balance_after integer not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (user_id, reason, ref),
  constraint money_ledger_nonneg check (balance_after >= 0 or reason = 'correcao')
);
create index if not exists money_ledger_user_idx on public.money_ledger (user_id, id desc);
create unique index if not exists money_ledger_deposit_ref_uq on public.money_ledger (ref) where reason = 'deposito';
drop trigger if exists money_ledger_immutable on public.money_ledger;
create trigger money_ledger_immutable before update or delete on public.money_ledger for each row execute function public.bets__tg_ledger_immutable();

create table if not exists public.bet_kyc (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  full_name text not null,
  birth_date date not null,
  id_type text not null check (id_type in ('BI','NUIT')),
  id_number text not null,
  phone text not null,
  status text not null default 'pendente' check (status in ('pendente','aprovado','recusado')),
  note text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  constraint bet_kyc_id_format check ((id_type = 'BI' and id_number ~ '^[0-9]{12}[A-Z]$') or (id_type = 'NUIT' and id_number ~ '^[0-9]{9}$')),
  constraint bet_kyc_phone check (phone ~ '^8[4-7][0-9]{7}$')
);
create index if not exists bet_kyc_status_idx on public.bet_kyc (status, submitted_at);

create table if not exists public.money_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount integer not null check (amount > 0),
  method text not null check (method in ('M-Pesa','e-Mola')),
  phone text not null check (phone ~ '^8[4-7][0-9]{7}$'),
  status text not null default 'pendente' check (status in ('pendente','pago','recusado')),
  reference text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz
);
create index if not exists money_withdrawals_status_idx on public.money_withdrawals (status, created_at);
create index if not exists money_withdrawals_user_idx on public.money_withdrawals (user_id, created_at desc);

-- 3. Funções de carteira --------------------------------------------------------------------
create or replace function public.bets__balance_mt(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select balance_after from money_ledger where user_id = p_user order by id desc limit 1), 0) $$;

create or replace function public.bets__post_mt(p_user uuid, p_delta integer, p_reason text, p_ref text) returns integer
language plpgsql security definer set search_path = public as $$
declare nb integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('money:' || p_user::text, 0));
  if exists (select 1 from money_ledger where user_id = p_user and reason = p_reason and ref = p_ref) then return public.bets__balance_mt(p_user); end if;
  nb := public.bets__balance_mt(p_user) + p_delta;
  if nb < 0 and p_reason <> 'correcao' then raise exception 'BALANCE'; end if;
  insert into money_ledger (user_id, delta, reason, ref, balance_after) values (p_user, p_delta, p_reason, p_ref, nb);
  return nb;
end $$;

create or replace function public.bets__real_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select real_money_enabled and igj_licence_expiry is not null and igj_licence_expiry > (now() at time zone 'Africa/Maputo')::date from bet_settings where id = 1), false) $$;

-- Liquidação/reversão passam a respeitar a moeda da aposta
create or replace function public.bets__settle_bet(p_bet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b bets; cfg bet_settings; n_lost integer; n_pend integer; n_void integer; n_all integer; o numeric := 1; r record; pay integer; st text; cap integer; rsn text;
begin
  select * into b from bets where id = p_bet for update;
  if b.id is null or b.status <> 'aberta' then return; end if;
  select * into cfg from bet_settings where id = 1;
  cap := case when b.currency = 'mt' then cfg.mt_max_payout else cfg.max_payout end;
  update bet_legs l set result = s.result from bet_selections s where l.bet_id = p_bet and s.id = l.selection_id;
  select count(*) filter (where result = 'perdida'), count(*) filter (where result = 'pendente'), count(*) filter (where result = 'anulada'), count(*)
    into n_lost, n_pend, n_void, n_all from bet_legs where bet_id = p_bet;
  if n_lost > 0 then st := 'perdida'; pay := 0;
  elsif n_pend > 0 then return;
  elsif n_void = n_all then st := 'anulada'; pay := b.stake;
  else
    for r in select odds from bet_legs where bet_id = p_bet and result = 'ganha' loop o := o * r.odds; end loop;
    st := 'ganha'; pay := least(floor(b.stake * round(o, 2))::integer, cap);
  end if;
  update bets set status = st, payout = pay, settled_at = now() where id = p_bet;
  if pay > 0 then
    rsn := case when st = 'anulada' then 'reembolso' else 'ganho' end;
    if b.currency = 'mt' then perform public.bets__post_mt(b.user_id, pay, rsn, b.id::text || ':' || b.version);
    else perform public.bets__post(b.user_id, pay, rsn, b.id::text || ':' || b.version); end if;
  end if;
end $$;

create or replace function public.bets__reopen_bets(p_markets uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare b bets;
begin
  for b in select * from bets where status <> 'aberta' and id in (select bet_id from bet_legs where market_id = any(p_markets)) for update loop
    if b.payout > 0 then
      if b.currency = 'mt' then perform public.bets__post_mt(b.user_id, -b.payout, 'correcao', b.id::text || ':' || b.version);
      else perform public.bets__post(b.user_id, -b.payout, 'correcao', b.id::text || ':' || b.version); end if;
    end if;
    update bets set version = version + 1, status = 'aberta', payout = 0, settled_at = null where id = b.id;
  end loop;
end $$;

-- 4. Jogador ---------------------------------------------------------------------------------
drop function if exists public.bets_place(uuid[], integer, numeric[], boolean);
create or replace function public.bets_place(p_selection_ids uuid[], p_stake integer, p_odds numeric[], p_accept_changes boolean default false, p_currency text default 'pontos') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); cfg bet_settings; l bet_limits; n integer := coalesce(array_length(p_selection_ids, 1), 0);
  r record; changed jsonb := '{}'; tot numeric := 1; bid uuid; bal integer; d0 timestamptz; w0 timestamptz; st_today integer; st_week integer;
  n_found integer; n_groups integer; n_closed integer; mn integer; mx integer; cap integer; lim_s integer; lim_d integer; lim_w integer; cur text := coalesce(p_currency, 'pontos');
begin
  if uid is null or not exists (select 1 from profiles where id = uid and not banned) then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if cur not in ('pontos','mt') then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet:' || uid::text, 0));
  select * into cfg from bet_settings where id = 1;
  if not cfg.bets_enabled then return jsonb_build_object('ok', false, 'code', 'BETS_OFF'); end if;
  select * into l from bet_limits where user_id = uid;
  if cur = 'mt' then
    if not public.bets__real_active() then return jsonb_build_object('ok', false, 'code', 'REAL_OFF'); end if;
    if not exists (select 1 from bet_kyc where user_id = uid and status = 'aprovado') then return jsonb_build_object('ok', false, 'code', 'KYC'); end if;
    mn := cfg.mt_min_stake; mx := cfg.mt_max_stake; cap := cfg.mt_max_payout; lim_s := l.mt_max_stake; lim_d := l.mt_max_daily; lim_w := l.mt_max_weekly;
  else
    mn := cfg.min_stake; mx := cfg.max_stake; cap := cfg.max_payout; lim_s := l.max_stake; lim_d := l.max_daily; lim_w := l.max_weekly;
  end if;
  if l.age_confirmed_at is null then return jsonb_build_object('ok', false, 'code', 'NO_AGE'); end if;
  if l.self_excluded_until is not null and l.self_excluded_until > now() then return jsonb_build_object('ok', false, 'code', 'SELF_EXCLUDED'); end if;
  if n = 0 then return jsonb_build_object('ok', false, 'code', 'EMPTY'); end if;
  if n > least(cfg.max_legs, 10) then return jsonb_build_object('ok', false, 'code', 'TOO_MANY_LEGS'); end if;
  if (select count(distinct x) from unnest(p_selection_ids) x) <> n or coalesce(array_length(p_odds, 1), 0) <> n then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  create temporary table if not exists _bet_slip (ord integer, selection_id uuid, market_id uuid, group_id text, odds numeric, is_open boolean) on commit drop;
  delete from _bet_slip;
  insert into _bet_slip
    select x.ord, s.id, m.id, coalesce(m.match_id::text, 't:' || m.tournament_id || ':' || m.id::text), s.odds,
      (m.status = 'aberto' and (m.closes_at is null or m.closes_at > now()) and (mt.id is null or (mt.status = 'agendado' and mt.starts_at > now() and not mt.voided)))
    from unnest(p_selection_ids) with ordinality as x(sid, ord)
    join bet_selections s on s.id = x.sid join bet_markets m on m.id = s.market_id left join bet_matches mt on mt.id = m.match_id;
  select count(*), count(distinct group_id), count(*) filter (where not is_open) into n_found, n_groups, n_closed from _bet_slip;
  if n_found <> n then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if n_groups <> n then return jsonb_build_object('ok', false, 'code', 'SAME_MATCH'); end if;
  if n_closed > 0 then return jsonb_build_object('ok', false, 'code', 'CLOSED'); end if;
  if p_stake is null or p_stake < mn then return jsonb_build_object('ok', false, 'code', 'STAKE_MIN'); end if;
  if p_stake > mx then return jsonb_build_object('ok', false, 'code', 'STAKE_MAX'); end if;
  if lim_s is not null and p_stake > lim_s then return jsonb_build_object('ok', false, 'code', 'LIMIT_STAKE'); end if;
  d0 := date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  w0 := date_trunc('week', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  select coalesce(sum(stake), 0) into st_today from bets where user_id = uid and currency = cur and created_at >= d0;
  select coalesce(sum(stake), 0) into st_week from bets where user_id = uid and currency = cur and created_at >= w0;
  if lim_d is not null and st_today + p_stake > lim_d then return jsonb_build_object('ok', false, 'code', 'LIMIT_DAILY'); end if;
  if lim_w is not null and st_week + p_stake > lim_w then return jsonb_build_object('ok', false, 'code', 'LIMIT_WEEKLY'); end if;
  if p_stake > (case when cur = 'mt' then public.bets__balance_mt(uid) else public.bets__balance(uid) end) then return jsonb_build_object('ok', false, 'code', 'BALANCE'); end if;
  for r in select * from _bet_slip order by ord loop
    if r.odds <> p_odds[r.ord] then changed := changed || jsonb_build_object(r.selection_id::text, r.odds); end if;
    tot := tot * r.odds;
  end loop;
  if changed <> '{}'::jsonb and not coalesce(p_accept_changes, false) then return jsonb_build_object('ok', false, 'code', 'ODDS_CHANGED', 'odds', changed); end if;
  tot := round(tot, 2);
  insert into bets (user_id, kind, stake, total_odds, potential, currency)
    values (uid, case when n > 1 then 'multipla' else 'simples' end, p_stake, tot, least(floor(p_stake * tot)::integer, cap), cur)
    returning id into bid;
  insert into bet_legs (bet_id, selection_id, market_id, group_id, odds) select bid, selection_id, market_id, group_id, odds from _bet_slip;
  if cur = 'mt' then bal := public.bets__post_mt(uid, -p_stake, 'aposta', bid::text); else bal := public.bets__post(uid, -p_stake, 'aposta', bid::text); end if;
  return jsonb_build_object('ok', true, 'bet_id', bid, 'balance', bal);
end $$;

create or replace function public.bets_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l bet_limits; d0 timestamptz; w0 timestamptz; k bet_kyc;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into l from bet_limits where user_id = uid;
  select * into k from bet_kyc where user_id = uid;
  d0 := date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  w0 := date_trunc('week', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  return jsonb_build_object('ok', true, 'balance', public.bets__balance(uid), 'balance_mt', public.bets__balance_mt(uid),
    'week_claimed', exists (select 1 from wallet_ledger where user_id = uid and reason = 'semanal' and ref = to_char(now() at time zone 'Africa/Maputo', 'IYYY-"W"IW')),
    'max_stake', l.max_stake, 'max_daily', l.max_daily, 'max_weekly', l.max_weekly,
    'mt_max_stake', l.mt_max_stake, 'mt_max_daily', l.mt_max_daily, 'mt_max_weekly', l.mt_max_weekly,
    'self_excluded_until', l.self_excluded_until, 'age_confirmed_at', l.age_confirmed_at,
    'kyc', case when k.user_id is null then null else jsonb_build_object('status', k.status, 'note', k.note, 'full_name', k.full_name, 'id_type', k.id_type, 'submitted_at', k.submitted_at) end,
    'staked_today', coalesce((select sum(stake) from bets where user_id = uid and currency = 'pontos' and created_at >= d0), 0),
    'staked_week', coalesce((select sum(stake) from bets where user_id = uid and currency = 'pontos' and created_at >= w0), 0),
    'mt_staked_today', coalesce((select sum(stake) from bets where user_id = uid and currency = 'mt' and created_at >= d0), 0),
    'mt_staked_week', coalesce((select sum(stake) from bets where user_id = uid and currency = 'mt' and created_at >= w0), 0));
end $$;

drop function if exists public.bets_set_limits(integer, integer, integer);
create or replace function public.bets_set_limits(p_max_stake integer, p_max_daily integer, p_max_weekly integer,
  p_mt_max_stake integer default null, p_mt_max_daily integer default null, p_mt_max_weekly integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if least(coalesce(p_max_stake, 1), coalesce(p_max_daily, 1), coalesce(p_max_weekly, 1), coalesce(p_mt_max_stake, 1), coalesce(p_mt_max_daily, 1), coalesce(p_mt_max_weekly, 1)) < 1 then
    return jsonb_build_object('ok', false, 'code', 'LIMIT'); end if;
  insert into bet_limits (user_id, max_stake, max_daily, max_weekly, mt_max_stake, mt_max_daily, mt_max_weekly)
    values (uid, p_max_stake, p_max_daily, p_max_weekly, p_mt_max_stake, p_mt_max_daily, p_mt_max_weekly)
    on conflict (user_id) do update set max_stake = excluded.max_stake, max_daily = excluded.max_daily, max_weekly = excluded.max_weekly,
      mt_max_stake = excluded.mt_max_stake, mt_max_daily = excluded.mt_max_daily, mt_max_weekly = excluded.mt_max_weekly, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_kyc_submit(p_full_name text, p_birth_date date, p_id_type text, p_id_number text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); idn text := upper(regexp_replace(coalesce(p_id_number, ''), '\s', '', 'g'));
  ph text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '^\+?258', '');
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if length(trim(coalesce(p_full_name, ''))) < 5 or position(' ' in trim(p_full_name)) = 0 then return jsonb_build_object('ok', false, 'code', 'KYC_INVALID'); end if;
  if p_birth_date is null or p_birth_date > (now() at time zone 'Africa/Maputo')::date - interval '18 years' then return jsonb_build_object('ok', false, 'code', 'MINOR'); end if;
  if not ((p_id_type = 'BI' and idn ~ '^[0-9]{12}[A-Z]$') or (p_id_type = 'NUIT' and idn ~ '^[0-9]{9}$')) or ph !~ '^8[4-7][0-9]{7}$' then return jsonb_build_object('ok', false, 'code', 'KYC_INVALID'); end if;
  if exists (select 1 from bet_kyc where user_id = uid and status = 'aprovado') then return jsonb_build_object('ok', false, 'code', 'KYC_LOCKED'); end if;
  insert into bet_kyc (user_id, full_name, birth_date, id_type, id_number, phone, status, note, submitted_at)
    values (uid, trim(p_full_name), p_birth_date, p_id_type, idn, ph, 'pendente', '', now())
    on conflict (user_id) do update set full_name = excluded.full_name, birth_date = excluded.birth_date, id_type = excluded.id_type, id_number = excluded.id_number,
      phone = excluded.phone, status = 'pendente', note = '', submitted_at = now(), reviewed_by = null, reviewed_at = null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_withdraw_request(p_amount integer, p_method text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cfg bet_settings; today_sum integer; wid uuid; ph text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '^\+?258', '');
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if not public.bets__real_active() then return jsonb_build_object('ok', false, 'code', 'REAL_OFF'); end if;
  if not exists (select 1 from bet_kyc where user_id = uid and status = 'aprovado') then return jsonb_build_object('ok', false, 'code', 'KYC'); end if;
  if p_method not in ('M-Pesa','e-Mola') or ph !~ '^8[4-7][0-9]{7}$' then return jsonb_build_object('ok', false, 'code', 'PHONE'); end if;
  perform pg_advisory_xact_lock(hashtextextended('money:' || uid::text, 0));
  select * into cfg from bet_settings where id = 1;
  if p_amount is null or p_amount < cfg.mt_min_withdraw then return jsonb_build_object('ok', false, 'code', 'MIN_WITHDRAW'); end if;
  select coalesce(sum(amount), 0) into today_sum from money_withdrawals where user_id = uid and status <> 'recusado'
    and created_at >= date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  if today_sum + p_amount > cfg.mt_max_withdraw_daily then return jsonb_build_object('ok', false, 'code', 'MAX_WITHDRAW'); end if;
  if p_amount > public.bets__balance_mt(uid) then return jsonb_build_object('ok', false, 'code', 'BALANCE'); end if;
  insert into money_withdrawals (user_id, amount, method, phone) values (uid, p_amount, p_method, ph) returning id into wid;
  perform public.bets__post_mt(uid, -p_amount, 'levantamento', wid::text);
  return jsonb_build_object('ok', true, 'id', wid, 'balance', public.bets__balance_mt(uid));
end $$;

-- 5. Admin ------------------------------------------------------------------------------------
drop function if exists public.bets_admin_set_real_money(boolean, text, date);
create or replace function public.bets_admin_set_real_money(p_on boolean, p_licence_no text, p_issue date, p_expiry date, p_confirm text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Africa/Maputo')::date; why text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_on then
    why := case
      when length(trim(coalesce(p_licence_no, ''))) = 0 then 'sem número de licença'
      when p_issue is null or p_expiry is null then 'sem datas da licença'
      when p_issue > today then 'emissão no futuro'
      when p_expiry <= today then 'licença fora da validade'
      when p_expiry <= p_issue then 'validade antes da emissão'
      when upper(trim(coalesce(p_confirm, ''))) <> 'CONFIRMO' then 'sem confirmação explícita'
      else null end;
    if why is not null then
      perform public.bets__log('dinheiro_real_recusado', 'bet_settings', jsonb_build_object('motivo', why));
      return jsonb_build_object('ok', false, 'code', 'IGJ', 'reason', why);
    end if;
  end if;
  update bet_settings set igj_licence_no = coalesce(trim(p_licence_no), ''), igj_licence_date = p_issue, igj_licence_expiry = p_expiry,
    real_money_enabled = p_on, updated_at = now() where id = 1;
  perform public.bets__log(case when p_on then 'dinheiro_real_ligado' else 'dinheiro_real_desligado' end, 'bet_settings',
    jsonb_build_object('licenca', trim(p_licence_no), 'emissao', p_issue, 'validade', p_expiry));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_admin_save_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old bet_settings; nw bet_settings; m uuid; t text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into old from bet_settings where id = 1;
  begin
    update bet_settings set
      margin = coalesce((p->>'margin')::numeric, margin),
      min_stake = coalesce((p->>'min_stake')::integer, min_stake),
      max_stake = coalesce((p->>'max_stake')::integer, max_stake),
      max_payout = coalesce((p->>'max_payout')::integer, max_payout),
      max_legs = coalesce((p->>'max_legs')::integer, max_legs),
      weekly_allowance = coalesce((p->>'weekly_allowance')::integer, weekly_allowance),
      elo_k = coalesce((p->>'elo_k')::numeric, elo_k),
      big_stake_alert = coalesce((p->>'big_stake_alert')::integer, big_stake_alert),
      same_selection_alert = coalesce((p->>'same_selection_alert')::integer, same_selection_alert),
      mt_min_stake = coalesce((p->>'mt_min_stake')::integer, mt_min_stake),
      mt_max_stake = coalesce((p->>'mt_max_stake')::integer, mt_max_stake),
      mt_max_payout = coalesce((p->>'mt_max_payout')::integer, mt_max_payout),
      mt_min_withdraw = coalesce((p->>'mt_min_withdraw')::integer, mt_min_withdraw),
      mt_max_withdraw_daily = coalesce((p->>'mt_max_withdraw_daily')::integer, mt_max_withdraw_daily),
      updated_at = now()
    where id = 1 returning * into nw;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end;
  if nw.margin <> old.margin then
    for m in select id from bet_matches where not voided and status = 'agendado' loop perform public.bets__price_match(m); end loop;
    for t in select tournament_id from bet_markets where kind = 'outright' and status in ('aberto','suspenso') loop perform public.bets__price_outright(t); end loop;
  end if;
  perform public.bets__log('definicoes_apostas', 'bet_settings', p - 'real_money_enabled' - 'igj_licence_no' - 'igj_licence_date' - 'igj_licence_expiry');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_admin_kyc_review(p_user uuid, p_status text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_status not in ('aprovado','recusado') then return jsonb_build_object('ok', false, 'code', 'ACTION'); end if;
  update bet_kyc set status = p_status, note = coalesce(p_note, ''), reviewed_by = auth.uid(), reviewed_at = now() where user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'code', 'KYC'); end if;
  perform public.bets__log(case when p_status = 'aprovado' then 'kyc_aprovado' else 'kyc_recusado' end, p_user::text, jsonb_build_object('nota', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- Depósito confirmado manualmente (enquanto não há API M-Pesa/e-Mola). Referência única = nunca credita duas vezes.
create or replace function public.bets_admin_deposit(p_user uuid, p_amount integer, p_method text, p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ref text := coalesce(p_method, '') || ':' || upper(trim(coalesce(p_reference, ''))); bal integer;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then return jsonb_build_object('ok', false, 'code', 'AMOUNT'); end if;
  if p_method not in ('M-Pesa','e-Mola','Banco','Outro') or length(trim(coalesce(p_reference, ''))) < 3 then return jsonb_build_object('ok', false, 'code', 'REF'); end if;
  if not exists (select 1 from bet_kyc where user_id = p_user and status = 'aprovado') then return jsonb_build_object('ok', false, 'code', 'KYC'); end if;
  if exists (select 1 from money_ledger where reason = 'deposito' and ref = v_ref) then return jsonb_build_object('ok', false, 'code', 'DUP_REF'); end if;
  bal := public.bets__post_mt(p_user, p_amount, 'deposito', v_ref);
  perform public.bets__log('deposito_manual', p_user::text, jsonb_build_object('valor', p_amount, 'metodo', p_method, 'referencia', trim(p_reference)));
  return jsonb_build_object('ok', true, 'balance', bal);
end $$;

create or replace function public.bets_admin_withdrawal(p_id uuid, p_action text, p_reference text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare w money_withdrawals;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into w from money_withdrawals where id = p_id for update;
  if w.id is null or w.status <> 'pendente' then return jsonb_build_object('ok', false, 'code', 'WITHDRAWAL'); end if;
  if p_action = 'pago' then
    if length(trim(coalesce(p_reference, ''))) < 3 then return jsonb_build_object('ok', false, 'code', 'REF'); end if;
    update money_withdrawals set status = 'pago', reference = trim(p_reference), decided_by = auth.uid(), decided_at = now() where id = p_id;
  elsif p_action = 'recusado' then
    update money_withdrawals set status = 'recusado', note = coalesce(trim(p_reference), ''), decided_by = auth.uid(), decided_at = now() where id = p_id;
    perform public.bets__post_mt(w.user_id, w.amount, 'levantamento_recusado', w.id::text);
  else return jsonb_build_object('ok', false, 'code', 'ACTION'); end if;
  perform public.bets__log(case when p_action = 'pago' then 'levantamento_pago' else 'levantamento_recusado' end, w.user_id::text,
    jsonb_build_object('valor', w.amount, 'metodo', w.method, 'referencia', trim(coalesce(p_reference, ''))));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_admin_money() returns jsonb
language plpgsql security definer set search_path = public as $$
declare k jsonb; w jsonb; t jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select coalesce(jsonb_agg(x order by x.status <> 'pendente', x.submitted_at desc), '[]') into k from (
    select b.user_id, p.handle, b.full_name, b.birth_date, b.id_type, b.id_number, b.phone, b.status, b.note, b.submitted_at, public.bets__balance_mt(b.user_id) as balance
    from bet_kyc b left join profiles p on p.id = b.user_id order by b.submitted_at desc limit 300) x;
  select coalesce(jsonb_agg(x order by x.status <> 'pendente', x.created_at desc), '[]') into w from (
    select m.id, m.user_id, p.handle, m.amount, m.method, m.phone, m.status, m.reference, m.note, m.created_at, m.decided_at
    from money_withdrawals m left join profiles p on p.id = m.user_id order by m.created_at desc limit 300) x;
  select jsonb_build_object(
    'deposits', coalesce((select sum(delta) from money_ledger where reason = 'deposito'), 0),
    'withdrawn', coalesce((select sum(amount) from money_withdrawals where status = 'pago'), 0),
    'pending_withdrawals', coalesce((select sum(amount) from money_withdrawals where status = 'pendente'), 0),
    'balances', coalesce((select sum(public.bets__balance_mt(u)) from (select distinct user_id u from money_ledger) z), 0)) into t;
  return jsonb_build_object('ok', true, 'kyc', k, 'withdrawals', w, 'totals', t);
end $$;


-- Painel admin: exposição, alertas e totais separados por moeda (pontos vs MT)
create or replace function public.bets_admin_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg bet_settings; ex jsonb; al jsonb; us jsonb; tot jsonb;
begin
  if not public.bets__can_manage() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into cfg from bet_settings where id = 1;
  select coalesce(jsonb_agg(x order by x.liability desc, x.staked desc), '[]') into ex from (
    select s.id as selection_id, b.currency, s.label, m.title as market, coalesce(mt.home || ' vs ' || mt.away, m.tournament_name) as event,
      count(*)::integer as bets, sum(b.stake)::integer as staked, coalesce(sum(b.potential) filter (where b.status = 'aberta'), 0)::integer as liability
    from bet_legs l join bets b on b.id = l.bet_id join bet_selections s on s.id = l.selection_id join bet_markets m on m.id = l.market_id
    left join bet_matches mt on mt.id = m.match_id
    group by s.id, b.currency, s.label, m.title, mt.home, mt.away, m.tournament_name
    order by liability desc, staked desc limit 100) x;
  select coalesce(jsonb_agg(a), '[]') into al from (
    (select 'aposta_grande' as kind, 'Aposta grande: ' || b.stake || case when b.currency = 'mt' then ' MT' else ' pts' end || ' (@' || coalesce(p.handle, '?') || ')' as text, b.id::text as ref, b.created_at as at
      from bets b left join profiles p on p.id = b.user_id
      where b.stake >= case when b.currency = 'mt' then least(cfg.big_stake_alert, cfg.mt_max_stake) else cfg.big_stake_alert end order by b.created_at desc limit 50)
    union all
    (select 'concentracao', count(*) || ' apostas na mesma seleção: ' || s.label || ' · ' || coalesce(mt.home || ' vs ' || mt.away, m.tournament_name), s.id::text, max(b.created_at)
      from bet_legs l join bets b on b.id = l.bet_id join bet_selections s on s.id = l.selection_id join bet_markets m on m.id = s.market_id left join bet_matches mt on mt.id = m.match_id
      group by s.id, s.label, mt.home, mt.away, m.tournament_name having count(*) >= cfg.same_selection_alert limit 50)
  ) a;
  select coalesce(jsonb_agg(u order by u.staked desc), '[]') into us from (
    select b.user_id, coalesce(p.handle, '?') as handle, count(*)::integer as bets, sum(b.stake) filter (where b.currency = 'pontos')::integer as staked,
      sum(b.payout) filter (where b.currency = 'pontos')::integer as returned, sum(b.stake) filter (where b.currency = 'mt')::integer as staked_mt,
      count(*) filter (where b.status = 'aberta')::integer as open, public.bets__balance(b.user_id) as balance, public.bets__balance_mt(b.user_id) as balance_mt
    from bets b left join profiles p on p.id = b.user_id group by b.user_id, p.handle order by count(*) desc limit 100) u;
  select jsonb_build_object('bets', count(*), 'open', count(*) filter (where status = 'aberta'),
    'staked', coalesce(sum(stake) filter (where currency = 'pontos'), 0), 'paid', coalesce(sum(payout) filter (where currency = 'pontos'), 0),
    'liability', coalesce(sum(potential) filter (where status = 'aberta' and currency = 'pontos'), 0),
    'staked_mt', coalesce(sum(stake) filter (where currency = 'mt'), 0), 'paid_mt', coalesce(sum(payout) filter (where currency = 'mt'), 0),
    'liability_mt', coalesce(sum(potential) filter (where status = 'aberta' and currency = 'mt'), 0)) into tot from bets;
  return jsonb_build_object('ok', true, 'exposure', ex, 'alerts', al, 'users', us, 'totals', tot);
end $$;

create or replace function public.bets_admin_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  update bet_settings set bets_enabled = p_on, updated_at = now() where id = 1;
  perform public.bets__log(case when p_on then 'apostas_ativadas' else 'apostas_desativadas' end, 'bet_settings', '{}');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.bets_admin_set_enabled(boolean) from public, anon;
grant execute on function public.bets_admin_set_enabled(boolean) to authenticated;

-- 6. RLS e permissões -------------------------------------------------------------------------
alter table public.money_ledger enable row level security;
alter table public.bet_kyc enable row level security;
alter table public.money_withdrawals enable row level security;
drop policy if exists money_ledger_read on public.money_ledger;
create policy money_ledger_read on public.money_ledger for select using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists bet_kyc_read on public.bet_kyc;
create policy bet_kyc_read on public.bet_kyc for select using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists money_withdrawals_read on public.money_withdrawals;
create policy money_withdrawals_read on public.money_withdrawals for select using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke insert, update, delete, truncate on public.money_ledger, public.bet_kyc, public.money_withdrawals from anon, authenticated;
grant select on public.money_ledger, public.bet_kyc, public.money_withdrawals to authenticated;

revoke all on function public.bets__balance_mt(uuid), public.bets__post_mt(uuid, integer, text, text), public.bets__real_active(),
  public.bets__settle_bet(uuid), public.bets__reopen_bets(uuid[]) from public, anon, authenticated;
revoke all on function public.bets_place(uuid[], integer, numeric[], boolean, text), public.bets_me(), public.bets_set_limits(integer, integer, integer, integer, integer, integer),
  public.bets_kyc_submit(text, date, text, text, text), public.bets_withdraw_request(integer, text, text),
  public.bets_admin_set_real_money(boolean, text, date, date, text), public.bets_admin_save_settings(jsonb), public.bets_admin_kyc_review(uuid, text, text),
  public.bets_admin_deposit(uuid, integer, text, text), public.bets_admin_withdrawal(uuid, text, text), public.bets_admin_money() from public, anon;
grant execute on function public.bets_place(uuid[], integer, numeric[], boolean, text), public.bets_me(), public.bets_set_limits(integer, integer, integer, integer, integer, integer),
  public.bets_kyc_submit(text, date, text, text, text), public.bets_withdraw_request(integer, text, text),
  public.bets_admin_set_real_money(boolean, text, date, date, text), public.bets_admin_save_settings(jsonb), public.bets_admin_kyc_review(uuid, text, text),
  public.bets_admin_deposit(uuid, integer, text, text), public.bets_admin_withdrawal(uuid, text, text), public.bets_admin_money() to authenticated;

notify pgrst, 'reload schema';
