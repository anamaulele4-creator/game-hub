-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 9 — Pagamento direto por M-Pesa/e-Mola no checkout. 2026-10-21. IDEMPOTENTE.
--
-- Reutiliza o fluxo de depósitos EXISTENTE (sem segredos novos e sem mudar a Edge Function "payments"):
--   1. mkt_pay_direct_start cria um depósito (public.payments, kind 'carteira') com o valor EXATO que falta
--      (total do pedido − saldo da carteira), ligado ao pagamento do pedido (mkt_direct_deposits).
--   2. O navegador pede à função payments/wallet-deposit para enviar o pedido ao telemóvel (como na /carteira).
--   3. O fornecedor confirma (webhook assinado, /wallet-deposit-check ou /reconcile a cada 2 min — sempre consulta
--      do SERVIDOR ao fornecedor, nunca o regresso do cliente) → comp__confirm_deposit credita a carteira.
--   4. No fim dessa mesma transação (trigger diferido), o servidor paga o pedido com a carteira (mesma função
--      atómica de mkt_pay). Idempotente: cada depósito paga no máximo uma vez; se o pedido já não puder ser pago
--      (expirou, cancelado, já pago), o dinheiro fica no saldo da carteira e o comprador é avisado.
--   Rede de segurança: mkt_sweep (agendado na Parte 7) volta a tentar ligações ainda por liquidar.
-- Só funciona com o interruptor "Pagamentos com dinheiro real" (mkt3_checkout_enabled) e com o fornecedor configurado;
-- caso contrário responde PAYMENT_UNAVAILABLE ("Pagamento ainda não disponível").
-- =====================================================================

do $$ begin
  if to_regprocedure('public.mkt_pay(uuid,text)') is null then raise exception 'Corre primeiro as Partes 1–6 do Marketplace 3.0.'; end if;
  if to_regprocedure('public.comp__confirm_deposit(text,text,text,text,text,integer,boolean,text)') is null then
    raise exception 'Falta o módulo de carteira/depósitos (competitive.sql).';
  end if;
end $$;

