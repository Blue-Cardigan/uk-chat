# Workers Static Assets migration (completed)

The app runs on a Cloudflare Worker (`chatgb-worker`) with Static Assets.
The previous Pages project (`chatgb`) has been retired.

## Current layout

- `wrangler.jsonc` — Worker config: `main` → `api/worker.ts`, assets
  served from `dist/`, `routes` attach `chatgb.co.uk` and
  `www.chatgb.co.uk`, top-level `ratelimits` bind `CHAT_LIMITER`,
  `AUTH_LIMITER`, `SHARE_LIMITER`.
- `scripts/deploy-worker.sh` — reads `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` from `.env`, builds, runs `wrangler deploy`.
- `scripts/sync-worker-secrets.sh` — pipes a known list of app env
  keys from `.env` into `wrangler secret put`, never echoing values.
- `.github/workflows/ci.yml` — on push to `main`, runs typecheck +
  tests + build then `wrangler deploy`.

## Common tasks

**Local dev** — `npm run dev` (runs Vite + `wrangler dev` on port
3000).

**Manual deploy** — `npm run deploy:worker` (uses `.env` creds).

**Rotate a secret** — `wrangler secret put KEY` (interactive), or
edit `.env` and re-run `scripts/sync-worker-secrets.sh`.

**Add a custom domain** — add an entry to `routes` in
`wrangler.jsonc` and deploy.

**Add a cron trigger** — append to `wrangler.jsonc`:

```jsonc
"triggers": { "crons": ["0 3 * * *"] }
```

The existing `scheduled` export in `api/worker.ts` will fire on the
chosen schedule.

## Why not Pages

Pages' config validator rejects both `unsafe.bindings` and the
current top-level `ratelimits`:

```
✘ ERROR Running configuration file validation for Pages:
    - Configuration file for Pages projects does not support "ratelimits"
```

Rate-limit bindings are a first-class Workers feature only.
