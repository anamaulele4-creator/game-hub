-- TXAPILOG · Fotos/logótipos das equipas nas apostas — 2026-10-10. IDEMPOTENTE.
-- O capitão pode enviar o logótipo na inscrição (equipas); o admin pode carregar, trocar ou remover em Admin › Apostas › Equipas.
-- Sem foto, a app mostra um monograma com as iniciais.
alter table public.bet_teams add column if not exists logo_url text;
alter table public.bet_teams drop constraint if exists bet_teams_logo_format;
alter table public.bet_teams add constraint bet_teams_logo_format check (logo_url is null or logo_url ~ '/storage/v1/object/public/media/teams/');

create or replace function public.bets_admin_team_logo(p_team uuid, p_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_url is not null and p_url !~ '/storage/v1/object/public/media/teams/' then return jsonb_build_object('ok', false, 'code', 'URL'); end if;
  update bet_teams set logo_url = p_url where id = p_team;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  perform public.bets__log(case when p_url is null then 'logo_removido' else 'logo_equipa' end, p_team::text, jsonb_build_object('equipa', (select name from bet_teams where id = p_team)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.bets_admin_team_logo(uuid, text) from public, anon;
grant execute on function public.bets_admin_team_logo(uuid, text) to authenticated;

-- Storage: pasta teams/ só para administradores
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (
    (name like 'products/' || (select auth.uid())::text || '/%') or
    (name like 'tournaments/%' and (select public.tx__can_organize())) or
    (name like 'teams/' || (select auth.uid())::text || '/%') or
    (name like 'teams/%' and (select public.is_admin()))));
notify pgrst, 'reload schema';

-- Logótipo enviado pelo capitão na inscrição
alter table public.tournament_entries add column if not exists team_logo_url text;
alter table public.tournament_entries drop constraint if exists tournament_entries_logo_format;
alter table public.tournament_entries add constraint tournament_entries_logo_format check (team_logo_url is null or team_logo_url ~ ('/storage/v1/object/public/media/teams/' || user_id::text || '/'));

drop function if exists public.tournament_register(text, text, text, text, text, text, boolean);
create or replace function public.tournament_register(p_tournament text, p_player_name text, p_game_id text, p_team text, p_contact text,
  p_discord_username text default null, p_discord_joined boolean default false, p_team_logo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t tournaments; inv text; du text := nullif(trim(coalesce(p_discord_username, '')), ''); lg text := nullif(trim(coalesce(p_team_logo, '')), '');
begin
  if uid is null or not exists (select 1 from profiles where id = uid and not banned) then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into t from tournaments where id = p_tournament for update;
  if t.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if exists (select 1 from tournament_entries where user_id = uid and tournament_id = p_tournament) then return jsonb_build_object('ok', false, 'code', 'ALREADY'); end if;
  if t.status <> 'aberto' then return jsonb_build_object('ok', false, 'code', 'CLOSED'); end if;
  if t.entry_fee_mzn > 0 then return jsonb_build_object('ok', false, 'code', 'PAID'); end if;
  if t.entries_count >= t.slots then return jsonb_build_object('ok', false, 'code', 'FULL'); end if;
  if length(trim(coalesce(p_player_name, ''))) < 2 or length(trim(coalesce(p_game_id, ''))) < 3 or length(trim(coalesce(p_contact, ''))) < 5 then
    return jsonb_build_object('ok', false, 'code', 'FORM'); end if;
  if lg is not null and lg !~ ('/storage/v1/object/public/media/teams/' || uid::text || '/') then return jsonb_build_object('ok', false, 'code', 'LOGO'); end if;
  inv := public.tx__discord_invite(p_tournament);
  if t.require_discord then
    if inv is null then return jsonb_build_object('ok', false, 'code', 'DISCORD_MISSING'); end if;
    if du is null or not coalesce(p_discord_joined, false) then return jsonb_build_object('ok', false, 'code', 'DISCORD'); end if;
  end if;
  if du is not null and du !~ '^([a-z0-9_.]{2,32}|.{2,32}#[0-9]{4})$' then return jsonb_build_object('ok', false, 'code', 'DISCORD'); end if;
  insert into tournament_entries (user_id, tournament_id, team, player_name, game_id, contact, discord_username, discord_joined, status, team_logo_url)
    values (uid, p_tournament, nullif(trim(coalesce(p_team, '')), ''), trim(p_player_name), trim(p_game_id), trim(p_contact), du, coalesce(p_discord_joined, false), 'confirmada', lg);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.tournament_register(text, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.tournament_register(text, text, text, text, text, text, boolean, text) to authenticated;

-- Ao agendar um jogo de apostas, a equipa herda o logótipo enviado na inscrição (se ainda não tiver um do admin)
create or replace function public.bets__tg_team_logo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tournament_id is null then return null; end if;
  update bet_teams b set logo_url = e.team_logo_url
  from tournament_entries e
  where b.id in (new.home_team_id, new.away_team_id) and b.logo_url is null
    and e.tournament_id = new.tournament_id and e.team_logo_url is not null and lower(trim(e.team)) = lower(b.name);
  return null;
end $$;
drop trigger if exists bet_match_team_logo on public.bet_matches;
create trigger bet_match_team_logo after insert on public.bet_matches for each row execute function public.bets__tg_team_logo();
revoke all on function public.bets__tg_team_logo() from public, anon, authenticated;
notify pgrst, 'reload schema';
