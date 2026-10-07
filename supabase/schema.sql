-- =====================================================================
-- Social POIPAK · esquema de produção para Supabase (PostgreSQL 15+)
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
    raise exception 'Social POIPAK: idade mínima de 13 anos';
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
  -- funções de servidor confiáveis (ex.: send_gift) marcam a transação com gamehub.trusted = 1
  if auth.uid() is not null and not public.is_admin() and coalesce(current_setting('gamehub.trusted', true), '') <> '1' then
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
  organizer text not null default 'Social POIPAK',
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
  seller_name text not null default 'Social POIPAK',
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
  'settings', jsonb_build_object('maintenance', false, 'maintenanceMsg', 'Estamos a melhorar o Social POIPAK. Voltamos já! 🛠️',
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
  perform cron.schedule('gh_partitions', '0 3 1 * *', $c$select public.ensure_monthly_partitions(t, 3) from unnest(array['notifications','live_messages','channel_messages','analytics_events','ad_events','login_events']) t$c$);
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

-- ---------------------------------------------------------------------
-- 14. Mensagens diretas (1:1) — conversas, membros, mensagens
--     Só membros leem/escrevem; pedidos de mensagem de quem o destinatário não segue;
--     bloqueios respeitados; moderadores só veem mensagens denunciadas.
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id text primary key default gen_random_uuid()::text,
  kind text not null default 'direta' check (kind in ('direta')),
  pair_key text unique,                         -- "uuidA:uuidB" ordenado → 1 conversa por par (idempotente)
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  last_sender_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists conversations_last_idx on public.conversations (last_message_at desc);

create table if not exists public.conversation_members (
  conversation_id text not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'aceite' check (status in ('aceite','pedido','recusado')),
  last_read_at timestamptz not null default 'epoch',
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conv_members_user_idx on public.conversation_members (user_id, status);

create table if not exists public.messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null default '' check (char_length(body) <= 2000),
  image_path text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or image_path is not null)
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);

create or replace function public.is_member(p_conv text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = p_conv and user_id = auth.uid() and status <> 'recusado');
$$;

