-- =====================================================================
-- TXAPILOG · Reconciliação automática de depósitos (ClicPay / M-Pesa) — 2026-10-20. IDEMPOTENTE.
--
-- Porquê: a ClicPay não envia callback para C2B M-Pesa/e-Mola. Antes, o crédito só acontecia enquanto a
-- página /carteira estava aberta. Este job chama a Edge Function payments/reconcile a cada 2 minutos; ela
-- consulta o fornecedor e credita via comp__confirm_deposit (idempotente: nunca credita duas vezes).
--
-- Corre DEPOIS de competitive.sql. Pode repetir-se.
-- Nenhum segredo está escrito aqui: o valor vive no Supabase Vault (nome 'reconcile_secret').
-- Se ainda não existir, este script cria-o com um valor aleatório.
--
-- PASSO ÚNICO DO DONO (depois de correr este SQL):
--   1. No SQL Editor:  select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_secret';
--   2. Copia o valor e cola-o em Supabase → Edge Functions → Secrets → RECONCILE_SECRET (Add/Update).
--   (Se RECONCILE_SECRET já existir na função, em vez disso põe esse valor no Vault:
--    select vault.update_secret((select id from vault.secrets where name = 'reconcile_secret'), '<valor>');)
--
-- Ver se funciona:  select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'payments-reconcile') order by start_time desc limit 5;
--                   select status_code, content from net._http_response order by created desc limit 5;
-- Desligar:         select cron.unschedule('payments-reconcile');
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Segredo partilhado no Vault (só é criado se ainda não existir; nunca é sobrescrito)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'reconcile_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'reconcile_secret',
      'Cabeçalho x-reconcile-secret da Edge Function payments/reconcile (igual ao segredo RECONCILE_SECRET da função)');
  end if;
end $$;

-- Job a cada 2 minutos. O segredo é lido do Vault no momento de cada execução (não fica no texto do job).
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'payments-reconcile';
  perform cron.schedule('payments-reconcile', '*/2 * * * *', $job$
    select net.http_post(
      url := 'https://nmdauzpbwnepmqyafaqs.supabase.co/functions/v1/payments/reconcile',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reconcile-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_secret' limit 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000);
  $job$);
end $$;

select jobname, schedule, active from cron.job where jobname = 'payments-reconcile';
