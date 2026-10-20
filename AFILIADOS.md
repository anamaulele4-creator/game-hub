# TXAPILOG · Moderadores, afiliados e verificação de vendedores (2026-10-20)

Pedido do dono (2026-10-20). Tudo continua com **dinheiro real DESLIGADO**: a carteira é a carteira MT existente (créditos internos, `money_ledger`); nada liga M-Pesa nem os interruptores monetários.

**Instalar o SQL:** abrir `https://anamaulele4-creator.github.io/game-hub/sql-afiliados.html` no telemóvel (6 partes, por ordem) — ou correr `supabase/migrations/2026-10-20-moderador-afiliados.sql` no SQL Editor. Idempotente. Tem de correr **depois** de `schema.sql`, `migrations/*` e `competitive.sql` (`sql-competitivo.html`).

---

## 1. Papéis

| Papel (app / BD) | Participar em torneios | Criar torneios e campeonatos | Apostar / escolher o valor | Destacar os próprios anúncios | Painel de afiliado / comissões |
|---|---|---|---|---|---|
| `utilizador` / `user` | ✅ | ❌ | ✅ | ❌ | ❌ (pode associar um código de convite) |
| `criador` / `creator` | ✅ | ❌ (como já era: só admin e organizadores do AI CORE criavam) | ✅ | ❌ | ❌ |
| `moderador` / `moderator` (influenciador) | ✅ | ✅ (só gere os seus) | ✅ | ✅ automático (o admin pode retirar) | ✅ |
| `admin` | ✅ | ✅ (todos) | ✅ | ✅ | ✅ |

- O papel muda-se em **Admin › Utilizadores** (lista de funções). Para moderadores aparece o botão **Retirar destaque / Devolver destaque**.
- Imposto no servidor: políticas RLS `mod_tournaments_*` (insert/update/delete só com `created_by = auth.uid()` e `is_mod()`), trigger `tournament_owner` (força `created_by`, `organizer = @handle`, protege `entries_count`), `tournament_entry_admin` aceita o dono do torneio, leitura das inscrições do próprio torneio (`entries_read_owner`), capas em `media/tournaments/<uid>/`.
- Campeonatos: coluna `tournaments.kind` (`torneio` | `campeonato`).
- Prémios (`tournament_prizes`) continuam a ser registados **só pelo admin** (evita que um moderador gere prémios para si próprio ou para convidados).

## 2. Afiliados

- **Código e link:** cada moderador/admin recebe um código único (`@handle` + 4 caracteres, ex. `NYXFF4K2`), criado ao abrir **/afiliados**. Link: `https://<site>/registar/?ref=CODIGO`.
- **Registo:** o `?ref=` (ou o código escrito no campo “Código de afiliado”) vai nos metadados do registo (`raw_user_meta_data.ref`); o trigger `aff_profile_ins` grava `profiles.referred_by`. Para registos por Google/OTP (sem metadados) o código fica guardado no navegador e é associado depois do login por `affiliate_apply_code` — **uma única vez**, nos **primeiros 7 dias** da conta, sem auto-convite (constraint `profiles_no_self_referral`) nem ciclo direto. O cliente nunca consegue escrever `referred_by`/`affiliate_code` (trigger `aff_profile_upd`).
- **Comissão:** `affiliate_settings.commission_pct`, por omissão **10 %**, configurável em **Admin › Afiliados & verificação** (0–50 %, ou pausar).
- **Só há comissão quando o convidado GANHA dinheiro:**

| Evento | Base da comissão | Onde |
|---|---|---|
| Aposta em MT ganha | lucro líquido = pagamento − valor apostado | trigger `aff_bet` (bets) |
| Aposta num desafio ganha | igual (tipo `desafio`) | `aff_bet` (mercado ligado a `comp_challenges`) |
| Venda concluída no marketplace (escrow `concluido`) | valor do vendedor = total − taxa da plataforma | trigger `aff_market_order` |
| Prémio de torneio / campeonato | valor do prémio | trigger `aff_prize` (tournament_prizes) |

  Não geram nada: registos, depósitos, perdas, apostas anuladas/reembolsos, compras, apostas em TXAP Pontos (sem valor monetário).
- **Quem ganha:** só se o padrinho tiver função `moderador` ou `admin` e não estiver banido. Padrinho `utilizador`/`criador` → nenhuma comissão. Se um moderador for despromovido, deixa de ganhar.
- **Quem paga (decisão):** a **plataforma** paga a comissão como bónus ao influenciador. O convidado fica com **100 %** do ganho — nada é descontado.
- **Livro:** `affiliate_commissions` (`unique(source_kind, source_ref)` → idempotente; só `status` muda de `creditado` para `anulado`). Crédito na carteira por `bets__post_mt(referrer, valor, 'comissao_afiliado', '<tipo>:<ref>')` (novo motivo do `money_ledger`, também idempotente por utilizador/motivo/ref). Se uma aposta ganha for reaberta (resultado corrigido), a comissão é **anulada** com um lançamento `correcao` (`aff-rev:<id>`).
- Falhas no cálculo da comissão nunca bloqueiam o ganho do convidado (`aff__safe_credit`: subtransação + `audit_log` “afiliado:erro”).
- **Painel /afiliados:** link e código com botões Copiar/Partilhar, nº de convidados, lista de convidados (nome, @, data, quanto rendeu), histórico de comissões, **total ganho** e **pendente** (= comissão estimada sobre vendas de convidados ainda em curso: `pago`/`entregue`/`disputa`), tudo em MT.
- RPCs: `affiliate_me()`, `affiliate_apply_code(code)`, `affiliate_admin_set_settings(pct, enabled)`, `affiliate_admin_overview()`. Internas (sem acesso de clientes): `affiliate__credit`, `affiliate__reverse`, `affiliate__new_code`.
- Antifraude a acompanhar: contas falsas do próprio moderador como convidados. As comissões ficam visíveis em Admin › Afiliados; o admin pode retirar o papel ou banir.

