# TXAPILOG AI CORE

Painel de inteligência para jogadores de **Free Fire**: pesquisa por ID, estatísticas, equipas (duos/squads), torneios, rankings, deteção de inconsistências e relatórios com IA.

- **Rota:** `/core` (ex.: https://anamaulele4-creator.github.io/game-hub/core/)
- **Acesso:** admin, moderador, organizador. Jogadores não entram no painel.
- **Ligações:** Explorar → cartão “TXAPILOG AI CORE” (só admins), Mais → “AI CORE”, Painel Admin → “Abrir TXAPILOG AI CORE”.

## Princípios (não negociáveis)

1. **Só dados autorizados.** A única fonte ativa é *Torneios registados na TXAPILOG* (tabelas `core_*`). A Garena **não tem API pública oficial** de estatísticas: o adapter oficial está desativado com o estado “Não configurado — sem fonte autorizada”. Não há ligação simulada.
2. **Nada inventado.** Sem linhas → `null` → a interface mostra **“indisponível”**. Rankings excluem jogadores abaixo da amostra mínima.
3. **Origem + confiança** em cada análise (fonte de cada linha, % verificada, tamanho da amostra).
4. **Submissões de jogadores** ficam sempre **“Submetido · não verificado”** até um moderador (ou o organizador do torneio) as verificar ou rejeitar (com motivo). O servidor força isto por trigger.
5. **Sinais para revisão humana**, nunca punição automática.
6. **Modo demo** (`NEXT_PUBLIC_DEMO=1`): usa um conjunto “**Dados de exemplo**” identificado em todos os ecrãs. Nunca é incluído em produção (`lib/core/demoData.ts` só é importado quando `IS_DEMO`).

## 1. Instalar a base de dados (uma vez)

Pré-requisito: `supabase/schema.sql` já corrido (usa `profiles`, `is_active_user()`, `_policy()`, `tournaments`).

Supabase → **SQL Editor** → colar e correr:

```
supabase/migrations/2026-10-09-ai-core.sql
```

É idempotente (pode repetir-se). Também está no fim do ficheiro combinado `poipak-atualizacao-2026-10-08.sql`.

Cria:

| Tabela / objeto | Para quê |
|---|---|
| `core_user_roles` + `core_role()`, `core_has_role()`, `core_is_staff()`, `core_my_role()` | Papéis admin / moderador / organizador / jogador (profiles.role = admin → admin automático) |
| `core_players`, `core_external_ids`, `core_player_verifications` | Jogadores, IDs Free Fire (`^[0-9]{6,13}$`, região), perfis verificados. Um ID só pode estar *verificado* num jogador; reivindicações repetidas ficam pendentes e são sinalizadas |
| `core_teams`, `core_team_members` | Duos (máx. 2+1) e squads (máx. 4+2) |
| `core_tournaments`, `core_tournament_teams` | Torneios (ligação opcional a `tournaments` da app) |
| `core_matches`, `core_match_participants`, `core_results` | Partidas, linhas por jogador e resultados por equipa, com `source` e `validation_status` (`submetido` → `verificado`/`rejeitado`) |
| `core_player_stats` (vista, `security_invoker`) | Estatísticas calculadas, respeitando o RLS de quem consulta |
| `core_alerts`, `core_ai_reports` | Alertas para revisão (1 aberto por tipo+entidade) e relatórios gerados (com `sources` e `confidence`) |
| `core_integrations` | Estado das fontes (TXAPILOG ativo; Garena e fornecedor externo desativados) |
| `core_audit_logs` + trigger `core_tg_audit` | Auditoria de todas as escritas nas tabelas core (quem, papel, ação, diferenças) |
| `core_rate_limits` + `core_rate_limit()` | Limitador na BD: jogadores 20 submissões/h e 5 IDs/dia; IA 20/h por utilizador e 300/dia no total |
| `core_set_validation()`, `core_set_role()` | RPCs do painel (validar/rejeitar; atribuir papel por @username) |

RLS ativo em **todas** as tabelas; `anon` não tem acesso. A migração foi testada localmente (PGlite) com cenários de cada papel; **ainda não foi corrida no projeto Supabase** `nmdauzpbwnepmqyafaqs`.

## 2. Papéis

| Papel | Pode |
|---|---|
| **admin** | Tudo, incluindo papéis, auditoria e integrações |
| **moderador** | Validar/rejeitar resultados e IDs, rever alertas, ver papéis |
| **organizador** | Criar torneios/equipas, registar jogadores, validar resultados **dos seus** torneios |
| **jogador** | Sem painel. Submete os próprios resultados (sempre “Submetido · não verificado”) |

Atribuir: AI CORE → *Utilizadores e permissões* → @username + papel (ou `select core_set_role('@user','moderador');` como admin).

## 3. Edge Function `core-ai` (resumos com IA)

```
supabase functions deploy core-ai --no-verify-jwt
supabase secrets set GEMINI_API_KEY=...   # (ou GROQ_API_KEY) — os mesmos do coach-ai
```

Fluxo: verifica JWT e papel → limite na BD → lê as linhas **no servidor** (o cliente só envia o id) → calcula os factos com `supabase/functions/_shared/core-stats.ts` (cópia exata de `lib/core/stats.ts`) → o LLM só pode reformular os factos e tem de citar `[F1]…` → `_shared/core-summary-guard.ts` rejeita respostas com citações inválidas, frases sem citação ou **números que não estão nos factos** → nesse caso devolve o relatório determinístico. Grava em `core_ai_reports` com as linhas citadas e o nível de confiança.

Sem a função publicada, o Centro de IA continua a funcionar com o relatório determinístico e mostra “Função core-ai ainda não publicada”.

Depois de alterar `lib/core/stats.ts`: `npm run sync:core` (o teste falha se as cópias divergirem).

## 4. Ligar um fornecedor autorizado (futuro)

Só com contrato/licença do titular dos dados (ou API oficial, se a Garena a disponibilizar).

1. Guardar a chave **como segredo** da Edge Function (`supabase secrets set PROVIDER_API_KEY=...`) — nunca no cliente.
2. Criar uma Edge Function de sincronização que chama o fornecedor e grava em `core_matches` / `core_match_participants` com `source = 'provedor_autorizado'` (service role).
3. Em `lib/core/providers.ts`, substituir o `disabledProvider('fornecedor_autorizado', …)` por um adapter que lê essas linhas (mesma interface `FreeFireProvider.lookupByExternalId`).
4. `update core_integrations set enabled = true, status = 'Ativo', last_sync_at = now() where id = 'fornecedor_autorizado';`

## 5. Código

| Ficheiro | Conteúdo |
|---|---|
| `app/core/page.tsx` | Rota `/core` (carregamento sob pedido) |
| `components/core/CoreApp.tsx` | Estrutura: barra lateral (desktop), barra inferior + gaveta (telemóvel), controlo de acesso |
| `components/core/kit.tsx` | Cartões, tabela pesquisável/ordenável, estados vazio/erro/carregamento, “Atualizado há X”, selos de validação/origem/confiança |
| `components/core/{Overview,Players,Matches,Teams,AiCenter,Admin}.tsx` | Secções |
| `lib/core/stats.ts` | Cálculos determinísticos, validação de entradas, deteção de anomalias, relatório |
| `lib/core/providers.ts` | Camada de integração Free Fire (adapters) |
| `lib/core/repo.ts` | Leitura Supabase (RLS) e ações |
| `lib/core/demoData.ts` | Dados de exemplo (só demo) |
| `supabase/functions/core-ai/` | Edge Function de resumos |
| `tests/core-stats.test.mjs` | Testes (`npm test`) |

## 6. Testes

```
npm test     # node --test (Node 22, --experimental-strip-types)
```

Cobrem: estatísticas e “indisponível”, K/D, confiança, tendência, comparação, ranking, estatísticas de equipa, cada tipo de anomalia, dados limpos sem falsos positivos, validação de IDs/entradas, origem, séries, relatório, fornecedores desativados sem dados, guarda do resumo IA, sincronização dos cálculos com a Edge Function e exclusão dos dados de exemplo em produção.
