#!/usr/bin/env bash
set -euo pipefail

api_pid=""
bot_pid=""

cleanup() {
  if [[ -n "${api_pid}" ]] && kill -0 "${api_pid}" 2>/dev/null; then
    kill "${api_pid}" 2>/dev/null || true
  fi
  if [[ -n "${bot_pid}" ]] && kill -0 "${bot_pid}" 2>/dev/null; then
    kill "${bot_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

pnpm --filter @workspace/api-server run start &
api_pid="$!"

pnpm --filter @workspace/trading-bot run live &
bot_pid="$!"

wait -n "${api_pid}" "${bot_pid}"
status=$?
cleanup
wait "${api_pid}" 2>/dev/null || true
wait "${bot_pid}" 2>/dev/null || true
exit "${status}"