## 3. Destaque no marketplace

- `market__tg_guard` (redefinido): moderador/admin podem mudar `featured` **só nos próprios anúncios**; outros recebem `FEATURE_FORBIDDEN`. `profiles.feature_revoked = true` (Admin › Utilizadores) retira a permissão e tira logo todos os destaques desse moderador. O admin continua a destacar/retirar qualquer anúncio em Admin › Marketplace.
- UI: caixa **“Pôr em destaque”** em Marketplace › Anunciar/Editar (só aparece a quem pode).

## 4. Verificação de vendedores (contas e diamantes)

- Para anunciar `tipo = conta`, `tipo = moedas` ou `categoria = moedas` (diamantes e moedas), o vendedor tem de ter **documento + selfie aprovados**. Bloqueado na UI e no servidor (`SELLER_VERIFICATION` no trigger, ao criar, ao mudar tipo/categoria ou ao republicar). O admin está isento.
- Fluxo: Marketplace › Anunciar mostra o cartão “Verificação de vendedor” → foto do documento + selfie (reduzidas no telemóvel, sem EXIF) → bucket **privado** `verificacoes/<uid>/…` → `seller_verification_submit` → estado `pendente` → **Admin › Afiliados & verificação** (fotos abertas com links temporários de 5 min) → **Aprovar** ou **Recusar** com motivo (≥ 5 caracteres) → notificação ao vendedor. Fotos recusadas são apagadas; pode reenviar.
- Dados mínimos: só as 2 imagens, estado, motivo e datas (nenhum número de documento). Texto acrescentado à Política de Privacidade (`lib/policies.ts`). **Nota:** se a política já foi guardada na BD (Admin › Políticas), o texto da BD tem prioridade — atualizar lá também.

## 5. Apostas em desafios — valor escolhido pelo utilizador

- A folha “Confirmar aposta” do desafio tem o campo **“O teu valor (MT)”** com atalhos e validação inteira entre `bet_settings.mt_min_stake` e `mt_max_stake` (e o limite pessoal `mt_max_stake` do jogador). O servidor (`bets_place`) já recusava fora dos limites. Odd fixa 2.00, só equipa vencedora (como antes). Continua atrás dos interruptores monetários/licença (`comp__betting_on`, `realOn()`).

## 6. Carteira — depósito entra logo

- O crédito acontece **automaticamente e de forma atómica** em `comp__confirm_deposit` (já existente, só `service_role`: marca o pagamento como pago e lança no `money_ledger` na mesma transação), chamado pela Edge Function `payments` no instante em que o fornecedor confirma — webhook assinado `/webhook/mpesa` ou consulta de estado `/wallet-deposit-check` (agregador ClicPay, código já presente no repositório). Sem aprovação manual. Idempotente por `event_id`, por pagamento (`status = pago`) e pelo id da transação do fornecedor (`payments.provider_ref` único + `money_ledger` único por ref de depósito). Pedidos só iniciados/pendentes nunca creditam.
- A app atualiza o saldo **logo**: Supabase Realtime em `money_ledger` e `payments` (adicionados à publicação `supabase_realtime` por esta migração; RLS só deixa ver os próprios) + releitura a cada 4 s enquanto houver depósito pendente + releitura ao voltar da app M-Pesa.
- M-Pesa/e-Mola continuam **não configurados** e o monetário **desligado**.

## 7. Ficheiros

`supabase/migrations/2026-10-20-moderador-afiliados.sql`, `public/sql-afiliados.html` (gerado por `scripts/sql-installer.py`), `lib/affiliates.ts` (regras puras), `lib/affiliatesApi.ts`, `components/affiliates/Panel.tsx`, `app/afiliados`, `app/organizar`, `components/market/SellerVerification.tsx`, `components/admin/Affiliates.tsx`, alterações em `components/admin/Tournaments.tsx`, `components/admin/Users.tsx`, `app/admin/page.tsx`, `app/torneios/page.tsx`, `app/registar/page.tsx`, `app/perfil/page.tsx`, `app/marketplace/anunciar/page.tsx`, `components/comp/Challenges.tsx`, `components/comp/Wallet.tsx`, `components/SystemOverlays.tsx`, `lib/sync.ts`, `lib/store.tsx`, `lib/data.ts`, `lib/marketApi.ts`, `lib/policies.ts`. (A Edge Function `payments` não foi alterada.)

## 8. Testes

- `tests/affiliates.test.mjs` — regras puras: 10 % só sobre ganhos (lucro líquido da aposta, valor do vendedor), nada em perdas/depósitos/compras/registos, sem auto-convite, só padrinhos moderador/admin, idempotência, % configurável, permissões por papel, verificação de vendedor, validação do valor da aposta.
- `tests/affiliates-sql.test.mjs` — o SQL real em PGlite (migração aplicada 2×): registo com `?ref=`, padrinho imutável, crédito no livro-razão e idempotência, anulação ao reabrir, venda concluída, prémio de campeonato, mudança de %, RLS dos torneios (utilizador e criador recusados, moderador só os seus), verificação documental e destaque.
