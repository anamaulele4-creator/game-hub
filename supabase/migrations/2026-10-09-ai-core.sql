-- =====================================================================
-- TXAPILOG AI CORE · Inteligência de jogadores Free Fire, equipas e torneios
-- Migração (NÃO executada automaticamente). Idempotente: pode correr-se várias vezes.
-- Requer supabase/schema.sql (profiles, is_admin(), is_mod(), tournaments).
--
-- Princípios:
--   • Só dados obtidos de fontes autorizadas (torneios registados na TXAPILOG, submissões dos
--     jogadores marcadas "Submetido · não verificado", ou um fornecedor autorizado configurado).
--   • Nada de estatísticas inventadas: as estatísticas são calculadas a partir das linhas reais.
--   • RLS em todas as tabelas; funções de papel (admin, moderador, organizador, jogador);
--     validação de entradas por CHECK; limite de pedidos na BD; auditoria por triggers.
-- Ids internos mantêm o prefixo "core_".
-- =====================================================================

-- 0. Papéis ------------------------------------------------------------------------------
create table if not exists public.core_user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','moderador','organizador','jogador')),
  granted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Papel efetivo: tabela core_user_roles; recurso a profiles.role (admin → admin, moderator → moderador).
create or replace function public.core_role(p_uid uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p.role = 'admin' then 'admin' end from profiles p where p.id = p_uid and not p.banned),
    (select r.role from core_user_roles r join profiles p on p.id = r.user_id where r.user_id = p_uid and not p.banned),
    (select case when p.role = 'moderator' then 'moderador' else 'jogador' end from profiles p where p.id = p_uid and not p.banned)
  );
