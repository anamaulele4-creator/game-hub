# 🎮 TXAPZONE · by TXAPILOG

Plataforma moçambicana de **jogos e torneios**: torneios (grátis e pagos), recargas de diamantes/gemas/coins, marketplace por jogo e loja, carteira/checkout M-Pesa e e-Mola (em breve), Coach IA, Escola Free Fire e painel de administração. Visual em toda a app com a **paleta oficial Txapilog** (modo escuro): fundo `#0E0F13`, superfícies `#16181F`/`#1D1F28`, amarelo `#FFC107` nos botões principais e estado ativo, azul `#072E7B`/`#0048FD` para a marca e ligações; fonte **Lexend** (OFL) alojada localmente; ícones SVG de linha desenhados à mão (`components/icons.tsx`) — **sem emojis** na interface (há um teste que falha se aparecer algum em `app/` ou `components/`). Capas reais dos jogos em `public/img/games/`.

> **v11 (out. 2026):** a antiga rede social (feed, clipes, publicar, câmara, explorar, ídolos, seguir, mensagens/chamadas/grupos, canais, guardados, desafios, lives, histórias, TXAPILOG IA/POIPAK social) foi **removida da app**. O código continua no histórico git; as tabelas e o SQL do Supabase **não** foram apagados. Links antigos dessas secções mostram "Esta secção já não existe" e voltam ao Início. **Apostas continuam desativadas.**

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
| **Início** `/` (= `/jogos`) | Carrossel com 4 flyers (próximo torneio aberto de cada jogo principal, ou flyer de exemplo marcado) + "Categorias populares" com capas reais: Free Fire, Clash Royale, eFootball, Dream League Soccer e Outros |
| **Página do jogo** `/jogos/[ff\|cr\|ef\|dls\|outros]` | Separadores Início, Torneios, Histórico, Recargas, Apostas (desativadas, só leitura) e Marketplace; link direto por `#hash` (ex.: `/jogos/ff/#recargas`); grupo do WhatsApp por jogo (definido no Admin) |
| **Torneios** `/torneios` | Todos os torneios com filtros por estado (abertos, a decorrer, terminados, inscrito) e por jogo; detalhe `/torneios/[id]` com inscrição, taxa e prémio sempre visíveis |
| **Recargas** `/recargas` | Escolher o jogo → separador Recargas (ID de jogador validado, pacotes, número M-Pesa/e-Mola 84–87). Pagamentos ainda não ativos: nada é cobrado |
| **Marketplace** `/marketplace` | Marketplace por jogo (guias, coaching, packs para lives, design) + Loja `/loja` e Carrinho `/checkout` |
| **Perfil** `/perfil` | Conta, carteira (0 MT até haver pagamentos), torneios inscritos, compras e recargas, atalhos (notificações, definições, segurança, Coach IA, Escola), mudar de conta / sair; `/perfil/editar` |
| Definições `/definicoes` | Conta, foto/emoji, notificações por categoria (torneios, compras e recargas, sistema), **qualidade de imagem e vídeo adaptativa**, privacidade, instalar, eliminar conta |
| Notificações `/notificacoes` | Só torneios, compras/recargas e conta; Web Push (service worker) com preferências por categoria |
| Extras | Coach IA `/coach-ia`, Escola Free Fire `/escola`, Planos `/planos` (Premium, Equipas, Coach IA), Segurança `/seguranca` (2FA, PIN de transação, anti-phishing, dispositivos), AI CORE `/core` (estatísticas de torneios, admin) |
| **Admin** `/admin` | Painel com KPIs, utilizadores, torneios, loja e encomendas, planos e preços, pagamentos e comissões, risco & fraude, KYC, notificações, anúncios, Coach IA, IA do sistema, definições (manutenção, faixa, funcionalidades, links WhatsApp por jogo), políticas e auditoria. Separadores de moderação social removidos |
| Autenticação | `/bem-vindo`, `/registar` (data de nascimento → bloqueio <13, consentimento, código), `/entrar`, `/confirmar`, `/recuperar`; portão: sem sessão a app abre em `/bem-vindo` |
| Legal (Google Play) | `/privacidade` · `/termos` · `/diretrizes` · `/seguranca-infantil` · `/seguranca-dados` · `/cookies` · `/reembolsos` · `/eliminar-conta` · `/legal` |
| Baixar / PWA | `/baixar`, `/instalar`, `manifest.webmanifest` (nome TXAPZONE), service worker `gh-v11` (scope `/game-hub/`), offline, `twa/` para a Play Store |

