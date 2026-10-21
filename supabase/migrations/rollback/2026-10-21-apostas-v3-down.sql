-- =====================================================================
-- TXAPILOG · ROLLBACK de Apostas v3 (2026-10-21-apostas-v3.sql). Volta ao estado da v2.
--
-- ATENÇÃO — lê antes de correr:
-- • APAGA as tabelas novas da v3 e o que têm: confrontos (apv2_matches), resultados (apv2_results), limites
--   (apv2_limits), histórico por aposta (apv2_bet_events) e reclamações (apv2_complaints). Exporta-as antes se
--   precisares delas (Table Editor › Export CSV).
-- • NÃO apaga apostas nem lançamentos do saldo de teste. Apostas com estados novos ainda em aberto
--   (pendente_confirmacao / confirmada / em_andamento / em_analise) voltam a 'aberta'. Os mercados que eram de
--   confrontos ficam como mercados simples da v2 (o título "Equipa A vs Equipa B" mantém-se).
-- • Equipas/mercados com os jogos novos (fortnite, cod, valorant, minecraft) ficam como estão; o CHECK antigo é
--   reposto com NOT VALID (não verifica as linhas existentes, só as novas).
-- • Repõe as versões v2 das funções apv2__tg_bet_lock, apv2_place, apv2__settle, apv2_admin_settle_bet e
--   apv2_admin_settle_market (copiadas de 2026-10-20-apostas-v2.sql).
-- Corre tudo de uma vez no SQL Editor. Idempotente.
-- =====================================================================

-- 1. Funções novas da v3
drop function if exists public.apv2_bet_confirm(uuid, numeric, numeric, uuid);
drop function if exists public.apv2_v3_me();
drop function if exists public.apv2_wallet();
drop function if exists public.apv2_tick();
drop function if exists public.apv2_complaint_open(uuid, uuid, text);
drop function if exists public.apv2_admin_team_save(uuid, text, text, text);
drop function if exists public.apv2_admin_match_save(uuid, jsonb, text);
drop function if exists public.apv2_admin_match_status(uuid, text, text);
drop function if exists public.apv2_admin_match_cancel(uuid, text);
drop function if exists public.apv2_admin_result_propose(uuid, text, integer, integer, text, text, uuid);
drop function if exists public.apv2_admin_result_review(uuid, boolean, text);
drop function if exists public.apv2_admin_refund_bet(uuid, text);
drop function if exists public.apv2_admin_limit_set(text, text, integer, integer, boolean, boolean, text);
drop function if exists public.apv2_admin_set_stake_chips(jsonb);
drop function if exists public.apv2_admin_complaint_update(uuid, text, text);
drop function if exists public.apv2_admin_v3_view();
drop function if exists public.apv2__settle_x(uuid, text, text, text);
drop function if exists public.apv2__check_limits(uuid, uuid, uuid, text, uuid, integer, integer);
drop function if exists public.apv2__after_bet_limits(uuid, uuid, text);
drop function if exists public.apv2__auto_suspend(uuid, text, integer, integer);
drop function if exists public.apv2__exposure_of(uuid[], uuid, uuid, integer, integer);
drop function if exists public.apv2__market_exposure(uuid, uuid, integer, integer);
drop function if exists public.apv2__account_block(uuid);
drop function if exists public.apv2__sync_match(uuid);
drop function if exists public.apv2__need_motivo(text);
drop function if exists public.apv2__chips();
drop function if exists public.apv2__lim(text, text);

-- 2. Histórico por aposta e trigger
drop trigger if exists apv2_bet_event on public.apv2_bets;
drop function if exists public.apv2__tg_bet_event();
drop table if exists public.apv2_bet_events;

