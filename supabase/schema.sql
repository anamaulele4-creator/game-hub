-- =====================================================================
-- GAME HUB · esquema de produção para Supabase (PostgreSQL 15+)
-- Script ÚNICO e IDEMPOTENTE: colar no Supabase → SQL Editor → Run.
-- Pode ser executado várias vezes sem erros nem duplicados. Não cria utilizadores nem dados falsos.
-- Pensado para crescer: índices em todas as FKs/colunas de pesquisa, tabelas de alto volume
-- particionadas por mês, contadores agregados (sem "hot rows"), registo idempotente e RLS em tudo.
-- O email anamaulele4@gmail.com recebe role 'admin' automaticamente ao registar-se.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. Funções utilitárias de permissões
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null,
  display_name text not null default 'Jogador',
  avatar_url text,
  bio text not null default '',
  role text not null default 'user' check (role in ('user','creator','moderator','admin')),
  verified boolean not null default false,
  banned boolean not null default false,
  suspended_until timestamptz,
  deleted_at timestamptz,
  is_premium boolean not null default false,
  plan text not null default 'Grátis',
  xp integer not null default 0,
  coins integer not null default 0 check (coins >= 0),
  streak integer not null default 0,
  birth_date date,
  province text,
  interests text[] not null default '{}',
  main_game text,
  division text not null default 'Bronze',
  team text,
  email text,
  phone text,
  followers_count integer not null default 0,
  following_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_.]{3,30}$')
);
-- Unicidade (registo idempotente: o mesmo contacto/handle nunca gera duas contas)
create unique index if not exists profiles_handle_uq on public.profiles (lower(handle));
create unique index if not exists profiles_email_uq on public.profiles (lower(email)) where email is not null;
create unique index if not exists profiles_phone_uq on public.profiles (phone) where phone is not null;
create index if not exists profiles_role_idx on public.profiles (role) where role <> 'user';
create index if not exists profiles_created_idx on public.profiles (created_at desc);
create index if not exists profiles_followers_idx on public.profiles (followers_count desc) where role in ('creator','admin');

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not banned);
$$;
create or replace function public.is_mod() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','moderator') and not banned);
$$;
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not banned and deleted_at is null
                 and (suspended_until is null or suspended_until < now()));
$$;

-- ---------------------------------------------------------------------
-- 1. Partições mensais (tabelas de alto volume)
-- ---------------------------------------------------------------------
create or replace function public.ensure_monthly_partitions(p_table text, p_months_ahead int default 3)
returns void language plpgsql security definer set search_path = public as $$
declare m date; part text;
begin
  for i in 0..p_months_ahead loop
    m := (date_trunc('month', now()) + make_interval(months => i))::date;
    part := format('%s_%s', p_table, to_char(m, 'YYYYMM'));
    execute format('create table if not exists public.%I partition of public.%I for values from (%L) to (%L)',
                   part, p_table, m, (m + interval '1 month')::date);
  end loop;
  execute format('create table if not exists public.%I partition of public.%I default', p_table || '_default', p_table);
end $$;

-- ---------------------------------------------------------------------
-- 2. Preferências do utilizador
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  notif_prefs jsonb not null default '{}',
  wellbeing jsonb not null default '{}',
  push_enabled boolean not null default false,
  consent jsonb not null default '{}',
  install_dismissed boolean not null default false,
  progress jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Registo: perfil automático + admin da fundadora + idade mínima (servidor)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base text := lower(regexp_replace(coalesce(meta->>'handle', split_part(coalesce(new.email, ''), '@', 1), ''), '[^a-z0-9_.]', '', 'g'));
  h text;
  bd date;
begin
  if length(base) < 3 then base := 'jogador'; end if;
  base := left(base, 24);
  h := base;
  -- handle único: acrescenta sufixo se já existir
  while exists (select 1 from profiles where lower(handle) = h) loop
    h := left(base, 24) || '_' || substr(md5(random()::text), 1, 4);
  end loop;
  begin bd := nullif(meta->>'birth', '')::date; exception when others then bd := null; end;
  if bd is not null and bd > (current_date - interval '13 years') then
    raise exception 'GAME HUB: idade mínima de 13 anos';
  end if;
  insert into profiles (id, handle, display_name, birth_date, province, email, phone, role)
  values (new.id, h, coalesce(nullif(meta->>'name', ''), 'Jogador'), bd, meta->>'province',
          lower(new.email), new.phone,
          case when lower(new.email) = 'anamaulele4@gmail.com' then 'admin' else 'user' end)
  on conflict (id) do nothing;
  insert into user_settings (user_id, consent) values (new.id, coalesce(meta->'consent', '{}'::jsonb))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Mantém email/telemóvel do perfil sincronizados com auth.users
create or replace function public.handle_user_contact_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set email = lower(new.email), phone = new.phone, updated_at = now() where id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_user_contact on auth.users;
create trigger on_auth_user_contact after update of email, phone on auth.users for each row
  when (old.email is distinct from new.email or old.phone is distinct from new.phone)
  execute function public.handle_user_contact_change();

-- Utilizador comum não pode alterar campos sensíveis do próprio perfil
create or replace function public.tg_protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role; new.verified := old.verified; new.banned := old.banned; new.suspended_until := old.suspended_until;
    new.is_premium := old.is_premium; new.plan := old.plan; new.xp := old.xp; new.coins := old.coins; new.division := old.division;
    new.followers_count := old.followers_count; new.following_count := old.following_count; new.email := old.email; new.phone := old.phone;
    new.handle := old.handle; new.deleted_at := old.deleted_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.tg_protect_profile();

