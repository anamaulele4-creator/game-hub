-- =====================================================================
-- TXAPILOG · KYC UNIFICADO — um só sítio para TODAS as verificações de identidade e documentos,
-- para TODOS os utilizadores. 2026-10-21. IDEMPOTENTE (pode repetir-se sem perder dados).
--
-- Corre DEPOIS de: schema.sql, migrations/* e o SQL de afiliados/verificação (sql-afiliados.html).
-- Instalação pelo telemóvel: /sql-kyc.html. Documentação: KYC.md.
--
-- O que faz:
--   • Tabelas novas: kyc_requests (um pedido = finalidade + estado), kyc_files (documentos no bucket
--     PRIVADO "verificacoes", frente/verso), kyc_events (histórico completo por utilizador) e
--     kyc_staff_perms (permissão KYC_REVIEW para revisores que não são admin).
--   • Finalidades: identidade (geral), vendedor (contas/diamantes), afiliado (afiliado/moderador),
--     levantamento e criador. Estados: pendente → em_analise → aprovado | recusado | mais_documentos.
--   • Migra SEM APAGAR as verificações de vendedor (seller_verifications) e os pedidos de nível KYC
--     (kyc_submissions, bucket kyc-docs) para a fila única. As tabelas antigas ficam intactas.
--   • As funções antigas (seller_verification_*) passam a usar a fila única; seller__verified (usada pelos
--     anúncios de contas/diamantes, lojas e pagamentos a vendedores) lê o estado unificado.
--   • Ficheiros: só o dono e os revisores autorizados (admin ou KYC_REVIEW) os podem ler (RLS no Storage).
--   • Todas as decisões ficam na auditoria (app_audit_log, área 'kyc', e audit_log) e o utilizador é notificado.
--   • NÃO toca em licença IGJ, interruptores de dinheiro real/apostas, pagamentos, ClicPay, M-Pesa nem depósitos.
--     Os pedidos KYC das apostas (bet_kyc) aparecem na fila só para leitura; a decisão continua a usar a função
--     já existente das apostas (bets_admin_kyc_review), sem alterações.
-- =====================================================================

do $$ begin
  if to_regclass('public.profiles') is null or to_regclass('public.notifications') is null or to_regclass('public.audit_log') is null then
    raise exception 'Corre primeiro o schema.sql.';
  end if;
  if to_regclass('public.seller_verifications') is null or to_regprocedure('public.seller__verified(uuid)') is null then
    raise exception 'Corre primeiro o SQL de afiliados/verificação (sql-afiliados.html).';
  end if;
end $$;

create extension if not exists pgcrypto;

-- 1. Tabelas da fila única ------------------------------------------------------------------------------
create table if not exists public.kyc_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('identidade','vendedor','afiliado','levantamento','criador')),
  doc_type text not null default 'outro',
  status text not null default 'pendente' check (status in ('pendente','em_analise','aprovado','recusado','mais_documentos')),
  note text not null default '' check (length(note) <= 500),
  reason text not null default '' check (length(reason) <= 500),
  source text not null default 'perfil' check (source in ('perfil','vendedor','kyc_nivel','migrado_vendedor','migrado_kyc')),
  legacy_ref text,
  reviewer_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists kyc_requests_legacy_uq on public.kyc_requests (legacy_ref) where legacy_ref is not null;
create index if not exists kyc_requests_user_idx on public.kyc_requests (user_id, submitted_at desc);
create index if not exists kyc_requests_status_idx on public.kyc_requests (status, submitted_at);
create index if not exists kyc_requests_purpose_idx on public.kyc_requests (purpose, status);

create table if not exists public.kyc_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.kyc_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null default 'verificacoes' check (bucket in ('verificacoes','kyc-docs')),
  path text not null,
  doc_type text not null check (doc_type in ('bi','passaporte','carta_conducao','dire','nuit','comprovativo_morada','selfie','selfie_documento','outro','documento')),
  side text not null default 'unico' check (side in ('frente','verso','unico')),
  created_at timestamptz not null default now()
);
create unique index if not exists kyc_files_path_uq on public.kyc_files (bucket, path);
create index if not exists kyc_files_request_idx on public.kyc_files (request_id);

create table if not exists public.kyc_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.kyc_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists kyc_events_user_idx on public.kyc_events (user_id, created_at desc);
create index if not exists kyc_events_request_idx on public.kyc_events (request_id, id);

create table if not exists public.kyc_staff_perms (
  user_id uuid not null references public.profiles(id) on delete cascade,
  perm text not null check (perm in ('KYC_REVIEW')),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, perm)
);

-- 2. Permissões, auditoria e regras ----------------------------------------------------------------------
-- Revisor = admin (todas as permissões) ou quem tem KYC_REVIEW. Conta banida/eliminada não revê.
create or replace function public.kyc__can_review() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from profiles where id = auth.uid() and not banned and deleted_at is null)
    and (public.is_admin() or exists (select 1 from kyc_staff_perms where user_id = auth.uid() and perm = 'KYC_REVIEW')) $$;

-- Auditoria: app_audit_log (área 'kyc', antes/depois) quando existe + audit_log (Admin › Auditoria). Nunca guarda ficheiros.
create or replace function public.kyc__audit(p_action text, p_target text, p_before jsonb default null, p_after jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare h text := coalesce((select handle from profiles where id = auth.uid()), case when auth.uid() is null then 'sistema' else '' end);
begin
  if to_regclass('public.app_audit_log') is not null then
    execute 'insert into public.app_audit_log (area, action, target, actor_id, actor_handle, before, after) values ($1, $2, $3, $4, $5, $6, $7)'
      using 'kyc', left(p_action, 80), left(coalesce(p_target, ''), 200), auth.uid(), h, p_before, p_after;
  end if;
  insert into audit_log (actor_id, actor_handle, action, target) values (auth.uid(), h, left(p_action, 80), left(coalesce(p_target, ''), 200));
end $$;

create or replace function public.kyc__event(p_req uuid, p_user uuid, p_action text, p_from text, p_to text, p_reason text default '') returns void
language sql security definer set search_path = public as $$
  insert into kyc_events (request_id, user_id, actor_id, action, from_status, to_status, reason)
  values (p_req, p_user, auth.uid(), p_action, p_from, p_to, left(coalesce(p_reason, ''), 500)) $$;

-- Documentos de identidade com foto e selfies
create or replace function public.kyc__is_id_doc(p text) returns boolean language sql immutable as $$
  select p in ('bi','passaporte','carta_conducao','dire','documento') $$;
create or replace function public.kyc__is_selfie(p text) returns boolean language sql immutable as $$
  select p in ('selfie','selfie_documento') $$;

-- Transições permitidas (o revisor). mais_documentos → pendente só acontece quando o utilizador envia mais ficheiros.
create or replace function public.kyc__can_transition(p_from text, p_to text) returns boolean language sql immutable as $$
  select case p_from
    when 'pendente' then p_to in ('em_analise','aprovado','recusado','mais_documentos')
    when 'em_analise' then p_to in ('aprovado','recusado','mais_documentos')
    when 'mais_documentos' then p_to in ('recusado','em_analise')
    else false end $$;

-- Estado verificado por finalidade (fonte única para todos os bloqueios):
--   vendedor / afiliado / levantamento → pedido aprovado de uma destas finalidades (todas exigem documento + selfie)
--                                         ou verificação de vendedor antiga aprovada
--   criador     → o anterior ou pedido de criador aprovado (exige documento)
--   identidade  → qualquer pedido aprovado
create or replace function public.kyc__verified(p_user uuid, p_purpose text default 'identidade') returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from kyc_requests r where r.user_id = p_user and r.status = 'aprovado' and (
      case coalesce(p_purpose, 'identidade')
        when 'identidade' then true
        when 'criador' then r.purpose in ('vendedor','afiliado','levantamento','criador')
        else r.purpose in ('vendedor','afiliado','levantamento') end))
    or (coalesce(p_purpose, 'identidade') in ('identidade','criador','vendedor','afiliado','levantamento')
        and exists (select 1 from seller_verifications v where v.user_id = p_user and v.status = 'aprovado'))) $$;

-- Gate existente (anúncios de contas/diamantes, lojas, pagamentos a vendedores) passa a ler o estado unificado.
create or replace function public.seller__verified(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.kyc__verified(p_user, 'vendedor') $$;

-- 3. Storage: bucket privado "verificacoes" (dono + revisores leem), PDF permitido para comprovativos ------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verificacoes', 'verificacoes', false, 8388608, array['image/webp','image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = array['image/webp','image/jpeg','image/png','application/pdf'];
drop policy if exists verif_insert on storage.objects;
create policy verif_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'verificacoes' and name like (select auth.uid())::text || '/%');
drop policy if exists verif_read on storage.objects;
create policy verif_read on storage.objects for select to authenticated using (
  bucket_id = 'verificacoes' and (name like (select auth.uid())::text || '/%' or (select public.kyc__can_review())));
drop policy if exists verif_delete on storage.objects;
create policy verif_delete on storage.objects for delete to authenticated using (bucket_id = 'verificacoes' and (select public.kyc__can_review()));
-- Documentos antigos dos níveis KYC (bucket kyc-docs): dono + revisores
drop policy if exists "kyc leitura" on storage.objects;
create policy "kyc leitura" on storage.objects for select to authenticated
  using (bucket_id = 'kyc-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.kyc__can_review()));

-- 4. Migração dos dados existentes (sem apagar nada; repetir não duplica) --------------------------------
with ins as (
  insert into public.kyc_requests (user_id, purpose, doc_type, status, reason, source, legacy_ref, reviewer_id, reviewed_at, submitted_at, updated_at)
  select v.user_id, 'vendedor', 'documento', case v.status when 'rejeitado' then 'recusado' else v.status end, coalesce(v.reason, ''),
         'migrado_vendedor', 'seller:' || v.user_id::text, v.reviewed_by, v.reviewed_at, v.submitted_at, coalesce(v.reviewed_at, v.submitted_at)
  from public.seller_verifications v
  on conflict (legacy_ref) where legacy_ref is not null do nothing
  returning id, user_id, legacy_ref, status
), f as (
  insert into public.kyc_files (request_id, user_id, bucket, path, doc_type, side)
  select ins.id, ins.user_id, 'verificacoes', x.path, x.t, x.s
  from ins join public.seller_verifications v on 'seller:' || v.user_id::text = ins.legacy_ref
  cross join lateral (values (v.doc_path, 'documento', 'frente'), (v.selfie_path, 'selfie', 'unico')) x(path, t, s)
  where x.path is not null
  on conflict (bucket, path) do nothing
  returning 1
)
insert into public.kyc_events (request_id, user_id, action, to_status, reason)
select ins.id, ins.user_id, 'migrado', ins.status, 'verificação de vendedor anterior' from ins;

with ins as (
  insert into public.kyc_requests (user_id, purpose, doc_type, status, reason, source, legacy_ref, reviewer_id, reviewed_at, submitted_at, updated_at)
  select k.user_id, 'identidade', case k.kind when 'telefone' then 'outro' when 'selfie' then 'selfie_documento' else 'documento' end,
         case k.status when 'rejeitado' then 'recusado' else k.status end, coalesce(k.note, ''),
         'migrado_kyc', 'kyc:' || k.id, k.reviewed_by, case when k.status <> 'pendente' then k.created_at end, k.created_at, k.created_at
  from public.kyc_submissions k
  on conflict (legacy_ref) where legacy_ref is not null do nothing
  returning id, user_id, legacy_ref, status
), f as (
  insert into public.kyc_files (request_id, user_id, bucket, path, doc_type, side)
  select ins.id, ins.user_id, 'kyc-docs', k.doc_path, case k.kind when 'selfie' then 'selfie_documento' else 'documento' end, 'unico'
  from ins join public.kyc_submissions k on 'kyc:' || k.id = ins.legacy_ref
  where k.doc_path is not null
  on conflict (bucket, path) do nothing
  returning 1
)
insert into public.kyc_events (request_id, user_id, action, to_status, reason)
select ins.id, ins.user_id, 'migrado', ins.status, 'pedido de nível KYC anterior' from ins;

-- 5. Pedidos novos de nível KYC (página Segurança, kyc_submissions) entram também na fila única -----------
create or replace function public.kyc__tg_legacy_submission() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  insert into kyc_requests (user_id, purpose, doc_type, status, source, legacy_ref, submitted_at)
  values (new.user_id, 'identidade', case new.kind when 'telefone' then 'outro' when 'selfie' then 'selfie_documento' else 'documento' end,
          'pendente', 'kyc_nivel', 'kyc:' || new.id, new.created_at)
  on conflict (legacy_ref) where legacy_ref is not null do nothing returning id into rid;
  if rid is not null then
    if new.doc_path is not null then
      insert into kyc_files (request_id, user_id, bucket, path, doc_type) values (rid, new.user_id, 'kyc-docs', new.doc_path,
        case new.kind when 'selfie' then 'selfie_documento' else 'documento' end) on conflict (bucket, path) do nothing;
    end if;
    perform public.kyc__event(rid, new.user_id, 'enviado', null, 'pendente', case new.kind when 'telefone' then 'nível 1 (telemóvel)' else 'nível ' || new.level end);
  end if;
  return null;
end $$;
drop trigger if exists kyc_unified_mirror on public.kyc_submissions;
create trigger kyc_unified_mirror after insert on public.kyc_submissions for each row execute function public.kyc__tg_legacy_submission();

-- A aprovação de um nível antigo continua a subir o nível; a notificação passa a ser enviada pela fila única.
create or replace function public.tg_kyc_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'aprovado' and old.status <> 'aprovado' then
    insert into security_settings (user_id, kyc_level) values (new.user_id, new.level)
    on conflict (user_id) do update set kyc_level = greatest(security_settings.kyc_level, new.level);
  end if;
  if tg_op = 'INSERT' then new.status := 'pendente'; new.user_id := auth.uid(); end if;
  return new;
end $$;

-- 6. Utilizador: enviar, completar e consultar ------------------------------------------------------------
-- p_files: [{"path":"<uid>/kyc-....webp","doc_type":"bi","side":"frente"}, ...] — ficheiros já carregados no bucket.
create or replace function public.kyc__check_files(p_uid uuid, p_files jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare f jsonb; re text := '^' || p_uid::text || '/[A-Za-z0-9._-]{1,100}\.(webp|jpe?g|png|pdf)$'; paths text[] := '{}';
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) < 1 or jsonb_array_length(p_files) > 12 then return 'FILES'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    if coalesce(f->>'path', '') !~ re then return 'FILES'; end if;
    if coalesce(f->>'doc_type', '') not in ('bi','passaporte','carta_conducao','dire','nuit','comprovativo_morada','selfie','selfie_documento','outro','documento') then return 'DOC_TYPE'; end if;
    if coalesce(f->>'side', 'unico') not in ('frente','verso','unico') then return 'FILES'; end if;
    if (f->>'path') = any(paths) then return 'FILES'; end if;
    paths := paths || (f->>'path');
  end loop;
  if (select count(*) from storage.objects where bucket_id = 'verificacoes' and name = any(paths)) < array_length(paths, 1) then return 'FILES_MISSING'; end if;
  if exists (select 1 from kyc_files where bucket = 'verificacoes' and path = any(paths)) then return 'FILES'; end if;
  return null;
end $$;

create or replace function public.kyc_submit(p_purpose text, p_files jsonb, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); err text; rid uuid; types text[]; main text;
begin
  if uid is null or not public.is_active_user() then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if p_purpose is null or p_purpose not in ('identidade','vendedor','afiliado','levantamento','criador') then return jsonb_build_object('ok', false, 'code', 'PURPOSE'); end if;
  if length(coalesce(p_note, '')) > 500 then return jsonb_build_object('ok', false, 'code', 'NOTE'); end if;
  err := public.kyc__check_files(uid, p_files);
  if err is not null then return jsonb_build_object('ok', false, 'code', err); end if;
  select array_agg(x->>'doc_type') into types from jsonb_array_elements(p_files) x;
  if p_purpose in ('vendedor','afiliado','levantamento','criador') and not exists (select 1 from unnest(types) t where public.kyc__is_id_doc(t)) then
    return jsonb_build_object('ok', false, 'code', 'NEED_ID');
  end if;
  if p_purpose in ('vendedor','afiliado','levantamento') and not exists (select 1 from unnest(types) t where public.kyc__is_selfie(t)) then
    return jsonb_build_object('ok', false, 'code', 'NEED_SELFIE');
  end if;
  perform pg_advisory_xact_lock(hashtext('kyc:' || uid::text));
  if exists (select 1 from kyc_requests where user_id = uid and purpose = p_purpose and status in ('pendente','em_analise','mais_documentos')) then
    return jsonb_build_object('ok', false, 'code', 'OPEN');
  end if;
  if public.kyc__verified(uid, p_purpose) and p_purpose <> 'identidade' then return jsonb_build_object('ok', false, 'code', 'ALREADY'); end if;
  if (select count(*) from kyc_requests where user_id = uid and submitted_at > now() - interval '1 day') >= 6 then return jsonb_build_object('ok', false, 'code', 'RATE'); end if;
  select t into main from unnest(types) t order by public.kyc__is_id_doc(t) desc, public.kyc__is_selfie(t) limit 1;
  insert into kyc_requests (user_id, purpose, doc_type, note, source) values (uid, p_purpose, main, trim(coalesce(p_note, '')),
    case when p_purpose = 'vendedor' then 'vendedor' else 'perfil' end) returning id into rid;
  insert into kyc_files (request_id, user_id, path, doc_type, side)
  select rid, uid, x->>'path', x->>'doc_type', coalesce(x->>'side', 'unico') from jsonb_array_elements(p_files) x;
  perform public.kyc__event(rid, uid, 'enviado', null, 'pendente', '');
  perform public.kyc__audit('kyc:enviado', rid::text, null, jsonb_build_object('user', uid, 'purpose', p_purpose, 'files', jsonb_array_length(p_files)));
  return jsonb_build_object('ok', true, 'id', rid, 'status', 'pendente');
end $$;

-- Enviar documentos em falta (pedido em "mais_documentos" ou ainda pendente) → volta a pendente.
create or replace function public.kyc_add_files(p_request uuid, p_files jsonb, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r kyc_requests; err text;
begin
  if uid is null or not public.is_active_user() then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into r from kyc_requests where id = p_request for update;
  if r.id is null or r.user_id <> uid then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if r.status not in ('mais_documentos','pendente') then return jsonb_build_object('ok', false, 'code', 'STATE'); end if;
  if length(coalesce(p_note, '')) > 500 then return jsonb_build_object('ok', false, 'code', 'NOTE'); end if;
  err := public.kyc__check_files(uid, p_files);
  if err is not null then return jsonb_build_object('ok', false, 'code', err); end if;
  if (select count(*) from kyc_files where request_id = r.id) + jsonb_array_length(p_files) > 20 then return jsonb_build_object('ok', false, 'code', 'FILES'); end if;
  insert into kyc_files (request_id, user_id, path, doc_type, side)
  select r.id, uid, x->>'path', x->>'doc_type', coalesce(x->>'side', 'unico') from jsonb_array_elements(p_files) x;
  update kyc_requests set status = 'pendente', note = case when trim(coalesce(p_note, '')) <> '' then trim(p_note) else note end, updated_at = now() where id = r.id;
  perform public.kyc__event(r.id, uid, 'documentos_adicionados', r.status, 'pendente', trim(coalesce(p_note, '')));
  perform public.kyc__audit('kyc:documentos_adicionados', r.id::text, jsonb_build_object('status', r.status), jsonb_build_object('status', 'pendente', 'files', jsonb_array_length(p_files)));
  return jsonb_build_object('ok', true, 'status', 'pendente');
end $$;

create or replace function public.kyc_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', auth.uid() is not null,
    'verified', jsonb_build_object(
      'identidade', public.kyc__verified(auth.uid(), 'identidade'), 'vendedor', public.kyc__verified(auth.uid(), 'vendedor'),
      'afiliado', public.kyc__verified(auth.uid(), 'afiliado'), 'levantamento', public.kyc__verified(auth.uid(), 'levantamento'),
      'criador', public.kyc__verified(auth.uid(), 'criador')),
    'kyc_level', coalesce((select kyc_level from security_settings where user_id = auth.uid()), 0),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'purpose', r.purpose, 'doc_type', r.doc_type, 'status', r.status, 'note', r.note,
        'reason', r.reason, 'source', r.source, 'submitted_at', r.submitted_at, 'updated_at', r.updated_at, 'reviewed_at', r.reviewed_at,
        'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'bucket', f.bucket, 'path', f.path, 'doc_type', f.doc_type, 'side', f.side, 'at', f.created_at) order by f.created_at)
                  from kyc_files f where f.request_id = r.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'from', e.from_status, 'to', e.to_status, 'reason', e.reason, 'at', e.created_at) order by e.id)
                  from kyc_events e where e.request_id = r.id), '[]'::jsonb)) order by r.submitted_at desc)
      from kyc_requests r where r.user_id = auth.uid()), '[]'::jsonb)) $$;

-- 7. Revisores: fila, detalhe, decisões e permissões --------------------------------------------------
-- Fila única: pedidos unificados + pedidos KYC das apostas (bet_kyc, só leitura aqui).
create or replace function public.kyc_admin_list(p_status text default null, p_purpose text default null, p_doc_type text default null,
  p_from timestamptz default null, p_to timestamptz default null, p_q text default null, p_limit integer default 100, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := lower(trim(coalesce(p_q, ''))); lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if not public.kyc__can_review() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true,
    'counts', (select jsonb_object_agg(s, n) from (select status s, count(*) n from kyc_requests group by status) c),
    'items', coalesce((select jsonb_agg(x) from (
      select * from (
        select 'kyc' as kind, r.id::text as id, r.user_id, p.handle, p.display_name, r.purpose, r.doc_type, r.status, r.source, r.reason, r.note,
               r.submitted_at, r.updated_at, (select count(*) from kyc_files f where f.request_id = r.id) as files,
               (select array_agg(distinct f.doc_type) from kyc_files f where f.request_id = r.id) as doc_types
        from kyc_requests r join profiles p on p.id = r.user_id
        union all
        select 'apostas', 'bet:' || b.user_id::text, b.user_id, p.handle, p.display_name, 'levantamento', lower(b.id_type),
               case b.status when 'recusado' then 'recusado' else b.status end, 'apostas', b.note, '', b.submitted_at, coalesce(b.reviewed_at, b.submitted_at), 0,
               array[lower(b.id_type)]
        from bet_kyc b join profiles p on p.id = b.user_id
      ) u
      where (coalesce(p_status, '') = '' or u.status = p_status)
        and (coalesce(p_purpose, '') = '' or u.purpose = p_purpose)
        and (coalesce(p_doc_type, '') = '' or u.doc_type = p_doc_type or p_doc_type = any(u.doc_types))
        and (p_from is null or u.submitted_at >= p_from) and (p_to is null or u.submitted_at < p_to)
        and (q = '' or lower(u.handle) like '%' || replace(q, '@', '') || '%' or lower(coalesce(u.display_name, '')) like '%' || q || '%' or u.user_id::text = q)
      order by case u.status when 'pendente' then 0 when 'em_analise' then 1 when 'mais_documentos' then 2 else 3 end, u.submitted_at
      limit lim offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end $$;

create or replace function public.kyc_admin_get(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r kyc_requests;
begin
  if not public.kyc__can_review() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into r from kyc_requests where id = p_request;
  if r.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  perform public.kyc__audit('kyc:ver_documentos', r.id::text, null, jsonb_build_object('user', r.user_id));
  return jsonb_build_object('ok', true,
    'request', to_jsonb(r) || jsonb_build_object('handle', (select handle from profiles where id = r.user_id), 'display_name', (select display_name from profiles where id = r.user_id),
      'reviewer', (select handle from profiles where id = r.reviewer_id)),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'bucket', f.bucket, 'path', f.path, 'doc_type', f.doc_type, 'side', f.side, 'at', f.created_at) order by f.created_at)
      from kyc_files f where f.request_id = r.id), '[]'::jsonb),
    'verified', jsonb_build_object('identidade', public.kyc__verified(r.user_id, 'identidade'), 'vendedor', public.kyc__verified(r.user_id, 'vendedor')),
    'kyc_level', coalesce((select kyc_level from security_settings where user_id = r.user_id), 0),
    -- Histórico completo do utilizador: todos os pedidos e todos os eventos
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'purpose', h.purpose, 'status', h.status, 'reason', h.reason, 'submitted_at', h.submitted_at, 'source', h.source) order by h.submitted_at desc)
      from kyc_requests h where h.user_id = r.user_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('request_id', e.request_id, 'action', e.action, 'from', e.from_status, 'to', e.to_status, 'reason', e.reason, 'at', e.created_at,
        'actor', (select handle from profiles where id = e.actor_id)) order by e.id desc)
      from kyc_events e where e.user_id = r.user_id), '[]'::jsonb),
    'bet_kyc', (select jsonb_build_object('status', b.status, 'id_type', b.id_type, 'full_name', b.full_name, 'submitted_at', b.submitted_at) from bet_kyc b where b.user_id = r.user_id));
end $$;

-- Decisão: em_analise | aprovado | recusado | mais_documentos. Motivo obrigatório (mín. 5) para aprovar, recusar e pedir documentos.
create or replace function public.kyc_admin_review(p_request uuid, p_action text, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r kyc_requests; why text := left(trim(coalesce(p_reason, '')), 500); lvl integer := 0; doc text; selfie text; msg text;
  lab text;
begin
  if not public.kyc__can_review() then
    perform public.kyc__audit('kyc:negado', coalesce(p_request::text, ''), null, jsonb_build_object('action', p_action));
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_action is null or p_action not in ('em_analise','aprovado','recusado','mais_documentos') then return jsonb_build_object('ok', false, 'code', 'ACTION'); end if;
  if p_action <> 'em_analise' and length(why) < 5 then return jsonb_build_object('ok', false, 'code', 'REASON'); end if;
  select * into r from kyc_requests where id = p_request for update;
  if r.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if not public.kyc__can_transition(r.status, p_action) then return jsonb_build_object('ok', false, 'code', 'STATE', 'status', r.status); end if;
  -- Quem enviou o pedido não decide o próprio pedido
  if r.user_id = auth.uid() and p_action <> 'em_analise' then return jsonb_build_object('ok', false, 'code', 'SELF'); end if;

  update kyc_requests set status = p_action, reason = case when p_action = 'em_analise' then reason else why end,
    reviewer_id = auth.uid(), reviewed_at = case when p_action in ('aprovado','recusado') then now() else reviewed_at end, updated_at = now()
  where id = r.id;
  perform public.kyc__event(r.id, r.user_id, 'decisao:' || p_action, r.status, p_action, why);
  perform public.kyc__audit('kyc:' || p_action, r.id::text, jsonb_build_object('status', r.status, 'user', r.user_id, 'purpose', r.purpose),
    jsonb_build_object('status', p_action, 'reason', why));

  if p_action = 'aprovado' then
    -- Nível KYC (limites diários): documento de identidade → 2; + selfie com documento → 3
    if exists (select 1 from kyc_files where request_id = r.id and public.kyc__is_id_doc(doc_type)) then lvl := 2; end if;
    if lvl = 2 and exists (select 1 from kyc_files where request_id = r.id and doc_type = 'selfie_documento') then lvl := 3; end if;
    if lvl > 0 then
      insert into security_settings (user_id, kyc_level) values (r.user_id, lvl)
      on conflict (user_id) do update set kyc_level = greatest(security_settings.kyc_level, lvl);
    end if;
    -- Compatibilidade: verificação de vendedor antiga também fica aprovada (finalidades com documento + selfie)
    if r.purpose in ('vendedor','afiliado','levantamento') then
      select path into doc from kyc_files where request_id = r.id and bucket = 'verificacoes' and public.kyc__is_id_doc(doc_type) order by created_at limit 1;
      select path into selfie from kyc_files where request_id = r.id and bucket = 'verificacoes' and public.kyc__is_selfie(doc_type) order by created_at limit 1;
      if doc is not null and selfie is not null then
        insert into seller_verifications (user_id, doc_path, selfie_path, status, reason, reviewed_by, reviewed_at)
        values (r.user_id, doc, selfie, 'aprovado', '', auth.uid(), now())
        on conflict (user_id) do update set doc_path = excluded.doc_path, selfie_path = excluded.selfie_path, status = 'aprovado', reason = '',
          reviewed_by = auth.uid(), reviewed_at = now();
      end if;
    end if;
  end if;
  -- Pedido de nível antigo: o estado em kyc_submissions acompanha (aprovar sobe o nível pelo gatilho existente)
  if r.legacy_ref like 'kyc:%' and p_action in ('aprovado','recusado') then
    update kyc_submissions set status = case when p_action = 'aprovado' then 'aprovado' else 'rejeitado' end, note = why, reviewed_by = auth.uid()
    where id = substr(r.legacy_ref, 5) and status = 'pendente';
  end if;

  lab := case r.purpose when 'vendedor' then 'de vendedor' when 'afiliado' then 'de afiliado/moderador' when 'levantamento' then 'para levantamentos'
    when 'criador' then 'de criador' else 'de identidade' end;
  msg := case p_action
    when 'aprovado' then '✅ Verificação ' || lab || ' aprovada.' || case when r.purpose = 'vendedor' then ' Já podes vender contas e diamantes.' else '' end
    when 'recusado' then '❌ Verificação ' || lab || ' recusada: ' || left(why, 200)
    when 'mais_documentos' then '📄 Verificação ' || lab || ': precisamos de mais documentos — ' || left(why, 200)
    else '🔎 A tua verificação ' || lab || ' está em análise.' end;
  insert into notifications (user_id, type, body, href) values (r.user_id, 'sistema', msg, '/seguranca/verificacao');
  return jsonb_build_object('ok', true, 'status', p_action);
end $$;

-- Dar/tirar a permissão KYC_REVIEW (só admin)
create or replace function public.kyc_admin_grant(p_user uuid, p_grant boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if not exists (select 1 from profiles where id = p_user) then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if coalesce(p_grant, false) then
    insert into kyc_staff_perms (user_id, perm, granted_by) values (p_user, 'KYC_REVIEW', auth.uid()) on conflict do nothing;
  else
    delete from kyc_staff_perms where user_id = p_user and perm = 'KYC_REVIEW';
  end if;
  perform public.kyc__audit(case when p_grant then 'kyc:permissao_dada' else 'kyc:permissao_retirada' end, p_user::text, null, jsonb_build_object('perm', 'KYC_REVIEW'));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kyc_admin_staff() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'handle', p.handle, 'granted_at', s.granted_at) order by s.granted_at)
    from kyc_staff_perms s join profiles p on p.id = s.user_id where s.perm = 'KYC_REVIEW'), '[]'::jsonb));
end $$;

-- 8. Funções antigas de vendedor passam pela fila única (os ecrãs antigos continuam a funcionar) -----------
create or replace function public.seller_verification_submit(p_doc text, p_selfie text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_doc is null or p_selfie is null or p_doc = p_selfie then return jsonb_build_object('ok', false, 'code', 'FILES'); end if;
  if public.kyc__verified(auth.uid(), 'vendedor') then return jsonb_build_object('ok', false, 'code', 'ALREADY'); end if;
  return public.kyc_submit('vendedor', jsonb_build_array(jsonb_build_object('path', p_doc, 'doc_type', 'documento', 'side', 'frente'),
    jsonb_build_object('path', p_selfie, 'doc_type', 'selfie', 'side', 'unico')), '');
end $$;

-- Estado de vendedor no vocabulário antigo (nenhuma/pendente/aprovado/rejeitado) + estado unificado
create or replace function public.seller_verification_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when public.kyc__verified(auth.uid(), 'vendedor') then jsonb_build_object('status', 'aprovado', 'kyc_status', 'aprovado', 'reason', '')
    else coalesce((select jsonb_build_object('status', case r.status when 'aprovado' then 'aprovado' when 'recusado' then 'rejeitado' when 'mais_documentos' then 'rejeitado' else 'pendente' end,
        'kyc_status', r.status, 'request_id', r.id, 'reason', r.reason, 'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at)
      from kyc_requests r where r.user_id = auth.uid() and r.purpose in ('vendedor','afiliado','levantamento') order by r.submitted_at desc limit 1),
      jsonb_build_object('status', 'nenhuma', 'kyc_status', 'nenhuma')) end $$;

create or replace function public.seller_verification_admin_list(p_status text default 'pendente') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.kyc__can_review() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(x order by x.submitted_at) from (
    select r.id as request_id, r.user_id, p.handle, p.display_name,
      (select path from kyc_files f where f.request_id = r.id and public.kyc__is_id_doc(f.doc_type) order by created_at limit 1) as doc_path,
      (select path from kyc_files f where f.request_id = r.id and public.kyc__is_selfie(f.doc_type) order by created_at limit 1) as selfie_path,
      case r.status when 'recusado' then 'rejeitado' when 'aprovado' then 'aprovado' else 'pendente' end as status, r.reason, r.submitted_at, r.reviewed_at
    from kyc_requests r join profiles p on p.id = r.user_id
    where r.purpose = 'vendedor' and (coalesce(p_status, '') = ''
      or (p_status = 'pendente' and r.status in ('pendente','em_analise','mais_documentos'))
      or (p_status = 'rejeitado' and r.status = 'recusado') or r.status = p_status)
    order by r.submitted_at limit 200) x), '[]'::jsonb));
end $$;

create or replace function public.seller_verification_review(p_user uuid, p_approve boolean, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.kyc__can_review() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select id into rid from kyc_requests where user_id = p_user and purpose = 'vendedor' and status in ('pendente','em_analise','mais_documentos') order by submitted_at desc limit 1;
  if rid is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  return public.kyc_admin_review(rid, case when p_approve then 'aprovado' else 'recusado' end,
    case when p_approve and length(trim(coalesce(p_reason, ''))) < 5 then 'Documentos conferidos' else p_reason end);
end $$;

-- 9. RLS e permissões --------------------------------------------------------------------------------
alter table public.kyc_requests enable row level security;
alter table public.kyc_files enable row level security;
alter table public.kyc_events enable row level security;
alter table public.kyc_staff_perms enable row level security;
drop policy if exists kyc_requests_read on public.kyc_requests;
create policy kyc_requests_read on public.kyc_requests for select to authenticated using (user_id = (select auth.uid()) or (select public.kyc__can_review()));
drop policy if exists kyc_files_read on public.kyc_files;
create policy kyc_files_read on public.kyc_files for select to authenticated using (user_id = (select auth.uid()) or (select public.kyc__can_review()));
drop policy if exists kyc_events_read on public.kyc_events;
create policy kyc_events_read on public.kyc_events for select to authenticated using (user_id = (select auth.uid()) or (select public.kyc__can_review()));
drop policy if exists kyc_staff_perms_read on public.kyc_staff_perms;
create policy kyc_staff_perms_read on public.kyc_staff_perms for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
-- Escrita só pelas funções (SECURITY DEFINER)
revoke all on public.kyc_requests, public.kyc_files, public.kyc_events, public.kyc_staff_perms from anon, authenticated;
grant select on public.kyc_requests, public.kyc_files, public.kyc_events, public.kyc_staff_perms to authenticated;

revoke all on function public.kyc__audit(text, text, jsonb, jsonb), public.kyc__event(uuid, uuid, text, text, text, text),
  public.kyc__check_files(uuid, jsonb), public.kyc__tg_legacy_submission(), public.kyc__verified(uuid, text), public.seller__verified(uuid)
  from public, anon, authenticated;
revoke all on function public.kyc_submit(text, jsonb, text), public.kyc_add_files(uuid, jsonb, text), public.kyc_me(),
  public.kyc_admin_list(text, text, text, timestamptz, timestamptz, text, integer, integer), public.kyc_admin_get(uuid),
  public.kyc_admin_review(uuid, text, text), public.kyc_admin_grant(uuid, boolean), public.kyc_admin_staff(), public.kyc__can_review(),
  public.seller_verification_submit(text, text), public.seller_verification_me(), public.seller_verification_admin_list(text),
  public.seller_verification_review(uuid, boolean, text) from public, anon;
grant execute on function public.kyc_submit(text, jsonb, text), public.kyc_add_files(uuid, jsonb, text), public.kyc_me(),
  public.kyc_admin_list(text, text, text, timestamptz, timestamptz, text, integer, integer), public.kyc_admin_get(uuid),
  public.kyc_admin_review(uuid, text, text), public.kyc_admin_grant(uuid, boolean), public.kyc_admin_staff(), public.kyc__can_review(),
  public.seller_verification_submit(text, text), public.seller_verification_me(), public.seller_verification_admin_list(text),
  public.seller_verification_review(uuid, boolean, text) to authenticated;
grant execute on function public.kyc__is_id_doc(text), public.kyc__is_selfie(text), public.kyc__can_transition(text, text) to authenticated;

notify pgrst, 'reload schema';
