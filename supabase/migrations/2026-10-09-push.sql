-- TXAPILOG · Notificações push com a app fechada
-- Depois de cada nova notificação ou mensagem, a base de dados chama a Edge Function send-push (pg_net, assíncrono).
create extension if not exists pg_net with schema extensions;

-- Segredo partilhado com a função (guardado no Vault, nunca no código)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'push_hook_secret') then
    perform vault.create_secret('<PUSH_HOOK_SECRET>', 'push_hook_secret', 'x-push-secret da Edge Function send-push');
  end if;
end $$;

create or replace function public.push_dispatch() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'push_hook_secret' limit 1;
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://nmdauzpbwnepmqyafaqs.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', s),
    body := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new) - 'meta' || jsonb_build_object('meta', coalesce(to_jsonb(new)->'meta', '{}'::jsonb) - 'wave')),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  return new; -- nunca bloquear o envio da mensagem/notificação por causa do push
end $$;
revoke all on function public.push_dispatch() from public, anon, authenticated;

drop trigger if exists push_on_notification on public.notifications;
create trigger push_on_notification after insert on public.notifications for each row execute function public.push_dispatch();

drop trigger if exists push_on_message on public.messages;
create trigger push_on_message after insert on public.messages for each row execute function public.push_dispatch();
