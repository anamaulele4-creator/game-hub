-- =====================================================================
-- TXAPILOG · Apostas v3 (2026-10-21). IDEMPOTENTE — pode correr várias vezes. SÓ ACRESCENTA.
--
-- Evolui as Apostas v2 (2026-10-20-apostas-v2.sql) — NÃO é um sistema novo:
-- • Confrontos (apv2_matches): jogo, equipa A/B (com logótipo), data, organizador, regras, estado, resultado,
--   torneio/evento opcional. Cada confronto cria um mercado "Quem ganha" em apv2_markets (match_id) com uma
--   seleção por equipa (side 'a'/'b', opcional 'empate'). Mercados antigos (só título) continuam a funcionar.
-- • Novos jogos: fortnite, cod, valorant, minecraft (bet_teams e apv2_markets).
-- • Estados da aposta: pendente_confirmacao → confirmada → em_andamento → em_analise → ganha/perdida/anulada/
--   reembolsada (a antiga 'aberta' continua válida = confirmada). Transições impostas por trigger.
-- • Histórico por aposta (apv2_bet_events, só acréscimos) escrito automaticamente por trigger.
-- • Limites configuráveis (utilizador, confronto, mercado, evento, exposição global) + exposição calculada no
--   servidor; mercado suspenso automaticamente quando o limite é atingido.
-- • Valores sugeridos (50/100/200/500/1000) configuráveis pelo admin.
-- • Resultados com dupla validação: quem propõe NÃO pode aprovar (apv2_results). Confrontos só são
--   liquidados a partir de um resultado aprovado. Cancelar um confronto reembolsa todas as apostas abertas.
-- • Chaves de idempotência na confirmação, na proposta de resultado, na liquidação e nos reembolsos.
-- • Concorrência: tranca a seleção e o mercado (FOR UPDATE) e o utilizador (advisory lock) — o saldo nunca fica
--   negativo; pedido repetido (mesmo request_id) devolve a mesma aposta sem debitar 2x.
-- • Reclamações (apv2_complaints) — comp_disputes é só para desafios competitivos, por isso não serve aqui.
-- • SALDO DE TESTE APENAS (moeda 'teste'). Dinheiro real continua DESLIGADO até haver autorização legal
--   (licença IGJ, KYC). Não toca no marketplace, pagamentos, ClicPay nem na carteira de dinheiro real.
--
-- Corre DEPOIS de 2026-10-20-apostas-v2.sql (e de 2026-10-10-bets.sql para bet_teams). Se voltares a correr o
-- SQL v2 depois deste, corre este outra vez (o v2 repõe as versões antigas de algumas funções).
-- Reverter: supabase/migrations/rollback/2026-10-21-apostas-v3-down.sql
-- =====================================================================

create extension if not exists pgcrypto;

-- 0. Utilitários -------------------------------------------------------------------------
create or replace function public.apv2__games() returns text[] language sql immutable as $$
  select array['ff','cr','ef','dls','fortnite','cod','valorant','minecraft','outros']::text[] $$;

-- Estados "em aberto" (dinheiro em jogo). 'aberta' = apostas antigas (v2), equivale a 'confirmada'.
create or replace function public.apv2__open(p text) returns boolean language sql immutable as $$
  select p in ('aberta','pendente_confirmacao','confirmada','em_andamento','em_analise') $$;

-- 1. Novos jogos (substitui os CHECK de game_key com segurança: só alarga a lista) -------------
do $$ declare c record; begin
  if to_regclass('public.bet_teams') is not null then
    for c in select conname from pg_constraint where conrelid = 'public.bet_teams'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%game_key%' and conname <> 'bet_teams_game_key_v3' loop
      execute format('alter table public.bet_teams drop constraint %I', c.conname);
    end loop;
    if not exists (select 1 from pg_constraint where conrelid = 'public.bet_teams'::regclass and conname = 'bet_teams_game_key_v3') then
      alter table public.bet_teams add constraint bet_teams_game_key_v3 check (game_key = any (public.apv2__games()));
    end if;
    alter table public.bet_teams add column if not exists logo_url text;
  end if;
  for c in select conname from pg_constraint where conrelid = 'public.apv2_markets'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) ilike '%game_key%' and conname <> 'apv2_markets_game_key_v3' loop
    execute format('alter table public.apv2_markets drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.apv2_markets'::regclass and conname = 'apv2_markets_game_key_v3') then
    alter table public.apv2_markets add constraint apv2_markets_game_key_v3 check (game_key = any (public.apv2__games()));
  end if;
end $$;

