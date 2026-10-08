-- =====================================================================
-- Social POIPAK · IA do sistema (deteção e recuperação de erros)
-- Script pequeno e IDEMPOTENTE (pode correr-se várias vezes).
-- Também está incluído em supabase/schema.sql (secção 17).
-- =====================================================================

create table if not exists public.system_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  route text,
  user_id uuid null references auth.users(id) on delete set null,
  user_agent text,
  fingerprint text not null unique,
  count integer not null default 1,
  status text not null default 'new' check (status in ('new','auto_fixed','resolved')),
  last_seen timestamptz not null default now()
);
create index if not exists system_errors_last_seen_idx on public.system_errors (last_seen desc);
create index if not exists system_errors_status_idx on public.system_errors (status, last_seen desc);

alter table public.system_errors enable row level security;
drop policy if exists "ler erros do sistema" on public.system_errors;
create policy "ler erros do sistema" on public.system_errors for select using (public.is_mod());
drop policy if exists "atualizar erros do sistema" on public.system_errors;
create policy "atualizar erros do sistema" on public.system_errors for update using (public.is_mod()) with check (public.is_mod());
-- Sem política de insert: qualquer pessoa regista erros APENAS através da RPC abaixo.

create or replace function public.log_system_error(
  p_message text, p_stack text default null, p_route text default null,
  p_user_agent text default null, p_fingerprint text default null, p_auto_fixed boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare v_fp text;
begin
  if p_message is null or length(trim(p_message)) = 0 then return; end if;
  v_fp := left(coalesce(nullif(p_fingerprint, ''), md5(left(p_message, 500) || coalesce(p_route, ''))), 128);
  insert into public.system_errors (message, stack, route, user_id, user_agent, fingerprint, status)
  values (left(p_message, 1000), left(p_stack, 4000), left(p_route, 300), auth.uid(), left(p_user_agent, 300), v_fp,
          case when p_auto_fixed then 'auto_fixed' else 'new' end)
  on conflict (fingerprint) do update set
    count = system_errors.count + 1,
    last_seen = now(),
    stack = coalesce(excluded.stack, system_errors.stack),
    user_id = coalesce(excluded.user_id, system_errors.user_id),
    user_agent = coalesce(excluded.user_agent, system_errors.user_agent),
    -- um erro resolvido que volta a aparecer reabre como 'new'
    status = case when system_errors.status = 'resolved' then 'new'
                  when p_auto_fixed and system_errors.status = 'new' then 'auto_fixed'
                  else system_errors.status end;
end $$;
revoke all on function public.log_system_error(text, text, text, text, text, boolean) from public;
grant execute on function public.log_system_error(text, text, text, text, text, boolean) to anon, authenticated;

-- Limpeza: erros resolvidos com mais de 30 dias (se pg_cron estiver ativo)
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'gh_system_errors_cleanup';
  perform cron.schedule('gh_system_errors_cleanup', '40 3 * * *', $q$delete from public.system_errors where status = 'resolved' and last_seen < now() - interval '30 days'$q$);
exception when others then null; end $$;
