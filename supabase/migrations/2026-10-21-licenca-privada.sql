-- =====================================================================
-- TXAPILOG · Licença IGJ privada (2026-10-21). IDEMPOTENTE — pode correr várias vezes. NÃO apaga tabelas nem dados.
-- Corre DEPOIS de 2026-10-10-bets.sql + 2026-10-10-bets-money.sql (e de competitive.sql, se instalado).
--
-- Problema: bet_settings tinha "policy ... using (true)" + "grant select ... to anon, authenticated", por isso
-- qualquer pessoa conseguia GET /rest/v1/bet_settings?select=igj_licence_no. E bet_admin_log (que os organizadores
-- leem, via bets__can_manage) guardava o nº e as datas da licença sempre que o dinheiro real era ligado/desligado.
--
-- O que muda:
-- 1. Permissões por coluna: anon/authenticated deixam de ter SELECT na tabela inteira e passam a ter SELECT só nas
--    colunas sem licença (as mesmas que a app pede em PUBLIC_SETTINGS_COLUMNS + updated_at). Pedir igj_licence_no,
--    igj_licence_date, igj_licence_expiry (ou select=*) dá "permission denied". As funções SECURITY DEFINER
--    (bets_place, bets__real_active, bets_admin_*, comp_*) continuam a ler tudo, como antes.
-- 2. bets_admin_settings(): o Admin lê a linha completa por esta função (só is_admin()). Outros → FORBIDDEN.
-- 3. bets_admin_set_real_money: mesma assinatura e comportamento, mas o registo deixa de guardar nº/datas.
-- 4. Registos antigos de bet_admin_log: o nº passa a "[removido]" e as datas saem (a linha do registo fica).
-- 5. comp_licences continua só para admin (RLS reposta).
-- Desfazer: supabase/migrations/rollback/2026-10-21-licenca-privada-down.sql
-- =====================================================================

do $$ begin
  if to_regclass('public.bet_settings') is null then
    raise exception 'Falta a tabela bet_settings: corre primeiro 2026-10-10-bets.sql e 2026-10-10-bets-money.sql';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bet_settings' and column_name = 'igj_licence_expiry') then
    raise exception 'Falta a coluna igj_licence_expiry: corre primeiro 2026-10-10-bets-money.sql';
  end if;
end $$;

-- 1. bet_settings: público só lê colunas sem licença ------------------------------------------------------------
alter table public.bet_settings enable row level security;
revoke all on public.bet_settings from anon, authenticated, public;
revoke all (igj_licence_no, igj_licence_date, igj_licence_expiry) on public.bet_settings from anon, authenticated, public;
grant select (id, margin, min_stake, max_stake, max_payout, max_legs, weekly_allowance, elo_k, big_stake_alert, same_selection_alert,
  real_money_enabled, bets_enabled, mt_min_stake, mt_max_stake, mt_max_payout, mt_min_withdraw, mt_max_withdraw_daily, updated_at)
  on public.bet_settings to anon, authenticated;
-- a política de leitura (using true) mantém-se: quem limita agora são as permissões por coluna
drop policy if exists bet_settings_read on public.bet_settings;
create policy bet_settings_read on public.bet_settings for select using (true);

-- 2. Admin lê tudo por função própria -----------------------------------------------------------------------------
create or replace function public.bets_admin_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return jsonb_build_object('ok', true, 'settings', (select to_jsonb(s) from bet_settings s where id = 1));
end $$;
revoke all on function public.bets_admin_settings() from public, anon;
grant execute on function public.bets_admin_settings() to authenticated;

-- 3. Ligar/desligar dinheiro real sem gravar nº nem datas no registo (mesma assinatura e regras) -----------------
create or replace function public.bets_admin_set_real_money(p_on boolean, p_licence_no text, p_issue date, p_expiry date, p_confirm text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Africa/Maputo')::date; why text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p_on then
    why := case
      when length(trim(coalesce(p_licence_no, ''))) = 0 then 'sem número de licença'
      when p_issue is null or p_expiry is null then 'sem datas da licença'
      when p_issue > today then 'emissão no futuro'
      when p_expiry <= today then 'licença fora da validade'
      when p_expiry <= p_issue then 'validade antes da emissão'
      when upper(trim(coalesce(p_confirm, ''))) <> 'CONFIRMO' then 'sem confirmação explícita'
      else null end;
    if why is not null then
      perform public.bets__log('dinheiro_real_recusado', 'bet_settings', jsonb_build_object('motivo', why));
      return jsonb_build_object('ok', false, 'code', 'IGJ', 'reason', why);
    end if;
  end if;
  update bet_settings set igj_licence_no = coalesce(trim(p_licence_no), ''), igj_licence_date = p_issue, igj_licence_expiry = p_expiry,
    real_money_enabled = p_on, updated_at = now() where id = 1;
  -- só se regista QUE havia licença, nunca o número nem as datas (bet_admin_log é lido por organizadores)
  perform public.bets__log(case when p_on then 'dinheiro_real_ligado' else 'dinheiro_real_desligado' end, 'bet_settings',
    jsonb_build_object('licenca_indicada', length(trim(coalesce(p_licence_no, ''))) > 0));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.bets_admin_set_real_money(boolean, text, date, date, text) from public, anon;
grant execute on function public.bets_admin_set_real_money(boolean, text, date, date, text) to authenticated;

-- 4. Limpar registos antigos (nº → "[removido]", datas fora; a linha fica) -------------------------------------------
update public.bet_admin_log
  set details = (details - 'licenca' - 'emissao' - 'validade' - 'data')
    || case when details ? 'licenca' then jsonb_build_object('licenca', '[removido]') else '{}'::jsonb end
  where action like 'dinheiro\_real\_%' escape '\'
    and ((details ? 'licenca' and details->>'licenca' is distinct from '[removido]') or details ?| array['emissao', 'validade', 'data']);

-- 5. comp_licences continua só para admin (se o módulo competitivo estiver instalado) --------------------------------
do $$ begin
  if to_regclass('public.comp_licences') is not null then
    execute 'alter table public.comp_licences enable row level security';
    execute 'revoke all on public.comp_licences from anon, public';
    execute 'revoke insert, update, delete, truncate on public.comp_licences from authenticated';
    execute 'drop policy if exists comp_licences_read on public.comp_licences';
    execute 'create policy comp_licences_read on public.comp_licences for select using ((select public.is_admin()))';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Verificação (correr à parte; deve devolver false, false, false, true):
-- select has_column_privilege('anon', 'public.bet_settings', 'igj_licence_no', 'select') as anon_licenca,
--        has_column_privilege('authenticated', 'public.bet_settings', 'igj_licence_no', 'select') as auth_licenca,
--        has_table_privilege('anon', 'public.bet_settings', 'select') as anon_tabela_inteira,
--        has_column_privilege('anon', 'public.bet_settings', 'real_money_enabled', 'select') as anon_publico;
