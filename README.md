# 🎮 GAME HUB

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
6. Registar-se com **anamaulele4@gmail.com** → recebe automaticamente `role = admin`.
7. (Opcional) `supabase functions deploy delete-account` e `payments`; **pg_cron** em Database → Extensions (contadores e partições).

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

Exemplo com `gamehub.co.mz` (troca pelo teu domínio). Podes usar o domínio “raiz” (`gamehub.co.mz`) ou um subdomínio (`www.gamehub.co.mz`).

### Passo 1 — Dizer ao build qual é o domínio
1. No GitHub, abre o repositório → **Settings → Secrets and variables → Actions → separador Variables → New repository variable**.
2. Nome: `CUSTOM_DOMAIN` · Valor: `gamehub.co.mz` (sem `https://`, sem `/` no fim).
3. Com esta variável, o workflow:
   - faz o build com `NEXT_PUBLIC_BASE_PATH=""` (o site passa a viver na raiz: `https://gamehub.co.mz/`);
   - cria automaticamente o ficheiro **`CNAME`** com o teu domínio dentro de `out/`.
4. Vai a **Actions → “Build e publicar no GitHub Pages” → Run workflow** (ou faz qualquer commit).

> O `basePath` é configurável por variável de ambiente (`NEXT_PUBLIC_BASE_PATH`). Sem domínio: `/game-hub`. Com domínio na raiz: vazio.

### Passo 2 — Configurar o DNS (no sítio onde compraste o domínio)

**Domínio raiz (`gamehub.co.mz`)** — cria 4 registos **A**:

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

> Se usares só `www.gamehub.co.mz` como domínio principal, põe `CUSTOM_DOMAIN=www.gamehub.co.mz` e basta o registo CNAME.

### Passo 3 — Ativar no GitHub
1. **Settings → Pages → Custom domain**: escreve `gamehub.co.mz` → **Save**.
2. Espera a verificação de DNS (de alguns minutos até 24–48 h).
3. Marca **Enforce HTTPS** quando ficar disponível (certificado grátis).

### Recomendado — verificar o domínio na conta
Em **github.com → Settings (da conta) → Pages → Add a domain**, o GitHub dá-te um registo **TXT** para provar que o domínio é teu. Isto impede que outra pessoa o use no GitHub Pages.

### Problemas comuns
- **Página sem estilos / links partidos** → o `CUSTOM_DOMAIN` não estava definido no build (o site ainda usa `/game-hub`). Define a variável e corre o workflow outra vez.
- **“Domain does not resolve”** → o DNS ainda está a propagar; confirma os 4 registos A.
- **Domínio desaparece das definições** → confirma que o ficheiro `CNAME` existe no ramo `gh-pages` (o workflow cria-o).

---

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
Feito em Moçambique 🇲🇿 · GAME HUB
