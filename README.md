# 🎮 TXAPILOG

Plataforma moçambicana de gaming: clipes, lives, torneios, ídolos, Escola Free Fire, loja, eventos, anúncios self-serve e painel de administração.

🔗 **App:** https://anamaulele4-creator.github.io/game-hub/

## 🔀 Dois modos
| Modo | Quando | Comportamento |
|---|---|---|
| **Real (produção)** | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` definidos no build (já estão por omissão em `next.config.mjs` — são valores públicos) | Registo/login reais (Supabase Auth), dados nas tabelas com RLS, admin = `profiles.role = 'admin'`, sem dados falsos |
| **Demo** | build com `NEXT_PUBLIC_DEMO=1` (ou sem as variáveis) | localStorage, dados de exemplo, utilizador entra como admin, códigos OTP mostrados no ecrã, nada é cobrado |

### Ativar o modo real (uma vez)
1. Supabase → **SQL Editor** → colar **`supabase/schema.sql`** → Run (script único e idempotente; pode repetir-se).
2. **Authentication → URL Configuration**: Site URL `https://anamaulele4-creator.github.io/game-hub/` e Redirect URLs `https://anamaulele4-creator.github.io/game-hub/**`.
3. **Authentication → Email templates**: incluir `{{ .Token }}` nos modelos *Confirm signup*, *Magic Link* e *Reset password* para a app aceitar o código de 6 dígitos (o link também funciona).
4. **SMTP próprio** (Authentication → SMTP Settings, ex.: Resend/Brevo) — o SMTP incluído do Supabase envia muito poucos emails por hora.
5. **SMS OTP (telemóvel)**: Authentication → Providers → Phone → fornecedor **pago** (Twilio, MessageBird, Vonage, Textlocal). Sem isto, o login por telemóvel mostra "SMS ainda não ativo".
5b. **MFA**: Authentication → Multi-Factor → ativar TOTP. **Modelos de email**: incluir `{{ .Data.anti_phishing }}` para mostrar o código anti-phishing.
6. Registar-se com **anamaulele4@gmail.com** → recebe automaticamente `role = admin`.
7. (Opcional) `supabase functions deploy delete-account` e `payments`; **Coach IA** → ver secção 🤖 abaixo; **pg_cron** em Database → Extensions (contadores e partições).

## ✨ Funcionalidades
| Área | O quê |
|---|---|
| Social | Feed, clipes verticais (vídeo carregado só perto do ecrã), gostos, reações, comentários, partilha, **denunciar e bloquear** (⋯ em clipes, publicações, comentários, perfis) |
| Ídolos, lives, torneios, escola, loja, eventos, planos, missões, conquistas, ranking, bem-estar | como antes |
| **Anúncios** `/anuncios` | Gestor estilo Meta Ads: campanhas → conjuntos → anúncios; objetivos (visualizações, seguidores, cliques, inscrições); criativo imagem/clipe + texto + CTA; público (idade 13+, províncias, jogos, interesses); orçamento diário/total em MZN; calendário; leilão de 2.º preço com pacing; limite de frequência; pausa automática; relatórios com gráficos e CSV; saldo pré-pago via checkout |
| **Admin** `/admin` | Painel com KPIs, utilizadores (funções, verificar, premium, suspender, banir, eliminar), moderação (fila de denúncias com prioridade CSAE, clipes, comentários, lives), torneios, lives, loja e encomendas, eventos, planos e preços, moedas e presentes, levantamentos e comissões, notificações (segmento + agendamento), anúncios (revisão, preços, receita), definições (manutenção, faixa, funcionalidades), editor de políticas, auditoria |
| Notificações | Centro com grupos, silenciar categoria, **Web Push** (service worker) com preferências por categoria; payload em `lib/push.ts` |
| Autenticação | `/registar` (data de nascimento → bloqueio <13, dados, consentimento, código), `/entrar` (email/telemóvel, palavra-passe ou código), `/recuperar` (link ou código por email, código por SMS) |
| Legal (Google Play) | `/privacidade` · `/termos` · `/diretrizes` · `/seguranca-infantil` · `/seguranca-dados` · `/cookies` · `/reembolsos` · `/eliminar-conta` (formulário público) · `/legal`; ecrã de consentimento no 1.º acesso; eliminar conta em Definições |
| Portão de acesso | Sem sessão a app abre em `/bem-vindo` (Criar conta / Iniciar sessão); confirmação obrigatória por link/código (`/confirmar`, com reenvio); públicas só as páginas legais e `/baixar`; sessão guardada |
| Mensagens | `/mensagens` (caixa com não lidas, pedidos de quem não segues) e `/mensagens/chat?c=ID` (texto, emojis, imagens privadas, vistos, "a escrever…" via Realtime, bloquear/denunciar); moderação só de mensagens denunciadas |
| Segurança | `/seguranca`: 2FA (app autenticadora, Supabase MFA) + código por email/SMS, PIN de transação de 6 dígitos (servidor, bcrypt, 5 erros = bloqueio), código anti-phishing, lista branca M-Pesa/e-Mola com bloqueio de 24 h, níveis KYC com limites diários, dispositivos/sessões (sair dos outros), histórico de logins com IP, alertas de dispositivo novo, congelar conta, registo de segurança; Admin › Risco & Fraude e KYC |
| Monetização | `/monetizacao`: programa de criadores (requisitos), painel de ganhos, membros, presentes em lives e clipes, partilha de anúncios, prémios de torneios, levantamentos protegidos; Admin › Monetização (candidaturas e comissões) |
| Baixar | `/baixar` + botão “⬇️ App” no topo: instalar PWA, instruções iPhone, espaço para APK (`NEXT_PUBLIC_APK_URL`) e selo Google Play (`NEXT_PUBLIC_PLAY_URL`) |
| PWA | `manifest.webmanifest`, ícones, service worker (scope `/game-hub/`), offline, botão/banner **Instalar app** + instruções iPhone (`/instalar`); `twa/` para a Play Store |

