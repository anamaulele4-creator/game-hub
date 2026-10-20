-- =====================================================================
-- TXAPILOG MARKETPLACE 3.0 · Parte 5/6 — Mensagens do pedido, denúncias, avaliações (compra verificada,
-- resposta do vendedor, moderação, histórico) e reclamações/disputas. IDEMPOTENTE.
-- Uma disputa nunca mexe em saldos diretamente: as decisões chamam as funções financeiras da Parte 4.
-- =====================================================================

do $$ begin
  if to_regclass('public.mkt_journal') is null then raise exception 'Corre primeiro a Parte 4 (pagamentos e carteira).'; end if;
end $$;

-- Provas/imagens: só ficheiros do próprio utilizador no bucket media
create or replace function public.mkt__own_files(p_urls text[], p_owner uuid) returns boolean language sql immutable as $$
  select coalesce(array_length(p_urls, 1), 0) <= 5 and not exists (select 1 from unnest(coalesce(p_urls, '{}')) u where not public.mkt__own_media(u, p_owner) or u = '') $$;

create or replace function public.mkt__party(p_order uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() = o.buyer_id then 'comprador' when auth.uid() = o.seller_id then 'vendedor' else null end from market_orders o where o.id = p_order $$;

-- 1. Mensagens associadas ao pedido ---------------------------------------------------------------------------
create table if not exists public.mkt_order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.market_orders(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (length(body) <= 1000),
  image_url text,
  hidden boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mkt_order_messages_nonempty check (length(trim(body)) > 0 or image_url is not null)
);
create index if not exists mkt_order_messages_order_idx on public.mkt_order_messages (order_id, created_at);

create or replace function public.mkt_message_send(p_order uuid, p_body text, p_image text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders; who text; other uuid; b text := regexp_replace(left(coalesce(p_body, ''), 1000), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g'); mid uuid;
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  select * into o from market_orders where id = p_order;
  who := public.mkt__party(p_order);
  if o.id is null or who is null then return public.mkt__deny('ORDERS_VIEW', 'mensagem_enviar', p_order::text); end if;
  if not public.is_active_user() then return public.mkt__err('ACCOUNT'); end if;
  if length(trim(b)) = 0 and coalesce(p_image, '') = '' then return public.mkt__err('TEXT'); end if;
  if p_image is not null and p_image <> '' and not public.mkt__own_media(p_image, auth.uid()) then return public.mkt__err('PHOTOS'); end if;
  other := case when who = 'comprador' then o.seller_id else o.buyer_id end;
  if exists (select 1 from blocks where (user_id = other and blocked = auth.uid()::text) or (user_id = auth.uid() and blocked = other::text)) then return public.mkt__err('BLOCKED'); end if;
  if not public.mkt__rate('msg:' || auth.uid(), 20, 60) or not public.mkt__rate('msgday:' || auth.uid(), 400, 86400) then
    perform public.mkt__risk(auth.uid(), 'spam_mensagens', p_order::text, 30); return public.mkt__err('RATE');
  end if;
  -- Sinal de fraude (não bloqueia): pedido para pagar fora da plataforma
  if lower(b) ~ '(pag(a|ar|amento)[^.]{0,30}(fora|dire(c)?to|por fora)|manda[^.]{0,20}(m-?pesa|e-?mola)[^.]{0,20}(n[uú]mero|para o))' then
    perform public.mkt__risk(auth.uid(), 'pagamento_fora_plataforma', p_order::text, 40, jsonb_build_object('order', p_order));
  end if;
  insert into mkt_order_messages (order_id, sender_id, body, image_url) values (p_order, auth.uid(), trim(b), nullif(p_image, '')) returning id into mid;
  perform public.mkt__notify(other, 'nova_mensagem', 'Nova mensagem sobre "' || left(o.product_title, 50) || '"', '/marketplace/pedido/?id=' || o.id,
    'msg:' || o.id || ':' || other || ':' || (extract(epoch from now())::bigint / 600));
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

create or replace function public.mkt_messages(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who text := public.mkt__party(p_order);
begin
  if who is null then
    if not public.mkt__can('DISPUTES_VIEW') then return public.mkt__deny('DISPUTES_VIEW', 'mensagens_ler', p_order::text); end if;
    perform public.mkt__audit('mensagens_ler', p_order::text, 'ok', 'consulta administrativa');
  else
    update mkt_order_messages set read_at = now() where order_id = p_order and sender_id <> auth.uid() and read_at is null;
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_id = auth.uid(),
      'sender', (select handle from profiles where id = m.sender_id), 'body', case when m.hidden then '' else m.body end, 'image_url', case when m.hidden then null else m.image_url end,
      'hidden', m.hidden, 'read', m.read_at is not null, 'at', m.created_at) order by m.created_at)
    from (select * from mkt_order_messages where order_id = p_order order by created_at desc limit 300) m), '[]'));
