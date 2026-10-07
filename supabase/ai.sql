-- =====================================================================
-- Social POIPAK · Coach IA (Edge Function "coach-ai")
-- Script pequeno e IDEMPOTENTE (pode correr-se várias vezes).
-- Também está incluído no fim de supabase/schema.sql.
-- =====================================================================

-- Registo de utilização (1 linha por pedido à IA). Escrito APENAS pela Edge Function (service role).
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'pendente',
  model text,
  fallback boolean not null default false,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_time_idx on public.ai_usage (created_at desc);

-- Histórico opcional da conversa (a app também guarda localmente).
create table if not exists public.ai_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) <= 8000),
  fallback boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_user_time_idx on public.ai_messages (user_id, created_at desc);

alter table public.ai_usage enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists "ai_usage ler propria" on public.ai_usage;
create policy "ai_usage ler propria" on public.ai_usage for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "ai_messages ler proprias" on public.ai_messages;
create policy "ai_messages ler proprias" on public.ai_messages for select using (user_id = auth.uid());
drop policy if exists "ai_messages apagar proprias" on public.ai_messages;
create policy "ai_messages apagar proprias" on public.ai_messages for delete using (user_id = auth.uid());

-- Limite por utilizador (atómico: bloqueio por utilizador). Só a Edge Function (service_role) pode chamar.
-- Conta apenas respostas reais da IA (fallback = false); tecto duro de 60 pedidos/hora em qualquer caso.
create or replace function public.ai_try_consume(p_user uuid, p_per_hour integer, p_per_day integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare h integer; d integer; raw_h integer; new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('ai:' || p_user::text));
  select count(*) filter (where not fallback and created_at > now() - interval '1 hour'),
         count(*) filter (where not fallback),
         count(*) filter (where created_at > now() - interval '1 hour')
    into h, d, raw_h
    from public.ai_usage where user_id = p_user and created_at > now() - interval '24 hours';
  if raw_h >= 60 then return jsonb_build_object('ok', false, 'reason', 'hora', 'used_hour', h, 'used_day', d); end if;
  if d >= p_per_day then return jsonb_build_object('ok', false, 'reason', 'dia', 'used_hour', h, 'used_day', d); end if;
  if h >= p_per_hour then return jsonb_build_object('ok', false, 'reason', 'hora', 'used_hour', h, 'used_day', d); end if;
  insert into public.ai_usage (user_id) values (p_user) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'used_hour', h + 1, 'used_day', d + 1);
end $$;
revoke all on function public.ai_try_consume(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_try_consume(uuid, integer, integer) to service_role;

-- Estatísticas para o Admin › IA (só administradores).
create or replace function public.ai_usage_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Sem acesso.'; end if;
  select jsonb_build_object(
    'today', (select count(*) from ai_usage where created_at > now() - interval '24 hours'),
    'today_ai', (select count(*) from ai_usage where created_at > now() - interval '24 hours' and not fallback),
    'today_fallback', (select count(*) from ai_usage where created_at > now() - interval '24 hours' and fallback),
    'users_today', (select count(distinct user_id) from ai_usage where created_at > now() - interval '24 hours'),
    'week', (select count(*) from ai_usage where created_at > now() - interval '7 days'),
    'total', (select count(*) from ai_usage),
    'avg_latency_ms', (select coalesce(round(avg(latency_ms)), 0) from ai_usage where created_at > now() - interval '7 days' and not fallback),
    'by_model', coalesce((select jsonb_object_agg(k, n) from (select coalesce(model, provider) k, count(*) n from ai_usage
                  where created_at > now() - interval '7 days' group by 1) x), '{}'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.ai_usage_stats() from public, anon;
grant execute on function public.ai_usage_stats() to authenticated;

-- Limpeza automática (> 90 dias), se o pg_cron estiver ativo.
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'gh_ai_cleanup';
  perform cron.schedule('gh_ai_cleanup', '40 2 * * *',
    $q$delete from public.ai_usage where created_at < now() - interval '90 days'; delete from public.ai_messages where created_at < now() - interval '90 days'$q$);
exception when others then null; end $$;
