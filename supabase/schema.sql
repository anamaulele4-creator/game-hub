-- GAME HUB · esquema Supabase (PostgreSQL)
-- Ainda NÃO está ligado à app: a versão de teste usa localStorage.
-- Aplicar em: Supabase > SQL Editor > colar e executar.

create extension if not exists "pgcrypto";

-- =========================================================
-- Tipos
-- =========================================================
do $$ begin
  create type division as enum ('Bronze','Prata','Ouro','Platina','Diamante','Mestre','Lenda');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pendente','em_processamento','pago','falhou','reembolsado','cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('user','creator','admin');
exception when duplicate_object then null; end $$;

-- =========================================================
-- Perfis (1:1 com auth.users)
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null check (handle ~ '^[a-z0-9_\.]{3,24}$'),
  display_name text not null,
  avatar_url text,
  bio text default '',
  role user_role not null default 'user',
  verified boolean not null default false,
  banned boolean not null default false,
  is_premium boolean not null default false,
  xp integer not null default 0,
  level integer generated always as ((xp / 250) + 1) stored,
  division division not null default 'Bronze',
  coins integer not null default 0 check (coins >= 0),
  streak integer not null default 0,
  last_active_day date,
  followers_count integer not null default 0,
  following_count integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- =========================================================
-- Social
-- =========================================================
create table if not exists public.follows (
  follower_id uuid references public.profiles(id) on delete cascade,
  followed_id uuid references public.profiles(id) on delete cascade,
  notify_live boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 2000),
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  game text not null,
  video_url text not null,
  thumb_url text,
  tags text[] default '{}',
  views_count integer not null default 0,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  shares_count integer not null default 0,
  saves_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

-- target_type: 'clip' | 'post'
create table if not exists public.likes (
  user_id uuid references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('clip','post')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table if not exists public.reactions (
  user_id uuid references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('clip','post','comment')),
  target_id uuid not null,
  emoji text not null check (emoji in ('🔥','😂','🤯','👑','💜')),
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('clip','post')),
  target_id uuid not null,
  parent_id uuid references public.comments(id) on delete cascade, -- respostas
  body text not null check (char_length(body) between 1 and 1000),
  likes_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.saves (
  user_id uuid references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('clip','post','tournament','lesson','product','event')),
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  clip_id uuid references public.clips(id) on delete cascade,
  channel text not null check (channel in ('link','whatsapp','instagram','native')),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('live','social','torneio','sistema','compra')),
  body text not null,
  href text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Lives