-- Inicia (ou reabre) a conversa 1:1 com outro utilizador. Devolve o id da conversa.
create or replace function public.start_dm(p_other uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text; cid text; follows_me boolean;
begin
  if me is null then raise exception 'Entra na tua conta para enviar mensagens.'; end if;
  if p_other = me then raise exception 'Não podes enviar mensagens a ti próprio.'; end if;
  if not public.is_active_user() then raise exception 'A tua conta está restringida.'; end if;
  if not exists (select 1 from profiles where id = p_other and not banned and deleted_at is null) then raise exception 'Utilizador indisponível.'; end if;
  if exists (select 1 from blocks where (user_id = p_other and blocked = me::text) or (user_id = me and blocked = p_other::text)) then
    raise exception 'Não é possível enviar mensagens a este utilizador.';
  end if;
  k := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  select id into cid from conversations where pair_key = k;
  if cid is null then
    insert into conversations (pair_key, created_by) values (k, me) on conflict (pair_key) do nothing returning id into cid;
    if cid is null then select id into cid from conversations where pair_key = k; end if;
    select exists (select 1 from follows where follower_id = p_other and followed_id = me) into follows_me;
    insert into conversation_members (conversation_id, user_id, status) values (cid, me, 'aceite') on conflict do nothing;
    insert into conversation_members (conversation_id, user_id, status) values (cid, p_other, case when follows_me then 'aceite' else 'pedido' end) on conflict do nothing;
  else
    update conversation_members set status = 'aceite' where conversation_id = cid and user_id = me and status = 'recusado';
  end if;
  return cid;
end $$;
grant execute on function public.start_dm(uuid) to authenticated;

-- Valida cada mensagem: membro aceite, sem bloqueio, limite anti-spam (30/min); atualiza a conversa e notifica.
create or replace function public.tg_message_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare other uuid; st text;
begin
  new.sender_id := auth.uid();
  select status into st from conversation_members where conversation_id = new.conversation_id and user_id = new.sender_id;
  if st is null or st = 'recusado' then raise exception 'Não fazes parte desta conversa.'; end if;
  if st = 'pedido' then update conversation_members set status = 'aceite' where conversation_id = new.conversation_id and user_id = new.sender_id; end if;
  select user_id into other from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id limit 1;
  if exists (select 1 from blocks where (user_id = other and blocked = new.sender_id::text) or (user_id = new.sender_id and blocked = other::text)) then
    raise exception 'Não é possível enviar mensagens a este utilizador.';
  end if;
  if (select count(*) from messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Estás a enviar mensagens demasiado depressa. Aguarda um pouco.';
  end if;
  new.hidden := false;
  return new;
end $$;
drop trigger if exists message_guard on public.messages;
create trigger message_guard before insert on public.messages for each row execute function public.tg_message_guard();

create or replace function public.tg_message_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; sender_name text;
begin
  update conversations set last_message_at = new.created_at, last_sender_id = new.sender_id,
    last_message_preview = case when new.image_path is not null and new.body = '' then '📷 Imagem' else left(new.body, 80) end
  where id = new.conversation_id;
  update conversation_members set last_read_at = new.created_at where conversation_id = new.conversation_id and user_id = new.sender_id;
  select display_name into sender_name from profiles where id = new.sender_id;
  for r in select user_id, status, muted from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id loop
    if r.status = 'aceite' and not r.muted then
      insert into notifications (user_id, type, body, href) values (r.user_id, 'social', '💬 ' || coalesce(sender_name, 'Alguém') || ': ' || left(coalesce(nullif(new.body, ''), '📷 Imagem'), 60), '/mensagens/chat/?c=' || new.conversation_id);
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists message_after on public.messages;
create trigger message_after after insert on public.messages for each row execute function public.tg_message_after();

-- Membros só podem alterar a própria linha (lido, silenciar, aceitar/recusar pedido)
create or replace function public.tg_member_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if new.user_id <> auth.uid() then raise exception 'Sem permissão.'; end if;
  new.conversation_id := old.conversation_id; new.user_id := old.user_id; new.joined_at := old.joined_at;
  return new;
end $$;
drop trigger if exists member_guard on public.conversation_members;
create trigger member_guard before update on public.conversation_members for each row execute function public.tg_member_guard();

-- Total de mensagens não lidas (para o badge)
create or replace function public.dm_unread_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from messages m join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.sender_id <> auth.uid() and not m.hidden and m.created_at > cm.last_read_at and cm.status = 'aceite';
$$;
grant execute on function public.dm_unread_count() to authenticated;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
select public._policy('conversations', 'conversas dos membros', 'for select using (public.is_member(id) or public.is_admin())');
select public._policy('conversation_members', 'membros da conversa', 'for select using (public.is_member(conversation_id) or public.is_admin())');
select public._policy('conversation_members', 'atualizar a minha participacao', 'for update using (user_id = auth.uid() or public.is_admin())');
select public._policy('messages', 'ler mensagens da conversa', 'for select using (public.is_member(conversation_id) or (public.is_mod() and exists (select 1 from public.reports r where r.target = messages.id and r.kind = ''mensagem'')))');
select public._policy('messages', 'enviar mensagem', 'for insert with check (public.is_member(conversation_id))');
select public._policy('messages', 'moderar mensagem', 'for update using (public.is_mod() or sender_id = auth.uid())');
select public._policy('messages', 'apagar a minha mensagem', 'for delete using (sender_id = auth.uid() or public.is_admin())');
-- conversations/conversation_members: criação só pela função start_dm (security definer).

-- Imagens nas mensagens: bucket PRIVADO, pasta = id da conversa; só membros leem/escrevem (URLs assinadas).
insert into storage.buckets (id, name, public, file_size_limit) values ('dm-media', 'dm-media', false, 5242880) on conflict (id) do nothing;
drop policy if exists "dm-media membros leem" on storage.objects;
create policy "dm-media membros leem" on storage.objects for select to authenticated
  using (bucket_id = 'dm-media' and public.is_member((storage.foldername(name))[1]));
drop policy if exists "dm-media membros enviam" on storage.objects;
create policy "dm-media membros enviam" on storage.objects for insert to authenticated
  with check (bucket_id = 'dm-media' and public.is_member((storage.foldername(name))[1]));

-- Realtime (novas mensagens, recibos de leitura)
do $$ begin alter publication supabase_realtime add table public.messages; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.conversation_members; exception when others then null; end $$;

-- ---------------------------------------------------------------------
-- 15. Segurança de pagamentos e carteira (estilo exchange)
--     PIN de transação (bcrypt), 2FA (Supabase MFA TOTP) + fallback por código, código anti-phishing,
--     lista branca de números M-Pesa/e-Mola com bloqueio de 24 h, limites por nível KYC,
--     dispositivos/sessões, histórico de logins, congelar conta, regras de risco e fila de fraude.
-- ---------------------------------------------------------------------
create table if not exists public.security_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text,
  pin_set_at timestamptz,
  pin_failed integer not null default 0,
  pin_locked_until timestamptz,
  anti_phishing_code text check (anti_phishing_code is null or char_length(anti_phishing_code) between 4 and 20),
  withdrawals_locked_until timestamptz,
  frozen boolean not null default false,
  frozen_at timestamptz,
  kyc_level integer not null default 0 check (kyc_level between 0 and 3),
  code_fallback boolean not null default true,
  new_device_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);
-- O hash do PIN nunca sai da base de dados: o cliente só pode ler as restantes colunas.
revoke all on public.security_settings from anon, authenticated;
grant select (user_id, pin_set_at, pin_failed, pin_locked_until, anti_phishing_code, withdrawals_locked_until, frozen, frozen_at, kyc_level, code_fallback, new_device_alerts, updated_at)
  on public.security_settings to authenticated;
grant update (code_fallback, new_device_alerts) on public.security_settings to authenticated;

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  event text not null,
  detail text not null default '',
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists security_events_user_idx on public.security_events (user_id, created_at desc);

create table if not exists public.known_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  label text not null default 'Dispositivo',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_ip text,
  primary key (user_id, device_id)
);

