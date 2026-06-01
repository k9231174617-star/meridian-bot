# Deployment Runbook

## Required environment
- `DATABASE_URL`
- `BOT_MODE=live`
- `BOT_PROVIDER=direct`
- `BOT_RPC_URL`
- One of:
  - `BOT_SIGNER_SECRET_KEY`
  - `BOT_SIGNER_SECRET_KEY_FILE`
  - `BOT_SIGNER_SECRET_REMOTE_URL`
- Optional:
  - `BOT_SIGNER_SECRET_REMOTE_TOKEN`
  - `BOT_ALERT_WEBHOOK_URL`
  - `BOT_MAX_POOL_AGE_HOURS`
  - `BOT_REQUIRE_VERIFIED_POOL_METADATA=true`
  - allow/deny list variables

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
- `pnpm bot:backtest`
- `pnpm bot:live` in a tiny-capital pilot only after paper verification
