#!/bin/bash
set -e

KEY="/tmp/orchid-deploy/id_ed25519"
HOST="root@24.144.97.81"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no $HOST"

echo "🌸 Deploying Orchid..."

# Deploy server
echo "→ Deploying server..."
rsync -avz --exclude node_modules --exclude dist \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  server/ $HOST:/opt/orchid-server/ --quiet
$SSH 'cd /opt/orchid-server && npm run build --silent && pm2 restart orchid-server --silent' 2>/dev/null

# Deploy web
echo "→ Deploying web UI..."
rsync -avz --delete --exclude node_modules --exclude .next --exclude dist \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  web/ $HOST:/opt/orchid-web/ --quiet
$SSH 'cd /opt/orchid-web && NEXT_PUBLIC_API_URL=http://24.144.97.81:3000 NEXT_PUBLIC_API_KEY=orchid-poc-api-key-2024 npm run build --silent 2>/dev/null && pm2 restart orchid-web --silent' 2>/dev/null

echo "✅ Deployed to http://24.144.97.81"
