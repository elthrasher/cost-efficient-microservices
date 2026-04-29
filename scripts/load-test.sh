#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "${API_URL:-}" ]; then
  echo "❌ API_URL not set. Run scripts/setup.sh first or pass API_URL=..."
  exit 1
fi

echo "🚀 Running load test against: ${API_URL}"
k6 run -e API_URL="${API_URL}" scripts/load-test.js
