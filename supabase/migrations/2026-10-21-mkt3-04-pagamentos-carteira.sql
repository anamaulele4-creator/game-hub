-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 4/6 — Payment Control: pagamentos (estados, idempotência, histórico),
-- diário contabilístico imutável (partidas dobradas), carteira (money_ledger existente), liquidação ao vendedor
-- com a comissão guardada no pedido, reembolsos, pagamentos aos vendedores e reconciliação. IDEMPOTENTE.
--
-- Como o dinheiro entra: o comprador carrega a carteira pelo fluxo de depósitos EXISTENTE (função payments +
-- comp__confirm_deposit: só credita depois de o fornecedor confirmar; webhooks com assinatura verificada;
-- reconciliação a cada 2 min). Depois paga o pedido com esse saldo, numa só transação no servidor.
-- Nunca se confirma um pagamento por o cliente regressar a uma página. Sem mkt3_checkout_enabled nada é cobrado.
-- =====================================================================

do $$ begin
  if to_regclass('public.mkt_order_events') is null then raise exception 'Corre primeiro a Parte 3 (carrinho e pedidos).'; end if;
end $$;

-- 1. Motivos novos na carteira (superconjunto; inclui os de afiliados) ------------------------------------------
alter table public.money_ledger drop constraint if exists money_ledger_reason_check;
alter table public.money_ledger add constraint money_ledger_reason_check
  check (reason in ('deposito','levantamento','levantamento_recusado','aposta','ganho','reembolso','correcao','ajuste','comissao_afiliado',
                    'compra','venda','payout','payout_recusado'));

-- 2. Pagamentos do marketplace ------------------------------------------------------------------------------
create table if not exists public.mkt_payments (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null unique,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  amount_mzn integer not null check (amount_mzn > 0),
  currency text not null default 'MZN' check (currency = 'MZN'),
  method text not null default 'carteira' check (method in ('carteira')),
  provider text not null default 'carteira',
  status text not null default 'criado' check (status in ('criado','pendente','processamento','confirmado','recusado','expirado','cancelado','reembolsado','parcialmente_reembolsado')),
  provider_ref text unique,
  idempotency_key text not null unique,
  refunded_mzn integer not null default 0 check (refunded_mzn >= 0),
  failure_reason text,
  expires_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mkt_payments_refund_ck check (refunded_mzn <= amount_mzn)
);
create index if not exists mkt_payments_buyer_idx on public.mkt_payments (buyer_id, created_at desc);
create index if not exists mkt_payments_status_idx on public.mkt_payments (status, created_at desc);

create table if not exists public.mkt_payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.mkt_payments(id) on delete cascade,
  from_status text, to_status text not null,
  source text not null,
  detail jsonb not null default '{}',
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists mkt_payment_events_payment_idx on public.mkt_payment_events (payment_id, id);
drop trigger if exists mkt_payment_events_immutable on public.mkt_payment_events;
create trigger mkt_payment_events_immutable before update or delete on public.mkt_payment_events for each row execute function public.mkt__tg_immutable();

create or replace function public.mkt__pay_edge_ok(p_from text, p_to text) returns boolean language sql immutable as $$
  select (p_from, p_to) in (('criado','pendente'), ('criado','cancelado'), ('pendente','processamento'), ('pendente','confirmado'), ('pendente','recusado'),
    ('pendente','expirado'), ('pendente','cancelado'), ('processamento','confirmado'), ('processamento','recusado'), ('processamento','pendente'),
    ('recusado','pendente'), ('recusado','expirado'), ('recusado','cancelado'), ('criado','expirado'), ('processamento','cancelado'), ('confirmado','reembolsado'), ('confirmado','parcialmente_reembolsado'), ('parcialmente_reembolsado','reembolsado'),
    ('parcialmente_reembolsado','parcialmente_reembolsado')) $$;

create or replace function public.mkt__tg_payment_guard() returns trigger language plpgsql as $$
begin
  if new.amount_mzn is distinct from old.amount_mzn or new.buyer_id is distinct from old.buyer_id or new.checkout_id is distinct from old.checkout_id
     or new.idempotency_key is distinct from old.idempotency_key or new.refunded_mzn < old.refunded_mzn
     or (old.provider_ref is not null and new.provider_ref is distinct from old.provider_ref) then raise exception 'PAYMENT_IMMUTABLE'; end if;
  if coalesce(current_setting('mkt.pay', true), '') <> '1' then raise exception 'PAYMENT_LOCKED'; end if;
  if new.status is distinct from old.status and not public.mkt__pay_edge_ok(old.status, new.status) then raise exception 'PAYMENT_TRANSITION'; end if;
  return new;
end $$;
drop trigger if exists mkt_payments_guard on public.mkt_payments;
create trigger mkt_payments_guard before update on public.mkt_payments for each row execute function public.mkt__tg_payment_guard();
drop trigger if exists mkt_payments_nodelete on public.mkt_payments;
create trigger mkt_payments_nodelete before delete on public.mkt_payments for each row execute function public.mkt__tg_immutable();

