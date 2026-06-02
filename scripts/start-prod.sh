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

if [[ -n "${BOT_SIGNER_SECRET_KEY:-}" || -n "${BOT_SIGNER_SECRET_KEY_FILE:-}" ]]; then
  bot_command=(pnpm --filter @workspace/trading-bot run live)
  bot_mode="live"
else
  bot_command=(pnpm --filter @workspace/trading-bot run paper)
  bot_mode="paper"
fi

echo "[start-prod] launching api-server + trading-bot (${bot_mode})"

export BOT_STORAGE_DIR="${BOT_STORAGE_DIR:-/app/.bot-data/trading-bot}"
mkdir -p "${BOT_STORAGE_DIR}"

pnpm --filter @workspace/api-server run start &
api_pid="$!"

"${bot_command[@]}" &
bot_pid="$!"

wait -n "${api_pid}" "${bot_pid}"
status=$?
cleanup
wait "${api_pid}" 2>/dev/null || true
wait "${bot_pid}" 2>/dev/null || true
exit "${status}"