## 🛠️ Tecnologia

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Exportação estática (`output: 'export'`) → alojamento **grátis** no GitHub Pages
- `supabase/schema.sql` — base de dados futura (tabelas, políticas RLS, triggers de contadores)
- `supabase/functions/payments` — esboço (stub) de Edge Function para M-Pesa / e-Mola via agregador. **Não está ativa.**

## ▶️ Correr no computador

```bash
npm install
npm run dev        # http://localhost:3000/game-hub
npm run build      # gera a pasta ./out (site estático)
```

Para testar sem o `/game-hub` no endereço:

```bash
NEXT_PUBLIC_BASE_PATH="" npm run dev   # http://localhost:3000
```

## 🚀 Publicação automática (custo zero)

Cada alteração enviada para o ramo `main` dispara o workflow `.github/workflows/deploy.yml`, que:
1. instala as dependências e faz `npm run build`;
2. cria `out/.nojekyll` (e `out/CNAME` se tiveres domínio próprio);
3. publica a pasta `./out` no ramo **`gh-pages`**.

**Uma única vez**, confirma em **Settings → Pages** do repositório:
- *Source*: **Deploy from a branch**
- *Branch*: **gh-pages** / pasta **/(root)** → **Save**

O GitHub Pages é grátis para repositórios públicos. Não há custos de alojamento.

---

## 🌐 Usar um domínio próprio (quando o comprares)

Exemplo com `txapilog.co.mz` (troca pelo teu domínio). Podes usar o domínio “raiz” (`txapilog.co.mz`) ou um subdomínio (`www.txapilog.co.mz`).

### Passo 1 — Dizer ao build qual é o domínio
1. No GitHub, abre o repositório → **Settings → Secrets and variables → Actions → separador Variables → New repository variable**.
2. Nome: `CUSTOM_DOMAIN` · Valor: `txapilog.co.mz` (sem `https://`, sem `/` no fim).
3. Com esta variável, o workflow:
   - faz o build com `NEXT_PUBLIC_BASE_PATH=""` (o site passa a viver na raiz: `https://txapilog.co.mz/`);
   - cria automaticamente o ficheiro **`CNAME`** com o teu domínio dentro de `out/`.
4. Vai a **Actions → “Build e publicar no GitHub Pages” → Run workflow** (ou faz qualquer commit).

> O `basePath` é configurável por variável de ambiente (`NEXT_PUBLIC_BASE_PATH`). Sem domínio: `/game-hub`. Com domínio na raiz: vazio.

### Passo 2 — Configurar o DNS (no sítio onde compraste o domínio)

**Domínio raiz (`txapilog.co.mz`)** — cria 4 registos **A**:

| Tipo | Nome / Host | Valor |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

