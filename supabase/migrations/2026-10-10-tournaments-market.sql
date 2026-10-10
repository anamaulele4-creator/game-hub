-- =====================================================================
-- TXAPILOG · Torneios (capa, inscrição com Discord) + Marketplace com fotos — 2026-10-10. IDEMPOTENTE.
-- Inscrição passa só pela função tournament_register (valida vagas, inscrição grátis e o passo do Discord).
-- Contactos e usernames do Discord deixam de ser públicos: cada um vê as suas inscrições; admin/organizador vê todas.
-- Imagens no bucket público "media": tournaments/<id>/… (admin/organizador) e products/<uid>/… (o próprio vendedor).
-- =====================================================================

-- 1. Torneios ---------------------------------------------------------------------------
alter table public.tournaments add column if not exists cover_url text;
alter table public.tournaments add column if not exists discord_invite text;
alter table public.tournaments add column if not exists require_discord boolean not null default false;
alter table public.tournaments drop constraint if exists tournaments_discord_invite_format;
alter table public.tournaments add constraint tournaments_discord_invite_format
  check (discord_invite is null or discord_invite = '' or discord_invite ~ '^https://(discord\.gg|(www\.)?discord\.com/invite)/[A-Za-z0-9-]{2,32}/?$');

alter table public.tournament_entries add column if not exists player_name text;
alter table public.tournament_entries add column if not exists game_id text;
alter table public.tournament_entries add column if not exists contact text;
alter table public.tournament_entries add column if not exists discord_username text;
alter table public.tournament_entries add column if not exists discord_joined boolean not null default false;
alter table public.tournament_entries add column if not exists discord_verified boolean not null default false;
alter table public.tournament_entries add column if not exists status text not null default 'confirmada';
alter table public.tournament_entries add column if not exists updated_at timestamptz not null default now();
alter table public.tournament_entries drop constraint if exists tournament_entries_status_check;
alter table public.tournament_entries add constraint tournament_entries_status_check check (status in ('pendente','confirmada','cancelada'));

create or replace function public.tx__can_organize() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_admin() then return true; end if;
  begin return public.core_has_role('admin', 'organizador'); exception when undefined_function then return false; end;
end $$;

-- Convite efetivo: o do torneio ou, se vazio, o padrão global (Admin › Definições).
create or replace function public.tx__discord_invite(p_tournament text) returns text
language sql stable security definer set search_path = public as $$
  select nullif(coalesce(nullif(t.discord_invite, ''),
    (select case when data->'settings'->>'discordInvite' ~ '^https://(discord\.gg|(www\.)?discord\.com/invite)/[A-Za-z0-9-]{2,32}/?$'
      then data->'settings'->>'discordInvite' end from platform_settings where id = 1)), '')
  from tournaments t where t.id = p_tournament $$;