create or replace function public.mkt__payment_status(p_payment uuid, p_to text, p_source text, p_detail jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare p mkt_payments;
begin
  select * into p from mkt_payments where id = p_payment for update;
  if p.id is null or (p.status = p_to and p_to <> 'parcialmente_reembolsado') then return; end if;
  if not public.mkt__pay_edge_ok(p.status, p_to) then raise exception 'PAYMENT_TRANSITION'; end if;
  perform set_config('mkt.pay', '1', true);
  update mkt_payments set status = p_to, updated_at = now(), confirmed_at = case when p_to = 'confirmado' then now() else confirmed_at end,
    failure_reason = case when p_to in ('recusado','expirado','cancelado') then left(coalesce(p_detail->>'reason', p_to), 200) else failure_reason end
  where id = p_payment;
  perform set_config('mkt.pay', '', true);
  insert into mkt_payment_events (payment_id, from_status, to_status, source, detail, actor_id) values (p_payment, p.status, p_to, left(p_source, 40), public.mkt__scrub(coalesce(p_detail, '{}')), auth.uid());
end $$;

-- 3. Diário contabilístico imutável (cada lançamento soma zero) --------------------------------------------------
-- Contas: carteira (saldo do utilizador, espelha money_ledger), escrow (valor retido), receita (comissões da plataforma),
--         payout_curso (pagamentos a vendedores em curso), externo (saída para o operador).
create table if not exists public.mkt_journal (
  id bigint generated always as identity primary key,
  tx_id uuid not null,
  account text not null check (account in ('carteira','escrow','receita','payout_curso','externo')),
  user_id uuid references public.profiles(id) on delete restrict,
  order_id uuid references public.market_orders(id) on delete restrict,
  payment_id uuid references public.mkt_payments(id) on delete restrict,
  payout_id uuid,
  amount integer not null check (amount <> 0),
  currency text not null default 'MZN',
  kind text not null check (kind in ('pagamento_compra','reembolso','comissao','ajuste','credito','debito','pagamento_vendedor','estorno','liberacao')),
  status text not null default 'confirmado' check (status in ('confirmado')),
  reference text not null,
  description text not null default '',
  source text not null default 'sistema',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists mkt_journal_tx_idx on public.mkt_journal (tx_id);
create index if not exists mkt_journal_user_idx on public.mkt_journal (user_id, id desc);
create index if not exists mkt_journal_order_idx on public.mkt_journal (order_id);
create index if not exists mkt_journal_account_idx on public.mkt_journal (account, created_at desc);
drop trigger if exists mkt_journal_immutable on public.mkt_journal;
create trigger mkt_journal_immutable before update or delete on public.mkt_journal for each row execute function public.mkt__tg_immutable();

-- Lança uma transação equilibrada. p_lines: [{account, user_id?, amount, kind, description?}]
create or replace function public.mkt__post(p_ref text, p_order uuid, p_payment uuid, p_payout uuid, p_lines jsonb, p_source text default 'sistema') returns uuid
language plpgsql security definer set search_path = public as $$
declare tx uuid := gen_random_uuid(); s integer; l jsonb;
begin
  select coalesce(sum((x->>'amount')::integer), 0) into s from jsonb_array_elements(p_lines) x;
  if s <> 0 or jsonb_array_length(p_lines) < 2 then raise exception 'JOURNAL_UNBALANCED'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l->>'amount')::integer <> 0 then
      insert into mkt_journal (tx_id, account, user_id, order_id, payment_id, payout_id, amount, kind, reference, description, source)
      values (tx, l->>'account', (l->>'user_id')::uuid, p_order, p_payment, p_payout, (l->>'amount')::integer, l->>'kind', p_ref, left(coalesce(l->>'description', ''), 200), p_source);
    end if;
  end loop;
  return tx;
end $$;

-- 4. Pagar com o saldo da carteira (atómico e idempotente) --------------------------------------------------------
create or replace function public.mkt_pay(p_payment uuid, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p mkt_payments; prev jsonb; bal integer; o record; r jsonb;
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if p_idem is null or length(p_idem) < 16 or length(p_idem) > 80 then return public.mkt__err('IDEMPOTENCY'); end if;
  prev := public.mkt__idem_get('pay:' || p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  if not public.mkt__flag('mkt3_checkout_enabled') then return public.mkt__err('PAYMENT_UNAVAILABLE'); end if;
  perform pg_advisory_xact_lock(hashtextextended('money:' || uid::text, 0));
  select * into p from mkt_payments where id = p_payment for update;
  if p.id is null or p.buyer_id <> uid then return public.mkt__err('NOT_FOUND'); end if;
  if p.status = 'confirmado' then return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'confirmado'); end if;
  if p.status not in ('pendente','recusado') then return public.mkt__err('STATE', jsonb_build_object('status', p.status)); end if;
  if p.expires_at < now() then
    perform public.mkt_sweep_expired(uid);
    return public.mkt__err('EXPIRED');
  end if;
  if exists (select 1 from market_orders where payment_id = p.id and status <> 'aguarda_pagamento') then return public.mkt__err('STATE'); end if;
  if p.status = 'recusado' then perform public.mkt__payment_status(p.id, 'pendente', 'nova_tentativa', '{}'); end if;
  bal := public.bets__balance_mt(uid);
  if bal < p.amount_mzn then
    perform public.mkt__payment_status(p.id, 'recusado', 'carteira', jsonb_build_object('reason', 'saldo insuficiente', 'saldo', bal, 'valor', p.amount_mzn));
    return public.mkt__err('BALANCE', jsonb_build_object('balance', bal, 'amount', p.amount_mzn));
  end if;
  -- Débito real na carteira + diário + estado
  perform public.bets__post_mt(uid, -p.amount_mzn, 'compra', 'mkt:' || p.id);
  perform public.mkt__post('pagamento:' || p.id, null, p.id, null, jsonb_build_array(
    jsonb_build_object('account', 'carteira', 'user_id', uid, 'amount', -p.amount_mzn, 'kind', 'pagamento_compra', 'description', 'Pagamento de compra'),
    jsonb_build_object('account', 'escrow', 'amount', p.amount_mzn, 'kind', 'pagamento_compra', 'description', 'Valor retido até à conclusão')), 'carteira');
  perform set_config('mkt.pay', '1', true);
  update mkt_payments set provider_ref = 'carteira:' || (select id from money_ledger where user_id = uid and reason = 'compra' and ref = 'mkt:' || p.id) where id = p.id;
  perform public.mkt__payment_status(p.id, 'confirmado', 'carteira', jsonb_build_object('valor', p.amount_mzn));
  for o in select id, seller_id, product_title, total_mzn from market_orders where payment_id = p.id loop
    perform public.mkt__set_status(o.id, 'pago', 'pagamento_confirmado', 'sistema', 'Pago com saldo da carteira');
    perform set_config('mkt.ctx', '1', true);
    update market_orders set expires_at = null where id = o.id;
    perform set_config('mkt.ctx', '', true);
    perform public.mkt__notify(o.seller_id, 'novo_pedido', 'Novo pedido pago: "' || left(o.product_title, 60) || '" (' || o.total_mzn || ' MT).', '/marketplace/pedido/?id=' || o.id, 'paid:' || o.id);
  end loop;
  perform public.mkt__notify(uid, 'pagamento_confirmado', 'Pagamento confirmado: ' || p.amount_mzn || ' MT. O valor fica retido até confirmares a receção.', '/marketplace/pedidos', 'paid-buyer:' || p.id);
  r := jsonb_build_object('ok', true, 'status', 'confirmado', 'balance', public.bets__balance_mt(uid));
  return public.mkt__idem_put('pay:' || p_idem, 'pay', r);
end $$;

-- Estado do pagamento depois de mudanças nos pedidos (cancelamentos/reembolsos)
create or replace function public.mkt__payment_after_order_change(p_payment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p mkt_payments; refunded integer; open_n integer;
begin
  select * into p from mkt_payments where id = p_payment;
  if p.id is null then return; end if;
  if p.status in ('criado','pendente','recusado','processamento') then
    select count(*) into open_n from market_orders where payment_id = p.id and status not in ('cancelado');
    if open_n = 0 then perform public.mkt__payment_status(p.id, 'cancelado', 'pedido_cancelado', '{}'); end if;
    return;
  end if;
  if p.status in ('confirmado','parcialmente_reembolsado') then
    select coalesce(sum(refunded_mzn), 0) into refunded from market_orders where payment_id = p.id;
    if refunded > p.refunded_mzn then
      perform set_config('mkt.pay', '1', true);
      update mkt_payments set refunded_mzn = refunded where id = p.id;
      perform public.mkt__payment_status(p.id, case when refunded >= p.amount_mzn then 'reembolsado' else 'parcialmente_reembolsado' end, 'reembolso', jsonb_build_object('reembolsado', refunded));
    end if;
  end if;
end $$;

-- 5. Liquidação ao vendedor (pedido concluído): escrow → vendedor (líquido) + plataforma (comissão do instantâneo)
-- Sistema: atualiza vendas do produto como serviço (o trigger antigo só deixa o sistema/admin mexer em "sales")
create or replace function public.mkt__bump_sales(p_product uuid, p_qty integer) returns void
language plpgsql security definer set search_path = public as $$
declare s1 text := current_setting('request.jwt.claim.sub', true); s2 text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '{}', true);
  update market_products set sales = sales + p_qty where id = p_product;
  perform set_config('request.jwt.claim.sub', coalesce(s1, ''), true); perform set_config('request.jwt.claims', coalesce(s2, ''), true);
end $$;

create or replace function public.mkt__complete_order(p_order uuid, p_role text, p_action text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders; pay mkt_payments; rem integer; comm integer; net integer;
begin
  select * into o from market_orders where id = p_order for update;
  if o.id is null or not o.v3 then return public.mkt__err('NOT_FOUND'); end if;
  if o.settled_at is not null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  select * into pay from mkt_payments where id = o.payment_id;
  if pay.status not in ('confirmado','parcialmente_reembolsado') then return public.mkt__err('NOT_PAID'); end if;
  rem := o.total_mzn - o.refunded_mzn;
  comm := case when o.refunded_mzn = 0 then o.commission_mzn else least(o.commission_mzn, floor(o.commission_mzn::numeric * rem / o.total_mzn + 0.5)::integer) end;
  net := rem - comm;
  perform public.mkt__set_status(o.id, case when o.refunded_mzn > 0 then 'parcialmente_reembolsado' else 'concluido' end, p_action, p_role, p_note);
  if rem > 0 then
    if net > 0 then perform public.bets__post_mt(o.seller_id, net, 'venda', 'mkt:' || o.id); end if;
    perform public.mkt__post('liquidacao:' || o.id, o.id, o.payment_id, null, jsonb_build_array(
      jsonb_build_object('account', 'escrow', 'amount', -rem, 'kind', 'liberacao', 'description', 'Libertação do valor retido'),
      jsonb_build_object('account', 'carteira', 'user_id', o.seller_id, 'amount', net, 'kind', 'credito', 'description', 'Venda (líquido)'),
      jsonb_build_object('account', 'receita', 'amount', comm, 'kind', 'comissao', 'description', 'Comissão ' || coalesce(o.commission_pct::text, '0') || '% + ' || coalesce(o.commission_fixed_mzn, 0) || ' MT')));
  end if;
  perform set_config('mkt.ctx', '1', true);
  update market_orders set settled_at = now(), settled_commission_mzn = comm, settled_net_mzn = net where id = o.id;
  perform set_config('mkt.ctx', '', true);
  perform public.mkt__bump_sales(o.product_id, o.qty);
  if net > 0 then
    perform public.mkt__notify(o.seller_id, 'pagamento_vendedor', 'Venda concluída: ' || net || ' MT disponíveis na tua carteira ("' || left(o.product_title, 50) || '").', '/marketplace/criador', 'settled:' || o.id);
  end if;
  return jsonb_build_object('ok', true, 'net', net, 'commission', comm);
end $$;

-- 6. Reembolsos (total ou parcial) — devolvem à carteira do comprador o valor que estava retido ---------------------
create or replace function public.mkt__refund_order(p_order uuid, p_amount integer, p_role text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders; pay mkt_payments; full_r boolean; restock boolean;
begin
  select * into o from market_orders where id = p_order for update;
  if o.id is null or not o.v3 then return public.mkt__err('NOT_FOUND'); end if;
  if o.settled_at is not null then return public.mkt__err('ALREADY_SETTLED'); end if;
  select * into pay from mkt_payments where id = o.payment_id;
  if pay.status not in ('confirmado','parcialmente_reembolsado') then return public.mkt__err('NOT_PAID'); end if;
  if o.status not in ('pago','em_preparacao','enviado','em_execucao','entregue','disputa') then return public.mkt__err('STATE'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > o.total_mzn - o.refunded_mzn then return public.mkt__err('AMOUNT'); end if;
  full_r := p_amount = o.total_mzn - o.refunded_mzn;
  restock := o.status in ('pago','em_preparacao');
  perform public.bets__post_mt(o.buyer_id, p_amount, 'reembolso', 'mkt:' || o.id);
  perform public.mkt__post('reembolso:' || o.id, o.id, o.payment_id, null, jsonb_build_array(
    jsonb_build_object('account', 'escrow', 'amount', -p_amount, 'kind', 'reembolso', 'description', 'Reembolso: ' || left(coalesce(p_reason, ''), 120)),
    jsonb_build_object('account', 'carteira', 'user_id', o.buyer_id, 'amount', p_amount, 'kind', 'reembolso', 'description', 'Reembolso de compra')), p_role);
  perform set_config('mkt.ctx', '1', true);
  update market_orders set refunded_mzn = refunded_mzn + p_amount, resolution = left(coalesce(p_reason, ''), 500) where id = o.id;
  perform set_config('mkt.ctx', '', true);
  if full_r then
    perform public.mkt__set_status(o.id, 'reembolsado', 'reembolso', p_role, p_reason);
    perform set_config('mkt.ctx', '1', true);
    update market_orders set settled_at = now(), settled_commission_mzn = 0, settled_net_mzn = 0 where id = o.id;
    perform set_config('mkt.ctx', '', true);
    if restock then perform public.mkt__release_stock(o.id); end if;
  else
    -- parcial: o restante vai para o vendedor (comissão proporcional) e o pedido fecha como parcialmente reembolsado
    perform public.mkt__complete_order(o.id, p_role, 'reembolso_parcial', p_reason);
  end if;
  perform public.mkt__payment_after_order_change(o.payment_id);
  perform public.mkt__notify(o.buyer_id, 'reembolso', 'Reembolso de ' || p_amount || ' MT na tua carteira ("' || left(o.product_title, 50) || '").', '/marketplace/pedido/?id=' || o.id, 'refund:' || o.id || ':' || p_amount);
  return jsonb_build_object('ok', true, 'refunded', p_amount, 'full', full_r);
end $$;

create or replace function public.mkt_admin_refund(p_order uuid, p_amount integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; o market_orders;
begin
  if not public.mkt__can('REFUNDS_MANAGE') then return public.mkt__deny('REFUNDS_MANAGE', 'reembolso', p_order::text); end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then return public.mkt__err('REASON'); end if;
  select * into o from market_orders where id = p_order;
  r := public.mkt__refund_order(p_order, p_amount, 'admin', trim(p_reason));
  perform public.mkt__audit('reembolso', p_order::text, case when (r->>'ok')::boolean then 'ok' else 'erro:' || coalesce(r->>'code', '') end, p_reason,
    jsonb_build_object('status', o.status, 'refunded', o.refunded_mzn), jsonb_build_object('amount', p_amount));
  return r;
end $$;

-- 7. Pagamentos aos vendedores --------------------------------------------------------------------------------
create table if not exists public.mkt_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete restrict,
  amount_mzn integer not null check (amount_mzn > 0),
  method text not null check (method in ('M-Pesa','e-Mola')),
  phone text not null check (phone ~ '^8[4-7][0-9]{7}$'),
  status text not null default 'pedido' check (status in ('pedido','em_processamento','pago','recusado','falhou')),
  provider_ref text unique,
  reason text not null default '',
  idempotency_key text not null unique,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz
);
create index if not exists mkt_payouts_status_idx on public.mkt_payouts (status, requested_at);
create index if not exists mkt_payouts_seller_idx on public.mkt_payouts (seller_id, requested_at desc);
create or replace function public.mkt__tg_payout_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.amount_mzn is distinct from old.amount_mzn or new.seller_id is distinct from old.seller_id or new.phone is distinct from old.phone
     or old.status in ('pago','recusado','falhou') then raise exception 'PAYOUT_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists mkt_payouts_guard on public.mkt_payouts;
create trigger mkt_payouts_guard before update or delete on public.mkt_payouts for each row execute function public.mkt__tg_payout_guard();

create or replace function public.mkt_payout_request(p_amount integer, p_method text, p_phone text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); prev jsonb; pid uuid; r jsonb; ph text := regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '^\+?258', '');
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  if p_idem is null or length(p_idem) < 16 or length(p_idem) > 80 then return public.mkt__err('IDEMPOTENCY'); end if;
  prev := public.mkt__idem_get('payout:' || p_idem); if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  if not public.mkt__flag('mkt3_payouts_enabled') then return public.mkt__err('PAYOUTS_OFF'); end if;
  if not public.is_active_user() then return public.mkt__err('ACCOUNT'); end if;
  -- Identidade (documento + selfie aprovados) e elegibilidade
  if not public.seller__verified(uid) then return public.mkt__err('IDENTITY'); end if;
  if not public.mkt__can_sell(uid) then return public.mkt__err('NOT_SELLER'); end if;
  if p_method not in ('M-Pesa','e-Mola') or (p_method = 'M-Pesa' and ph !~ '^8[45][0-9]{7}$') or (p_method = 'e-Mola' and ph !~ '^8[67][0-9]{7}$') then return public.mkt__err('PHONE'); end if;
  if p_amount is null or p_amount < 100 or p_amount > 500000 then return public.mkt__err('AMOUNT'); end if;
  perform pg_advisory_xact_lock(hashtextextended('money:' || uid::text, 0));
  if exists (select 1 from mkt_payouts where seller_id = uid and status in ('pedido','em_processamento')) then return public.mkt__err('PAYOUT_OPEN'); end if;
  if public.bets__balance_mt(uid) < p_amount then return public.mkt__err('BALANCE'); end if;
  if not public.mkt__rate('payout:' || uid, 5, 86400) then perform public.mkt__risk(uid, 'payout_rate', '', 50); return public.mkt__err('RATE'); end if;
  insert into mkt_payouts (seller_id, amount_mzn, method, phone, idempotency_key) values (uid, p_amount, p_method, ph, 'payout:' || p_idem) returning id into pid;
  perform public.bets__post_mt(uid, -p_amount, 'payout', 'mkt:' || pid);
  perform public.mkt__post('payout:' || pid, null, null, pid, jsonb_build_array(
    jsonb_build_object('account', 'carteira', 'user_id', uid, 'amount', -p_amount, 'kind', 'pagamento_vendedor', 'description', 'Pedido de pagamento'),
    jsonb_build_object('account', 'payout_curso', 'user_id', uid, 'amount', p_amount, 'kind', 'pagamento_vendedor', 'description', 'A aguardar envio')));
  if p_amount >= 20000 then perform public.mkt__risk(uid, 'payout_alto', pid::text, 40, jsonb_build_object('valor', p_amount)); end if;
  r := jsonb_build_object('ok', true, 'id', pid, 'balance', public.bets__balance_mt(uid));
  return public.mkt__idem_put('payout:' || p_idem, 'payout', r);
end $$;

-- Admin (PAYOUTS_MANAGE). "pago" exige a referência da transação do operador (confirmação do envio); "recusar"/"falhou" devolvem o valor.
create or replace function public.mkt_admin_payout_action(p_id uuid, p_action text, p_ref text default '', p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p mkt_payouts; nxt text;
begin
  if not public.mkt__can('PAYOUTS_MANAGE') then return public.mkt__deny('PAYOUTS_MANAGE', 'payout_' || coalesce(p_action, ''), p_id::text); end if;
  select * into p from mkt_payouts where id = p_id for update;
  if p.id is null then return public.mkt__err('NOT_FOUND'); end if;
  if p.seller_id = auth.uid() then return public.mkt__deny('PAYOUTS_MANAGE', 'payout_proprio', p_id::text); end if;
  nxt := case when p_action = 'processar' and p.status = 'pedido' then 'em_processamento'
              when p_action = 'pago' and p.status in ('pedido','em_processamento') then 'pago'
              when p_action in ('recusar','falhou') and p.status in ('pedido','em_processamento') then case p_action when 'recusar' then 'recusado' else 'falhou' end
              else null end;
  if nxt is null then return public.mkt__err('STATE'); end if;
  if nxt = 'pago' then
    if length(trim(coalesce(p_ref, ''))) < 6 then return public.mkt__err('REF'); end if;
    if exists (select 1 from mkt_payouts where provider_ref = trim(p_ref)) then perform public.mkt__risk(p.seller_id, 'payout_ref_duplicada', p.id::text, 80); return public.mkt__err('DUP_REF'); end if;
    update mkt_payouts set status = 'pago', provider_ref = trim(p_ref), decided_by = auth.uid(), decided_at = now() where id = p.id;
    perform public.mkt__post('payout_pago:' || p.id, null, null, p.id, jsonb_build_array(
      jsonb_build_object('account', 'payout_curso', 'user_id', p.seller_id, 'amount', -p.amount_mzn, 'kind', 'pagamento_vendedor', 'description', 'Enviado ao vendedor'),
      jsonb_build_object('account', 'externo', 'user_id', p.seller_id, 'amount', p.amount_mzn, 'kind', 'pagamento_vendedor', 'description', p.method || ' ' || trim(p_ref))), 'admin');
    perform public.mkt__notify(p.seller_id, 'pagamento_vendedor', 'Pagamento de ' || p.amount_mzn || ' MT enviado por ' || p.method || ' (ref. ' || trim(p_ref) || ').', '/marketplace/criador', 'payout:' || p.id || ':pago');
  elsif nxt in ('recusado','falhou') then
    if length(trim(coalesce(p_reason, ''))) < 5 then return public.mkt__err('REASON'); end if;
    update mkt_payouts set status = nxt, reason = trim(p_reason), decided_by = auth.uid(), decided_at = now() where id = p.id;
    perform public.bets__post_mt(p.seller_id, p.amount_mzn, 'payout_recusado', 'mkt:' || p.id);
    perform public.mkt__post('payout_estorno:' || p.id, null, null, p.id, jsonb_build_array(
      jsonb_build_object('account', 'payout_curso', 'user_id', p.seller_id, 'amount', -p.amount_mzn, 'kind', 'estorno', 'description', 'Pagamento ' || nxt),
      jsonb_build_object('account', 'carteira', 'user_id', p.seller_id, 'amount', p.amount_mzn, 'kind', 'estorno', 'description', 'Valor devolvido à carteira')), 'admin');
    perform public.mkt__notify(p.seller_id, 'pagamento_vendedor', 'Pedido de pagamento ' || nxt || ': ' || left(trim(p_reason), 120) || '. O valor voltou à tua carteira.', '/marketplace/criador', 'payout:' || p.id || ':' || nxt);
  else
    update mkt_payouts set status = nxt where id = p.id;
  end if;
  perform public.mkt__audit('payout_' || p_action, p.id::text, 'ok', nullif(p_reason, ''), jsonb_build_object('status', p.status), jsonb_build_object('status', nxt, 'valor', p.amount_mzn));
  return jsonb_build_object('ok', true, 'status', nxt);
end $$;

-- 8. Prazos: pedidos não pagos expiram (stock devolvido); entregues sem resposta concluem após N dias ----------------
create or replace function public.mkt_sweep_expired(p_user uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare o record; n integer := 0;
begin
  for o in select id, payment_id from market_orders where v3 and status in ('criado','aguarda_pagamento') and expires_at < now()
           and (p_user is null or buyer_id = p_user) order by expires_at limit 200 for update skip locked loop
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
declare days integer; o record; done integer := 0; exp integer;
begin
  if auth.uid() is not null and not public.mkt__can('SETTINGS_MANAGE') then return public.mkt__deny('SETTINGS_MANAGE', 'processar_prazos'); end if;
  exp := public.mkt_sweep_expired(null);
  select auto_release_days into days from market_settings where id = 1;
  if days is not null then
    for o in select id from market_orders where v3 and status in ('entregue','enviado') and settled_at is null
             and coalesce(delivered_at, shipped_at) < now() - make_interval(days => days) order by updated_at limit 200 loop
      if (public.mkt__complete_order(o.id, 'sistema', 'conclusao_automatica', 'Sem resposta do comprador em ' || days || ' dia(s)')->>'ok')::boolean then done := done + 1; end if;
    end loop;
  end if;
  if auth.uid() is not null then perform public.mkt__audit('processar_prazos', '', 'ok', null, null, jsonb_build_object('expirados', exp, 'concluidos', done)); end if;
  return jsonb_build_object('ok', true, 'expired', exp, 'auto_completed', done, 'auto_release_days', days);
end $$;

-- 9. Finanças do vendedor (tudo calculado a partir dos movimentos reais) --------------------------------------------
create or replace function public.mkt_seller_finance() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return public.mkt__err('AUTH'); end if;
  return jsonb_build_object('ok', true,
    'available', public.bets__balance_mt(uid),
    'pending_escrow', (select coalesce(sum(seller_net_mzn), 0) from market_orders where v3 and seller_id = uid and settled_at is null
                        and status in ('pago','em_preparacao','enviado','em_execucao','entregue','disputa')),
    'in_dispute', (select coalesce(sum(seller_net_mzn), 0) from market_orders where v3 and seller_id = uid and settled_at is null and status = 'disputa'),
    'gross', (select coalesce(sum(total_mzn), 0) from market_orders where v3 and seller_id = uid and settled_at is not null and status <> 'reembolsado'),
    'refunds', (select coalesce(sum(refunded_mzn), 0) from market_orders where v3 and seller_id = uid),
    'commissions', (select coalesce(sum(settled_commission_mzn), 0) from market_orders where v3 and seller_id = uid and settled_at is not null),
    'net', (select coalesce(sum(settled_net_mzn), 0) from market_orders where v3 and seller_id = uid and settled_at is not null),
    'payouts_pending', (select coalesce(sum(amount_mzn), 0) from mkt_payouts where seller_id = uid and status in ('pedido','em_processamento')),
    'payouts_done', (select coalesce(sum(amount_mzn), 0) from mkt_payouts where seller_id = uid and status = 'pago'),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'amount', amount_mzn, 'method', method, 'phone', left(phone, 2) || '•••' || right(phone, 2),
                  'status', status, 'ref', provider_ref, 'reason', reason, 'at', requested_at, 'decided_at', decided_at) order by requested_at desc), '[]')
                from (select * from mkt_payouts where seller_id = uid order by requested_at desc limit 30) z),
    'movements', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'description', description, 'order_id', order_id, 'ref', reference, 'at', created_at) order by id desc), '[]')
                from (select * from mkt_journal where user_id = uid and account = 'carteira' order by id desc limit 100) z),
    'commission_rule', public.mkt__commission_for(uid, null),
    'payouts_enabled', public.mkt__flag('mkt3_payouts_enabled'), 'identity_ok', public.seller__verified(uid));