-- 3. Apostas: estados e colunas novas (desliga a trava v3 antes de mapear os estados)
drop trigger if exists apv2_bet_lock on public.apv2_bets;
update public.apv2_bets set status = 'aberta' where status in ('pendente_confirmacao','confirmada','em_andamento','em_analise');
alter table public.apv2_bets drop constraint if exists apv2_bets_status_v3;
alter table public.apv2_bets drop constraint if exists apv2_bets_settled_amount_v3;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.apv2_bets'::regclass and conname = 'apv2_bets_status_check') then
    alter table public.apv2_bets add constraint apv2_bets_status_check check (status in ('aberta','ganha','perdida','anulada','reembolsada'));
  end if;
end $$;
drop index if exists public.apv2_bets_match_idx;
drop index if exists public.apv2_bets_market_status_idx;
alter table public.apv2_bets drop column if exists match_id;
alter table public.apv2_bets drop column if exists selection_label;
alter table public.apv2_bets drop column if exists confirmed_at;
alter table public.apv2_bets drop column if exists official_result;
alter table public.apv2_bets drop column if exists settled_amount;
alter table public.apv2_bets drop column if exists settle_request;
drop function if exists public.apv2__bet_next_ok(text, text);

-- 4. Tabelas novas
drop table if exists public.apv2_complaints;
drop table if exists public.apv2_results;
drop table if exists public.apv2_limits;
drop index if exists public.apv2_markets_match_idx;
alter table public.apv2_markets drop column if exists match_id;
alter table public.apv2_selections drop constraint if exists apv2_selections_side_v3;
alter table public.apv2_selections drop column if exists side;
drop table if exists public.apv2_matches;
drop function if exists public.apv2__tg_match_state();
drop function if exists public.apv2__match_next_ok(text, text);

-- 5. Valores sugeridos
delete from public.app_settings where key = 'apostas_stake_chips';

-- 6. Jogos: repõe os CHECK antigos (NOT VALID: linhas existentes com jogos novos ficam)
alter table public.apv2_markets drop constraint if exists apv2_markets_game_key_v3;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.apv2_markets'::regclass and conname = 'apv2_markets_game_key_check') then
    alter table public.apv2_markets add constraint apv2_markets_game_key_check check (game_key in ('ff','cr','ef','dls','outros')) not valid;
  end if;
  if to_regclass('public.bet_teams') is not null then
    alter table public.bet_teams drop constraint if exists bet_teams_game_key_v3;
    if not exists (select 1 from pg_constraint where conrelid = 'public.bet_teams'::regclass and conname = 'bet_teams_game_key_check') then
      alter table public.bet_teams add constraint bet_teams_game_key_check check (game_key in ('ff','cr','ef','dls','outros')) not valid;
    end if;
  end if;
end $$;

-- 7. Funções da v2 tal como estavam (copiadas de 2026-10-20-apostas-v2.sql)
create or replace function public.apv2__tg_bet_lock() returns trigger language plpgsql as $$
begin
  if new.stake <> old.stake or new.odds_locked <> old.odds_locked or new.odds_version_locked <> old.odds_version_locked
     or new.potential <> old.potential or new.user_id <> old.user_id or new.selection_id <> old.selection_id or new.market_id <> old.market_id then
    raise exception 'BET_LOCKED';
  end if;
  if old.status <> 'aberta' and (new.status <> old.status or new.payout <> old.payout) then raise exception 'ALREADY_SETTLED'; end if;
  return new;
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

create trigger apv2_bet_lock before update on public.apv2_bets for each row execute function public.apv2__tg_bet_lock();

revoke execute on function public.apv2__settle(uuid, text) from public, anon, authenticated;
grant execute on function public.apv2_place(uuid, numeric, numeric, uuid) to authenticated;
grant execute on function public.apv2_admin_settle_bet(uuid, text) to authenticated;
grant execute on function public.apv2_admin_settle_market(uuid, uuid) to authenticated;

drop function if exists public.apv2__open(text);
drop function if exists public.apv2__games();

notify pgrst, 'reload schema';
select 'apostas v3 revertido (v2 ativa)' as ok;
