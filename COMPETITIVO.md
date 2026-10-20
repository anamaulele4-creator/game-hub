# TXAPILOG · Módulo Competitivo

Equipas, desafios entre equipas, páginas públicas de evento, previsões grátis, carteira em MT, pagamentos M-Pesa, apostas (bloqueadas até ativação legal) e painel de administração.

> **2026-10-20:** moderadores (influenciadores), afiliados (comissão 10 %), torneios/campeonatos criados por moderadores, destaque no marketplace, verificação de vendedores e carteira em tempo real → ver **[AFILIADOS.md](AFILIADOS.md)** (SQL: `supabase/migrations/2026-10-20-moderador-afiliados.sql`, instalador `/sql-afiliados.html`).

> **Estado por omissão:** tudo o que envolve dinheiro está **DESLIGADO** (`monetary_features_enabled = false`, `betting_enabled = false`). Os ecrãs monetários mostram **“Indisponível até aprovação legal”**. Equipas, desafios, resultados, disputas e previsões grátis funcionam sem dinheiro.

---

## 1. O que já existia e foi reutilizado

| Peça existente | Onde | Como é usada aqui |
|---|---|---|
| Next.js 14 (App Router) estático, `output: 'export'`, GitHub Pages | `next.config.mjs` | Sem servidor Node: toda a validação vive no Postgres (RLS + funções `SECURITY DEFINER` + triggers) e nas Edge Functions. Páginas dinâmicas por parâmetro (`/desafios/evento?id=…`), como `/torneio?id=…`. |
| Modo real / demo | `lib/config.ts` (`IS_DEMO`), `lib/supabase.ts` (`sb()`) | `lib/competitiveApi.ts` segue o mesmo padrão de `lib/betsApi.ts`: RPCs no modo real, motor em memória + `localStorage` no modo demo. |
| Perfis, papéis, `is_admin()`, `is_mod()`, `is_active_user()` | `supabase/schema.sql` | Permissões de todas as RPCs. Admin = `profiles.role = 'admin'` (anamaulele4@gmail.com). |
| MFA / step-up (`recent_strong_auth()`, aal2) | `schema.sql` §15 | Operações sensíveis de admin exigem `aal = 'aal2'` no JWT, verificado **dentro** da função (`comp__strong_auth()`). |
| PIN de transação (`issue_tx_token`, `tx_authorizations`) | `schema.sql` §15, `components/PinPrompt.tsx` | Levantamentos (`comp_wallet_withdraw`) consomem uma autorização de PIN de uso único. |
| KYC (`bet_kyc`, `security_settings.kyc_level`) | `migrations/2026-10-10-bets-money.sql`, `schema.sql` | Elegibilidade: KYC aprovado (ou nível ≥ 2). |
| `risk_flags`, `audit_log`, `security_events`, `notifications` | `schema.sql` | Alertas de fraude, auditoria e notificações do módulo (tipo `torneio`/`compra`). |
| Livro-razão MT `money_ledger` (só acréscimos, idempotente por `(user, reason, ref)`, bloqueio consultivo por utilizador), `money_withdrawals` | `migrations/2026-10-10-bets-money.sql` | **É a carteira.** Não foi criado um segundo livro-razão: acrescentaram-se `entry_id uuid` único e `idempotency_key` única. |
| `payments` (`provider_ref` e `idempotency_key` únicos) + Edge Function `payments` (esboço com HMAC) | `schema.sql`, `supabase/functions/payments` | Depósitos da carteira = linhas `payments.kind = 'carteira'`. A Edge Function ganhou rotas novas e uma camada de fornecedores. |
| Motor de apostas (`bet_matches`, `bet_markets`, `bet_selections`, `bets`, `bet_legs`, `bets_place`, `bets__apply_outcome`, `bets_sweep`, limites, autoexclusão) | `migrations/2026-10-10-bets*.sql`, `lib/bets*.ts` | Apostas em desafios **usam o mesmo motor**: o admin abre um `bet_match` ligado ao desafio (`bet_matches.challenge_id`); odds Elo + margem; fecha à hora de início; liquida/anula pelo mesmo código. |
| Limite de pedidos `core_rate_limit` (AI CORE) | `migrations/2026-10-09-ai-core.sql` | Mesmo padrão em `comp__rate()` (tabela própria `comp_rate_hits`, para não depender do AI CORE estar instalado). |
| Upload de imagens (`uploadPhoto`, bucket `media`, pasta `teams/<uid>/`) | `lib/media.ts`, `migrations/2026-10-10-team-logos.sql` | Logótipos das equipas e provas (`proofs/<uid>/`). |
| `TeamBadge`, `Sheet`, `Tabs`, `Page`, classes `.btn/.card/.hud-card/.input` | `components/` | Mesma identidade visual (azul-noite + amarelo). |