-- ---------------------------------------------------------------------
-- 4. Social
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  notify_live boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
create index if not exists follows_followed_idx on public.follows (followed_id);

create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target)
);
create index if not exists likes_target_idx on public.likes (target);

create table if not exists public.saves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  target text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target)
);
create index if not exists saves_target_idx on public.saves (target);

create table if not exists public.blocks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  blocked text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked)
);

create table if not exists public.reactions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target)
);
create index if not exists reactions_target_idx on public.reactions (target);

create table if not exists public.clips (
  id text primary key default gen_random_uuid()::text,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  game text not null,
  video_url text,
  tags text[] not null default '{}',
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  shares_count integer not null default 0,
  views_count bigint not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists clips_author_idx on public.clips (author_id, created_at desc);
create index if not exists clips_feed_idx on public.clips (created_at desc) where not hidden;
create index if not exists clips_game_idx on public.clips (game, created_at desc) where not hidden;

create table if not exists public.posts (
  id text primary key default gen_random_uuid()::text,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 2000),
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);
create index if not exists posts_feed_idx on public.posts (created_at desc) where not hidden;

create table if not exists public.comments (
  id text primary key default gen_random_uuid()::text,
  target text not null,
  parent_id text references public.comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  author_avatar text,
  body text not null check (char_length(body) between 1 and 1000),
  likes_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_target_idx on public.comments (target, created_at desc);
create index if not exists comments_author_idx on public.comments (author_id);
create index if not exists comments_parent_idx on public.comments (parent_id);
create index if not exists comments_recent_idx on public.comments (created_at desc) where not hidden;

-- Notificações: ALTO VOLUME → particionada por mês (created_at)
create table if not exists public.notifications (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('live','social','torneio','sistema','compra')),
  body text not null,
  href text,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
select public.ensure_monthly_partitions('notifications', 3);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where not read;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  p256dh text,
  auth text,
  categories text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists push_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------
-- 5. Contadores agregados (sem contenção): eventos → deltas → rollup periódico
-- ---------------------------------------------------------------------
create table if not exists public.counter_deltas (
  id bigserial primary key,
  target text not null,
  field text not null check (field in ('likes','comments','saves','followers','following')),
  delta integer not null,
  created_at timestamptz not null default now()
);
create table if not exists public.counters (
  target text primary key,
  likes bigint not null default 0,
  comments bigint not null default 0,
  saves bigint not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.tg_counter_delta() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int := case when tg_op = 'INSERT' then 1 else -1 end; r record;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if tg_table_name = 'likes' then insert into counter_deltas(target, field, delta) values (r.target, 'likes', d);
  elsif tg_table_name = 'saves' then insert into counter_deltas(target, field, delta) values (r.target, 'saves', d);
  elsif tg_table_name = 'comments' then insert into counter_deltas(target, field, delta) values (r.target, 'comments', d);
  elsif tg_table_name = 'follows' then
    insert into counter_deltas(target, field, delta) values (r.followed_id::text, 'followers', d), (r.follower_id::text, 'following', d);
  end if;
  return null;
end $$;
drop trigger if exists likes_delta on public.likes;
create trigger likes_delta after insert or delete on public.likes for each row execute function public.tg_counter_delta();
drop trigger if exists saves_delta on public.saves;
create trigger saves_delta after insert or delete on public.saves for each row execute function public.tg_counter_delta();
drop trigger if exists comments_delta on public.comments;
create trigger comments_delta after insert or delete on public.comments for each row execute function public.tg_counter_delta();
drop trigger if exists follows_delta on public.follows;
create trigger follows_delta after insert or delete on public.follows for each row execute function public.tg_counter_delta();

-- Aplica os deltas em lote (corre a cada minuto via pg_cron; pode ser chamada manualmente)
create or replace function public.rollup_counters() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with taken as (delete from counter_deltas where id in (select id from counter_deltas order by id limit 50000) returning target, field, delta),
  agg as (select target, field, sum(delta) as d from taken group by target, field),
  up_c as (
    insert into counters (target, likes, comments, saves)
    select target, coalesce(sum(d) filter (where field='likes'),0), coalesce(sum(d) filter (where field='comments'),0), coalesce(sum(d) filter (where field='saves'),0)
    from agg where field in ('likes','comments','saves') group by target
    on conflict (target) do update set likes = counters.likes + excluded.likes, comments = counters.comments + excluded.comments,
      saves = counters.saves + excluded.saves, updated_at = now()
    returning 1
  ),
  up_p as (
    update profiles p set followers_count = greatest(p.followers_count + coalesce(x.f,0),0), following_count = greatest(p.following_count + coalesce(x.g,0),0)
    from (select target, sum(d) filter (where field='followers') f, sum(d) filter (where field='following') g from agg where field in ('followers','following') group by target) x
    where p.id::text = x.target returning 1
  )
  select (select count(*) from up_c) + (select count(*) from up_p) into n;
  update clips c set likes_count = k.likes, comments_count = k.comments from counters k where k.target = c.id and k.updated_at > now() - interval '5 minutes';
  update posts c set likes_count = k.likes, comments_count = k.comments from counters k where k.target = c.id and k.updated_at > now() - interval '5 minutes';
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Lives, mensagens (particionadas), canais
-- ---------------------------------------------------------------------
create table if not exists public.lives (
  id text primary key default gen_random_uuid()::text,
  host_id uuid references public.profiles(id) on delete cascade,
  title text not null default '',
  game text not null default '',
  stream_url text,
  viewers integer not null default 0,
  status text not null default 'agendada' check (status in ('agendada','ao vivo','terminada','suspensa')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lives_host_idx on public.lives (host_id);
create index if not exists lives_status_idx on public.lives (status) where status = 'ao vivo';

create table if not exists public.live_messages (
  id bigint generated always as identity,
  live_id text not null references public.lives(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 300),
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
select public.ensure_monthly_partitions('live_messages', 3);
create index if not exists live_messages_live_idx on public.live_messages (live_id, created_at desc);

create table if not exists public.channels (
  id text primary key, name text not null, emoji text, description text, topic text, members_count integer not null default 0
);
create table if not exists public.channel_members (
  channel_id text not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists channel_members_user_idx on public.channel_members (user_id);
create table if not exists public.channel_messages (
  id bigint generated always as identity,
  channel_id text not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 1000),
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
select public.ensure_monthly_partitions('channel_messages', 3);
create index if not exists channel_messages_ch_idx on public.channel_messages (channel_id, created_at desc);

-- Eventos de analítica (visualizações, sessões…): ALTO VOLUME → particionada
create table if not exists public.analytics_events (
  id bigint generated always as identity,
  user_id uuid,
  name text not null,
  target text,
  props jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
select public.ensure_monthly_partitions('analytics_events', 3);
create index if not exists analytics_name_idx on public.analytics_events (name, created_at desc);

-- ---------------------------------------------------------------------
-- 7. Torneios, loja, eventos, planos, pagamentos
-- ---------------------------------------------------------------------
create table if not exists public.tournaments (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  game text not null,
  mode text not null default 'Squad',
  entry_fee_mzn integer not null default 0 check (entry_fee_mzn >= 0),
  prize_mzn integer not null default 0,
  slots integer not null default 32 check (slots > 0),
  entries_count integer not null default 0,
  starts_at timestamptz,
  status text not null default 'aberto' check (status in ('aberto','a decorrer','terminado')),
  organizer text not null default 'GAME HUB',
  rules text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tournaments_status_idx on public.tournaments (status, starts_at);
create index if not exists tournaments_creator_idx on public.tournaments (created_by);

create table if not exists public.tournament_entries (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tournament_id text not null references public.tournaments(id) on delete cascade,
  team text,
  created_at timestamptz not null default now(),
  primary key (user_id, tournament_id)
);
create index if not exists entries_tournament_idx on public.tournament_entries (tournament_id);
create or replace function public.tg_entry_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update tournaments set entries_count = entries_count + 1 where id = new.tournament_id;
  else update tournaments set entries_count = greatest(entries_count - 1, 0) where id = old.tournament_id; end if;
  return null;
end $$;
drop trigger if exists entry_count on public.tournament_entries;
create trigger entry_count after insert or delete on public.tournament_entries for each row execute function public.tg_entry_count();

create table if not exists public.products (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  price_mzn integer not null check (price_mzn >= 0),
  category text not null default 'Acessórios',
  seller_id uuid references public.profiles(id) on delete set null,
  seller_name text not null default 'GAME HUB',
  emoji text,
  stock integer not null default 0,
  rating numeric(2,1) not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists products_seller_idx on public.products (seller_id);
create index if not exists products_cat_idx on public.products (category) where active;

create table if not exists public.orders (
  id text primary key default gen_random_uuid()::text,
  buyer_id uuid references public.profiles(id) on delete set null,
  buyer_handle text,
  summary text not null default '',
  total_mzn integer not null,
  status text not null default 'pendente' check (status in ('pendente','enviado','entregue','cancelado','reembolsado')),
  payment_id text,
  created_at timestamptz not null default now()
);
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);

create table if not exists public.events (
  id text primary key default gen_random_uuid()::text,
  name text not null, place text not null default '', starts_at timestamptz,
  price_mzn integer not null default 0, vip_price_mzn integer not null default 0,
  emoji text, description text not null default '', tickets_left integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists events_start_idx on public.events (starts_at);

create table if not exists public.tickets (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id text not null references public.events(id) on delete cascade,
  tier text not null default 'Normal' check (tier in ('Normal','VIP')),
  qty integer not null default 1 check (qty > 0),
  payment_id text,
  created_at timestamptz not null default now()
);
create index if not exists tickets_user_idx on public.tickets (user_id);
create index if not exists tickets_event_idx on public.tickets (event_id);

create table if not exists public.plans (
  id text primary key, name text not null, price_mzn integer not null, period text not null, perks text[] not null default '{}'
);
create table if not exists public.subscriptions (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'ativa' check (status in ('ativa','cancelada','expirada')),
  renews_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, status);
create index if not exists subscriptions_plan_idx on public.subscriptions (plan_id);

-- Pagamentos: criados/atualizados APENAS pelo servidor (Edge Function payments com service role)
create table if not exists public.payments (
  id text primary key default gen_random_uuid()::text,
  user_id uuid references public.profiles(id) on delete set null,
  user_handle text,
  kind text not null default 'outro' check (kind in ('plano','torneio','bilhete','moedas','loja','ad_topup','outro')),
  item text not null,
  amount_mzn integer not null check (amount_mzn >= 0),
  method text not null,
  status text not null default 'pendente' check (status in ('pendente','em processamento','pago','falhou','reembolsado')),
  provider_ref text unique,              -- idempotência: o mesmo pagamento do agregador nunca é registado 2x
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status, created_at desc);

create table if not exists public.payouts (
  id text primary key default gen_random_uuid()::text,
  creator_id uuid references public.profiles(id) on delete set null,
  creator_handle text not null,
  amount_mzn integer not null check (amount_mzn > 0),
  method text not null,
  status text not null default 'pendente' check (status in ('pendente','aprovado','pago','rejeitado')),
  created_at timestamptz not null default now()
);
create index if not exists payouts_creator_idx on public.payouts (creator_id);
create index if not exists payouts_status_idx on public.payouts (status);

-- ---------------------------------------------------------------------
-- 8. Moderação, auditoria, configuração, políticas, broadcasts, eliminação
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id text primary key default gen_random_uuid()::text,
  reporter_id uuid references public.profiles(id) on delete set null,
  reporter_handle text,
  kind text not null,
  target text not null,
  label text,
  reason text not null,
  status text not null default 'aberta' check (status in ('aberta','removido','rejeitada')),
  created_at timestamptz not null default now()
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id);
create index if not exists reports_target_idx on public.reports (target);
create or replace function public.tg_report_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.reporter_id := coalesce(auth.uid(), new.reporter_id);
    new.reporter_handle := (select handle from profiles where id = new.reporter_id);
    if not public.is_mod() then new.status := 'aberta'; end if;
    -- limite anti-abuso: 30 denúncias / hora por utilizador
    if (select count(*) from reports where reporter_id = new.reporter_id and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'Demasiadas denúncias. Tenta mais tarde.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists report_defaults on public.reports;
create trigger report_defaults before insert on public.reports for each row execute function public.tg_report_defaults();

create table if not exists public.hidden_content (
  target text primary key,
  kind text,
  hidden_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id text primary key default gen_random_uuid()::text,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  actor_handle text,
  action text not null,
  target text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_log (created_at desc);
create index if not exists audit_actor_idx on public.audit_log (actor_id);

create table if not exists public.platform_settings (
  id integer primary key default 1 check (id = 1),
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id, data) values (1, jsonb_build_object(
  'settings', jsonb_build_object('maintenance', false, 'maintenanceMsg', 'Estamos a melhorar o GAME HUB. Voltamos já! 🛠️',
    'banner', jsonb_build_object('on', false, 'text', '', 'tone', 'info'),
    'features', jsonb_build_object('lives', true, 'torneios', true, 'loja', true, 'eventos', true, 'canais', true, 'desafios', true, 'coach', true, 'anuncios', true, 'presentes', true, 'comentarios', true),
    'signupsOpen', true),
  'planPrices', jsonb_build_object('premium', 149, 'criador', 349, 'equipas', 599, 'verificacao', 499, 'coach', 199),
  'adPricing', jsonb_build_object('minCpm', 60, 'minCpc', 3, 'minCpf', 5, 'minCpa', 25, 'minDaily', 100, 'platformFee', 0, 'reviewRequired', true, 'frequencyCap', 3)
)) on conflict (id) do nothing;

create table if not exists public.policies (
  slug text primary key, body text not null, updated_at timestamptz not null default now()
);

create table if not exists public.broadcasts (
  id text primary key default gen_random_uuid()::text,
  title text not null, body text not null, segment text not null default 'Todos', url text not null default '/',
  category text not null default 'sistema', send_at timestamptz, status text not null default 'agendada' check (status in ('agendada','enviada')),
  reach integer not null default 0, created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists broadcasts_due_idx on public.broadcasts (send_at) where status = 'agendada';

create table if not exists public.deletion_requests (
  id bigint generated always as identity primary key,
  contact text not null check (char_length(contact) between 3 and 200),
  handle text,
  reason text,
  status text not null default 'recebido' check (status in ('recebido','em curso','concluido','rejeitado')),
  created_at timestamptz not null default now()
);
create index if not exists deletion_contact_idx on public.deletion_requests (contact, created_at desc);
create or replace function public.tg_deletion_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from deletion_requests where contact = new.contact and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Já recebemos o teu pedido. Respondemos em breve.';
  end if;
  new.status := 'recebido';
  return new;
end $$;
drop trigger if exists deletion_rate on public.deletion_requests;
create trigger deletion_rate before insert on public.deletion_requests for each row execute function public.tg_deletion_rate();

-- ---------------------------------------------------------------------
-- 9. Anúncios self-serve
-- ---------------------------------------------------------------------
create table if not exists public.ad_campaigns (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  owner_handle text not null,
  name text not null,
  objective text not null check (objective in ('visualizacoes','seguidores','cliques','inscricoes')),
  status text not null default 'ativa' check (status in ('ativa','pausada','sem orçamento','sem saldo','terminada')),
  budget_type text not null default 'diario' check (budget_type in ('diario','total')),
  budget_mzn numeric(12,2) not null check (budget_mzn > 0),
  start_date date not null default current_date,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists ad_campaigns_owner_idx on public.ad_campaigns (owner_id);
create index if not exists ad_campaigns_active_idx on public.ad_campaigns (status, start_date, end_date) where status = 'ativa';

create table if not exists public.ad_sets (
  id text primary key default gen_random_uuid()::text,
  campaign_id text not null references public.ad_campaigns(id) on delete cascade,
  name text not null default 'Público',
  age_min integer not null default 13 check (age_min >= 13),
  age_max integer not null default 65 check (age_max <= 100),
  provinces text[] not null default '{}',
  games text[] not null default '{}',
  interests text[] not null default '{}',
  placements text[] not null default '{feed,clipes}',
  bid_mzn numeric(10,2) not null check (bid_mzn > 0),
  status text not null default 'ativo' check (status in ('ativo','pausado'))
);
create index if not exists ad_sets_campaign_idx on public.ad_sets (campaign_id);

create table if not exists public.ad_creatives (
  id text primary key default gen_random_uuid()::text,
  ad_set_id text not null references public.ad_sets(id) on delete cascade,
  campaign_id text not null references public.ad_campaigns(id) on delete cascade,
  name text not null default 'Anúncio',
  format text not null default 'imagem' check (format in ('imagem','clipe')),
  media_url text,
  emoji text,
  headline text not null check (char_length(headline) <= 40),
  body text not null check (char_length(body) <= 125),
  cta text not null default 'Ver mais',
  url text not null default '/',
  review text not null default 'pendente' check (review in ('pendente','aprovado','rejeitado')),
  review_note text,
  status text not null default 'ativo' check (status in ('ativo','pausado')),
  created_at timestamptz not null default now()
);
create index if not exists ad_creatives_set_idx on public.ad_creatives (ad_set_id);
create index if not exists ad_creatives_campaign_idx on public.ad_creatives (campaign_id);
create index if not exists ad_creatives_review_idx on public.ad_creatives (review) where review = 'pendente';

-- O anunciante não pode aprovar o próprio anúncio; alterar o conteúdo volta a pôr em revisão.
create or replace function public.tg_ad_review_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare need_review boolean := coalesce((select (data->'adPricing'->>'reviewRequired')::boolean from platform_settings where id = 1), true);
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.review := case when need_review then 'pendente' else 'aprovado' end; new.review_note := null;
  else
    if new.headline is distinct from old.headline or new.body is distinct from old.body or new.media_url is distinct from old.media_url or new.url is distinct from old.url then
      new.review := case when need_review then 'pendente' else 'aprovado' end;
    else
      new.review := old.review; new.review_note := old.review_note;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ad_review_guard on public.ad_creatives;
create trigger ad_review_guard before insert or update on public.ad_creatives for each row execute function public.tg_ad_review_guard();

create table if not exists public.ad_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_mzn numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- Eventos de anúncios (impressões/cliques): ALTO VOLUME → particionada
create table if not exists public.ad_events (
  id bigint generated always as identity,
  ad_id text not null,
  campaign_id text not null,
  viewer_id uuid,
  kind text not null check (kind in ('imp','click')),
  cost_mzn numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
select public.ensure_monthly_partitions('ad_events', 3);
create index if not exists ad_events_ad_idx on public.ad_events (ad_id, created_at desc);
create index if not exists ad_events_viewer_idx on public.ad_events (viewer_id, ad_id, created_at desc);

-- Contadores agregados por anúncio/dia (o que os relatórios leem)
create table if not exists public.ad_stats_daily (
  ad_id text not null,
  campaign_id text not null,
  day date not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  results bigint not null default 0,
  spend_mzn numeric(12,4) not null default 0,
  primary key (ad_id, day)
);
create index if not exists ad_stats_campaign_idx on public.ad_stats_daily (campaign_id, day);

-- Regista impressão/clique, cobra (CPM na impressão; restantes objetivos no clique), desconta saldo e pausa automaticamente.
create or replace function public.record_ad_event(p_ad text, p_kind text, p_price numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a ad_creatives; s ad_sets; c ad_campaigns; pr jsonb; floor_price numeric; price numeric; cost numeric := 0;
  cap int; seen int; today date := (now() at time zone 'Africa/Maputo')::date; spent numeric; wallet numeric;
begin
  if p_kind not in ('imp','click') then return jsonb_build_object('ok', false); end if;
  select * into a from ad_creatives where id = p_ad and review = 'aprovado' and status = 'ativo';
  if not found then return jsonb_build_object('ok', false, 'reason', 'ad'); end if;
  select * into s from ad_sets where id = a.ad_set_id and status = 'ativo';
  select * into c from ad_campaigns where id = a.campaign_id and status = 'ativa' and today between start_date and end_date;
  if s.id is null or c.id is null then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  select data->'adPricing' into pr from platform_settings where id = 1;
  cap := coalesce((pr->>'frequencyCap')::int, 3);
  if p_kind = 'imp' and auth.uid() is not null then
    select count(*) into seen from ad_events where viewer_id = auth.uid() and ad_id = p_ad and kind = 'imp' and created_at > now() - interval '1 day';
    if seen >= cap then return jsonb_build_object('ok', false, 'reason', 'cap'); end if;
  end if;
  if p_kind = 'click' and auth.uid() is not null and exists (select 1 from ad_events where viewer_id = auth.uid() and ad_id = p_ad and kind = 'click' and created_at > now() - interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'dup-click');
  end if;
  floor_price := case c.objective when 'visualizacoes' then (pr->>'minCpm')::numeric when 'cliques' then (pr->>'minCpc')::numeric
                 when 'seguidores' then (pr->>'minCpf')::numeric else (pr->>'minCpa')::numeric end;
  price := least(s.bid_mzn, greatest(coalesce(floor_price, 0), coalesce(p_price, s.bid_mzn)));
  if p_kind = 'imp' and c.objective = 'visualizacoes' then cost := price / 1000; end if;
  if p_kind = 'click' and c.objective <> 'visualizacoes' then cost := price; end if;
  insert into ad_events (ad_id, campaign_id, viewer_id, kind, cost_mzn) values (p_ad, c.id, auth.uid(), p_kind, cost);
  insert into ad_stats_daily (ad_id, campaign_id, day, impressions, clicks, results, spend_mzn)
  values (p_ad, c.id, today, (p_kind='imp')::int, (p_kind='click')::int,
          case when (c.objective='visualizacoes' and p_kind='imp') or (c.objective<>'visualizacoes' and p_kind='click') then 1 else 0 end, cost)
  on conflict (ad_id, day) do update set impressions = ad_stats_daily.impressions + excluded.impressions, clicks = ad_stats_daily.clicks + excluded.clicks,
    results = ad_stats_daily.results + excluded.results, spend_mzn = ad_stats_daily.spend_mzn + excluded.spend_mzn;
  if cost > 0 then
    insert into ad_wallets (user_id, balance_mzn) values (c.owner_id, -cost)
    on conflict (user_id) do update set balance_mzn = ad_wallets.balance_mzn - cost, updated_at = now()
    returning balance_mzn into wallet;
    if c.budget_type = 'diario' then select coalesce(sum(spend_mzn),0) into spent from ad_stats_daily where campaign_id = c.id and day = today;
    else select coalesce(sum(spend_mzn),0) into spent from ad_stats_daily where campaign_id = c.id; end if;
    if wallet <= 0 then update ad_campaigns set status = 'sem saldo' where id = c.id;
    elsif c.budget_type = 'total' and spent >= c.budget_mzn then update ad_campaigns set status = 'sem orçamento' where id = c.id; end if;
  end if;
  return jsonb_build_object('ok', true, 'cost', cost);
end $$;
grant execute on function public.record_ad_event(text, text, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. Storage: bucket público para criativos de anúncios (pasta = id do utilizador)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('ad-media', 'ad-media', true, 15728640) on conflict (id) do nothing;
drop policy if exists "ad-media leitura" on storage.objects;
create policy "ad-media leitura" on storage.objects for select using (bucket_id = 'ad-media');
drop policy if exists "ad-media upload próprio" on storage.objects;
create policy "ad-media upload próprio" on storage.objects for insert to authenticated
  with check (bucket_id = 'ad-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "ad-media apagar próprio" on storage.objects;
create policy "ad-media apagar próprio" on storage.objects for delete to authenticated
  using (bucket_id = 'ad-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 11. RLS (Row Level Security) — ativar em TODAS as tabelas
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['profiles','user_settings','follows','likes','saves','blocks','reactions','clips','posts','comments','notifications',
    'push_subscriptions','counter_deltas','counters','lives','live_messages','channels','channel_members','channel_messages','analytics_events',
    'tournaments','tournament_entries','products','orders','events','tickets','plans','subscriptions','payments','payouts','reports',
    'hidden_content','audit_log','platform_settings','policies','broadcasts','deletion_requests','ad_campaigns','ad_sets','ad_creatives',
    'ad_wallets','ad_events','ad_stats_daily'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Macro: (re)cria uma policy de forma idempotente
create or replace function public._policy(p_table text, p_name text, p_sql text) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute format('create policy %I on public.%I %s', p_name, p_table, p_sql);
end $$;

-- Perfis
select public._policy('profiles', 'perfis visiveis', 'for select using ((not banned and deleted_at is null) or id = auth.uid() or public.is_mod())');
select public._policy('profiles', 'criar proprio perfil', 'for insert with check (id = auth.uid() and role = ''user'')');
select public._policy('profiles', 'editar proprio perfil', 'for update using (id = auth.uid()) with check (id = auth.uid())');
select public._policy('profiles', 'admin gere perfis', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('user_settings', 'definicoes proprias', 'for all using (user_id = auth.uid()) with check (user_id = auth.uid())');

-- Social (próprio utilizador; leitura pública onde faz sentido)
select public._policy('follows', 'follows leitura', 'for select using (true)');
select public._policy('follows', 'seguir', 'for insert with check (follower_id = auth.uid() and public.is_active_user())');
select public._policy('follows', 'deixar de seguir', 'for delete using (follower_id = auth.uid())');
select public._policy('follows', 'notif live', 'for update using (follower_id = auth.uid())');
select public._policy('likes', 'likes proprios', 'for all using (user_id = auth.uid()) with check (user_id = auth.uid())');
select public._policy('saves', 'guardados proprios', 'for all using (user_id = auth.uid()) with check (user_id = auth.uid())');
select public._policy('blocks', 'bloqueios proprios', 'for all using (user_id = auth.uid()) with check (user_id = auth.uid())');
select public._policy('reactions', 'reacoes leitura', 'for select using (true)');
select public._policy('reactions', 'reacoes proprias', 'for all using (user_id = auth.uid()) with check (user_id = auth.uid())');
select public._policy('clips', 'ler clipes', 'for select using (not hidden or author_id = auth.uid() or public.is_mod())');
select public._policy('clips', 'publicar clipes', 'for insert with check (author_id = auth.uid() and public.is_active_user())');
select public._policy('clips', 'editar clipes', 'for update using (author_id = auth.uid() or public.is_mod())');
select public._policy('clips', 'apagar clipes', 'for delete using (author_id = auth.uid() or public.is_mod())');
select public._policy('posts', 'ler posts', 'for select using (not hidden or author_id = auth.uid() or public.is_mod())');
select public._policy('posts', 'criar posts', 'for insert with check (author_id = auth.uid() and public.is_active_user())');
select public._policy('posts', 'editar posts', 'for update using (author_id = auth.uid() or public.is_mod())');
select public._policy('posts', 'apagar posts', 'for delete using (author_id = auth.uid() or public.is_mod())');
select public._policy('comments', 'ler comentarios', 'for select using (not hidden or author_id = auth.uid() or public.is_mod())');
select public._policy('comments', 'comentar', 'for insert with check (author_id = auth.uid() and public.is_active_user())');
select public._policy('comments', 'editar comentario', 'for update using (author_id = auth.uid() or public.is_mod())');
select public._policy('comments', 'apagar comentario', 'for delete using (author_id = auth.uid() or public.is_mod())');
select public._policy('notifications', 'as minhas notificacoes', 'for all using (user_id = auth.uid()) with check (user_id = auth.uid())');
select public._policy('push_subscriptions', 'push proprio', 'for all using (user_id = auth.uid()) with check (user_id = auth.uid())');
select public._policy('counters', 'contadores leitura', 'for select using (true)');
-- counter_deltas: sem policies → só triggers/funções (security definer) escrevem.

-- Lives / canais / analítica
select public._policy('lives', 'ler lives', 'for select using (status <> ''suspensa'' or host_id = auth.uid() or public.is_mod())');
select public._policy('lives', 'criador gere live', 'for all using (host_id = auth.uid() or public.is_mod()) with check (host_id = auth.uid() or public.is_mod())');
select public._policy('live_messages', 'ler chat', 'for select using (true)');
select public._policy('live_messages', 'escrever chat', 'for insert with check (user_id = auth.uid() and public.is_active_user())');
select public._policy('channels', 'ler canais', 'for select using (true)');
select public._policy('channels', 'admin canais', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('channel_members', 'membros leitura', 'for select using (true)');
select public._policy('channel_members', 'entrar sair', 'for all using (user_id = auth.uid()) with check (user_id = auth.uid())');
select public._policy('channel_messages', 'ler canal', 'for select using (exists (select 1 from public.channel_members m where m.channel_id = channel_messages.channel_id and m.user_id = auth.uid()))');
select public._policy('channel_messages', 'escrever canal', 'for insert with check (user_id = auth.uid() and public.is_active_user() and exists (select 1 from public.channel_members m where m.channel_id = channel_messages.channel_id and m.user_id = auth.uid()))');
select public._policy('analytics_events', 'registar evento', 'for insert with check (user_id is null or user_id = auth.uid())');
select public._policy('analytics_events', 'admin analitica', 'for select using (public.is_admin())');

-- Torneios / loja / eventos / planos / pagamentos
select public._policy('tournaments', 'ler torneios', 'for select using (true)');
select public._policy('tournaments', 'admin torneios', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('tournament_entries', 'ver inscricoes', 'for select using (true)');
select public._policy('tournament_entries', 'inscricao gratis', 'for insert with check (user_id = auth.uid() and public.is_active_user() and exists (select 1 from public.tournaments t where t.id = tournament_id and t.entry_fee_mzn = 0 and t.status = ''aberto'' and t.entries_count < t.slots))');
select public._policy('tournament_entries', 'cancelar inscricao', 'for delete using (user_id = auth.uid())');
select public._policy('products', 'ler produtos', 'for select using (active or seller_id = auth.uid() or public.is_admin())');
select public._policy('products', 'vendedor gere produtos', 'for all using (seller_id = auth.uid() or public.is_admin()) with check (seller_id = auth.uid() or public.is_admin())');
select public._policy('orders', 'as minhas encomendas', 'for select using (buyer_id = auth.uid() or public.is_admin())');
select public._policy('orders', 'admin encomendas', 'for update using (public.is_admin())');
select public._policy('events', 'ler eventos', 'for select using (true)');
select public._policy('events', 'admin eventos', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('tickets', 'os meus bilhetes', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('plans', 'ler planos', 'for select using (true)');
select public._policy('plans', 'admin planos', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('subscriptions', 'as minhas assinaturas', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('subscriptions', 'cancelar assinatura', 'for update using (user_id = auth.uid()) with check (user_id = auth.uid() and status in (''ativa'',''cancelada''))');
select public._policy('payments', 'os meus pagamentos', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('payments', 'admin pagamentos', 'for update using (public.is_admin())');
select public._policy('payouts', 'os meus levantamentos', 'for select using (creator_id = auth.uid() or public.is_admin())');
select public._policy('payouts', 'admin levantamentos', 'for update using (public.is_admin())');

-- Moderação / configuração
select public._policy('reports', 'denunciar', 'for insert with check (auth.uid() is not null)');
select public._policy('reports', 'ver as minhas denuncias', 'for select using (reporter_id = auth.uid() or public.is_mod())');
select public._policy('reports', 'moderar denuncias', 'for update using (public.is_mod())');
select public._policy('hidden_content', 'ler ocultos', 'for select using (true)');
select public._policy('hidden_content', 'moderar ocultos', 'for all using (public.is_mod()) with check (public.is_mod())');
select public._policy('audit_log', 'ler auditoria', 'for select using (public.is_mod())');
select public._policy('audit_log', 'registar auditoria', 'for insert with check (public.is_mod() and actor_id = auth.uid())');
select public._policy('platform_settings', 'ler configuracao', 'for select using (true)');
select public._policy('platform_settings', 'admin configuracao', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('policies', 'ler politicas', 'for select using (true)');
select public._policy('policies', 'admin politicas', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('broadcasts', 'admin broadcasts', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('deletion_requests', 'pedir eliminacao', 'for insert to anon, authenticated with check (true)');
select public._policy('deletion_requests', 'admin eliminacoes', 'for select using (public.is_admin())');
select public._policy('deletion_requests', 'admin atualiza eliminacoes', 'for update using (public.is_admin())');

-- Anúncios
select public._policy('ad_campaigns', 'anunciante gere campanhas', 'for all using (owner_id = auth.uid() or public.is_admin()) with check ((owner_id = auth.uid() and public.is_active_user()) or public.is_admin())');
select public._policy('ad_campaigns', 'campanhas ativas visiveis', 'for select using (status = ''ativa'')');
select public._policy('ad_sets', 'anunciante gere conjuntos', 'for all using (exists (select 1 from public.ad_campaigns c where c.id = campaign_id and (c.owner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.ad_campaigns c where c.id = campaign_id and (c.owner_id = auth.uid() or public.is_admin())))');
select public._policy('ad_sets', 'conjuntos ativos visiveis', 'for select using (status = ''ativo'' and exists (select 1 from public.ad_campaigns c where c.id = campaign_id and c.status = ''ativa''))');
select public._policy('ad_creatives', 'anunciante gere anuncios', 'for all using (exists (select 1 from public.ad_campaigns c where c.id = campaign_id and (c.owner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.ad_campaigns c where c.id = campaign_id and (c.owner_id = auth.uid() or public.is_admin())))');
select public._policy('ad_creatives', 'anuncios aprovados visiveis', 'for select using (review = ''aprovado'' and status = ''ativo'')');
select public._policy('ad_wallets', 'o meu saldo', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('ad_stats_daily', 'as minhas estatisticas', 'for select using (public.is_admin() or exists (select 1 from public.ad_campaigns c where c.id = campaign_id and c.owner_id = auth.uid()))');
select public._policy('ad_events', 'admin eventos de anuncios', 'for select using (public.is_admin())');
-- ad_events/ad_stats_daily/ad_wallets: escrita só pela função record_ad_event e pela Edge Function de pagamentos.

-- ---------------------------------------------------------------------
-- 12. Dados base da plataforma (configuração, não são dados falsos)
-- ---------------------------------------------------------------------
insert into public.plans (id, name, price_mzn, period, perks) values
  ('premium','Premium',149,'mês','{Sem anúncios,XP x1.5,Aulas premium,Lives em HD}'),
  ('criador','Criador Pro',349,'mês','{Estatísticas avançadas,Monetização de lives}'),
  ('equipas','Equipas',599,'mês','{Página de equipa,Até 10 membros}'),
  ('verificacao','Verificação',499,'pagamento único','{Selo verificado,Revisão manual}'),
  ('coach','Coach IA',199,'mês','{Análise de partidas,Plano de treino}')
on conflict (id) do nothing;

-- Se a fundadora já se tinha registado antes deste script, promove-a a admin.
update public.profiles set role = 'admin' where lower(email) = 'anamaulele4@gmail.com' and role <> 'admin';
-- Perfis em falta para utilizadores criados antes do trigger (idempotente)
insert into public.profiles (id, handle, display_name, email, phone, role)
select u.id, 'user_' || substr(replace(u.id::text,'-',''),1,10), coalesce(u.raw_user_meta_data->>'name','Jogador'), lower(u.email), u.phone,
       case when lower(u.email) = 'anamaulele4@gmail.com' then 'admin' else 'user' end
from auth.users u left join public.profiles p on p.id = u.id where p.id is null
on conflict (id) do nothing;
insert into public.user_settings (user_id) select id from public.profiles on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 13. Tarefas agendadas (pg_cron) — ignoradas se a extensão não estiver disponível
-- ---------------------------------------------------------------------
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('gh_rollup_counters','gh_partitions');
  perform cron.schedule('gh_rollup_counters', '* * * * *', 'select public.rollup_counters()');
  perform cron.schedule('gh_partitions', '0 3 1 * *', $c$select public.ensure_monthly_partitions(t, 3) from unnest(array['notifications','live_messages','channel_messages','analytics_events','ad_events']) t$c$);
exception when others then
  raise notice 'pg_cron indisponível (%). Ativa em Database → Extensions e volta a correr este script.', sqlerrm;
end $$;

-- Realtime para notificações e chat (ignora se já estiverem na publicação)
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.live_messages;
exception when others then null; end $$;

-- Fim. ✅
