#!/usr/bin/env bash
# Runs all test scenarios against the deployed API.
# Usage: ./scripts/test-scenarios.sh
#   or:  API_URL=https://xxx.execute-api.region.amazonaws.com/prod/ ./scripts/test-scenarios.sh
set -euo pipefail

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "${API_URL:-}" ]; then
  echo "❌ API_URL not set. Run scripts/setup.sh first or pass API_URL=..."
  exit 1
fi

# Strip trailing slash for consistency
API_URL="${API_URL%/}"

PASS=0
FAIL=0

run_test() {
  local name="$1"
  local method="$2"
  local path="$3"
  local body="${4:-}"
  local expect_status="$5"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🧪 ${name}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local curl_args=(-s -w "\n%{http_code}" -X "$method" "${API_URL}${path}")
  if [ -n "$body" ]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi

  local response
  response=$(curl "${curl_args[@]}")

  local http_code
  http_code=$(echo "$response" | tail -1)
  local response_body
  response_body=$(echo "$response" | sed '$d')

  echo "   Status: ${http_code}"
  echo "   Response: $(echo "$response_body" | jq -r '.' 2>/dev/null || echo "$response_body")"

  if [ "$http_code" = "$expect_status" ]; then
    echo "   ✅ PASS (expected ${expect_status})"
    PASS=$((PASS + 1))
  else
    echo "   ❌ FAIL (expected ${expect_status}, got ${http_code})"
    FAIL=$((FAIL + 1))
  fi
}

echo "🔍 Testing against: ${API_URL}"

# ─── Scenario 1: List products ───
run_test \
  "List products" \
  "GET" "/products" "" "200"

# ─── Scenario 2: Happy path — Stripe ───
run_test \
  "Happy path (Stripe)" \
  "POST" "/orders" \
  '{"customerId":"cust-1","paymentMethod":"stripe","items":[{"productId":"prod-1","quantity":1},{"productId":"prod-5","quantity":2}]}' \
  "200"

# ─── Scenario 3: Happy path — PayPal ───
run_test \
  "Happy path (PayPal)" \
  "POST" "/orders" \
  '{"customerId":"cust-2","paymentMethod":"paypal","items":[{"productId":"prod-3","quantity":1}]}' \
  "200"

# ─── Scenario 4: Happy path — Apple Pay ───
run_test \
  "Happy path (Apple Pay)" \
  "POST" "/orders" \
  '{"customerId":"cust-3","paymentMethod":"applepay","items":[{"productId":"prod-6","quantity":3}]}' \
  "200"

# ─── Scenario 5: Invalid payment method ───
run_test \
  "Invalid payment method" \
  "POST" "/orders" \
  '{"customerId":"cust-4","paymentMethod":"bitcoin","items":[{"productId":"prod-1","quantity":1}]}' \
  "200"

# ─── Scenario 6: Invalid product ID ───
run_test \
  "Validation failure (bad product)" \
  "POST" "/orders" \
  '{"customerId":"cust-5","paymentMethod":"stripe","items":[{"productId":"prod-999","quantity":1}]}' \
  "200"

# ─── Scenario 7: Insufficient inventory ───
run_test \
  "Inventory failure (quantity too high)" \
  "POST" "/orders" \
  '{"customerId":"cust-6","paymentMethod":"stripe","items":[{"productId":"prod-2","quantity":9999}]}' \
  "200"

# ─── Scenario 8: Multiple items, one bad ───
run_test \
  "Partial inventory failure (one item out of stock)" \
  "POST" "/orders" \
  '{"customerId":"cust-7","paymentMethod":"stripe","items":[{"productId":"prod-1","quantity":1},{"productId":"prod-4","quantity":9999}]}' \
  "200"

# ─── Scenario 9: Missing fields ───
run_test \
  "Validation failure (missing fields)" \
  "POST" "/orders" \
  '{"customerId":"cust-8"}' \
  "200"

# ─── Scenario 10: Payment decline (simulateDecline) ───
run_test \
  "Payment decline (simulateDecline)" \
  "POST" "/orders" \
  '{"customerId":"cust-9","paymentMethod":"stripe","items":[{"productId":"prod-8","quantity":1}],"simulateDecline":true}' \
  "200"

# ─── Summary ───
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Results: ${PASS} passed, ${FAIL} failed out of $((PASS + FAIL)) tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
