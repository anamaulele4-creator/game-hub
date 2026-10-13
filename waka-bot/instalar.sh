#!/data/data/com.termux/files/usr/bin/bash
# Instalador do Waka bot para Termux (Android)
set -e
pkg update -y && pkg install -y nodejs-lts git
git config --global url."https://github.com/".insteadOf ssh://git@github.com/
RAW=https://raw.githubusercontent.com/anamaulele4-creator/game-hub/main/waka-bot
mkdir -p ~/waka-bot && cd ~/waka-bot
curl -fsSL $RAW/index.js -o index.js
curl -fsSL $RAW/package.json -o package.json
npm install --no-audit --no-fund
echo ""
echo "✅ Instalado. A iniciar o Waka bot..."
termux-wake-lock 2>/dev/null || true
node index.js