-- 1. Ligação depósito ↔ pagamento do pedido ------------------------------------------------------------------
create table if not exists public.mkt_direct_deposits (
  deposit_id text primary key references public.payments(id) on delete restrict,
  mkt_payment_id uuid not null references public.mkt_payments(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  amount_mzn integer not null check (amount_mzn > 0),
  method text not null check (method in ('M-Pesa','e-Mola')),
  status text not null default 'aguarda' check (status in ('aguarda','pago_pedido','saldo_na_carteira','falhou','substituido')),
  result jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists mkt_direct_deposits_payment_idx on public.mkt_direct_deposits (mkt_payment_id, created_at desc);
create index if not exists mkt_direct_deposits_open_idx on public.mkt_direct_deposits (status) where status = 'aguarda';

-- 2. Núcleo do pagamento com a carteira (igual a mkt_pay; usado também pelo servidor depois do depósito) ----------
create or replace function public.mkt__pay_core(p_uid uuid, p_payment uuid, p_source text default 'carteira') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p mkt_payments; bal integer; o record;
begin
  perform pg_advisory_xact_lock(hashtextextended('money:' || p_uid::text, 0));
  select * into p from mkt_payments where id = p_payment for update;
  if p.id is null or p.buyer_id <> p_uid then return public.mkt__err('NOT_FOUND'); end if;
  if p.status = 'confirmado' then return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'confirmado'); end if;
  if p.status not in ('pendente','recusado') then return public.mkt__err('STATE', jsonb_build_object('status', p.status)); end if;
  if p.expires_at < now() then
    perform public.mkt_sweep_expired(p_uid);
    return public.mkt__err('EXPIRED');
  end if;
  if exists (select 1 from market_orders where payment_id = p.id and status <> 'aguarda_pagamento') then return public.mkt__err('STATE'); end if;
  if p.status = 'recusado' then perform public.mkt__payment_status(p.id, 'pendente', 'nova_tentativa', '{}'); end if;
  bal := public.bets__balance_mt(p_uid);
  if bal < p.amount_mzn then
    perform public.mkt__payment_status(p.id, 'recusado', p_source, jsonb_build_object('reason', 'saldo insuficiente', 'saldo', bal, 'valor', p.amount_mzn));
    return public.mkt__err('BALANCE', jsonb_build_object('balance', bal, 'amount', p.amount_mzn));
  end if;
  perform public.bets__post_mt(p_uid, -p.amount_mzn, 'compra', 'mkt:' || p.id);
  perform public.mkt__post('pagamento:' || p.id, null, p.id, null, jsonb_build_array(
    jsonb_build_object('account', 'carteira', 'user_id', p_uid, 'amount', -p.amount_mzn, 'kind', 'pagamento_compra', 'description', 'Pagamento de compra'),
    jsonb_build_object('account', 'escrow', 'amount', p.amount_mzn, 'kind', 'pagamento_compra', 'description', 'Valor retido até à conclusão')), p_source);
  perform set_config('mkt.pay', '1', true);
  update mkt_payments set provider_ref = 'carteira:' || (select id from money_ledger where user_id = p_uid and reason = 'compra' and ref = 'mkt:' || p.id) where id = p.id;
  perform public.mkt__payment_status(p.id, 'confirmado', p_source, jsonb_build_object('valor', p.amount_mzn));
  for o in select id, seller_id, product_title, total_mzn from market_orders where payment_id = p.id loop
    perform public.mkt__set_status(o.id, 'pago', 'pagamento_confirmado', 'sistema', case when p_source = 'deposito_direto' then 'Pago por M-Pesa/e-Mola (confirmado pelo fornecedor)' else 'Pago com saldo da carteira' end);
    perform set_config('mkt.ctx', '1', true);
    update market_orders set expires_at = null where id = o.id;
    perform set_config('mkt.ctx', '', true);
    perform public.mkt__notify(o.seller_id, 'novo_pedido', 'Novo pedido pago: "' || left(o.product_title, 60) || '" (' || o.total_mzn || ' MT).', '/marketplace/pedido/?id=' || o.id, 'paid:' || o.id);
  end loop;
  perform public.mkt__notify(p_uid, 'pagamento_confirmado', 'Pagamento confirmado: ' || p.amount_mzn || ' MT. O valor fica retido até confirmares a receção.', '/marketplace/pedidos', 'paid-buyer:' || p.id);
  return jsonb_build_object('ok', true, 'status', 'confirmado', 'balance', public.bets__balance_mt(p_uid));
end $$;

-- mkt_pay passa a usar o núcleo (mesmo comportamento: idempotência por chave, interruptor, sessão)
create or replace function public.mkt_pay(p_payment uuid, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); prev jsonb; r jsonb;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if p_idem is null or length(p_idem) < 16 or length(p_idem) > 80 then return public.mkt__err('IDEMPOTENCY'); end if;
  prev := public.mkt__idem_get('pay:' || p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  if not public.mkt__flag('mkt3_checkout_enabled') then return public.mkt__err('PAYMENT_UNAVAILABLE'); end if;
  r := public.mkt__pay_core(uid, p_payment, 'carteira');
  if not coalesce((r->>'ok')::boolean, false) or coalesce((r->>'duplicate')::boolean, false) then return r; end if;
  return public.mkt__idem_put('pay:' || p_idem, 'pay', r);
end $$;

-- 3. Opções de pagamento direto (para o ecrã de checkout) -------------------------------------------------------
create or replace function public.mkt_pay_direct_options() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true,
    'enabled', public.mkt__flag('mkt3_checkout_enabled'),
    'mpesa', public.mkt__flag('mkt3_checkout_enabled') and public.comp__provider_ready('mpesa'),
    'emola', public.mkt__flag('mkt3_checkout_enabled') and public.comp__provider_ready('emola'),
    'balance', case when auth.uid() is null then 0 else public.bets__balance_mt(auth.uid()) end) $$;

-- 4. Iniciar: cria o depósito do valor em falta, ligado ao pagamento do pedido -----------------------------------
create or replace function public.mkt_pay_direct_start(p_payment uuid, p_method text, p_phone text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p mkt_payments; prev jsonb; bal integer; missing integer; pid text; cur mkt_direct_deposits; cur_status text; r jsonb;
  l bet_limits; d_sum integer; w_sum integer; m_sum integer;
  ph text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '^\+?258', '');
  prov text := case when p_method = 'e-Mola' then 'emola' else 'mpesa' end;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if p_idem is null or length(p_idem) < 16 or length(p_idem) > 80 then return public.mkt__err('IDEMPOTENCY'); end if;
  prev := public.mkt__idem_get('direct:' || p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  if not public.mkt__flag('mkt3_checkout_enabled') or not public.comp__provider_ready(prov) then return public.mkt__err('PAYMENT_UNAVAILABLE'); end if;
  if not public.is_active_user() then return public.mkt__err('ACCOUNT'); end if;
  if p_method not in ('M-Pesa','e-Mola') or (p_method = 'M-Pesa' and ph !~ '^8[45][0-9]{7}$') or (p_method = 'e-Mola' and ph !~ '^8[67][0-9]{7}$') then return public.mkt__err('PHONE'); end if;
  perform pg_advisory_xact_lock(hashtextextended('money:' || uid::text, 0));
  select * into p from mkt_payments where id = p_payment for update;
  if p.id is null or p.buyer_id <> uid then return public.mkt__err('NOT_FOUND'); end if;
  if p.status = 'confirmado' then return jsonb_build_object('ok', true, 'status', 'confirmado', 'duplicate', true); end if;
  if p.status not in ('pendente','recusado') then return public.mkt__err('STATE', jsonb_build_object('status', p.status)); end if;
  if p.expires_at < now() then perform public.mkt_sweep_expired(uid); return public.mkt__err('EXPIRED'); end if;
  if exists (select 1 from market_orders where payment_id = p.id and status <> 'aguarda_pagamento') then return public.mkt__err('STATE'); end if;
  bal := public.bets__balance_mt(uid);
  missing := p.amount_mzn - greatest(bal, 0);
  if missing <= 0 then return jsonb_build_object('ok', true, 'enough_balance', true, 'balance', bal); end if;

  -- Já há um depósito em curso para este pagamento?
  select * into cur from mkt_direct_deposits where mkt_payment_id = p.id and status = 'aguarda' order by created_at desc limit 1 for update;
  if cur.deposit_id is not null then
    select status into cur_status from payments where id = cur.deposit_id;
    if cur_status = 'em processamento' then return public.mkt__err('DIRECT_IN_PROGRESS', jsonb_build_object('deposit_id', cur.deposit_id)); end if;
    if cur_status = 'pendente' and cur.amount_mzn = missing and cur.method = p_method then
      return jsonb_build_object('ok', true, 'deposit_id', cur.deposit_id, 'amount_mzn', missing, 'msisdn', '258' || ph, 'reused', true);
    end if;
    -- depósito antigo nunca enviado ao telemóvel (ou valor diferente): substituído
    update payments set status = 'falhou', failure_reason = 'substituído por novo pedido' where id = cur.deposit_id and status = 'pendente';
    update mkt_direct_deposits set status = 'substituido', settled_at = now() where deposit_id = cur.deposit_id and status = 'aguarda';
  end if;

  if not public.mkt__rate('direct:' || uid, 6, 3600) then return public.mkt__err('RATE'); end if;
  -- Limites de depósito definidos pelo próprio utilizador (jogo responsável) também se aplicam aqui
  if to_regclass('public.bet_limits') is not null then
    begin
      perform public.comp__apply_pending_limits(uid);
    exception when undefined_function then null;
    end;
    select * into l from bet_limits where user_id = uid;
    select coalesce(sum(amount_mzn) filter (where created_at >= date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo'), 0),
           coalesce(sum(amount_mzn) filter (where created_at >= date_trunc('week', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo'), 0),
           coalesce(sum(amount_mzn) filter (where created_at >= date_trunc('month', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo'), 0)
      into d_sum, w_sum, m_sum from payments where user_id = uid and kind = 'carteira' and status in ('pendente','em processamento','pago');
    if (to_jsonb(l)->>'deposit_daily' is not null and d_sum + missing > (to_jsonb(l)->>'deposit_daily')::integer)
       or (to_jsonb(l)->>'deposit_weekly' is not null and w_sum + missing > (to_jsonb(l)->>'deposit_weekly')::integer)
       or (to_jsonb(l)->>'deposit_monthly' is not null and m_sum + missing > (to_jsonb(l)->>'deposit_monthly')::integer) then return public.mkt__err('DEPOSIT_LIMIT'); end if;
  end if;

  insert into payments (user_id, user_handle, kind, item, amount_mzn, method, status, idempotency_key, provider, phone_masked)
    values (uid, (select handle from profiles where id = uid), 'carteira', 'Marketplace · pagamento de pedido', missing, p_method, 'pendente', 'mktd-' || p_idem,
            prov, left(ph, 2) || '•••' || right(ph, 2)) returning id into pid;
  insert into mkt_direct_deposits (deposit_id, mkt_payment_id, buyer_id, amount_mzn, method) values (pid, p.id, uid, missing, p_method);
  -- Mais 30 minutos para aprovar no telemóvel (pedido e reserva de stock)
  perform set_config('mkt.pay', '1', true);
  update mkt_payments set expires_at = greatest(expires_at, now() + interval '30 minutes'), updated_at = now() where id = p.id;
  perform set_config('mkt.pay', '', true);
  perform set_config('mkt.ctx', '1', true);
  update market_orders set expires_at = greatest(expires_at, now() + interval '30 minutes') where payment_id = p.id and status = 'aguarda_pagamento';
  perform set_config('mkt.ctx', '', true);
  insert into mkt_payment_events (payment_id, from_status, to_status, source, detail, actor_id)
    values (p.id, p.status, p.status, 'deposito_direto', jsonb_build_object('deposito', pid, 'valor', missing, 'metodo', p_method), uid);
  perform public.mkt__audit('pagamento_direto_pedido', p.id::text, 'ok', null, null, jsonb_build_object('deposito', pid, 'valor', missing, 'metodo', p_method));
  r := jsonb_build_object('ok', true, 'deposit_id', pid, 'amount_mzn', missing, 'msisdn', '258' || ph);
  return public.mkt__idem_put('direct:' || p_idem, 'direct', r);
end $$;

-- Estado para o ecrã (o navegador consulta; quem decide é o servidor)
create or replace function public.mkt_pay_direct_status(p_payment uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from mkt_payments where id = p_payment and buyer_id = auth.uid()) then public.mkt__err('NOT_FOUND') else
    jsonb_build_object('ok', true, 'payment_status', (select status from mkt_payments where id = p_payment),
      'deposit', (select jsonb_build_object('id', d.deposit_id, 'amount_mzn', d.amount_mzn, 'method', d.method, 'link_status', d.status,
          'deposit_status', (select status from payments where id = d.deposit_id), 'code', d.result->>'code', 'at', d.created_at)
        from mkt_direct_deposits d where d.mkt_payment_id = p_payment order by d.created_at desc limit 1)) end $$;

-- 5. Liquidação no servidor depois de o fornecedor confirmar -----------------------------------------------------
create or replace function public.mkt__direct_settle(p_deposit text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d mkt_direct_deposits; dep payments; r jsonb; final text;
begin
  select * into d from mkt_direct_deposits where deposit_id = p_deposit for update;
  if d.deposit_id is null or d.status <> 'aguarda' then return jsonb_build_object('ok', true, 'skipped', true); end if;
  select * into dep from payments where id = p_deposit;
  if dep.status = 'falhou' then
    update mkt_direct_deposits set status = 'falhou', settled_at = now(), result = jsonb_build_object('code', 'DEPOSIT_FAILED') where deposit_id = p_deposit;
    perform public.mkt__notify(d.buyer_id, 'pagamento_recusado', 'O pagamento por ' || d.method || ' não foi concluído. Nada foi cobrado; podes tentar de novo em "Os meus pedidos".',
      '/marketplace/pedidos', 'direct-fail:' || p_deposit);
    return jsonb_build_object('ok', true, 'status', 'falhou');
  end if;
  -- Só depois de o depósito estar pago E creditado na carteira (lançamento real em money_ledger)
  if dep.status <> 'pago' or not exists (select 1 from money_ledger where user_id = d.buyer_id and reason = 'deposito' and ref like '%:' || dep.provider_ref) then
    return jsonb_build_object('ok', true, 'waiting', true);
  end if;
  begin
    r := public.mkt__pay_core(d.buyer_id, d.mkt_payment_id, 'deposito_direto');
  exception when others then
    r := jsonb_build_object('ok', false, 'code', 'ERRO', 'error', left(sqlerrm, 200));
  end;
  final := case when coalesce((r->>'ok')::boolean, false) and not coalesce((r->>'duplicate')::boolean, false) then 'pago_pedido' else 'saldo_na_carteira' end;
  update mkt_direct_deposits set status = final, settled_at = now(), result = r where deposit_id = p_deposit;
  perform public.mkt__audit('pagamento_direto_' || final, d.mkt_payment_id::text, case when final = 'pago_pedido' then 'ok' else 'falhou' end, r->>'code', null,
    jsonb_build_object('deposito', p_deposit, 'valor', d.amount_mzn));
  if final = 'saldo_na_carteira' then
    perform public.mkt__notify(d.buyer_id, 'pagamento_recusado', 'Recebemos ' || d.amount_mzn || ' MT por ' || d.method || ', mas o pedido já não podia ser pago ('
      || coalesce(r->>'code', 'erro') || '). O valor está no saldo da tua carteira.', '/carteira', 'direct-wallet:' || p_deposit);
  end if;
  return jsonb_build_object('ok', true, 'status', final, 'result', r);
end $$;

-- Trigger DIFERIDO em payments: corre no fim da transação de comp__confirm_deposit, depois do crédito na carteira.
-- Nunca faz falhar a confirmação do depósito (erros ficam registados na ligação e o mkt_sweep tenta de novo).
create or replace function public.mkt__tg_direct_deposit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'carteira' and new.status in ('pago','falhou') and old.status is distinct from new.status
     and exists (select 1 from mkt_direct_deposits where deposit_id = new.id and status = 'aguarda') then
    begin
      perform public.mkt__direct_settle(new.id);
    exception when others then
      raise warning 'mkt__direct_settle(%): %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists payments_mkt_direct on public.payments;
create constraint trigger payments_mkt_direct after update of status on public.payments
  deferrable initially deferred for each row execute function public.mkt__tg_direct_deposit();

-- Rede de segurança (chamada pelo mkt_sweep): liquida ligações cujo depósito já foi pago/recusado
create or replace function public.mkt__direct_settle_pending() returns integer
language plpgsql security definer set search_path = public as $$
declare x record; n integer := 0; r jsonb;
begin
  for x in select d.deposit_id from mkt_direct_deposits d join payments p on p.id = d.deposit_id
           where d.status = 'aguarda' and p.status in ('pago','falhou') order by d.created_at limit 100 loop
    begin
      r := public.mkt__direct_settle(x.deposit_id);
      if r->>'status' is not null then n := n + 1; end if;
    exception when others then raise warning 'mkt__direct_settle(%): %', x.deposit_id, sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- 6. Prazos: não expira um pedido enquanto o depósito ligado ainda está em curso no fornecedor (até 60 min) ---------
create or replace function public.mkt_sweep_expired(p_user uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare o record; n integer := 0;
begin
  for o in select id, payment_id from market_orders mo where v3 and status in ('criado','aguarda_pagamento') and expires_at < now()
           and (p_user is null or buyer_id = p_user)
           and not exists (select 1 from mkt_direct_deposits d join payments p on p.id = d.deposit_id
                           where d.mkt_payment_id = mo.payment_id and d.status = 'aguarda' and p.status in ('pendente','em processamento')
                             and d.created_at > now() - interval '60 minutes')
           order by expires_at limit 200 for update skip locked loop
    perform public.mkt__set_status(o.id, 'cancelado', 'expirado', 'sistema', 'Pagamento não concluído no prazo');
    perform public.mkt__release_stock(o.id);
    if exists (select 1 from mkt_payments where id = o.payment_id and status in ('criado','pendente','recusado')) then
      perform public.mkt__payment_status(o.payment_id, 'expirado', 'prazo', jsonb_build_object('reason', 'prazo de pagamento ultrapassado'));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.mkt_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare days integer; o record; done integer := 0; exp integer; direct integer;
begin
  if auth.uid() is not null and not public.mkt__can('SETTINGS_MANAGE') then return public.mkt__deny('SETTINGS_MANAGE', 'processar_prazos'); end if;
  direct := public.mkt__direct_settle_pending();
  exp := public.mkt_sweep_expired(null);
  select auto_release_days into days from market_settings where id = 1;
  if days is not null then
    for o in select id from market_orders where v3 and status in ('entregue','enviado') and settled_at is null
             and coalesce(delivered_at, shipped_at) < now() - make_interval(days => days) order by updated_at limit 200 loop
      if (public.mkt__complete_order(o.id, 'sistema', 'conclusao_automatica', 'Sem resposta do comprador em ' || days || ' dia(s)')->>'ok')::boolean then done := done + 1; end if;
    end loop;
  end if;
  if auth.uid() is not null then perform public.mkt__audit('processar_prazos', '', 'ok', null, null, jsonb_build_object('expirados', exp, 'concluidos', done, 'pagamentos_diretos', direct)); end if;
  return jsonb_build_object('ok', true, 'expired', exp, 'auto_completed', done, 'auto_release_days', days, 'direct_settled', direct);
end $$;

-- 7. RLS e permissões -----------------------------------------------------------------------------------------
alter table public.mkt_direct_deposits enable row level security;
drop policy if exists mkt_direct_deposits_read on public.mkt_direct_deposits;
create policy mkt_direct_deposits_read on public.mkt_direct_deposits for select using (buyer_id = (select auth.uid()) or (select public.mkt__can('PAYMENTS_VIEW')));
revoke all on public.mkt_direct_deposits from anon, authenticated;
grant select on public.mkt_direct_deposits to authenticated;

revoke all on function public.mkt__pay_core(uuid, uuid, text), public.mkt__direct_settle(text), public.mkt__direct_settle_pending(), public.mkt__tg_direct_deposit(),
  public.mkt_sweep_expired(uuid) from public, anon, authenticated;
revoke all on function public.mkt_pay(uuid, text), public.mkt_pay_direct_start(uuid, text, text, text), public.mkt_pay_direct_status(uuid), public.mkt_pay_direct_options() from public, anon;
grant execute on function public.mkt_pay(uuid, text), public.mkt_pay_direct_start(uuid, text, text, text), public.mkt_pay_direct_status(uuid), public.mkt_pay_direct_options() to authenticated;
revoke all on function public.mkt_sweep() from public, anon;
grant execute on function public.mkt_sweep() to authenticated, service_role;

notify pgrst, 'reload schema';
