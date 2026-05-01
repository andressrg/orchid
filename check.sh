#!/bin/bash
set -e

echo "=== CLI ==="
(cd cli && pnpm run check && pnpm test)

echo ""
echo "=== Web ==="
(cd web && pnpm run check)

echo ""
echo "All checks passed."