(Opcional, IPv6) registos **AAAA** em `@`: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`

**Subdomínio `www`** — cria 1 registo **CNAME**:

| Tipo | Nome / Host | Valor |
|---|---|---|
| CNAME | `www` | `anamaulele4-creator.github.io` |

> Se usares só `www.txapilog.co.mz` como domínio principal, põe `CUSTOM_DOMAIN=www.txapilog.co.mz` e basta o registo CNAME.

### Passo 3 — Ativar no GitHub
1. **Settings → Pages → Custom domain**: escreve `txapilog.co.mz` → **Save**.
2. Espera a verificação de DNS (de alguns minutos até 24–48 h).
3. Marca **Enforce HTTPS** quando ficar disponível (certificado grátis).

### Recomendado — verificar o domínio na conta
Em **github.com → Settings (da conta) → Pages → Add a domain**, o GitHub dá-te um registo **TXT** para provar que o domínio é teu. Isto impede que outra pessoa o use no GitHub Pages.

### Problemas comuns
- **Página sem estilos / links partidos** → o `CUSTOM_DOMAIN` não estava definido no build (o site ainda usa `/game-hub`). Define a variável e corre o workflow outra vez.
- **“Domain does not resolve”** → o DNS ainda está a propagar; confirma os 4 registos A.
- **Domínio desaparece das definições** → confirma que o ficheiro `CNAME` existe no ramo `gh-pages` (o workflow cria-o).

---

## 🤖 Coach IA (IA real, custo zero)

A página `/coach-ia` é um chat real com IA (Google Gemini) através da Edge Function **`supabase/functions/coach-ai`**.
Se a IA falhar (sem chave, sem rede, limite, erro do Google), a app responde **sempre** com dicas automáticas por regras — nunca fica sem resposta.

| Peça | O quê |
|---|---|
| `supabase/functions/coach-ai/index.ts` | Verifica a sessão (JWT), limites por utilizador, Gemini `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.5-flash-lite` (timeout 15 s, retries com backoff em 429/5xx), Groq opcional, resposta por regras `{fallback:true}` se tudo falhar. CORS para `https://anamaulele4-creator.github.io` |
| `supabase/ai.sql` (também no fim de `schema.sql`) | Tabelas `ai_usage` e `ai_messages` (RLS), função `ai_try_consume` (limite atómico) e `ai_usage_stats` (admin) |
| `lib/coach.ts`, `lib/coachRules.ts` | Cliente com timeout + fallback por regras |
| Admin › 🤖 IA | Ligar/desligar a IA, limites (grátis 5/dia; plano Coach IA 20/h e 100/dia) e estatísticas de utilização |

### Ativar (uma vez)
1. **Chave grátis do Gemini:** entrar em https://aistudio.google.com/apikey com uma conta Google → *Create API key* → copiar. (O nível gratuito chega para começar; não precisa de cartão.)
2. **SQL:** Supabase → SQL Editor → colar `supabase/ai.sql` → Run (idempotente).
3. **Publicar a função** (no computador, com a [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase login
   supabase link --project-ref nmdauzpbwnepmqyafaqs
   supabase secrets set GEMINI_API_KEY=COLE_AQUI_A_CHAVE
   supabase functions deploy coach-ai --no-verify-jwt
   ```
   `--no-verify-jwt` é necessário porque a app usa a chave publicável (`sb_publishable_…`); a função verifica o JWT do utilizador ela própria.
   Sem computador: Supabase → **Edge Functions** → *Deploy a new function* → nome `coach-ai` → colar `index.ts` e `rules.ts`, desligar *Verify JWT*; e **Edge Functions → Secrets** → `GEMINI_API_KEY`.
4. Abrir `/coach-ia`: aparece “🟢 IA ligada” quando a função responde.

Opcional: `supabase secrets set GROQ_API_KEY=...` (grátis em https://console.groq.com/keys) — usado se não houver chave Gemini ou se o Gemini falhar. `ALLOWED_ORIGINS=https://...,https://...` para um domínio próprio.
**Nunca** coloque chaves de IA no código ou no repositório — só em *secrets* do Supabase.

## 💳 Pagamentos

No modo real o checkout chama a Edge Function `payments`; **enquanto não estiver ativa, nada é cobrado nem concedido** e a app diz que os pagamentos estão a ser ativados. Para ativar:
1. Escolher um agregador moçambicano com API para M-Pesa e e-Mola (precisa de NUIT/conta empresarial).
2. `supabase functions deploy payments` e definir os segredos (`AGGREGATOR_BASE_URL`, `AGGREGATOR_API_KEY`, `AGGREGATOR_WEBHOOK_SECRET`, `PAYMENTS_LIVE=true`).
3. O webhook confirma e cria `payments` (com `provider_ref` único → idempotente), `subscriptions`, `tickets`, entradas pagas e saldo de anúncios.

Nunca coloques chaves privadas no código do frontend nem no repositório.

## 📈 Escala
Ver **SCALING.md**.

## ⚡ Desempenho
Secções do Admin, Gestor de Anúncios, checkout, overlays e cliente Supabase são carregados à parte (imports dinâmicos); vídeos só carregam perto do ecrã; service worker com cache *cache-first* para `/_next/static`.

---
Feito em Moçambique 🇲🇿 · TXAPILOG
