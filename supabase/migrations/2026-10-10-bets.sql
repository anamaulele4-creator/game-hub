-- =====================================================================
-- TXAPILOG · Apostas com TXAP Pontos (2026-10-10). IDEMPOTENTE — pode correr várias vezes.
-- Pontos virtuais SEM valor monetário: não se compram, não se levantam, não se convertem.
-- Dinheiro real fica bloqueado: só com nº + data da licença da IGJ (Inspecção Geral de Jogos) E pagamentos ativos.
-- Tudo determinístico e escrito à mão (sem IA): Elo → probabilidades → margem → odds (2 casas, 1.05–50).
-- Espelha lib/bets.ts + lib/betsCore.ts (testes em tests/bets.test.mjs).
-- Clientes só LÊEM; tudo o que mexe em saldos/apostas passa por funções SECURITY DEFINER atómicas.
-- =====================================================================

create extension if not exists pgcrypto;

-- 1. Tabelas --------------------------------------------------------------------------
create table if not exists public.bet_settings (
  id integer primary key default 1 check (id = 1),
  margin numeric(5,4) not null default 0.07 check (margin >= 0 and margin <= 0.5),
  min_stake integer not null default 10,
  max_stake integer not null default 5000,
  max_payout integer not null default 100000,
  max_legs integer not null default 10 check (max_legs between 1 and 10),
  weekly_allowance integer not null default 1000 check (weekly_allowance between 0 and 100000),
  elo_k numeric(6,2) not null default 32 check (elo_k > 0 and elo_k <= 100),
  big_stake_alert integer not null default 2000,
  same_selection_alert integer not null default 20,
  real_money_enabled boolean not null default false,
  igj_licence_no text not null default '',
  igj_licence_date date,
  updated_at timestamptz not null default now(),
  constraint bet_settings_stakes check (min_stake >= 1 and max_stake >= min_stake and max_payout >= max_stake),
  constraint bet_settings_real_money check (not real_money_enabled or (length(trim(igj_licence_no)) > 0 and igj_licence_date is not null))
);
insert into public.bet_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.bet_teams (
  id uuid primary key default gen_random_uuid(),
  game_key text not null check (game_key in ('ff','cr','ef','dls','outros')),
  name text not null check (length(trim(name)) between 1 and 60),
  rating numeric(8,2) not null default 1500,
  played integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists bet_teams_uq on public.bet_teams (game_key, lower(name));

create table if not exists public.bet_matches (
  id uuid primary key default gen_random_uuid(),
  game_key text not null check (game_key in ('ff','cr','ef','dls','outros')),
  tournament_id text references public.tournaments(id) on delete set null,
  tournament_name text not null default '',
  home_team_id uuid not null references public.bet_teams(id),
  away_team_id uuid not null references public.bet_teams(id),
  home text not null,
  away text not null,
  starts_at timestamptz not null,
  original_starts_at timestamptz not null,
  status text not null default 'agendado' check (status in ('agendado','ao_vivo','terminado','cancelado','adiado')),
  home_score integer check (home_score >= 0),
  away_score integer check (away_score >= 0),
  settled_version integer not null default 0,
  elo_home numeric(8,2) not null default 0,
  elo_away numeric(8,2) not null default 0,
  elo_applied boolean not null default false,
  voided boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bet_matches_teams check (home_team_id <> away_team_id)
);
create index if not exists bet_matches_status_idx on public.bet_matches (status, starts_at);
create index if not exists bet_matches_tournament_idx on public.bet_matches (tournament_id);

create table if not exists public.bet_markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.bet_matches(id) on delete cascade,
  tournament_id text,
  tournament_name text not null default '',
  game_key text not null,
  kind text not null check (kind in ('1x2','12','total','exact','outright')),
  line numeric(6,1),
  title text not null,
  status text not null default 'aberto' check (status in ('aberto','suspenso','liquidado','anulado')),
  auto_suspended boolean not null default false,
  manual_void boolean not null default false,
  margin numeric(5,4) check (margin is null or (margin >= 0 and margin <= 0.5)),
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint bet_markets_scope check ((kind = 'outright') = (match_id is null))
);
create unique index if not exists bet_markets_match_kind_uq on public.bet_markets (match_id, kind) where match_id is not null;
create unique index if not exists bet_markets_outright_uq on public.bet_markets (tournament_id) where kind = 'outright';
create index if not exists bet_markets_status_idx on public.bet_markets (status);

create table if not exists public.bet_selections (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.bet_markets(id) on delete cascade,
  code text not null,
  label text not null,
  prob double precision not null default 0,
  odds numeric(8,2) not null default 1.05 check (odds >= 1.01),
  manual boolean not null default false,
  result text not null default 'pendente' check (result in ('pendente','ganha','perdida','anulada')),
  sort integer not null default 0,
  unique (market_id, code)
);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('simples','multipla')),
  stake integer not null check (stake > 0),
  total_odds numeric(14,2) not null,
  potential integer not null,
  status text not null default 'aberta' check (status in ('aberta','ganha','perdida','anulada')),
  payout integer not null default 0,
  version integer not null default 1,
  currency text not null default 'pontos' check (currency = 'pontos'),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists bets_user_idx on public.bets (user_id, created_at desc);
create index if not exists bets_status_idx on public.bets (status, created_at desc);

create table if not exists public.bet_legs (
  bet_id uuid not null references public.bets(id) on delete cascade,
  selection_id uuid not null references public.bet_selections(id),
  market_id uuid not null references public.bet_markets(id),
  group_id text not null,
  odds numeric(8,2) not null,
  result text not null default 'pendente' check (result in ('pendente','ganha','perdida','anulada')),
  primary key (bet_id, selection_id)
);
create index if not exists bet_legs_sel_idx on public.bet_legs (selection_id);
create index if not exists bet_legs_market_idx on public.bet_legs (market_id);

-- Carteira = livro-razão só de acréscimos. Saldo = balance_after do último movimento (= soma dos deltas).
create table if not exists public.wallet_ledger (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('semanal','aposta','ganho','reembolso','correcao','ajuste')),
  ref text not null,
  balance_after integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, ref),
  constraint wallet_ledger_nonneg check (balance_after >= 0 or reason = 'correcao')
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger (user_id, id desc);

