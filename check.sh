#!/bin/bash
set -e

echo "=== CLI ==="
(cd cli && pnpm run check && pnpm test)

echo ""
echo "=== Server ==="
(cd server && pnpm run check)

echo ""
echo "=== Web ==="
(cd web && pnpm run check)

echo ""
echo "All checks passed."