-- Histórico de logins: ALTO VOLUME → particionado
create table if not exists public.login_events (
  id bigint generated always as identity,
  user_id uuid not null,
  device_id text,
  device_label text,
  ip text,
  user_agent text,
  new_device boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
select public.ensure_monthly_partitions('login_events', 3);
create index if not exists login_events_user_idx on public.login_events (user_id, created_at desc);

create table if not exists public.withdrawal_whitelist (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  method text not null check (method in ('M-Pesa','e-Mola')),
  msisdn text not null,
  label text not null default '',
  active_after timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  unique (user_id, msisdn)
);
create index if not exists whitelist_user_idx on public.withdrawal_whitelist (user_id);

create table if not exists public.kyc_limits (
  level integer primary key check (level between 0 and 3),
  label text not null,
  daily_withdraw_mzn integer not null,
  daily_purchase_mzn integer not null
);
insert into public.kyc_limits (level, label, daily_withdraw_mzn, daily_purchase_mzn) values
  (0, 'Sem verificação', 0, 2000), (1, 'Telemóvel verificado', 5000, 10000),
  (2, 'Documento de identidade', 50000, 100000), (3, 'Selfie com documento', 250000, 500000)
on conflict (level) do nothing;

create table if not exists public.kyc_submissions (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  level integer not null check (level between 1 and 3),
  kind text not null check (kind in ('telefone','documento','selfie')),
  doc_path text,
  status text not null default 'pendente' check (status in ('pendente','aprovado','rejeitado')),
  note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists kyc_user_idx on public.kyc_submissions (user_id);
create index if not exists kyc_status_idx on public.kyc_submissions (status, created_at) where status = 'pendente';

create table if not exists public.tx_authorizations (
  token text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('pagamento','levantamento')),
  amount_mzn integer not null,
  expires_at timestamptz not null default now() + interval '5 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tx_auth_user_idx on public.tx_authorizations (user_id, created_at desc);

create table if not exists public.risk_flags (
  id text primary key default gen_random_uuid()::text,
  user_id uuid references public.profiles(id) on delete cascade,
  user_handle text,
  kind text not null check (kind in ('pagamento','levantamento','login','conta')),
  ref_id text,
  rules text[] not null default '{}',
  score integer not null default 0,
  amount_mzn integer,
  status text not null default 'aberto' check (status in ('aberto','aprovado','bloqueado')),
  note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists risk_status_idx on public.risk_flags (status, created_at desc);
create index if not exists risk_user_idx on public.risk_flags (user_id);

alter table public.payouts add column if not exists whitelist_id text references public.withdrawal_whitelist(id) on delete set null;
alter table public.payouts add column if not exists idempotency_key text;
alter table public.payouts add column if not exists risk_score integer not null default 0;
create unique index if not exists payouts_idem_uq on public.payouts (creator_id, idempotency_key) where idempotency_key is not null;
alter table public.payouts drop constraint if exists payouts_status_check;
alter table public.payouts add constraint payouts_status_check check (status in ('pendente','em revisão','aprovado','pago','rejeitado','cancelado'));

-- Helpers
create or replace function public.req_ip() returns text language sql stable as $$
  select coalesce(nullif(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1), ''),
                  current_setting('request.headers', true)::json->>'cf-connecting-ip');
$$;
create or replace function public.req_ua() returns text language sql stable as $$
  select left(current_setting('request.headers', true)::json->>'user-agent', 300);
$$;
create or replace function public.sec_log(p_user uuid, p_event text, p_detail text default '') returns void
language sql security definer set search_path = public as $$
  insert into security_events (user_id, event, detail, ip, user_agent) values (p_user, p_event, coalesce(p_detail, ''), public.req_ip(), public.req_ua());
$$;
create or replace function public.ensure_security_row() returns void language sql security definer set search_path = public as $$
  insert into security_settings (user_id) values (auth.uid()) on conflict (user_id) do nothing;
$$;
-- Step-up: 2FA (aal2) OU código por email/SMS verificado nos últimos 10 minutos (claim amr do JWT)
create or replace function public.recent_strong_auth() returns boolean language sql stable as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or exists (select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
                 where a->>'method' in ('otp','totp','magiclink','recovery') and (a->>'timestamp')::bigint > extract(epoch from now() - interval '10 minutes'));
$$;
create or replace function public.has_totp() returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified');
$$;

-- PIN de transação
create or replace function public.set_transaction_pin(p_pin text, p_old text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r security_settings;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  if p_pin !~ '^\d{6}$' then raise exception 'O PIN tem de ter 6 dígitos.'; end if;
  if p_pin in ('000000','111111','222222','333333','444444','555555','666666','777777','888888','999999','123456','654321','121212','112233')
    then raise exception 'PIN demasiado fácil. Escolhe outro.'; end if;
  perform public.ensure_security_row();
  select * into r from security_settings where user_id = auth.uid() for update;
  if r.pin_hash is not null then
    if p_old is null or crypt(p_old, r.pin_hash) <> r.pin_hash then raise exception 'PIN atual incorreto.'; end if;
    if not public.recent_strong_auth() then raise exception 'Confirma a tua identidade (2FA ou código) para alterar o PIN.'; end if;
    update security_settings set withdrawals_locked_until = now() + interval '24 hours' where user_id = auth.uid();
  end if;
  update security_settings set pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_set_at = now(), pin_failed = 0, pin_locked_until = null, updated_at = now()
  where user_id = auth.uid();
  perform public.sec_log(auth.uid(), case when r.pin_hash is null then 'PIN criado' else 'PIN alterado (levantamentos bloqueados 24 h)' end);
end $$;

-- Verifica o PIN (5 tentativas → bloqueio 30 min) e emite uma autorização de uso único (5 min) para o servidor de pagamentos
create or replace function public.issue_tx_token(p_pin text, p_purpose text, p_amount integer) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r security_settings; t text; lim kyc_limits; spent integer;
begin
  if auth.uid() is null then raise exception 'Entra na tua conta.'; end if;
  perform public.ensure_security_row();
  select * into r from security_settings where user_id = auth.uid() for update;
  if r.frozen then raise exception 'A conta está congelada. Contacta o suporte para a reativar.'; end if;
  if r.pin_hash is null then raise exception 'Cria primeiro o teu PIN de transação em Segurança.'; end if;
  if r.pin_locked_until is not null and r.pin_locked_until > now() then raise exception 'PIN bloqueado por tentativas falhadas. Tenta depois das %.', to_char(r.pin_locked_until at time zone 'Africa/Maputo', 'HH24:MI'); end if;
  if crypt(p_pin, r.pin_hash) <> r.pin_hash then
    update security_settings set pin_failed = pin_failed + 1,
      pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '30 minutes' else null end where user_id = auth.uid();
    perform public.sec_log(auth.uid(), 'PIN incorreto', p_purpose);
    if r.pin_failed + 1 >= 5 then
      insert into risk_flags (user_id, user_handle, kind, rules, score) select auth.uid(), handle, 'conta', '{pin_brute_force}', 60 from profiles where id = auth.uid();
    end if;
    -- devolve erro (sem exceção) para que a contagem de tentativas fique gravada
    return 'ERR:PIN incorreto (' || (r.pin_failed + 1) || ' de 5 tentativas).';
  end if;
  if public.has_totp() and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then raise exception 'Confirma com o código da app autenticadora (2FA).'; end if;
  if p_purpose = 'pagamento' then
    select * into lim from kyc_limits where level = r.kyc_level;
    select coalesce(sum(amount_mzn), 0) into spent from tx_authorizations where user_id = auth.uid() and purpose = 'pagamento' and used_at is not null and created_at > now() - interval '1 day';
    if spent + p_amount > lim.daily_purchase_mzn then raise exception 'Limite diário de compras do teu nível (% MZN). Sobe o nível de verificação.', lim.daily_purchase_mzn; end if;
  end if;
  update security_settings set pin_failed = 0 where user_id = auth.uid();
  insert into tx_authorizations (user_id, purpose, amount_mzn) values (auth.uid(), p_purpose, p_amount) returning token into t;
  return t;
end $$;

create or replace function public.set_anti_phishing_code(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_code, '')) not between 4 and 20 then raise exception 'O código tem de ter 4 a 20 caracteres.'; end if;
  perform public.ensure_security_row();
  update security_settings set anti_phishing_code = p_code, updated_at = now() where user_id = auth.uid();
  perform public.sec_log(auth.uid(), 'Código anti-phishing definido');
end $$;

create or replace function public.freeze_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_security_row();
  update security_settings set frozen = true, frozen_at = now(), withdrawals_locked_until = now() + interval '24 hours' where user_id = auth.uid();
  update ad_campaigns set status = 'pausada' where owner_id = auth.uid() and status = 'ativa';
  perform public.sec_log(auth.uid(), 'Conta congelada pelo próprio utilizador');
end $$;

-- Bloqueio de levantamentos 24 h após mudar palavra-passe ou 2FA (eventos em auth.*)
create or replace function public.tg_auth_security_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'users' and new.encrypted_password is distinct from old.encrypted_password then
    insert into security_settings (user_id, withdrawals_locked_until) values (new.id, now() + interval '24 hours')
    on conflict (user_id) do update set withdrawals_locked_until = now() + interval '24 hours';
    insert into security_events (user_id, event) values (new.id, 'Palavra-passe alterada (levantamentos bloqueados 24 h)');
  elsif tg_table_name = 'mfa_factors' then
    insert into security_settings (user_id, withdrawals_locked_until) values (coalesce(new.user_id, old.user_id), now() + interval '24 hours')
    on conflict (user_id) do update set withdrawals_locked_until = now() + interval '24 hours';
    insert into security_events (user_id, event) values (coalesce(new.user_id, old.user_id), '2FA alterado (levantamentos bloqueados 24 h)');
  end if;
  return coalesce(new, old);
exception when others then return coalesce(new, old);
end $$;
drop trigger if exists on_auth_password_change on auth.users;
create trigger on_auth_password_change after update of encrypted_password on auth.users for each row execute function public.tg_auth_security_change();
do $$ begin
  drop trigger if exists on_mfa_change on auth.mfa_factors;
  create trigger on_mfa_change after insert or update of status or delete on auth.mfa_factors for each row execute function public.tg_auth_security_change();
exception when others then raise notice 'Sem trigger em auth.mfa_factors (%).', sqlerrm; end $$;

-- Lista branca: valida número por operadora e bloqueia levantamentos 24 h após adicionar
create or replace function public.tg_whitelist_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text := regexp_replace(new.msisdn, '\D', '', 'g');
begin
  n := regexp_replace(n, '^258', '');
  if n !~ '^8[2-7]\d{7}$' then raise exception 'Número moçambicano inválido.'; end if;
  if new.method = 'M-Pesa' and n !~ '^8[45]' then raise exception 'M-Pesa usa números 84 ou 85.'; end if;
  if new.method = 'e-Mola' and n !~ '^8[67]' then raise exception 'e-Mola usa números 86 ou 87.'; end if;
  if (select count(*) from withdrawal_whitelist where user_id = auth.uid()) >= 5 then raise exception 'Máximo de 5 números.'; end if;
  new.msisdn := '258' || n; new.user_id := auth.uid(); new.active_after := now() + interval '24 hours'; new.created_at := now();
  perform public.ensure_security_row();
  update security_settings set withdrawals_locked_until = greatest(coalesce(withdrawals_locked_until, now()), now() + interval '24 hours') where user_id = auth.uid();
  perform public.sec_log(auth.uid(), 'Número adicionado à lista branca', new.method || ' ' || left(new.msisdn, 5) || '•••' || right(new.msisdn, 2));
  return new;
end $$;
drop trigger if exists whitelist_guard on public.withdrawal_whitelist;
create trigger whitelist_guard before insert on public.withdrawal_whitelist for each row execute function public.tg_whitelist_guard();

-- Regras de risco: velocidade, anomalia de valor, número novo, dispositivo novo, KYC baixo
create or replace function public.evaluate_risk(p_user uuid, p_kind text, p_amount integer, p_whitelist text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rules text[] := '{}'; score int := 0; avg30 numeric; n10 int; nday int; lvl int;
begin
  select count(*) into n10 from tx_authorizations where user_id = p_user and created_at > now() - interval '10 minutes';
  if n10 > 5 then rules := rules || 'velocidade_10min'; score := score + 30; end if;
  if p_kind = 'levantamento' then
    select count(*) into nday from payouts where creator_id = p_user and created_at > now() - interval '1 day';
    if nday >= 3 then rules := rules || 'levantamentos_dia'; score := score + 30; end if;
    if p_whitelist is not null and exists (select 1 from withdrawal_whitelist where id = p_whitelist and created_at > now() - interval '72 hours') then rules := rules || 'numero_novo_72h'; score := score + 20; end if;
    if exists (select 1 from login_events where user_id = p_user and new_device and created_at > now() - interval '24 hours') then rules := rules || 'dispositivo_novo_24h'; score := score + 25; end if;
  end if;
  select avg(amount_mzn) into avg30 from payments where user_id = p_user and status = 'pago' and created_at > now() - interval '30 days';
  if p_amount > 1000 and avg30 is not null and p_amount > avg30 * 3 then rules := rules || 'valor_anomalo'; score := score + 30; end if;
  if avg30 is null and p_amount > 5000 then rules := rules || 'primeira_transacao_alta'; score := score + 20; end if;
  select kyc_level into lvl from security_settings where user_id = p_user;
  if coalesce(lvl, 0) < 2 and p_amount > 10000 then rules := rules || 'kyc_baixo_valor_alto'; score := score + 20; end if;
  return jsonb_build_object('score', score, 'rules', rules);
end $$;

-- Pedido de levantamento (idempotente) com todas as verificações
create or replace function public.request_withdrawal(p_whitelist text, p_amount integer, p_tx_token text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r security_settings; w withdrawal_whitelist; a tx_authorizations; lim kyc_limits; today_sum int; risk jsonb; pid text; h text; existing text;
begin
  if auth.uid() is null then raise exception 'Entra na tua conta.'; end if;
  select id into existing from payouts where creator_id = auth.uid() and idempotency_key = p_idem;
  if existing is not null then return jsonb_build_object('ok', true, 'id', existing, 'duplicate', true); end if;
  select * into r from security_settings where user_id = auth.uid();
  if r.frozen then raise exception 'Conta congelada.'; end if;
  if r.withdrawals_locked_until is not null and r.withdrawals_locked_until > now() then
    raise exception 'Levantamentos bloqueados por segurança até %.', to_char(r.withdrawals_locked_until at time zone 'Africa/Maputo', 'DD/MM HH24:MI'); end if;
  select * into w from withdrawal_whitelist where id = p_whitelist and user_id = auth.uid();
  if w.id is null then raise exception 'Escolhe um número da tua lista branca.'; end if;
  if w.active_after > now() then raise exception 'Este número só fica ativo às % (24 h após ser adicionado).', to_char(w.active_after at time zone 'Africa/Maputo', 'DD/MM HH24:MI'); end if;
  update tx_authorizations set used_at = now() where token = p_tx_token and user_id = auth.uid() and purpose = 'levantamento' and amount_mzn = p_amount and used_at is null and expires_at > now() returning * into a;
  if a.token is null then raise exception 'Autorização inválida ou expirada. Volta a introduzir o PIN.'; end if;
  select * into lim from kyc_limits where level = coalesce(r.kyc_level, 0);
  select coalesce(sum(amount_mzn), 0) into today_sum from payouts where creator_id = auth.uid() and status not in ('rejeitado','cancelado') and created_at > now() - interval '1 day';
  if today_sum + p_amount > lim.daily_withdraw_mzn then raise exception 'Limite diário de levantamento do teu nível: % MZN.', lim.daily_withdraw_mzn; end if;
  risk := public.evaluate_risk(auth.uid(), 'levantamento', p_amount, p_whitelist);
  select handle into h from profiles where id = auth.uid();
  insert into payouts (creator_id, creator_handle, amount_mzn, method, status, whitelist_id, idempotency_key, risk_score)
  values (auth.uid(), h, p_amount, w.method || ' ' || left(right(w.msisdn, 9), 2) || '•••' || right(w.msisdn, 2),
          case when (risk->>'score')::int >= 50 then 'em revisão' else 'pendente' end, w.id, p_idem, (risk->>'score')::int)
  returning id into pid;
  if (risk->>'score')::int >= 30 then
    insert into risk_flags (user_id, user_handle, kind, ref_id, rules, score, amount_mzn)
    values (auth.uid(), h, 'levantamento', pid, array(select jsonb_array_elements_text(risk->'rules')), (risk->>'score')::int, p_amount);
  end if;
  perform public.sec_log(auth.uid(), 'Pedido de levantamento', p_amount || ' MZN · risco ' || (risk->>'score'));
  return jsonb_build_object('ok', true, 'id', pid, 'review', (risk->>'score')::int >= 50);
end $$;

-- Login: regista dispositivo/IP, deteta dispositivo novo e alerta
create or replace function public.log_login(p_device_id text, p_device_label text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare is_new boolean; alerts boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  select not exists (select 1 from known_devices where user_id = auth.uid() and device_id = p_device_id) into is_new;
  insert into known_devices (user_id, device_id, label, last_ip) values (auth.uid(), p_device_id, left(coalesce(p_device_label, 'Dispositivo'), 80), public.req_ip())
  on conflict (user_id, device_id) do update set last_seen = now(), last_ip = public.req_ip(), label = excluded.label;
  insert into login_events (user_id, device_id, device_label, ip, user_agent, new_device) values (auth.uid(), p_device_id, p_device_label, public.req_ip(), public.req_ua(), is_new);
  select coalesce(new_device_alerts, true) into alerts from security_settings where user_id = auth.uid();
  if is_new and coalesce(alerts, true) and (select count(*) from known_devices where user_id = auth.uid()) > 1 then
    insert into notifications (user_id, type, body, href) values (auth.uid(), 'sistema',
      '🔐 Novo início de sessão: ' || left(coalesce(p_device_label, 'dispositivo'), 40) || coalesce(' · IP ' || public.req_ip(), '') || '. Não foste tu? Congela a conta em Segurança.', '/seguranca');
    perform public.sec_log(auth.uid(), 'Novo dispositivo', p_device_label);
  end if;
  return jsonb_build_object('ok', true, 'new_device', is_new);
end $$;

grant execute on function public.set_transaction_pin(text, text) to authenticated;
grant execute on function public.issue_tx_token(text, text, integer) to authenticated;
grant execute on function public.set_anti_phishing_code(text) to authenticated;
grant execute on function public.freeze_my_account() to authenticated;
grant execute on function public.request_withdrawal(text, integer, text, text) to authenticated;
grant execute on function public.log_login(text, text) to authenticated;
revoke execute on function public.evaluate_risk(uuid, text, integer, text) from anon, authenticated;
revoke execute on function public.sec_log(uuid, text, text) from anon, authenticated;

-- Storage privado para documentos KYC (pasta = id do utilizador; admins leem)
insert into storage.buckets (id, name, public, file_size_limit) values ('kyc-docs', 'kyc-docs', false, 8388608) on conflict (id) do nothing;
drop policy if exists "kyc envio próprio" on storage.objects;
create policy "kyc envio próprio" on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "kyc leitura" on storage.objects;
create policy "kyc leitura" on storage.objects for select to authenticated
  using (bucket_id = 'kyc-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Aprovar KYC sobe o nível (admin)
create or replace function public.tg_kyc_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'aprovado' and old.status <> 'aprovado' then
    insert into security_settings (user_id, kyc_level) values (new.user_id, new.level)
    on conflict (user_id) do update set kyc_level = greatest(security_settings.kyc_level, new.level);
    insert into notifications (user_id, type, body, href) values (new.user_id, 'sistema', '✅ Verificação aprovada: nível ' || new.level || '. Os teus limites aumentaram.', '/seguranca');
  elsif tg_op = 'UPDATE' and new.status = 'rejeitado' and old.status <> 'rejeitado' then
    insert into notifications (user_id, type, body, href) values (new.user_id, 'sistema', '❌ Verificação rejeitada: ' || coalesce(new.note, 'documento ilegível') || '.', '/seguranca');
  end if;
  if tg_op = 'INSERT' then new.status := 'pendente'; new.user_id := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists kyc_review_ins on public.kyc_submissions;
create trigger kyc_review_ins before insert on public.kyc_submissions for each row execute function public.tg_kyc_review();
drop trigger if exists kyc_review_upd on public.kyc_submissions;
create trigger kyc_review_upd after update on public.kyc_submissions for each row execute function public.tg_kyc_review();

-- Admin congela/descongela conta
create or replace function public.admin_set_frozen(p_user uuid, p_frozen boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão.'; end if;
  insert into security_settings (user_id, frozen, frozen_at) values (p_user, p_frozen, case when p_frozen then now() end)
  on conflict (user_id) do update set frozen = p_frozen, frozen_at = case when p_frozen then now() end;
  perform public.sec_log(p_user, case when p_frozen then 'Conta congelada pelo admin' else 'Conta descongelada pelo admin' end);
end $$;
grant execute on function public.admin_set_frozen(uuid, boolean) to authenticated;

alter table public.security_settings enable row level security;
alter table public.security_events enable row level security;
alter table public.known_devices enable row level security;
alter table public.login_events enable row level security;
alter table public.withdrawal_whitelist enable row level security;
alter table public.kyc_limits enable row level security;
alter table public.kyc_submissions enable row level security;
alter table public.tx_authorizations enable row level security;
alter table public.risk_flags enable row level security;
select public._policy('security_settings', 'seguranca propria', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('security_settings', 'preferencias de seguranca', 'for update using (user_id = auth.uid()) with check (user_id = auth.uid())');
select public._policy('security_events', 'os meus eventos', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('known_devices', 'os meus dispositivos', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('known_devices', 'remover dispositivo', 'for delete using (user_id = auth.uid())');
select public._policy('login_events', 'o meu historico', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('withdrawal_whitelist', 'a minha lista branca', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('withdrawal_whitelist', 'adicionar numero', 'for insert with check (user_id = auth.uid() and public.is_active_user())');
select public._policy('withdrawal_whitelist', 'remover numero', 'for delete using (user_id = auth.uid())');
select public._policy('kyc_limits', 'ler limites', 'for select using (true)');
select public._policy('kyc_limits', 'admin limites', 'for all using (public.is_admin()) with check (public.is_admin())');
select public._policy('kyc_submissions', 'o meu kyc', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('kyc_submissions', 'enviar kyc', 'for insert with check (user_id = auth.uid())');
select public._policy('kyc_submissions', 'admin revê kyc', 'for update using (public.is_admin())');
select public._policy('tx_authorizations', 'as minhas autorizacoes', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('risk_flags', 'admin risco', 'for select using (public.is_admin())');
select public._policy('risk_flags', 'admin decide risco', 'for update using (public.is_admin())');

-- ---------------------------------------------------------------------
-- 16. Monetização de criadores / ídolos
--     Candidatura ao programa (requisitos), membros (subscrições de fãs), presentes/doações em moedas,
--     partilha da receita de anúncios, prémios de torneios, saldo e levantamentos protegidos (§15).
-- ---------------------------------------------------------------------
update public.platform_settings set data = data || jsonb_build_object('monetization', jsonb_build_object(
  'minFollowers', 1000, 'minWatchHours', 100, 'minAge', 18, 'coinValueMzn', 0.5,
  'giftCreatorPct', 70, 'subCreatorPct', 80, 'adsCreatorPct', 50, 'tournamentFeePct', 15, 'minPayoutMzn', 200))
where id = 1 and not (data ? 'monetization');

create or replace function public.mon_setting(p_key text) returns numeric language sql stable security definer set search_path = public as $$
  select (data->'monetization'->>p_key)::numeric from platform_settings where id = 1;
$$;

create table if not exists public.creator_applications (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  followers_at_apply integer not null default 0,
  watch_hours numeric(12,1) not null default 0,
  category text,
  pitch text check (char_length(pitch) <= 600),
  status text not null default 'pendente' check (status in ('pendente','aprovado','rejeitado')),
  note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists creator_app_user_idx on public.creator_applications (user_id);
create index if not exists creator_app_status_idx on public.creator_applications (status, created_at) where status = 'pendente';

create table if not exists public.creator_programs (
  creator_id uuid primary key references public.profiles(id) on delete cascade,
  active boolean not null default true,
  sub_price_mzn integer not null default 99 check (sub_price_mzn between 25 and 5000),
  sub_perks text[] not null default '{Emblema de membro,Chat exclusivo,Clipes antecipados}',
  joined_at timestamptz not null default now()
);

create table if not exists public.fan_subscriptions (
  id text primary key default gen_random_uuid()::text,
  fan_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  price_mzn integer not null,
  status text not null default 'ativa' check (status in ('ativa','cancelada','expirada')),
  renews_at timestamptz,
  payment_id text,
  created_at timestamptz not null default now(),
  unique (fan_id, creator_id)
);
create index if not exists fan_subs_creator_idx on public.fan_subscriptions (creator_id, status);

create table if not exists public.gift_transactions (
  id bigint generated always as identity primary key,
  sender_id uuid references public.profiles(id) on delete set null,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('live','clipe','perfil')),
  target_id text,
  gift_id text not null,
  coins integer not null check (coins > 0),
  created_at timestamptz not null default now()
);
create index if not exists gifts_creator_idx on public.gift_transactions (creator_id, created_at desc);
create index if not exists gifts_sender_idx on public.gift_transactions (sender_id, created_at desc);

-- Livro-razão de ganhos (append-only): a soma é o saldo; nunca se edita uma linha
create table if not exists public.creator_earnings (
  id bigint generated always as identity primary key,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('presente','subscricao','anuncios','torneio','ajuste')),
  gross_mzn numeric(12,2) not null,
  platform_fee_mzn numeric(12,2) not null default 0,
  net_mzn numeric(12,2) not null,
  ref_id text,
  created_at timestamptz not null default now()
);
create index if not exists earnings_creator_idx on public.creator_earnings (creator_id, created_at desc);
create unique index if not exists earnings_ref_uq on public.creator_earnings (source, ref_id) where ref_id is not null;

create table if not exists public.tournament_prizes (
  id text primary key default gen_random_uuid()::text,
  tournament_id text not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  place integer not null check (place > 0),
  amount_mzn integer not null check (amount_mzn > 0),
  created_at timestamptz not null default now(),
  unique (tournament_id, place)
);
create index if not exists prizes_user_idx on public.tournament_prizes (user_id);

create or replace function public.creator_balance(p_user uuid default auth.uid()) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(net_mzn) from creator_earnings where creator_id = p_user), 0)
       - coalesce((select sum(amount_mzn) from payouts where creator_id = p_user and status not in ('rejeitado','cancelado')), 0);
$$;
grant execute on function public.creator_balance(uuid) to authenticated;

-- Candidatura: valida requisitos no servidor
create or replace function public.apply_creator(p_category text, p_pitch text) returns text
language plpgsql security definer set search_path = public as $$
declare f int; wh numeric; bd date; id_ text; minf numeric := coalesce(public.mon_setting('minFollowers'), 1000); minh numeric := coalesce(public.mon_setting('minWatchHours'), 100);
begin
  if auth.uid() is null then raise exception 'Entra na tua conta.'; end if;
  if exists (select 1 from creator_applications where user_id = auth.uid() and status = 'pendente') then raise exception 'Já tens uma candidatura em análise.'; end if;
  select followers_count, birth_date into f, bd from profiles where id = auth.uid();
  select coalesce(sum((props->>'seconds')::numeric), 0) / 3600 into wh from analytics_events
    where name = 'watch' and props->>'creator' = auth.uid()::text and created_at > now() - interval '365 days';
  if bd is not null and bd > current_date - make_interval(years => coalesce(public.mon_setting('minAge'), 18)::int) then raise exception 'O programa exige 18 anos ou mais.'; end if;
  if f < minf then raise exception 'Precisas de % seguidores (tens %).', minf, f; end if;
  if wh < minh then raise exception 'Precisas de % horas vistas nos últimos 12 meses (tens %).', minh, round(wh, 1); end if;
  insert into creator_applications (user_id, followers_at_apply, watch_hours, category, pitch) values (auth.uid(), f, round(wh, 1), p_category, p_pitch) returning id into id_;
  return id_;
end $$;
grant execute on function public.apply_creator(text, text) to authenticated;

create or replace function public.tg_creator_app_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'aprovado' and old.status <> 'aprovado' then
    update profiles set role = case when role = 'user' then 'creator' else role end where id = new.user_id;
    insert into creator_programs (creator_id) values (new.user_id) on conflict (creator_id) do update set active = true;
    insert into notifications (user_id, type, body, href) values (new.user_id, 'sistema', '🎉 Foste aprovado no Programa de Criadores! Já podes ganhar com presentes, membros e anúncios.', '/monetizacao');
  elsif new.status = 'rejeitado' and old.status <> 'rejeitado' then
    insert into notifications (user_id, type, body, href) values (new.user_id, 'sistema', 'Candidatura ao Programa de Criadores não aprovada: ' || coalesce(new.note, 'requisitos em falta') || '.', '/monetizacao');
  end if;
  new.reviewed_by := auth.uid();
  return new;
end $$;
drop trigger if exists creator_app_review on public.creator_applications;
create trigger creator_app_review before update on public.creator_applications for each row execute function public.tg_creator_app_review();

-- Presentes/doações em moedas (lives, clipes, perfil): desconta moedas e credita o criador
create or replace function public.send_gift(p_creator uuid, p_target_kind text, p_target_id text, p_gift text, p_coins integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bal int; val numeric := coalesce(public.mon_setting('coinValueMzn'), 0.5); pct numeric := coalesce(public.mon_setting('giftCreatorPct'), 70); gid bigint; gross numeric;
begin
  if auth.uid() is null then raise exception 'Entra na tua conta.'; end if;
  if p_coins <= 0 or p_coins > 100000 then raise exception 'Valor inválido.'; end if;
  if p_creator = auth.uid() then raise exception 'Não podes enviar presentes a ti próprio.'; end if;
  if not exists (select 1 from creator_programs where creator_id = p_creator and active) then raise exception 'Este criador ainda não recebe presentes.'; end if;
  if (select frozen from security_settings where user_id = auth.uid()) then raise exception 'Conta congelada.'; end if;
  if (select count(*) from gift_transactions where sender_id = auth.uid() and created_at > now() - interval '1 minute') >= 20 then raise exception 'Calma! Demasiados presentes num minuto.'; end if;
  perform set_config('gamehub.trusted', '1', true);
  update profiles set coins = coins - p_coins where id = auth.uid() and coins >= p_coins returning coins into bal;
  perform set_config('gamehub.trusted', '', true);
  if bal is null then raise exception 'Moedas insuficientes.'; end if;
  insert into gift_transactions (sender_id, creator_id, target_kind, target_id, gift_id, coins) values (auth.uid(), p_creator, p_target_kind, p_target_id, p_gift, p_coins) returning id into gid;
  gross := p_coins * val;
  insert into creator_earnings (creator_id, source, gross_mzn, platform_fee_mzn, net_mzn, ref_id) values (p_creator, 'presente', gross, gross * (100 - pct) / 100, gross * pct / 100, 'gift:' || gid);
  return jsonb_build_object('ok', true, 'coins', bal);
end $$;
grant execute on function public.send_gift(uuid, text, text, text, integer) to authenticated;

-- Subscrição de membro paga → ganho do criador (chamado pelo servidor de pagamentos após confirmação)
create or replace function public.credit_subscription(p_sub text) returns void
language plpgsql security definer set search_path = public as $$
declare s fan_subscriptions; pct numeric := coalesce(public.mon_setting('subCreatorPct'), 80);
begin
  select * into s from fan_subscriptions where id = p_sub;
  if s.id is null then return; end if;
  insert into creator_earnings (creator_id, source, gross_mzn, platform_fee_mzn, net_mzn, ref_id)
  values (s.creator_id, 'subscricao', s.price_mzn, s.price_mzn * (100 - pct) / 100, s.price_mzn * pct / 100, 'sub:' || s.id || ':' || to_char(now(), 'YYYYMM'))
  on conflict do nothing;
end $$;
revoke execute on function public.credit_subscription(text) from anon, authenticated;

-- Prémios de torneio → ganho (o admin regista; a comissão da plataforma já está nas inscrições)
create or replace function public.tg_prize_credit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into creator_earnings (creator_id, source, gross_mzn, platform_fee_mzn, net_mzn, ref_id)
  values (new.user_id, 'torneio', new.amount_mzn, 0, new.amount_mzn, 'prize:' || new.id) on conflict do nothing;
  insert into notifications (user_id, type, body, href) values (new.user_id, 'torneio', '🏆 Prémio de ' || new.amount_mzn || ' MZN creditado (' || new.place || 'º lugar).', '/monetizacao');
  return new;
end $$;
drop trigger if exists prize_credit on public.tournament_prizes;
create trigger prize_credit after insert on public.tournament_prizes for each row execute function public.tg_prize_credit();

-- Partilha da receita de anúncios: % do gasto diário dividido pelos criadores segundo as visualizações dos seus clipes
create or replace function public.distribute_ad_revenue(p_day date default (now() at time zone 'Africa/Maputo')::date - 1) returns integer
language plpgsql security definer set search_path = public as $$
declare pool numeric; pct numeric := coalesce(public.mon_setting('adsCreatorPct'), 50); n int := 0; total_views numeric;
begin
  select coalesce(sum(spend_mzn), 0) * pct / 100 into pool from ad_stats_daily where day = p_day;
  if pool <= 0 then return 0; end if;
  create temp table if not exists _views on commit drop as
    select (props->>'creator')::uuid as creator_id, count(*)::numeric as v from analytics_events
    where name = 'watch' and created_at >= p_day and created_at < p_day + 1 and props ? 'creator' group by 1;
  select sum(v) into total_views from _views where creator_id in (select creator_id from creator_programs where active);
  if coalesce(total_views, 0) = 0 then return 0; end if;
  insert into creator_earnings (creator_id, source, gross_mzn, platform_fee_mzn, net_mzn, ref_id)
  select v.creator_id, 'anuncios', round(pool * v.v / total_views, 2), 0, round(pool * v.v / total_views, 2), 'ads:' || p_day || ':' || v.creator_id
  from _views v join creator_programs cp on cp.creator_id = v.creator_id and cp.active
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.distribute_ad_revenue(date) from anon, authenticated;

-- Levantamento só até ao saldo disponível e acima do mínimo
create or replace function public.tg_payout_balance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.creator_id is not null and auth.uid() = new.creator_id then
    if new.amount_mzn < coalesce(public.mon_setting('minPayoutMzn'), 200) then raise exception 'Levantamento mínimo: % MZN.', coalesce(public.mon_setting('minPayoutMzn'), 200); end if;
    if public.creator_balance(new.creator_id) < new.amount_mzn then raise exception 'Saldo insuficiente.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists payout_balance on public.payouts;
create trigger payout_balance before insert on public.payouts for each row execute function public.tg_payout_balance();

alter table public.creator_applications enable row level security;
alter table public.creator_programs enable row level security;
alter table public.fan_subscriptions enable row level security;
alter table public.gift_transactions enable row level security;
alter table public.creator_earnings enable row level security;
alter table public.tournament_prizes enable row level security;
select public._policy('creator_applications', 'a minha candidatura', 'for select using (user_id = auth.uid() or public.is_admin())');
select public._policy('creator_applications', 'admin decide candidatura', 'for update using (public.is_admin())');
select public._policy('creator_programs', 'programas visiveis', 'for select using (true)');
select public._policy('creator_programs', 'criador define precos', 'for update using (creator_id = auth.uid() or public.is_admin()) with check (creator_id = auth.uid() or public.is_admin())');
select public._policy('fan_subscriptions', 'as minhas subscricoes', 'for select using (fan_id = auth.uid() or creator_id = auth.uid() or public.is_admin())');
select public._policy('fan_subscriptions', 'cancelar subscricao', 'for update using (fan_id = auth.uid()) with check (fan_id = auth.uid() and status in (''ativa'',''cancelada''))');
select public._policy('gift_transactions', 'os meus presentes', 'for select using (sender_id = auth.uid() or creator_id = auth.uid() or public.is_admin())');
select public._policy('creator_earnings', 'os meus ganhos', 'for select using (creator_id = auth.uid() or public.is_admin())');
select public._policy('tournament_prizes', 'premios visiveis', 'for select using (true)');
select public._policy('tournament_prizes', 'admin premios', 'for all using (public.is_admin()) with check (public.is_admin())');

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'gh_ad_revenue_share';
  perform cron.schedule('gh_ad_revenue_share', '15 1 * * *', 'select public.distribute_ad_revenue()');
exception when others then null; end $$;

-- Fim. ✅