$$;
create or replace function public.core_has_role(variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.core_role(auth.uid()) = any(p_roles);
$$;
create or replace function public.core_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.core_has_role('admin','moderador','organizador');
$$;
create or replace function public.core_my_role() returns text
language sql stable security definer set search_path = public as $$ select public.core_role(auth.uid()); $$;
revoke all on function public.core_role(uuid) from public, anon;
grant execute on function public.core_role(uuid) to authenticated, service_role;
grant execute on function public.core_has_role(text[]) to authenticated;
grant execute on function public.core_is_staff() to authenticated;
grant execute on function public.core_my_role() to authenticated;

-- 1. Jogadores, IDs externos, perfis verificados -----------------------------------------
create table if not exists public.core_players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 32),
  country text not null default 'MZ' check (country ~ '^[A-Z]{2}$'),
  status text not null default 'ativo' check (status in ('ativo','suspenso')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists core_players_user_idx on public.core_players (user_id);
create index if not exists core_players_nick_idx on public.core_players (lower(nickname));

create table if not exists public.core_external_ids (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.core_players(id) on delete cascade,
  game text not null default 'free_fire' check (game in ('free_fire')),
  external_id text not null check (external_id ~ '^[0-9]{6,13}$'),
  region text not null default 'AF' check (region ~ '^[A-Z]{2,4}$'),
  status text not null default 'pendente' check (status in ('pendente','verificado','rejeitado')),
  source text not null default 'submetido_jogador' check (source in ('torneio_txapilog','submetido_jogador','provedor_autorizado')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (player_id, game, external_id, region)
);
-- Um ID só pode estar VERIFICADO num jogador; reivindicações repetidas ficam pendentes e são sinalizadas.
create unique index if not exists core_external_ids_verified_uq on public.core_external_ids (game, external_id, region) where status = 'verificado';
create index if not exists core_external_ids_lookup_idx on public.core_external_ids (game, external_id);

create table if not exists public.core_player_verifications (
  player_id uuid primary key references public.core_players(id) on delete cascade,
  verified_by uuid references public.profiles(id) on delete set null default auth.uid(),
  method text not null check (method in ('documento','captura_ecra_perfil','presencial','organizador_torneio')),
  notes text check (notes is null or char_length(notes) <= 500),
  verified_at timestamptz not null default now()
);

-- 2. Equipas (duo / squad) ----------------------------------------------------------------
create table if not exists public.core_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 40),
  tag text check (tag is null or tag ~ '^[A-Za-z0-9]{2,6}$'),
  kind text not null check (kind in ('duo','squad')),
  captain_player_id uuid references public.core_players(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.core_team_members (
  team_id uuid not null references public.core_teams(id) on delete cascade,
  player_id uuid not null references public.core_players(id) on delete cascade,
  role text not null default 'membro' check (role in ('capitao','membro','suplente')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (team_id, player_id)
);
create index if not exists core_team_members_player_idx on public.core_team_members (player_id);

-- Tamanho máximo: duo = 2 (+1 suplente), squad = 4 (+2 suplentes)
create or replace function public.core_tg_team_size() returns trigger
language plpgsql set search_path = public as $$
declare k text; n int;
begin
  select kind into k from core_teams where id = new.team_id;
  select count(*) into n from core_team_members where team_id = new.team_id and left_at is null and player_id <> new.player_id;
  if new.left_at is null and n + 1 > (case when k = 'duo' then 3 else 6 end) then
    raise exception 'Equipa cheia (% · máximo %).', k, case when k = 'duo' then 3 else 6 end;
  end if;
  return new;
end $$;
drop trigger if exists core_team_size on public.core_team_members;
create trigger core_team_size before insert or update on public.core_team_members for each row execute function public.core_tg_team_size();

-- 3. Torneios, partidas, participações e resultados ---------------------------------------
create table if not exists public.core_tournaments (
  id uuid primary key default gen_random_uuid(),
  app_tournament_id text references public.tournaments(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 3 and 80),
  mode text not null check (mode in ('solo','duo','squad')),
  region text not null default 'AF' check (region ~ '^[A-Z]{2,4}$'),
  status text not null default 'rascunho' check (status in ('rascunho','inscricoes','a_decorrer','terminado','cancelado')),
  starts_at timestamptz,
  ends_at timestamptz,
  organizer_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index if not exists core_tournaments_status_idx on public.core_tournaments (status, starts_at);

create table if not exists public.core_tournament_teams (
  tournament_id uuid not null references public.core_tournaments(id) on delete cascade,
  team_id uuid not null references public.core_teams(id) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key (tournament_id, team_id)
);

create table if not exists public.core_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.core_tournaments(id) on delete set null,
  round_label text check (round_label is null or char_length(round_label) <= 40),
  map text check (map is null or map in ('Bermuda','Purgatório','Kalahari','Alpine','Nexterra','Solara','Outro')),
  mode text not null check (mode in ('solo','duo','squad')),
  played_at timestamptz not null,
  source text not null default 'torneio_txapilog' check (source in ('torneio_txapilog','submetido_jogador','provedor_autorizado')),
  validation_status text not null default 'submetido' check (validation_status in ('submetido','verificado','rejeitado')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (played_at <= now() + interval '1 day')
);
create index if not exists core_matches_tournament_idx on public.core_matches (tournament_id, played_at desc);
create index if not exists core_matches_played_idx on public.core_matches (played_at desc);

create table if not exists public.core_match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.core_matches(id) on delete cascade,
  player_id uuid not null references public.core_players(id) on delete cascade,
  team_id uuid references public.core_teams(id) on delete set null,
  kills integer not null check (kills between 0 and 60),
  damage integer check (damage is null or damage between 0 and 30000),
  assists integer check (assists is null or assists between 0 and 60),
  placement integer check (placement is null or placement between 1 and 60),
  survived_seconds integer check (survived_seconds is null or survived_seconds between 0 and 3600),
  source text not null default 'submetido_jogador' check (source in ('torneio_txapilog','submetido_jogador','provedor_autorizado')),
  validation_status text not null default 'submetido' check (validation_status in ('submetido','verificado','rejeitado')),
  evidence_url text check (evidence_url is null or (char_length(evidence_url) <= 500 and evidence_url ~ '^https://')),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 300),
  submitted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
-- Duplicados exatos são impossíveis; repetições "parecidas" são sinalizadas pelo motor de IA.
create unique index if not exists core_participants_uq on public.core_match_participants (match_id, player_id) where validation_status <> 'rejeitado';
create index if not exists core_participants_player_idx on public.core_match_participants (player_id, created_at desc);
create index if not exists core_participants_status_idx on public.core_match_participants (validation_status) where validation_status = 'submetido';

create table if not exists public.core_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.core_matches(id) on delete cascade,
  team_id uuid not null references public.core_teams(id) on delete cascade,
  placement integer not null check (placement between 1 and 60),
  kills_total integer not null default 0 check (kills_total between 0 and 200),
  points integer check (points is null or points between 0 and 500),
  source text not null default 'torneio_txapilog' check (source in ('torneio_txapilog','submetido_jogador','provedor_autorizado')),
  validation_status text not null default 'submetido' check (validation_status in ('submetido','verificado','rejeitado')),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 300),
  submitted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists core_results_uq on public.core_results (match_id, team_id) where validation_status <> 'rejeitado';
create index if not exists core_results_status_idx on public.core_results (validation_status) where validation_status = 'submetido';

-- Só admin/moderador (ou o organizador do torneio) podem verificar/rejeitar.
-- Quem não tem esse poder: a linha entra/fica SEMPRE "submetido" e os campos de verificação são limpos.
create or replace function public.core_can_validate(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.core_has_role('admin','moderador')
      or (public.core_has_role('organizador') and exists (
            select 1 from core_matches m join core_tournaments t on t.id = m.tournament_id
            where m.id = p_match and t.organizer_id = auth.uid()));
$$;
grant execute on function public.core_can_validate(uuid) to authenticated;

create or replace function public.core_tg_guard_validation() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' or auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and new.validation_status is distinct from old.validation_status then
    if not public.core_can_validate(new.match_id) then raise exception 'Sem permissão para validar resultados.'; end if;
    if new.validation_status = 'verificado' then new.verified_by := auth.uid(); new.verified_at := now(); end if;
    if new.validation_status = 'rejeitado' and coalesce(btrim(new.rejection_reason), '') = '' then raise exception 'Indica o motivo da rejeição.'; end if;
  elsif tg_op = 'INSERT' and not public.core_can_validate(new.match_id) then
    new.validation_status := 'submetido'; new.verified_by := null; new.verified_at := null;
    if not public.core_is_staff() then new.source := 'submetido_jogador'; end if;
  elsif tg_op = 'UPDATE' and not public.core_can_validate(new.match_id) then
    -- o jogador só pode corrigir a própria submissão enquanto não verificada
    if old.validation_status <> 'submetido' then raise exception 'Resultado já validado: só um moderador o pode alterar.'; end if;
    new.source := old.source; new.verified_by := null; new.verified_at := null;
  end if;
  new.submitted_by := coalesce(new.submitted_by, auth.uid());
  return new;
end $$;
drop trigger if exists core_guard_validation on public.core_match_participants;
create trigger core_guard_validation before insert or update on public.core_match_participants for each row execute function public.core_tg_guard_validation();
drop trigger if exists core_guard_validation on public.core_results;
create trigger core_guard_validation before insert or update on public.core_results for each row execute function public.core_tg_guard_validation();

create or replace function public.core_tg_guard_match() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' or auth.uid() is null then return new; end if;
  if not public.core_has_role('admin','moderador','organizador') then
    if tg_op = 'UPDATE' then raise exception 'Sem permissão.'; end if;
    new.validation_status := 'submetido'; new.source := 'submetido_jogador'; new.tournament_id := null;
  elsif tg_op = 'UPDATE' and new.validation_status is distinct from old.validation_status and not public.core_can_validate(new.id) then
    raise exception 'Sem permissão para validar esta partida.';
  end if;
  return new;
end $$;
drop trigger if exists core_guard_match on public.core_matches;
create trigger core_guard_match before insert or update on public.core_matches for each row execute function public.core_tg_guard_match();

-- 4. Estatísticas calculadas (vista; respeita RLS de quem consulta) -----------------------
-- Só linhas NÃO rejeitadas. "_verified" = só verificadas. Sem linhas → valores nulos ("indisponível").
-- K/D segue a fórmula habitual do Free Fire: abates ÷ partidas não ganhas.
create or replace view public.core_player_stats with (security_invoker = true) as
select
  p.id as player_id,
  p.nickname,
  count(mp.id) filter (where mp.validation_status <> 'rejeitado') as matches,
  count(mp.id) filter (where mp.validation_status = 'verificado') as matches_verified,
  count(mp.id) filter (where mp.validation_status = 'submetido') as matches_unverified,
  sum(mp.kills) filter (where mp.validation_status <> 'rejeitado') as kills,
  sum(mp.kills) filter (where mp.validation_status = 'verificado') as kills_verified,
  round(avg(mp.kills) filter (where mp.validation_status <> 'rejeitado'), 2) as avg_kills,
  round(avg(mp.damage) filter (where mp.validation_status <> 'rejeitado' and mp.damage is not null), 0) as avg_damage,
  count(mp.id) filter (where mp.validation_status <> 'rejeitado' and mp.placement = 1) as wins,
  round(avg(mp.placement) filter (where mp.validation_status <> 'rejeitado' and mp.placement is not null), 2) as avg_placement,
  case when count(mp.id) filter (where mp.validation_status <> 'rejeitado' and mp.placement is not null and mp.placement <> 1) > 0
       then round(sum(mp.kills) filter (where mp.validation_status <> 'rejeitado')::numeric
                  / count(mp.id) filter (where mp.validation_status <> 'rejeitado' and mp.placement is not null and mp.placement <> 1), 2) end as kd,
  max(m.played_at) filter (where mp.validation_status <> 'rejeitado') as last_played_at
from public.core_players p
left join public.core_match_participants mp on mp.player_id = p.id
left join public.core_matches m on m.id = mp.match_id
group by p.id, p.nickname;

-- 5. Alertas, relatórios de IA, integrações -----------------------------------------------
create table if not exists public.core_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  severity text not null default 'media' check (severity in ('baixa','media','alta')),
  title text not null check (char_length(title) between 3 and 140),
  detail text check (detail is null or char_length(detail) <= 2000),
  entity_type text check (entity_type is null or entity_type in ('player','team','match','tournament','external_id','result')),
  entity_id text check (entity_id is null or char_length(entity_id) <= 64),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and pg_column_size(evidence) <= 8192),
  origin text not null default 'motor_ia' check (origin in ('motor_ia','sistema','utilizador')),
  status text not null default 'aberto' check (status in ('aberto','em_revisao','resolvido','descartado')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists core_alerts_status_idx on public.core_alerts (status, created_at desc);
-- Um alerta aberto por (tipo, entidade): evita duplicar sinalizações
create unique index if not exists core_alerts_open_uq on public.core_alerts (kind, entity_type, entity_id) where status in ('aberto','em_revisao');

create table if not exists public.core_ai_reports (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('player','team','tournament','global')),
  subject_id text check (subject_id is null or char_length(subject_id) <= 64),
  kind text not null default 'resumo' check (kind in ('resumo','tendencia','comparacao','anomalias','relatorio')),
  content text not null check (char_length(content) <= 8000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  confidence text not null check (confidence in ('alta','media','baixa','indisponivel')),
  generator text not null default 'deterministico' check (generator ~ '^[a-z0-9_.:-]{3,60}$'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists core_ai_reports_subject_idx on public.core_ai_reports (scope, subject_id, created_at desc);

create table if not exists public.core_integrations (
  id text primary key check (id ~ '^[a-z_]{3,40}$'),
  name text not null,
  kind text not null check (kind in ('oficial','autorizado','txapilog')),
  enabled boolean not null default false,
  status text not null,
  detail text,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.core_integrations (id, name, kind, enabled, status, detail) values
  ('txapilog_torneios', 'Torneios registados na TXAPILOG', 'txapilog', true, 'Ativo', 'Partidas e resultados inseridos por organizadores e validados por moderadores.'),
  ('garena_oficial', 'API oficial Garena Free Fire', 'oficial', false, 'Não configurado — sem fonte autorizada', 'A Garena não disponibiliza API pública de estatísticas de jogadores.'),
  ('fornecedor_autorizado', 'Fornecedor de dados autorizado', 'autorizado', false, 'Não configurado — sem fonte autorizada', 'Ligar só com contrato/licença e chave guardada como segredo da Edge Function.')
on conflict (id) do nothing;

-- 6. Auditoria ------------------------------------------------------------------------------
create table if not exists public.core_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid default auth.uid(),
  actor_role text,
  action text not null check (action in ('INSERT','UPDATE','DELETE','RPC')),
  table_name text not null,
  row_id text,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index if not exists core_audit_time_idx on public.core_audit_logs (created_at desc);

create or replace function public.core_tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid text; ch jsonb; j jsonb;
begin
  j := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  rid := coalesce(j ->> 'id', j ->> 'player_id', j ->> 'user_id');
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('de', o.value, 'para', n.value)) into ch
      from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key) where n.value is distinct from o.value;
  elsif tg_op = 'INSERT' then ch := to_jsonb(new);
  else ch := to_jsonb(old); end if;
  insert into core_audit_logs (actor_id, actor_role, action, table_name, row_id, changes)
  values (auth.uid(), case when auth.uid() is null then 'sistema' else public.core_role(auth.uid()) end, tg_op, tg_table_name, rid, ch);
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['core_user_roles','core_players','core_external_ids','core_player_verifications','core_teams','core_team_members',
    'core_tournaments','core_tournament_teams','core_matches','core_match_participants','core_results','core_alerts','core_ai_reports','core_integrations'] loop
    execute format('drop trigger if exists core_audit on public.%I', t);
    execute format('create trigger core_audit after insert or update or delete on public.%I for each row execute function public.core_tg_audit()', t);
  end loop;
end $$;

-- 7. Limite de pedidos (rate limiting) na BD --------------------------------------------
create table if not exists public.core_rate_limits (
  key text not null,
  hit_at timestamptz not null default now()
);
create index if not exists core_rate_limits_idx on public.core_rate_limits (key, hit_at desc);

create or replace function public.core_rate_limit(p_key text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('core_rl:' || p_key));
  delete from core_rate_limits where key = p_key and hit_at < now() - make_interval(secs => p_window_seconds * 2);
  select count(*) into n from core_rate_limits where key = p_key and hit_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then return false; end if;
  insert into core_rate_limits (key) values (p_key);
  return true;
end $$;
revoke all on function public.core_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.core_rate_limit(text, integer, integer) to service_role;

-- Jogadores: máx. 20 submissões de resultados por hora e 5 IDs por dia.
create or replace function public.core_tg_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.core_is_staff() then return new; end if;
  if tg_table_name = 'core_external_ids' then
    if not public.core_rate_limit('ext:' || auth.uid(), 5, 86400) then raise exception 'Limite de IDs atingido (5 por dia).'; end if;
  elsif not public.core_rate_limit('sub:' || auth.uid(), 20, 3600) then
    raise exception 'Demasiadas submissões. Tenta novamente dentro de uma hora.';
  end if;
  return new;
end $$;
drop trigger if exists core_rate_limit on public.core_match_participants;
create trigger core_rate_limit before insert on public.core_match_participants for each row execute function public.core_tg_rate_limit();
drop trigger if exists core_rate_limit on public.core_matches;
create trigger core_rate_limit before insert on public.core_matches for each row execute function public.core_tg_rate_limit();
drop trigger if exists core_rate_limit on public.core_external_ids;
create trigger core_rate_limit before insert on public.core_external_ids for each row execute function public.core_tg_rate_limit();

-- 8. RPCs para o painel ----------------------------------------------------------------------
-- Validar/rejeitar uma participação ou resultado (com motivo e auditoria).
create or replace function public.core_set_validation(p_kind text, p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if p_status not in ('verificado','rejeitado','submetido') then raise exception 'Estado inválido.'; end if;
  if p_kind = 'participacao' then
    update core_match_participants set validation_status = p_status, rejection_reason = nullif(btrim(p_reason), '') where id = p_id;
  elsif p_kind = 'resultado' then
    update core_results set validation_status = p_status, rejection_reason = nullif(btrim(p_reason), '') where id = p_id;
  else raise exception 'Tipo inválido.'; end if;
  if not found then raise exception 'Registo não encontrado ou sem permissão.'; end if;
end $$;
grant execute on function public.core_set_validation(text, uuid, text, text) to authenticated;

-- Atribuir papel (só admin). Identifica o utilizador pelo @handle.
create or replace function public.core_set_role(p_handle text, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.core_has_role('admin') then raise exception 'Só administradores atribuem papéis.'; end if;
  if p_role not in ('admin','moderador','organizador','jogador') then raise exception 'Papel inválido.'; end if;
  select id into uid from profiles where lower(handle) = lower(trim(both '@' from coalesce(p_handle, ''))) and deleted_at is null;
  if uid is null then raise exception 'Utilizador não encontrado.'; end if;
  if uid = auth.uid() and p_role <> 'admin' then raise exception 'Não podes retirar o teu próprio papel de admin.'; end if;
  insert into core_user_roles (user_id, role) values (uid, p_role)
    on conflict (user_id) do update set role = excluded.role, granted_by = auth.uid(), updated_at = now();
  return uid;
end $$;
revoke all on function public.core_set_role(text, text) from public, anon;
grant execute on function public.core_set_role(text, text) to authenticated;

-- 9. RLS -------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['core_user_roles','core_players','core_external_ids','core_player_verifications','core_teams','core_team_members',
    'core_tournaments','core_tournament_teams','core_matches','core_match_participants','core_results','core_alerts','core_ai_reports',
    'core_integrations','core_audit_logs','core_rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create or replace function public.core_owns_player(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from core_players where id = p_player and user_id = auth.uid());
$$;
grant execute on function public.core_owns_player(uuid) to authenticated;

-- Papéis
select public._policy('core_user_roles', 'core ver papeis', 'for select using (user_id = auth.uid() or public.core_has_role(''admin'',''moderador''))');
select public._policy('core_user_roles', 'core admin papeis', 'for all using (public.core_has_role(''admin'')) with check (public.core_has_role(''admin''))');
-- Jogadores
select public._policy('core_players', 'core ver jogadores', 'for select using (public.core_is_staff() or user_id = auth.uid())');
select public._policy('core_players', 'core criar jogador', 'for insert with check (public.core_is_staff() or (user_id = auth.uid() and public.is_active_user()))');
select public._policy('core_players', 'core editar jogador', 'for update using (public.core_has_role(''admin'',''moderador'') or user_id = auth.uid()) with check (public.core_has_role(''admin'',''moderador'') or (user_id = auth.uid() and status = ''ativo''))');
select public._policy('core_players', 'core apagar jogador', 'for delete using (public.core_has_role(''admin''))');
-- IDs externos
select public._policy('core_external_ids', 'core ver ids', 'for select using (public.core_is_staff() or public.core_owns_player(player_id))');
select public._policy('core_external_ids', 'core criar id', 'for insert with check (public.core_is_staff() or (public.core_owns_player(player_id) and status = ''pendente'' and source = ''submetido_jogador''))');
select public._policy('core_external_ids', 'core rever id', 'for update using (public.core_has_role(''admin'',''moderador'')) with check (public.core_has_role(''admin'',''moderador''))');
select public._policy('core_external_ids', 'core apagar id', 'for delete using (public.core_has_role(''admin'',''moderador'') or (public.core_owns_player(player_id) and status <> ''verificado''))');
-- Verificações de perfil
select public._policy('core_player_verifications', 'core ver verificacoes', 'for select using (public.core_is_staff() or public.core_owns_player(player_id))');
select public._policy('core_player_verifications', 'core gerir verificacoes', 'for all using (public.core_has_role(''admin'',''moderador'')) with check (public.core_has_role(''admin'',''moderador''))');
-- Equipas
select public._policy('core_teams', 'core ver equipas', 'for select using (public.core_is_staff() or exists (select 1 from public.core_team_members tm where tm.team_id = core_teams.id and public.core_owns_player(tm.player_id)))');
select public._policy('core_teams', 'core gerir equipas', 'for all using (public.core_is_staff()) with check (public.core_is_staff())');
select public._policy('core_team_members', 'core ver membros', 'for select using (public.core_is_staff() or public.core_owns_player(player_id))');
select public._policy('core_team_members', 'core gerir membros', 'for all using (public.core_is_staff()) with check (public.core_is_staff())');
-- Torneios
select public._policy('core_tournaments', 'core ver torneios', 'for select using (auth.uid() is not null)');
select public._policy('core_tournaments', 'core criar torneio', 'for insert with check (public.core_has_role(''admin'',''moderador'') or (public.core_has_role(''organizador'') and organizer_id = auth.uid()))');
select public._policy('core_tournaments', 'core editar torneio', 'for update using (public.core_has_role(''admin'',''moderador'') or (public.core_has_role(''organizador'') and organizer_id = auth.uid())) with check (public.core_has_role(''admin'',''moderador'') or (public.core_has_role(''organizador'') and organizer_id = auth.uid()))');
select public._policy('core_tournaments', 'core apagar torneio', 'for delete using (public.core_has_role(''admin''))');
select public._policy('core_tournament_teams', 'core ver inscricoes', 'for select using (auth.uid() is not null)');
select public._policy('core_tournament_teams', 'core gerir inscricoes', 'for all using (public.core_is_staff()) with check (public.core_is_staff())');
-- Partidas
select public._policy('core_matches', 'core ver partidas', 'for select using (public.core_is_staff() or created_by = auth.uid() or exists (select 1 from public.core_match_participants mp where mp.match_id = core_matches.id and public.core_owns_player(mp.player_id)))');
select public._policy('core_matches', 'core criar partida', 'for insert with check (public.core_is_staff() or public.is_active_user())');
select public._policy('core_matches', 'core editar partida', 'for update using (public.core_is_staff()) with check (public.core_is_staff())');
select public._policy('core_matches', 'core apagar partida', 'for delete using (public.core_has_role(''admin'',''moderador''))');
-- Participações
select public._policy('core_match_participants', 'core ver participacoes', 'for select using (public.core_is_staff() or public.core_owns_player(player_id))');
select public._policy('core_match_participants', 'core submeter participacao', 'for insert with check (public.core_is_staff() or (public.core_owns_player(player_id) and public.is_active_user()))');
select public._policy('core_match_participants', 'core editar participacao', 'for update using (public.core_is_staff() or (public.core_owns_player(player_id) and validation_status = ''submetido'')) with check (public.core_is_staff() or public.core_owns_player(player_id))');
select public._policy('core_match_participants', 'core apagar participacao', 'for delete using (public.core_has_role(''admin'',''moderador''))');
-- Resultados de equipa
select public._policy('core_results', 'core ver resultados', 'for select using (public.core_is_staff() or exists (select 1 from public.core_team_members tm where tm.team_id = core_results.team_id and public.core_owns_player(tm.player_id)))');
select public._policy('core_results', 'core submeter resultado', 'for insert with check (public.core_is_staff() or (public.is_active_user() and exists (select 1 from public.core_team_members tm where tm.team_id = core_results.team_id and tm.left_at is null and public.core_owns_player(tm.player_id))))');
select public._policy('core_results', 'core editar resultado', 'for update using (public.core_is_staff()) with check (public.core_is_staff())');
select public._policy('core_results', 'core apagar resultado', 'for delete using (public.core_has_role(''admin'',''moderador''))');
-- Alertas e relatórios: só equipa (staff)
select public._policy('core_alerts', 'core ver alertas', 'for select using (public.core_is_staff())');
select public._policy('core_alerts', 'core criar alerta', 'for insert with check (public.core_is_staff())');
select public._policy('core_alerts', 'core rever alerta', 'for update using (public.core_has_role(''admin'',''moderador'')) with check (public.core_has_role(''admin'',''moderador''))');
select public._policy('core_ai_reports', 'core ver relatorios', 'for select using (public.core_is_staff())');
select public._policy('core_ai_reports', 'core criar relatorio', 'for insert with check (public.core_is_staff())');
-- Integrações: leitura para staff, alteração só admin
select public._policy('core_integrations', 'core ver integracoes', 'for select using (public.core_is_staff())');
select public._policy('core_integrations', 'core admin integracoes', 'for update using (public.core_has_role(''admin'')) with check (public.core_has_role(''admin''))');
-- Auditoria: só admin lê; ninguém escreve diretamente (só o trigger, security definer)
select public._policy('core_audit_logs', 'core ver auditoria', 'for select using (public.core_has_role(''admin''))');
-- core_rate_limits: sem políticas → inacessível a anon/authenticated (só funções security definer)

-- updated_at
create or replace function public.core_tg_touch() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['core_players','core_alerts','core_integrations','core_user_roles'] loop
    execute format('drop trigger if exists core_touch on public.%I', t);
    execute format('create trigger core_touch before update on public.%I for each row execute function public.core_tg_touch()', t);
  end loop;
end $$;

-- Privilégios explícitos (o RLS decide o resto). anon não tem acesso a nada do AI CORE.
do $$ declare t text; begin
  foreach t in array array['core_user_roles','core_players','core_external_ids','core_player_verifications','core_teams','core_team_members',
    'core_tournaments','core_tournament_teams','core_matches','core_match_participants','core_results','core_alerts','core_ai_reports','core_integrations'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke all on public.core_audit_logs, public.core_rate_limits from anon, authenticated;
grant select on public.core_audit_logs to authenticated;
grant all on public.core_audit_logs, public.core_rate_limits to service_role;
revoke all on public.core_player_stats from anon;
grant select on public.core_player_stats to authenticated, service_role;

-- Limpeza do limitador (se pg_cron estiver ativo)
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'core_rl_cleanup';
  perform cron.schedule('core_rl_cleanup', '15 3 * * *', $q$delete from public.core_rate_limits where hit_at < now() - interval '2 days'$q$);
exception when others then null; end $$;

notify pgrst, 'reload schema';
