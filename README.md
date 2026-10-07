# 🎮 GAME HUB

Plataforma moçambicana de gaming: clipes, lives, torneios, ídolos, escola Free Fire, loja, eventos e muito mais.
Esta é a **versão de teste (demo)**: todos os dados ficam guardados no navegador (localStorage), com dados de exemplo, e a conta entra automaticamente como **administradora**. **Nenhum pagamento é cobrado.**

🔗 **Versão de teste:** https://anamaulele4-creator.github.io/game-hub/

---

## ✨ O que já funciona

| Área | Ecrãs |
|---|---|
| Início | Separadores Para ti, Lives, Torneios, Clipes, Seguindo · live em destaque · recomendados · “os teus ídolos” · feed |
| Clipes | Feed vertical (deslizar), reprodução automática, toque duplo = gosto, som on/off, guardar, partilhar, desafiar |
| Social | Gostos, reações rápidas 🔥😂🤯👑💜, comentários com respostas, partilha por link / WhatsApp / Instagram |
| Ídolos | Lista, seguir, notificações de live 🔔, perfil com publicações, clipes, lives, torneios, conquistas e ranking |
| Gamificação | XP, níveis, divisões Bronze → Lenda, sequência diária, 5 missões diárias, 13 conquistas, ranking semanal, desafios entre jogadores |
| Bem-estar | Tempo de ecrã diário/semanal, limite diário opcional, lembretes de pausa, silêncio noturno |
| Torneios | Grátis e pagos, inscrição, cancelamento, regras, chaveamento, distribuição do prémio |
| Lives | Chat ao vivo, presentes com moedas, compra de moedas |
| Outros | Escola Free Fire, Canais, Loja/Marketplace + carrinho, Eventos com bilhetes, Planos (Premium, Criador Pro, Equipas, Verificação, Coach IA), Coach IA, Meus Guardados, Notificações com filtros, Pesquisa, Definições |
| Admin | Receitas por fonte, utilizadores (verificar, dar Premium, banir), conteúdo, torneios, anúncios/patrocínios, planos, loja, comissões, estado dos pagamentos |
| Checkout | Transparente: total final sempre visível, cancelar com um toque, sem custos escondidos (demo) |

### Rotas (28)
`/` · `/clipes` · `/clipe/[id]` · `/lives` · `/lives/[id]` · `/torneios` · `/torneios/[id]` · `/idolos` · `/idolo/[id]` · `/perfil` · `/missoes` · `/conquistas` · `/ranking` · `/desafios` · `/bem-estar` · `/escola` · `/canais` · `/loja` · `/checkout` · `/eventos` · `/planos` · `/coach-ia` · `/guardados` · `/notificacoes` · `/pesquisa` · `/definicoes` · `/mais` · `/admin`

---

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

## 💳 Pagamentos (futuro)

A app mostra o checkout completo mas **não cobra nada**. Para ativar pagamentos reais:
1. Escolher um agregador moçambicano com API para M-Pesa e e-Mola e obter as chaves.
2. Criar o projeto Supabase, aplicar `supabase/schema.sql`.
3. Fazer deploy de `supabase/functions/payments` e definir os segredos (`AGGREGATOR_BASE_URL`, `AGGREGATOR_API_KEY`, `AGGREGATOR_WEBHOOK_SECRET`, `PAYMENTS_LIVE=true`).
4. Ligar o frontend ao Supabase (substituir o `lib/store.tsx` local por chamadas à base de dados).

Nunca coloques chaves privadas no código do frontend nem no repositório.

## 🔁 Repor a demo
Perfil → Definições → **Repor dados de demonstração** (ou limpar os dados do site no navegador).

---
Feito em Moçambique 🇲🇿 · GAME HUB
