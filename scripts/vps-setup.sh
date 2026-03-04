#!/bin/bash
set -e

# ============================================
# note-com-mcp VPS セットアップスクリプト
# ConoHa VPS (Ubuntu 22.04/24.04) 用
# ============================================

echo "=========================================="
echo " note-com-mcp VPS セットアップ"
echo "=========================================="

# --- 1. システム更新 ---
echo "[1/8] システム更新..."
apt update && apt upgrade -y

# --- 2. Node.js 22 インストール ---
echo "[2/8] Node.js 22 インストール..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"

# --- 3. pm2 インストール ---
echo "[3/8] pm2 インストール..."
npm install -g pm2

# --- 4. Playwright 依存パッケージ ---
echo "[4/8] Playwright ブラウザ依存パッケージ..."
npx playwright install-deps chromium || true

# --- 5. Git & プロジェクトクローン ---
echo "[5/8] プロジェクトクローン..."
apt install -y git
if [ ! -d /opt/note-com-mcp ]; then
  git clone https://github.com/yu010101/note-com-mcp.git /opt/note-com-mcp
else
  cd /opt/note-com-mcp && git pull
fi
cd /opt/note-com-mcp

# --- 6. 依存インストール & ビルド ---
echo "[6/8] npm install & build..."
npm install
npx playwright install chromium
npm run build

# --- 7. .env 設定確認 ---
echo "[7/8] .env 確認..."
if [ ! -f .env ]; then
  echo "⚠️  .env ファイルが見つかりません。"
  echo "    ローカルの .env をコピーしてください:"
  echo "    scp .env root@<VPS_IP>:/opt/note-com-mcp/.env"
  echo ""
  echo "    必要な環境変数:"
  echo "    - NOTE_EMAIL / NOTE_PASSWORD (または NOTE_SESSION_V5)"
  echo "    - TWITTER_API_KEY / TWITTER_API_SECRET / TWITTER_ACCESS_TOKEN / TWITTER_ACCESS_SECRET"
  echo "    - TWITTER_BEARER_TOKEN"
  echo "    - AGENT_POST_MODE=full-auto"
  echo "    - MCP_HTTP_PORT=3002 は start-http.sh で設定済み"
fi

# --- 8. pm2 で起動 & 自動起動設定 ---
echo "[8/8] pm2 起動..."
chmod +x scripts/start-http.sh

# start-http.sh のパスを VPS 用に更新
cat > scripts/start-http-vps.sh << 'SCRIPT'
#!/bin/bash
export MCP_HTTP_PORT=3002
cd /opt/note-com-mcp
exec node build/note-mcp-server.js
SCRIPT
chmod +x scripts/start-http-vps.sh

pm2 start scripts/start-http-vps.sh --name note-com-mcp --interpreter bash
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "=========================================="
echo " セットアップ完了!"
echo "=========================================="
echo ""
echo " サーバー: http://127.0.0.1:3002/mcp"
echo " ヘルスチェック: curl http://localhost:3002/health"
echo ""
echo " 次のステップ:"
echo "  1. .env をコピー (まだの場合)"
echo "  2. pm2 restart note-com-mcp"
echo "  3. OpenClaw のインストール (別途)"
echo ""