create or replace function public.bets__tg_ledger_immutable() returns trigger language plpgsql as $$
begin raise exception 'wallet_ledger é só de acréscimos'; end $$;
drop trigger if exists wallet_ledger_immutable on public.wallet_ledger;
create trigger wallet_ledger_immutable before update on public.wallet_ledger for each row execute function public.bets__tg_ledger_immutable();

create table if not exists public.bet_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  max_stake integer check (max_stake is null or max_stake >= 1),
  max_daily integer check (max_daily is null or max_daily >= 1),
  max_weekly integer check (max_weekly is null or max_weekly >= 1),
  self_excluded_until timestamptz,
  age_confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.bet_admin_log (
  id bigserial primary key,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  actor_handle text,
  action text not null,
  target text not null default '',
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists bet_admin_log_created_idx on public.bet_admin_log (created_at desc);

-- 2. Motor de odds (determinístico) ----------------------------------------------------
create or replace function public.bets__total_mean(g text) returns double precision language sql immutable as $$
  select case g when 'ef' then 2.7 when 'dls' then 3.1 when 'ff' then 20 when 'cr' then 2.6 else 3 end::double precision $$;
create or replace function public.bets__total_line(g text) returns numeric language sql immutable as $$
  select case g when 'ff' then 19.5 else 2.5 end::numeric $$;
create or replace function public.bets__unit(g text) returns text language sql immutable as $$
  select case g when 'ef' then 'golos' when 'dls' then 'golos' when 'ff' then 'kills' when 'cr' then 'coroas' else 'pontos' end $$;
create or replace function public.bets__elo_exp(ra double precision, rb double precision) returns double precision language sql immutable as $$
  select 1.0 / (1.0 + power(10.0::double precision, (rb - ra) / 400.0)) $$;
create or replace function public.bets__price(p double precision, m double precision) returns numeric language sql immutable as $$
  select case when p is null or p <= 0 then 50.00 else least(50.00, greatest(1.05, round((1.0 / (p * (1.0 + m)))::numeric, 2))) end $$;
create or replace function public.bets__poisson(lam double precision, mx integer) returns double precision[] language plpgsql immutable as $$
declare r double precision[] := '{}'; p double precision := exp(-lam); k integer;
begin
  for k in 0..mx loop r := r || p; p := p * lam / (k + 1); end loop;
  return r;
end $$;

create or replace function public.bets__specs(g text, home text, away text, rh double precision, ra double precision)
returns table (kind text, line numeric, title text, code text, label text, prob double precision, sort integer)
language plpgsql immutable as $$
declare
  ln numeric := public.bets__total_line(g); mean double precision := public.bets__total_mean(g);
  e double precision := public.bets__elo_exp(rh, ra);
  pm double precision[]; ph double precision[]; pa double precision[];
  cdf double precision := 0; ov double precision; k integer; h integer; a integer;
  s double precision := 0; p1 double precision := 0; px double precision := 0; p2 double precision := 0; v double precision; listed double precision := 0; i integer := 0;
  tt text := 'Total de ' || public.bets__unit(g) || ' · Mais/Menos ' || ln::text;
begin
  pm := public.bets__poisson(mean, floor(ln)::integer);
  for k in 0..floor(ln)::integer loop cdf := cdf + pm[k + 1]; end loop;
  ov := least(1, greatest(0, 1 - cdf));
  if g not in ('ef','dls') then
    kind := '12'; line := null; title := 'Vencedor';
    code := '1'; label := home; prob := e; sort := 0; return next;
    code := '2'; label := away; prob := 1 - e; sort := 1; return next;
  else
    ph := public.bets__poisson(mean * e, 10); pa := public.bets__poisson(mean * (1 - e), 10);
    for h in 0..10 loop for a in 0..10 loop s := s + ph[h + 1] * pa[a + 1]; end loop; end loop;
    for h in 0..10 loop for a in 0..10 loop
      v := ph[h + 1] * pa[a + 1] / s;
      if h > a then p1 := p1 + v; elsif h = a then px := px + v; else p2 := p2 + v; end if;
    end loop; end loop;
    kind := '1x2'; line := null; title := 'Vencedor';
    code := '1'; label := home; prob := p1; sort := 0; return next;
    code := 'X'; label := 'Empate'; prob := px; sort := 1; return next;
    code := '2'; label := away; prob := p2; sort := 2; return next;
  end if;
  kind := 'total'; line := ln; title := tt;
  code := 'over'; label := 'Mais de ' || ln::text; prob := ov; sort := 0; return next;
  code := 'under'; label := 'Menos de ' || ln::text; prob := 1 - ov; sort := 1; return next;
  if g in ('ef','dls') then
    kind := 'exact'; line := null; title := 'Resultado exato';
    for h in 0..3 loop for a in 0..3 loop
      v := ph[h + 1] * pa[a + 1] / s; listed := listed + v;
      code := h || '-' || a; label := code; prob := v; sort := i; i := i + 1; return next;
    end loop; end loop;
    code := 'outro'; label := 'Outro resultado'; prob := greatest(0, 1 - listed); sort := 16; return next;
  end if;
end $$;

create or replace function public.bets__sel_result(k text, c text, ln numeric, h integer, a integer) returns text language sql immutable as $$
  select case k
    when '1x2' then case when c = (case when h > a then '1' when h = a then 'X' else '2' end) then 'ganha' else 'perdida' end
    when '12' then case when h = a then 'anulada' when c = (case when h > a then '1' else '2' end) then 'ganha' else 'perdida' end
    when 'total' then case when (c = 'over') = (h + a > coalesce(ln, 0)) then 'ganha' else 'perdida' end
    when 'exact' then case when c = (case when h <= 3 and a <= 3 then h || '-' || a else 'outro' end) then 'ganha' else 'perdida' end
    else 'pendente' end $$;

-- 3. Mercados ---------------------------------------------------------------------------
create or replace function public.bets__price_outright(p_tid text) returns void
language plpgsql security definer set search_path = public as $$
declare mk bet_markets; cfg bet_settings; tot double precision;
begin
  select * into mk from bet_markets where kind = 'outright' and tournament_id = p_tid;
  if mk.id is null or mk.status not in ('aberto','suspenso') then return; end if;
  select * into cfg from bet_settings where id = 1;
  select sum(power(10.0::double precision, t.rating::double precision / 400.0)) into tot
    from bet_teams t where t.id in (select home_team_id from bet_matches where tournament_id = p_tid and not voided union select away_team_id from bet_matches where tournament_id = p_tid and not voided);
  update bet_selections s set
    prob = coalesce(power(10.0::double precision, t.rating::double precision / 400.0) / nullif(tot, 0), 0),
    odds = case when s.manual then s.odds else public.bets__price(coalesce(power(10.0::double precision, t.rating::double precision / 400.0) / nullif(tot, 0), 0), coalesce(mk.margin, cfg.margin)::double precision) end
  from bet_teams t
  where s.market_id = mk.id and t.game_key = mk.game_key and lower(t.name) = lower(s.code);
  update bet_selections s set sort = o.rn from (select id, row_number() over (order by label) - 1 as rn from bet_selections where market_id = mk.id) o where s.id = o.id;
end $$;

create or replace function public.bets__ensure_outright(p_tid text) returns void
language plpgsql security definer set search_path = public as $$
declare mk bet_markets; n integer; g text; tn text; cl timestamptz; cfg bet_settings;
begin
  if p_tid is null then return; end if;
  select count(*) into n from (select home_team_id from bet_matches where tournament_id = p_tid and not voided union select away_team_id from bet_matches where tournament_id = p_tid and not voided) x;
  if n < 2 then return; end if;
  select game_key, tournament_name into g, tn from bet_matches where tournament_id = p_tid order by created_at limit 1;
  select min(starts_at) into cl from bet_matches where tournament_id = p_tid and not voided;
  select * into cfg from bet_settings where id = 1;
  insert into bet_markets (match_id, tournament_id, tournament_name, game_key, kind, line, title, closes_at)
    values (null, p_tid, tn, g, 'outright', null, 'Vencedor do torneio', cl)
    on conflict (tournament_id) where kind = 'outright' do nothing;
  select * into mk from bet_markets where kind = 'outright' and tournament_id = p_tid;
  if mk.status not in ('aberto','suspenso') then return; end if;
  update bet_markets set closes_at = cl where id = mk.id;
  insert into bet_selections (market_id, code, label, prob, odds)
    select mk.id, t.name, t.name, 0, 1.05 from bet_teams t
    where t.id in (select home_team_id from bet_matches where tournament_id = p_tid and not voided union select away_team_id from bet_matches where tournament_id = p_tid and not voided)
    on conflict (market_id, code) do nothing;
  perform public.bets__price_outright(p_tid);
end $$;

create or replace function public.bets__ensure_markets(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt bet_matches; cfg bet_settings; rh double precision; ra double precision; r record; mid uuid;
begin
  select * into mt from bet_matches where id = p_match;
  if mt.id is null then return; end if;
  select * into cfg from bet_settings where id = 1;
  select rating into rh from bet_teams where id = mt.home_team_id;
  select rating into ra from bet_teams where id = mt.away_team_id;
  for r in select distinct on (s.kind) s.kind, s.line, s.title from public.bets__specs(mt.game_key, mt.home, mt.away, rh, ra) s loop
    if not exists (select 1 from bet_markets where match_id = p_match and kind = r.kind) then
      insert into bet_markets (match_id, tournament_id, tournament_name, game_key, kind, line, title, closes_at)
        values (p_match, mt.tournament_id, mt.tournament_name, mt.game_key, r.kind, r.line, r.title, mt.starts_at) returning id into mid;
      insert into bet_selections (market_id, code, label, prob, odds, sort)
        select mid, s.code, s.label, s.prob, public.bets__price(s.prob, cfg.margin::double precision), s.sort
        from public.bets__specs(mt.game_key, mt.home, mt.away, rh, ra) s where s.kind = r.kind;
    end if;
  end loop;
  perform public.bets__ensure_outright(mt.tournament_id);
end $$;

create or replace function public.bets__price_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt bet_matches; cfg bet_settings; rh double precision; ra double precision;
begin
  select * into mt from bet_matches where id = p_match;
  if mt.id is null then return; end if;
  select * into cfg from bet_settings where id = 1;
  select rating into rh from bet_teams where id = mt.home_team_id;
  select rating into ra from bet_teams where id = mt.away_team_id;
  update bet_selections s set prob = sp.prob,
    odds = case when s.manual then s.odds else public.bets__price(sp.prob, coalesce(m.margin, cfg.margin)::double precision) end
  from bet_markets m, public.bets__specs(mt.game_key, mt.home, mt.away, rh, ra) sp
  where m.match_id = p_match and m.status in ('aberto','suspenso') and s.market_id = m.id and sp.kind = m.kind and sp.code = s.code;
end $$;

create or replace function public.bets__tg_match_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.bets__ensure_markets(new.id); return null; end $$;
drop trigger if exists bet_match_open_markets on public.bet_matches;
create trigger bet_match_open_markets after insert on public.bet_matches for each row execute function public.bets__tg_match_insert();

-- 4. Carteira e liquidação -------------------------------------------------------------
create or replace function public.bets__balance(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select balance_after from wallet_ledger where user_id = p_user order by id desc limit 1), 0) $$;

create or replace function public.bets__post(p_user uuid, p_delta integer, p_reason text, p_ref text) returns integer
language plpgsql security definer set search_path = public as $$
declare bal integer; nb integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('wallet:' || p_user::text, 0));
  if exists (select 1 from wallet_ledger where user_id = p_user and reason = p_reason and ref = p_ref) then return public.bets__balance(p_user); end if;
  bal := public.bets__balance(p_user);
  nb := bal + p_delta;
  if nb < 0 and p_reason <> 'correcao' then raise exception 'BALANCE'; end if;
  insert into wallet_ledger (user_id, delta, reason, ref, balance_after) values (p_user, p_delta, p_reason, p_ref, nb);
  return nb;
