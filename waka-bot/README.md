# 🤖 Waka bot — seu assistente no WhatsApp

Bot para grupos de WhatsApp: boas-vindas, anti-link, anti-spam, avisos (3 = remove), menu de comandos e gestão do grupo.

## Instalar no telemóvel Android (grátis, 24h enquanto o telemóvel estiver ligado)
1. Instala o **Termux** pelo F-Droid: https://f-droid.org/packages/com.termux/
2. Abre o Termux e cola:
```
curl -fsSL https://raw.githubusercontent.com/anamaulele4-creator/game-hub/main/waka-bot/instalar.sh | bash
```
3. Aparece **CÓDIGO DE LIGAÇÃO: XXXX-XXXX**.
4. No telemóvel do número do bot: WhatsApp → ⋮ → **Dispositivos ligados** → **Ligar dispositivo** → **Ligar com número de telefone** → escreve o código.
5. Adiciona o bot ao grupo e torna-o **admin**. Escreve `!menu`.

Para voltar a ligar depois: `cd ~/waka-bot && node index.js`

Outro número: `BOT_NUMBER=2588XXXXXXXX node index.js`

## Comandos
Todos: `!menu` `!regras` `!info` `!admins` `!ping`
Admins: `!todos` `!ban` `!add` `!promover` `!rebaixar` `!aviso` `!limparavisos` `!silenciar` `!dessilenciar` `!fechar` `!abrir` `!apagar` `!setregras` `!setboasvindas` `!setadeus` `!antilink on/off` `!antispam on/off` `!boasvindas on/off` `!config`
