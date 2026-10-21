-- Apostas confirmadas são irrevogáveis (ordem do proprietário, 21/10/2026).
-- Depois de confirmada, o utilizador NÃO pode retirar, cancelar, editar nem reduzir o valor de uma aposta.
-- Só o admin/organizador anula (pelas funções existentes, com reembolso registado no razão, já auditadas).
--
-- O que já existia (verificado na base em 21/10/2026): sem UPDATE/DELETE para anon/authenticated em bets, bet_legs e
-- money_ledger; RLS só de leitura; termos bloqueados por comp__tg_bet_terms_lock / comp__tg_leg_terms_lock; razão
-- só de acréscimos (money_ledger_immutable); apv2_bets com apv2__tg_bet_lock. Nenhuma RPC de utilizador cancela ou
-- faz cashout. O que este ficheiro fecha:
--   (a) TRUNCATE estava concedido a anon/authenticated nas tabelas apv2_* (TRUNCATE ignora RLS e triggers de linha);
--   (b) não havia nada na base a impedir APAGAR uma aposta em aberto (só a falta de permissão).
-- Idempotente: pode correr-se mais de uma vez. Não mexe em interruptores (dinheiro real, apostas ligadas, licença)
-- nem na lógica das RPCs de apostas.

-- 1. Permissões: a API pública nunca escreve diretamente nas tabelas de apostas nem no razão
do $$
declare t text;
begin
  foreach t in array array['bets', 'bet_legs', 'money_ledger', 'apv2_bets', 'apv2_bet_events', 'apv2_test_ledger'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate on table public.%I from anon, authenticated, public', t);
    end if;
  end loop;
  -- TRUNCATE nunca é para a API: retira-o de todas as tabelas de apostas
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and (c.relname like 'bet%' or c.relname like 'apv2%') loop
    execute format('revoke truncate on table public.%I from anon, authenticated, public', t);
  end loop;
end $$;

-- 2. Uma aposta em aberto não pode desaparecer (nem por uma função futura com SECURITY DEFINER)
create or replace function public.bets__tg_no_delete_open() returns trigger
language plpgsql as $$
begin
  if old.status = 'aberta' then
    raise exception 'BET_LOCKED: aposta confirmada não pode ser retirada nem cancelada (só o admin/organizador anula, com reembolso)';
  end if;
  return old;
end $$;
drop trigger if exists bets_no_delete_open on public.bets;
create trigger bets_no_delete_open before delete on public.bets for each row execute function public.bets__tg_no_delete_open();

create or replace function public.bets__tg_leg_no_delete_open() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.bets b where b.id = old.bet_id and b.status = 'aberta') then
    raise exception 'BET_LOCKED: seleções de uma aposta confirmada não podem ser retiradas';
  end if;
  return old;
end $$;
drop trigger if exists bet_legs_no_delete_open on public.bet_legs;
create trigger bet_legs_no_delete_open before delete on public.bet_legs for each row execute function public.bets__tg_leg_no_delete_open();

-- 3. Valor e termos imutáveis também aqui (redundante com comp__tg_bet_terms_lock, de propósito: não depende do
--    SQL do Competitivo ter sido instalado). Muda só estado/pagamento, como na liquidação ou anulação.
create or replace function public.bets__tg_stake_lock() returns trigger
language plpgsql as $$
begin
  if (new.user_id, new.stake, new.currency, new.kind, new.created_at) is distinct from
     (old.user_id, old.stake, old.currency, old.kind, old.created_at) then
    raise exception 'BET_LOCKED: o valor e os termos de uma aposta confirmada não podem mudar';
  end if;
  return new;
end $$;
drop trigger if exists bets_stake_lock on public.bets;
create trigger bets_stake_lock before update on public.bets for each row execute function public.bets__tg_stake_lock();

-- 4. Apostas v3 (apv2_bets), se instaladas: uma aposta por confirmar/confirmada também não pode ser apagada
do $$
begin
  if to_regclass('public.apv2_bets') is not null then
    execute $f$
      create or replace function public.apv2__tg_no_delete() returns trigger
      language plpgsql as $b$
      begin
        if old.status in ('aberta', 'pendente_confirmacao', 'confirmada', 'em_andamento', 'em_analise') then
          raise exception 'BET_LOCKED: aposta confirmada não pode ser retirada nem cancelada';
        end if;
        return old;
      end $b$;
    $f$;
    execute 'drop trigger if exists apv2_bets_no_delete on public.apv2_bets';
    execute 'create trigger apv2_bets_no_delete before delete on public.apv2_bets for each row execute function public.apv2__tg_no_delete()';
  end if;
end $$;

-- 5. Funções-trigger não são para chamar pela API
revoke all on function public.bets__tg_no_delete_open(), public.bets__tg_leg_no_delete_open(), public.bets__tg_stake_lock() from public, anon, authenticated;
do $$ begin
  if to_regprocedure('public.apv2__tg_no_delete()') is not null then
    revoke all on function public.apv2__tg_no_delete() from public, anon, authenticated;
  end if;
end $$;
