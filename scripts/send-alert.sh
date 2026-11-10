#!/usr/bin/env bash
# Send an Alertmanager-style payload to the copilot.
# Usage: ./send-alert.sh <base-url> <payload.json>
#   e.g. ./send-alert.sh http://localhost:8787 sample-alerts/checkout-down.json
# Set WEBHOOK_TOKEN in the environment if the Worker has one configured.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <base-url> <payload.json>" >&2
  exit 1
fi

url="${1%/}/webhook/alertmanager"
file="$2"
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }

auth=()
if [ -n "${WEBHOOK_TOKEN:-}" ]; then
  auth=(-H "Authorization: Bearer ${WEBHOOK_TOKEN}")
fi

curl -sS -X POST "$url" \
  -H "Content-Type: application/json" \
  ${auth[@]+"${auth[@]}"} \
  --data-binary "@${file}" \
  -w '\nHTTP %{http_code}\n'
