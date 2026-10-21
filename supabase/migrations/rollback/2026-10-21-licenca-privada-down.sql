-- =====================================================================
-- TXAPILOG · ROLLBACK de "Licença IGJ privada" (2026-10-21-licenca-privada.sql). Idempotente.
--
-- ATENÇÃO — lê antes de correr:
-- • Volta a ABRIR a fuga: anon/authenticated voltam a ter SELECT na tabela bet_settings inteira, incluindo
--   igj_licence_no / igj_licence_date / igj_licence_expiry (GET /rest/v1/bet_settings?select=igj_licence_no).
-- • bets_admin_set_real_money volta à versão de 2026-10-10-bets-money.sql (grava nº e datas em bet_admin_log).
-- • Os registos antigos de bet_admin_log que foram limpos NÃO são repostos (o nº não foi guardado em lado nenhum).
-- • Apaga só a função bets_admin_settings(). Não apaga tabelas nem dados.
-- • A app continua a funcionar: o Admin, sem a função, volta a ler bet_settings com select('*').
-- =====================================================================

drop function if exists public.bets_admin_settings();

revoke all (igj_licence_no, igj_licence_date, igj_licence_expiry) on public.bet_settings from anon, authenticated, public;
grant select on public.bet_settings to anon, authenticated;
drop policy if exists bet_settings_read on public.bet_settings;
create policy bet_settings_read on public.bet_settings for select using (true);

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
  perform public.bets__log(case when p_on then 'dinheiro_real_ligado' else 'dinheiro_real_desligado' end, 'bet_settings',
    jsonb_build_object('licenca', trim(p_licence_no), 'emissao', p_issue, 'validade', p_expiry));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.bets_admin_set_real_money(boolean, text, date, date, text) to anon, authenticated;

notify pgrst, 'reload schema';
