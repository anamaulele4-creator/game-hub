# TXAPILOG Marketplace 3.0

Lojas, Creator OS, carrinho, checkout, pedidos, pagamentos com a carteira, comissões, pagamentos a vendedores,
mensagens, avaliações, reclamações, painel de gestão com permissões, auditoria e relatórios — construído **por cima**
do marketplace existente (anúncios `market_products`, compra segura `market_orders`, carteira `money_ledger`).

## Princípios

- **Servidor decide tudo.** O site é estático (GitHub Pages); toda a lógica sensível está em funções `SECURITY DEFINER`
  do Supabase com RLS. O navegador só lê e chama funções; não tem `insert/update/delete` nas tabelas financeiras.
- **Aditivo e compatível.** Só se acrescentam tabelas, colunas (com valores por omissão) e estados (superconjuntos).
  O formulário `/marketplace/anunciar`, os pedidos antigos e a auditoria antiga continuam iguais. Nada é apagado.
- **Tudo desligado por omissão** (interruptores em `app_settings`, os mesmos de Apostas v2; mudanças ficam na auditoria).
- **Dinheiro real nunca é simulado.** O comprador paga com o saldo da carteira, que só recebe dinheiro pelo fluxo de
  depósitos existente (função `payments`: webhook com assinatura verificada, idempotência por `event_id`, reconciliação
  a cada 2 min). O pagamento do pedido é um débito atómico na carteira + lançamento no diário. Sem o interruptor
  `mkt3_checkout_enabled` (ou sem comissão definida) o checkout diz "Pagamento ainda não disponível" e não cria nada.

## Instalação (dono)

1. Supabase › SQL Editor: correr, por ordem, `sql-afiliados.html` (se ainda não), `sql-apostas.html` (Apostas v2: cria
   `app_settings` e `app_audit_log`) e depois **`/sql-marketplace.html` — 6 partes por ordem**. Tudo é idempotente.
2. Na app: **Marketplace › Gestão › Comissões** — criar a regra global (ex.: 10 %).
3. **Gestão › Equipa e permissões** — dar permissões ao suporte (predefinições Suporte / Moderação / Financeiro).
4. **Gestão › Definições** — ligar `Marketplace 3.0 aberto ao público`. Testar. Depois ligar `Pagamentos com dinheiro
   real` e `Pedidos de pagamento a vendedores`. (Opcional: `Admin › Marketplace › Tarifas` — dias de libertação automática.)
5. Partes 7–10 (`/sql-pendentes.html` para quem já correu o `sql-tudo.html` anterior; já incluídas no `sql-tudo.html`).
6. Prazos: automáticos a cada 5 min (Parte 7, job pg_cron `mkt-sweep`; o estado aparece em Gestão › Definições).
   O botão `Processar prazos agora` continua disponível. Sem pg_cron, o SQL não falha e só o botão processa.

## Estados

- Loja: `configuracao → pendente → ativa`, `suspensa`, `encerrada` (histórico em `mkt_store_decisions`).
- Produto: `rascunho`, `pendente`, `ativo` (= Publicado), `esgotado` (automático com stock 0), `suspenso` (só moderação), `arquivado`.
- Pedido v3: `criado → aguarda_pagamento → (pagamento_processamento) → pago → em_preparacao / em_execucao / enviado →
  entregue → concluido`, mais `cancelado`, `disputa`, `reembolsado`, `parcialmente_reembolsado`. Grafo em `mkt__edge_ok`
  (igual a `V3_EDGES` em `lib/mkt3.ts`, verificado por teste). O trigger `market_orders_mkt3_guard` impede mudanças de
  valores e de estado fora das funções. Histórico imutável em `mkt_order_events`.
- Pagamento: `criado, pendente, processamento, confirmado, recusado, expirado, cancelado, reembolsado, parcialmente_reembolsado`
  (`mkt_payments` + histórico imutável `mkt_payment_events`).