-- =========================================================
create table if not exists public.lives (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  game text not null,
  stream_url text,
  is_live boolean not null default false,
  viewers integer not null default 0,
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists public.live_messages (
  id bigserial primary key,
  live_id uuid not null references public.lives(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 300),
  created_at timestamptz not null default now()
);

create table if not exists public.gifts (
  id text primary key,
  name text not null,
  emoji text not null,
  coins integer not null check (coins > 0)
);

create table if not exists public.live_gifts (
  id bigserial primary key,
  live_id uuid not null references public.lives(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  gift_id text not null references public.gifts(id),
  coins integer not null,
  creator_share integer generated always as ((coins * 70) / 100) stored,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Gamificação
-- =========================================================
create table if not exists public.achievements (
  id text primary key, name text not null, description text not null, emoji text not null, xp integer not null
);
create table if not exists public.user_achievements (
  user_id uuid references public.profiles(id) on delete cascade,
  achievement_id text references public.achievements(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
create table if not exists public.missions (
  id text primary key, name text not null, action text not null, goal integer not null, xp integer not null
);
create table if not exists public.user_missions (
  user_id uuid references public.profiles(id) on delete cascade,
  mission_id text references public.missions(id),
  day date not null default current_date,
  progress integer not null default 0,
  claimed boolean not null default false,
  primary key (user_id, mission_id, day)
);
create table if not exists public.xp_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  stake text not null default 'Por diversão', -- apenas XP/moedas virtuais, nunca dinheiro
  status text not null default 'enviado' check (status in ('enviado','aceite','recusado','concluido')),
  winner_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace view public.weekly_ranking as
  select user_id, sum(amount) as xp_week
  from public.xp_events
  where created_at >= date_trunc('week', now())
  group by user_id
  order by xp_week desc;

-- =========================================================
-- Bem-estar
-- =========================================================
create table if not exists public.wellbeing_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  daily_limit_min integer check (daily_limit_min between 15 and 600),
  break_every_min integer default 45,
  night_silence boolean not null default true,
  night_start time not null default '23:00',
  night_end time not null default '07:00'
);
create table if not exists public.screen_time (
  user_id uuid references public.profiles(id) on delete cascade,
  day date not null,
  seconds integer not null default 0,
  primary key (user_id, day)
);

-- =========================================================
-- Torneios, escola, canais
-- =========================================================
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  game text not null,
  mode text not null,
  entry_fee_mzn integer not null default 0 check (entry_fee_mzn >= 0),
  prize_mzn integer not null default 0,
  slots integer not null,
  entries_count integer not null default 0,
  starts_at timestamptz,
  status text not null default 'aberto' check (status in ('aberto','a_decorrer','terminado','cancelado')),
  organizer_id uuid references public.profiles(id),
  rules text[] default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.tournament_entries (
  tournament_id uuid references public.tournaments(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  team_name text not null,
  payment_id uuid,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null, level text not null, minutes integer not null, premium boolean not null default false, steps text[] not null default '{}'
);
create table if not exists public.lesson_progress (
  user_id uuid references public.profiles(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(), name text not null, topic text, description text, members_count integer not null default 0
);
create table if not exists public.channel_members (
  channel_id uuid references public.channels(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (channel_id, user_id)
);
create table if not exists public.channel_messages (
  id bigserial primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

-- =========================================================
-- Loja, eventos, planos, pagamentos
-- =========================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles(id),
  name text not null, category text not null, price_mzn integer not null check (price_mzn >= 0),
  stock integer not null default 0, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  total_mzn integer not null,
  commission_mzn integer not null default 0,
  status payment_status not null default 'pendente',
  created_at timestamptz not null default now()
);
create table if not exists public.order_items (
  order_id uuid references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  qty integer not null check (qty > 0),
  unit_price_mzn integer not null,
  primary key (order_id, product_id)
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null, place text not null, starts_at timestamptz not null,
  price_mzn integer not null default 0, vip_price_mzn integer not null default 0, capacity integer not null, sold integer not null default 0
);
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  user_id uuid not null references public.profiles(id),
  tier text not null check (tier in ('Normal','VIP')),
  qty integer not null default 1,
  code text unique not null default encode(gen_random_bytes(6), 'hex'),
  payment_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.plans (
  id text primary key, name text not null, price_mzn integer not null, period text not null, perks text[] not null default '{}'
);
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'ativa' check (status in ('ativa','cancelada','expirada')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  purpose text not null check (purpose in ('plano','torneio','loja','bilhete','moedas')),
  reference_id uuid,
  amount_mzn integer not null check (amount_mzn > 0),
  method text not null check (method in ('mpesa','emola','cartao')),
  msisdn text,
  provider_ref text,
  status payment_status not null default 'pendente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.commissions (
  area text primary key, platform_pct numeric(5,2) not null
);
create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  brand text not null, placement text not null, value_mzn integer not null,
  status text not null default 'ativo' check (status in ('ativo','pausado','em_negociacao','terminado')),
  starts_at date, ends_at date
);

-- =========================================================
-- Triggers de contadores
-- =========================================================
create or replace function public.tg_follow_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update profiles set followers_count = followers_count + 1 where id = new.followed_id;
    update profiles set following_count = following_count + 1 where id = new.follower_id;
  elsif tg_op = 'DELETE' then
    update profiles set followers_count = greatest(followers_count - 1, 0) where id = old.followed_id;
    update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
  end if;
  return null;
end $$;
drop trigger if exists follow_counts on public.follows;
create trigger follow_counts after insert or delete on public.follows for each row execute function public.tg_follow_counts();

create or replace function public.tg_like_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare d integer := case when tg_op = 'INSERT' then 1 else -1 end;
        r record;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if r.target_type = 'clip' then
    update clips set likes_count = greatest(likes_count + d, 0) where id = r.target_id;
  elsif r.target_type = 'post' then
    update posts set likes_count = greatest(likes_count + d, 0) where id = r.target_id;
  end if;
  return null;
end $$;
drop trigger if exists like_counts on public.likes;
create trigger like_counts after insert or delete on public.likes for each row execute function public.tg_like_counts();

create or replace function public.tg_comment_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare d integer := case when tg_op = 'INSERT' then 1 else -1 end;
        r record;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if r.target_type = 'clip' then
    update clips set comments_count = greatest(comments_count + d, 0) where id = r.target_id;
  else
    update posts set comments_count = greatest(comments_count + d, 0) where id = r.target_id;
  end if;
  return null;
end $$;
drop trigger if exists comment_counts on public.comments;
create trigger comment_counts after insert or delete on public.comments for each row execute function public.tg_comment_counts();

create or replace function public.tg_share_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update clips set shares_count = shares_count + 1 where id = new.clip_id;
  return null;
end $$;
drop trigger if exists share_counts on public.shares;
create trigger share_counts after insert on public.shares for each row execute function public.tg_share_counts();

create or replace function public.tg_save_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare d integer := case when tg_op = 'INSERT' then 1 else -1 end;
        r record;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if r.item_type = 'clip' then
    update clips set saves_count = greatest(saves_count + d, 0) where id = r.item_id;
  end if;
  return null;
end $$;
drop trigger if exists save_counts on public.saves;
create trigger save_counts after insert or delete on public.saves for each row execute function public.tg_save_counts();

create or replace function public.tg_entry_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update tournaments set entries_count = entries_count + 1 where id = new.tournament_id;
  else
    update tournaments set entries_count = greatest(entries_count - 1, 0) where id = old.tournament_id;
  end if;
  return null;
end $$;
drop trigger if exists entry_counts on public.tournament_entries;
create trigger entry_counts after insert or delete on public.tournament_entries for each row execute function public.tg_entry_counts();

create or replace function public.tg_channel_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update channels set members_count = members_count + 1 where id = new.channel_id;
  else
    update channels set members_count = greatest(members_count - 1, 0) where id = old.channel_id;
  end if;
  return null;
end $$;
drop trigger if exists channel_members_count on public.channel_members;
create trigger channel_members_count after insert or delete on public.channel_members for each row execute function public.tg_channel_members();

-- XP: soma no perfil e recalcula a divisão
create or replace function public.tg_xp_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare total integer;
begin
  update profiles set xp = xp + new.amount where id = new.user_id returning xp into total;
  update profiles set division = case
      when total >= 12000 then 'Lenda' when total >= 8000 then 'Mestre' when total >= 5000 then 'Diamante'
      when total >= 3000 then 'Platina' when total >= 1500 then 'Ouro' when total >= 500 then 'Prata' else 'Bronze' end::division
    where id = new.user_id;
  return null;
end $$;
drop trigger if exists xp_apply on public.xp_events;
create trigger xp_apply after insert on public.xp_events for each row execute function public.tg_xp_apply();

-- Impede que um utilizador comum altere campos sensíveis do próprio perfil
create or replace function public.tg_protect_profile() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  -- current_user = 'authenticated' só em updates diretos do cliente; os triggers de contadores (security definer) passam
  if current_user = 'authenticated' and not is_admin() then
    new.role := old.role; new.verified := old.verified; new.banned := old.banned;
    new.is_premium := old.is_premium; new.xp := old.xp; new.coins := old.coins; new.division := old.division;
    new.followers_count := old.followers_count; new.following_count := old.following_count; new.streak := old.streak;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.tg_protect_profile();

-- Criar perfil automaticamente no registo
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, handle, display_name)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 8), coalesce(new.raw_user_meta_data->>'name', 'Jogador'));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- =========================================================
-- RLS (Row Level Security)
-- =========================================================
alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.clips enable row level security;
alter table public.likes enable row level security;
alter table public.reactions enable row level security;
alter table public.comments enable row level security;
alter table public.saves enable row level security;
alter table public.shares enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.lives enable row level security;
alter table public.live_messages enable row level security;
alter table public.gifts enable row level security;
alter table public.live_gifts enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.missions enable row level security;
alter table public.user_missions enable row level security;
alter table public.xp_events enable row level security;
alter table public.challenges enable row level security;
alter table public.wellbeing_settings enable row level security;
alter table public.screen_time enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.channel_messages enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.events enable row level security;
alter table public.tickets enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.commissions enable row level security;
alter table public.ads enable row level security;

-- Leitura pública de catálogo
create policy "perfis visíveis" on public.profiles for select using (not banned or is_admin() or id = auth.uid());
create policy "editar o próprio perfil" on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid());
create policy "admin gere perfis" on public.profiles for all using (is_admin()) with check (is_admin());

create policy "ler posts" on public.posts for select using (not hidden or author_id = auth.uid() or is_admin());
create policy "criar posts" on public.posts for insert with check (author_id = auth.uid());
create policy "editar/apagar os meus posts" on public.posts for update using (author_id = auth.uid() or is_admin());
create policy "apagar os meus posts" on public.posts for delete using (author_id = auth.uid() or is_admin());

create policy "ler clipes" on public.clips for select using (not hidden or author_id = auth.uid() or is_admin());
create policy "publicar clipes" on public.clips for insert with check (author_id = auth.uid());
create policy "editar clipes" on public.clips for update using (author_id = auth.uid() or is_admin());
create policy "apagar clipes" on public.clips for delete using (author_id = auth.uid() or is_admin());

-- Ações do próprio utilizador (likes, reações, guardados, seguir, partilhas)
create policy "likes leitura" on public.likes for select using (true);
create policy "likes próprios" on public.likes for insert with check (user_id = auth.uid());
create policy "remover like" on public.likes for delete using (user_id = auth.uid());

create policy "reações leitura" on public.reactions for select using (true);
create policy "reações próprias" on public.reactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "guardados só meus" on public.saves for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "follows leitura" on public.follows for select using (true);
create policy "seguir" on public.follows for insert with check (follower_id = auth.uid());
create policy "deixar de seguir" on public.follows for delete using (follower_id = auth.uid());
create policy "notif live" on public.follows for update using (follower_id = auth.uid());

create policy "registar partilha" on public.shares for insert with check (user_id = auth.uid());
create policy "admin vê partilhas" on public.shares for select using (is_admin());

create policy "ler comentários" on public.comments for select using (not hidden or author_id = auth.uid() or is_admin());
create policy "comentar" on public.comments for insert with check (author_id = auth.uid());
create policy "apagar comentário" on public.comments for delete using (author_id = auth.uid() or is_admin());
create policy "moderar comentário" on public.comments for update using (is_admin());

create policy "as minhas notificações" on public.notifications for select using (user_id = auth.uid());
create policy "marcar como lida" on public.notifications for update using (user_id = auth.uid());
create policy "apagar notificação" on public.notifications for delete using (user_id = auth.uid());

create policy "denunciar" on public.reports for insert with check (reporter_id = auth.uid());
create policy "admin denúncias" on public.reports for all using (is_admin());

-- Lives
create policy "ler lives" on public.lives for select using (true);
create policy "criador gere a live" on public.lives for all using (host_id = auth.uid() or is_admin()) with check (host_id = auth.uid() or is_admin());
create policy "ler chat" on public.live_messages for select using (true);
create policy "escrever no chat" on public.live_messages for insert with check (user_id = auth.uid() and not exists (select 1 from profiles where id = auth.uid() and banned));
create policy "ler presentes" on public.gifts for select using (true);
create policy "admin presentes" on public.gifts for all using (is_admin());
create policy "ver presentes da live" on public.live_gifts for select using (true);
-- envio de presentes só via função de servidor (desconta moedas): sem policy de insert para clientes.

-- Gamificação
create policy "ler conquistas" on public.achievements for select using (true);
create policy "ler missões" on public.missions for select using (true);
create policy "as minhas conquistas" on public.user_achievements for select using (true);
create policy "as minhas missões" on public.user_missions for select using (user_id = auth.uid());
create policy "o meu xp" on public.xp_events for select using (user_id = auth.uid() or is_admin());
-- user_achievements, user_missions e xp_events são escritos apenas por funções de servidor (service role).
create policy "desafios meus" on public.challenges for select using (from_id = auth.uid() or to_id = auth.uid());
create policy "criar desafio" on public.challenges for insert with check (from_id = auth.uid());
create policy "responder desafio" on public.challenges for update using (to_id = auth.uid() or from_id = auth.uid());

-- Bem-estar (privado)
create policy "bem-estar próprio" on public.wellbeing_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tempo de ecrã próprio" on public.screen_time for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Torneios / escola / canais
create policy "ler torneios" on public.tournaments for select using (true);
create policy "admin torneios" on public.tournaments for all using (is_admin()) with check (is_admin());
create policy "ver inscrições" on public.tournament_entries for select using (true);
create policy "inscrição grátis" on public.tournament_entries for insert with check (
  user_id = auth.uid() and exists (select 1 from tournaments t where t.id = tournament_id and t.entry_fee_mzn = 0 and t.status = 'aberto' and t.entries_count < t.slots)
);
create policy "cancelar inscrição" on public.tournament_entries for delete using (user_id = auth.uid());
create policy "ler aulas" on public.lessons for select using (true);
create policy "admin aulas" on public.lessons for all using (is_admin());
create policy "progresso próprio" on public.lesson_progress for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ler canais" on public.channels for select using (true);
create policy "admin canais" on public.channels for all using (is_admin());
create policy "membros" on public.channel_members for select using (true);
create policy "entrar/sair" on public.channel_members for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ler mensagens do canal" on public.channel_messages for select using (exists (select 1 from channel_members m where m.channel_id = channel_messages.channel_id and m.user_id = auth.uid()));
create policy "escrever no canal" on public.channel_messages for insert with check (user_id = auth.uid() and exists (select 1 from channel_members m where m.channel_id = channel_messages.channel_id and m.user_id = auth.uid()));

-- Loja / eventos / planos / pagamentos
create policy "ler produtos" on public.products for select using (active or seller_id = auth.uid() or is_admin());
create policy "vendedor gere produtos" on public.products for all using (seller_id = auth.uid() or is_admin()) with check (seller_id = auth.uid() or is_admin());
create policy "as minhas encomendas" on public.orders for select using (buyer_id = auth.uid() or is_admin());
create policy "itens das minhas encomendas" on public.order_items for select using (exists (select 1 from orders o where o.id = order_id and (o.buyer_id = auth.uid() or is_admin())));
create policy "ler eventos" on public.events for select using (true);
create policy "admin eventos" on public.events for all using (is_admin());
create policy "os meus bilhetes" on public.tickets for select using (user_id = auth.uid() or is_admin());
create policy "ler planos" on public.plans for select using (true);
create policy "admin planos" on public.plans for all using (is_admin());
create policy "as minhas assinaturas" on public.subscriptions for select using (user_id = auth.uid() or is_admin());
create policy "cancelar assinatura" on public.subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "os meus pagamentos" on public.payments for select using (user_id = auth.uid() or is_admin());
create policy "admin pagamentos" on public.payments for update using (is_admin());
-- pagamentos, encomendas e bilhetes são criados apenas pela edge function "payments" (service role).
create policy "ler comissões" on public.commissions for select using (true);
create policy "admin comissões" on public.commissions for all using (is_admin());
create policy "admin anúncios" on public.ads for all using (is_admin());

-- =========================================================
-- Dados base
-- =========================================================
insert into public.gifts (id, name, emoji, coins) values
  ('g1','Coração','💜',1),('g2','Fogo','🔥',5),('g3','Coroa','👑',20),('g4','Foguetão','🚀',50),('g5','Diamante','💎',100)
on conflict do nothing;

insert into public.plans (id, name, price_mzn, period, perks) values
  ('premium','Premium',149,'mês','{Sem anúncios,XP x1.5,Aulas premium}'),
  ('criador','Criador Pro',349,'mês','{Estatísticas,Monetização de lives}'),
  ('equipas','Equipas',599,'mês','{Página de equipa,Até 10 membros}'),
  ('verificacao','Verificação',499,'único','{Selo verificado}'),
  ('coach','Coach IA',199,'mês','{Análise de partidas,Plano de treino}')
on conflict do nothing;

insert into public.commissions (area, platform_pct) values
  ('marketplace',10),('presentes',30),('torneios_pagos',15),('bilhetes',8),('coaching',20)
on conflict do nothing;

insert into public.missions (id, name, action, goal, xp) values
  ('m1','Vê 5 clipes','watch',5,40),('m2','Dá 5 likes','like',5,30),('m3','Comenta 2 vezes','comment',2,40),
  ('m4','Partilha 1 clipe','share',1,30),('m5','Segue 1 ídolo novo','follow',1,30)
on conflict do nothing;

insert into public.achievements (id, name, description, emoji, xp) values
  ('a1','Primeiro Passo','Entra no GAME HUB','👣',50),('a2','Fã Número 1','Segue o teu primeiro ídolo','💜',50),
  ('a3','Coração Quente','Dá 10 likes','❤️',100),('a4','Voz da Comunidade','Escreve 5 comentários','💬',100),
  ('a5','Espalha a Palavra','Partilha 3 clipes','📤',100),('a6','Colecionador','Guarda 5 itens','🔖',80),
  ('a7','Em Chamas','Sequência de 3 dias','🔥',150),('a8','Semana Perfeita','Sequência de 7 dias','📅',300),
  ('a9','Competidor','Inscreve-te num torneio','🏆',150),('a10','Desafiante','Envia um desafio','⚔️',100),
  ('a11','Estudante','Conclui 3 aulas','🎓',200),('a12','Equilíbrio','Define um limite diário','🧘',120),
  ('a13','Missão Cumprida','Completa as 5 missões diárias','✅',250)
on conflict do nothing;
