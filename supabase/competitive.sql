-- =====================================================================
-- TXAPILOG · Módulo COMPETITIVO (equipas, desafios, eventos públicos, carteira, pagamentos, apostas, admin) — 2026-10-19
-- Script IDEMPOTENTE (pode correr-se várias vezes). NÃO cria dados falsos nem utilizadores.
-- Ordem: schema.sql → migrations/* (por data) → ESTE ficheiro (ver README / COMPETITIVO.md).
-- Depende de: profiles, is_admin(), is_active_user(), audit_log, notifications, risk_flags, security_settings, tx_authorizations,
--             payments (schema.sql); bet_* + money_ledger + bet_kyc + money_withdrawals (migrations/2026-10-10-bets*.sql);
--             core_rate_limit() (migrations/2026-10-09-ai-core.sql, opcional — há recurso local).
--
-- Princípios:
--   • Toda a validação vive AQUI (funções SECURITY DEFINER + RLS + triggers). O cliente só lê; não tem INSERT/UPDATE/DELETE.
--   • Máquina de estados dos desafios imposta por trigger; histórico imutável (comp_challenge_events).
--   • Dinheiro: livro-razão money_ledger (já existente) só de acréscimos, com UUID + chave de idempotência únicos.
--     Saldo disponível e reservado calculados no servidor. Depósito só é creditado por webhook verificado (service_role).
--   • Funcionalidades monetárias e apostas DESLIGADAS por omissão (monetary_features_enabled = betting_enabled = FALSE).
--     Ligar exige: admin + sessão MFA (aal2) + licença registada e dentro da validade. Tudo auditado.
-- =====================================================================

create extension if not exists pgcrypto;

-- 0. Definições, licenças, fornecedores, auditoria, idempotência, limites ------------------------------------
create table if not exists public.comp_settings (
  id integer primary key default 1 check (id = 1),
  monetary_features_enabled boolean not null default false,
  betting_enabled boolean not null default false,
  predictions_enabled boolean not null default true,
  min_age_monetary integer not null default 18 check (min_age_monetary >= 18),
  allowed_provinces text[] not null default array['Maputo Cidade','Maputo Província','Gaza','Inhambane','Sofala','Manica','Tete','Zambézia','Nampula','Niassa','Cabo Delgado'],
  allowed_countries text[] not null default array['MZ'],
  cancel_window_hours integer not null default 2 check (cancel_window_hours between 0 and 72),
  acceptance_hours integer not null default 72 check (acceptance_hours between 1 and 720),
  result_hours integer not null default 24 check (result_hours between 1 and 168),
  max_team_members integer not null default 10 check (max_team_members between 2 and 50),
  bet_rate_per_hour integer not null default 30 check (bet_rate_per_hour between 1 and 1000),
  deposit_min integer not null default 10 check (deposit_min >= 1),
  deposit_max integer not null default 25000 check (deposit_max >= deposit_min),
  terms_version text not null default 'v1-2026-10-19',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.comp_settings (id) values (1) on conflict (id) do nothing;

-- Licenças (ex.: Inspecção Geral de Jogos). Só acréscimos; revogar = marcar revoked_at.
create table if not exists public.comp_licences (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'apostas' check (scope in ('apostas','pagamentos')),
  authority text not null check (char_length(btrim(authority)) between 3 and 120),
  licence_no text not null check (char_length(btrim(licence_no)) between 2 and 80),
  valid_from date not null,
  valid_until date not null,
  notes text not null default '',
  recorded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  constraint comp_licences_dates check (valid_until > valid_from)
);
create index if not exists comp_licences_scope_idx on public.comp_licences (scope, valid_until desc) where revoked_at is null;

-- Estado do fornecedor de pagamentos: escrito SÓ pela Edge Function (service_role) no /health, a partir dos segredos.
create table if not exists public.comp_provider_status (
  provider text primary key check (provider in ('mpesa','emola','aggregator')),
  configured boolean not null default false,
  live boolean not null default false,
  details jsonb not null default '{}',
  checked_at timestamptz not null default now()
);

-- Registo de auditoria imutável (complementa audit_log)
create table if not exists public.comp_audit (
  id bigint generated always as identity primary key,
  actor_id uuid default auth.uid(),
  action text not null,
  target text not null default '',
  details jsonb not null default '{}',
  ip text,
  aal text,
  created_at timestamptz not null default now()
);
create index if not exists comp_audit_created_idx on public.comp_audit (created_at desc);
create index if not exists comp_audit_actor_idx on public.comp_audit (actor_id, created_at desc);

create table if not exists public.comp_idempotency (
  user_id uuid not null,
  key text not null check (char_length(key) between 16 and 120),
  op text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.comp_rate_hits (
  key text not null,
  hit_at timestamptz not null default now()
);
create index if not exists comp_rate_hits_idx on public.comp_rate_hits (key, hit_at desc);

-- Imutabilidade genérica
create or replace function public.comp__tg_immutable() returns trigger language plpgsql as $$
begin raise exception 'COMP_IMMUTABLE: % é só de acréscimos', tg_table_name; end $$;
drop trigger if exists comp_audit_immutable on public.comp_audit;
create trigger comp_audit_immutable before update or delete on public.comp_audit for each row execute function public.comp__tg_immutable();
create or replace function public.comp__tg_licence_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'COMP_IMMUTABLE: comp_licences'; end if;
  if (new.authority, new.licence_no, new.valid_from, new.valid_until, new.scope, new.created_at) is distinct from
     (old.authority, old.licence_no, old.valid_from, old.valid_until, old.scope, old.created_at) or old.revoked_at is not null then
    raise exception 'COMP_IMMUTABLE: licença só pode ser revogada';
  end if;
  return new;
end $$;
drop trigger if exists comp_licence_guard on public.comp_licences;
create trigger comp_licence_guard before update or delete on public.comp_licences for each row execute function public.comp__tg_licence_guard();

-- Helpers ------------------------------------------------------------------------------------------------
create or replace function public.comp__audit(p_action text, p_target text, p_details jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare h text; ip text;
begin
  select handle into h from profiles where id = auth.uid();
  begin ip := public.req_ip(); exception when others then ip := null; end;
  insert into comp_audit (actor_id, action, target, details, ip, aal) values (auth.uid(), p_action, coalesce(p_target, ''), coalesce(p_details, '{}'), ip, coalesce(auth.jwt()->>'aal', null));
  insert into audit_log (actor_id, actor_handle, action, target) values (auth.uid(), h, 'competitivo:' || p_action, coalesce(p_target, ''));
end $$;

-- MFA forte: sessão com aal2 (TOTP verificado). Exigido em todas as operações sensíveis de admin.
create or replace function public.comp__strong_auth() returns boolean language sql stable as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2' $$;

create or replace function public.comp__rate(p_key text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('comp_rl:' || p_key, 0));
  delete from comp_rate_hits where key = p_key and hit_at < now() - make_interval(secs => p_window_seconds * 2);
  select count(*) into n from comp_rate_hits where key = p_key and hit_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then return false; end if;
  insert into comp_rate_hits (key) values (p_key);
  return true;
end $$;

create or replace function public.comp__idem_get(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select response from comp_idempotency where user_id = auth.uid() and key = p_key $$;
create or replace function public.comp__idem_put(p_key text, p_op text, p_resp jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null then return p_resp; end if;
  insert into comp_idempotency (user_id, key, op, response) values (auth.uid(), p_key, p_op, p_resp) on conflict do nothing;
  return p_resp;
end $$;

create or replace function public.comp__err(p_code text, p_extra jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'code', p_code) || coalesce(p_extra, '{}') $$;

create or replace function public.comp__notify(p_user uuid, p_type text, p_body text, p_href text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into notifications (user_id, type, body, href) values (p_user, p_type, left(p_body, 300), p_href);
exception when others then null; -- notificações nunca bloqueiam a operação principal
end $$;

create or replace function public.comp__flag(p_user uuid, p_kind text, p_ref text, p_rules text[], p_score integer, p_amount integer default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into risk_flags (user_id, user_handle, kind, ref_id, rules, score, amount_mzn)
  values (p_user, (select handle from profiles where id = p_user), p_kind, p_ref, p_rules, p_score, p_amount);
exception when others then null;
end $$;

-- risk_flags: novos tipos (aposta, desafio, deposito) mantendo os existentes
alter table public.risk_flags drop constraint if exists risk_flags_kind_check;
alter table public.risk_flags add constraint risk_flags_kind_check check (kind in ('pagamento','levantamento','login','conta','aposta','desafio','deposito'));

-- Licença válida hoje (Maputo) para um âmbito
create or replace function public.comp__licence_valid(p_scope text default 'apostas') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from comp_licences where scope = p_scope and revoked_at is null
    and valid_from <= (now() at time zone 'Africa/Maputo')::date and valid_until >= (now() at time zone 'Africa/Maputo')::date) $$;

-- Interruptores efetivos: definição ligada E licença válida. Apostas exigem também as funcionalidades monetárias.
create or replace function public.comp__monetary_on() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select monetary_features_enabled from comp_settings where id = 1), false) and public.comp__licence_valid('apostas') $$;
create or replace function public.comp__betting_on() returns boolean
language sql stable security definer set search_path = public as $$
  select public.comp__monetary_on() and coalesce((select betting_enabled from comp_settings where id = 1), false) $$;
create or replace function public.comp__provider_ready(p_provider text default 'mpesa') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select configured and live from comp_provider_status where provider = p_provider), false) $$;

-- Integração com o módulo de apostas existente: dinheiro real (MT) passa a exigir também os interruptores competitivos.
create or replace function public.bets__real_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select real_money_enabled and igj_licence_expiry is not null and igj_licence_expiry > (now() at time zone 'Africa/Maputo')::date from bet_settings where id = 1), false)
     and public.comp__betting_on() $$;

-- 1. Elegibilidade (idade, identidade, localização, jogo responsável) -------------------------------------
alter table public.bet_limits add column if not exists deposit_daily integer check (deposit_daily is null or deposit_daily >= 1);
alter table public.bet_limits add column if not exists deposit_weekly integer check (deposit_weekly is null or deposit_weekly >= 1);
alter table public.bet_limits add column if not exists deposit_monthly integer check (deposit_monthly is null or deposit_monthly >= 1);
alter table public.bet_limits add column if not exists cool_off_until timestamptz;
alter table public.bet_limits add column if not exists pending_limits jsonb;
alter table public.bet_limits add column if not exists pending_effective_at timestamptz;

create or replace function public.comp__age(p_birth date) returns integer language sql stable as $$
  select case when p_birth is null then null else extract(year from age((now() at time zone 'Africa/Maputo')::date, p_birth))::integer end $$;

-- Devolve {ok, reasons[]} para serviços restritos (dinheiro / apostas). Razões em códigos estáveis.
create or replace function public.comp_eligibility(p_user uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; k bet_kyc; s comp_settings; l bet_limits; sec security_settings; rs text[] := '{}'; a integer; ctry text; lvl integer;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reasons', array['AUTH']); end if;
  if p_user <> auth.uid() and not public.is_admin() then return jsonb_build_object('ok', false, 'reasons', array['FORBIDDEN']); end if;
  select * into p from profiles where id = p_user;
  select * into k from bet_kyc where user_id = p_user;
  select * into s from comp_settings where id = 1;
  select * into l from bet_limits where user_id = p_user;
  select * into sec from security_settings where user_id = p_user;
  if p.id is null or p.banned or p.deleted_at is not null or (p.suspended_until is not null and p.suspended_until > now()) then rs := array_append(rs, 'ACCOUNT'); end if;
  if coalesce(sec.frozen, false) then rs := array_append(rs, 'FROZEN'); end if;
  a := public.comp__age(coalesce(k.birth_date, p.birth_date));
  if a is null then rs := array_append(rs, 'NO_BIRTH'); elsif a < s.min_age_monetary then rs := array_append(rs, 'MINOR'); end if;
  lvl := coalesce(sec.kyc_level, 0);
  if coalesce(k.status, '') <> 'aprovado' and lvl < 2 then rs := array_append(rs, 'KYC'); end if;
  if p.province is null or not (p.province = any(s.allowed_provinces)) then rs := array_append(rs, 'LOCATION'); end if;
  begin ctry := upper(nullif(current_setting('request.headers', true)::json->>'cf-ipcountry', '')); exception when others then ctry := null; end;
  if ctry is not null and ctry not in ('XX','T1') and not (ctry = any(s.allowed_countries)) then rs := array_append(rs, 'COUNTRY'); end if;
  if l.self_excluded_until is not null and l.self_excluded_until > now() then rs := array_append(rs, 'SELF_EXCLUDED'); end if;
  if l.cool_off_until is not null and l.cool_off_until > now() then rs := array_append(rs, 'COOL_OFF'); end if;
  return jsonb_build_object('ok', coalesce(array_length(rs, 1), 0) = 0, 'reasons', rs, 'age', a, 'kyc', coalesce(k.status, case when lvl >= 2 then 'aprovado' else null end));
end $$;

-- Jogo responsável: limites de depósito (descer = imediato; subir = 24 h depois), pausa (cool-off) e autoexclusão (já existe bets_self_exclude)
create or replace function public.comp_rg_set_limits(p_deposit_daily integer, p_deposit_weekly integer, p_deposit_monthly integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l bet_limits; up boolean;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  if least(coalesce(p_deposit_daily, 1), coalesce(p_deposit_weekly, 1), coalesce(p_deposit_monthly, 1)) < 1 then return public.comp__err('LIMIT'); end if;
  insert into bet_limits (user_id) values (uid) on conflict (user_id) do nothing;
  select * into l from bet_limits where user_id = uid for update;
  -- é aumento se algum limite passa a ser maior (ou é removido)
  up := (l.deposit_daily is not null and (p_deposit_daily is null or p_deposit_daily > l.deposit_daily))
     or (l.deposit_weekly is not null and (p_deposit_weekly is null or p_deposit_weekly > l.deposit_weekly))
     or (l.deposit_monthly is not null and (p_deposit_monthly is null or p_deposit_monthly > l.deposit_monthly));
  if up then
    update bet_limits set pending_limits = jsonb_build_object('deposit_daily', p_deposit_daily, 'deposit_weekly', p_deposit_weekly, 'deposit_monthly', p_deposit_monthly),
      pending_effective_at = now() + interval '24 hours', updated_at = now() where user_id = uid;
    perform public.comp__audit('rg_limite_aumento_pedido', uid::text, jsonb_build_object('diario', p_deposit_daily, 'semanal', p_deposit_weekly, 'mensal', p_deposit_monthly));
    return jsonb_build_object('ok', true, 'pending', true, 'effective_at', now() + interval '24 hours');
  end if;
  update bet_limits set deposit_daily = p_deposit_daily, deposit_weekly = p_deposit_weekly, deposit_monthly = p_deposit_monthly, pending_limits = null, pending_effective_at = null, updated_at = now() where user_id = uid;
  perform public.comp__audit('rg_limites', uid::text, jsonb_build_object('diario', p_deposit_daily, 'semanal', p_deposit_weekly, 'mensal', p_deposit_monthly));
  return jsonb_build_object('ok', true, 'pending', false);
end $$;

create or replace function public.comp__apply_pending_limits(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update bet_limits set deposit_daily = (pending_limits->>'deposit_daily')::integer, deposit_weekly = (pending_limits->>'deposit_weekly')::integer,
    deposit_monthly = (pending_limits->>'deposit_monthly')::integer, pending_limits = null, pending_effective_at = null, updated_at = now()
  where user_id = p_user and pending_limits is not null and pending_effective_at <= now();
end $$;

create or replace function public.comp_rg_cool_off(p_hours integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u timestamptz;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  if p_hours not in (24, 72, 168, 720) then return public.comp__err('HOURS'); end if;
  u := now() + make_interval(hours => p_hours);
  insert into bet_limits (user_id, cool_off_until) values (uid, u)
    on conflict (user_id) do update set cool_off_until = greatest(coalesce(bet_limits.cool_off_until, u), u), updated_at = now();
  perform public.comp__audit('rg_pausa', uid::text, jsonb_build_object('horas', p_hours));
  return jsonb_build_object('ok', true, 'until', (select cool_off_until from bet_limits where user_id = uid));
end $$;

-- 2. Equipas -----------------------------------------------------------------------------------------------
-- Nota: core_teams (AI CORE) é específico de Free Fire e ligado a core_players; bet_teams é só o nome para odds.
-- comp_teams é a equipa da plataforma (utilizadores reais), com ligação opcional às outras duas.
create table if not exists public.comp_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 3 and 40),
  tag text check (tag is null or tag ~ '^[A-Z0-9]{2,6}$'),
  game text not null check (game in ('Free Fire','eFootball','PUBG Mobile','Call of Duty Mobile','Mobile Legends','FIFA / FC Mobile','Clash Royale','DLS','Outro')),
  province text,
  bio text not null default '' check (char_length(bio) <= 500),
  logo_url text,
  captain_id uuid not null references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'ativa' check (status in ('ativa','suspensa','dissolvida')),
  rating numeric(8,2) not null default 1500,
  played integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  core_team_id uuid,
  bet_team_id uuid references public.bet_teams(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comp_teams_logo check (logo_url is null or logo_url ~ ('/storage/v1/object/public/media/teams/'))
);
create unique index if not exists comp_teams_name_uq on public.comp_teams (lower(btrim(name)));
create index if not exists comp_teams_rank_idx on public.comp_teams (game, rating desc) where status = 'ativa';
create index if not exists comp_teams_search_idx on public.comp_teams (lower(name) text_pattern_ops);

create table if not exists public.comp_team_members (
  team_id uuid not null references public.comp_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'membro' check (role in ('capitao','vice','membro')),
  can_manage_challenges boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (team_id, user_id)
);
create index if not exists comp_team_members_user_idx on public.comp_team_members (user_id) where left_at is null;
create unique index if not exists comp_team_one_captain on public.comp_team_members (team_id) where role = 'capitao' and left_at is null;

create table if not exists public.comp_team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.comp_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente','aceite','recusado','cancelado','expirado')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists comp_team_invites_open_uq on public.comp_team_invites (team_id, user_id) where status = 'pendente';
create index if not exists comp_team_invites_user_idx on public.comp_team_invites (user_id, status);

create or replace function public.comp__is_member(p_team uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from comp_team_members where team_id = p_team and user_id = p_user and left_at is null) $$;
create or replace function public.comp__can_manage(p_team uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from comp_team_members m join comp_teams t on t.id = m.team_id
    where m.team_id = p_team and m.user_id = p_user and m.left_at is null and t.status = 'ativa'
      and (m.role = 'capitao' or (m.role = 'vice' and m.can_manage_challenges))) $$;
create or replace function public.comp__members_count(p_team uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from comp_team_members where team_id = p_team and left_at is null $$;

create or replace function public.comp_team_create(p_name text, p_tag text, p_game text, p_province text, p_bio text, p_logo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); tid uuid; lg text := nullif(btrim(coalesce(p_logo, '')), ''); tg text := nullif(upper(btrim(coalesce(p_tag, ''))), '');
begin
  if uid is null or not public.is_active_user() then return public.comp__err('AUTH'); end if;
  if not public.comp__rate('team_create:' || uid, 3, 86400) then return public.comp__err('RATE'); end if;
  if char_length(btrim(coalesce(p_name, ''))) < 3 or char_length(btrim(p_name)) > 40 then return public.comp__err('NAME'); end if;
  if tg is not null and tg !~ '^[A-Z0-9]{2,6}$' then return public.comp__err('TAG'); end if;
  if lg is not null and lg !~ ('/storage/v1/object/public/media/teams/' || uid::text || '/') then return public.comp__err('LOGO'); end if;
  if exists (select 1 from comp_teams where lower(btrim(name)) = lower(btrim(p_name))) then return public.comp__err('NAME_TAKEN'); end if;
  if exists (select 1 from comp_team_members m join comp_teams t on t.id = m.team_id where m.user_id = uid and m.left_at is null and t.game = p_game and t.status = 'ativa') then
    return public.comp__err('ALREADY_IN_GAME'); end if;
  begin
    insert into comp_teams (name, tag, game, province, bio, logo_url, captain_id, created_by)
      values (btrim(p_name), tg, p_game, nullif(p_province, ''), left(coalesce(p_bio, ''), 500), lg, uid, uid) returning id into tid;
  exception when check_violation then return public.comp__err('INVALID'); when unique_violation then return public.comp__err('NAME_TAKEN');
  end;
  insert into comp_team_members (team_id, user_id, role, can_manage_challenges) values (tid, uid, 'capitao', true);
  perform public.comp__audit('equipa_criada', tid::text, jsonb_build_object('nome', btrim(p_name), 'jogo', p_game));
  return jsonb_build_object('ok', true, 'team_id', tid);
end $$;

create or replace function public.comp_team_update(p_team uuid, p_bio text, p_province text, p_logo text, p_tag text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); lg text := nullif(btrim(coalesce(p_logo, '')), ''); tg text := nullif(upper(btrim(coalesce(p_tag, ''))), '');
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  if not exists (select 1 from comp_team_members where team_id = p_team and user_id = uid and role = 'capitao' and left_at is null) then return public.comp__err('FORBIDDEN'); end if;
  if lg is not null and lg !~ ('/storage/v1/object/public/media/teams/' || uid::text || '/') and lg is distinct from (select logo_url from comp_teams where id = p_team) then return public.comp__err('LOGO'); end if;
  if tg is not null and tg !~ '^[A-Z0-9]{2,6}$' then return public.comp__err('TAG'); end if;
  update comp_teams set bio = left(coalesce(p_bio, ''), 500), province = nullif(p_province, ''), logo_url = lg, tag = tg, updated_at = now() where id = p_team;
  perform public.comp__audit('equipa_editada', p_team::text, '{}');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.comp_team_invite(p_team uuid, p_handle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); target uuid; t comp_teams; iid uuid; mx integer;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  select * into t from comp_teams where id = p_team;
  if t.id is null or t.status <> 'ativa' then return public.comp__err('TEAM'); end if;
  if not exists (select 1 from comp_team_members where team_id = p_team and user_id = uid and role in ('capitao','vice') and left_at is null) then return public.comp__err('FORBIDDEN'); end if;
  if not public.comp__rate('invite:' || uid, 30, 86400) then return public.comp__err('RATE'); end if;
  select id into target from profiles where lower(handle) = lower(btrim(ltrim(coalesce(p_handle, ''), '@'))) and not banned and deleted_at is null;
  if target is null then return public.comp__err('USER'); end if;
  if public.comp__is_member(p_team, target) then return public.comp__err('ALREADY_MEMBER'); end if;
  select max_team_members into mx from comp_settings where id = 1;
  if public.comp__members_count(p_team) >= mx then return public.comp__err('TEAM_FULL'); end if;
  if exists (select 1 from blocks where user_id = target and (blocked = uid::text or lower(blocked) = lower((select handle from profiles where id = uid)))) then return public.comp__err('USER'); end if;
  insert into comp_team_invites (team_id, user_id, invited_by) values (p_team, target, uid) on conflict do nothing returning id into iid;
  if iid is null then return public.comp__err('ALREADY_INVITED'); end if;
  perform public.comp__notify(target, 'torneio', '👥 Convite para a equipa ' || t.name, '/equipas/equipa?id=' || p_team::text);
  perform public.comp__audit('convite_enviado', p_team::text, jsonb_build_object('utilizador', target));
  return jsonb_build_object('ok', true, 'invite_id', iid);
end $$;

create or replace function public.comp_invite_respond(p_invite uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); i comp_team_invites; t comp_teams; mx integer;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  select * into i from comp_team_invites where id = p_invite for update;
  if i.id is null or i.user_id <> uid then return public.comp__err('NOT_FOUND'); end if;
  if i.status <> 'pendente' then return public.comp__err('INVITE_CLOSED'); end if;
  if i.created_at < now() - interval '14 days' then update comp_team_invites set status = 'expirado', responded_at = now() where id = i.id; return public.comp__err('INVITE_CLOSED'); end if;
  select * into t from comp_teams where id = i.team_id for update;
  if not p_accept then
    update comp_team_invites set status = 'recusado', responded_at = now() where id = i.id;
    return jsonb_build_object('ok', true);
  end if;
  if t.status <> 'ativa' then return public.comp__err('TEAM'); end if;
  if exists (select 1 from comp_team_members m join comp_teams x on x.id = m.team_id where m.user_id = uid and m.left_at is null and x.game = t.game and x.status = 'ativa' and x.id <> t.id) then
    return public.comp__err('ALREADY_IN_GAME'); end if;
  select max_team_members into mx from comp_settings where id = 1;
  if public.comp__members_count(t.id) >= mx then return public.comp__err('TEAM_FULL'); end if;
  insert into comp_team_members (team_id, user_id, role) values (t.id, uid, 'membro')
    on conflict (team_id, user_id) do update set left_at = null, role = 'membro', can_manage_challenges = false, joined_at = now();
  update comp_team_invites set status = 'aceite', responded_at = now() where id = i.id;
  perform public.comp__notify(t.captain_id, 'torneio', '✅ Novo membro na equipa ' || t.name, '/equipas/equipa?id=' || t.id::text);
  perform public.comp__audit('convite_aceite', t.id::text, '{}');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.comp_invite_cancel(p_invite uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i comp_team_invites;
begin
  select * into i from comp_team_invites where id = p_invite;
  if i.id is null or not exists (select 1 from comp_team_members where team_id = i.team_id and user_id = auth.uid() and role in ('capitao','vice') and left_at is null) then return public.comp__err('FORBIDDEN'); end if;
  update comp_team_invites set status = 'cancelado', responded_at = now() where id = p_invite and status = 'pendente';
  return jsonb_build_object('ok', true);
end $$;

-- Gerir membros: papel (capitao = transferir capitania), permissão de desafios, remover
create or replace function public.comp_team_member_action(p_team uuid, p_user uuid, p_action text, p_value boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t comp_teams;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  select * into t from comp_teams where id = p_team for update;
  if t.id is null then return public.comp__err('TEAM'); end if;
  if p_action = 'sair' then
    if p_user <> uid or not public.comp__is_member(p_team, uid) then return public.comp__err('FORBIDDEN'); end if;
    if t.captain_id = uid and public.comp__members_count(p_team) > 1 then return public.comp__err('CAPTAIN_MUST_TRANSFER'); end if;
    update comp_team_members set left_at = now() where team_id = p_team and user_id = uid;
    if t.captain_id = uid then update comp_teams set status = 'dissolvida', updated_at = now() where id = p_team; end if;
    perform public.comp__audit('membro_saiu', p_team::text, '{}');
    return jsonb_build_object('ok', true);
  end if;
  if t.captain_id <> uid then return public.comp__err('FORBIDDEN'); end if;
  if not public.comp__is_member(p_team, p_user) or p_user = uid then return public.comp__err('MEMBER'); end if;
  if p_action = 'remover' then
    if exists (select 1 from comp_challenges c where (c.challenger_team_id = p_team or c.opponent_team_id = p_team) and c.status in ('IN_PROGRESS','PENDING_RESULT')) then return public.comp__err('IN_MATCH'); end if;
    update comp_team_members set left_at = now() where team_id = p_team and user_id = p_user;
    perform public.comp__notify(p_user, 'torneio', 'Saíste da equipa ' || t.name, '/equipas');
  elsif p_action = 'vice' then
    update comp_team_members set role = case when coalesce(p_value, true) then 'vice' else 'membro' end, can_manage_challenges = coalesce(p_value, true) and can_manage_challenges where team_id = p_team and user_id = p_user;
  elsif p_action = 'gerir_desafios' then
    update comp_team_members set can_manage_challenges = coalesce(p_value, false) where team_id = p_team and user_id = p_user and role = 'vice';
  elsif p_action = 'capitao' then
    update comp_team_members set role = 'membro', can_manage_challenges = false where team_id = p_team and user_id = uid;
    update comp_team_members set role = 'capitao', can_manage_challenges = true where team_id = p_team and user_id = p_user;
    update comp_teams set captain_id = p_user, updated_at = now() where id = p_team;
    perform public.comp__notify(p_user, 'torneio', '©️ És agora capitão da equipa ' || t.name, '/equipas/equipa?id=' || p_team::text);
  else return public.comp__err('ACTION'); end if;
  perform public.comp__audit('membro_' || p_action, p_team::text, jsonb_build_object('utilizador', p_user, 'valor', p_value));
  return jsonb_build_object('ok', true);
end $$;

-- 3. Desafios + máquina de estados -----------------------------------------------------------------------
create or replace function public.comp__can_transition(f text, t text) returns boolean language sql immutable as $$
  select (f, t) in (
    ('DRAFT','OPEN'), ('DRAFT','PENDING_ACCEPTANCE'), ('DRAFT','CANCELLED'),
    ('OPEN','ACCEPTED'), ('OPEN','CANCELLED'),
    ('PENDING_ACCEPTANCE','ACCEPTED'), ('PENDING_ACCEPTANCE','CANCELLED'),
    ('ACCEPTED','SCHEDULED'), ('ACCEPTED','CANCELLED'),
    ('SCHEDULED','IN_PROGRESS'), ('SCHEDULED','CANCELLED'),
    ('IN_PROGRESS','PENDING_RESULT'), ('IN_PROGRESS','UNDER_REVIEW'), ('IN_PROGRESS','CANCELLED'),
    ('PENDING_RESULT','COMPLETED'), ('PENDING_RESULT','DISPUTED'), ('PENDING_RESULT','UNDER_REVIEW'),
    ('UNDER_REVIEW','COMPLETED'), ('UNDER_REVIEW','DISPUTED'), ('UNDER_REVIEW','CANCELLED'),
    ('DISPUTED','UNDER_REVIEW'), ('DISPUTED','COMPLETED'), ('DISPUTED','CANCELLED')) $$;

create table if not exists public.comp_challenges (
  id uuid primary key default gen_random_uuid(),
  game text not null,
  challenger_team_id uuid not null references public.comp_teams(id) on delete restrict,
  opponent_team_id uuid references public.comp_teams(id) on delete restrict,
  status text not null default 'DRAFT' check (status in ('DRAFT','OPEN','PENDING_ACCEPTANCE','ACCEPTED','SCHEDULED','IN_PROGRESS','PENDING_RESULT','UNDER_REVIEW','COMPLETED','CANCELLED','DISPUTED')),
  title text not null default '' check (char_length(title) <= 80),
  rules text not null default '' check (char_length(rules) <= 2000),
  players_per_team integer not null default 1 check (players_per_team between 1 and 11),
  best_of integer not null default 1 check (best_of in (1,3,5,7)),
  scheduled_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  started_at timestamptz,
  first_result_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  challenger_score integer check (challenger_score >= 0),
  opponent_score integer check (opponent_score >= 0),
  winner_team_id uuid references public.comp_teams(id),
  result_source text check (result_source in ('acordo','admin')),
  result_verified_by uuid references public.profiles(id),
  result_verified_at timestamptz,
  predictions_enabled boolean not null default true,
  bet_match_id uuid references public.bet_matches(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comp_challenges_teams check (opponent_team_id is null or opponent_team_id <> challenger_team_id)
);
create index if not exists comp_challenges_status_idx on public.comp_challenges (status, scheduled_at);
create index if not exists comp_challenges_ch_idx on public.comp_challenges (challenger_team_id, created_at desc);
create index if not exists comp_challenges_op_idx on public.comp_challenges (opponent_team_id, created_at desc);
alter table public.bet_matches add column if not exists challenge_id uuid;
create unique index if not exists bet_matches_challenge_uq on public.bet_matches (challenge_id) where challenge_id is not null;

create table if not exists public.comp_challenge_events (
  id bigint generated always as identity primary key,
  challenge_id uuid not null references public.comp_challenges(id) on delete restrict,
  from_status text,
  to_status text,
  action text not null,
  actor_id uuid default auth.uid(),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists comp_challenge_events_idx on public.comp_challenge_events (challenge_id, id);
drop trigger if exists comp_challenge_events_immutable on public.comp_challenge_events;
create trigger comp_challenge_events_immutable before update or delete on public.comp_challenge_events for each row execute function public.comp__tg_immutable();

create table if not exists public.comp_result_submissions (
  challenge_id uuid not null references public.comp_challenges(id) on delete restrict,
  team_id uuid not null references public.comp_teams(id) on delete restrict,
  challenger_score integer not null check (challenger_score >= 0 and challenger_score <= 999),
  opponent_score integer not null check (opponent_score >= 0 and opponent_score <= 999),
  proof_urls text[] not null default '{}',
  submitted_by uuid not null default auth.uid(),
  submitted_at timestamptz not null default now(),
  primary key (challenge_id, team_id)
);
drop trigger if exists comp_results_immutable on public.comp_result_submissions;
create trigger comp_results_immutable before update or delete on public.comp_result_submissions for each row execute function public.comp__tg_immutable();

create table if not exists public.comp_disputes (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.comp_challenges(id) on delete restrict,
  opened_by uuid default auth.uid(),
  team_id uuid references public.comp_teams(id),
  reason text not null check (char_length(reason) between 5 and 1000),
  evidence_urls text[] not null default '{}',
  status text not null default 'aberta' check (status in ('aberta','em_analise','resolvida','anulada')),
  resolution text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists comp_disputes_status_idx on public.comp_disputes (status, created_at);
create unique index if not exists comp_disputes_open_uq on public.comp_disputes (challenge_id) where status in ('aberta','em_analise');

create table if not exists public.comp_predictions (
  challenge_id uuid not null references public.comp_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pick text not null check (pick in ('challenger','draw','opponent')),
  correct boolean,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

-- Trigger: impõe a máquina de estados e campos imutáveis (vale também para o admin e funções internas)
create or replace function public.comp__tg_challenge_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then raise exception 'COMP_TRANSITION: um desafio nasce em DRAFT'; end if;
    return new;
  end if;
  if old.status in ('COMPLETED','CANCELLED') then
    -- terminal: só a verificação do resultado (admin) e a ligação ao mercado podem mudar
    if (new.status, new.challenger_score, new.opponent_score, new.winner_team_id, new.opponent_team_id, new.scheduled_at) is distinct from
       (old.status, old.challenger_score, old.opponent_score, old.winner_team_id, old.opponent_team_id, old.scheduled_at) then
      raise exception 'COMP_TERMINAL: desafio %', old.status;
    end if;
  end if;
  if new.status <> old.status and not public.comp__can_transition(old.status, new.status) then
    raise exception 'COMP_TRANSITION: % -> % não permitido', old.status, new.status;
  end if;
  if (new.id, new.created_by, new.challenger_team_id, new.game, new.created_at) is distinct from (old.id, old.created_by, old.challenger_team_id, old.game, old.created_at) then
    raise exception 'COMP_IMMUTABLE: campos de origem do desafio';
  end if;
  if new.opponent_team_id is distinct from old.opponent_team_id and not (old.status in ('DRAFT','OPEN') and old.opponent_team_id is null) then
    raise exception 'COMP_IMMUTABLE: adversário';
  end if;
  if (new.challenger_score is distinct from old.challenger_score or new.opponent_score is distinct from old.opponent_score or new.winner_team_id is distinct from old.winner_team_id)
     and new.status <> 'COMPLETED' then
    raise exception 'COMP_IMMUTABLE: resultado só ao concluir';
  end if;
  if new.scheduled_at is distinct from old.scheduled_at and old.status not in ('DRAFT','OPEN','PENDING_ACCEPTANCE','ACCEPTED') then
    raise exception 'COMP_IMMUTABLE: data só antes de agendar';
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;
drop trigger if exists comp_challenge_guard on public.comp_challenges;
create trigger comp_challenge_guard before insert or update on public.comp_challenges for each row execute function public.comp__tg_challenge_guard();

create or replace function public.comp__tg_challenge_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into comp_challenge_events (challenge_id, from_status, to_status, action, details)
    values (new.id, case when tg_op = 'INSERT' then null else old.status end, new.status,
            coalesce(nullif(current_setting('comp.action', true), ''), case when tg_op = 'INSERT' then 'criar' else 'estado' end),
            coalesce(nullif(current_setting('comp.details', true), '')::jsonb, '{}'));
  end if;
  return null;
end $$;
drop trigger if exists comp_challenge_log on public.comp_challenges;
create trigger comp_challenge_log after insert or update on public.comp_challenges for each row execute function public.comp__tg_challenge_log();

create or replace function public.comp__ctx(p_action text, p_details jsonb default '{}') returns void language sql as $$
  select set_config('comp.action', p_action, true), set_config('comp.details', coalesce(p_details, '{}')::text, true); $$;

-- Evento manual no histórico (sem mudança de estado)
create or replace function public.comp__event(p_ch uuid, p_action text, p_details jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  insert into comp_challenge_events (challenge_id, from_status, to_status, action, details)
  select id, status, status, p_action, coalesce(p_details, '{}') from comp_challenges where id = p_ch $$;

create or replace function public.comp__notify_team(p_team uuid, p_body text, p_href text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from comp_team_members where team_id = p_team and left_at is null loop perform public.comp__notify(u, 'torneio', p_body, p_href); end loop;
end $$;

-- Regras de cancelamento (espelhadas em lib/competitive.ts → cancelAllowed)
create or replace function public.comp__cancel_allowed(p_status text, p_side text, p_scheduled timestamptz, p_window_hours integer, p_now timestamptz default now()) returns boolean
language sql immutable as $$
  select case
    when p_side = 'admin' then p_status not in ('COMPLETED','CANCELLED')
    when p_status in ('DRAFT','OPEN','PENDING_ACCEPTANCE') then p_side = 'challenger'
    when p_status in ('ACCEPTED','SCHEDULED') then p_side in ('challenger','opponent') and (p_scheduled is null or p_scheduled - make_interval(hours => p_window_hours) > p_now)
    else false end $$;

create or replace function public.comp__proofs_ok(p_urls text[], p_user uuid) returns boolean language sql immutable as $$
  select coalesce(array_length(p_urls, 1), 0) <= 5 and not exists (select 1 from unnest(coalesce(p_urls, '{}')) u where u !~ ('/storage/v1/object/public/media/proofs/' || p_user::text || '/')) $$;

create or replace function public.comp_challenge_create(p_team uuid, p_opponent uuid, p_title text, p_rules text, p_players integer, p_best_of integer,
  p_scheduled_at timestamptz, p_publish boolean default true, p_idem text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t comp_teams; o comp_teams; cid uuid; prev jsonb; r jsonb;
begin
  if uid is null or not public.is_active_user() then return public.comp__err('AUTH'); end if;
  prev := public.comp__idem_get(p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  select * into t from comp_teams where id = p_team;
  if t.id is null or t.status <> 'ativa' then return public.comp__err('TEAM'); end if;
  if not public.comp__can_manage(p_team, uid) then return public.comp__err('FORBIDDEN'); end if;
  if not public.comp__rate('challenge_create:' || uid, 10, 86400) then return public.comp__err('RATE'); end if;
  if coalesce(p_players, 0) < 1 or p_players > 11 then return public.comp__err('PLAYERS'); end if;
  if public.comp__members_count(p_team) < p_players then return public.comp__err('NOT_ENOUGH_PLAYERS'); end if;
  if p_scheduled_at is not null and (p_scheduled_at < now() + interval '30 minutes' or p_scheduled_at > now() + interval '90 days') then return public.comp__err('DATE'); end if;
  if p_opponent is not null then
    select * into o from comp_teams where id = p_opponent;
    if o.id is null or o.status <> 'ativa' or o.id = t.id then return public.comp__err('OPPONENT'); end if;
    if o.game <> t.game then return public.comp__err('GAME_MISMATCH'); end if;
    if exists (select 1 from comp_team_members a join comp_team_members b on a.user_id = b.user_id where a.team_id = t.id and b.team_id = o.id and a.left_at is null and b.left_at is null) then
      return public.comp__err('SHARED_MEMBERS'); end if;
  end if;
  perform public.comp__ctx('criar', jsonb_build_object('equipa', t.name));
  insert into comp_challenges (game, challenger_team_id, opponent_team_id, title, rules, players_per_team, best_of, scheduled_at, created_by)
    values (t.game, t.id, p_opponent, left(coalesce(p_title, ''), 80), left(coalesce(p_rules, ''), 2000), p_players, coalesce(p_best_of, 1), p_scheduled_at, uid) returning id into cid;
  if coalesce(p_publish, true) then
    if p_opponent is null then
      perform public.comp__ctx('publicar_aberto');
      update comp_challenges set status = 'OPEN' where id = cid;
    else
      perform public.comp__ctx('enviar_desafio', jsonb_build_object('adversario', o.name));
      update comp_challenges set status = 'PENDING_ACCEPTANCE' where id = cid;
      perform public.comp__notify_team(o.id, '⚔️ ' || t.name || ' desafiou a tua equipa', '/desafios/evento?id=' || cid::text);
    end if;
  end if;
  perform public.comp__audit('desafio_criado', cid::text, jsonb_build_object('equipa', t.id, 'adversario', p_opponent));
  r := jsonb_build_object('ok', true, 'challenge_id', cid);
  return public.comp__idem_put(p_idem, 'challenge_create', r);
end $$;

create or replace function public.comp_challenge_publish(p_id uuid, p_opponent uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c comp_challenges; o comp_teams;
begin
  select * into c from comp_challenges where id = p_id for update;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  if not public.comp__can_manage(c.challenger_team_id) then return public.comp__err('FORBIDDEN'); end if;
  if c.status <> 'DRAFT' then return public.comp__err('STATE'); end if;
  if coalesce(p_opponent, c.opponent_team_id) is null then
    perform public.comp__ctx('publicar_aberto'); update comp_challenges set status = 'OPEN' where id = p_id;
  else
    select * into o from comp_teams where id = coalesce(p_opponent, c.opponent_team_id);
    if o.id is null or o.status <> 'ativa' or o.id = c.challenger_team_id or o.game <> c.game then return public.comp__err('OPPONENT'); end if;
    perform public.comp__ctx('enviar_desafio', jsonb_build_object('adversario', o.name));
    update comp_challenges set opponent_team_id = o.id, status = 'PENDING_ACCEPTANCE' where id = p_id;
    perform public.comp__notify_team(o.id, '⚔️ Recebeste um desafio', '/desafios/evento?id=' || p_id::text);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Aceitar / recusar (desafio direto) ou aceitar um desafio aberto com a minha equipa (p_team)
create or replace function public.comp_challenge_respond(p_id uuid, p_accept boolean, p_team uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c comp_challenges; my uuid; o comp_teams;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  select * into c from comp_challenges where id = p_id for update;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  if c.status = 'PENDING_ACCEPTANCE' then
    my := c.opponent_team_id;
    if not public.comp__can_manage(my, uid) then return public.comp__err('FORBIDDEN'); end if;
    if not p_accept then
      perform public.comp__ctx('recusar', jsonb_build_object('motivo', left(coalesce(p_reason, ''), 300)));
      update comp_challenges set status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Recusado: ' || left(coalesce(p_reason, ''), 200) where id = p_id;
      perform public.comp__notify_team(c.challenger_team_id, '❌ O teu desafio foi recusado', '/desafios/evento?id=' || p_id::text);
      return jsonb_build_object('ok', true, 'status', 'CANCELLED');
    end if;
  elsif c.status = 'OPEN' then
    if not p_accept then return public.comp__err('STATE'); end if;
    my := p_team;
    select * into o from comp_teams where id = my;
    if o.id is null or o.status <> 'ativa' or o.game <> c.game or o.id = c.challenger_team_id then return public.comp__err('OPPONENT'); end if;
    if not public.comp__can_manage(my, uid) then return public.comp__err('FORBIDDEN'); end if;
    if public.comp__is_member(c.challenger_team_id, uid) then return public.comp__err('SHARED_MEMBERS'); end if;
    if exists (select 1 from comp_team_members a join comp_team_members b on a.user_id = b.user_id where a.team_id = c.challenger_team_id and b.team_id = my and a.left_at is null and b.left_at is null) then
      return public.comp__err('SHARED_MEMBERS'); end if;
  else return public.comp__err('STATE'); end if;
  if public.comp__members_count(my) < c.players_per_team then return public.comp__err('NOT_ENOUGH_PLAYERS'); end if;
  if c.scheduled_at is not null and c.scheduled_at <= now() then return public.comp__err('DATE'); end if;
  perform public.comp__ctx('aceitar', jsonb_build_object('equipa', my));
  update comp_challenges set opponent_team_id = my, status = 'ACCEPTED', accepted_at = now() where id = p_id;
  if c.scheduled_at is not null then
    perform public.comp__ctx('agendar', jsonb_build_object('data', c.scheduled_at));
    update comp_challenges set status = 'SCHEDULED' where id = p_id;
  end if;
  perform public.comp__notify_team(c.challenger_team_id, '✅ Desafio aceite', '/desafios/evento?id=' || p_id::text);
  perform public.comp__audit('desafio_aceite', p_id::text, jsonb_build_object('equipa', my));
  return jsonb_build_object('ok', true, 'status', (select status from comp_challenges where id = p_id));
end $$;

create or replace function public.comp_challenge_schedule(p_id uuid, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c comp_challenges;
begin
  select * into c from comp_challenges where id = p_id for update;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  if not (public.comp__can_manage(c.challenger_team_id) or public.comp__can_manage(c.opponent_team_id)) then return public.comp__err('FORBIDDEN'); end if;
  if c.status <> 'ACCEPTED' then return public.comp__err('STATE'); end if;
  if p_at is null or p_at < now() + interval '30 minutes' or p_at > now() + interval '90 days' then return public.comp__err('DATE'); end if;
  perform public.comp__ctx('agendar', jsonb_build_object('data', p_at));
  update comp_challenges set scheduled_at = p_at where id = p_id;
  update comp_challenges set status = 'SCHEDULED' where id = p_id;
  perform public.comp__notify_team(case when public.comp__is_member(c.challenger_team_id) then c.opponent_team_id else c.challenger_team_id end, '📅 Desafio agendado', '/desafios/evento?id=' || p_id::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.comp_challenge_start(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c comp_challenges;
begin
  select * into c from comp_challenges where id = p_id for update;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  if not (public.comp__can_manage(c.challenger_team_id) or public.comp__can_manage(c.opponent_team_id) or public.is_admin()) then return public.comp__err('FORBIDDEN'); end if;
  if c.status <> 'SCHEDULED' then return public.comp__err('STATE'); end if;
  if c.scheduled_at > now() + interval '15 minutes' then return public.comp__err('TOO_EARLY'); end if;
  perform public.comp__ctx('iniciar');
  update comp_challenges set status = 'IN_PROGRESS', started_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Liquidação: estatísticas das equipas (Elo, k=32), previsões grátis e, se houver mercado e resultado VALIDADO, apostas.
create or replace function public.comp__finish(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c comp_challenges; ta comp_teams; tb comp_teams; e double precision; sc double precision; d numeric; v_pick text;
begin
  select * into c from comp_challenges where id = p_id;
  if c.status <> 'COMPLETED' then return; end if;
  select * into ta from comp_teams where id = c.challenger_team_id for update;
  select * into tb from comp_teams where id = c.opponent_team_id for update;
  e := 1.0 / (1.0 + power(10.0::double precision, (tb.rating - ta.rating)::double precision / 400.0));
  sc := case when c.challenger_score > c.opponent_score then 1 when c.challenger_score = c.opponent_score then 0.5 else 0 end;
  d := round((32 * (sc - e))::numeric, 2);
  update comp_teams set rating = rating + d, played = played + 1, wins = wins + (sc = 1)::int, draws = draws + (sc = 0.5)::int, losses = losses + (sc = 0)::int, updated_at = now() where id = ta.id;
  update comp_teams set rating = rating - d, played = played + 1, wins = wins + (sc = 0)::int, draws = draws + (sc = 0.5)::int, losses = losses + (sc = 1)::int, updated_at = now() where id = tb.id;
  v_pick := case when sc = 1 then 'challenger' when sc = 0.5 then 'draw' else 'opponent' end;
  update comp_predictions set correct = (comp_predictions.pick = v_pick) where challenge_id = p_id;
  perform public.comp__notify_team(ta.id, '🏁 Desafio concluído: ' || c.challenger_score || '-' || c.opponent_score, '/desafios/evento?id=' || p_id::text);
  perform public.comp__notify_team(tb.id, '🏁 Desafio concluído: ' || c.challenger_score || '-' || c.opponent_score, '/desafios/evento?id=' || p_id::text);
end $$;

create or replace function public.comp__settle_market(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c comp_challenges;
begin
  select * into c from comp_challenges where id = p_id;
  if c.bet_match_id is null then return; end if;
  if c.status = 'CANCELLED' then perform public.bets__apply_outcome(c.bet_match_id, 'void', null, null);
  elsif c.status = 'COMPLETED' and c.result_verified_at is not null then perform public.bets__apply_outcome(c.bet_match_id, 'result', c.challenger_score, c.opponent_score);
  end if;
end $$;

create or replace function public.comp_challenge_submit_result(p_id uuid, p_team uuid, p_challenger_score integer, p_opponent_score integer, p_proofs text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c comp_challenges; other comp_result_submissions; n_disputes integer;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  select * into c from comp_challenges where id = p_id for update;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  if p_team not in (c.challenger_team_id, c.opponent_team_id) or not public.comp__can_manage(p_team, uid) then return public.comp__err('FORBIDDEN'); end if;
  if c.status not in ('IN_PROGRESS','PENDING_RESULT') then return public.comp__err('STATE'); end if;
  if p_challenger_score is null or p_opponent_score is null or p_challenger_score < 0 or p_opponent_score < 0 or p_challenger_score > 999 or p_opponent_score > 999 then return public.comp__err('SCORE'); end if;
  if not public.comp__proofs_ok(p_proofs, uid) then return public.comp__err('PROOF'); end if;
  if exists (select 1 from comp_result_submissions where challenge_id = p_id and team_id = p_team) then return public.comp__err('ALREADY_SUBMITTED'); end if;
  insert into comp_result_submissions (challenge_id, team_id, challenger_score, opponent_score, proof_urls) values (p_id, p_team, p_challenger_score, p_opponent_score, coalesce(p_proofs, '{}'));
  select * into other from comp_result_submissions where challenge_id = p_id and team_id <> p_team;
  if other.challenge_id is null then
    perform public.comp__ctx('resultado_submetido', jsonb_build_object('equipa', p_team, 'resultado', p_challenger_score || '-' || p_opponent_score));
    update comp_challenges set status = 'PENDING_RESULT', first_result_at = now() where id = p_id;
    perform public.comp__notify_team(case when p_team = c.challenger_team_id then c.opponent_team_id else c.challenger_team_id end, '📝 O adversário submeteu o resultado. Confirma o teu.', '/desafios/evento?id=' || p_id::text);
    return jsonb_build_object('ok', true, 'status', 'PENDING_RESULT');
  end if;
  if other.challenger_score = p_challenger_score and other.opponent_score = p_opponent_score then
    perform public.comp__ctx('resultado_confirmado', jsonb_build_object('resultado', p_challenger_score || '-' || p_opponent_score));
    update comp_challenges set status = 'COMPLETED', completed_at = now(), challenger_score = p_challenger_score, opponent_score = p_opponent_score, result_source = 'acordo',
      winner_team_id = case when p_challenger_score > p_opponent_score then c.challenger_team_id when p_challenger_score < p_opponent_score then c.opponent_team_id else null end
    where id = p_id;
    perform public.comp__finish(p_id);
    return jsonb_build_object('ok', true, 'status', 'COMPLETED');
  end if;
  perform public.comp__ctx('resultados_divergentes', jsonb_build_object('a', other.challenger_score || '-' || other.opponent_score, 'b', p_challenger_score || '-' || p_opponent_score));
  update comp_challenges set status = 'DISPUTED' where id = p_id;
  insert into comp_disputes (challenge_id, opened_by, team_id, reason) values (p_id, uid, p_team, 'Resultados submetidos não coincidem (abertura automática).');
  select count(*) into n_disputes from comp_disputes d join comp_challenges x on x.id = d.challenge_id
    where (x.challenger_team_id = p_team or x.opponent_team_id = p_team) and d.created_at > now() - interval '30 days';
  if n_disputes >= 3 then perform public.comp__flag(uid, 'desafio', p_team::text, array['disputas_frequentes_30d'], 40); end if;
  return jsonb_build_object('ok', true, 'status', 'DISPUTED');
end $$;

create or replace function public.comp_challenge_dispute(p_id uuid, p_team uuid, p_reason text, p_evidence text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c comp_challenges; s comp_settings;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  select * into c from comp_challenges where id = p_id for update;
  select * into s from comp_settings where id = 1;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  if p_team not in (c.challenger_team_id, c.opponent_team_id) or not public.comp__can_manage(p_team, uid) then return public.comp__err('FORBIDDEN'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then return public.comp__err('REASON'); end if;
  if not public.comp__proofs_ok(p_evidence, uid) then return public.comp__err('PROOF'); end if;
  if c.status in ('DISPUTED','UNDER_REVIEW') then
    -- acrescentar provas a uma disputa já aberta
    update comp_disputes set evidence_urls = evidence_urls || coalesce(p_evidence, '{}') where challenge_id = p_id and status in ('aberta','em_analise');
    perform public.comp__event(p_id, 'provas_adicionadas', jsonb_build_object('equipa', p_team, 'n', coalesce(array_length(p_evidence, 1), 0)));
    return jsonb_build_object('ok', true);
  end if;
  if c.status = 'PENDING_RESULT' then
    insert into comp_disputes (challenge_id, opened_by, team_id, reason, evidence_urls) values (p_id, uid, p_team, left(btrim(p_reason), 1000), coalesce(p_evidence, '{}'));
    perform public.comp__ctx('disputa_aberta', jsonb_build_object('equipa', p_team));
    update comp_challenges set status = 'DISPUTED' where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'DISPUTED');
  end if;
  return public.comp__err('STATE');
end $$;

create or replace function public.comp_challenge_cancel(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c comp_challenges; side text; s comp_settings;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  select * into c from comp_challenges where id = p_id for update;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  select * into s from comp_settings where id = 1;
  side := case when public.comp__can_manage(c.challenger_team_id, uid) then 'challenger' when c.opponent_team_id is not null and public.comp__can_manage(c.opponent_team_id, uid) then 'opponent' else 'none' end;
  if not public.comp__cancel_allowed(c.status, side, c.scheduled_at, s.cancel_window_hours) then return public.comp__err('CANCEL_NOT_ALLOWED'); end if;
  perform public.comp__ctx('cancelar', jsonb_build_object('lado', side, 'motivo', left(coalesce(p_reason, ''), 300)));
  update comp_challenges set status = 'CANCELLED', cancelled_at = now(), cancel_reason = left(coalesce(p_reason, ''), 300) where id = p_id;
  perform public.comp__settle_market(p_id);
  perform public.comp__notify_team(case when side = 'challenger' then c.opponent_team_id else c.challenger_team_id end, '🚫 Desafio cancelado', '/desafios/evento?id=' || p_id::text);
  perform public.comp__audit('desafio_cancelado', p_id::text, jsonb_build_object('lado', side));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.comp_predict(p_id uuid, p_pick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c comp_challenges;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  if not coalesce((select predictions_enabled from comp_settings where id = 1), true) then return public.comp__err('PREDICTIONS_OFF'); end if;
  if p_pick not in ('challenger','draw','opponent') then return public.comp__err('PICK'); end if;
  select * into c from comp_challenges where id = p_id;
  if c.id is null or not c.predictions_enabled then return public.comp__err('NOT_FOUND'); end if;
  if c.status not in ('OPEN','PENDING_ACCEPTANCE','ACCEPTED','SCHEDULED') or (c.scheduled_at is not null and c.scheduled_at <= now()) then return public.comp__err('CLOSED'); end if;
  if not public.comp__rate('predict:' || uid, 60, 3600) then return public.comp__err('RATE'); end if;
  insert into comp_predictions (challenge_id, user_id, pick) values (p_id, uid, p_pick)
    on conflict (challenge_id, user_id) do update set pick = excluded.pick, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Relógio: corre a cada 5 min (pg_cron) e ao abrir as páginas. Idempotente.
create or replace function public.comp_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c comp_challenges; s comp_settings; n integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('comp_sweep', 0)) then return jsonb_build_object('skipped', true); end if;
  select * into s from comp_settings where id = 1;
  for c in select * from comp_challenges where status in ('OPEN','PENDING_ACCEPTANCE','SCHEDULED','IN_PROGRESS','PENDING_RESULT') for update skip locked loop
    if c.status in ('OPEN','PENDING_ACCEPTANCE') and ((c.scheduled_at is not null and c.scheduled_at <= now())
        or (c.status = 'PENDING_ACCEPTANCE' and c.updated_at < now() - make_interval(hours => s.acceptance_hours))) then
      perform public.comp__ctx('expirar', '{}');
      update comp_challenges set status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Expirou sem resposta' where id = c.id; n := n + 1;
    elsif c.status = 'SCHEDULED' and c.scheduled_at <= now() then
      perform public.comp__ctx('iniciar_automatico', '{}');
      update comp_challenges set status = 'IN_PROGRESS', started_at = now() where id = c.id; n := n + 1;
    elsif c.status = 'IN_PROGRESS' and c.started_at < now() - make_interval(hours => s.result_hours) then
      perform public.comp__ctx('sem_resultado', '{}');
      update comp_challenges set status = 'UNDER_REVIEW' where id = c.id; n := n + 1;
    elsif c.status = 'PENDING_RESULT' and c.first_result_at < now() - make_interval(hours => s.result_hours) then
      perform public.comp__ctx('confirmacao_em_falta', '{}');
      update comp_challenges set status = 'UNDER_REVIEW' where id = c.id; n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'changed', n);
end $$;

-- Página pública do evento (anon pode ler; DRAFT só para membros)
create or replace function public.comp_challenge_public(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c comp_challenges; ta jsonb; tb jsonb; ev jsonb; subs jsonb; pr jsonb; mine text; dis jsonb; mkt jsonb; staff boolean := public.is_admin() or public.is_mod();
  member boolean;
begin
  select * into c from comp_challenges where id = p_id;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  member := public.comp__is_member(c.challenger_team_id) or (c.opponent_team_id is not null and public.comp__is_member(c.opponent_team_id));
  if c.status = 'DRAFT' and not (member or staff) then return public.comp__err('NOT_FOUND'); end if;
  select to_jsonb(x) into ta from (select id, name, tag, game, logo_url, rating, played, wins, draws, losses from comp_teams where id = c.challenger_team_id) x;
  select to_jsonb(x) into tb from (select id, name, tag, game, logo_url, rating, played, wins, draws, losses from comp_teams where id = c.opponent_team_id) x;
  select coalesce(jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'action', e.action, 'at', e.created_at, 'details', e.details) order by e.id), '[]') into ev
    from comp_challenge_events e where e.challenge_id = p_id;
  if c.status = 'COMPLETED' or member or staff then
    select coalesce(jsonb_agg(jsonb_build_object('team_id', team_id, 'challenger_score', challenger_score, 'opponent_score', opponent_score, 'proofs', proof_urls, 'at', submitted_at)), '[]') into subs
      from comp_result_submissions where challenge_id = p_id;
  end if;
  select jsonb_build_object('challenger', count(*) filter (where pick = 'challenger'), 'draw', count(*) filter (where pick = 'draw'), 'opponent', count(*) filter (where pick = 'opponent')) into pr
    from comp_predictions where challenge_id = p_id;
  select pick into mine from comp_predictions where challenge_id = p_id and user_id = auth.uid();
  if member or staff then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'reason', reason, 'status', status, 'resolution', resolution, 'evidence', evidence_urls, 'at', created_at, 'team_id', team_id)), '[]') into dis
      from comp_disputes where challenge_id = p_id;
  end if;
  if c.bet_match_id is not null then
    select jsonb_build_object('match_id', m.id, 'status', m.status, 'starts_at', m.starts_at, 'selections',
      (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'label', s.label, 'odds', s.odds, 'market', k.title, 'market_status', k.status) order by k.kind, s.sort), '[]')
         from bet_markets k join bet_selections s on s.market_id = k.id where k.match_id = m.id and k.kind in ('1x2','12')))
      into mkt from bet_matches m where m.id = c.bet_match_id;
  end if;
  return jsonb_build_object('ok', true, 'challenge', to_jsonb(c) - 'created_by', 'challenger', ta, 'opponent', tb, 'events', ev, 'submissions', coalesce(subs, '[]'),
    'predictions', pr, 'my_prediction', mine, 'disputes', coalesce(dis, '[]'), 'market', mkt,
    'can_manage_challenger', public.comp__can_manage(c.challenger_team_id), 'can_manage_opponent', coalesce(public.comp__can_manage(c.opponent_team_id), false),
    'betting_on', public.comp__betting_on());
end $$;

create or replace function public.comp_public_profile(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; teams jsonb; hist jsonb;
begin
  select * into p from profiles where lower(handle) = lower(ltrim(coalesce(p_handle, ''), '@')) and not banned and deleted_at is null;
  if p.id is null then return public.comp__err('NOT_FOUND'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'game', t.game, 'logo_url', t.logo_url, 'role', m.role, 'rating', t.rating)), '[]') into teams
    from comp_team_members m join comp_teams t on t.id = m.team_id where m.user_id = p.id and m.left_at is null;
  select coalesce(jsonb_agg(x), '[]') into hist from (
    select c.id, c.status, c.game, c.challenger_score, c.opponent_score, c.completed_at, ta.name as challenger, tb.name as opponent
    from comp_challenges c join comp_teams ta on ta.id = c.challenger_team_id left join comp_teams tb on tb.id = c.opponent_team_id
    where c.status = 'COMPLETED' and exists (select 1 from comp_team_members m where m.user_id = p.id and m.team_id in (c.challenger_team_id, c.opponent_team_id))
    order by c.completed_at desc limit 20) x;
  return jsonb_build_object('ok', true, 'handle', p.handle, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'bio', p.bio, 'verified', p.verified,
    'main_game', p.main_game, 'province', p.province, 'teams', teams, 'history', hist);
end $$;

-- Atividade do próprio utilizador
create or replace function public.comp_my_activity() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
    (select 'desafio' as kind, e.action as action, e.challenge_id::text as ref, e.created_at as at from comp_challenge_events e where e.actor_id = auth.uid() order by e.id desc limit 50)
    union all
    (select 'auditoria', a.action, a.target, a.created_at from comp_audit a where a.actor_id = auth.uid() order by a.id desc limit 50)) x $$;

-- 4. Carteira (livro-razão existente money_ledger) ---------------------------------------------------------
alter table public.money_ledger add column if not exists entry_id uuid not null default gen_random_uuid();
alter table public.money_ledger add column if not exists idempotency_key text;
create unique index if not exists money_ledger_entry_uq on public.money_ledger (entry_id);
create unique index if not exists money_ledger_idem_uq on public.money_ledger (idempotency_key) where idempotency_key is not null;
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('plano','torneio','bilhete','moedas','loja','ad_topup','carteira','outro'));
alter table public.payments add column if not exists provider text;
alter table public.payments add column if not exists phone_masked text;
alter table public.payments add column if not exists confirmed_at timestamptz;
alter table public.payments add column if not exists failure_reason text;

-- Eventos recebidos dos fornecedores (webhooks): registo bruto para reconciliação; event_id único = sem duplicados.
create table if not exists public.comp_provider_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  payment_id text,
  provider_ref text,
  status text,
  amount integer,
  signature_ok boolean not null,
  payload_sha256 text not null,
  outcome text not null default 'recebido',
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
drop trigger if exists comp_provider_events_immutable on public.comp_provider_events;
create trigger comp_provider_events_immutable before update or delete on public.comp_provider_events for each row execute function public.comp__tg_immutable();

-- Saldo: disponível = último balance_after (o levantamento pendente já foi debitado); reservado = levantamentos pendentes + apostas MT abertas.
create or replace function public.comp_wallet_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); bal integer; res_w integer; res_b integer; l bet_limits; led jsonb; pend jsonb;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  bal := public.bets__balance_mt(uid);
  select coalesce(sum(amount), 0) into res_w from money_withdrawals where user_id = uid and status = 'pendente';
  select coalesce(sum(stake), 0) into res_b from bets where user_id = uid and currency = 'mt' and status = 'aberta';
  select * into l from bet_limits where user_id = uid;
  select coalesce(jsonb_agg(jsonb_build_object('id', entry_id, 'delta', delta, 'reason', reason, 'ref', ref, 'balance_after', balance_after, 'at', created_at) order by id desc), '[]') into led
    from (select * from money_ledger where user_id = uid order by id desc limit 100) z;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'amount', amount_mzn, 'status', status, 'method', method, 'at', created_at) order by created_at desc), '[]') into pend
    from (select * from payments where user_id = uid and kind = 'carteira' order by created_at desc limit 30) z;
  return jsonb_build_object('ok', true, 'available', bal, 'reserved', res_w + res_b, 'reserved_withdrawals', res_w, 'reserved_bets', res_b, 'total', bal + res_w + res_b,
    'ledger', led, 'deposits', pend, 'monetary_on', public.comp__monetary_on(), 'betting_on', public.comp__betting_on(), 'provider_ready', public.comp__provider_ready('mpesa'),
    'eligibility', public.comp_eligibility(uid),
    'limits', jsonb_build_object('deposit_daily', l.deposit_daily, 'deposit_weekly', l.deposit_weekly, 'deposit_monthly', l.deposit_monthly,
      'cool_off_until', l.cool_off_until, 'self_excluded_until', l.self_excluded_until, 'pending', l.pending_limits, 'pending_effective_at', l.pending_effective_at));
end $$;

-- Intenção de depósito: só cria o pedido "pendente". O crédito acontece APENAS em comp__confirm_deposit (webhook verificado).
create or replace function public.comp_wallet_deposit_intent(p_amount integer, p_method text, p_phone text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s comp_settings; el jsonb; l bet_limits; d_sum integer; w_sum integer; m_sum integer; pid text; prev jsonb; r jsonb;
  ph text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '^\+?258', '');
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  if p_idem is null or char_length(p_idem) < 16 then return public.comp__err('IDEMPOTENCY'); end if;
  prev := public.comp__idem_get(p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  if not public.comp__monetary_on() then return public.comp__err('MONETARY_OFF'); end if;
  if not public.comp__provider_ready(case when p_method = 'e-Mola' then 'emola' else 'mpesa' end) then return public.comp__err('PROVIDER_NOT_CONFIGURED'); end if;
  el := public.comp_eligibility(uid);
  if not (el->>'ok')::boolean then return public.comp__err('NOT_ELIGIBLE', jsonb_build_object('reasons', el->'reasons')); end if;
  if not public.comp__rate('deposit:' || uid, 5, 3600) then return public.comp__err('RATE'); end if;
  select * into s from comp_settings where id = 1;
  if p_amount is null or p_amount < s.deposit_min or p_amount > s.deposit_max then return public.comp__err('AMOUNT'); end if;
  if p_method not in ('M-Pesa','e-Mola') or (p_method = 'M-Pesa' and ph !~ '^8[45][0-9]{7}$') or (p_method = 'e-Mola' and ph !~ '^8[67][0-9]{7}$') then return public.comp__err('PHONE'); end if;
  perform public.comp__apply_pending_limits(uid);
  select * into l from bet_limits where user_id = uid;
  select coalesce(sum(amount_mzn) filter (where created_at >= date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo'), 0),
         coalesce(sum(amount_mzn) filter (where created_at >= date_trunc('week', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo'), 0),
         coalesce(sum(amount_mzn) filter (where created_at >= date_trunc('month', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo'), 0)
    into d_sum, w_sum, m_sum from payments where user_id = uid and kind = 'carteira' and status in ('pendente','em processamento','pago');
  if (l.deposit_daily is not null and d_sum + p_amount > l.deposit_daily) or (l.deposit_weekly is not null and w_sum + p_amount > l.deposit_weekly)
     or (l.deposit_monthly is not null and m_sum + p_amount > l.deposit_monthly) then return public.comp__err('DEPOSIT_LIMIT'); end if;
  insert into payments (user_id, user_handle, kind, item, amount_mzn, method, status, idempotency_key, provider, phone_masked)
    values (uid, (select handle from profiles where id = uid), 'carteira', 'Depósito na carteira', p_amount, p_method, 'pendente', p_idem,
            case when p_method = 'e-Mola' then 'emola' else 'mpesa' end, left(ph, 2) || '•••' || right(ph, 2)) returning id into pid;
  perform public.comp__audit('deposito_pedido', pid, jsonb_build_object('valor', p_amount, 'metodo', p_method));
  r := jsonb_build_object('ok', true, 'payment_id', pid, 'msisdn', '258' || ph);
  return public.comp__idem_put(p_idem, 'deposit_intent', r);
end $$;

-- Chamado SÓ pela Edge Function (service_role) depois de verificar a assinatura do webhook. Idempotente.
create or replace function public.comp__confirm_deposit(p_payment text, p_provider text, p_event_id text, p_provider_ref text, p_status text, p_amount integer,
  p_signature_ok boolean, p_payload_sha256 text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay payments; ev_id bigint; bal integer;
begin
  insert into comp_provider_events (provider, event_id, payment_id, provider_ref, status, amount, signature_ok, payload_sha256, outcome)
    values (p_provider, p_event_id, p_payment, p_provider_ref, p_status, p_amount, coalesce(p_signature_ok, false), coalesce(p_payload_sha256, ''),
            case when coalesce(p_signature_ok, false) then 'recebido' else 'assinatura_invalida' end)
    on conflict (provider, event_id) do nothing returning id into ev_id;
  if ev_id is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if not coalesce(p_signature_ok, false) then return public.comp__err('SIGNATURE'); end if;
  select * into pay from payments where id = p_payment for update;
  if pay.id is null or pay.kind <> 'carteira' then return public.comp__err('UNKNOWN_PAYMENT'); end if;
  if pay.status in ('pago','reembolsado') then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if p_status = 'success' then
    if p_amount is distinct from pay.amount_mzn then
      perform public.comp__flag(pay.user_id, 'deposito', pay.id, array['valor_webhook_diferente'], 90, pay.amount_mzn);
      update payments set status = 'em processamento', failure_reason = 'valor diferente do pedido' where id = pay.id;
      return public.comp__err('AMOUNT_MISMATCH');
    end if;
    if p_provider_ref is null or exists (select 1 from payments where provider_ref = p_provider_ref and id <> pay.id) then
      perform public.comp__flag(pay.user_id, 'deposito', pay.id, array['referencia_duplicada'], 90, pay.amount_mzn);
      return public.comp__err('DUP_REF');
    end if;
    update payments set status = 'pago', provider_ref = p_provider_ref, confirmed_at = now() where id = pay.id;
    bal := public.bets__post_mt(pay.user_id, pay.amount_mzn, 'deposito', p_provider || ':' || p_provider_ref);
    perform public.comp__notify(pay.user_id, 'compra', '✅ Depósito confirmado: ' || pay.amount_mzn || ' MT', '/carteira');
    insert into comp_audit (actor_id, action, target, details) values (null, 'deposito_confirmado', pay.id, jsonb_build_object('valor', pay.amount_mzn, 'ref', p_provider_ref, 'fornecedor', p_provider));
    return jsonb_build_object('ok', true, 'balance', bal);
  end if;
  update payments set status = 'falhou', failure_reason = left(coalesce(p_status, 'falhou'), 120) where id = pay.id;
  insert into comp_audit (actor_id, action, target, details) values (null, 'deposito_falhou', pay.id, jsonb_build_object('estado', p_status));
  return jsonb_build_object('ok', true, 'status', 'falhou');
end $$;

-- Lançamentos com chave de idempotência: o ledger já é idempotente por (user, reason, ref); guardamos a chave = reason:ref.
create or replace function public.comp__tg_ledger_idem() returns trigger language plpgsql as $$
begin
  if new.idempotency_key is null then new.idempotency_key := new.user_id::text || ':' || new.reason || ':' || new.ref; end if;
  return new;
end $$;
drop trigger if exists money_ledger_idem on public.money_ledger;
create trigger money_ledger_idem before insert on public.money_ledger for each row execute function public.comp__tg_ledger_idem();

-- Levantamento: exige funcionalidades monetárias, elegibilidade, PIN (tx_authorizations) e chave de idempotência.
create or replace function public.comp_wallet_withdraw(p_amount integer, p_method text, p_phone text, p_tx_token text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); el jsonb; cfg bet_settings; today_sum integer; wid uuid; a tx_authorizations; prev jsonb; r jsonb;
  ph text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '^\+?258', '');
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  if p_idem is null or char_length(p_idem) < 16 then return public.comp__err('IDEMPOTENCY'); end if;
  prev := public.comp__idem_get(p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  if not public.comp__monetary_on() then return public.comp__err('MONETARY_OFF'); end if;
  el := public.comp_eligibility(uid);
  if not (el->>'ok')::boolean then return public.comp__err('NOT_ELIGIBLE', jsonb_build_object('reasons', el->'reasons')); end if;
  if p_method not in ('M-Pesa','e-Mola') or ph !~ '^8[4-7][0-9]{7}$' then return public.comp__err('PHONE'); end if;
  perform pg_advisory_xact_lock(hashtextextended('money:' || uid::text, 0));
  update tx_authorizations set used_at = now() where token = p_tx_token and user_id = uid and purpose = 'levantamento' and amount_mzn = p_amount and used_at is null and expires_at > now() returning * into a;
  if a.token is null then return public.comp__err('PIN'); end if;
  select * into cfg from bet_settings where id = 1;
  if p_amount is null or p_amount < cfg.mt_min_withdraw then return public.comp__err('MIN_WITHDRAW'); end if;
  select coalesce(sum(amount), 0) into today_sum from money_withdrawals where user_id = uid and status <> 'recusado'
    and created_at >= date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo';
  if today_sum + p_amount > cfg.mt_max_withdraw_daily then return public.comp__err('MAX_WITHDRAW'); end if;
  if p_amount > public.bets__balance_mt(uid) then return public.comp__err('BALANCE'); end if;
  insert into money_withdrawals (user_id, amount, method, phone) values (uid, p_amount, p_method, ph) returning id into wid;
  perform public.bets__post_mt(uid, -p_amount, 'levantamento', wid::text);
  perform public.comp__audit('levantamento_pedido', wid::text, jsonb_build_object('valor', p_amount, 'metodo', p_method));
  r := jsonb_build_object('ok', true, 'id', wid, 'balance', public.bets__balance_mt(uid));
  return public.comp__idem_put(p_idem, 'withdraw', r);
end $$;

-- 5. Apostas em desafios (reutiliza o motor bets_* existente) ------------------------------------------------
-- Instantâneo imutável dos termos no momento da confirmação
create table if not exists public.comp_bet_terms (
  bet_id uuid primary key references public.bets(id) on delete restrict,
  user_id uuid not null,
  terms_version text not null,
  currency text not null,
  stake integer not null,
  total_odds numeric(14,2) not null,
  potential integer not null,
  max_payout integer not null,
  legs jsonb not null default '[]',
  confirmed_at timestamptz not null default now()
);

create or replace function public.comp__tg_bet_snapshot() returns trigger language plpgsql security definer set search_path = public as $$
declare cfg bet_settings;
begin
  select * into cfg from bet_settings where id = 1;
  insert into comp_bet_terms (bet_id, user_id, terms_version, currency, stake, total_odds, potential, max_payout)
    values (new.id, new.user_id, coalesce((select terms_version from comp_settings where id = 1), 'v1'), new.currency, new.stake, new.total_odds, new.potential,
            case when new.currency = 'mt' then cfg.mt_max_payout else cfg.max_payout end);
  return null;
end $$;
drop trigger if exists comp_bet_snapshot on public.bets;
create trigger comp_bet_snapshot after insert on public.bets for each row execute function public.comp__tg_bet_snapshot();

-- Termos confirmados não mudam: bloqueia UPDATE de stake/odds/potencial/moeda/dono (liquidação continua a poder mudar estado/pagamento)
create or replace function public.comp__tg_bet_terms_lock() returns trigger language plpgsql as $$
begin
  if (new.user_id, new.stake, new.total_odds, new.potential, new.currency, new.kind, new.created_at) is distinct from
     (old.user_id, old.stake, old.total_odds, old.potential, old.currency, old.kind, old.created_at) then
    raise exception 'COMP_TERMS_LOCKED: termos da aposta confirmada não podem mudar';
  end if;
  return new;
end $$;
drop trigger if exists comp_bet_terms_lock on public.bets;
create trigger comp_bet_terms_lock before update on public.bets for each row execute function public.comp__tg_bet_terms_lock();
create or replace function public.comp__tg_leg_terms_lock() returns trigger language plpgsql as $$
begin
  if (new.odds, new.selection_id, new.market_id, new.bet_id) is distinct from (old.odds, old.selection_id, old.market_id, old.bet_id) then
    raise exception 'COMP_TERMS_LOCKED: odds da aposta confirmada não podem mudar';
  end if;
  return new;
end $$;
drop trigger if exists comp_leg_terms_lock on public.bet_legs;
create trigger comp_leg_terms_lock before update on public.bet_legs for each row execute function public.comp__tg_leg_terms_lock();
create or replace function public.comp__tg_terms_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'COMP_IMMUTABLE: comp_bet_terms'; end if;
  -- só se podem acrescentar pernas na MESMA transação da confirmação (now() = início da transação)
  if (new.stake, new.total_odds, new.potential, new.currency, new.max_payout, new.terms_version, new.confirmed_at) is distinct from
     (old.stake, old.total_odds, old.potential, old.currency, old.max_payout, old.terms_version, old.confirmed_at) or old.confirmed_at <> now() then
    raise exception 'COMP_IMMUTABLE: comp_bet_terms';
  end if;
  return new;
end $$;
drop trigger if exists comp_terms_immutable on public.comp_bet_terms;
create trigger comp_terms_immutable before update or delete on public.comp_bet_terms for each row execute function public.comp__tg_terms_immutable();

-- Cada perna: acrescenta ao instantâneo e, se for mercado de desafio, aplica gating + antifraude (vale para QUALQUER caminho, incl. bets_place direto)
create or replace function public.comp__tg_leg_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare b bets; ch comp_challenges; el jsonb; sel bet_selections; mk bet_markets;
begin
  select * into b from bets where id = new.bet_id;
  select * into sel from bet_selections where id = new.selection_id;
  select * into mk from bet_markets where id = new.market_id;
  update comp_bet_terms set legs = legs || jsonb_build_array(jsonb_build_object('selection_id', new.selection_id, 'label', sel.label, 'market', mk.title, 'odds', new.odds))
    where bet_id = new.bet_id;
  select c.* into ch from comp_challenges c join bet_matches m on m.challenge_id = c.id where m.id = mk.match_id;
  if ch.id is null then return new; end if;
  if not public.comp__betting_on() then raise exception 'COMP_BETTING_OFF'; end if;
  if ch.status <> 'SCHEDULED' or ch.scheduled_at <= now() then raise exception 'COMP_CLOSED'; end if;
  el := public.comp_eligibility(b.user_id);
  if not (el->>'ok')::boolean then raise exception 'COMP_NOT_ELIGIBLE'; end if;
  if public.comp__is_member(ch.challenger_team_id, b.user_id) or public.comp__is_member(ch.opponent_team_id, b.user_id) then
    perform public.comp__flag(b.user_id, 'aposta', ch.id::text, array['membro_aposta_proprio_desafio'], 80, b.stake);
    raise exception 'COMP_OWN_CHALLENGE';
  end if;
  return new;
end $$;
drop trigger if exists comp_leg_guard on public.bet_legs;
create trigger comp_leg_guard after insert on public.bet_legs for each row execute function public.comp__tg_leg_guard();

-- Aposta num desafio: confirmação explícita, idempotência, limite de ritmo, alerta de valor anómalo. Usa bets_place (odds bloqueadas).
create or replace function public.comp_bet_place(p_selection uuid, p_stake integer, p_odds numeric, p_currency text, p_confirm boolean, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s comp_settings; prev jsonb; r jsonb; avg_stake numeric; el jsonb;
begin
  if uid is null then return public.comp__err('AUTH'); end if;
  if p_idem is null or char_length(p_idem) < 16 then return public.comp__err('IDEMPOTENCY'); end if;
  prev := public.comp__idem_get(p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  if not coalesce(p_confirm, false) then return public.comp__err('CONFIRM'); end if;
  if not public.comp__betting_on() then return public.comp__err('BETTING_OFF'); end if;
  if p_currency = 'mt' and not public.comp__monetary_on() then return public.comp__err('MONETARY_OFF'); end if;
  el := public.comp_eligibility(uid);
  if not (el->>'ok')::boolean then return public.comp__err('NOT_ELIGIBLE', jsonb_build_object('reasons', el->'reasons')); end if;
  select * into s from comp_settings where id = 1;
  if not public.comp__rate('bet:' || uid, s.bet_rate_per_hour, 3600) then
    perform public.comp__flag(uid, 'aposta', p_selection::text, array['ritmo_apostas'], 40, p_stake);
    return public.comp__err('RATE');
  end if;
  -- antifraude: membro de uma das equipas não aposta no próprio desafio (verificado aqui para o alerta ficar registado; o trigger bloqueia qualquer outro caminho)
  if exists (select 1 from bet_selections sl join bet_markets mk on mk.id = sl.market_id join bet_matches m on m.id = mk.match_id join comp_challenges c on c.id = m.challenge_id
             where sl.id = p_selection and (public.comp__is_member(c.challenger_team_id, uid) or public.comp__is_member(c.opponent_team_id, uid))) then
    perform public.comp__flag(uid, 'aposta', p_selection::text, array['membro_aposta_proprio_desafio'], 80, p_stake);
    return public.comp__err('COMP_OWN_CHALLENGE');
  end if;
  select avg(stake) into avg_stake from bets where user_id = uid and currency = coalesce(p_currency, 'pontos') and created_at > now() - interval '30 days';
  if avg_stake is not null and p_stake > avg_stake * 5 and p_stake >= 500 then perform public.comp__flag(uid, 'aposta', p_selection::text, array['valor_anomalo'], 30, p_stake); end if;
  begin
    r := public.bets_place(array[p_selection], p_stake, array[p_odds], false, coalesce(p_currency, 'pontos'));
  exception when raise_exception then
    return public.comp__err(split_part(sqlerrm, ':', 1));
  end;
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  perform public.comp__audit('aposta_desafio', r->>'bet_id', jsonb_build_object('stake', p_stake, 'odds', p_odds, 'moeda', p_currency));
  return public.comp__idem_put(p_idem, 'bet_place', r || jsonb_build_object('terms', (select to_jsonb(t) from comp_bet_terms t where bet_id = (r->>'bet_id')::uuid)));
end $$;

-- 6. Admin -------------------------------------------------------------------------------------------------
create or replace function public.comp__admin_strong() returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return 'FORBIDDEN'; end if;
  if not public.comp__strong_auth() then return 'MFA_REQUIRED'; end if;
  return null;
end $$;

create or replace function public.comp_admin_record_licence(p_scope text, p_authority text, p_licence_no text, p_valid_from date, p_valid_until date, p_notes text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public.comp__admin_strong(); lid uuid;
begin
  if e is not null then return public.comp__err(e); end if;
  if p_valid_from is null or p_valid_until is null or p_valid_until <= p_valid_from then return public.comp__err('DATES'); end if;
  if p_valid_until < (now() at time zone 'Africa/Maputo')::date then return public.comp__err('EXPIRED'); end if;
  begin
    insert into comp_licences (scope, authority, licence_no, valid_from, valid_until, notes) values (coalesce(p_scope, 'apostas'), btrim(p_authority), btrim(p_licence_no), p_valid_from, p_valid_until, left(coalesce(p_notes, ''), 500)) returning id into lid;
  exception when check_violation then return public.comp__err('INVALID'); end;
  perform public.comp__audit('licenca_registada', lid::text, jsonb_build_object('entidade', btrim(p_authority), 'numero', btrim(p_licence_no), 'de', p_valid_from, 'ate', p_valid_until, 'ambito', p_scope));
  return jsonb_build_object('ok', true, 'licence_id', lid);
end $$;

create or replace function public.comp_admin_revoke_licence(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public.comp__admin_strong();
begin
  if e is not null then return public.comp__err(e); end if;
  update comp_licences set revoked_at = now(), revoked_by = auth.uid() where id = p_id and revoked_at is null;
  if not found then return public.comp__err('NOT_FOUND'); end if;
  perform public.comp__audit('licenca_revogada', p_id::text, '{}');
  return jsonb_build_object('ok', true);
end $$;

-- Interruptor geral. Ligar exige "ATIVAR" + licença válida. Desligar é sempre possível (só admin + MFA). Sincroniza bet_settings (MT).
create or replace function public.comp_admin_set_flags(p_monetary boolean, p_betting boolean, p_confirm text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public.comp__admin_strong(); lic comp_licences; old comp_settings;
begin
  if e is not null then return public.comp__err(e); end if;
  select * into old from comp_settings where id = 1 for update;
  if coalesce(p_betting, false) and not coalesce(p_monetary, false) then return public.comp__err('BETTING_NEEDS_MONETARY'); end if;
  if coalesce(p_monetary, false) or coalesce(p_betting, false) then
    if upper(btrim(coalesce(p_confirm, ''))) <> 'ATIVAR' then return public.comp__err('CONFIRM'); end if;
    select * into lic from comp_licences where scope = 'apostas' and revoked_at is null
      and valid_from <= (now() at time zone 'Africa/Maputo')::date and valid_until >= (now() at time zone 'Africa/Maputo')::date order by valid_until desc limit 1;
    if lic.id is null then
      perform public.comp__audit('ativacao_recusada', 'comp_settings', jsonb_build_object('motivo', 'sem licença válida'));
      return public.comp__err('LICENCE');
    end if;
  end if;
  update comp_settings set monetary_features_enabled = coalesce(p_monetary, false), betting_enabled = coalesce(p_betting, false), updated_by = auth.uid(), updated_at = now() where id = 1;
  -- espelho no módulo de apostas existente (dinheiro real MT)
  if coalesce(p_betting, false) then
    update bet_settings set igj_licence_no = lic.licence_no, igj_licence_date = lic.valid_from, igj_licence_expiry = lic.valid_until, real_money_enabled = true, updated_at = now() where id = 1;
  else
    update bet_settings set real_money_enabled = false, updated_at = now() where id = 1;
  end if;
  perform public.comp__audit('funcionalidades_monetarias', 'comp_settings', jsonb_build_object('monetario', coalesce(p_monetary, false), 'apostas', coalesce(p_betting, false),
    'antes', jsonb_build_object('monetario', old.monetary_features_enabled, 'apostas', old.betting_enabled), 'licenca', lic.licence_no));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.comp_admin_save_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return public.comp__err('FORBIDDEN'); end if;
  begin
    update comp_settings set
      predictions_enabled = coalesce((p->>'predictions_enabled')::boolean, predictions_enabled),
      cancel_window_hours = coalesce((p->>'cancel_window_hours')::integer, cancel_window_hours),
      acceptance_hours = coalesce((p->>'acceptance_hours')::integer, acceptance_hours),
      result_hours = coalesce((p->>'result_hours')::integer, result_hours),
      max_team_members = coalesce((p->>'max_team_members')::integer, max_team_members),
      bet_rate_per_hour = coalesce((p->>'bet_rate_per_hour')::integer, bet_rate_per_hour),
      deposit_min = coalesce((p->>'deposit_min')::integer, deposit_min),
      deposit_max = coalesce((p->>'deposit_max')::integer, deposit_max),
      updated_by = auth.uid(), updated_at = now()
    where id = 1;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then return public.comp__err('INVALID'); end;
  perform public.comp__audit('definicoes_competitivo', 'comp_settings', p - 'monetary_features_enabled' - 'betting_enabled');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.comp_admin_challenge_action(p_id uuid, p_action text, p_challenger_score integer default null, p_opponent_score integer default null, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c comp_challenges; e text;
begin
  if not (public.is_admin() or public.is_mod()) then return public.comp__err('FORBIDDEN'); end if;
  select * into c from comp_challenges where id = p_id for update;
  if c.id is null then return public.comp__err('NOT_FOUND'); end if;
  if p_action = 'analisar' then
    if c.status not in ('DISPUTED','PENDING_RESULT','IN_PROGRESS') then return public.comp__err('STATE'); end if;
    perform public.comp__ctx('admin_analisar', jsonb_build_object('nota', left(coalesce(p_note, ''), 300)));
    update comp_challenges set status = 'UNDER_REVIEW' where id = p_id;
    update comp_disputes set status = 'em_analise' where challenge_id = p_id and status = 'aberta';
  elsif p_action = 'resolver' then
    e := public.comp__admin_strong(); if e is not null then return public.comp__err(e); end if;
    if c.status not in ('UNDER_REVIEW','DISPUTED') then return public.comp__err('STATE'); end if;
    if p_challenger_score is null or p_opponent_score is null or p_challenger_score < 0 or p_opponent_score < 0 then return public.comp__err('SCORE'); end if;
    if char_length(btrim(coalesce(p_note, ''))) < 5 then return public.comp__err('REASON'); end if;
    perform public.comp__ctx('admin_resolver', jsonb_build_object('resultado', p_challenger_score || '-' || p_opponent_score, 'nota', left(p_note, 300)));
    update comp_challenges set status = 'COMPLETED', completed_at = now(), challenger_score = p_challenger_score, opponent_score = p_opponent_score, result_source = 'admin',
      winner_team_id = case when p_challenger_score > p_opponent_score then c.challenger_team_id when p_challenger_score < p_opponent_score then c.opponent_team_id else null end,
      result_verified_by = auth.uid(), result_verified_at = now() where id = p_id;
    update comp_disputes set status = 'resolvida', resolution = left(p_note, 1000), resolved_by = auth.uid(), resolved_at = now() where challenge_id = p_id and status in ('aberta','em_analise');
    perform public.comp__finish(p_id);
    perform public.comp__settle_market(p_id);
  elsif p_action = 'verificar' then
    e := public.comp__admin_strong(); if e is not null then return public.comp__err(e); end if;
    if c.status <> 'COMPLETED' or c.result_verified_at is not null then return public.comp__err('STATE'); end if;
    update comp_challenges set result_verified_by = auth.uid(), result_verified_at = now() where id = p_id;
    perform public.comp__event(p_id, 'resultado_verificado', jsonb_build_object('nota', left(coalesce(p_note, ''), 300)));
    perform public.comp__settle_market(p_id);
  elsif p_action = 'anular' then
    e := public.comp__admin_strong(); if e is not null then return public.comp__err(e); end if;
    if c.status in ('COMPLETED','CANCELLED') then return public.comp__err('STATE'); end if;
    if char_length(btrim(coalesce(p_note, ''))) < 5 then return public.comp__err('REASON'); end if;
    perform public.comp__ctx('admin_anular', jsonb_build_object('nota', left(p_note, 300)));
    update comp_challenges set status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Admin: ' || left(p_note, 280) where id = p_id;
    update comp_disputes set status = 'anulada', resolution = left(p_note, 1000), resolved_by = auth.uid(), resolved_at = now() where challenge_id = p_id and status in ('aberta','em_analise');
    perform public.comp__settle_market(p_id);
  else return public.comp__err('ACTION'); end if;
  perform public.comp__audit('admin_desafio_' || p_action, p_id::text, jsonb_build_object('nota', left(coalesce(p_note, ''), 300)));
  return jsonb_build_object('ok', true);
end $$;

-- Abrir mercado de apostas num desafio agendado (usa o motor bets_*: Elo → odds → margem; fecha ao começar)
create or replace function public.comp_admin_open_market(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public.comp__admin_strong(); c comp_challenges; ta comp_teams; tb comp_teams; g text; h uuid; a uuid; mid uuid;
begin
  if e is not null then return public.comp__err(e); end if;
  if not public.comp__betting_on() then return public.comp__err('BETTING_OFF'); end if;
  select * into c from comp_challenges where id = p_id for update;
  if c.id is null or c.status <> 'SCHEDULED' or c.scheduled_at <= now() + interval '10 minutes' then return public.comp__err('STATE'); end if;
  if c.bet_match_id is not null then return public.comp__err('ALREADY'); end if;
  select * into ta from comp_teams where id = c.challenger_team_id;
  select * into tb from comp_teams where id = c.opponent_team_id;
  g := case c.game when 'Free Fire' then 'ff' when 'eFootball' then 'ef' when 'DLS' then 'dls' when 'Clash Royale' then 'cr' else 'outros' end;
  h := coalesce(ta.bet_team_id, public.bets__team(g, ta.name)); a := coalesce(tb.bet_team_id, public.bets__team(g, tb.name));
  update comp_teams set bet_team_id = h where id = ta.id and bet_team_id is null;
  update comp_teams set bet_team_id = a where id = tb.id and bet_team_id is null;
  insert into bet_matches (game_key, tournament_id, tournament_name, home_team_id, away_team_id, home, away, starts_at, original_starts_at, challenge_id)
    values (g, null, 'Desafio TXAPILOG', h, a, ta.name, tb.name, c.scheduled_at, c.scheduled_at, c.id) returning id into mid;
  -- Regra TXAPILOG: aposta-se só na equipa vencedora e a odd é fixa 2.00 (ganhar = o dobro do valor apostado).
  delete from bet_markets where match_id = mid and kind not in ('1x2','12');
  delete from bet_selections s using bet_markets m where s.market_id = m.id and m.match_id = mid and s.code not in ('1','2');
  update bet_selections s set odds = 2.00, manual = true from bet_markets m where s.market_id = m.id and m.match_id = mid;
  update bet_markets set title = 'Equipa vencedora (paga o dobro)' where match_id = mid;
  update comp_challenges set bet_match_id = mid where id = p_id;
  perform public.comp__event(p_id, 'mercado_aberto', jsonb_build_object('match', mid));
  perform public.comp__audit('mercado_desafio_aberto', p_id::text, jsonb_build_object('match', mid));
  return jsonb_build_object('ok', true, 'match_id', mid);
end $$;

create or replace function public.comp_admin_team_action(p_team uuid, p_action text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_mod()) then return public.comp__err('FORBIDDEN'); end if;
  if p_action not in ('suspender','reativar') then return public.comp__err('ACTION'); end if;
  update comp_teams set status = case when p_action = 'suspender' then 'suspensa' else 'ativa' end, updated_at = now() where id = p_team and status <> 'dissolvida';
  if not found then return public.comp__err('NOT_FOUND'); end if;
  perform public.comp__audit('admin_equipa_' || p_action, p_team::text, jsonb_build_object('nota', left(coalesce(p_note, ''), 300)));
  return jsonb_build_object('ok', true);
end $$;

-- Reconciliação financeira: compara payments (fornecedor) com money_ledger (livro-razão)
create or replace function public.comp_admin_reconcile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; b jsonb; c jsonb; d jsonb; t jsonb;
begin
  if not public.is_admin() then return public.comp__err('FORBIDDEN'); end if;
  select coalesce(jsonb_agg(x), '[]') into a from (select p.id, p.user_handle, p.amount_mzn, p.provider_ref, p.confirmed_at from payments p
    where p.kind = 'carteira' and p.status = 'pago' and not exists (select 1 from money_ledger l where l.reason = 'deposito' and l.ref = coalesce(p.provider, 'mpesa') || ':' || p.provider_ref) limit 200) x;
  select coalesce(jsonb_agg(x), '[]') into b from (select l.entry_id, l.user_id, l.delta, l.ref, l.created_at from money_ledger l
    where l.reason = 'deposito' and l.ref ~ '^(mpesa|emola|aggregator):' and not exists (select 1 from payments p where p.kind = 'carteira' and p.status = 'pago' and coalesce(p.provider, 'mpesa') || ':' || p.provider_ref = l.ref) limit 200) x;
  select coalesce(jsonb_agg(x), '[]') into c from (select p.id, p.user_handle, p.amount_mzn, p.status, p.created_at from payments p
    where p.kind = 'carteira' and p.status in ('pendente','em processamento') and p.created_at < now() - interval '30 minutes' limit 200) x;
  select coalesce(jsonb_agg(x), '[]') into d from (select e.provider, e.event_id, e.payment_id, e.outcome, e.signature_ok, e.received_at from comp_provider_events e
    where not e.signature_ok or e.outcome <> 'recebido' order by e.id desc limit 100) x;
  select jsonb_build_object(
    'ledger_total', coalesce((select sum(delta) from money_ledger), 0),
    'balances_sum', coalesce((select sum(public.bets__balance_mt(u)) from (select distinct user_id u from money_ledger) z), 0),
    'deposits_paid', coalesce((select sum(amount_mzn) from payments where kind = 'carteira' and status = 'pago'), 0),
    'deposits_ledger', coalesce((select sum(delta) from money_ledger where reason = 'deposito'), 0),
    'withdrawals_paid', coalesce((select sum(amount) from money_withdrawals where status = 'pago'), 0),
    'withdrawals_pending', coalesce((select sum(amount) from money_withdrawals where status = 'pendente'), 0)) into t;
  perform public.comp__audit('reconciliacao_consultada', 'payments', '{}');
  return jsonb_build_object('ok', true, 'paid_without_ledger', a, 'ledger_without_payment', b, 'stale_pending', c, 'provider_anomalies', d, 'totals', t);
end $$;

create or replace function public.comp_admin_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not (public.is_admin() or public.is_mod()) then return public.comp__err('FORBIDDEN'); end if;
  select jsonb_build_object('ok', true,
    'settings', (select to_jsonb(s) from comp_settings s where id = 1),
    'licences', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]') from comp_licences l),
    'providers', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from comp_provider_status p),
    'monetary_on', public.comp__monetary_on(), 'betting_on', public.comp__betting_on(), 'strong_auth', public.comp__strong_auth(),
    'counts', jsonb_build_object(
      'teams', (select count(*) from comp_teams where status = 'ativa'),
      'challenges', (select jsonb_object_agg(status, n) from (select status, count(*) n from comp_challenges group by status) z),
      'open_disputes', (select count(*) from comp_disputes where status in ('aberta','em_analise')),
      'risk_open', (select count(*) from risk_flags where status = 'aberto' and kind in ('aposta','desafio','deposito'))),
    'disputes', (select coalesce(jsonb_agg(x), '[]') from (select d.id, d.challenge_id, d.reason, d.status, d.evidence_urls, d.created_at, c.status as challenge_status,
        ta.name as challenger, tb.name as opponent from comp_disputes d join comp_challenges c on c.id = d.challenge_id join comp_teams ta on ta.id = c.challenger_team_id
        left join comp_teams tb on tb.id = c.opponent_team_id where d.status in ('aberta','em_analise') order by d.created_at limit 100) x),
    'review', (select coalesce(jsonb_agg(x), '[]') from (select c.id, c.status, c.game, c.scheduled_at, c.challenger_score, c.opponent_score, c.result_source, c.result_verified_at, c.bet_match_id,
        ta.name as challenger, tb.name as opponent from comp_challenges c join comp_teams ta on ta.id = c.challenger_team_id left join comp_teams tb on tb.id = c.opponent_team_id
        where c.status in ('UNDER_REVIEW','DISPUTED','PENDING_RESULT','SCHEDULED','IN_PROGRESS') or (c.status = 'COMPLETED' and c.result_verified_at is null)
        order by c.updated_at desc limit 200) x),
    'teams', (select coalesce(jsonb_agg(x), '[]') from (select t.id, t.name, t.game, t.status, t.rating, t.played, (select count(*) from comp_team_members m where m.team_id = t.id and m.left_at is null) as members
        from comp_teams t order by t.created_at desc limit 200) x),
    'risk', (select coalesce(jsonb_agg(x), '[]') from (select id, user_handle, kind, ref_id, rules, score, amount_mzn, status, created_at from risk_flags
        where kind in ('aposta','desafio','deposito') order by created_at desc limit 100) x),
    'audit', (select coalesce(jsonb_agg(x), '[]') from (select a.id, a.action, a.target, a.details, a.aal, a.created_at, p.handle as actor from comp_audit a left join profiles p on p.id = a.actor_id
        order by a.id desc limit 200) x),
    'transactions', (select coalesce(jsonb_agg(x), '[]') from (select l.entry_id, p.handle, l.delta, l.reason, l.ref, l.balance_after, l.created_at from money_ledger l left join profiles p on p.id = l.user_id
        order by l.id desc limit 200) x),
    'activity', (select jsonb_build_object(
        'challenges_7d', (select count(*) from comp_challenges where created_at > now() - interval '7 days'),
        'completed_7d', (select count(*) from comp_challenges where status = 'COMPLETED' and completed_at > now() - interval '7 days'),
        'teams_7d', (select count(*) from comp_teams where created_at > now() - interval '7 days'),
        'predictions_7d', (select count(*) from comp_predictions where created_at > now() - interval '7 days'))))
  into r;
  return r;
end $$;

-- 7. RLS, permissões ----------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['comp_settings','comp_licences','comp_provider_status','comp_audit','comp_idempotency','comp_rate_hits','comp_teams','comp_team_members',
    'comp_team_invites','comp_challenges','comp_challenge_events','comp_result_submissions','comp_disputes','comp_predictions','comp_provider_events','comp_bet_terms'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

drop policy if exists comp_settings_read on public.comp_settings;
create policy comp_settings_read on public.comp_settings for select using (true);
drop policy if exists comp_licences_read on public.comp_licences;
create policy comp_licences_read on public.comp_licences for select using ((select public.is_admin()));
drop policy if exists comp_provider_read on public.comp_provider_status;
create policy comp_provider_read on public.comp_provider_status for select using ((select public.is_admin()));
drop policy if exists comp_audit_read on public.comp_audit;
create policy comp_audit_read on public.comp_audit for select using ((select public.is_admin()) or actor_id = (select auth.uid()));
drop policy if exists comp_teams_read on public.comp_teams;
create policy comp_teams_read on public.comp_teams for select using (status <> 'dissolvida' or (select public.is_admin()));
drop policy if exists comp_members_read on public.comp_team_members;
create policy comp_members_read on public.comp_team_members for select using (true);
drop policy if exists comp_invites_read on public.comp_team_invites;
create policy comp_invites_read on public.comp_team_invites for select using (user_id = (select auth.uid()) or (select public.comp__can_manage(team_id)) or (select public.is_admin()));
drop policy if exists comp_challenges_read on public.comp_challenges;
create policy comp_challenges_read on public.comp_challenges for select using (status <> 'DRAFT' or (select public.comp__is_member(challenger_team_id)) or (select public.is_mod()));
drop policy if exists comp_events_read on public.comp_challenge_events;
create policy comp_events_read on public.comp_challenge_events for select using (exists (select 1 from public.comp_challenges c where c.id = challenge_id));
drop policy if exists comp_results_read on public.comp_result_submissions;
create policy comp_results_read on public.comp_result_submissions for select using (
  (select public.is_mod()) or exists (select 1 from public.comp_challenges c where c.id = challenge_id and (c.status = 'COMPLETED' or public.comp__is_member(c.challenger_team_id) or public.comp__is_member(c.opponent_team_id))));
drop policy if exists comp_disputes_read on public.comp_disputes;
create policy comp_disputes_read on public.comp_disputes for select using (
  (select public.is_mod()) or exists (select 1 from public.comp_challenges c where c.id = challenge_id and (public.comp__is_member(c.challenger_team_id) or public.comp__is_member(c.opponent_team_id))));
drop policy if exists comp_predictions_read on public.comp_predictions;
create policy comp_predictions_read on public.comp_predictions for select using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists comp_provider_events_read on public.comp_provider_events;
create policy comp_provider_events_read on public.comp_provider_events for select using ((select public.is_admin()));
drop policy if exists comp_bet_terms_read on public.comp_bet_terms;
create policy comp_bet_terms_read on public.comp_bet_terms for select using (user_id = (select auth.uid()) or (select public.is_admin()));
-- comp_idempotency e comp_rate_hits: sem políticas de leitura (só funções)

grant select on public.comp_settings, public.comp_teams, public.comp_team_members, public.comp_challenges, public.comp_challenge_events to anon, authenticated;
grant select on public.comp_licences, public.comp_provider_status, public.comp_audit, public.comp_team_invites, public.comp_result_submissions, public.comp_disputes,
  public.comp_predictions, public.comp_provider_events, public.comp_bet_terms to authenticated;

-- Funções internas (comp__*) fechadas a clientes; as que a RLS usa ficam executáveis.
do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'comp\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.comp__is_member(uuid, uuid), public.comp__can_manage(uuid, uuid) to anon, authenticated;
grant execute on function public.comp__confirm_deposit(text, text, text, text, text, integer, boolean, text) to service_role;
grant execute on function public.comp_sweep(), public.comp_challenge_public(uuid), public.comp_public_profile(text) to anon, authenticated;
grant execute on function public.comp_eligibility(uuid), public.comp_rg_set_limits(integer, integer, integer), public.comp_rg_cool_off(integer),
  public.comp_team_create(text, text, text, text, text, text), public.comp_team_update(uuid, text, text, text, text), public.comp_team_invite(uuid, text),
  public.comp_invite_respond(uuid, boolean), public.comp_invite_cancel(uuid), public.comp_team_member_action(uuid, uuid, text, boolean),
  public.comp_challenge_create(uuid, uuid, text, text, integer, integer, timestamptz, boolean, text), public.comp_challenge_publish(uuid, uuid),
  public.comp_challenge_respond(uuid, boolean, uuid, text), public.comp_challenge_schedule(uuid, timestamptz), public.comp_challenge_start(uuid),
  public.comp_challenge_submit_result(uuid, uuid, integer, integer, text[]), public.comp_challenge_dispute(uuid, uuid, text, text[]), public.comp_challenge_cancel(uuid, text),
  public.comp_predict(uuid, text), public.comp_my_activity(), public.comp_wallet_me(), public.comp_wallet_deposit_intent(integer, text, text, text),
  public.comp_wallet_withdraw(integer, text, text, text, text), public.comp_bet_place(uuid, integer, numeric, text, boolean, text),
  public.comp_admin_record_licence(text, text, text, date, date, text), public.comp_admin_revoke_licence(uuid), public.comp_admin_set_flags(boolean, boolean, text),
  public.comp_admin_save_settings(jsonb), public.comp_admin_challenge_action(uuid, text, integer, integer, text), public.comp_admin_open_market(uuid),
  public.comp_admin_team_action(uuid, text, text), public.comp_admin_reconcile(), public.comp_admin_overview() to authenticated;
-- bets__real_active foi redefinida: mantém-se fechada a clientes
revoke all on function public.bets__real_active() from public, anon, authenticated;

-- Storage: provas em media/proofs/<uid>/ (o próprio utilizador). Mantém as regras anteriores do bucket media.
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (
    (name like 'products/' || (select auth.uid())::text || '/%') or
    (name like 'tournaments/%' and (select public.tx__can_organize())) or
    (name like 'teams/' || (select auth.uid())::text || '/%') or
    (name like 'teams/%' and (select public.is_admin())) or
    (name like 'proofs/' || (select auth.uid())::text || '/%')));

-- 8. Relógio (pg_cron, se existir) ------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'comp-sweep';
    perform cron.schedule('comp-sweep', '*/5 * * * *', 'select public.comp_sweep()');
  end if;
end $$;

notify pgrst, 'reload schema';
