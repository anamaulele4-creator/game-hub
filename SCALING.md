# 📈 TXAPILOG · Plano de escala

Como o TXAPILOG cresce de algumas centenas para milhões de utilizadores sem cair — e o que custa.

## Hoje (custo zero)
- **Frontend**: site estático (Next.js export) no **GitHub Pages** + CDN do GitHub. Escala bem para leitura; não tem servidor nosso.
- **Backend**: **Supabase Free** (Frankfurt): Postgres + Auth + Storage + Realtime. Limites do plano grátis: 500 MB de base de dados, 1 GB de ficheiros, ~50 000 utilizadores ativos/mês no Auth, projeto pausa após 1 semana sem uso, e **envio de emails de autenticação muito limitado** (configurar SMTP próprio).
- **SMS OTP**: exige fornecedor pago (Twilio, MessageBird, Vonage…). Sem isso, usa-se login por email.

## O que já está preparado no código e na base de dados
- **Índices** em todas as chaves estrangeiras e colunas de pesquisa (feed por data, notificações por utilizador, denúncias por estado…).
- **Particionamento mensal** das tabelas de alto volume: `notifications`, `live_messages`, `channel_messages`, `analytics_events`, `ad_events` (+ partição *default*; `pg_cron` cria os meses seguintes). Apagar meses antigos = `drop table` instantâneo.
- **Contadores agregados**: gostos/comentários/guardados/seguidores escrevem em `counter_deltas` (append-only) e um job `rollup_counters()` soma em lote a cada minuto → sem "hot rows" num clipe viral. Anúncios usam `ad_stats_daily` (uma linha por anúncio/dia).
- **Registo idempotente e fiável**: unicidade de handle (minúsculas), email e telemóvel; trigger cria o perfil uma só vez (`on conflict do nothing`); idade mínima validada também no servidor.
- **Cliente resiliente** (`lib/auth.ts`): repetição com backoff exponencial em falhas de rede/5xx/429, mensagens de erro claras, limitação de pedidos (OTP 1/60 s e 5/h por destino; registo 3/h; login 10/15 min). O Supabase aplica ainda os seus limites no servidor (Auth → Rate Limits).
- **RLS em todas as tabelas**: a segurança não depende do cliente.
- **PWA + service worker**: ficheiros estáticos em cache → menos pedidos e arranque rápido mesmo com rede fraca.

## Caminho de crescimento
| Fase | Utilizadores ativos/mês | O que fazer | Custo aproximado* |
|---|---|---|---|
| 1 | até ~10 mil | Supabase Free + SMTP próprio (Resend/Brevo grátis até X emails) | 0 USD |
| 2 | 10 mil – 100 mil | **Supabase Pro** (sem pausa, backups diários, 8 GB BD, mais conexões), **Supavisor** (pooler de conexões em modo *transaction*, já incluído), domínio próprio, SMS pago | ~25 USD/mês + SMS |
| 3 | 100 mil – 1 milhão | Compute maior (Small/Medium), **read replicas** para feed/pesquisa, **CDN** para vídeos (Cloudflare R2/Stream ou Bunny), cache de feed (Edge Functions + Redis/Upstash), filas para notificações push e emails (pgmq / Supabase Queues) | ~100–600 USD/mês |
| 4 | milhões | Vários réplicas, particionamento + arquivo de dados frios, transcodificação de vídeo dedicada, serviço de lives (Mux, Cloudflare Stream, LiveKit), observabilidade (Sentry/Logflare), equipa de moderação | milhares USD/mês |

\*Valores indicativos; confirmar nos preços atuais de cada fornecedor.

## Boas práticas a seguir
1. **Ligações**: a app usa a API REST/Realtime do Supabase (sem conexões diretas ao Postgres). Funções de servidor devem usar o **pooler Supavisor** (porta 6543, modo transaction).
2. **Leituras pesadas** (feed, ranking, pesquisa) → réplicas de leitura e vistas materializadas atualizadas por `pg_cron`.
3. **Vídeo** nunca na base de dados: Storage/CDN com cache longa; gerar miniaturas e versões de baixa resolução para dados móveis.
4. **Escritas em rajada** (impressões, visualizações, chat) → tabelas particionadas append-only + agregação em lote; nunca `update` do mesmo contador por evento.
5. **Filas** para tudo o que pode esperar: push, emails, relatórios, pagamentos (webhooks com `provider_ref` único = idempotentes).
6. **Limites e proteção**: rate limits do Auth, CAPTCHA (hCaptcha/Turnstile) no registo quando houver abuso, políticas RLS revistas a cada nova tabela.
7. **Backups e recuperação**: Pro inclui backups diários; PITR (recuperação a um ponto no tempo) é um extra pago.

> **Resumo honesto:** o desenho está pronto para crescer, mas **escala muito grande exige infraestrutura paga** (Supabase Pro ou superior, CDN de vídeo, SMS, serviço de lives). O plano grátis serve para lançar e validar.
