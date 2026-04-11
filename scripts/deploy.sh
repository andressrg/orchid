#!/bin/bash
set -e

KEY="/tmp/orchid-deploy/id_ed25519"
HOST="root@24.144.97.81"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no $HOST"

echo "Deploying Orchid server..."

rsync -avz --exclude node_modules --exclude dist \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  server/ $HOST:/opt/orchid-server/ --quiet
$SSH 'cd /opt/orchid-server && pnpm install --frozen-lockfile && pnpm run build --silent && pm2 restart orchid-server --silent' 2>/dev/null

echo "Deployed server to $HOST"
