# Workers Static Assets migration

Pages rejects rate-limit bindings (both `unsafe.bindings` and the newer top-level
`ratelimits`). To restore first-class rate-limit support in production we are
migrating from Cloudflare Pages to Workers with Static Assets.

Current state: `wrangler.jsonc` (Pages) runs production; `wrangler.worker.jsonc`
(Workers) is ready but not wired into CI.

## Manual cutover steps

All steps are driven by the user — CI is untouched until the Worker is verified.

### 1. First deploy (creates the Worker)

Pages env vars do not carry over. The Worker must exist before
`wrangler secret put` has a target to write to, so deploy first —
runtime will 500 until secrets land, which is expected.

```sh
npm run build
npm run deploy:worker
```

This creates the Worker `chatgb-worker` (name is `chatgb-worker`, not
`chatgb`, to avoid a name conflict with the existing Pages project)
and makes it reachable at
`chatgb-worker.<account-subdomain>.workers.dev`.

### 2. Provision secrets on the Worker

`wrangler secret put KEY` is interactive — it prompts for the value
and writes it to the Worker named in the target config. Run:

```sh
for KEY in \
  SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY OPENROUTER_API_KEY \
  MCP_SERVER_URL MCP_TOKEN_ISSUE_URL MCP_TOKEN_ISSUE_SECRET MCP_TOKEN_ENCRYPTION_KEY \
  ADMIN_EMAIL APP_URL INVITE_APP_URL ALLOWED_EMAIL_DOMAINS \
  RESEND_API_KEY RESEND_WEBHOOK_SECRET RESEND_FROM_EMAIL \
  CRON_SECRET DATA_RETENTION_DAYS SOFT_DELETE_GRACE_DAYS AUDIT_LOG_RETENTION_DAYS \
  COUNCIL_NATIONAL_SOURCE_PREFERENCE \
  COUNCIL_NATIONAL_WHATGOV_MPS_TABLE COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE \
  ADMIN_API_URL; do
  wrangler secret put "$KEY" --config=wrangler.worker.jsonc
done
```

(Skip keys that are truly optional in your setup.) Or pipe a value:

```sh
wrangler secret put KEY --config=wrangler.worker.jsonc <<< "value"
```

### 3. Redeploy so the running Worker picks up the secrets

```sh
npm run deploy:worker
```

Then smoke-test the app at
`https://chatgb-worker.<account-subdomain>.workers.dev` end-to-end —
login, chat request with tool calls, rate-limit behaviour.

### 4. Flip custom domains

A custom domain can only attach to one resource at a time, and the
domains are currently on the Pages project. Two ways to switch:

**Dashboard flow (simpler, more clicks):**

1. Workers & Pages → chatgb (Pages) → Custom domains — remove
   `chatgb.co.uk` and `www.chatgb.co.uk`.
2. Workers & Pages → chatgb-worker → Settings → Domains & Routes —
   add both domains as Custom Domains.

**Wrangler-assisted flow (one extra commit, fewer clicks):**

1. Add this block to `wrangler.worker.jsonc` (top level):

   ```jsonc
   "routes": [
     { "pattern": "chatgb.co.uk", "custom_domain": true },
     { "pattern": "www.chatgb.co.uk", "custom_domain": true }
   ],
   ```

2. Workers & Pages → chatgb (Pages) → Custom domains — remove both
   domains.
3. `npm run deploy:worker` — wrangler attaches both domains on
   deploy.

   If this step errors with "custom hostname already in use", the
   Pages removal hasn't propagated; wait ~30s and retry.

Either way there's a short gap (seconds to a minute) during which
the domains 404. Do this when you can absorb it. DNS records are
managed automatically by the Custom Domain flow.

### 5. Schedule handler

`api/worker.ts` exports a `scheduled` handler for data retention. Pages does
not invoke it; it relies on external HTTP hits to `/api/cron`. Once on
Workers, you can either:

- Keep the existing HTTP cron pattern (no config change needed), or
- Add a Workers cron trigger by appending to `wrangler.worker.jsonc`:

  ```jsonc
  "triggers": { "crons": ["0 3 * * *"] }
  ```

  Pick a schedule that matches what the external cron currently uses.

### 6. Update CI

Once domains are flipped and production traffic is on the Worker, replace the
Pages deploy step in `.github/workflows/ci.yml` with a Worker deploy:

```yaml
- name: Deploy Worker
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: deploy --config=wrangler.worker.jsonc
```

Also remove the `Strip unsafe bindings` step — the Worker config is valid as-is.

### 7. Retire Pages

When the Worker has served traffic cleanly for a week:

- Delete `functions/` directory.
- Delete `wrangler.jsonc` (keep `wrangler.worker.jsonc` as the sole config, or
  rename it back to `wrangler.jsonc`).
- Remove `dev:api` from `package.json`; make `dev:worker` the default.
- Delete the Pages project in the dashboard.

## Local dev

Two paths available during the transition:

- `npm run dev` — runs Vite + `wrangler pages dev` (legacy).
- `npm run dev:worker` (separately, or pair with `npm run dev:web`) — runs the
  new Worker locally with rate-limit bindings active.
