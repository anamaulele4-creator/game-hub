-- =====================================================================
-- TXAPILOG · Moderadores (influenciadores), afiliados, torneios/campeonatos por moderadores,
-- destaque no marketplace e verificação de vendedores (documento + selfie) — 2026-10-20. IDEMPOTENTE.
--
-- Corre DEPOIS de: schema.sql, migrations/* (até 2026-10-10-*) e competitive.sql.
-- Documentação: AFILIADOS.md. Instalação pelo telemóvel: /sql-afiliados.html.
--
-- Decisões:
--   • Comissão = bónus PAGO PELA PLATAFORMA ao padrinho (moderador/admin). O convidado fica com 100 % do ganho.
--   • Só há comissão quando o convidado GANHA: lucro líquido de apostas em MT (pagamento − valor apostado),
--     vitórias em apostas de desafios, vendas concluídas no marketplace (valor do vendedor sem a taxa),
--     prémios de torneios e campeonatos. Registos, depósitos, perdas e compras não geram nada.
--   • Idempotente: unique (source_kind, source_ref) em affiliate_commissions + livro-razão money_ledger
--     (unique user/reason/ref). Reabrir uma aposta ganha anula a comissão com um lançamento 'correcao'.
--   • Dinheiro real continua DESLIGADO: a comissão entra na carteira MT existente (créditos internos).
-- =====================================================================

-- 1. Perfis: código de afiliado, padrinho (definido uma única vez) e permissão de destaque -------------
alter table public.profiles add column if not exists affiliate_code text;
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists referred_at timestamptz;
alter table public.profiles add column if not exists feature_revoked boolean not null default false;
alter table public.profiles drop constraint if exists profiles_affiliate_code_format;
alter table public.profiles add constraint profiles_affiliate_code_format check (affiliate_code is null or affiliate_code ~ '^[A-Z0-9]{4,16}$');
alter table public.profiles drop constraint if exists profiles_no_self_referral;
alter table public.profiles add constraint profiles_no_self_referral check (referred_by is null or referred_by <> id);
create unique index if not exists profiles_affiliate_code_uq on public.profiles (affiliate_code) where affiliate_code is not null;
create index if not exists profiles_referred_by_idx on public.profiles (referred_by) where referred_by is not null;

create or replace function public.aff__norm_code(p text) returns text
language sql immutable set search_path = public as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- No registo: o padrinho vem SÓ do link/código guardado nos metadados do auth (raw_user_meta_data.ref).
-- O cliente nunca escolhe referred_by/affiliate_code diretamente.
create or replace function public.aff__tg_profile_ins() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text; r uuid;
begin
  new.affiliate_code := null; new.referred_by := null; new.referred_at := null; new.feature_revoked := false;
  begin
    select public.aff__norm_code(raw_user_meta_data->>'ref') into c from auth.users where id = new.id;
  exception when others then c := null; end;
  if c ~ '^[A-Z0-9]{4,16}$' then
    select id into r from profiles where affiliate_code = c;
    if r is not null and r <> new.id then new.referred_by := r; new.referred_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists aff_profile_ins on public.profiles;
create trigger aff_profile_ins before insert on public.profiles for each row execute function public.aff__tg_profile_ins();

-- Atualizações: referred_by/affiliate_code só mudam por funções do servidor (gamehub.trusted = 1);
-- feature_revoked só pelo admin.
create or replace function public.aff__tg_profile_upd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(current_setting('gamehub.trusted', true), '') <> '1' then
    new.referred_by := old.referred_by; new.referred_at := old.referred_at; new.affiliate_code := old.affiliate_code;
    if not public.is_admin() then new.feature_revoked := old.feature_revoked; end if;
  end if;
  if old.referred_by is not null then new.referred_by := old.referred_by; new.referred_at := old.referred_at; end if; -- definido uma única vez
  return new;
end $$;
drop trigger if exists aff_profile_upd on public.profiles;
create trigger aff_profile_upd before update on public.profiles for each row execute function public.aff__tg_profile_upd();

-- 2. Definições e livro de comissões ---------------------------------------------------------------
create table if not exists public.affiliate_settings (
  id integer primary key default 1 check (id = 1),
  commission_pct numeric(5,2) not null default 10 check (commission_pct >= 0 and commission_pct <= 50),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.affiliate_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete restrict,
  invitee_id uuid not null references public.profiles(id) on delete restrict,
  source_kind text not null check (source_kind in ('aposta','desafio','venda','torneio','campeonato')),
  source_ref text not null,
  gain_mzn integer not null check (gain_mzn > 0),
  pct numeric(5,2) not null,
  amount_mzn integer not null check (amount_mzn > 0),
  status text not null default 'creditado' check (status in ('creditado','anulado')),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  unique (source_kind, source_ref),
  check (referrer_id <> invitee_id)
);
create index if not exists affiliate_commissions_referrer_idx on public.affiliate_commissions (referrer_id, created_at desc);
create index if not exists affiliate_commissions_invitee_idx on public.affiliate_commissions (invitee_id);

-- Só o estado pode mudar (creditado → anulado); o resto é imutável.
create or replace function public.aff__tg_commission_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'AFF_IMMUTABLE'; end if;
  if (new.referrer_id, new.invitee_id, new.source_kind, new.source_ref, new.gain_mzn, new.pct, new.amount_mzn, new.created_at)
     is distinct from (old.referrer_id, old.invitee_id, old.source_kind, old.source_ref, old.gain_mzn, old.pct, old.amount_mzn, old.created_at)
     or not (old.status = 'creditado' and new.status in ('creditado','anulado')) then
    raise exception 'AFF_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists aff_commission_guard on public.affiliate_commissions;
create trigger aff_commission_guard before update or delete on public.affiliate_commissions for each row execute function public.aff__tg_commission_guard();

-- 3. Livro-razão: novo motivo 'comissao_afiliado' ----------------------------------------------------
alter table public.money_ledger drop constraint if exists money_ledger_reason_check;
alter table public.money_ledger add constraint money_ledger_reason_check
  check (reason in ('deposito','levantamento','levantamento_recusado','aposta','ganho','reembolso','correcao','ajuste','comissao_afiliado'));

-- 4. Crédito e anulação (internos, nunca chamados pelo cliente) ---------------------------------------
create or replace function public.affiliate__credit(p_invitee uuid, p_kind text, p_ref text, p_gain integer) returns integer
language plpgsql security definer set search_path = public as $$
declare st affiliate_settings; rid uuid; rrole text; rbanned boolean; amt integer; cid uuid;
begin
  if p_invitee is null or p_ref is null or coalesce(p_gain, 0) <= 0 then return 0; end if;
  if p_kind not in ('aposta','desafio','venda','torneio','campeonato') then return 0; end if;
  select * into st from affiliate_settings where id = 1;
  if st.id is null or not st.enabled then return 0; end if;
  select referred_by into rid from profiles where id = p_invitee;
  if rid is null or rid = p_invitee then return 0; end if;
  select role, banned into rrole, rbanned from profiles where id = rid;
  if rrole is null or rrole not in ('moderator','admin') or rbanned then return 0; end if; -- só influenciadores (moderador) e admin
  amt := floor(p_gain::numeric * st.commission_pct / 100);
  if amt < 1 then return 0; end if;
  insert into affiliate_commissions (referrer_id, invitee_id, source_kind, source_ref, gain_mzn, pct, amount_mzn)
    values (rid, p_invitee, p_kind, p_ref, p_gain, st.commission_pct, amt)
    on conflict (source_kind, source_ref) do nothing returning id into cid;
  if cid is null then return 0; end if; -- já pago (idempotente)
  perform public.bets__post_mt(rid, amt, 'comissao_afiliado', p_kind || ':' || p_ref);
  insert into notifications (user_id, type, body, href) values (rid, 'sistema', '💸 Comissão de afiliado: +' || amt || ' MT', '/afiliados');
  return amt;
end $$;

create or replace function public.affiliate__reverse(p_kind text, p_ref text) returns integer
language plpgsql security definer set search_path = public as $$
declare c affiliate_commissions;
begin
  select * into c from affiliate_commissions where source_kind = p_kind and source_ref = p_ref and status = 'creditado' for update;
  if c.id is null then return 0; end if;
  update affiliate_commissions set status = 'anulado', voided_at = now() where id = c.id;
  perform public.bets__post_mt(c.referrer_id, -c.amount_mzn, 'correcao', 'aff-rev:' || c.id::text);
  return c.amount_mzn;
end $$;

-- Erros nas comissões nunca bloqueiam o ganho do convidado (subtransação + registo em audit_log).
create or replace function public.aff__safe_credit(p_invitee uuid, p_kind text, p_ref text, p_gain integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.affiliate__credit(p_invitee, p_kind, p_ref, p_gain);
exception when others then
  insert into audit_log (actor_id, actor_handle, action, target) values (null, 'sistema', 'afiliado:erro', p_kind || ':' || p_ref || ' ' || left(sqlerrm, 200));
end $$;

-- 5. Ganchos: apostas (e desafios), vendas, prémios ----------------------------------------------------
create or replace function public.aff__tg_bet() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := 'aposta';
begin
  begin
    if exists (select 1 from bet_legs l join bet_markets m on m.id = l.market_id join bet_matches x on x.id = m.match_id
               where l.bet_id = new.id and x.challenge_id is not null) then k := 'desafio'; end if;
  exception when others then k := 'aposta'; end;
  if new.currency = 'mt' and new.status = 'ganha' and old.status is distinct from 'ganha' and new.payout > new.stake then
    perform public.aff__safe_credit(new.user_id, k, new.id::text || ':' || new.version, new.payout - new.stake); -- lucro líquido
  elsif old.status = 'ganha' and new.status is distinct from 'ganha' then
    perform public.affiliate__reverse(k, old.id::text || ':' || old.version); -- aposta reaberta/corrigida
  end if;
  return null;
end $$;
drop trigger if exists aff_bet on public.bets;
create trigger aff_bet after update of status on public.bets for each row execute function public.aff__tg_bet();

create or replace function public.aff__tg_market_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'concluido' and old.status is distinct from 'concluido' then
    perform public.aff__safe_credit(new.seller_id, 'venda', new.id::text, new.total_mzn - floor(new.total_mzn * coalesce(new.fee_pct, 0) / 100)::integer);
  end if;
  return null;
end $$;
drop trigger if exists aff_market_order on public.market_orders;
create trigger aff_market_order after update of status on public.market_orders for each row execute function public.aff__tg_market_order();

-- 6. Torneios e campeonatos criados por moderadores ---------------------------------------------------
alter table public.tournaments add column if not exists kind text not null default 'torneio';
alter table public.tournaments drop constraint if exists tournaments_kind_check;
alter table public.tournaments add constraint tournaments_kind_check check (kind in ('torneio','campeonato'));

create or replace function public.aff__tg_prize() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select case when kind = 'campeonato' then 'campeonato' else 'torneio' end into k from tournaments where id = new.tournament_id;
  perform public.aff__safe_credit(new.user_id, coalesce(k, 'torneio'), new.id, new.amount_mzn);
  return null;
end $$;
drop trigger if exists aff_prize on public.tournament_prizes;
create trigger aff_prize after insert on public.tournament_prizes for each row execute function public.aff__tg_prize();

-- Quem pode criar: admin, organizadores (AI CORE) e moderadores. 'criador' e 'utilizador' só participam.
create or replace function public.tx__can_create_tournament() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_mod() or public.tx__can_organize() $$;
create or replace function public.tx__owns_tournament(p_tournament text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_mod() and exists (select 1 from tournaments where id = p_tournament and created_by = auth.uid()) $$;

create or replace function public.tx__tg_tournament_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if; -- contadores de inscrições (tg_entry_count)
  if auth.uid() is null or public.tx__can_organize() then
    if tg_op = 'INSERT' and new.created_by is null then new.created_by := auth.uid(); end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.entries_count := 0;
    new.organizer := coalesce((select '@' || handle from profiles where id = auth.uid()), new.organizer);
  else
    new.created_by := old.created_by; new.entries_count := old.entries_count; new.organizer := old.organizer;
  end if;
  return new;
end $$;
drop trigger if exists tournament_owner on public.tournaments;
create trigger tournament_owner before insert or update on public.tournaments for each row execute function public.tx__tg_tournament_owner();

drop policy if exists mod_tournaments_insert on public.tournaments;
create policy mod_tournaments_insert on public.tournaments for insert to authenticated
  with check ((select public.is_mod()) and created_by = (select auth.uid()));
drop policy if exists mod_tournaments_update on public.tournaments;
create policy mod_tournaments_update on public.tournaments for update to authenticated
  using ((select public.is_mod()) and created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
drop policy if exists mod_tournaments_delete on public.tournaments;
create policy mod_tournaments_delete on public.tournaments for delete to authenticated
  using ((select public.is_mod()) and created_by = (select auth.uid()));

drop policy if exists entries_read_owner on public.tournament_entries;
create policy entries_read_owner on public.tournament_entries for select to authenticated using (public.tx__owns_tournament(tournament_id));

create or replace function public.tournament_entry_admin(p_user uuid, p_tournament text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.tx__can_organize() or public.tx__owns_tournament(p_tournament)) then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  update tournament_entries set
    discord_verified = case p_action when 'discord_ok' then true when 'discord_nao' then false else discord_verified end,
    status = case p_action when 'confirmar' then 'confirmada' when 'pendente' then 'pendente' when 'cancelar' then 'cancelada' else status end,
    updated_at = now()
  where user_id = p_user and tournament_id = p_tournament;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  insert into audit_log (actor_id, actor_handle, action, target)
    values (auth.uid(), (select handle from profiles where id = auth.uid()), 'torneio:inscricao_' || p_action, p_tournament || ':' || p_user::text);
  return jsonb_build_object('ok', true);
end $$;

-- Capas dos torneios dos moderadores: media/tournaments/<uid>/…
drop policy if exists media_insert_mod_tournaments on storage.objects;
create policy media_insert_mod_tournaments on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and name like 'tournaments/' || (select auth.uid())::text || '/%' and (select public.is_mod()));

-- 7. Verificação de vendedores (documento + selfie, bucket PRIVADO) -----------------------------------
create table if not exists public.seller_verifications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  doc_path text not null,
  selfie_path text not null,
  status text not null default 'pendente' check (status in ('pendente','aprovado','rejeitado')),
  reason text not null default '' check (length(reason) <= 300),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz
);
create index if not exists seller_verifications_status_idx on public.seller_verifications (status, submitted_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verificacoes', 'verificacoes', false, 5242880, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/webp','image/jpeg','image/png'];
drop policy if exists verif_insert on storage.objects;
create policy verif_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'verificacoes' and name like (select auth.uid())::text || '/%');
drop policy if exists verif_read on storage.objects;
create policy verif_read on storage.objects for select to authenticated using (bucket_id = 'verificacoes' and (select public.is_admin()));
drop policy if exists verif_delete on storage.objects;
create policy verif_delete on storage.objects for delete to authenticated using (bucket_id = 'verificacoes' and (select public.is_admin()));

create or replace function public.seller__verified(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from seller_verifications where user_id = p_user and status = 'aprovado') $$;

create or replace function public.seller_verification_submit(p_doc text, p_selfie text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur seller_verifications; re text;
begin
  if uid is null or not public.is_active_user() then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  re := '^' || uid::text || '/[A-Za-z0-9._-]{1,80}\.(webp|jpe?g|png)$';
  if p_doc is null or p_selfie is null or p_doc = p_selfie or p_doc !~ re or p_selfie !~ re then return jsonb_build_object('ok', false, 'code', 'FILES'); end if;
  if (select count(*) from storage.objects where bucket_id = 'verificacoes' and name in (p_doc, p_selfie)) < 2 then return jsonb_build_object('ok', false, 'code', 'FILES'); end if;
  select * into cur from seller_verifications where user_id = uid for update;
  if cur.status = 'aprovado' then return jsonb_build_object('ok', false, 'code', 'ALREADY'); end if;
  insert into seller_verifications (user_id, doc_path, selfie_path) values (uid, p_doc, p_selfie)
    on conflict (user_id) do update set doc_path = excluded.doc_path, selfie_path = excluded.selfie_path, status = 'pendente', reason = '',
      submitted_at = now(), reviewed_by = null, reviewed_at = null;
  insert into audit_log (actor_id, actor_handle, action, target) values (uid, (select handle from profiles where id = uid), 'verificacao:enviada', uid::text);
  return jsonb_build_object('ok', true, 'status', 'pendente');
end $$;

create or replace function public.seller_verification_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('status', status, 'reason', reason, 'submitted_at', submitted_at, 'reviewed_at', reviewed_at)
    from seller_verifications where user_id = auth.uid()), jsonb_build_object('status', 'nenhuma')) $$;

create or replace function public.seller_verification_admin_list(p_status text default 'pendente') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(x order by x.submitted_at) from (
    select v.user_id, p.handle, p.display_name, v.doc_path, v.selfie_path, v.status, v.reason, v.submitted_at, v.reviewed_at
    from seller_verifications v join profiles p on p.id = v.user_id
    where p_status is null or p_status = '' or v.status = p_status order by v.submitted_at limit 200) x), '[]'::jsonb));
end $$;

create or replace function public.seller_verification_review(p_user uuid, p_approve boolean, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v seller_verifications;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into v from seller_verifications where user_id = p_user for update;
  if v.user_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if not coalesce(p_approve, false) and length(trim(coalesce(p_reason, ''))) < 5 then return jsonb_build_object('ok', false, 'code', 'REASON'); end if;
  update seller_verifications set status = case when p_approve then 'aprovado' else 'rejeitado' end,
    reason = case when p_approve then '' else left(trim(p_reason), 300) end, reviewed_by = auth.uid(), reviewed_at = now() where user_id = p_user;
  insert into notifications (user_id, type, body, href) values (p_user, 'sistema',
    case when p_approve then '✅ Verificação de vendedor aprovada: já podes vender contas e diamantes.'
         else 'Verificação de vendedor recusada: ' || left(trim(p_reason), 200) end, '/marketplace/anunciar');
  insert into audit_log (actor_id, actor_handle, action, target)
    values (auth.uid(), (select handle from profiles where id = auth.uid()), 'verificacao:' || case when p_approve then 'aprovada' else 'rejeitada' end, p_user::text);
  return jsonb_build_object('ok', true);
end $$;

-- 8. Marketplace: destaque pelos moderadores + contas/diamantes só com vendedor verificado ------------
create or replace function public.market__can_feature(p_seller uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_seller = auth.uid() and exists (select 1 from profiles where id = p_seller and role in ('moderator','admin') and not banned and not feature_revoked) $$;

create or replace function public.market__tg_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare trusted boolean := public.is_admin() or auth.uid() is null;
begin
  if exists (select 1 from unnest(new.photos) p
    where p !~ '^art:[a-z0-9-]{2,12}$' and p !~ ('/storage/v1/object/public/media/products/' || new.seller_id::text || '/')) then
    raise exception 'PHOTOS';
  end if;
  if not trusted then
    if tg_op = 'UPDATE' then
      if new.featured is distinct from old.featured and not public.market__can_feature(new.seller_id) then raise exception 'FEATURE_FORBIDDEN'; end if;
      new.sales := old.sales;
      if old.status = 'removido' then new.status := 'removido'; end if;
    else
      if new.featured and not public.market__can_feature(new.seller_id) then new.featured := false; end if;
      new.sales := 0;
    end if;
    -- Contas e diamantes/moedas: vendedor com documento + selfie aprovados
    if (new.kind in ('conta','moedas') or new.category = 'moedas') and new.status <> 'removido'
       and (tg_op = 'INSERT' or new.kind is distinct from old.kind or new.category is distinct from old.category or (new.status = 'ativo' and old.status <> 'ativo'))
       and not public.seller__verified(new.seller_id) then
      raise exception 'SELLER_VERIFICATION';
    end if;
  end if;
  new.seller_name := coalesce((select display_name from profiles where id = new.seller_id), '');
  new.updated_at := now();
  return new;
end $$;

-- Admin retira a permissão de destaque → os destaques desse moderador saem logo
create or replace function public.aff__tg_feature_revoked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.feature_revoked and not old.feature_revoked then
    update market_products set featured = false where seller_id = new.id and featured;
  end if;
  return null;
end $$;
drop trigger if exists aff_feature_revoked on public.profiles;
create trigger aff_feature_revoked after update of feature_revoked on public.profiles for each row execute function public.aff__tg_feature_revoked();

-- 9. RPCs do afiliado ----------------------------------------------------------------------------------
create or replace function public.affiliate__new_code(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare base text; c text; i int := 0;
begin
  select affiliate_code, left(public.aff__norm_code(handle), 8) into c, base from profiles where id = p_user;
  if c is not null then return c; end if;
  if length(coalesce(base, '')) < 2 then base := 'TXAP'; end if;
  loop
    c := base || upper(substr(md5(random()::text || clock_timestamp()::text || p_user::text), 1, 4));
    exit when not exists (select 1 from profiles where affiliate_code = c);
    i := i + 1; if i > 20 then c := upper(substr(md5(random()::text), 1, 12)); exit; end if;
  end loop;
  perform set_config('gamehub.trusted', '1', true);
  update profiles set affiliate_code = c where id = p_user and affiliate_code is null;
  perform set_config('gamehub.trusted', '', true);
  return (select affiliate_code from profiles where id = p_user);
end $$;

create or replace function public.affiliate_apply_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c text := public.aff__norm_code(p_code); me profiles; r profiles;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  if c !~ '^[A-Z0-9]{4,16}$' then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  select * into me from profiles where id = uid;
  if me.referred_by is not null then return jsonb_build_object('ok', false, 'code', 'ALREADY'); end if;
  select * into r from profiles where affiliate_code = c;
  if r.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if r.id = uid then return jsonb_build_object('ok', false, 'code', 'SELF'); end if;
  if r.referred_by = uid then return jsonb_build_object('ok', false, 'code', 'CYCLE'); end if;
  if me.created_at < now() - interval '7 days' then return jsonb_build_object('ok', false, 'code', 'TOO_LATE'); end if;
  perform set_config('gamehub.trusted', '1', true);
  update profiles set referred_by = r.id, referred_at = now() where id = uid and referred_by is null;
  perform set_config('gamehub.trusted', '', true);
  return jsonb_build_object('ok', true, 'referrer', r.handle);
end $$;

create or replace function public.affiliate_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p profiles; st affiliate_settings; el boolean; code text; inv jsonb; com jsonb; n int; tot int; pend int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'AUTH'); end if;
  select * into p from profiles where id = uid;
  select * into st from affiliate_settings where id = 1;
  el := p.role in ('moderator','admin') and not p.banned;
  code := p.affiliate_code;
  if el and code is null then code := public.affiliate__new_code(uid); end if;
  select count(*) into n from profiles where referred_by = uid;
  select coalesce(jsonb_agg(x order by x.joined desc), '[]') into inv from (
    select i.handle, i.display_name as name, i.created_at as joined,
      coalesce((select sum(amount_mzn) from affiliate_commissions c where c.invitee_id = i.id and c.referrer_id = uid and c.status = 'creditado'), 0) as earned
    from profiles i where i.referred_by = uid order by i.created_at desc limit 200) x;
  select coalesce(jsonb_agg(x order by x.at desc), '[]') into com from (
    select c.id, c.source_kind as kind, c.gain_mzn as gain, c.pct, c.amount_mzn as amount, c.status, c.created_at as at, i.handle as invitee
    from affiliate_commissions c join profiles i on i.id = c.invitee_id where c.referrer_id = uid order by c.created_at desc limit 200) x;
  select coalesce(sum(amount_mzn), 0) into tot from affiliate_commissions where referrer_id = uid and status = 'creditado';
  pend := 0;
  if el then
    select coalesce(floor(sum(o.total_mzn - floor(o.total_mzn * coalesce(o.fee_pct, 0) / 100)) * st.commission_pct / 100), 0) into pend
      from market_orders o join profiles i on i.id = o.seller_id where i.referred_by = uid and o.status in ('pago','entregue','disputa');
  end if;
  return jsonb_build_object('ok', true, 'eligible', el, 'code', case when el then code end, 'pct', st.commission_pct, 'enabled', st.enabled,
    'invited_count', n, 'invitees', inv, 'commissions', com, 'total', tot, 'pending', pend,
    'referred_by', (select handle from profiles where id = p.referred_by));
end $$;

create or replace function public.affiliate_admin_set_settings(p_pct numeric, p_enabled boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_pct is null or p_pct < 0 or p_pct > 50 then return jsonb_build_object('ok', false, 'code', 'PCT'); end if;
  update affiliate_settings set commission_pct = p_pct, enabled = coalesce(p_enabled, true), updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into audit_log (actor_id, actor_handle, action, target)
    values (auth.uid(), (select handle from profiles where id = auth.uid()), 'afiliados:definicoes', p_pct::text || '% ' || case when coalesce(p_enabled, true) then 'ligado' else 'desligado' end);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.affiliate_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true,
    'settings', (select jsonb_build_object('pct', commission_pct, 'enabled', enabled, 'updated_at', updated_at) from affiliate_settings where id = 1),
    'total_paid', coalesce((select sum(amount_mzn) from affiliate_commissions where status = 'creditado'), 0),
    'pending_verifications', (select count(*) from seller_verifications where status = 'pendente'),
    'referrers', coalesce((select jsonb_agg(x) from (
      select p.handle, p.role, (select count(*) from profiles i where i.referred_by = p.id) as invited,
        coalesce((select sum(amount_mzn) from affiliate_commissions c where c.referrer_id = p.id and c.status = 'creditado'), 0) as earned
      from profiles p where p.affiliate_code is not null order by earned desc limit 50) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x) from (
      select c.source_kind as kind, c.gain_mzn as gain, c.amount_mzn as amount, c.status, c.created_at as at, r.handle as referrer, i.handle as invitee
      from affiliate_commissions c join profiles r on r.id = c.referrer_id join profiles i on i.id = c.invitee_id order by c.created_at desc limit 50) x), '[]'::jsonb));
end $$;

-- 10. Carteira em tempo real (o saldo atualiza logo que o fornecedor confirma o depósito) ---------------
-- O crédito continua a acontecer SÓ em comp__confirm_deposit (service_role, webhook assinado), de forma atómica.
do $$ begin alter publication supabase_realtime add table public.money_ledger; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.payments; exception when others then null; end $$;

-- 11. RLS e permissões ---------------------------------------------------------------------------------
alter table public.affiliate_settings enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.seller_verifications enable row level security;
drop policy if exists affiliate_settings_read on public.affiliate_settings;
create policy affiliate_settings_read on public.affiliate_settings for select using (true);
drop policy if exists affiliate_commissions_read on public.affiliate_commissions;
create policy affiliate_commissions_read on public.affiliate_commissions for select to authenticated
  using (referrer_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists seller_verifications_read on public.seller_verifications;
create policy seller_verifications_read on public.seller_verifications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke insert, update, delete, truncate on public.affiliate_settings, public.affiliate_commissions, public.seller_verifications from anon, authenticated;
revoke all on public.affiliate_commissions, public.seller_verifications from anon;
grant select on public.affiliate_settings to anon, authenticated;
grant select on public.affiliate_commissions, public.seller_verifications to authenticated;

revoke all on function public.aff__tg_profile_ins(), public.aff__tg_profile_upd(), public.aff__tg_commission_guard(), public.affiliate__credit(uuid, text, text, integer),
  public.affiliate__reverse(text, text), public.aff__safe_credit(uuid, text, text, integer), public.aff__tg_bet(), public.aff__tg_market_order(), public.aff__tg_prize(),
  public.tx__tg_tournament_owner(), public.aff__tg_feature_revoked(), public.affiliate__new_code(uuid), public.seller__verified(uuid), public.market__can_feature(uuid)
  from public, anon, authenticated;
grant execute on function public.tx__can_create_tournament(), public.tx__owns_tournament(text), public.aff__norm_code(text) to anon, authenticated;
revoke all on function public.affiliate_apply_code(text), public.affiliate_me(), public.affiliate_admin_set_settings(numeric, boolean), public.affiliate_admin_overview(),
  public.seller_verification_submit(text, text), public.seller_verification_me(), public.seller_verification_admin_list(text),
  public.seller_verification_review(uuid, boolean, text) from public, anon;
grant execute on function public.affiliate_apply_code(text), public.affiliate_me(), public.affiliate_admin_set_settings(numeric, boolean), public.affiliate_admin_overview(),
  public.seller_verification_submit(text, text), public.seller_verification_me(), public.seller_verification_admin_list(text),
  public.seller_verification_review(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
