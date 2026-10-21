-- 18. Permissões da API (projetos Supabase novos não dão acesso automático às tabelas)
-- A segurança continua garantida pelas regras RLS de cada tabela.
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
-- Exceção: definições de segurança da carteira só por colunas
revoke all on public.security_settings from anon, authenticated;
grant select (user_id, pin_set_at, pin_failed, pin_locked_until, anti_phishing_code, withdrawals_locked_until, frozen, frozen_at, kyc_level, code_fallback, new_device_alerts, updated_at)
  on public.security_settings to authenticated;
grant update (code_fallback, new_device_alerts) on public.security_settings to authenticated;
-- Exceção: bet_settings só por colunas — a licença IGJ (igj_licence_*) nunca é legível pela API (2026-10-21-licenca-privada.sql)
do $$ begin
  if to_regclass('public.bet_settings') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bet_settings' and column_name = 'igj_licence_expiry') then
    execute 'revoke all on public.bet_settings from anon, authenticated, public';
    execute 'revoke all (igj_licence_no, igj_licence_date, igj_licence_expiry) on public.bet_settings from anon, authenticated, public';
    execute 'grant select (id, margin, min_stake, max_stake, max_payout, max_legs, weekly_allowance, elo_k, big_stake_alert, same_selection_alert,
      real_money_enabled, bets_enabled, mt_min_stake, mt_max_stake, mt_max_payout, mt_min_withdraw, mt_max_withdraw_daily, updated_at)
      on public.bet_settings to anon, authenticated';
  end if;
end $$;
notify pgrst, 'reload schema';