`core_teams` (AI CORE) não foi reutilizada como equipa da plataforma porque é específica de Free Fire, ligada a `core_players` e limitada a duo/squad. `comp_teams` guarda ligações opcionais (`core_team_id`, `bet_team_id`).

---

## 2. Ficheiros

| Ficheiro | Conteúdo |
|---|---|
| `supabase/competitive.sql` | Migração idempotente: tabelas, RLS, RPCs, triggers, índices, cron. |
| `lib/competitive.ts` | Regras puras (máquina de estados, cancelamento, reconciliação, elegibilidade, gating, livro-razão, termos da aposta, textos PT). |
| `lib/competitiveCore.ts` | Motor em memória (modo demo + testes), espelho das RPCs. |
| `lib/competitiveApi.ts` | API real (Supabase) + demo. |
| `components/comp/*` | Equipas, desafios + página pública do evento, carteira, perfil público, atalhos, estado “Indisponível”. |
| `components/admin/Competitive.tsx` | Admin › Competitivo. |
| `app/equipas`, `app/equipas/equipa?id=`, `app/desafios`, `app/desafios/evento?id=`, `app/carteira`, `app/jogador?u=`, `app/ranking` | Páginas. `/desafios/evento` e `/jogador` são públicas (sem sessão). |
| `supabase/functions/payments/providers.ts` | Interface de fornecedor + adaptador M-Pesa (esqueleto). |
| `supabase/functions/payments/index.ts` | Rotas `/health`, `/wallet-deposit`, `/webhook/mpesa`, `/reconcile` (as rotas antigas mantêm-se). |
| `tests/competitive.test.mjs` | Testes das regras e do motor. |
| `tests/competitive-sql.test.mjs` + `tests/sql/supabase-stub.sql` | Testes do SQL real em PGlite (Postgres em WASM, local). |

---

## 3. Modelo de dados (resumo)

- `comp_settings` (linha única): interruptores (`monetary_features_enabled`, `betting_enabled`, por omissão **false**), `predictions_enabled`, idade mínima 18, províncias/países permitidos, prazos (cancelamento 2 h, resposta 72 h, resultado 24 h), limites de depósito, versão dos termos.
- `comp_licences`: entidade emissora, nº, válida de/até, âmbito; **imutável** (só se revoga).
- `comp_provider_status`: escrito só pela Edge Function (`/health`) a partir da existência dos segredos.
- `comp_teams`, `comp_team_members` (capitão único por índice parcial; vice com permissão de gerir desafios), `comp_team_invites`.
- `comp_challenges` + `comp_challenge_events` (**imutável**), `comp_result_submissions` (**imutável**, 1 por equipa), `comp_disputes`, `comp_predictions`.
- Carteira: `money_ledger` (+`entry_id`, +`idempotency_key`), `money_withdrawals`, `payments` (`kind = 'carteira'`), `comp_provider_events` (webhooks brutos, `unique(provider, event_id)`, imutável).
- Apostas: `bets`/`bet_legs` existentes + `comp_bet_terms` (instantâneo **imutável** dos termos na confirmação).
- Segurança: `comp_audit` (imutável, com IP e `aal`), `comp_idempotency`, `comp_rate_hits`; alertas em `risk_flags` (novos tipos `aposta`, `desafio`, `deposito`).

Clientes (`anon`/`authenticated`) têm **apenas SELECT** (com RLS) nestas tabelas; `INSERT/UPDATE/DELETE` revogados. Tudo o que escreve passa por funções.