end $$;

-- 10. Reconciliação (PAYMENTS_VIEW): verifica que o dinheiro bate certo em todo o lado --------------------------------
create or replace function public.mkt_admin_reconcile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare issues jsonb := '[]'::jsonb; escrow_j integer; escrow_o integer; payout_j integer; payout_o integer; x record;
begin
  if not public.mkt__can('PAYMENTS_VIEW') then return public.mkt__deny('PAYMENTS_VIEW', 'reconciliar'); end if;
  for x in select tx_id, sum(amount) s from mkt_journal group by tx_id having sum(amount) <> 0 limit 20 loop
    issues := issues || jsonb_build_object('type', 'diario_desequilibrado', 'ref', x.tx_id, 'diff', x.s);
  end loop;
  select coalesce(sum(amount), 0) into escrow_j from mkt_journal where account = 'escrow';
  select coalesce(sum(total_mzn - refunded_mzn), 0) into escrow_o from market_orders o where v3 and settled_at is null
    and exists (select 1 from mkt_payments p where p.id = o.payment_id and p.status in ('confirmado','parcialmente_reembolsado'));
  if escrow_j <> escrow_o then issues := issues || jsonb_build_object('type', 'escrow_diferente', 'diario', escrow_j, 'pedidos', escrow_o); end if;
  select coalesce(sum(amount), 0) into payout_j from mkt_journal where account = 'payout_curso';
  select coalesce(sum(amount_mzn), 0) into payout_o from mkt_payouts where status in ('pedido','em_processamento');
  if payout_j <> payout_o then issues := issues || jsonb_build_object('type', 'payouts_diferentes', 'diario', payout_j, 'pedidos', payout_o); end if;
  for x in select p.id, p.amount_mzn from mkt_payments p where p.status in ('confirmado','reembolsado','parcialmente_reembolsado')
           and not exists (select 1 from money_ledger l where l.user_id = p.buyer_id and l.reason = 'compra' and l.ref = 'mkt:' || p.id and l.delta = -p.amount_mzn) limit 20 loop
    issues := issues || jsonb_build_object('type', 'pagamento_sem_debito', 'ref', x.id, 'valor', x.amount_mzn);
  end loop;
  for x in select o.id from market_orders o where o.v3 and o.status in ('pago','em_preparacao','enviado','em_execucao','entregue','disputa','concluido')
           and not exists (select 1 from mkt_payments p where p.id = o.payment_id and p.status in ('confirmado','parcialmente_reembolsado','reembolsado')) limit 20 loop
    issues := issues || jsonb_build_object('type', 'pedido_pago_sem_pagamento', 'ref', x.id);
  end loop;
  for x in select o.id, o.settled_net_mzn from market_orders o where o.v3 and o.settled_at is not null and coalesce(o.settled_net_mzn, 0) > 0
           and not exists (select 1 from money_ledger l where l.user_id = o.seller_id and l.reason = 'venda' and l.ref = 'mkt:' || o.id and l.delta = o.settled_net_mzn) limit 20 loop
    issues := issues || jsonb_build_object('type', 'venda_sem_credito', 'ref', x.id, 'valor', x.settled_net_mzn);
  end loop;
  perform public.mkt__audit('reconciliar', '', case when jsonb_array_length(issues) = 0 then 'ok' else 'diferencas' end, null, null, jsonb_build_object('problemas', jsonb_array_length(issues)));
  return jsonb_build_object('ok', true, 'issues', issues, 'escrow', escrow_j, 'payouts_in_progress', payout_j,
    'revenue', (select coalesce(sum(amount), 0) from mkt_journal where account = 'receita'),
    'paid_out', (select coalesce(sum(amount), 0) from mkt_journal where account = 'externo'), 'checked_at', now());
