# Deployment Runbook

## Required environment
- `DATABASE_URL`
- `BOT_MODE=live`
- `BOT_PAPER_MAX_CYCLES` for bounded paper sessions
- `BOT_PAPER_DEBUG_FORCE_SIGNAL=true`
- `BOT_PAPER_DEBUG_BYPASS_RISK=true`
- `BOT_PROVIDER=direct`
- `BOT_RPC_URL`
- One of:
  - `BOT_SIGNER_SECRET_KEY`
  - `BOT_SIGNER_SECRET_KEY_FILE`
  - `BOT_SIGNER_SECRET_REMOTE_URL`
- Optional:
  - `BOT_SIGNER_SECRET_REMOTE_TOKEN`
- `BOT_ALERT_WEBHOOK_URL`
- `BOT_STORAGE_DIR`
- `BOT_BACKTEST_SNAPSHOTS_FILE`
- `BOT_USE_JITO=true` for Jito-backed live swaps on mainnet
- `BOT_JITO_BLOCK_ENGINE_URL`
- `BOT_JITO_TIP_LAMPORTS`
- `BOT_ENABLE_HONEYPOT_SIMULATION=true`
- `BOT_ENABLE_ANTI_SCAM=true`
- `BOT_RUGCHECK_API_URL`
- `BOT_RUGCHECK_API_KEY`
- `BOT_ENABLE_RETRY_QUEUE=true`
- `BOT_RETRY_BACKOFF_MS`
- `BOT_ENABLE_WSS_POOL_WATCHER=true`
- `BOT_RPC_WS_URL`
- `BOT_WSS_LOG_KEYWORDS`
- dashboard `Paper Trading` control via `/api/bot/paper-trade`
- `BOT_MAX_POOL_AGE_HOURS`
- `BOT_REQUIRE_VERIFIED_POOL_METADATA=true`
- `BOT_MAX_TOP_TEN_HOLDER_SHARE_PCT`
- allow/deny list variables
- `GET /metrics` for Prometheus-style scraping and uptime checks

## Docker
1. Copy `.env.example` to `.env`.
2. Fill the live-trading variables.
3. Build the image:

```bash
docker compose -f deploy/docker-compose.yml build
```

4. Start the API and bot:

```bash
docker compose -f deploy/docker-compose.yml up -d
```

## systemd
1. Install the repo at `/opt/meridian-bot`.
2. Put the environment into `/opt/meridian-bot/.env`.
3. Copy `deploy/systemd/trading-bot.service` to `/etc/systemd/system/trading-bot.service`.
4. Reload and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now trading-bot
```

## Operational checks
- `pnpm build`
- `pnpm test`
- `pnpm smoke`
- `pnpm bot:backtest` or `pnpm bot:backtest -- --snapshots <file>`
- `pnpm bot:paper:trade -- --cycles 5` before every live change
- keep `BOT_PAPER_DEBUG_FORCE_SIGNAL=true` and `BOT_PAPER_DEBUG_BYPASS_RISK=true` for test-only sessions
- verify Jito / honeypot / anti-scam flags are green before a live pilot
- enable the websocket pool watcher if you want lower-latency new-pool detection than polling
- `pnpm bot:live` only in a tiny-capital pilot after paper verification and manual approval

## Pilot checklist
1. Verify the bot has a funded signer wallet with only the capital required for the pilot.
2. Point `BOT_STORAGE_DIR` at a shared writable directory so the API can expose `/api/bot/status`.
3. Set `BOT_BACKTEST_SNAPSHOTS_FILE` to a replay file and confirm the backtest passes.
4. Run `pnpm bot:paper:trade -- --cycles 5` with the live configuration until the risk gates and signal flow are stable.
5. Enable `BOT_ALERT_WEBHOOK_URL` so circuit-breaker and execution failures are visible outside the host.
6. Verify `/metrics` returns scrapeable text and wire it into your monitoring system.
7. Start `pnpm bot:live` with a tiny capital limit and keep the kill switch available.