---

## 4. Máquina de estados dos desafios

Estados: `DRAFT, OPEN, PENDING_ACCEPTANCE, ACCEPTED, SCHEDULED, IN_PROGRESS, PENDING_RESULT, UNDER_REVIEW, COMPLETED, CANCELLED, DISPUTED`.

```
Caminho normal:  DRAFT → OPEN | PENDING_ACCEPTANCE → ACCEPTED → SCHEDULED → IN_PROGRESS → PENDING_RESULT → COMPLETED
Resultados ≠:    PENDING_RESULT → DISPUTED → UNDER_REVIEW → COMPLETED | CANCELLED
Prazos falhados: IN_PROGRESS | PENDING_RESULT → UNDER_REVIEW
Cancelar/recusar/expirar: qualquer estado pré-jogo → CANCELLED
```

Transições permitidas (iguais em `comp__can_transition()` e `lib/competitive.ts › TRANSITIONS`; um teste verifica que coincidem):

| De | Para |
|---|---|
| DRAFT | OPEN, PENDING_ACCEPTANCE, CANCELLED |
| OPEN | ACCEPTED, CANCELLED |
| PENDING_ACCEPTANCE | ACCEPTED, CANCELLED |
| ACCEPTED | SCHEDULED, CANCELLED |
| SCHEDULED | IN_PROGRESS, CANCELLED |
| IN_PROGRESS | PENDING_RESULT, UNDER_REVIEW, CANCELLED |
| PENDING_RESULT | COMPLETED, DISPUTED, UNDER_REVIEW |
| UNDER_REVIEW | COMPLETED, DISPUTED, CANCELLED |
| DISPUTED | UNDER_REVIEW, COMPLETED, CANCELLED |
| COMPLETED, CANCELLED | — (terminais) |

Imposição: trigger `comp_challenge_guard` (BEFORE INSERT/UPDATE) recusa qualquer transição fora da tabela — **também para o admin e para funções internas** —, bloqueia mudanças em campos de origem, só deixa gravar o resultado ao concluir e não deixa mexer num desafio terminado (exceto a verificação do resultado). O trigger `comp_challenge_log` grava cada mudança em `comp_challenge_events` (ação, de/para, ator, detalhes).

Regras:
- **Criar:** capitão (ou vice com permissão), equipa ativa com jogadores suficientes, mesmo jogo, sem jogadores partilhados, data entre +30 min e +90 dias, 10/dia, chave de idempotência.
- **Aceitar/recusar:** capitão do adversário (direto) ou de qualquer equipa do mesmo jogo (aberto). Com data → passa logo a `SCHEDULED`.
- **Cancelar:** desafiante até à aceitação; ambos até 2 h antes da hora; depois só o admin.
- **Início:** automático à hora marcada (`comp_sweep`, pg_cron a cada 5 min e ao abrir as páginas) ou manual (15 min antes).
- **Resultados:** cada capitão submete uma vez (com até 5 provas). 1.ª submissão → `PENDING_RESULT`; 2.ª igual → `COMPLETED` (Elo k=32, V/E/D, previsões); 2.ª diferente → `DISPUTED` + disputa automática.
- **Prazos:** sem resultado 24 h após o início, ou sem confirmação do adversário 24 h após a 1.ª submissão → `UNDER_REVIEW`. Pedido sem resposta 72 h → `CANCELLED`.

### Procedimento de disputa
1. Disputa aberta automaticamente (resultados diferentes) ou por um capitão em `PENDING_RESULT`; ambos podem acrescentar provas.
2. Moderador/admin: **Analisar** → `UNDER_REVIEW` (disputa `em_analise`).
3. Admin com **2FA (aal2)**: **Resolver** com resultado e fundamentação (≥ 5 caracteres) → `COMPLETED` (`result_source = 'admin'`, já verificado) ou **Anular** → `CANCELLED` (apostas reembolsadas).
4. Tudo fica no histórico imutável e em `comp_audit`. Equipas com ≥ 3 disputas em 30 dias geram alerta de risco.

---

## 5. Carteira e livro-razão