- Disputa: `aberta, aguardando_resposta, em_analise, aguardando_provas, solucao_proposta, resolvida, rejeitada, encerrada`.

## Dinheiro (diário de partidas dobradas `mkt_journal`, imutável; cada transação soma 0)

| Evento | Linhas |
|---|---|
| Pagar pedido | carteira(comprador) −T · escrow +T (e `money_ledger` `compra`) |
| Concluir | escrow −T · carteira(vendedor) +líquido · receita +comissão (`money_ledger` `venda`) |
| Reembolso total/parcial | escrow −R · carteira(comprador) +R (`reembolso`); no parcial o resto é liquidado com comissão proporcional |
| Pedido de pagamento | carteira(vendedor) −P · payout_curso +P (`payout`) |
| Pago pelo operador | payout_curso −P · externo +P (exige referência da transação) |
| Recusado/falhou | payout_curso −P · carteira +P (`payout_recusado`) |

Comissão: regra por vendedor > categoria > global > `market_settings.fee_pct`; `round(base × pct/100) + fixa` (base =
itens − desconto). A regra e os valores ficam **guardados no pedido** (`commission_rule_id`, `commission_pct`, …):
mudar a regra não altera pedidos já feitos. `mkt_admin_reconcile()` confere diário, escrow, carteiras e pagamentos.

## Funções principais (RPC)

Cliente: `mkt_me`, `mkt_search`, `mkt_suggest`, `mkt_related`, `mkt_store_public`, `mkt_product_view`, `mkt_cart_set`,
`mkt_cart_view`, `mkt_checkout(idem, entrega, cupões, nota)`, `mkt_pay(pagamento, idem)`, `mkt_order_get`,
`mkt_orders_mine`, `mkt_order_action`, `mkt_messages`, `mkt_message_send`, `mkt_report`, `mkt_review_save`,
`mkt_dispute_open`, `mkt_dispute_action`, `mkt_dispute_get`, `mkt_notification_prefs_set`.
Vendedor: `mkt_store_save`, `mkt_store_owner_action`, `mkt_variant_save`, `mkt_product_duplicate`, `mkt_coupon_save`,
`mkt_review_reply`, `mkt_seller_finance`, `mkt_payout_request`, `mkt_creator_dashboard`, `mkt_creator_report`
(produtos: insert/update direto em `market_products`, protegido por RLS e pelos triggers).
Gestão (cada uma verifica a permissão e regista recusas): `mkt_admin_dashboard`, `mkt_admin_list`, `mkt_admin_store_action`,
`mkt_admin_product_action`, `mkt_admin_refund`, `mkt_admin_payout_action`, `mkt_admin_dispute_action`,
`mkt_admin_report_action`, `mkt_admin_risk_action`, `mkt_admin_commission_set`, `mkt_admin_reconcile`, `mkt_sweep`,
`mkt_admin_staff`, `mkt_admin_set_perm`, `mkt_admin_user_suspend`, `mkt_admin_audit`, `mkt_admin_audit_export`, `mkt_admin_report`.
Respostas: `{ ok: true, … }` ou `{ ok: false, code: 'CODIGO' }` (mensagens em `MKT3_ERR`, `lib/mkt3.ts`).

## Permissões

`USERS_VIEW, USERS_MANAGE, CREATORS_VIEW, CREATORS_MANAGE, STORES_VIEW, STORES_MANAGE, PRODUCTS_VIEW, PRODUCTS_MODERATE,
ORDERS_VIEW, PAYMENTS_VIEW, REFUNDS_MANAGE, PAYOUTS_VIEW, PAYOUTS_MANAGE, DISPUTES_VIEW, DISPUTES_MANAGE, REPORTS_VIEW,
AUDIT_LOGS_VIEW, AUDIT_LOGS_EXPORT, SECURITY_MANAGE, SETTINGS_MANAGE` (`mkt_staff_perms`). Admin (role) tem todas.
Funções de conta: cliente (qualquer utilizador), criador (`role = creator`), vendedor (criador ou vendedor verificado por
documento + selfie), admin, suporte (utilizador com permissões). Venda de **contas** continua só para criador/admin
(regra de `venda-contas`, mantida).