create or replace function public.tournament_register(p_tournament text, p_player_name text, p_game_id text, p_team text, p_contact text,
  p_discord_username text default null, p_discord_joined boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t tournaments; inv text; du text := nullif(trim(coalesce(p_discord_username, '')), '');
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
  inv := public.tx__discord_invite(p_tournament);
  if t.require_discord then
    if inv is null then return jsonb_build_object('ok', false, 'code', 'DISCORD_MISSING'); end if;
    if du is null or not coalesce(p_discord_joined, false) then return jsonb_build_object('ok', false, 'code', 'DISCORD'); end if;
  end if;
  if du is not null and du !~ '^([a-z0-9_.]{2,32}|.{2,32}#[0-9]{4})$' then return jsonb_build_object('ok', false, 'code', 'DISCORD'); end if;
  insert into tournament_entries (user_id, tournament_id, team, player_name, game_id, contact, discord_username, discord_joined, status)
    values (uid, p_tournament, nullif(trim(coalesce(p_team, '')), ''), trim(p_player_name), trim(p_game_id), trim(p_contact), du, coalesce(p_discord_joined, false), 'confirmada');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tournament_unregister(p_tournament text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tournaments;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into t from tournaments where id = p_tournament;
  if t.status <> 'aberto' then return jsonb_build_object('ok', false, 'code', 'CLOSED'); end if;
  delete from tournament_entries where user_id = auth.uid() and tournament_id = p_tournament;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.tournament_entry_admin(p_user uuid, p_tournament text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.tx__can_organize() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  update tournament_entries set
    discord_verified = case p_action when 'discord_ok' then true when 'discord_nao' then false else discord_verified end,
    status = case p_action when 'confirmar' then 'confirmada' when 'pendente' then 'pendente' when 'cancelar' then 'cancelada' else status end,
    updated_at = now()
  where user_id = p_user and tournament_id = p_tournament;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  insert into audit_log (actor_id, actor_handle, action, target)
    values (auth.uid(), (select handle from profiles where id = auth.uid()), 'torneio:inscricao_' || p_action, p_tournament || ':' || p_user::text);
  return jsonb_build_object('ok', true);
end $$;

drop policy if exists "inscricao gratis" on public.tournament_entries;
drop policy if exists "ver inscricoes" on public.tournament_entries;
drop policy if exists entries_read on public.tournament_entries;
create policy entries_read on public.tournament_entries for select using (user_id = (select auth.uid()) or (select public.tx__can_organize()));
revoke insert, update on public.tournament_entries from anon, authenticated;

-- Organizadores (AI CORE: papel "organizador") também gerem torneios, como o admin
drop policy if exists organizer_tournaments on public.tournaments;
create policy organizer_tournaments on public.tournaments for all using ((select public.tx__can_organize())) with check ((select public.tx__can_organize()));

-- 2. Marketplace -------------------------------------------------------------------------
create table if not exists public.market_products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  seller_name text not null default '',
  game_key text not null check (game_key in ('ff','cr','ef','dls','outros')),
  category text not null check (category in ('Guias','Coaching','Packs para lives','Design')),
  title text not null check (length(trim(title)) between 3 and 80),
  description text not null default '' check (length(description) <= 1000),
  price_mzn integer not null default 0 check (price_mzn >= 0 and price_mzn <= 1000000),
  whatsapp text check (whatsapp is null or whatsapp ~ '^8[4-7][0-9]{7}$'),
  photos text[] not null check (array_length(photos, 1) between 1 and 5),
  status text not null default 'ativo' check (status in ('ativo','removido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists market_products_game_idx on public.market_products (game_key, status, created_at desc);
create index if not exists market_products_seller_idx on public.market_products (seller_id);

create or replace function public.market__tg_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- fotos só do próprio vendedor no bucket media
  if exists (select 1 from unnest(new.photos) p where p !~ ('/storage/v1/object/public/media/products/' || new.seller_id::text || '/')) then
    raise exception 'PHOTOS';
  end if;
  if tg_op = 'UPDATE' and not public.is_admin() then new.status := old.status; end if;
  new.seller_name := coalesce((select display_name from profiles where id = new.seller_id), '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists market_products_guard on public.market_products;
create trigger market_products_guard before insert or update on public.market_products for each row execute function public.market__tg_guard();

alter table public.market_products enable row level security;
drop policy if exists market_read on public.market_products;
create policy market_read on public.market_products for select using (status = 'ativo' or seller_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists market_insert on public.market_products;
create policy market_insert on public.market_products for insert with check (seller_id = (select auth.uid()) and (select public.is_active_user()));
drop policy if exists market_update on public.market_products;
create policy market_update on public.market_products for update using (seller_id = (select auth.uid()) or (select public.is_admin())) with check (seller_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists market_delete on public.market_products;
create policy market_delete on public.market_products for delete using (seller_id = (select auth.uid()) or (select public.is_admin()));
grant select on public.market_products to anon, authenticated;
grant insert, update, delete on public.market_products to authenticated;

-- 3. Storage: bucket público "media" (só imagens, 5 MB) ------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/webp','image/jpeg','image/png'];

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select using (bucket_id = 'media');
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (
    (name like 'products/' || (select auth.uid())::text || '/%') or
    (name like 'tournaments/%' and (select public.tx__can_organize()))));
drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated using (
  bucket_id = 'media' and ((name like 'products/' || (select auth.uid())::text || '/%') or (select public.tx__can_organize())));

-- 4. Permissões ----------------------------------------------------------------------------
revoke all on function public.tx__discord_invite(text), public.market__tg_guard() from public, anon, authenticated;
grant execute on function public.tx__can_organize() to anon, authenticated;
revoke all on function public.tournament_register(text, text, text, text, text, text, boolean), public.tournament_unregister(text),
  public.tournament_entry_admin(uuid, text, text) from public, anon;
grant execute on function public.tournament_register(text, text, text, text, text, text, boolean), public.tournament_unregister(text),
  public.tournament_entry_admin(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