- **Saldo nunca é escrito pelo cliente.** `money_ledger` é só de acréscimos (trigger bloqueia UPDATE/DELETE), saldo nunca negativo (exceto `correcao` do admin), lançamentos com bloqueio consultivo por utilizador.
- Cada lançamento tem `entry_id` (UUID único) e `idempotency_key` única (`<user>:<reason>:<ref>`). Depósitos têm ainda `ref` único global (`mpesa:<provider_ref>`).
- `comp_wallet_me()` devolve, calculado no servidor: **disponível** (último `balance_after`), **reservado** (levantamentos pendentes + apostas MT abertas) e **total**.
- Levantamento (`comp_wallet_withdraw`): funcionalidades monetárias ligadas + elegibilidade + PIN (uso único, mesmo valor) + idempotência + limites diários; valor reservado até o admin pagar/recusar (fluxo existente `bets_admin_withdrawal`).
- **Reconciliação:** Admin › Competitivo › Reconciliação (`comp_admin_reconcile`) lista pagamentos pagos sem lançamento, lançamentos sem pagamento, pendentes há mais de 30 min e anomalias de webhooks. A Edge Function `/reconcile` consulta o fornecedor para pendentes antigos.

---

## 6. Fluxo de pagamento (depósito)

```
App ──rpc comp_wallet_deposit_intent(valor, método, nº, idem)──► Postgres  (verifica interruptores, fornecedor pronto,
                                                                             elegibilidade, limites, ritmo; cria payments 'pendente')
App ──POST /functions/v1/payments/wallet-deposit {payment_id}──► Edge Function ──► M-Pesa (pedido ao telemóvel)
M-Pesa/agregador ──POST /payments/webhook/mpesa (HMAC, x-timestamp)──► Edge Function
      verifica assinatura (tempo constante) + janela 5 min ──► rpc comp__confirm_deposit (SÓ service_role)
      → regista evento (event_id único) → valida valor e provider_ref → payments 'pago' → money_ledger +valor
```

- **Um depósito só é creditado por `comp__confirm_deposit`**, que só a `service_role` pode executar, depois de a Edge Function verificar a assinatura. Capturas de ecrã ou mensagens do cliente nunca creditam nada.
- Duplicados: o mesmo `event_id` é ignorado; um pagamento já `pago` não volta a creditar; `provider_ref` repetido noutro pagamento → alerta; valor diferente do pedido → não credita + alerta (score 90).
- Falhas/timeouts: o pagamento fica `falhou` e “Nada foi cobrado”.
- Modo demo: existe um botão **“Simular confirmação (demo)”**, só no build demo. Em produção não existe qualquer forma de simular.

---

## 7. Apostas — gating

Uma aposta num desafio só passa se **tudo** isto for verdade (verificado no servidor, em `comp_bet_place` **e** no trigger `comp_leg_guard` de `bet_legs`, que apanha também quem chame `bets_place` diretamente):

1. `monetary_features_enabled` **e** `betting_enabled` ligados **e** licença registada e válida hoje (Maputo);
2. Elegibilidade: 18+, KYC aprovado, província de Moçambique, país `MZ` (cabeçalho `cf-ipcountry` quando existe), sem autoexclusão nem pausa, conta não congelada;
3. Desafio `SCHEDULED`, antes da hora de início (o mercado do motor existente também suspende ao começar);
4. **Membros das duas equipas não podem apostar** no próprio desafio (bloqueado + alerta);
5. Confirmação explícita (`p_confirm = true`), chave de idempotência, ritmo ≤ 30 apostas/hora, alerta de valor anómalo (> 5× a média e ≥ 500);
6. Odds iguais às mostradas (senão `ODDS_CHANGED`); limites pessoais de stake/dia/semana do módulo existente.

Termos: `comp_bet_terms` guarda versão dos termos, stake, odds de cada perna, odd total, retorno potencial e teto. Triggers impedem alterar stake/odds/potencial de uma aposta confirmada. O pagamento usa só as odds das pernas gravadas (`bets__settle_bet`).

Liquidação: só depois de resultado **validado** — por decisão do admin, ou por **“Verificar resultado”** (admin + 2FA) quando houve acordo. Desafio cancelado/anulado → reembolso.