end $$;

-- 2. Denúncias (mensagens, avaliações, produtos, lojas, utilizadores) ------------------------------------------
create table if not exists public.mkt_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mensagem','avaliacao','produto','loja','utilizador')),
  target_id text not null check (length(target_id) between 1 and 80),
  reason text not null check (length(trim(reason)) between 5 and 500),
  status text not null default 'aberta' check (status in ('aberta','em_analise','procedente','improcedente')),
  resolution text not null default '',
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reporter_id, kind, target_id)
);
create index if not exists mkt_reports_status_idx on public.mkt_reports (status, created_at);

create or replace function public.mkt_report(p_kind text, p_target text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return public.mkt__err('AUTH'); end if;
  if not public.mkt__rate('report:' || auth.uid(), 10, 3600) then return public.mkt__err('RATE'); end if;
  if p_kind = 'mensagem' and not exists (select 1 from mkt_order_messages m where m.id::text = p_target and public.mkt__party(m.order_id) is not null) then return public.mkt__err('NOT_FOUND'); end if;
  begin
    insert into mkt_reports (reporter_id, kind, target_id, reason) values (auth.uid(), p_kind, p_target, trim(p_reason));
  exception when unique_violation then return public.mkt__err('ALREADY');
            when check_violation or not_null_violation then return public.mkt__err('INVALID');
  end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mkt_admin_report_action(p_id uuid, p_action text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r mkt_reports;
begin
  if not (public.mkt__can('PRODUCTS_MODERATE') or public.mkt__can('DISPUTES_MANAGE') or public.mkt__can('SECURITY_MANAGE')) then
    return public.mkt__deny('PRODUCTS_MODERATE', 'denuncia_' || coalesce(p_action, ''), p_id::text); end if;
  select * into r from mkt_reports where id = p_id for update;
  if r.id is null then return public.mkt__err('NOT_FOUND'); end if;
  if p_action not in ('analisar','procedente','improcedente') then return public.mkt__err('STATE'); end if;
  if p_action <> 'analisar' and length(trim(coalesce(p_note, ''))) < 5 then return public.mkt__err('REASON'); end if;
  update mkt_reports set status = case p_action when 'analisar' then 'em_analise' else p_action end, resolution = coalesce(trim(p_note), ''),
    resolved_by = case when p_action <> 'analisar' then auth.uid() end, resolved_at = case when p_action <> 'analisar' then now() end where id = r.id;
  -- Procedente: oculta o conteúdo (mensagem/avaliação). Produtos e lojas seguem pela moderação própria (com motivo).
  if p_action = 'procedente' then
    if r.kind = 'mensagem' then update mkt_order_messages set hidden = true where id::text = r.target_id; end if;
    if r.kind = 'avaliacao' then update market_reviews set hidden = true, hidden_reason = left(trim(p_note), 300) where order_id::text = r.target_id; end if;
  end if;
  perform public.mkt__audit('denuncia_' || p_action, r.kind || ':' || r.target_id, 'ok', p_note);
  return jsonb_build_object('ok', true);
end $$;

-- 3. Avaliações: compra verificada, uma por pedido, edição limitada com histórico, resposta do vendedor ---------------
alter table public.market_reviews add column if not exists store_id uuid references public.mkt_stores(id) on delete set null;
alter table public.market_reviews add column if not exists hidden_reason text not null default '';
alter table public.market_reviews add column if not exists seller_reply text;
alter table public.market_reviews add column if not exists reply_at timestamptz;
alter table public.market_reviews add column if not exists edited_at timestamptz;
alter table public.market_reviews add column if not exists verified boolean not null default true;

create table if not exists public.mkt_review_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.market_reviews(order_id) on delete cascade,
  rating integer not null, comment text not null,
  changed_by uuid, changed_at timestamptz not null default now()
);
drop trigger if exists mkt_review_history_immutable on public.mkt_review_history;
create trigger mkt_review_history_immutable before update or delete on public.mkt_review_history for each row execute function public.mkt__tg_immutable();

-- Média só com avaliações válidas (não ocultas pela moderação)
create or replace view public.market_seller_stats with (security_invoker = true) as
  select seller_id, round(avg(rating)::numeric, 1) as rating, count(*)::integer as reviews from public.market_reviews where not hidden group by seller_id;

create or replace function public.mkt_review_save(p_order uuid, p_rating integer, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders; rv market_reviews; c text := left(trim(coalesce(p_comment, '')), 500);
begin
  select * into o from market_orders where id = p_order;
  if o.id is null or o.buyer_id is distinct from auth.uid() then return public.mkt__err('FORBIDDEN'); end if;
  if o.status not in ('concluido','parcialmente_reembolsado') then return public.mkt__err('STATE'); end if;
  if p_rating is null or p_rating not between 1 and 5 then return public.mkt__err('RATING'); end if;
  if not public.mkt__rate('review:' || auth.uid(), 20, 3600) then return public.mkt__err('RATE'); end if;
  select * into rv from market_reviews where order_id = o.id for update;
  if rv.order_id is null then
    if coalesce(o.closed_at, o.updated_at) < now() - interval '60 days' then return public.mkt__err('TOO_LATE'); end if;
    insert into market_reviews (order_id, product_id, seller_id, buyer_id, buyer_name, rating, comment, store_id)
      values (o.id, o.product_id, o.seller_id, o.buyer_id, coalesce((select display_name from profiles where id = o.buyer_id), ''), p_rating, c, o.store_id);
    perform public.mkt__notify(o.seller_id, 'nova_avaliacao', 'Nova avaliação ' || p_rating || '★ em "' || left(o.product_title, 50) || '"', '/marketplace/criador', 'review:' || o.id);
  else
    if rv.hidden then return public.mkt__err('HIDDEN'); end if;
    if rv.edited_at is not null or rv.created_at < now() - interval '7 days' then return public.mkt__err('EDIT_LOCKED'); end if;
    insert into mkt_review_history (order_id, rating, comment, changed_by) values (rv.order_id, rv.rating, rv.comment, auth.uid());
    update market_reviews set rating = p_rating, comment = c, edited_at = now() where order_id = rv.order_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mkt_review_reply(p_order uuid, p_reply text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rv market_reviews;
begin
  select * into rv from market_reviews where order_id = p_order for update;
  if rv.order_id is null or rv.seller_id is distinct from auth.uid() then return public.mkt__err('FORBIDDEN'); end if;
  if length(trim(coalesce(p_reply, ''))) < 2 then return public.mkt__err('TEXT'); end if;
  update market_reviews set seller_reply = left(trim(p_reply), 500), reply_at = now() where order_id = p_order;
  return jsonb_build_object('ok', true);
end $$;

-- 4. Reclamações e disputas ------------------------------------------------------------------------------------
create table if not exists public.mkt_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.market_orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  reason_code text not null check (reason_code in ('nao_recebido','diferente','defeituoso','servico_incompleto','fraude','outro')),
  description text not null check (length(trim(description)) between 10 and 2000),
  evidence text[] not null default '{}',
  status text not null default 'aberta' check (status in ('aberta','aguardando_resposta','em_analise','aguardando_provas','solucao_proposta','resolvida','rejeitada','encerrada')),
  proposal jsonb,
  decision text check (decision in ('reembolso_total','reembolso_parcial','liberar_vendedor','rejeitada','acordo','desistencia')),
  decision_amount integer,
  decision_reason text not null default '',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  response_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_disputes_status_idx on public.mkt_disputes (status, created_at);

create table if not exists public.mkt_dispute_messages (
  id bigint generated always as identity primary key,
  dispute_id uuid not null references public.mkt_disputes(id) on delete cascade,
  author_id uuid,
  role text not null check (role in ('comprador','vendedor','staff','sistema')),
  body text not null check (length(body) <= 2000),
  evidence text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists mkt_dispute_messages_idx on public.mkt_dispute_messages (dispute_id, id);
drop trigger if exists mkt_dispute_messages_immutable on public.mkt_dispute_messages;
create trigger mkt_dispute_messages_immutable before update or delete on public.mkt_dispute_messages for each row execute function public.mkt__tg_immutable();

create or replace function public.mkt__dispute_set(p_id uuid, p_status text, p_note text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update mkt_disputes set status = p_status, updated_at = now() where id = p_id;
  if coalesce(p_note, '') <> '' then insert into mkt_dispute_messages (dispute_id, author_id, role, body) values (p_id, auth.uid(), p_role, left(p_note, 2000)); end if;
end $$;

create or replace function public.mkt_dispute_open(p_order uuid, p_reason text, p_description text, p_evidence text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o market_orders; did uuid;
begin
  select * into o from market_orders where id = p_order for update;
  if o.id is null or not o.v3 or o.buyer_id is distinct from auth.uid() then return public.mkt__err('FORBIDDEN'); end if;
  if exists (select 1 from mkt_disputes where order_id = o.id) then return public.mkt__err('ALREADY'); end if;
  if o.status not in ('pago','em_preparacao','enviado','em_execucao','entregue') then return public.mkt__err('STATE'); end if;
  if not public.mkt__own_files(p_evidence, auth.uid()) then return public.mkt__err('PHOTOS'); end if;
  if not public.mkt__rate('dispute:' || auth.uid(), 5, 86400) then return public.mkt__err('RATE'); end if;
  begin
    insert into mkt_disputes (order_id, buyer_id, seller_id, reason_code, description, evidence, status, response_due_at)
      values (o.id, o.buyer_id, o.seller_id, p_reason, trim(p_description), coalesce(p_evidence, '{}'), 'aguardando_resposta', now() + interval '72 hours') returning id into did;
  exception when check_violation or not_null_violation then return public.mkt__err('INVALID');
  end;
  perform public.mkt__set_status(o.id, 'disputa', 'abrir_disputa', 'comprador', left(trim(p_description), 300));
  insert into mkt_dispute_messages (dispute_id, author_id, role, body, evidence) values (did, auth.uid(), 'comprador', trim(p_description), coalesce(p_evidence, '{}'));
  perform public.mkt__notify(o.seller_id, 'reclamacao', 'Reclamação aberta em "' || left(o.product_title, 50) || '". Responde em 72 h.', '/marketplace/pedido/?id=' || o.id, 'dispute:' || did);
  return jsonb_build_object('ok', true, 'id', did);
end $$;

-- Partes: responder / enviar provas / propor solução (vendedor) / aceitar proposta ou desistir (comprador)
create or replace function public.mkt_dispute_action(p_dispute uuid, p_action text, p_note text default '', p_evidence text[] default '{}', p_amount integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d mkt_disputes; who text; o market_orders; r jsonb; amt integer;
begin
  select * into d from mkt_disputes where id = p_dispute for update;
  if d.id is null then return public.mkt__err('NOT_FOUND'); end if;
  who := case when auth.uid() = d.buyer_id then 'comprador' when auth.uid() = d.seller_id then 'vendedor' else null end;
  if who is null then return public.mkt__deny('DISPUTES_MANAGE', 'disputa_' || coalesce(p_action, ''), p_dispute::text); end if;
  if d.status in ('resolvida','rejeitada','encerrada') then return public.mkt__err('STATE'); end if;
  if not public.mkt__own_files(p_evidence, auth.uid()) then return public.mkt__err('PHOTOS'); end if;
  if not public.mkt__rate('dispute_act:' || auth.uid(), 30, 3600) then return public.mkt__err('RATE'); end if;
  select * into o from market_orders where id = d.order_id;
  if p_action = 'mensagem' then
    if length(trim(coalesce(p_note, ''))) < 2 and coalesce(array_length(p_evidence, 1), 0) = 0 then return public.mkt__err('TEXT'); end if;
    insert into mkt_dispute_messages (dispute_id, author_id, role, body, evidence) values (d.id, auth.uid(), who, left(trim(coalesce(p_note, '')), 2000), coalesce(p_evidence, '{}'));
    update mkt_disputes set status = case when d.status in ('aguardando_resposta','aguardando_provas') then 'em_analise' else status end,
      evidence = case when who = 'comprador' then (evidence || coalesce(p_evidence, '{}'))[1:10] else evidence end, updated_at = now() where id = d.id;
  elsif p_action = 'propor' and who = 'vendedor' then
    if p_amount is null or p_amount <= 0 or p_amount > o.total_mzn - o.refunded_mzn then return public.mkt__err('AMOUNT'); end if;
    update mkt_disputes set proposal = jsonb_build_object('amount', p_amount, 'note', left(coalesce(p_note, ''), 500), 'at', now()) where id = d.id;
    perform public.mkt__dispute_set(d.id, 'solucao_proposta', 'Proposta do vendedor: reembolso de ' || p_amount || ' MT. ' || coalesce(p_note, ''), 'vendedor');
  elsif p_action = 'aceitar' and who = 'comprador' and d.status = 'solucao_proposta' and d.proposal is not null then
    amt := (d.proposal->>'amount')::integer;
    r := public.mkt__refund_order(d.order_id, amt, 'acordo', 'Acordo na reclamação: reembolso de ' || amt || ' MT');
    if not (r->>'ok')::boolean then return r; end if;
    update mkt_disputes set decision = 'acordo', decision_amount = amt, decided_at = now() where id = d.id;
    perform public.mkt__dispute_set(d.id, 'resolvida', 'Proposta aceite pelo comprador.', 'sistema');
  elsif p_action = 'desistir' and who = 'comprador' then
    r := public.mkt__complete_order(d.order_id, 'comprador', 'desistir_disputa', coalesce(p_note, ''));
    if not (r->>'ok')::boolean then return r; end if;
    update mkt_disputes set decision = 'desistencia', decided_at = now() where id = d.id;
    perform public.mkt__dispute_set(d.id, 'encerrada', 'O comprador retirou a reclamação.', 'sistema');
  else
    return public.mkt__err('STATE');
  end if;
  perform public.mkt__notify(case when who = 'comprador' then d.seller_id else d.buyer_id end, 'reclamacao', 'Atualização na reclamação de "' || left(o.product_title, 50) || '"',
    '/marketplace/pedido/?id=' || d.order_id, 'dispute:' || d.id || ':' || p_action || ':' || extract(epoch from now())::bigint / 60);
  return jsonb_build_object('ok', true);
end $$;

-- Staff (DISPUTES_MANAGE; reembolsos exigem também REFUNDS_MANAGE)
create or replace function public.mkt_admin_dispute_action(p_dispute uuid, p_action text, p_reason text default '', p_amount integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d mkt_disputes; o market_orders; r jsonb := jsonb_build_object('ok', true); amt integer; nxt text;
begin
  if not public.mkt__can('DISPUTES_MANAGE') then return public.mkt__deny('DISPUTES_MANAGE', 'disputa_' || coalesce(p_action, ''), p_dispute::text); end if;
  select * into d from mkt_disputes where id = p_dispute for update;
  if d.id is null then return public.mkt__err('NOT_FOUND'); end if;
  if d.status in ('resolvida','rejeitada','encerrada') then return public.mkt__err('STATE'); end if;
  select * into o from market_orders where id = d.order_id;
  if p_action in ('analisar','pedir_provas') then
    nxt := case p_action when 'analisar' then 'em_analise' else 'aguardando_provas' end;
    perform public.mkt__dispute_set(d.id, nxt, coalesce(nullif(trim(p_reason), ''), case when nxt = 'aguardando_provas' then 'A equipa pediu mais provas.' else 'Em análise pela equipa.' end), 'staff');
  elsif p_action in ('reembolso_total','reembolso_parcial','liberar_vendedor','rejeitar') then
    if length(trim(coalesce(p_reason, ''))) < 10 then return public.mkt__err('REASON'); end if;
    if p_action in ('reembolso_total','reembolso_parcial') then
      if not public.mkt__can('REFUNDS_MANAGE') then return public.mkt__deny('REFUNDS_MANAGE', 'disputa_' || p_action, p_dispute::text); end if;
      amt := case when p_action = 'reembolso_total' then o.total_mzn - o.refunded_mzn else p_amount end;
      r := public.mkt__refund_order(o.id, amt, 'admin', 'Decisão da reclamação: ' || trim(p_reason));
    else
      r := public.mkt__complete_order(o.id, 'admin', case when p_action = 'rejeitar' then 'disputa_rejeitada' else 'disputa_liberada' end, trim(p_reason));
    end if;
    if not (r->>'ok')::boolean then return r; end if;
    update mkt_disputes set decision = case p_action when 'rejeitar' then 'rejeitada' else p_action end, decision_amount = amt, decision_reason = trim(p_reason),
      decided_by = auth.uid(), decided_at = now() where id = d.id;
    perform public.mkt__dispute_set(d.id, case when p_action = 'rejeitar' then 'rejeitada' else 'resolvida' end, 'Decisão: ' || trim(p_reason), 'staff');
    perform public.mkt__notify(d.buyer_id, 'disputa_resolvida', 'Reclamação decidida: ' || left(trim(p_reason), 120), '/marketplace/pedido/?id=' || o.id, 'dispute-decision:' || d.id || ':b');
    perform public.mkt__notify(d.seller_id, 'disputa_resolvida', 'Reclamação decidida: ' || left(trim(p_reason), 120), '/marketplace/pedido/?id=' || o.id, 'dispute-decision:' || d.id || ':s');
  else
    return public.mkt__err('STATE');
  end if;
  perform public.mkt__audit('disputa_' || p_action, d.id::text, 'ok', p_reason, jsonb_build_object('status', d.status), jsonb_build_object('amount', amt));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mkt_dispute_get(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d mkt_disputes; who text;
begin
  select * into d from mkt_disputes where order_id = p_order;
  if d.id is null then return jsonb_build_object('ok', true, 'dispute', null); end if;
  who := case when auth.uid() = d.buyer_id then 'comprador' when auth.uid() = d.seller_id then 'vendedor' when public.mkt__can('DISPUTES_VIEW') then 'staff' else null end;
  if who is null then return public.mkt__err('NOT_FOUND'); end if;
  if who = 'staff' then perform public.mkt__audit('disputa_ler', d.id::text, 'ok', null); end if;
  return jsonb_build_object('ok', true, 'role', who, 'dispute', to_jsonb(d),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'body', body, 'evidence', evidence, 'at', created_at) order by id), '[]') from mkt_dispute_messages where dispute_id = d.id));
end $$;

-- 5. RLS ---------------------------------------------------------------------------------------------------
alter table public.mkt_order_messages enable row level security;
alter table public.mkt_reports enable row level security;
alter table public.mkt_review_history enable row level security;
alter table public.mkt_disputes enable row level security;
alter table public.mkt_dispute_messages enable row level security;
drop policy if exists mkt_order_messages_read on public.mkt_order_messages;
create policy mkt_order_messages_read on public.mkt_order_messages for select using (
  exists (select 1 from public.market_orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid()))));
drop policy if exists mkt_reports_read on public.mkt_reports;
create policy mkt_reports_read on public.mkt_reports for select using (reporter_id = (select auth.uid()) or (select public.mkt__is_staff()));
drop policy if exists mkt_review_history_read on public.mkt_review_history;
create policy mkt_review_history_read on public.mkt_review_history for select using ((select public.mkt__can('PRODUCTS_MODERATE')));
drop policy if exists mkt_disputes_read on public.mkt_disputes;
create policy mkt_disputes_read on public.mkt_disputes for select using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select public.mkt__can('DISPUTES_VIEW')));
drop policy if exists mkt_dispute_messages_read on public.mkt_dispute_messages;
create policy mkt_dispute_messages_read on public.mkt_dispute_messages for select using (
  exists (select 1 from public.mkt_disputes d where d.id = dispute_id and (d.buyer_id = (select auth.uid()) or d.seller_id = (select auth.uid()))) or (select public.mkt__can('DISPUTES_VIEW')));
-- Avaliações ocultas pela moderação deixam de ser públicas (o autor e o vendedor continuam a vê-las)
drop policy if exists market_reviews_read on public.market_reviews;
create policy market_reviews_read on public.market_reviews for select using (not hidden or buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or (select public.mkt__can('PRODUCTS_MODERATE')));
revoke all on public.mkt_order_messages, public.mkt_reports, public.mkt_review_history, public.mkt_disputes, public.mkt_dispute_messages from anon, authenticated;
grant select on public.mkt_order_messages, public.mkt_reports, public.mkt_review_history, public.mkt_disputes, public.mkt_dispute_messages to authenticated;

revoke all on function public.mkt__party(uuid), public.mkt__dispute_set(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.mkt_message_send(uuid, text, text), public.mkt_messages(uuid), public.mkt_report(text, text, text), public.mkt_admin_report_action(uuid, text, text),
  public.mkt_review_save(uuid, integer, text), public.mkt_review_reply(uuid, text), public.mkt_dispute_open(uuid, text, text, text[]),
  public.mkt_dispute_action(uuid, text, text, text[], integer), public.mkt_admin_dispute_action(uuid, text, text, integer), public.mkt_dispute_get(uuid) from public, anon;
grant execute on function public.mkt_message_send(uuid, text, text), public.mkt_messages(uuid), public.mkt_report(text, text, text), public.mkt_admin_report_action(uuid, text, text),
  public.mkt_review_save(uuid, integer, text), public.mkt_review_reply(uuid, text), public.mkt_dispute_open(uuid, text, text, text[]),
  public.mkt_dispute_action(uuid, text, text, text[], integer), public.mkt_admin_dispute_action(uuid, text, text, integer), public.mkt_dispute_get(uuid) to authenticated;
grant execute on function public.mkt__own_files(text[], uuid) to authenticated;

notify pgrst, 'reload schema';