-- 2. Confrontos --------------------------------------------------------------------------
create table if not exists public.apv2_matches (
  id uuid primary key default gen_random_uuid(),
  game_key text not null default 'outros' check (game_key = any (public.apv2__games())),
  team_a_id uuid references public.bet_teams(id) on delete set null,
  team_b_id uuid references public.bet_teams(id) on delete set null,
  team_a_name text not null check (length(trim(team_a_name)) between 1 and 60),
  team_b_name text not null check (length(trim(team_b_name)) between 1 and 60),
  team_a_logo text,
  team_b_logo text,
  starts_at timestamptz not null,
  organizer_id uuid references public.profiles(id) on delete set null,
  organizer_name text not null default '' check (length(organizer_name) <= 80),
  rules text not null default '' check (length(rules) <= 2000),
  tournament_ref text check (tournament_ref is null or length(tournament_ref) <= 80),
  tournament_name text not null default '' check (length(tournament_name) <= 120),
  status text not null default 'agendado' check (status in ('agendado','apostas_abertas','em_andamento','suspenso','aguarda_resultado','resultado_em_analise','finalizado','cancelado')),
  result text check (result is null or result in ('a','b','empate','cancelado')),
  score_a integer check (score_a is null or score_a >= 0),
  score_b integer check (score_b is null or score_b >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apv2_matches_teams check (lower(trim(team_a_name)) <> lower(trim(team_b_name)))
);
create index if not exists apv2_matches_status_idx on public.apv2_matches (status, starts_at);
create index if not exists apv2_matches_game_idx on public.apv2_matches (game_key, starts_at);
create index if not exists apv2_matches_event_idx on public.apv2_matches (tournament_ref) where tournament_ref is not null;

-- Transições válidas do confronto (finalizado e cancelado são finais).
create or replace function public.apv2__match_next_ok(p_from text, p_to text) returns boolean language sql immutable as $$
  select p_from = p_to or case p_from
    when 'agendado' then p_to in ('apostas_abertas','suspenso','em_andamento','cancelado')
    when 'apostas_abertas' then p_to in ('agendado','suspenso','em_andamento','cancelado')
    when 'suspenso' then p_to in ('agendado','apostas_abertas','em_andamento','cancelado')
    when 'em_andamento' then p_to in ('suspenso','aguarda_resultado','resultado_em_analise','cancelado')
    when 'aguarda_resultado' then p_to in ('resultado_em_analise','cancelado')
    when 'resultado_em_analise' then p_to in ('aguarda_resultado','finalizado','cancelado')
    else false end $$;

create or replace function public.apv2__tg_match_state() returns trigger language plpgsql as $$
begin
  if not public.apv2__match_next_ok(old.status, new.status) then raise exception 'MATCH_TRANSITION % -> %', old.status, new.status; end if;
  if old.status in ('finalizado','cancelado') and (new.result is distinct from old.result or new.score_a is distinct from old.score_a or new.score_b is distinct from old.score_b) then
    raise exception 'MATCH_FINAL';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists apv2_match_state on public.apv2_matches;
create trigger apv2_match_state before update on public.apv2_matches for each row execute function public.apv2__tg_match_state();

-- Mercados ligados a um confronto (match_id nulo = mercado antigo, continua a funcionar).
alter table public.apv2_markets add column if not exists match_id uuid references public.apv2_matches(id) on delete restrict;
create index if not exists apv2_markets_match_idx on public.apv2_markets (match_id) where match_id is not null;
alter table public.apv2_selections add column if not exists side text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.apv2_selections'::regclass and conname = 'apv2_selections_side_v3') then
    alter table public.apv2_selections add constraint apv2_selections_side_v3 check (side is null or side in ('a','b','empate'));
  end if;
end $$;

-- 3. Apostas: novos estados, campos de liquidação e transições --------------------------------
alter table public.apv2_bets add column if not exists match_id uuid references public.apv2_matches(id) on delete restrict;
alter table public.apv2_bets add column if not exists selection_label text;
alter table public.apv2_bets add column if not exists confirmed_at timestamptz;
alter table public.apv2_bets add column if not exists official_result text;
alter table public.apv2_bets add column if not exists settled_amount integer;
alter table public.apv2_bets add column if not exists settle_request text;
create index if not exists apv2_bets_match_idx on public.apv2_bets (match_id, status) where match_id is not null;
create index if not exists apv2_bets_market_status_idx on public.apv2_bets (market_id, status);
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.apv2_bets'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) ilike '%status%' and conname <> 'apv2_bets_status_v3' loop
    execute format('alter table public.apv2_bets drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.apv2_bets'::regclass and conname = 'apv2_bets_status_v3') then
    alter table public.apv2_bets add constraint apv2_bets_status_v3 check (status in
      ('aberta','pendente_confirmacao','confirmada','em_andamento','em_analise','ganha','perdida','anulada','reembolsada'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.apv2_bets'::regclass and conname = 'apv2_bets_settled_amount_v3') then
    alter table public.apv2_bets add constraint apv2_bets_settled_amount_v3 check (settled_amount is null or settled_amount >= 0);
  end if;
end $$;

create or replace function public.apv2__bet_next_ok(p_from text, p_to text) returns boolean language sql immutable as $$
  select case p_from
    when 'pendente_confirmacao' then p_to in ('confirmada','anulada','reembolsada')
    when 'aberta' then p_to in ('confirmada','em_andamento','em_analise','ganha','perdida','anulada','reembolsada')
    when 'confirmada' then p_to in ('em_andamento','em_analise','ganha','perdida','anulada','reembolsada')
    when 'em_andamento' then p_to in ('em_analise','ganha','perdida','anulada','reembolsada')
    when 'em_analise' then p_to in ('em_andamento','ganha','perdida','anulada','reembolsada')
    else false end $$;

-- Substitui a trava da v2: odd/valor/retorno nunca mudam; transições só pelo mapa acima; liquidada = final.
create or replace function public.apv2__tg_bet_lock() returns trigger language plpgsql as $$
begin
  if new.stake <> old.stake or new.odds_locked <> old.odds_locked or new.odds_version_locked <> old.odds_version_locked
     or new.potential <> old.potential or new.user_id <> old.user_id or new.selection_id <> old.selection_id or new.market_id <> old.market_id
     or new.match_id is distinct from old.match_id or new.request_id is distinct from old.request_id or new.created_at <> old.created_at then
    raise exception 'BET_LOCKED';
  end if;
  if not public.apv2__open(old.status) then
    if new.status <> old.status or new.payout <> old.payout or new.settled_amount is distinct from old.settled_amount
       or new.official_result is distinct from old.official_result then
      raise exception 'ALREADY_SETTLED';
    end if;
  elsif new.status <> old.status and not public.apv2__bet_next_ok(old.status, new.status) then
    raise exception 'BET_TRANSITION % -> %', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists apv2_bet_lock on public.apv2_bets;
create trigger apv2_bet_lock before update on public.apv2_bets for each row execute function public.apv2__tg_bet_lock();

-- 4. Histórico por aposta (só acréscimos; escrito pelo trigger) ----------------------------
create table if not exists public.apv2_bet_events (
  id bigint generated always as identity primary key,
  bet_id uuid not null references public.apv2_bets(id) on delete cascade,
  user_id uuid not null,
  from_status text,
  to_status text not null,
  amount integer,
  note text not null default '',
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists apv2_bet_events_bet_idx on public.apv2_bet_events (bet_id, id);
create index if not exists apv2_bet_events_user_idx on public.apv2_bet_events (user_id, id desc);
drop trigger if exists apv2_bet_events_immutable on public.apv2_bet_events;
create trigger apv2_bet_events_immutable before update or delete on public.apv2_bet_events for each row execute function public.app__tg_audit_immutable();

create or replace function public.apv2__tg_bet_event() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into apv2_bet_events (bet_id, user_id, from_status, to_status, amount, note, actor_id)
    values (new.id, new.user_id, case when tg_op = 'INSERT' then null else old.status end, new.status,
            case when public.apv2__open(new.status) then new.stake else new.payout end,
            coalesce(nullif(current_setting('apv2.note', true), ''), ''), auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists apv2_bet_event on public.apv2_bets;
create trigger apv2_bet_event after insert or update on public.apv2_bets for each row execute function public.apv2__tg_bet_event();

-- 5. Limites, exposição e valores sugeridos ------------------------------------------------
create table if not exists public.apv2_limits (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('user','match','market','event','global_exposure')),
  ref text not null default '' check (length(ref) <= 80),   -- user: id do utilizador ('' = todos); match/market: id; event: tournament_ref; global: ''
  max_stake integer check (max_stake is null or max_stake >= 1),
  max_exposure integer check (max_exposure is null or max_exposure >= 0),
  auto_suspend boolean not null default true,
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (scope, ref)
);

-- Valores sugeridos (MT de teste). perm 'apostas:rpc' = ninguém muda pelo app_setting_set genérico; só pela
-- função validada apv2_admin_set_stake_chips (permissão 'toggle').
insert into public.app_settings (key, value, perm) values ('apostas_stake_chips', '[50,100,200,500,1000]'::jsonb, 'apostas:rpc') on conflict (key) do nothing;

create or replace function public.apv2__chips() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_settings where key = 'apostas_stake_chips'), '[50,100,200,500,1000]'::jsonb) $$;

-- Exposição de um mercado = pior caso para a casa: max(Σ retornos numa seleção) − Σ valores apostados no mercado (≥ 0).
-- p_sel/p_stake/p_pot simulam uma aposta extra (para decidir antes de aceitar).
create or replace function public.apv2__market_exposure(p_market uuid, p_sel uuid default null, p_stake integer default 0, p_pot integer default 0) returns integer
language sql stable security definer set search_path = public as $$
  select greatest(0,
    coalesce((select max(x.pot) from (
      select s.id, coalesce((select sum(b.potential) from apv2_bets b where b.selection_id = s.id and public.apv2__open(b.status)), 0)
                   + case when s.id = p_sel then p_pot else 0 end as pot
      from apv2_selections s where s.market_id = p_market) x), 0)
    - (coalesce((select sum(b.stake) from apv2_bets b where b.market_id = p_market and public.apv2__open(b.status)), 0) + coalesce(p_stake, 0)))::integer $$;

-- Soma da exposição de vários mercados, com a aposta extra aplicada ao mercado certo.
create or replace function public.apv2__exposure_of(p_markets uuid[], p_market uuid, p_sel uuid, p_stake integer, p_pot integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when m = p_market then public.apv2__market_exposure(m, p_sel, p_stake, p_pot) else public.apv2__market_exposure(m) end), 0)::integer
  from unnest(p_markets) m $$;

create or replace function public.apv2__lim(p_scope text, p_ref text) returns apv2_limits
language sql stable security definer set search_path = public as $$
  select * from apv2_limits where scope = p_scope and ref = coalesce(p_ref, '') and active limit 1 $$;

-- Suspende o mercado automaticamente (fica na auditoria).
create or replace function public.apv2__auto_suspend(p_market uuid, p_scope text, p_limit integer, p_exposure integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  update apv2_markets set status = 'suspenso', updated_at = now() where id = p_market and status = 'aberto';
  if found then
    perform public.app__audit('apostas', 'auto_suspender_limite', p_market::text, jsonb_build_object('status', 'aberto'),
      jsonb_build_object('status', 'suspenso', 'scope', p_scope, 'limit', p_limit, 'exposure', p_exposure, 'motivo', 'Limite de exposição atingido'));
  end if;
end $$;

-- Verifica todos os limites para uma aposta nova. Devolve null (ok) ou o erro em jsonb.
create or replace function public.apv2__check_limits(p_user uuid, p_market uuid, p_match uuid, p_event text, p_sel uuid, p_stake integer, p_pot integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ms integer := null; l apv2_limits; ux integer; cur integer; nxt integer; mk uuid[]; sc text; rf text;
  self_max integer := null;
begin
  -- valor máximo por aposta: o menor de todos os limites aplicáveis (incluindo o limite pessoal de jogo responsável)
  select min(max_stake) into ms from apv2_limits where active and max_stake is not null and (
    (scope = 'user' and ref in (p_user::text, '')) or (scope = 'market' and ref = p_market::text)
    or (p_match is not null and scope = 'match' and ref = p_match::text) or (p_event is not null and scope = 'event' and ref = p_event));
  if to_regclass('public.bet_limits') is not null then
    execute 'select max_stake from public.bet_limits where user_id = $1' into self_max using p_user;
  end if;
  if self_max is not null and (ms is null or self_max < ms) then ms := self_max; end if;
  if ms is not null and p_stake > ms then return jsonb_build_object('ok', false, 'code', 'LIMIT_STAKE', 'max', ms); end if;

  -- exposição do utilizador = soma dos valores em jogo
  select max_exposure into ux from apv2_limits where active and scope = 'user' and max_exposure is not null and ref in (p_user::text, '')
   order by (ref = '') limit 1;  -- o limite específico do utilizador ganha ao geral
  if ux is not null and (select coalesce(sum(stake), 0) from apv2_bets where user_id = p_user and public.apv2__open(status)) + p_stake > ux then
    return jsonb_build_object('ok', false, 'code', 'LIMIT_USER', 'max', ux);
  end if;

  -- exposição da casa: mercado, confronto, evento, global
  foreach sc in array array['market','match','event','global_exposure'] loop
    rf := case sc when 'market' then p_market::text when 'match' then p_match::text when 'event' then p_event else '' end;
    continue when rf is null;
    l := public.apv2__lim(sc, rf);
    continue when l.id is null or l.max_exposure is null;
    mk := case sc
      when 'market' then array[p_market]
      when 'match' then array(select id from apv2_markets where match_id = p_match)
      when 'event' then array(select k.id from apv2_markets k join apv2_matches x on x.id = k.match_id where x.tournament_ref = p_event)
      else array(select z.m from (select b.market_id as m from apv2_bets b where public.apv2__open(b.status) union select p_market) z) end;
    nxt := public.apv2__exposure_of(mk, p_market, p_sel, p_stake, p_pot);
    if nxt > l.max_exposure then
      cur := public.apv2__exposure_of(mk, null, null, 0, 0);
      if l.auto_suspend and cur >= l.max_exposure then perform public.apv2__auto_suspend(p_market, sc, l.max_exposure, cur); end if;
      return jsonb_build_object('ok', false, 'code', 'LIMIT_EXPOSURE', 'scope', sc, 'max', l.max_exposure, 'exposure', cur);
    end if;
  end loop;
  return null;
end $$;

-- Depois de aceitar uma aposta: se algum limite de exposição ficou atingido, suspende o mercado.
create or replace function public.apv2__after_bet_limits(p_market uuid, p_match uuid, p_event text) returns void
language plpgsql security definer set search_path = public as $$
declare l apv2_limits; sc text; rf text; mk uuid[]; e integer;
begin
  foreach sc in array array['market','match','event','global_exposure'] loop
    rf := case sc when 'market' then p_market::text when 'match' then p_match::text when 'event' then p_event else '' end;
    continue when rf is null;
    l := public.apv2__lim(sc, rf);
    continue when l.id is null or l.max_exposure is null or not l.auto_suspend;
    mk := case sc
      when 'market' then array[p_market]
      when 'match' then array(select id from apv2_markets where match_id = p_match)
      when 'event' then array(select k.id from apv2_markets k join apv2_matches x on x.id = k.match_id where x.tournament_ref = p_event)
      else array(select distinct b.market_id from apv2_bets b where public.apv2__open(b.status)) end;
    e := public.apv2__exposure_of(mk, null, null, 0, 0);
    if e >= l.max_exposure then perform public.apv2__auto_suspend(p_market, sc, l.max_exposure, e); end if;
  end loop;
end $$;

-- 6. Conta autorizada? (banida, suspensa, apagada, menor, autoexcluída) ---------------------
create or replace function public.apv2__account_block(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare p profiles; ex timestamptz;
begin
  select * into p from profiles where id = p_user;
  if not found or p.banned or p.deleted_at is not null then return 'FORBIDDEN'; end if;
  if p.suspended_until is not null and p.suspended_until > now() then return 'ACCOUNT_SUSPENDED'; end if;
  if p.birth_date is not null and p.birth_date > (current_date - interval '18 years')::date then return 'UNDERAGE'; end if;
  if to_regclass('public.bet_limits') is not null then
    execute 'select self_excluded_until from public.bet_limits where user_id = $1' into ex using p_user;
    if ex is not null and ex > now() then return 'SELF_EXCLUDED'; end if;
  end if;
  return null;
end $$;

-- 7. Confirmar aposta (única porta de entrada; apv2_place passa a usar esta) ------------------
create or replace function public.apv2_bet_confirm(p_selection uuid, p_stake numeric, p_seen_odds numeric, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); lim jsonb := public.apv2__limits(); s apv2_selections; m apv2_markets; mt apv2_matches;
  prev apv2_bets; b uuid; pot integer; bal integer; chk jsonb; blk text; st integer;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if not public.apv2__enabled() then return jsonb_build_object('ok', false, 'code', 'DISABLED'); end if;
  if p_request is null then return jsonb_build_object('ok', false, 'code', 'REQUEST_ID'); end if;
  -- repetição do mesmo pedido (duplo clique, nova tentativa após falha de rede): devolve a mesma aposta
  select * into prev from apv2_bets where user_id = u and request_id = p_request;
  if found then
    if prev.selection_id <> p_selection or prev.stake <> p_stake then return jsonb_build_object('ok', false, 'code', 'REQUEST_REUSED'); end if;
    return jsonb_build_object('ok', true, 'bet', prev.id, 'odds', prev.odds_locked, 'potential', prev.potential, 'status', prev.status, 'balance', public.apv2__balance(u), 'replay', true);
  end if;
  blk := public.apv2__account_block(u);
  if blk is not null then return jsonb_build_object('ok', false, 'code', blk); end if;
  if p_stake is null or p_stake <> trunc(p_stake) then return jsonb_build_object('ok', false, 'code', 'STAKE_INT'); end if;
  if p_stake <= 0 then return jsonb_build_object('ok', false, 'code', 'STAKE_POSITIVE'); end if;
  if p_stake < (lim->>'min_stake')::integer then return jsonb_build_object('ok', false, 'code', 'STAKE_MIN', 'min', (lim->>'min_stake')::integer); end if;
  if p_stake > (lim->>'max_stake')::integer then return jsonb_build_object('ok', false, 'code', 'STAKE_MAX', 'max', (lim->>'max_stake')::integer); end if;
  st := p_stake::integer;

  -- ordem das trancas (igual à liquidação, para não haver deadlocks): seleção → mercado → utilizador
  select * into s from apv2_selections where id = p_selection for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into m from apv2_markets where id = s.market_id for update;
  if m.match_id is not null then select * into mt from apv2_matches where id = m.match_id; end if;
  perform pg_advisory_xact_lock(hashtext('apv2:' || u::text));
  select * into prev from apv2_bets where user_id = u and request_id = p_request;
  if found then
    return jsonb_build_object('ok', true, 'bet', prev.id, 'odds', prev.odds_locked, 'potential', prev.potential, 'status', prev.status, 'balance', public.apv2__balance(u), 'replay', true);
  end if;

  -- mercado aberto? decidido com o relógio do servidor
  if m.status = 'suspenso' or (mt.id is not null and mt.status = 'suspenso') then return jsonb_build_object('ok', false, 'code', 'SUSPENDED'); end if;
  if m.status <> 'aberto' or (m.closes_at is not null and m.closes_at <= now()) or s.result <> 'pendente'
     or (mt.id is not null and (mt.status <> 'apostas_abertas' or mt.starts_at <= now())) then
    return jsonb_build_object('ok', false, 'code', 'CLOSED');
  end if;
  if p_seen_odds is null or round(p_seen_odds, 2) <> s.odds then
    return jsonb_build_object('ok', false, 'code', 'ODDS_CHANGED', 'odds', s.odds, 'odds_version', s.odds_version);
  end if;
  if public.apv2__balance(u) < st then return jsonb_build_object('ok', false, 'code', 'BALANCE', 'balance', public.apv2__balance(u)); end if;
  pot := floor(st * s.odds)::integer;
  chk := public.apv2__check_limits(u, m.id, mt.id, mt.tournament_ref, s.id, st, pot);
  if chk is not null then return chk; end if;

  b := gen_random_uuid();
  begin
    perform set_config('apv2.note', 'Pedido recebido', true);
    insert into apv2_bets (id, user_id, market_id, selection_id, match_id, selection_label, stake, odds_locked, odds_version_locked, potential, status, request_id)
    values (b, u, m.id, s.id, mt.id, s.label, st, s.odds, s.odds_version, pot, 'pendente_confirmacao', p_request);
    bal := public.apv2__post(u, -st, 'aposta', b::text);   -- débito atómico na mesma transação
    perform set_config('apv2.note', 'Valor debitado; multiplicador ' || s.odds::text || ' congelado', true);
    update apv2_bets set status = 'confirmada', confirmed_at = now() where id = b;
    perform set_config('apv2.note', '', true);
  exception
    when unique_violation then
      select * into prev from apv2_bets where user_id = u and request_id = p_request;
      return jsonb_build_object('ok', true, 'bet', prev.id, 'odds', prev.odds_locked, 'potential', prev.potential, 'status', prev.status, 'balance', public.apv2__balance(u), 'replay', true);
    when raise_exception then
      if sqlerrm = 'BALANCE' then return jsonb_build_object('ok', false, 'code', 'BALANCE', 'balance', public.apv2__balance(u)); end if;
      raise;
  end;
  perform public.apv2__after_bet_limits(m.id, mt.id, mt.tournament_ref);
  return jsonb_build_object('ok', true, 'bet', b, 'odds', s.odds, 'potential', pot, 'status', 'confirmada', 'balance', bal);
end $$;

-- A função antiga passa a ser um atalho para a nova (mesmas validações, limites e estados).
create or replace function public.apv2_place(p_selection uuid, p_stake numeric, p_seen_odds numeric, p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.apv2_bet_confirm(p_selection, p_stake, p_seen_odds, coalesce(p_request, gen_random_uuid()));
end $$;

-- 8. Liquidação (interna, idempotente; nunca credita 2x) -------------------------------------
create or replace function public.apv2__settle_x(p_bet uuid, p_result text, p_official text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b apv2_bets; r text := public.apv2__norm_result(p_result); pay integer; bal integer;
begin
  if r is null then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  select * into b from apv2_bets where id = p_bet for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if not public.apv2__open(b.status) then
    if b.status = r then return jsonb_build_object('ok', true, 'already', true, 'status', b.status, 'payout', b.payout); end if;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SETTLED', 'status', b.status);
  end if;
  pay := case r when 'ganha' then b.potential when 'perdida' then 0 else b.stake end;
  -- uma só referência por aposta no livro-razão: nunca há segundo crédito
  if pay > 0 then bal := public.apv2__post(b.user_id, pay, 'liquidacao', b.id::text); end if;
  perform set_config('apv2.note', coalesce(p_note, ''), true);
  update apv2_bets set status = r, payout = pay, settled_amount = pay, official_result = p_official, settled_at = now(), settled_by = auth.uid() where id = b.id;
  perform set_config('apv2.note', '', true);
  perform public.app__audit('apostas', 'liquidar_aposta', b.id::text, jsonb_build_object('status', b.status),
    jsonb_build_object('status', r, 'payout', pay, 'user', b.user_id, 'resultado', p_official, 'motivo', p_note));
  return jsonb_build_object('ok', true, 'already', false, 'status', r, 'payout', pay);
end $$;

create or replace function public.apv2__settle(p_bet uuid, p_result text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin return public.apv2__settle_x(p_bet, p_result, null, null); end $$;

-- Liquidação manual aposta a aposta: só para mercados antigos (sem confronto). Confrontos só com resultado aprovado.
create or replace function public.apv2_admin_settle_bet(p_bet uuid, p_result text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if exists (select 1 from apv2_bets where id = p_bet and match_id is not null) then return jsonb_build_object('ok', false, 'code', 'RESULT_NOT_VALIDATED'); end if;
  return public.apv2__settle(p_bet, p_result);
end $$;

create or replace function public.apv2_admin_settle_market(p_market uuid, p_winner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m apv2_markets; x record; n integer := 0;
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into m from apv2_markets where id = p_market for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if m.match_id is not null then return jsonb_build_object('ok', false, 'code', 'RESULT_NOT_VALIDATED'); end if;
  if m.status in ('liquidado','anulado') then return jsonb_build_object('ok', true, 'already', true, 'status', m.status); end if;
  if p_winner is not null and not exists (select 1 from apv2_selections where id = p_winner and market_id = p_market) then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  update apv2_selections set result = case when p_winner is null then 'anulada' when id = p_winner then 'ganha' else 'perdida' end
   where market_id = p_market and result = 'pendente';
  for x in select b.id, s.result from apv2_bets b join apv2_selections s on s.id = b.selection_id where b.market_id = p_market and public.apv2__open(b.status) loop
    perform public.apv2__settle(x.id, x.result); n := n + 1;
  end loop;
  update apv2_markets set status = case when p_winner is null then 'anulado' else 'liquidado' end, updated_at = now() where id = p_market;
  perform public.app__audit('apostas', case when p_winner is null then 'anular_mercado' else 'liquidar_mercado' end, p_market::text,
    jsonb_build_object('status', m.status), jsonb_build_object('winner', p_winner, 'bets', n));
  return jsonb_build_object('ok', true, 'already', false, 'bets', n);
end $$;

-- 9. Confrontos e equipas (admin) ------------------------------------------------------------
create or replace function public.apv2__need_motivo(p text) returns boolean language sql immutable as $$
  select length(trim(coalesce(p, ''))) >= 3 $$;

-- Mantém o estado do mercado alinhado com o do confronto.
create or replace function public.apv2__sync_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt apv2_matches;
begin
  select * into mt from apv2_matches where id = p_match;
  update apv2_markets set closes_at = mt.starts_at, updated_at = now(),
    status = case when mt.status = 'apostas_abertas' then 'aberto' when mt.status = 'suspenso' then 'suspenso' else 'fechado' end
   where match_id = p_match and status not in ('liquidado','anulado');
  if mt.status in ('em_andamento','aguarda_resultado') then
    update apv2_bets set status = 'em_andamento' where match_id = p_match and status in ('aberta','confirmada','em_analise');
  elsif mt.status = 'resultado_em_analise' then
    update apv2_bets set status = 'em_analise' where match_id = p_match and status in ('aberta','confirmada','em_andamento');
  end if;
end $$;

create or replace function public.apv2_admin_team_save(p_id uuid, p_game text, p_name text, p_logo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t uuid; old_row jsonb;
begin
  if not public.apv2__has_perm('markets') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if coalesce(p_game, '') <> all (public.apv2__games()) or length(trim(coalesce(p_name, ''))) not between 1 and 60 then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  if p_id is null then
    select id into t from bet_teams where game_key = p_game and lower(name) = lower(trim(p_name));
    if t is null then insert into bet_teams (game_key, name, logo_url) values (p_game, trim(p_name), nullif(trim(coalesce(p_logo, '')), '')) returning id into t; end if;
  else
    select to_jsonb(x) into old_row from bet_teams x where id = p_id;
    if old_row is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
    update bet_teams set game_key = p_game, name = trim(p_name), logo_url = nullif(trim(coalesce(p_logo, '')), '') where id = p_id;
    t := p_id;
  end if;
  perform public.app__audit('apostas', 'guardar_equipa', t::text, old_row, jsonb_build_object('game', p_game, 'name', trim(p_name), 'logo', p_logo));
  return jsonb_build_object('ok', true, 'id', t);
exception
  when check_violation then return jsonb_build_object('ok', false, 'code', 'LOGO_URL');
  when unique_violation then return jsonb_build_object('ok', false, 'code', 'DUPLICATE');
end $$;

-- Criar (p_id nulo) ou editar um confronto. p: {game, team_a_id, team_b_id, team_a_name, team_b_name, team_a_logo, team_b_logo,
-- starts_at, organizer_name, rules, tournament_ref, tournament_name, odds_a, odds_b, odds_draw}
create or replace function public.apv2_admin_match_save(p_id uuid, p jsonb, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  mid uuid; mk uuid; mt apv2_matches; ta bet_teams; tb bet_teams; an text; bn text; g text := coalesce(nullif(p->>'game', ''), 'outros');
  st timestamptz; has_bets boolean;
begin
  if not public.apv2__has_perm('markets') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if g <> all (public.apv2__games()) then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  st := (p->>'starts_at')::timestamptz;
  if st is null then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  if nullif(p->>'team_a_id', '') is not null then select * into ta from bet_teams where id = (p->>'team_a_id')::uuid; end if;
  if nullif(p->>'team_b_id', '') is not null then select * into tb from bet_teams where id = (p->>'team_b_id')::uuid; end if;
  an := coalesce(ta.name, trim(p->>'team_a_name')); bn := coalesce(tb.name, trim(p->>'team_b_name'));
  if coalesce(an, '') = '' or coalesce(bn, '') = '' or lower(an) = lower(bn) then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;

  if p_id is null then
    if st <= now() then return jsonb_build_object('ok', false, 'code', 'PAST_DATE'); end if;
    if coalesce((p->>'odds_a')::numeric, 0) < 1.01 or coalesce((p->>'odds_b')::numeric, 0) < 1.01
       or (p->>'odds_a')::numeric > 1000 or (p->>'odds_b')::numeric > 1000
       or (nullif(p->>'odds_draw', '') is not null and ((p->>'odds_draw')::numeric < 1.01 or (p->>'odds_draw')::numeric > 1000)) then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
    insert into apv2_matches (game_key, team_a_id, team_b_id, team_a_name, team_b_name, team_a_logo, team_b_logo, starts_at, organizer_id, organizer_name, rules, tournament_ref, tournament_name, created_by)
    values (g, ta.id, tb.id, an, bn, coalesce(ta.logo_url, nullif(p->>'team_a_logo', '')), coalesce(tb.logo_url, nullif(p->>'team_b_logo', '')), st, auth.uid(),
            coalesce(p->>'organizer_name', ''), coalesce(p->>'rules', ''), nullif(trim(coalesce(p->>'tournament_ref', '')), ''), coalesce(p->>'tournament_name', ''), auth.uid())
    returning id into mid;
    insert into apv2_markets (title, game_key, status, closes_at, created_by, match_id) values (left(an || ' vs ' || bn, 120), g, 'fechado', st, auth.uid(), mid) returning id into mk;
    insert into apv2_selections (market_id, label, odds, sort, side) values (mk, an, round((p->>'odds_a')::numeric, 2), 0, 'a');
    if nullif(p->>'odds_draw', '') is not null then
      insert into apv2_selections (market_id, label, odds, sort, side) values (mk, 'Empate', round((p->>'odds_draw')::numeric, 2), 1, 'empate');
    end if;
    insert into apv2_selections (market_id, label, odds, sort, side) values (mk, bn, round((p->>'odds_b')::numeric, 2), 2, 'b');
    perform public.app__audit('apostas', 'criar_confronto', mid::text, null, p || jsonb_build_object('market', mk, 'motivo', p_motivo));
    return jsonb_build_object('ok', true, 'id', mid, 'market', mk);
  end if;

  select * into mt from apv2_matches where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if mt.status in ('finalizado','cancelado','resultado_em_analise') then return jsonb_build_object('ok', false, 'code', 'STATE'); end if;
  has_bets := exists (select 1 from apv2_bets where match_id = p_id);
  -- mudança material (equipas/jogo) com apostas feitas: não é permitida (cancela e cria outro confronto)
  if has_bets and (g <> mt.game_key or lower(an) <> lower(mt.team_a_name) or lower(bn) <> lower(mt.team_b_name)) then
    return jsonb_build_object('ok', false, 'code', 'MATERIAL_CHANGE');
  end if;
  if has_bets and not public.apv2__need_motivo(p_motivo) then return jsonb_build_object('ok', false, 'code', 'MOTIVO'); end if;
  update apv2_matches set game_key = g, team_a_id = ta.id, team_b_id = tb.id, team_a_name = an, team_b_name = bn,
    team_a_logo = coalesce(ta.logo_url, nullif(p->>'team_a_logo', '')), team_b_logo = coalesce(tb.logo_url, nullif(p->>'team_b_logo', '')),
    starts_at = st, organizer_name = coalesce(p->>'organizer_name', organizer_name), rules = coalesce(p->>'rules', rules),
    tournament_ref = nullif(trim(coalesce(p->>'tournament_ref', '')), ''), tournament_name = coalesce(p->>'tournament_name', tournament_name)
   where id = p_id;
  update apv2_markets set title = left(an || ' vs ' || bn, 120), game_key = g where match_id = p_id;
  update apv2_selections s set label = case s.side when 'a' then an when 'b' then bn else s.label end
    from apv2_markets k where k.id = s.market_id and k.match_id = p_id and s.side in ('a','b');
  perform public.apv2__sync_match(p_id);
  perform public.app__audit('apostas', 'editar_confronto', p_id::text, to_jsonb(mt), p || jsonb_build_object('motivo', p_motivo));
  return jsonb_build_object('ok', true, 'id', p_id);
exception when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  return jsonb_build_object('ok', false, 'code', 'INVALID');
end $$;

-- Abrir / suspender / fechar / em andamento / aguarda resultado. (Finalizar = aprovar resultado; cancelar = apv2_admin_match_cancel.)
create or replace function public.apv2_admin_match_status(p_match uuid, p_status text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mt apv2_matches;
begin
  if not public.apv2__has_perm('markets') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if not public.apv2__need_motivo(p_motivo) then return jsonb_build_object('ok', false, 'code', 'MOTIVO'); end if;
  if p_status not in ('agendado','apostas_abertas','suspenso','em_andamento','aguarda_resultado') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  select * into mt from apv2_matches where id = p_match for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if mt.status = p_status then return jsonb_build_object('ok', true, 'already', true); end if;
  if not public.apv2__match_next_ok(mt.status, p_status) then return jsonb_build_object('ok', false, 'code', 'STATE', 'status', mt.status); end if;
  if p_status = 'apostas_abertas' and mt.starts_at <= now() then return jsonb_build_object('ok', false, 'code', 'PAST_DATE'); end if;
  perform set_config('apv2.note', trim(p_motivo), true);
  update apv2_matches set status = p_status where id = p_match;
  perform public.apv2__sync_match(p_match);
  perform set_config('apv2.note', '', true);
  perform public.app__audit('apostas', 'estado_confronto', p_match::text, jsonb_build_object('status', mt.status), jsonb_build_object('status', p_status, 'motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true);
end $$;

-- Cancelar: todas as apostas em aberto são reembolsadas (idempotente).
create or replace function public.apv2_admin_match_cancel(p_match uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mt apv2_matches; x record; n integer := 0;
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if not public.apv2__need_motivo(p_motivo) then return jsonb_build_object('ok', false, 'code', 'MOTIVO'); end if;
  select * into mt from apv2_matches where id = p_match for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if mt.status = 'cancelado' then return jsonb_build_object('ok', true, 'already', true); end if;
  if mt.status = 'finalizado' then return jsonb_build_object('ok', false, 'code', 'STATE'); end if;
  perform 1 from apv2_markets where match_id = p_match for update;
  update apv2_matches set status = 'cancelado', result = 'cancelado' where id = p_match;
  update apv2_results set status = 'rejeitado', reviewed_at = now(), review_motivo = 'Confronto cancelado: ' || trim(p_motivo) where match_id = p_match and status = 'proposto';
  for x in select id from apv2_bets where match_id = p_match and public.apv2__open(status) loop
    perform public.apv2__settle_x(x.id, 'reembolsada', 'cancelado', 'Confronto cancelado: ' || trim(p_motivo)); n := n + 1;
  end loop;
  update apv2_selections s set result = 'anulada' from apv2_markets k where k.id = s.market_id and k.match_id = p_match and s.result = 'pendente';
  update apv2_markets set status = 'anulado', updated_at = now() where match_id = p_match and status not in ('liquidado','anulado');
  perform public.app__audit('apostas', 'cancelar_confronto', p_match::text, jsonb_build_object('status', mt.status), jsonb_build_object('status', 'cancelado', 'refunds', n, 'motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true, 'already', false, 'refunds', n);
end $$;

-- 10. Resultados com dupla validação -------------------------------------------------------
create table if not exists public.apv2_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.apv2_matches(id) on delete cascade,
  winner text not null check (winner in ('a','b','empate')),
  score_a integer check (score_a is null or score_a >= 0),
  score_b integer check (score_b is null or score_b >= 0),
  evidence text not null default '' check (length(evidence) <= 1000),
  motivo text not null default '' check (length(motivo) <= 500),
  proposed_by uuid not null references public.profiles(id),
  proposed_at timestamptz not null default now(),
  request_id uuid,
  status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_motivo text not null default '',
  constraint apv2_results_two_people check (reviewed_by is null or reviewed_by <> proposed_by)
);
create unique index if not exists apv2_results_open_uq on public.apv2_results (match_id) where status = 'proposto';
create unique index if not exists apv2_results_approved_uq on public.apv2_results (match_id) where status = 'aprovado';
create unique index if not exists apv2_results_request_uq on public.apv2_results (proposed_by, request_id) where request_id is not null;

create or replace function public.apv2_admin_result_propose(p_match uuid, p_winner text, p_score_a integer, p_score_b integer, p_evidence text, p_motivo text, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mt apv2_matches; rid uuid; prev apv2_results;
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_request is not null then
    select * into prev from apv2_results where proposed_by = auth.uid() and request_id = p_request;
    if found then return jsonb_build_object('ok', true, 'id', prev.id, 'replay', true); end if;
  end if;
  if not public.apv2__need_motivo(p_motivo) then return jsonb_build_object('ok', false, 'code', 'MOTIVO'); end if;
  if p_winner is null or p_winner not in ('a','b','empate') or coalesce(p_score_a, 0) < 0 or coalesce(p_score_b, 0) < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RESULT');
  end if;
  select * into mt from apv2_matches where id = p_match for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if mt.status not in ('em_andamento','aguarda_resultado') then return jsonb_build_object('ok', false, 'code', 'STATE', 'status', mt.status); end if;
  -- empate só se o mercado tiver a seleção Empate; placar tem de bater certo com o vencedor
  if p_winner = 'empate' and not exists (select 1 from apv2_selections s join apv2_markets k on k.id = s.market_id where k.match_id = p_match and s.side = 'empate') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RESULT');
  end if;
  if p_score_a is not null and p_score_b is not null and (
     (p_winner = 'a' and p_score_a <= p_score_b) or (p_winner = 'b' and p_score_b <= p_score_a) or (p_winner = 'empate' and p_score_a <> p_score_b)) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RESULT');
  end if;
  insert into apv2_results (match_id, winner, score_a, score_b, evidence, motivo, proposed_by, request_id)
  values (p_match, p_winner, p_score_a, p_score_b, coalesce(p_evidence, ''), trim(p_motivo), auth.uid(), p_request) returning id into rid;
  perform set_config('apv2.note', 'Resultado proposto, à espera de revisão', true);
  update apv2_matches set status = 'resultado_em_analise' where id = p_match;
  perform public.apv2__sync_match(p_match);
  perform set_config('apv2.note', '', true);
  perform public.app__audit('apostas', 'propor_resultado', p_match::text, jsonb_build_object('status', mt.status),
    jsonb_build_object('result', rid, 'winner', p_winner, 'score', jsonb_build_array(p_score_a, p_score_b), 'motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true, 'id', rid);
exception when unique_violation then return jsonb_build_object('ok', false, 'code', 'RESULT_PENDING');
end $$;

-- Rever: outra pessoa aprova (liquida tudo) ou rejeita (volta a aguardar resultado). Idempotente.
create or replace function public.apv2_admin_result_review(p_result uuid, p_approve boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r apv2_results; mt apv2_matches; x record; n integer := 0; win text; label text;
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if not public.apv2__need_motivo(p_motivo) then return jsonb_build_object('ok', false, 'code', 'MOTIVO'); end if;
  select * into r from apv2_results where id = p_result for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if r.status <> 'proposto' then
    if (r.status = 'aprovado') = coalesce(p_approve, false) then return jsonb_build_object('ok', true, 'already', true, 'status', r.status); end if;
    return jsonb_build_object('ok', false, 'code', 'STATE', 'status', r.status);
  end if;
  if r.proposed_by = auth.uid() then return jsonb_build_object('ok', false, 'code', 'SAME_REVIEWER'); end if;
  select * into mt from apv2_matches where id = r.match_id for update;
  if not p_approve then
    update apv2_results set status = 'rejeitado', reviewed_by = auth.uid(), reviewed_at = now(), review_motivo = trim(p_motivo) where id = p_result;
    perform set_config('apv2.note', 'Resultado rejeitado na revisão: ' || trim(p_motivo), true);
    update apv2_matches set status = 'aguarda_resultado' where id = r.match_id;
    perform public.apv2__sync_match(r.match_id);
    perform set_config('apv2.note', '', true);
    perform public.app__audit('apostas', 'rejeitar_resultado', r.match_id::text, jsonb_build_object('result', p_result), jsonb_build_object('motivo', trim(p_motivo)));
    return jsonb_build_object('ok', true, 'status', 'rejeitado');
  end if;
  update apv2_results set status = 'aprovado', reviewed_by = auth.uid(), reviewed_at = now(), review_motivo = trim(p_motivo) where id = p_result;
  update apv2_matches set status = 'finalizado', result = r.winner, score_a = r.score_a, score_b = r.score_b where id = r.match_id;
  label := case r.winner when 'a' then mt.team_a_name when 'b' then mt.team_b_name else 'Empate' end
           || coalesce(' (' || r.score_a || '-' || r.score_b || ')', '');
  perform 1 from apv2_markets where match_id = r.match_id for update;
  update apv2_selections s set result = case when s.side = r.winner then 'ganha' else 'perdida' end
    from apv2_markets k where k.id = s.market_id and k.match_id = r.match_id and s.result = 'pendente';
  for x in select b.id, s.side from apv2_bets b join apv2_selections s on s.id = b.selection_id where b.match_id = r.match_id and public.apv2__open(b.status) loop
    win := case when x.side = r.winner then 'ganha' else 'perdida' end;
    perform public.apv2__settle_x(x.id, win, label, 'Resultado oficial validado'); n := n + 1;
  end loop;
  update apv2_markets set status = 'liquidado', updated_at = now() where match_id = r.match_id and status not in ('liquidado','anulado');
  perform public.app__audit('apostas', 'aprovar_resultado', r.match_id::text, jsonb_build_object('result', p_result, 'proposed_by', r.proposed_by),
    jsonb_build_object('winner', r.winner, 'bets', n, 'motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true, 'status', 'aprovado', 'bets', n);
end $$;

-- Reembolso individual (idempotente: um segundo pedido não credita outra vez).
create or replace function public.apv2_admin_refund_bet(p_bet uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if not public.apv2__need_motivo(p_motivo) then return jsonb_build_object('ok', false, 'code', 'MOTIVO'); end if;
  return public.apv2__settle_x(p_bet, 'reembolsada', null, 'Reembolso: ' || trim(p_motivo));
end $$;

-- 11. Limites e valores sugeridos (admin) ---------------------------------------------------
create or replace function public.apv2_admin_limit_set(p_scope text, p_ref text, p_max_stake integer, p_max_exposure integer, p_auto_suspend boolean, p_active boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_row apv2_limits; rf text := coalesce(trim(p_ref), '');
begin
  if not public.apv2__has_perm('toggle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if not public.apv2__need_motivo(p_motivo) then return jsonb_build_object('ok', false, 'code', 'MOTIVO'); end if;
  if p_scope not in ('user','match','market','event','global_exposure') or (p_scope = 'global_exposure' and rf <> '')
     or (p_scope in ('match','market','event') and rf = '') or (p_max_stake is not null and p_max_stake < 1) or (p_max_exposure is not null and p_max_exposure < 0) then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  select * into old_row from apv2_limits where scope = p_scope and ref = rf;
  insert into apv2_limits (scope, ref, max_stake, max_exposure, auto_suspend, active, updated_by)
  values (p_scope, rf, p_max_stake, p_max_exposure, coalesce(p_auto_suspend, true), coalesce(p_active, true), auth.uid())
  on conflict (scope, ref) do update set max_stake = excluded.max_stake, max_exposure = excluded.max_exposure, auto_suspend = excluded.auto_suspend,
    active = excluded.active, updated_by = excluded.updated_by, updated_at = now();
  perform public.app__audit('apostas', 'limite', p_scope || ':' || rf, to_jsonb(old_row),
    jsonb_build_object('max_stake', p_max_stake, 'max_exposure', p_max_exposure, 'auto_suspend', p_auto_suspend, 'active', p_active, 'motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.apv2_admin_set_stake_chips(p_values jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; x jsonb; prev numeric := 0; cur jsonb := public.apv2__chips();
begin
  if not public.apv2__has_perm('toggle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_values is null or jsonb_typeof(p_values) <> 'array' or jsonb_array_length(p_values) not between 1 and 8 then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  for x in select * from jsonb_array_elements(p_values) loop
    if jsonb_typeof(x) <> 'number' or (x::text)::numeric <> trunc((x::text)::numeric) or (x::text)::numeric <= prev or (x::text)::numeric > 1000000 then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
    prev := (x::text)::numeric; v := v || x;
  end loop;
  update app_settings set value = v, updated_at = now(), updated_by = auth.uid() where key = 'apostas_stake_chips';
  perform public.app__audit('apostas', 'definicao:apostas_stake_chips', 'apostas_stake_chips', jsonb_build_object('value', cur), jsonb_build_object('value', v));
  return jsonb_build_object('ok', true, 'value', v);
end $$;

-- 12. Reclamações ---------------------------------------------------------------------------
create table if not exists public.apv2_complaints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bet_id uuid references public.apv2_bets(id) on delete set null,
  match_id uuid references public.apv2_matches(id) on delete set null,
  message text not null check (length(trim(message)) between 5 and 1000),
  status text not null default 'aberta' check (status in ('aberta','em_analise','resolvida','rejeitada')),
  response text not null default '' check (length(response) <= 1000),
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists apv2_complaints_status_idx on public.apv2_complaints (status, created_at desc);
create index if not exists apv2_complaints_user_idx on public.apv2_complaints (user_id, created_at desc);

create or replace function public.apv2_complaint_open(p_bet uuid, p_match uuid, p_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cid uuid; mt uuid := p_match;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if length(trim(coalesce(p_message, ''))) not between 5 and 1000 then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  if p_bet is not null then
    select match_id into mt from apv2_bets where id = p_bet and user_id = u;   -- só sobre as próprias apostas
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
    mt := coalesce(mt, p_match);
  end if;
  if (select count(*) from apv2_complaints where user_id = u and status in ('aberta','em_analise')) >= 5 then return jsonb_build_object('ok', false, 'code', 'TOO_MANY'); end if;
  insert into apv2_complaints (user_id, bet_id, match_id, message) values (u, p_bet, mt, trim(p_message)) returning id into cid;
  return jsonb_build_object('ok', true, 'id', cid);
end $$;

create or replace function public.apv2_admin_complaint_update(p_id uuid, p_status text, p_response text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c apv2_complaints;
begin
  if not public.apv2__has_perm('settle') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_status not in ('em_analise','resolvida','rejeitada') or (p_status <> 'em_analise' and not public.apv2__need_motivo(p_response)) then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  select * into c from apv2_complaints where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if c.status in ('resolvida','rejeitada') then return jsonb_build_object('ok', false, 'code', 'STATE'); end if;
  update apv2_complaints set status = p_status, response = coalesce(trim(p_response), ''), resolved_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.app__audit('apostas', 'reclamacao', p_id::text, jsonb_build_object('status', c.status), jsonb_build_object('status', p_status, 'motivo', p_response));
  return jsonb_build_object('ok', true);
end $$;

-- 13. Leituras para a app -----------------------------------------------------------------
create or replace function public.apv2_v3_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  return jsonb_build_object('ok', true, 'v3', true, 'enabled', public.apv2__enabled(), 'limits', public.apv2__limits(), 'chips', public.apv2__chips(),
    'balance', case when u is null then 0 else public.apv2__balance(u) end,
    'claimed', u is not null and exists (select 1 from apv2_test_ledger where user_id = u and reason = 'inicial'),
    'block', case when u is null then null else public.apv2__account_block(u) end,
    'staff', public.apv2__staff(), 'server_now', now());
end $$;

-- Carteira de apostas (saldo de teste): disponível, reservado (em jogo), pendentes, ganhos liquidados, histórico.
create or replace function public.apv2_wallet() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  return jsonb_build_object('ok', true, 'currency', 'teste',
    'available', public.apv2__balance(u),
    'reserved', (select coalesce(sum(stake), 0) from apv2_bets where user_id = u and public.apv2__open(status)),
    'pending', (select count(*) from apv2_bets where user_id = u and public.apv2__open(status)),
    'won_total', (select coalesce(sum(payout), 0) from apv2_bets where user_id = u and status = 'ganha'),
    'net_won', (select coalesce(sum(payout - stake), 0) from apv2_bets where user_id = u and status = 'ganha'),
    'refunded_total', (select coalesce(sum(payout), 0) from apv2_bets where user_id = u and status in ('reembolsada','anulada')),
    'ledger', (select coalesce(jsonb_agg(x order by x.id desc), '[]') from (
        select id, delta, reason, ref, balance_after, created_at from apv2_test_ledger where user_id = u order by id desc limit 50) x));
end $$;

-- Atualização automática por horário (cron/Edge Function ou botão do admin): confrontos com apostas abertas cuja hora
-- já passou passam a 'em_andamento' (as apostas também). Sem utilizador (cron/service_role) ou com permissão 'markets'.
create or replace function public.apv2_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare x record; n integer := 0;
begin
  if auth.uid() is not null and not public.apv2__has_perm('markets') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  for x in select id from apv2_matches where status = 'apostas_abertas' and starts_at <= now() for update skip locked loop
    perform set_config('apv2.note', 'Início do confronto (automático)', true);
    update apv2_matches set status = 'em_andamento' where id = x.id;
    perform public.apv2__sync_match(x.id);
    perform public.app__audit('apostas', 'estado_confronto', x.id::text, jsonb_build_object('status', 'apostas_abertas'), jsonb_build_object('status', 'em_andamento', 'motivo', 'automático: hora de início'));
    n := n + 1;
  end loop;
  perform set_config('apv2.note', '', true);
  return jsonb_build_object('ok', true, 'started', n);
end $$;

-- Painel do admin (v3): confrontos, equipas, limites, resultados, reclamações, exposição, valores sugeridos.
create or replace function public.apv2_admin_v3_view() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.apv2__staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true, 'chips', public.apv2__chips(), 'server_now', now(),
    'matches', (select coalesce(jsonb_agg(x order by x.starts_at desc), '[]') from (
        select mt.*, (select k.id from apv2_markets k where k.match_id = mt.id order by k.created_at limit 1) as market_id,
          (select count(*) from apv2_bets b where b.match_id = mt.id) as bets,
          (select coalesce(sum(b.stake), 0) from apv2_bets b where b.match_id = mt.id and public.apv2__open(b.status)) as open_stake
        from apv2_matches mt order by mt.starts_at desc limit 300) x),
    'teams', (select coalesce(jsonb_agg(x order by x.game_key, x.name), '[]') from (select id, game_key, name, logo_url from bet_teams order by game_key, name limit 1000) x),
    'limits', (select coalesce(jsonb_agg(l order by l.scope, l.ref), '[]') from apv2_limits l),
    'results', (select coalesce(jsonb_agg(x order by x.proposed_at desc), '[]') from (
        select r.*, coalesce(p.handle, '') as proposer, coalesce(q.handle, '') as reviewer from apv2_results r
        left join profiles p on p.id = r.proposed_by left join profiles q on q.id = r.reviewed_by order by r.proposed_at desc limit 200) x),
    'complaints', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
        select c.*, coalesce(p.handle, '') as handle from apv2_complaints c left join profiles p on p.id = c.user_id order by c.created_at desc limit 200) x),
    'exposure', (select coalesce(jsonb_agg(x order by x.exposure desc), '[]') from (
        select k.id as market_id, k.title, k.status, k.match_id, public.apv2__market_exposure(k.id) as exposure,
          (select coalesce(sum(b.stake), 0) from apv2_bets b where b.market_id = k.id and public.apv2__open(b.status)) as open_stake,
          (select count(*) from apv2_bets b where b.market_id = k.id and public.apv2__open(b.status)) as open_bets
        from apv2_markets k where exists (select 1 from apv2_bets b where b.market_id = k.id and public.apv2__open(b.status))) x),
    'ledger', (select coalesce(jsonb_agg(x order by x.id desc), '[]') from (
        select l.id, l.user_id, coalesce(p.handle, '') as handle, l.delta, l.reason, l.ref, l.balance_after, l.created_at
        from apv2_test_ledger l left join profiles p on p.id = l.user_id order by l.id desc limit 300) x));
end $$;

-- 14. RLS e permissões ---------------------------------------------------------------------
alter table public.apv2_matches enable row level security;
alter table public.apv2_bet_events enable row level security;
alter table public.apv2_limits enable row level security;
alter table public.apv2_results enable row level security;
alter table public.apv2_complaints enable row level security;

drop policy if exists apv2_matches_read on public.apv2_matches;
create policy apv2_matches_read on public.apv2_matches for select using (true);
drop policy if exists apv2_bet_events_read on public.apv2_bet_events;
create policy apv2_bet_events_read on public.apv2_bet_events for select using (user_id = (select auth.uid()) or (select public.apv2__staff()));
drop policy if exists apv2_limits_read on public.apv2_limits;
create policy apv2_limits_read on public.apv2_limits for select using ((select public.apv2__staff()));
drop policy if exists apv2_results_read on public.apv2_results;
create policy apv2_results_read on public.apv2_results for select using (status = 'aprovado' or (select public.apv2__staff()));
drop policy if exists apv2_complaints_read on public.apv2_complaints;
create policy apv2_complaints_read on public.apv2_complaints for select using (user_id = (select auth.uid()) or (select public.apv2__staff()));

revoke insert, update, delete on public.apv2_matches, public.apv2_bet_events, public.apv2_limits, public.apv2_results, public.apv2_complaints from anon, authenticated;
grant select on public.apv2_matches to anon, authenticated;
grant select on public.apv2_bet_events, public.apv2_limits, public.apv2_results, public.apv2_complaints to authenticated;

revoke execute on function public.apv2__settle_x(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.apv2__settle(uuid, text) from public, anon, authenticated;
revoke execute on function public.apv2__check_limits(uuid, uuid, uuid, text, uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.apv2__after_bet_limits(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.apv2__auto_suspend(uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.apv2__sync_match(uuid) from public, anon, authenticated;
grant execute on function public.apv2_bet_confirm(uuid, numeric, numeric, uuid) to authenticated;
grant execute on function public.apv2_place(uuid, numeric, numeric, uuid) to authenticated;
grant execute on function public.apv2_v3_me() to anon, authenticated;
grant execute on function public.apv2_wallet() to authenticated;
grant execute on function public.apv2_complaint_open(uuid, uuid, text) to authenticated;
grant execute on function public.apv2_tick() to authenticated;
grant execute on function public.apv2_admin_team_save(uuid, text, text, text) to authenticated;
grant execute on function public.apv2_admin_match_save(uuid, jsonb, text) to authenticated;
grant execute on function public.apv2_admin_match_status(uuid, text, text) to authenticated;
grant execute on function public.apv2_admin_match_cancel(uuid, text) to authenticated;
grant execute on function public.apv2_admin_result_propose(uuid, text, integer, integer, text, text, uuid) to authenticated;
grant execute on function public.apv2_admin_result_review(uuid, boolean, text) to authenticated;
grant execute on function public.apv2_admin_refund_bet(uuid, text) to authenticated;
grant execute on function public.apv2_admin_limit_set(text, text, integer, integer, boolean, boolean, text) to authenticated;
grant execute on function public.apv2_admin_set_stake_chips(jsonb) to authenticated;
grant execute on function public.apv2_admin_complaint_update(uuid, text, text) to authenticated;
grant execute on function public.apv2_admin_v3_view() to authenticated;
grant execute on function public.apv2_admin_settle_bet(uuid, text) to authenticated;
grant execute on function public.apv2_admin_settle_market(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
select 'apostas v3 instalado' as ok, (select value from public.app_settings where key = 'apostas_stake_chips') as valores_sugeridos;
