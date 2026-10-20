-- SÓ PARA TESTES: cópia mínima de app_settings/app_audit_log/app__audit/app_setting_set (definidos em
-- supabase/migrations/2026-10-20-apostas-v2.sql). Usada pelos testes do Marketplace 3.0 apenas quando esse
-- ficheiro ainda não existe no repositório. Em produção corre-se sempre o SQL real de Apostas v2.
create table if not exists public.app_settings (
  key text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  value jsonb not null,
  perm text not null default 'admin',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create table if not exists public.app_audit_log (
  id bigint generated always as identity primary key,
  area text not null, action text not null, target text not null default '',
  actor_id uuid, actor_handle text not null default '', before jsonb, after jsonb,
  created_at timestamptz not null default now()
);
create or replace function public.app__tg_audit_immutable() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_IMMUTABLE'; end $$;
drop trigger if exists app_audit_immutable on public.app_audit_log;
create trigger app_audit_immutable before update or delete on public.app_audit_log for each row execute function public.app__tg_audit_immutable();
create or replace function public.app__audit(p_area text, p_action text, p_target text, p_before jsonb, p_after jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into app_audit_log (area, action, target, actor_id, actor_handle, before, after)
  values (p_area, p_action, coalesce(p_target, ''), auth.uid(), coalesce((select handle from profiles where id = auth.uid()), case when auth.uid() is null then 'sistema' else '' end), p_before, p_after);
end $$;
create or replace function public.app_setting_set(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st app_settings;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into st from app_settings where key = p_key for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if not (st.perm = 'admin' and public.is_admin()) then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if jsonb_typeof(st.value) = 'boolean' and jsonb_typeof(p_value) is distinct from 'boolean' then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  update app_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform public.app__audit('definicoes', 'definicao:' || p_key, p_key, jsonb_build_object('value', st.value), jsonb_build_object('value', p_value));
  return jsonb_build_object('ok', true, 'value', p_value);
end $$;
alter table public.app_settings enable row level security;
alter table public.app_audit_log enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (true);
drop policy if exists app_audit_read on public.app_audit_log;
create policy app_audit_read on public.app_audit_log for select using ((select public.is_admin()));
revoke insert, update, delete on public.app_settings, public.app_audit_log from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant select on public.app_audit_log to authenticated;
