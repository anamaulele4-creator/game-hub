-- =====================================================================
-- 12. CLIPES DOS UTILIZADORES: publicar vídeos, visualizações, "Em alta"
--     Idempotente: pode correr-se várias vezes (também está em schema.sql).
-- =====================================================================

-- 12.1 Colunas novas na tabela clips
alter table public.clips add column if not exists description text check (char_length(description) <= 1000);
alter table public.clips add column if not exists thumb_url text;
alter table public.clips add column if not exists storage_path text;
alter table public.clips add column if not exists size_bytes bigint;
alter table public.clips add column if not exists duration numeric(8,2);
alter table public.clips add column if not exists status text not null default 'published';
alter table public.clips add column if not exists visibility text not null default 'public';
alter table public.clips add column if not exists watch_ms_total bigint not null default 0;
alter table public.clips add column if not exists completions integer not null default 0;
alter table public.clips add column if not exists score double precision not null default 0;
alter table public.clips add column if not exists featured boolean not null default false;
alter table public.clips add column if not exists featured_at timestamptz;
-- Tipo de publicação: vídeo, foto ou texto/momento (foto/texto não têm vídeo)
alter table public.clips add column if not exists kind text not null default 'video';
alter table public.clips add column if not exists image_url text;
alter table public.clips alter column video_url drop not null;
alter table public.clips add column if not exists updated_at timestamptz not null default now();
do $$ begin
  alter table public.clips add constraint clips_status_chk check (status in ('published','processing','removed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.clips add constraint clips_kind_chk check (kind in ('video','photo','text'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.clips add constraint clips_visibility_chk check (visibility in ('public','followers'));
exception when duplicate_object then null; end $$;
create index if not exists clips_pub_idx on public.clips (created_at desc) where status = 'published' and not hidden;
create index if not exists clips_score_idx on public.clips (score desc) where status = 'published' and not hidden;
create index if not exists clips_featured_idx on public.clips (featured_at desc) where featured;

-- Aceitação das Diretrizes da Comunidade no 1.º envio
alter table public.profiles add column if not exists clip_rules_at timestamptz;

-- 12.2 Visualizações (1 por utilizador por clipe a cada 24 h) + tempo de visualização
create table if not exists public.clip_views (
  id bigint generated always as identity primary key,
  clip_id text not null references public.clips(id) on delete cascade,
  viewer uuid references public.profiles(id) on delete cascade,
  device text,                       -- visitantes sem sessão (id aleatório do navegador)
  watch_ms integer not null default 0,
  completed boolean not null default false,
  viewed_at timestamptz not null default now()
);
create index if not exists clip_views_lookup_idx on public.clip_views (clip_id, viewer, viewed_at desc);
create index if not exists clip_views_device_idx on public.clip_views (clip_id, device, viewed_at desc);
create index if not exists clip_views_recent_idx on public.clip_views (viewed_at desc);
alter table public.clip_views enable row level security;
-- Sem policies: só as funções security definer abaixo escrevem/leem.

-- 12.3 Pontuação "Em alta": interação ponderada + conclusão, com decaimento temporal (gravidade 1.4)
create or replace function public.clip_score(p_views bigint, p_likes int, p_comments int, p_shares int,
  p_completions int, p_watch_ms bigint, p_duration numeric, p_created timestamptz, p_featured boolean)
returns double precision language sql stable as $$
  select (
      ln(1 + coalesce(p_views,0)) * 1.0
    + coalesce(p_likes,0) * 3.0
    + coalesce(p_comments,0) * 5.0
    + coalesce(p_shares,0) * 8.0
    + coalesce(p_completions,0) * 4.0
    -- tempo médio visto ÷ duração (0..1) × 10
    + case when coalesce(p_views,0) > 0 and coalesce(p_duration,0) > 0
           then least(1.0, (p_watch_ms::double precision / p_views) / (p_duration * 1000)) * 10 else 0 end
  ) / power(extract(epoch from (now() - p_created)) / 3600.0 + 2, 1.4)
  + case when p_featured then 1000 else 0 end;
$$;

create or replace function public.refresh_clip_scores() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('gamehub.trusted', '1', true);
  update clips set score = public.clip_score(views_count, likes_count, comments_count, shares_count, completions,
                                             watch_ms_total, duration, created_at, featured)
  where status = 'published' and not hidden and created_at > now() - interval '30 days';
  get diagnostics n = row_count;
  update clips set score = 0 where score <> 0 and created_at <= now() - interval '30 days' and not featured;
  perform set_config('gamehub.trusted', '', true);
  return n;
end $$;
revoke all on function public.refresh_clip_scores() from public, anon, authenticated;

-- 12.4 RPC: contar visualização (chamada após ~3 s) e atualizar tempo visto (ao sair do clipe)
create or replace function public.clip_view(p_id text, p_watch_ms integer default 0, p_completed boolean default false, p_device text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row clip_views%rowtype; v_count bigint; v_ms integer := greatest(0, least(coalesce(p_watch_ms,0), 3600000));
begin
  if v_uid is null and (p_device is null or length(p_device) < 8) then return null; end if;
  if not exists (select 1 from clips where id = p_id and status = 'published' and not hidden) then return null; end if;
  perform set_config('gamehub.trusted', '1', true);
  select * into v_row from clip_views
   where clip_id = p_id and viewed_at > now() - interval '24 hours'
     and ((v_uid is not null and viewer = v_uid) or (v_uid is null and viewer is null and device = p_device))
   order by viewed_at desc limit 1;
  if not found then
    insert into clip_views (clip_id, viewer, device, watch_ms, completed) values (p_id, v_uid, case when v_uid is null then p_device end, v_ms, coalesce(p_completed,false));
    update clips set views_count = views_count + 1, watch_ms_total = watch_ms_total + v_ms,
           completions = completions + case when p_completed then 1 else 0 end
     where id = p_id returning views_count into v_count;
  else
    -- mesma visualização (24 h): só acrescenta tempo visto e conclusão, sem novo view
    if v_ms > v_row.watch_ms or (p_completed and not v_row.completed) then
      update clip_views set watch_ms = greatest(watch_ms, v_ms), completed = completed or coalesce(p_completed,false) where id = v_row.id;
      update clips set watch_ms_total = watch_ms_total + greatest(0, v_ms - v_row.watch_ms),
             completions = completions + case when p_completed and not v_row.completed then 1 else 0 end
       where id = p_id;
    end if;
    select views_count into v_count from clips where id = p_id;
  end if;
  update clips set score = public.clip_score(views_count, likes_count, comments_count, shares_count, completions, watch_ms_total, duration, created_at, featured) where id = p_id;
  perform set_config('gamehub.trusted', '', true);
  return v_count;
end $$;
grant execute on function public.clip_view(text, integer, boolean, text) to anon, authenticated;

-- 12.5 RPC: partilha (contador)
create or replace function public.clip_share(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform set_config('gamehub.trusted', '1', true);
  update clips set shares_count = shares_count + 1 where id = p_id and status = 'published' and not hidden;
  perform set_config('gamehub.trusted', '', true);
end $$;
grant execute on function public.clip_share(text) to authenticated;

-- 12.6 RPC: estatísticas para o criador (autor) ou moderação
create or replace function public.clip_stats(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clips%rowtype;
begin
  select * into c from clips where id = p_id;
  if not found then return null; end if;
  if c.author_id <> auth.uid() and not public.is_mod() then raise exception 'Sem acesso.'; end if;
  return jsonb_build_object(
    'views', c.views_count, 'likes', c.likes_count, 'comments', c.comments_count, 'shares', c.shares_count,
    'avg_watch_s', case when c.views_count > 0 then round((c.watch_ms_total::numeric / c.views_count) / 1000, 1) else 0 end,
    'completion', case when c.views_count > 0 then round(c.completions::numeric * 100 / c.views_count) else 0 end,
    'duration', c.duration, 'score', round(c.score::numeric, 4), 'featured', c.featured, 'status', c.status,
    'views_24h', (select count(*) from clip_views where clip_id = p_id and viewed_at > now() - interval '24 hours'),
    'views_7d', (select count(*) from clip_views where clip_id = p_id and viewed_at > now() - interval '7 days'),
    'rank', (select count(*) + 1 from clips x where x.status = 'published' and not x.hidden and x.score > c.score)
  );
end $$;
grant execute on function public.clip_stats(text) to authenticated;

-- 12.7 RPC: "Em alta" (respeita visibilidade via RLS porque é security invoker)
create or replace function public.trending_clips(p_limit integer default 30)
returns setof public.clips language sql stable security invoker set search_path = public as $$
  select * from clips
   where status = 'published' and not hidden and (featured or (created_at > now() - interval '14 days' and views_count >= 3))
   order by featured desc, score desc, created_at desc
   limit least(coalesce(p_limit, 30), 100);
$$;
grant execute on function public.trending_clips(integer) to anon, authenticated;

-- 12.8 RPC: quantos envios restam hoje
create or replace function public.clip_quota() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'limit', coalesce((select (data->'clips'->>'dailyLimit')::int from platform_settings where id = 1), 10),
    'used', (select count(*) from clips where author_id = auth.uid() and created_at > now() - interval '24 hours'),
    'rules', (select clip_rules_at is not null from profiles where id = auth.uid()),
    'active', public.is_active_user());
$$;
grant execute on function public.clip_quota() to authenticated;

create or replace function public.accept_clip_rules() returns void
language sql security definer set search_path = public as $$
  update profiles set clip_rules_at = coalesce(clip_rules_at, now()) where id = auth.uid();
$$;
grant execute on function public.accept_clip_rules() to authenticated;

-- 12.9 Triggers: limite diário, banidos, campos protegidos
create or replace function public.tg_clips_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; used int;
begin
  if tg_op = 'INSERT' then
    if public.is_mod() then return new; end if;
    if not public.is_active_user() then raise exception 'A tua conta não pode publicar clipes (suspensa ou banida).'; end if;
    if not exists (select 1 from profiles where id = auth.uid() and clip_rules_at is not null) then
      raise exception 'Aceita as Diretrizes da Comunidade antes de publicar.';
    end if;
    lim := coalesce((select (data->'clips'->>'dailyLimit')::int from platform_settings where id = 1), 10);
    select count(*) into used from clips where author_id = auth.uid() and created_at > now() - interval '24 hours';
    if used >= lim then raise exception 'Limite diário atingido (% clipes por dia). Tenta amanhã.', lim; end if;
    new.views_count := 0; new.likes_count := 0; new.comments_count := 0; new.shares_count := 0;
    new.watch_ms_total := 0; new.completions := 0; new.score := 0; new.featured := false; new.featured_at := null; new.hidden := false;
    if new.status = 'removed' then new.status := 'processing'; end if;
    return new;
  end if;
  -- UPDATE
  new.updated_at := now();
  -- auth.uid() nulo = cron/serviço (ex.: rollup_counters); 'trusted' = funções RPC deste ficheiro
  if auth.uid() is null or public.is_mod() or coalesce(current_setting('gamehub.trusted', true), '') = '1' then
    if new.featured and not old.featured then new.featured_at := now(); end if;
    return new;
  end if;
  new.views_count := old.views_count; new.likes_count := old.likes_count; new.comments_count := old.comments_count;
  new.shares_count := old.shares_count; new.watch_ms_total := old.watch_ms_total; new.completions := old.completions;
  new.score := old.score; new.featured := old.featured; new.featured_at := old.featured_at; new.hidden := old.hidden;
  new.author_id := old.author_id; new.created_at := old.created_at;
  if old.status = 'removed' then new.status := 'removed'; end if;
  if new.status = 'removed' and old.status <> 'removed' then new.status := old.status; end if;
  return new;
end $$;
drop trigger if exists clips_guard on public.clips;
create trigger clips_guard before insert or update on public.clips for each row execute function public.tg_clips_guard();

-- Remoção pela Moderação (tabela hidden_content) → clipe fica 'removed'; repor → 'published'
create or replace function public.tg_hidden_clip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('gamehub.trusted', '1', true);
  if tg_op = 'INSERT' then
    update clips set hidden = true, status = 'removed', featured = false where id = new.target;
  else
    update clips set hidden = false, status = 'published' where id = old.target and status = 'removed';
  end if;
  perform set_config('gamehub.trusted', '', true);
  return null;
end $$;
drop trigger if exists hidden_clip_sync on public.hidden_content;
create trigger hidden_clip_sync after insert or delete on public.hidden_content for each row execute function public.tg_hidden_clip();

-- 12.10 RLS dos clipes: públicos para todos; "só seguidores" para quem segue; autor e moderação veem tudo
select public._policy('clips', 'ler clipes', $p$for select using (
  (status = 'published' and not hidden and (visibility = 'public'
     or exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followed_id = clips.author_id)))
  or author_id = auth.uid() or public.is_mod())$p$);
select public._policy('clips', 'publicar clipes', 'for insert with check (author_id = auth.uid() and public.is_active_user())');
select public._policy('clips', 'editar clipes', 'for update using (author_id = auth.uid() or public.is_mod()) with check (author_id = auth.uid() or public.is_mod())');
select public._policy('clips', 'apagar clipes', 'for delete using (author_id = auth.uid() or public.is_mod())');

-- 12.11 Storage: bucket público 'clips' (pasta = id do utilizador).
-- Plano grátis do Supabase: 1 GB no total e 50 MB por ficheiro → limite do bucket = 50 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', true, 52428800, array['video/mp4','video/quicktime','video/webm','video/3gpp','video/x-matroska','image/jpeg','image/webp','image/png'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "clips leitura" on storage.objects;
create policy "clips leitura" on storage.objects for select using (bucket_id = 'clips');
drop policy if exists "clips upload próprio" on storage.objects;
create policy "clips upload próprio" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());
drop policy if exists "clips atualizar próprio" on storage.objects;
create policy "clips atualizar próprio" on storage.objects for update to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "clips apagar próprio" on storage.objects;
create policy "clips apagar próprio" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_mod()));

-- 12.12 pg_cron (se ativo): recalcular "Em alta" a cada 10 min e limpar visualizações > 90 dias
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('gh_clip_scores', 'gh_clip_views_cleanup');
  perform cron.schedule('gh_clip_scores', '*/10 * * * *', 'select public.refresh_clip_scores()');
  perform cron.schedule('gh_clip_views_cleanup', '50 3 * * *', $q$delete from public.clip_views where viewed_at < now() - interval '90 days'$q$);
exception when others then null; end $$;

-- 12.13 Clipes 'processing' abandonados (> 6 h) são apagados
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'gh_clip_stale';
  perform cron.schedule('gh_clip_stale', '15 * * * *', $q$delete from public.clips where status = 'processing' and created_at < now() - interval '6 hours'$q$);
exception when others then null; end $$;

-- Fim da secção 12 ✅