## Páginas

`/marketplace/pesquisa`, `/marketplace/loja?s=`, `/marketplace/carrinho`, `/marketplace/checkout`, `/marketplace/pedido?id=`,
`/marketplace/pedidos` (lista nova + compra segura antiga), `/marketplace/reclamacoes`, `/marketplace/criador` (Creator OS),
`/marketplace/gestao` (gestão). Anúncio (`/marketplace/anuncio`) ganha carrinho/variantes, detalhes, vídeos, avaliações e relacionados.

## Testes

`npm test` — `tests/mkt3-sql.test.mjs` (PGlite: segurança, preços, estados, pagamentos, reembolsos, payouts, disputas,
avaliações, auditoria, permissões) e `tests/mkt3.test.mjs` (regras puras, sincronização cliente/servidor, página SQL).

## Partes 7–10 (2026-10-21)

- **Parte 7 · Prazos automáticos**: `cron.schedule('mkt-sweep', '*/5 * * * *', 'select public.mkt_sweep()')`, só se o pg_cron
  existir (guardado com `to_regnamespace('cron')`). `mkt_admin_sweep_status()` mostra o estado. O `mkt_sweep` também liquida
  pagamentos diretos pendentes e volta a tentar avisos falhados.
- **Parte 8 · Equipa da loja** (`mkt_store_members`): o dono convida/remove por @ (`mkt_store_member_set`, `mkt_store_member_remove`;
  máx. 10). `gestor`: produtos da loja (`mkt_team_product_save`, `mkt_variant_save`), avança pedidos (preparar/enviar/iniciar/entregar;
  cancelar/reembolsar só o dono) e chat. `atendimento`: vê pedidos (sem comissões) e chat. RLS em `market_orders`, `mkt_order_events`,
  `mkt_order_messages`, `market_products`, `mkt_product_variants`. Tudo auditado (`loja_equipa_*`). Painel: separador **Equipa**.
- **Parte 9 · Pagamento direto M-Pesa/e-Mola**: `mkt_pay_direct_start` cria um depósito (`payments`, kind `carteira`) com o valor exato
  em falta, ligado ao pagamento (`mkt_direct_deposits`); o navegador chama a Edge Function existente `payments/wallet-deposit`.
  Quando o fornecedor confirma (`comp__confirm_deposit` via webhook, `/wallet-deposit-check` ou `/reconcile`), um trigger diferido
  paga o pedido com `mkt__pay_core` (mesma lógica de `mkt_pay`). Idempotente; se o pedido já não puder ser pago, o valor fica na
  carteira e o comprador é avisado. Interruptor: `mkt3_checkout_enabled` + fornecedor configurado (`comp_provider_status`).
  **A Edge Function `payments` não mudou.**
- **Parte 10 · Creator OS**: perfil (`mkt_creator_profile_save`), métodos de recebimento (`mkt_payout_methods`), reclamações das
  vendas (`mkt_creator_disputes`), automações com estado (`mkt_creator_automations`): novo pedido (na criação), pagamento confirmado,
  pedido cancelado (incl. prazo), concluído, avaliação, mensagem, reclamação, pagamento disponibilizado, stock baixo, conta;
  falhas tentadas de novo até 3 vezes. O Painel do criador aparece no menu da conta, em Mais e no Marketplace para criador,
  vendedor verificado e admin, mesmo com o Marketplace 3.0 fechado ao público.

## Limitações conhecidas

- Envio automático de pagamentos a vendedores (B2C) não está implementado: exige credenciais/contrato. Os pagamentos a
  vendedores são feitos pelo operador e registados com a referência. (O pagamento direto M-Pesa/e-Mola no checkout passa
  pelo fluxo de depósitos da carteira — Parte 9.)
- Email/SMS não são enviados (sem integração); notificações são na plataforma (+ push existente).