end $$;

-- 11. RLS ------------------------------------------------------------------------------------------------
alter table public.mkt_payments enable row level security;
alter table public.mkt_payment_events enable row level security;
alter table public.mkt_journal enable row level security;
alter table public.mkt_payouts enable row level security;
drop policy if exists mkt_payments_read on public.mkt_payments;
create policy mkt_payments_read on public.mkt_payments for select using (buyer_id = (select auth.uid()) or (select public.mkt__can('PAYMENTS_VIEW')));
drop policy if exists mkt_payment_events_read on public.mkt_payment_events;
create policy mkt_payment_events_read on public.mkt_payment_events for select using (
  exists (select 1 from public.mkt_payments p where p.id = payment_id and p.buyer_id = (select auth.uid())) or (select public.mkt__can('PAYMENTS_VIEW')));
drop policy if exists mkt_journal_read on public.mkt_journal;
create policy mkt_journal_read on public.mkt_journal for select using ((user_id = (select auth.uid()) and account = 'carteira') or (select public.mkt__can('PAYMENTS_VIEW')));
drop policy if exists mkt_payouts_read on public.mkt_payouts;
create policy mkt_payouts_read on public.mkt_payouts for select using (seller_id = (select auth.uid()) or (select public.mkt__can('PAYOUTS_VIEW')));
revoke all on public.mkt_payments, public.mkt_payment_events, public.mkt_journal, public.mkt_payouts from anon, authenticated;
grant select on public.mkt_payments, public.mkt_payment_events, public.mkt_journal, public.mkt_payouts to authenticated;

revoke all on function public.mkt__payment_status(uuid, text, text, jsonb), public.mkt__post(text, uuid, uuid, uuid, jsonb, text), public.mkt__payment_after_order_change(uuid),
  public.mkt__bump_sales(uuid, integer), public.mkt__complete_order(uuid, text, text, text), public.mkt__refund_order(uuid, integer, text, text),
  public.mkt_sweep_expired(uuid) from public, anon, authenticated;
revoke all on function public.mkt_pay(uuid, text), public.mkt_admin_refund(uuid, integer, text), public.mkt_payout_request(integer, text, text, text),
  public.mkt_admin_payout_action(uuid, text, text, text), public.mkt_sweep(), public.mkt_seller_finance(), public.mkt_admin_reconcile() from public, anon;
grant execute on function public.mkt_pay(uuid, text), public.mkt_admin_refund(uuid, integer, text), public.mkt_payout_request(integer, text, text, text),
  public.mkt_admin_payout_action(uuid, text, text, text), public.mkt_sweep(), public.mkt_seller_finance(), public.mkt_admin_reconcile() to authenticated;
grant execute on function public.mkt_sweep() to service_role;

notify pgrst, 'reload schema';