Jogo responsável: limites de depósito diário/semanal/mensal (baixar = imediato, subir = 24 h), pausa 24 h/3 d/7 d/30 d, autoexclusão 7/30/90 dias e limites de aposta (existentes, em Apostas › Jogo responsável).

Nota: as apostas com **TXAP Pontos** (sem valor monetário) nos jogos de liga já existentes continuam a ser controladas pelo interruptor antigo `bet_settings.bets_enabled`. As apostas **em dinheiro (MT)** já existentes passam a exigir também os interruptores deste módulo (`bets__real_active()` foi redefinida).

---

## 8. Segurança

- Autorização só no servidor (funções `SECURITY DEFINER` com `search_path` fixo; RLS em todas as tabelas; clientes sem escrita).
- MFA forte: `comp__strong_auth()` exige `aal2` no JWT para licenças, interruptores, resolver/verificar/anular desafios e abrir mercados.
- Idempotência: `comp_idempotency` (criação de desafios, depósitos, levantamentos, apostas), índices únicos no livro-razão e nos webhooks.
- Limites de pedidos no Postgres (`comp__rate`): equipas 3/dia, convites 30/dia, desafios 10/dia, previsões 60/h, depósitos 5/h, apostas 30/h.
- Registo crítico: `comp_audit` (imutável, IP, aal) + `audit_log`; histórico de desafios imutável; webhooks em `comp_provider_events`.
- Sinais suspeitos → `risk_flags` (Admin › Competitivo › Fraude e Admin › Risco & Fraude).
- Proteção de dados: KYC e transações só visíveis ao próprio e ao admin; provas de resultado guardadas em `media/proofs/<uid>/` (bucket público — usar só capturas do jogo, nunca documentos pessoais); perfil público mostra só nome, @, equipas e histórico.

---

## 9. Instalação e publicação

1. **SQL** (Supabase → SQL Editor), por esta ordem, cada um idempotente:
   1. `supabase/schema.sql`
   2. `supabase/migrations/*` por data (incluindo `2026-10-10-bets.sql` e `2026-10-10-bets-money.sql`, obrigatórios para este módulo)
   3. **`supabase/competitive.sql`**
   4. `supabase/migrations/2026-10-20-moderador-afiliados.sql` (afiliados, ver AFILIADOS.md)
2. **pg_cron** (Database → Extensions) — opcional; sem ele, `comp_sweep()` corre ao abrir as páginas.
3. **Edge Function** `payments`: `supabase functions deploy payments --no-verify-jwt` (inclui `providers.ts`).
4. **Segredos** (Edge Functions → Secrets), só quando houver contrato: `MPESA_API_BASE`, `MPESA_C2B_PATH`, `MPESA_STATUS_PATH`, `MPESA_BEARER_TOKEN`, `MPESA_SERVICE_PROVIDER_CODE`, `MPESA_ORIGIN`, `MPESA_WEBHOOK_SECRET`, `RECONCILE_SECRET`, `PAYMENTS_LIVE=true` (e, só se o contrato o garantir, `MPESA_TRUST_SYNC_RESPONSE=true`).
5. Chamar `GET https://<projeto>.supabase.co/functions/v1/payments/health` (atualiza `comp_provider_status`).
6. Configurar no fornecedor o URL do webhook: `https://<projeto>.supabase.co/functions/v1/payments/webhook/mpesa`, assinatura `x-signature: sha256=HMAC(segredo, "<x-timestamp>.<corpo>")`.
7. Frontend: o build e a publicação continuam iguais (`npm run build`; push para `main` publica no GitHub Pages).

