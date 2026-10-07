# 📱 GAME HUB na Google Play (Trusted Web Activity)

A app Android é um "invólucro" (TWA) da PWA publicada — não há código Android para manter. Ferramenta: **Bubblewrap** (Google).

## Pré-requisitos
- Conta **Google Play Console** (taxa única de **25 USD**), verificação de identidade.
- Node 18+, JDK 17 e Android SDK (o Bubblewrap instala-os na primeira execução).
- ⚠️ **Domínio**: o ficheiro `/.well-known/assetlinks.json` tem de estar na **raiz do domínio**. Em `anamaulele4-creator.github.io/game-hub` a raiz pertence ao repositório `anamaulele4-creator.github.io`. Opções:
  1. **Recomendado**: domínio próprio (ex.: `gamehub.co.mz`) apontado ao GitHub Pages → o ficheiro `public/.well-known/assetlinks.json` deste projeto fica logo na raiz. Atualiza `host`, `startUrl`, `iconUrl`, `webManifestUrl` e `fullScopeUrl` em `twa-manifest.json`.
  2. Criar o repositório `anamaulele4-creator.github.io` só com `.well-known/assetlinks.json` (+ `.nojekyll`).

## Passos
```bash
npm i -g @bubblewrap/cli
cd twa
bubblewrap init --manifest https://anamaulele4-creator.github.io/game-hub/manifest.webmanifest   # ou usa o twa-manifest.json já preenchido
bubblewrap build          # gera app-release-signed.apk e app-release-bundle.aab (cria android.keystore — GUARDA-O BEM, com a palavra-passe)
bubblewrap fingerprint list   # mostra a impressão digital SHA-256
```
1. Copia a impressão digital SHA-256 para `public/.well-known/assetlinks.json` (campo `sha256_cert_fingerprints`). Se usares **Play App Signing** (por omissão), junta também a impressão digital indicada em Play Console → Configuração → Integridade da app.
2. Publica o site (o ficheiro tem de abrir em `https://<domínio>/.well-known/assetlinks.json`).
3. Play Console → Criar app → carrega o `.aab` em Teste interno → depois Produção.

## O que a Play Console vai pedir (já existe no site)
| Campo | URL |
|---|---|
| Política de privacidade | `/privacidade/` |
| Eliminação de conta (URL web) | `/eliminar-conta/` |
| Normas de segurança infantil (CSAE) + contacto | `/seguranca-infantil/` |
| Termos | `/termos/` |
| Segurança dos dados (resumo para o formulário) | `/seguranca-dados/` |

Também: classificação de conteúdo (questionário IARC — app social com UGC e compras), público-alvo **13+** (não "para crianças"), declaração de anúncios (**Sim, contém anúncios** — próprios), acesso para revisão (cria uma conta de teste e indica as credenciais na secção "Acesso à app").

## Pagamentos dentro da app Android
Bens digitais (moedas, Premium) vendidos dentro de uma app da Play Store devem, em regra, usar o **Google Play Billing** (ou um programa de faturação alternativa aprovado). M-Pesa/e-Mola via agregador é adequado para bens físicos, bilhetes de eventos presenciais e serviços. Confirma as regras atuais antes de lançar compras digitais na versão Android.