end $$;

create or replace function public.bets__settle_bet(p_bet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b bets; cfg bet_settings; n_lost integer; n_pend integer; n_void integer; n_all integer; o numeric := 1; r record; pay integer; st text;
begin
  select * into b from bets where id = p_bet for update;
  if b.id is null or b.status <> 'aberta' then return; end if;
  select * into cfg from bet_settings where id = 1;
  update bet_legs l set result = s.result from bet_selections s where l.bet_id = p_bet and s.id = l.selection_id;
  select count(*) filter (where result = 'perdida'), count(*) filter (where result = 'pendente'), count(*) filter (where result = 'anulada'), count(*)
    into n_lost, n_pend, n_void, n_all from bet_legs where bet_id = p_bet;
  if n_lost > 0 then st := 'perdida'; pay := 0;
  elsif n_pend > 0 then return;
  elsif n_void = n_all then st := 'anulada'; pay := b.stake;
  else
    for r in select odds from bet_legs where bet_id = p_bet and result = 'ganha' loop o := o * r.odds; end loop;
    st := 'ganha'; pay := least(floor(b.stake * round(o, 2))::integer, cfg.max_payout);
  end if;
  update bets set status = st, payout = pay, settled_at = now() where id = p_bet;
  if pay > 0 then perform public.bets__post(b.user_id, pay, case when st = 'anulada' then 'reembolso' else 'ganho' end, b.id::text || ':' || b.version); end if;
end $$;

create or replace function public.bets__reopen_bets(p_markets uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare b bets;
begin
  for b in select * from bets where status <> 'aberta' and id in (select bet_id from bet_legs where market_id = any(p_markets)) for update loop
    if b.payout > 0 then perform public.bets__post(b.user_id, -b.payout, 'correcao', b.id::text || ':' || b.version); end if;
    update bets set version = version + 1, status = 'aberta', payout = 0, settled_at = null where id = b.id;
  end loop;
end $$;

create or replace function public.bets__settle_markets(p_markets uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  for bid in select distinct bet_id from bet_legs l join bets b on b.id = l.bet_id where l.market_id = any(p_markets) and b.status = 'aberta' loop
    perform public.bets__settle_bet(bid);
  end loop;
end $$;

-- Resultado (ou anulação) de um jogo → liquida tudo. Também corrige um resultado já liquidado.
create or replace function public.bets__apply_outcome(p_match uuid, p_mode text, p_h integer, p_a integer) returns void
language plpgsql security definer set search_path = public as $$
declare mt bet_matches; cfg bet_settings; mks uuid[]; rh numeric; ra numeric; e double precision; sc double precision; d numeric; o uuid;
begin
  select * into mt from bet_matches where id = p_match for update;
  if mt.id is null then raise exception 'MATCH'; end if;
  select * into cfg from bet_settings where id = 1;
  select coalesce(array_agg(id), '{}') into mks from bet_markets where match_id = p_match;
  if mt.settled_version > 0 then
    perform public.bets__reopen_bets(mks);
    if mt.elo_applied then
      update bet_teams set rating = rating - mt.elo_home, played = played - 1 where id = mt.home_team_id;
      update bet_teams set rating = rating - mt.elo_away, played = played - 1 where id = mt.away_team_id;
      update bet_matches set elo_applied = false, elo_home = 0, elo_away = 0 where id = p_match;
    end if;
  end if;
  if p_mode = 'void' then
    update bet_matches set voided = true, status = case when status = 'adiado' then 'adiado' else 'cancelado' end, updated_at = now() where id = p_match;
    update bet_markets set status = 'anulado', settled_at = now() where match_id = p_match;
    update bet_selections set result = 'anulada' where market_id = any(mks);
  else
    if p_h is null or p_a is null or p_h < 0 or p_a < 0 then raise exception 'SCORE'; end if;
    update bet_matches set home_score = p_h, away_score = p_a, status = 'terminado', voided = false, updated_at = now() where id = p_match;
    update bet_markets set status = 'liquidado', settled_at = now() where match_id = p_match and not manual_void;
    update bet_selections s set result = public.bets__sel_result(m.kind, s.code, m.line, p_h, p_a)
      from bet_markets m where s.market_id = m.id and m.match_id = p_match and not m.manual_void;
    select rating into rh from bet_teams where id = mt.home_team_id;
    select rating into ra from bet_teams where id = mt.away_team_id;
    e := public.bets__elo_exp(rh::double precision, ra::double precision);
    sc := case when p_h > p_a then 1 when p_h = p_a then 0.5 else 0 end;
    d := round((cfg.elo_k::double precision * (sc - e))::numeric, 2);
    update bet_teams set rating = rating + d, played = played + 1 where id = mt.home_team_id;
    update bet_teams set rating = rating - d, played = played + 1 where id = mt.away_team_id;
    update bet_matches set elo_home = d, elo_away = -d, elo_applied = true where id = p_match;
    for o in select id from bet_matches where id <> p_match and not voided and status = 'agendado'
      and (home_team_id in (mt.home_team_id, mt.away_team_id) or away_team_id in (mt.home_team_id, mt.away_team_id)) loop
      perform public.bets__price_match(o);
    end loop;
  end if;
  update bet_matches set settled_version = settled_version + 1 where id = p_match;
  if mt.tournament_id is not null then perform public.bets__ensure_outright(mt.tournament_id); perform public.bets__price_outright(mt.tournament_id); end if;
  perform public.bets__settle_markets(mks);
end $$;

-- 5. Automação: bets_sweep() (pg_cron a cada minuto + chamada ao abrir a página). Idempotente. -----------
create or replace function public.bets_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare mt bet_matches; n_susp integer := 0; n_open integer := 0; n_void integer := 0; c integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('bets_sweep', 0)) then return jsonb_build_object('skipped', true); end if;
  for mt in select * from bet_matches where not voided and status <> 'terminado' order by starts_at loop
    if mt.status = 'cancelado' or (mt.status = 'adiado' and (now() > mt.original_starts_at + interval '48 hours' or mt.starts_at > mt.original_starts_at + interval '48 hours')) then
      perform public.bets__apply_outcome(mt.id, 'void', null, null); n_void := n_void + 1; continue;
    end if;
    if mt.status = 'agendado' and mt.starts_at <= now() then
      update bet_matches set status = 'ao_vivo', updated_at = now() where id = mt.id; mt.status := 'ao_vivo';
    end if;
    if mt.status = 'agendado' and not exists (select 1 from bet_markets where match_id = mt.id) then perform public.bets__ensure_markets(mt.id); end if;
    update bet_markets set status = 'suspenso', auto_suspended = true where match_id = mt.id and status = 'aberto' and (mt.starts_at <= now() or mt.status <> 'agendado');
    get diagnostics c = row_count; n_susp := n_susp + c;
    update bet_markets set status = 'aberto', auto_suspended = false where match_id = mt.id and status = 'suspenso' and auto_suspended and mt.status = 'agendado' and mt.starts_at > now();
    get diagnostics c = row_count; n_open := n_open + c;
    update bet_markets set closes_at = mt.starts_at where match_id = mt.id and closes_at is distinct from mt.starts_at;
  end loop;
  update bet_markets set status = 'suspenso', auto_suspended = true where kind = 'outright' and status = 'aberto' and closes_at is not null and closes_at <= now();
  get diagnostics c = row_count; n_susp := n_susp + c;
  return jsonb_build_object('suspended', n_susp, 'reopened', n_open, 'voided', n_void);
end $$;

-- 6. Jogador -------------------------------------------------------------------------------
create or replace function public.bets_claim_weekly() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); wk text := to_char(now() at time zone 'Africa/Maputo', 'IYYY-"W"IW'); had boolean; bal integer; amt integer;
begin
  if uid is null or not exists (select 1 from profiles where id = uid and not banned) then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select weekly_allowance into amt from bet_settings where id = 1;
  had := exists (select 1 from wallet_ledger where user_id = uid and reason = 'semanal' and ref = wk);
  if had or amt <= 0 then bal := public.bets__balance(uid); else bal := public.bets__post(uid, amt, 'semanal', wk); end if;
  return jsonb_build_object('ok', true, 'credited', not had and amt > 0, 'balance', bal, 'week', wk);
end $$;

create or replace function public.bets_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l bet_limits; d0 timestamptz; w0 timestamptz;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into l from bet_limits where user_id = uid;
  d0 := date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  w0 := date_trunc('week', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  return jsonb_build_object('ok', true, 'balance', public.bets__balance(uid),
    'week_claimed', exists (select 1 from wallet_ledger where user_id = uid and reason = 'semanal' and ref = to_char(now() at time zone 'Africa/Maputo', 'IYYY-"W"IW')),
    'max_stake', l.max_stake, 'max_daily', l.max_daily, 'max_weekly', l.max_weekly,
    'self_excluded_until', l.self_excluded_until, 'age_confirmed_at', l.age_confirmed_at,
    'staked_today', coalesce((select sum(stake) from bets where user_id = uid and created_at >= d0), 0),
    'staked_week', coalesce((select sum(stake) from bets where user_id = uid and created_at >= w0), 0));
end $$;

create or replace function public.bets_confirm_age() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); bd date;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select birth_date into bd from profiles where id = uid;
  if bd is not null and bd > (now() at time zone 'Africa/Maputo')::date - interval '18 years' then return jsonb_build_object('ok', false, 'code', 'MINOR'); end if;
  insert into bet_limits (user_id, age_confirmed_at) values (uid, now())
    on conflict (user_id) do update set age_confirmed_at = coalesce(bet_limits.age_confirmed_at, now()), updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_set_limits(p_max_stake integer, p_max_daily integer, p_max_weekly integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if coalesce(p_max_stake, 1) < 1 or coalesce(p_max_daily, 1) < 1 or coalesce(p_max_weekly, 1) < 1 then return jsonb_build_object('ok', false, 'code', 'LIMIT'); end if;
  insert into bet_limits (user_id, max_stake, max_daily, max_weekly) values (uid, p_max_stake, p_max_daily, p_max_weekly)
    on conflict (user_id) do update set max_stake = excluded.max_stake, max_daily = excluded.max_daily, max_weekly = excluded.max_weekly, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_self_exclude(p_days integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u timestamptz;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if p_days not in (7, 30, 90) then return jsonb_build_object('ok', false, 'code', 'DAYS'); end if;
  u := now() + make_interval(days => p_days);
  insert into bet_limits (user_id, self_excluded_until) values (uid, u)
    on conflict (user_id) do update set self_excluded_until = greatest(coalesce(bet_limits.self_excluded_until, u), u), updated_at = now();
  return jsonb_build_object('ok', true, 'until', (select self_excluded_until from bet_limits where user_id = uid));
end $$;

-- Colocar aposta (simples ou múltipla). Odds bloqueadas no momento; se mudaram, devolve ODDS_CHANGED com as novas.
create or replace function public.bets_place(p_selection_ids uuid[], p_stake integer, p_odds numeric[], p_accept_changes boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); cfg bet_settings; l bet_limits; n integer := coalesce(array_length(p_selection_ids, 1), 0);
  r record; changed jsonb := '{}'; tot numeric := 1; bid uuid; bal integer; d0 timestamptz; w0 timestamptz; st_today integer; st_week integer;
  n_found integer; n_groups integer; n_closed integer;
begin
  if uid is null or not exists (select 1 from profiles where id = uid and not banned) then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet:' || uid::text, 0));
  select * into cfg from bet_settings where id = 1;
  select * into l from bet_limits where user_id = uid;
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
  if p_stake is null or p_stake < cfg.min_stake then return jsonb_build_object('ok', false, 'code', 'STAKE_MIN'); end if;
  if p_stake > cfg.max_stake then return jsonb_build_object('ok', false, 'code', 'STAKE_MAX'); end if;
  if l.max_stake is not null and p_stake > l.max_stake then return jsonb_build_object('ok', false, 'code', 'LIMIT_STAKE'); end if;
  d0 := date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  w0 := date_trunc('week', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  select coalesce(sum(stake), 0) into st_today from bets where user_id = uid and created_at >= d0;
  select coalesce(sum(stake), 0) into st_week from bets where user_id = uid and created_at >= w0;
  if l.max_daily is not null and st_today + p_stake > l.max_daily then return jsonb_build_object('ok', false, 'code', 'LIMIT_DAILY'); end if;
  if l.max_weekly is not null and st_week + p_stake > l.max_weekly then return jsonb_build_object('ok', false, 'code', 'LIMIT_WEEKLY'); end if;
  if p_stake > public.bets__balance(uid) then return jsonb_build_object('ok', false, 'code', 'BALANCE'); end if;
  for r in select * from _bet_slip order by ord loop
    if r.odds <> p_odds[r.ord] then changed := changed || jsonb_build_object(r.selection_id::text, r.odds); end if;
    tot := tot * r.odds;
  end loop;
  if changed <> '{}'::jsonb and not coalesce(p_accept_changes, false) then return jsonb_build_object('ok', false, 'code', 'ODDS_CHANGED', 'odds', changed); end if;
  tot := round(tot, 2);
  insert into bets (user_id, kind, stake, total_odds, potential)
    values (uid, case when n > 1 then 'multipla' else 'simples' end, p_stake, tot, least(floor(p_stake * tot)::integer, cfg.max_payout))
    returning id into bid;
  insert into bet_legs (bet_id, selection_id, market_id, group_id, odds) select bid, selection_id, market_id, group_id, odds from _bet_slip;
  bal := public.bets__post(uid, -p_stake, 'aposta', bid::text);
  return jsonb_build_object('ok', true, 'bet_id', bid, 'balance', bal);
end $$;

-- 7. Admin / organizador ---------------------------------------------------------------------
create or replace function public.bets__can_manage() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_admin() then return true; end if;
  begin return public.core_has_role('admin', 'organizador'); exception when undefined_function then return false; end;
end $$;

create or replace function public.bets__log(p_action text, p_target text, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  select handle into h from profiles where id = auth.uid();
  insert into bet_admin_log (actor_id, actor_handle, action, target, details) values (auth.uid(), h, p_action, coalesce(p_target, ''), coalesce(p_details, '{}'));
  insert into audit_log (actor_id, actor_handle, action, target) values (auth.uid(), h, 'apostas:' || p_action, coalesce(p_target, ''));
end $$;

create or replace function public.bets__team(p_game text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; nm text := trim(p_name);
begin
  select id into tid from bet_teams where game_key = p_game and lower(name) = lower(nm);
  if tid is null then insert into bet_teams (game_key, name) values (p_game, nm) on conflict do nothing returning id into tid; end if;
  if tid is null then select id into tid from bet_teams where game_key = p_game and lower(name) = lower(nm); end if;
  return tid;
end $$;

create or replace function public.bets_admin_create_match(p_game text, p_home text, p_away text, p_starts_at timestamptz, p_tournament_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h uuid; a uuid; mid uuid; tn text := '';
begin
  if not public.bets__can_manage() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_game not in ('ff','cr','ef','dls','outros') then return jsonb_build_object('ok', false, 'code', 'GAME'); end if;
  if length(trim(coalesce(p_home, ''))) = 0 or length(trim(coalesce(p_away, ''))) = 0 or lower(trim(p_home)) = lower(trim(p_away)) then return jsonb_build_object('ok', false, 'code', 'TEAMS'); end if;
  if p_starts_at is null then return jsonb_build_object('ok', false, 'code', 'DATE'); end if;
  if p_tournament_id is not null and p_tournament_id <> '' then
    select name into tn from tournaments where id = p_tournament_id;
    if tn is null then return jsonb_build_object('ok', false, 'code', 'TOURNAMENT'); end if;
  end if;
  h := public.bets__team(p_game, p_home); a := public.bets__team(p_game, p_away);
  insert into bet_matches (game_key, tournament_id, tournament_name, home_team_id, away_team_id, home, away, starts_at, original_starts_at)
    values (p_game, nullif(p_tournament_id, ''), coalesce(tn, ''), h, a, trim(p_home), trim(p_away), p_starts_at, p_starts_at) returning id into mid;
  perform public.bets__log('jogo_criado', mid::text, jsonb_build_object('jogo', trim(p_home) || ' vs ' || trim(p_away), 'inicio', p_starts_at, 'torneio', tn));
  if p_starts_at <= now() then perform public.bets_sweep(); end if;
  return jsonb_build_object('ok', true, 'match_id', mid);
end $$;

create or replace function public.bets_admin_match_action(p_match uuid, p_action text, p_starts_at timestamptz default null, p_home integer default null, p_away integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mt bet_matches;
begin
  if not public.bets__can_manage() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into mt from bet_matches where id = p_match;
  if mt.id is null then return jsonb_build_object('ok', false, 'code', 'MATCH'); end if;
  if p_action = 'resultado' then
    if p_home is null or p_away is null or p_home < 0 or p_away < 0 then return jsonb_build_object('ok', false, 'code', 'SCORE'); end if;
    perform public.bets__apply_outcome(p_match, 'result', p_home, p_away);
    perform public.bets__log(case when mt.settled_version > 0 then 'resultado_corrigido' else 'resultado_registado' end, p_match::text, jsonb_build_object('resultado', p_home || '-' || p_away));
  elsif p_action = 'anular' then
    perform public.bets__apply_outcome(p_match, 'void', null, null);
    perform public.bets__log('jogo_anulado', p_match::text, '{}');
  elsif p_action = 'cancelar' then
    update bet_matches set status = 'cancelado', updated_at = now() where id = p_match and not voided;
    perform public.bets__log('jogo_cancelado', p_match::text, '{}');
    perform public.bets_sweep();
  elsif p_action = 'adiar' then
    if mt.voided or mt.status = 'terminado' then return jsonb_build_object('ok', false, 'code', 'MATCH'); end if;
    update bet_matches set status = 'adiado', updated_at = now() where id = p_match;
    perform public.bets__log('jogo_adiado', p_match::text, '{}');
    perform public.bets_sweep();
  elsif p_action = 'reagendar' then
    if mt.voided or mt.status = 'terminado' or p_starts_at is null then return jsonb_build_object('ok', false, 'code', 'MATCH'); end if;
    update bet_matches set starts_at = p_starts_at, updated_at = now(),
      status = case when p_starts_at > original_starts_at + interval '48 hours' then 'adiado' else 'agendado' end where id = p_match;
    perform public.bets__log('jogo_reagendado', p_match::text, jsonb_build_object('inicio', p_starts_at));
    perform public.bets_sweep();
    if mt.tournament_id is not null then update bet_markets set closes_at = (select min(starts_at) from bet_matches where tournament_id = mt.tournament_id and not voided) where kind = 'outright' and tournament_id = mt.tournament_id; end if;
  else
    return jsonb_build_object('ok', false, 'code', 'ACTION');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_admin_market_action(p_market uuid, p_action text, p_value numeric default null, p_selection uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mk bet_markets; s bet_selections; old numeric;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into mk from bet_markets where id = p_market for update;
  if mk.id is null then return jsonb_build_object('ok', false, 'code', 'MARKET'); end if;
  if p_action in ('suspender', 'reabrir') then
    if mk.status not in ('aberto','suspenso') then return jsonb_build_object('ok', false, 'code', 'MARKET'); end if;
    if p_action = 'reabrir' and mk.closes_at is not null and mk.closes_at <= now() then return jsonb_build_object('ok', false, 'code', 'STARTED'); end if;
    update bet_markets set status = case when p_action = 'reabrir' then 'aberto' else 'suspenso' end, auto_suspended = false where id = p_market;
    perform public.bets__log(case when p_action = 'reabrir' then 'mercado_reaberto' else 'mercado_suspenso' end, p_market::text, jsonb_build_object('mercado', mk.title));
  elsif p_action = 'odd' then
    select * into s from bet_selections where id = p_selection and market_id = p_market;
    if s.id is null then return jsonb_build_object('ok', false, 'code', 'SEL'); end if;
    if p_value is null or p_value < 1.01 or p_value > 1000 then return jsonb_build_object('ok', false, 'code', 'ODDS'); end if;
    old := s.odds;
    update bet_selections set odds = round(p_value, 2), manual = true where id = s.id;
    perform public.bets__log('odd_alterada', s.id::text, jsonb_build_object('selecao', s.label, 'mercado', mk.title, 'de', old, 'para', round(p_value, 2)));
  elsif p_action = 'odds_auto' then
    update bet_selections set manual = false where market_id = p_market;
    if mk.match_id is not null then perform public.bets__price_match(mk.match_id); else perform public.bets__price_outright(mk.tournament_id); end if;
    perform public.bets__log('odds_automaticas', p_market::text, jsonb_build_object('mercado', mk.title));
  elsif p_action = 'margem' then
    if p_value is not null and (p_value < 0 or p_value > 0.5) then return jsonb_build_object('ok', false, 'code', 'MARGIN'); end if;
    update bet_markets set margin = p_value where id = p_market;
    if mk.match_id is not null then perform public.bets__price_match(mk.match_id); else perform public.bets__price_outright(mk.tournament_id); end if;
    perform public.bets__log('margem_mercado', p_market::text, jsonb_build_object('mercado', mk.title, 'margem', p_value));
  elsif p_action = 'anular' then
    perform public.bets__reopen_bets(array[p_market]);
    update bet_markets set status = 'anulado', manual_void = true, settled_at = now() where id = p_market;
    update bet_selections set result = 'anulada' where market_id = p_market;
    perform public.bets__settle_markets(array[p_market]);
    perform public.bets__log('mercado_anulado', p_market::text, jsonb_build_object('mercado', mk.title));
  elsif p_action = 'vencedor' then
    if mk.kind <> 'outright' or not exists (select 1 from bet_selections where id = p_selection and market_id = p_market) then return jsonb_build_object('ok', false, 'code', 'SEL'); end if;
    perform public.bets__reopen_bets(array[p_market]);
    update bet_selections set result = case when id = p_selection then 'ganha' else 'perdida' end where market_id = p_market;
    update bet_markets set status = 'liquidado', settled_at = now() where id = p_market;
    perform public.bets__settle_markets(array[p_market]);
    perform public.bets__log('vencedor_torneio', p_market::text, jsonb_build_object('vencedor', (select label from bet_selections where id = p_selection)));
  else
    return jsonb_build_object('ok', false, 'code', 'ACTION');
  end if;
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
      updated_at = now()
    where id = 1 returning * into nw;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end;
  if nw.margin <> old.margin then
    for m in select id from bet_matches where not voided and status = 'agendado' loop perform public.bets__price_match(m); end loop;
    for t in select tournament_id from bet_markets where kind = 'outright' and status in ('aberto','suspenso') loop perform public.bets__price_outright(t); end loop;
  end if;
  perform public.bets__log('definicoes_apostas', 'bet_settings', p - 'real_money_enabled' - 'igj_licence_no' - 'igj_licence_date');
  return jsonb_build_object('ok', true);
end $$;

-- Interruptor de dinheiro real: BLOQUEADO sem licença IGJ (nº + data) e sem pagamentos ativos.
create or replace function public.bets_admin_set_real_money(p_on boolean, p_licence_no text, p_licence_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay boolean;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  update bet_settings set igj_licence_no = coalesce(trim(p_licence_no), ''), igj_licence_date = p_licence_date, updated_at = now() where id = 1;
  if p_on then
    if length(coalesce(trim(p_licence_no), '')) = 0 or p_licence_date is null then
      perform public.bets__log('dinheiro_real_recusado', 'bet_settings', jsonb_build_object('motivo', 'sem licença IGJ'));
      return jsonb_build_object('ok', false, 'code', 'IGJ');
    end if;
    select coalesce((data->'settings'->>'paymentsEnabled')::boolean, false) into pay from platform_settings where id = 1;
    if not coalesce(pay, false) then
      perform public.bets__log('dinheiro_real_recusado', 'bet_settings', jsonb_build_object('motivo', 'pagamentos inativos'));
      return jsonb_build_object('ok', false, 'code', 'PAYMENTS');
    end if;
  end if;
  update bet_settings set real_money_enabled = p_on, updated_at = now() where id = 1;
  perform public.bets__log(case when p_on then 'dinheiro_real_ligado' else 'dinheiro_real_desligado' end, 'bet_settings', jsonb_build_object('licenca', p_licence_no, 'data', p_licence_date));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bets_admin_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg bet_settings; ex jsonb; al jsonb; us jsonb; tot jsonb;
begin
  if not public.bets__can_manage() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into cfg from bet_settings where id = 1;
  select coalesce(jsonb_agg(x order by x.liability desc, x.staked desc), '[]') into ex from (
    select s.id as selection_id, s.label, m.title as market, coalesce(mt.home || ' vs ' || mt.away, m.tournament_name) as event,
      count(*)::integer as bets, sum(b.stake)::integer as staked, coalesce(sum(b.potential) filter (where b.status = 'aberta'), 0)::integer as liability
    from bet_legs l join bets b on b.id = l.bet_id join bet_selections s on s.id = l.selection_id join bet_markets m on m.id = l.market_id
    left join bet_matches mt on mt.id = m.match_id
    group by s.id, s.label, m.title, mt.home, mt.away, m.tournament_name
    order by liability desc, staked desc limit 100) x;
  select coalesce(jsonb_agg(a), '[]') into al from (
    (select 'aposta_grande' as kind, 'Aposta grande: ' || b.stake || ' pts (@' || coalesce(p.handle, '?') || ')' as text, b.id::text as ref, b.created_at as at
      from bets b left join profiles p on p.id = b.user_id where b.stake >= cfg.big_stake_alert order by b.created_at desc limit 50)
    union all
    (select 'concentracao', count(*) || ' apostas na mesma seleção: ' || s.label || ' · ' || coalesce(mt.home || ' vs ' || mt.away, m.tournament_name), s.id::text, max(b.created_at)
      from bet_legs l join bets b on b.id = l.bet_id join bet_selections s on s.id = l.selection_id join bet_markets m on m.id = s.market_id left join bet_matches mt on mt.id = m.match_id
      group by s.id, s.label, mt.home, mt.away, m.tournament_name having count(*) >= cfg.same_selection_alert limit 50)
  ) a;
  select coalesce(jsonb_agg(u order by u.staked desc), '[]') into us from (
    select b.user_id, coalesce(p.handle, '?') as handle, count(*)::integer as bets, sum(b.stake)::integer as staked, sum(b.payout)::integer as returned,
      count(*) filter (where b.status = 'aberta')::integer as open, public.bets__balance(b.user_id) as balance
    from bets b left join profiles p on p.id = b.user_id group by b.user_id, p.handle order by sum(b.stake) desc limit 100) u;
  select jsonb_build_object('bets', count(*), 'open', count(*) filter (where status = 'aberta'), 'staked', coalesce(sum(stake), 0), 'paid', coalesce(sum(payout), 0),
    'liability', coalesce(sum(potential) filter (where status = 'aberta'), 0)) into tot from bets;
  return jsonb_build_object('ok', true, 'exposure', ex, 'alerts', al, 'users', us, 'totals', tot);
end $$;

-- 8. RLS e permissões --------------------------------------------------------------------
alter table public.bet_settings enable row level security;
alter table public.bet_teams enable row level security;
alter table public.bet_matches enable row level security;
alter table public.bet_markets enable row level security;
alter table public.bet_selections enable row level security;
alter table public.bets enable row level security;
alter table public.bet_legs enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.bet_limits enable row level security;
alter table public.bet_admin_log enable row level security;

drop policy if exists bet_settings_read on public.bet_settings;
create policy bet_settings_read on public.bet_settings for select using (true);
drop policy if exists bet_teams_read on public.bet_teams;
create policy bet_teams_read on public.bet_teams for select using (true);
drop policy if exists bet_matches_read on public.bet_matches;
create policy bet_matches_read on public.bet_matches for select using (true);
drop policy if exists bet_markets_read on public.bet_markets;
create policy bet_markets_read on public.bet_markets for select using (true);
drop policy if exists bet_selections_read on public.bet_selections;
create policy bet_selections_read on public.bet_selections for select using (true);
drop policy if exists bets_read on public.bets;
create policy bets_read on public.bets for select using (user_id = (select auth.uid()) or (select public.bets__can_manage()));
drop policy if exists bet_legs_read on public.bet_legs;
create policy bet_legs_read on public.bet_legs for select using (exists (select 1 from public.bets b where b.id = bet_id and (b.user_id = (select auth.uid()) or (select public.bets__can_manage()))));
drop policy if exists wallet_ledger_read on public.wallet_ledger;
create policy wallet_ledger_read on public.wallet_ledger for select using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists bet_limits_read on public.bet_limits;
create policy bet_limits_read on public.bet_limits for select using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists bet_admin_log_read on public.bet_admin_log;
create policy bet_admin_log_read on public.bet_admin_log for select using ((select public.bets__can_manage()));

revoke insert, update, delete, truncate on public.bet_settings, public.bet_teams, public.bet_matches, public.bet_markets, public.bet_selections,
  public.bets, public.bet_legs, public.wallet_ledger, public.bet_limits, public.bet_admin_log from anon, authenticated;
grant select on public.bet_settings, public.bet_teams, public.bet_matches, public.bet_markets, public.bet_selections to anon, authenticated;
grant select on public.bets, public.bet_legs, public.wallet_ledger, public.bet_limits, public.bet_admin_log to authenticated;

do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'bets\_\_%' escape '\' ) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.bets_sweep() from public;
grant execute on function public.bets_sweep() to anon, authenticated;
revoke all on function public.bets_claim_weekly(), public.bets_me(), public.bets_confirm_age(), public.bets_set_limits(integer, integer, integer),
  public.bets_self_exclude(integer), public.bets_place(uuid[], integer, numeric[], boolean),
  public.bets_admin_create_match(text, text, text, timestamptz, text), public.bets_admin_match_action(uuid, text, timestamptz, integer, integer),
  public.bets_admin_market_action(uuid, text, numeric, uuid), public.bets_admin_save_settings(jsonb), public.bets_admin_set_real_money(boolean, text, date),
  public.bets_admin_overview() from public, anon;
grant execute on function public.bets_claim_weekly(), public.bets_me(), public.bets_confirm_age(), public.bets_set_limits(integer, integer, integer),
  public.bets_self_exclude(integer), public.bets_place(uuid[], integer, numeric[], boolean),
  public.bets_admin_create_match(text, text, text, timestamptz, text), public.bets_admin_match_action(uuid, text, timestamptz, integer, integer),
  public.bets_admin_market_action(uuid, text, numeric, uuid), public.bets_admin_save_settings(jsonb), public.bets_admin_set_real_money(boolean, text, date),
  public.bets_admin_overview() to authenticated;
-- RLS usa estas duas: precisam de ser executáveis pelos papéis do cliente
grant execute on function public.bets__can_manage() to anon, authenticated;

-- 9. Relógio do sistema: pg_cron corre bets_sweep() a cada minuto (se a extensão existir) -----
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'bets-sweep';
    perform cron.schedule('bets-sweep', '* * * * *', 'select public.bets_sweep()');
  end if;
end $$;

notify pgrst, 'reload schema';