### Procedimento de ativação das funcionalidades monetárias (quando a licença existir)
1. Entrar com **anamaulele4@gmail.com** usando a **app autenticadora (2FA, aal2)** — sem isto o servidor recusa (`MFA_REQUIRED`).
2. Admin › Competitivo › **Licença & funcionalidades** → **Registar licença**: entidade emissora (ex.: Inspecção Geral de Jogos), número, válida desde/até. Fica gravada no servidor, imutável e auditada.
3. Publicar a Edge Function e definir os segredos M-Pesa (passos 3–6). Sem isto o servidor responde `PROVIDER_NOT_CONFIGURED` e **nenhum depósito é aceite**.
4. Escrever **ATIVAR** e carregar **Ligar monetário** (carteira, depósitos, levantamentos) ou **Ligar monetário + apostas**. O servidor verifica admin + aal2 + licença válida hoje; regista `funcionalidades_monetarias` em `comp_audit` e sincroniza a licença em `bet_settings` (dinheiro real nas apostas existentes).
5. Abrir mercados por desafio: Admin › Competitivo › Disputas & resultados › **Abrir mercado de apostas** (desafio agendado).
6. **Desligar** é sempre imediato (admin + aal2). Revogar ou deixar expirar a licença desliga automaticamente todas as operações monetárias (o servidor verifica a validade a cada pedido).

---

## 10. Cópias de segurança e recuperação

- **Supabase**: backups diários automáticos (plano Pro: 7 dias; PITR opcional — recomendado ligar **Point-in-Time Recovery** antes de ativar dinheiro real).
- **Exportação própria** semanal (fora do Supabase): `pg_dump --schema=public --data-only -t money_ledger -t payments -t money_withdrawals -t comp_* -t bets -t bet_legs -t comp_bet_terms "$DATABASE_URL" | gzip > txap-$(date +%F).sql.gz`, guardada cifrada (ex.: `age`/`gpg`) em armazenamento separado, com retenção ≥ 5 anos para registos financeiros.
- **Recuperação**: (1) pôr a app em manutenção (Admin › Definições); (2) desligar o interruptor monetário; (3) restaurar o backup/PITR para um projeto novo e validar com `comp_admin_reconcile()` (totais do livro-razão = soma dos saldos; pagos ↔ lançamentos); (4) comparar com o extrato do fornecedor M-Pesa e corrigir **só com lançamentos `correcao`** (nunca editar linhas); (5) reapontar a app e religar.
- O livro-razão, os webhooks e a auditoria são só de acréscimos: qualquer reconstrução do saldo é reprodutível a partir dos lançamentos.
- Testar a restauração pelo menos uma vez por trimestre.

---

## 11. O que ainda falta (fora do código)

- **Licença** da entidade reguladora de jogos de Moçambique (Inspecção Geral de Jogos, Ministério da Economia e Finanças) para apostas/jogos a dinheiro; confirmar âmbito (online, eSports) e obrigações (relatórios, impostos, retenções sobre ganhos).
- **Contrato com a Vodacom M-Pesa** (ou agregador autorizado) e/ou Movitel e-Mola: credenciais, URLs, formato do webhook/assinatura e regras de reconciliação. O adaptador M-Pesa é um esqueleto: os nomes dos campos têm de ser confirmados com a documentação recebida.
- Regras de **AML/KYC** (verificação documental, listas de sanções), política de privacidade e termos atualizados para dinheiro real; consentimento expresso para apostas.
- Termos e condições das apostas (versão `v1-2026-10-19` em `comp_settings.terms_version`) redigidos por jurista.
- Ligar PITR no Supabase e definir responsáveis pela revisão de disputas e de alertas de fraude.

---

## 12. Testes

`npm test` corre:
- `tests/competitive.test.mjs` — máquina de estados (incluindo comparação com o SQL), cancelamento, reconciliação/disputa, Elo, elegibilidade, gating/ativação, livro-razão e idempotência, termos e pagamento, e fluxos completos no motor em memória.
- `tests/competitive-sql.test.mjs` — carrega `schema.sql` + migrações + `competitive.sql` (duas vezes, para provar idempotência) num Postgres em memória (**PGlite**) e testa RPCs, triggers e RLS: permissões do capitão, escrita direta recusada, transições ilegais recusadas, histórico imutável, disputa resolvida com aal2, ativação com licença, depósito só por webhook verificado sem duplicados, antifraude nas apostas, termos imutáveis e liquidação só após validação. O stub do ambiente Supabase está em `tests/sql/supabase-stub.sql`. A migração `2026-10-09-push.sql` fica de fora (precisa de `pg_net`, que o PGlite não tem). A Edge Function (Deno) não é testada aqui.
