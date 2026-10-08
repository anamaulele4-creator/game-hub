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
notify pgrst, 'reload schema';
