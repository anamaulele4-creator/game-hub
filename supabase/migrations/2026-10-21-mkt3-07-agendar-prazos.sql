-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 7 — Prazos automáticos (mkt_sweep) com pg_cron. 2026-10-21. IDEMPOTENTE.
--
-- Agenda `select public.mkt_sweep();` a cada 5 minutos (job 'mkt-sweep'): cancela pedidos não pagos fora do prazo
-- (liberta o stock) e conclui automaticamente entregas sem resposta do comprador depois dos dias definidos em
-- Admin › Marketplace › Tarifas. Corre dentro da base de dados (não precisa de pg_net nem de segredos).
-- Se o pg_cron não existir/não puder ser ativado, este SQL NÃO falha: só avisa, e o botão
-- "Processar prazos agora" (Gestão › Definições) continua a funcionar como antes.
--
-- Ver:      select * from cron.job where jobname = 'mkt-sweep';
--           select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'mkt-sweep') order by start_time desc limit 5;
-- Desligar: select cron.unschedule('mkt-sweep');
-- =====================================================================

do $$ begin
  if to_regprocedure('public.mkt_sweep()') is null then raise exception 'Corre primeiro as Partes 1–6 do Marketplace 3.0.'; end if;
end $$;

-- 1. Ativar o pg_cron se estiver disponível (no Supabase está; noutros Postgres pode não estar) -------------------
do $$ begin
  if to_regnamespace('cron') is null and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron não pôde ser ativado (%). Usa o botão "Processar prazos agora".', sqlerrm;
    end;
  end if;
end $$;

-- 2. Agendar (substitui um agendamento anterior com o mesmo nome; nunca duplica) ------------------------------------
do $$ begin
  if to_regnamespace('cron') is not null and to_regclass('cron.job') is not null then
    begin
      execute $q$ select cron.unschedule(jobid) from cron.job where jobname = 'mkt-sweep' $q$;
      execute $q$ select cron.schedule('mkt-sweep', '*/5 * * * *', 'select public.mkt_sweep()') $q$;
    exception when others then
      raise notice 'Não foi possível agendar mkt-sweep (%). Usa o botão "Processar prazos agora".', sqlerrm;
    end;
  else
    raise notice 'pg_cron não está disponível: os prazos só são processados pelo botão "Processar prazos agora".';
  end if;
end $$;

-- 3. Estado do agendamento para o painel de gestão (SETTINGS_MANAGE) ------------------------------------------------
create or replace function public.mkt_admin_sweep_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j record; l_status text; l_time timestamptz; has_cron boolean := to_regclass('cron.job') is not null;
begin
  if not public.mkt__can('SETTINGS_MANAGE') then return public.mkt__err('FORBIDDEN'); end if;
  if not has_cron then return jsonb_build_object('ok', true, 'cron', false, 'scheduled', false); end if;
  execute $q$ select jobid, schedule, active from cron.job where jobname = 'mkt-sweep' limit 1 $q$ into j;
  if j.jobid is null then return jsonb_build_object('ok', true, 'cron', true, 'scheduled', false); end if;
  begin
    execute $q$ select status, start_time from cron.job_run_details where jobid = $1 order by start_time desc limit 1 $q$ into l_status, l_time using j.jobid;
  exception when others then l_status := null; l_time := null;
  end;
  return jsonb_build_object('ok', true, 'cron', true, 'scheduled', true, 'schedule', j.schedule, 'active', j.active,
    'last_status', l_status, 'last_run', l_time);
end $$;
revoke all on function public.mkt_admin_sweep_status() from public, anon;
grant execute on function public.mkt_admin_sweep_status() to authenticated;

notify pgrst, 'reload schema';