## 🎨 Design system e ecrãs adaptativos
- **Tokens** (cores, raios, sombras, larguras da moldura) em variáveis CSS no topo de `app/globals.css`; o `tailwind.config.ts` lê-as (`bg-panel`, `rounded-card`, `shadow-e2`, `max-w-col`…). Mudar a marca = mudar `:root`.
- **Componentes base** em `components/ui.tsx`: `Button`, `Card`, `Chip`, `Badge`, `Tabs`, `Sheet`, `Skeleton`/`SkeletonList`, `EmptyState`, `Avatar`, `Page`, `Section`. Ícones de linha em `components/icons.tsx` (sem emojis na navegação).
- **Moldura** (`components/Shell.tsx`): telemóvel = barra inferior com **Início, Torneios, Recargas, Marketplace, Perfil**; tablet (≥768 px) = trilho de ícones; desktop (≥1024 px) = menu lateral com nomes (+ Notificações, Mais, Definições). Ecrãs TXAPZONE (`TzShell` em `components/jogos/Kit.tsx`) ocupam a largura toda (conteúdo até 1120 px); as restantes páginas usam `Page` numa coluna central.
- **Capas reais dos jogos** em `public/img/games/` (WebP 640/1280 + ícones; origem em `SOURCES.md`), via `components/GameArt.tsx` (`GameCover`, `GameIconImg`, `GamesBanner`, `GameTiles`).
- **Qualidade adaptativa** (`lib/quality.ts` + regras puras em `lib/qualityCore.ts`): lê rede (`navigator.connection`), memória, núcleos, DPR e "reduzir movimento" e escolhe **Alta / Equilibrada / Poupança** → `<html data-quality data-motion>`. Em Poupança: capas de 640 px, menos animação e sem desfoques. O utilizador pode fixar o nível em **Definições › Qualidade de imagem e vídeo** (guardado em `localStorage`).
- **Paleta Txapilog em toda a app**: tokens em `:root` (`--c-bg`, `--c-panel`, `--c-accent` amarelo, `--c-brand` azul, `--glow`…); as classes `.tz-*` (cartões, pílulas, botões) servem os ecrãs principais. Fonte Lexend em `app/fonts/` (400/500/600/700, licença `OFL.txt`) via `next/font/local`.
- **Sem emojis**: ícones só de `components/icons.tsx`; avatares sem foto mostram as iniciais; `tests/sem-emojis.test.mjs` guarda a regra.

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

## 🚀 Publicação (custo zero)

O GitHub Pages deste repositório publica a pasta **`docs/` do ramo `main`** (Settings → Pages → *Deploy from a branch* → `main` / `/docs`). Para publicar uma versão nova:

```bash
NEXT_PUBLIC_BASE_PATH=/game-hub npm run build   # gera ./out
rm -rf docs && cp -r out docs && touch docs/.nojekyll
git add -A && git commit -m "…" && git push origin HEAD:main
```

Depois de cada alteração visível, incrementar `VERSION` em `public/sw.js` para os telemóveis receberem a versão nova. O GitHub Pages é grátis para repositórios públicos.

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
Secções do Admin, checkout, overlays e cliente Supabase são carregados à parte (imports dinâmicos); capas WebP 640/1280 conforme o ecrã; service worker com cache *cache-first* para `/_next/static`.

---
Feito em Moçambique 🇲🇿 · TXAPZONE by TXAPILOG
