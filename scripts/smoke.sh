#!/usr/bin/env bash
set -euo pipefail

baseUrl="${1:-http://127.0.0.1:8080}"
baseUrl="${baseUrl%/}"

if ! command -v curl > /dev/null || ! command -v jq > /dev/null; then
  echo "FAIL curl and jq are required" >&2
  exit 1
fi

responseFile="$(mktemp)"
trap 'rm -f "$responseFile"' EXIT

statusCode=""

request() {
  statusCode="$(curl -s -m 20 -o "$responseFile" -w '%{http_code}' "$@")"
}

expectStatus() {
  local label="$1" expected="$2"
  if [[ "$statusCode" != "$expected" ]]; then
    echo "FAIL ${label}: expected HTTP ${expected}, got ${statusCode}" >&2
    head -c 500 "$responseFile" >&2
    exit 1
  fi
  echo "ok   ${label} (${statusCode})"
}

request "${baseUrl}/health"
expectStatus "GET /health" 200
[[ "$(jq -r '.status' "$responseFile")" == "ok" ]] || { echo "FAIL health status is not ok" >&2; exit 1; }

request "${baseUrl}/products"
expectStatus "GET /products" 200
productCount="$(jq 'length' "$responseFile")"
(( productCount >= 3 )) || { echo "FAIL /products has ${productCount} rows, expected the seeded products" >&2; exit 1; }
seededSku="$(jq -r '.[0].sku' "$responseFile")"
echo "ok   GET /products lists ${productCount} products (first: ${seededSku})"

smokeSku="smoke-$(date +%s)"
request -X POST -H 'content-type: application/json' \
  -d "$(printf '{"sku":"%s","name":"Smoke Product","priceCents":1999}' "$smokeSku")" "${baseUrl}/products"
expectStatus "POST /products" 201
productId="$(jq -r '.id' "$responseFile")"
[[ "$(jq -r '.priceCents' "$responseFile")" == "1999" ]] || { echo "FAIL create returned another priceCents" >&2; exit 1; }
[[ "$(jq -r '.price' "$responseFile")" == "19.99" ]] || { echo "FAIL create returned another price" >&2; exit 1; }

request -X PUT -H 'content-type: application/json' \
  -d '{"name":"Smoke Product Renamed","priceCents":2500}' "${baseUrl}/products/${productId}"
expectStatus "PUT /products/${productId}" 200
[[ "$(jq -r '.name' "$responseFile")" == "Smoke Product Renamed" ]] || { echo "FAIL update did not rename" >&2; exit 1; }
[[ "$(jq -r '.priceCents' "$responseFile")" == "2500" ]] || { echo "FAIL update did not rewrite priceCents" >&2; exit 1; }

request -X POST -H 'content-type: application/json' \
  -d "$(printf '{"productId":%s,"quantity":2}' "$productId")" "${baseUrl}/orders"
expectStatus "POST /orders" 201
orderId="$(jq -r '.id' "$responseFile")"
[[ "$(jq -r '.totalCents' "$responseFile")" == "5000" ]] || { echo "FAIL order totalCents is not priceCents * quantity" >&2; exit 1; }
[[ "$(jq -r '.status' "$responseFile")" == "pending" ]] || { echo "FAIL order is not pending" >&2; exit 1; }
echo "ok   order ${orderId} queued on the orders queue"

orderStatus=""
for attempt in $(seq 1 30); do
  request "${baseUrl}/orders/${orderId}"
  orderStatus="$(jq -r '.status' "$responseFile")"
  [[ "$orderStatus" == "paid" ]] && break
  sleep 1
done
if [[ "$orderStatus" != "paid" ]]; then
  echo "FAIL worker did not mark order ${orderId} paid within 30s (status: ${orderStatus})" >&2
  exit 1
fi
echo "ok   worker marked order ${orderId} paid"
[[ "$(jq -r '.paidAt' "$responseFile")" != "null" ]] || { echo "FAIL paid order has no paidAt" >&2; exit 1; }
[[ "$(jq -r '.audit | length' "$responseFile")" -ge 1 ]] || { echo "FAIL paid order has no audit row" >&2; exit 1; }
echo "ok   order ${orderId} has an audit row"

request -X DELETE "${baseUrl}/products/${productId}"
expectStatus "DELETE /products/${productId} (after its order exists)" 409

echo "OK products=${productCount} order=${orderId} paid on ${baseUrl}"
