#!/usr/bin/env bash
# Deploys the stack, seeds data, and writes .env with the API URL and table name.
set -euo pipefail

STACK_NAME="OrderProcessorStack"

echo "🚀 Deploying stack..."
npx cdk deploy --require-approval never --outputs-file cdk-outputs.json

API_URL=$(jq -r ".${STACK_NAME}.ApiUrl" cdk-outputs.json)
TABLE_NAME=$(jq -r ".${STACK_NAME}.TableName" cdk-outputs.json)

echo "📦 Seeding data..."
TABLE_NAME="$TABLE_NAME" npx tsx scripts/seed.ts

# Write .env for test scripts
cat > .env <<EOF
API_URL=${API_URL}
TABLE_NAME=${TABLE_NAME}
EOF

echo ""
echo "✅ Ready! API: ${API_URL}"
echo "   Config saved to .env"
