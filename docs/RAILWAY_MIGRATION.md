# Railway Deployment and Vercel Cutover

## Target Architecture

```text
Telegram webhook
  -> Railway Node.js service (one replica)
  -> Supabase PostgreSQL (candidate, session, audit, and update data)
  -> Supabase private Storage bucket (photos and videos)
```

Railway runs the Node.js backend and admin portal only. Keep the database and
private candidate media in Supabase. Do **not** create Railway PostgreSQL, a
Railway volume, a polling worker, or a second service for this migration.

The bot is webhook-only. Running more than one bot worker would risk processing
the same Telegram update more than once.

## What Is in the Repository

- `railway.json` configures `npm start`, `/api/health`, restart behavior, and a
  30-second shutdown drain.
- `npm start` runs the Node.js HTTP server.
- The server listens on Railway's injected `PORT` and `0.0.0.0`.
- Hosted deployments fail at startup when a critical Telegram, Supabase, media,
  or admin credential is missing. `/api/health` exposes `ready: true` only when
  this configuration is complete.
- Railway uses Node.js `>=20.19.0 <23` and Railpack automatically runs the
  package build script.

## Credentials and Values to Collect

Create or retrieve these values before configuring Railway. Never put them in
the Git repository or in client-side code.

| Variable | Source |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token for the production bot |
| `TELEGRAM_WEBHOOK_SECRET` | New random 32-byte secret; used both by Railway and Telegram's webhook |
| `TELEGRAM_DISABLED` | Optional staging-only switch. Set to `true` to run the portal before a separate staging bot is connected |
| `TELEGRAM_ADMIN_ID` | Comma-separated numeric Telegram IDs for administrators |
| `ADMIN_WEB_TOKEN` | New random 32-byte admin portal secret |
| `DATABASE_URL` | Supabase PostgreSQL Session Pooler connection string |
| `OBJECT_STORAGE_BUCKET` | Private Supabase bucket, normally `face-candidate-media` |
| `OBJECT_STORAGE_ENDPOINT` | Supabase Storage S3 endpoint |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | Supabase Storage S3 access key |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | Matching Supabase Storage S3 secret key |
| `OBJECT_STORAGE_REGION` | Region shown in Supabase Storage S3 settings |

Generate each new secret locally, for example:

```bash
openssl rand -hex 32
```

## Configure Railway

1. Push this repository to GitHub and create one Railway service from the
   repository. Let Railway use the root directory and `railway.json`.
2. In **Settings → Networking**, generate a Railway domain. Do this before
   setting the Telegram webhook.
3. Add the following service variables in **Variables**. Mark secrets as sealed
   where Railway offers that option.

```text
NODE_ENV=production
ADMIN_WEB_TOKEN=<new random secret>
TELEGRAM_ADMIN_ID=<numeric Telegram ID or comma-separated IDs>
TELEGRAM_BOT_TOKEN=<BotFather token>
TELEGRAM_WEBHOOK_SECRET=<new random secret>
TELEGRAM_DISABLED=false
TELEGRAM_ENABLE_POLLING=false
DATABASE_URL=<Supabase Session Pooler URL>
PGSSLMODE=require
DATABASE_SSL=true
DATABASE_POOL_MAX=3
OBJECT_STORAGE_BUCKET=face-candidate-media
OBJECT_STORAGE_ENDPOINT=https://<SUPABASE_PROJECT_REF>.supabase.co/storage/v1/s3
OBJECT_STORAGE_ACCESS_KEY_ID=<Supabase S3 access key>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<Supabase S3 secret key>
OBJECT_STORAGE_REGION=<Supabase S3 region>
OBJECT_STORAGE_FORCE_PATH_STYLE=true
PUBLIC_APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

Do not set `PORT`: Railway supplies it. Do not use `SERVER_PORT` in Railway.
Do not set `TELEGRAM_ENABLE_POLLING=true`; polling is not supported.

For an isolated staging portal, omit `TELEGRAM_BOT_TOKEN` and set
`TELEGRAM_DISABLED=true`. Change it to `false` only after adding the staging bot
token and before registering that bot's webhook.

## Deploy and Verify Before Cutover

1. Deploy the service. Railway's configured health check is `/api/health`.
2. Open `https://<RAILWAY_DOMAIN>/api/health`. It must return HTTP 200 with:

```json
{
  "ready": true,
  "databaseProvider": "postgres",
  "mediaStorageProvider": "object-storage"
}
```

3. From a local checkout configured with the same Supabase values, run:

```bash
npm run check:supabase
```

4. If production data is still only in a local `var/` directory, back it up,
   then run `npm run migrate:postgres` locally once. Verify its result before
   continuing. Do not run this import automatically during a Railway deploy.
5. Confirm the private Supabase bucket contains the expected candidate media and
   the admin portal can read an authorized candidate profile.

## Set the Telegram Webhook

After Railway is healthy, point Telegram at the Railway domain from a local
checkout that has the production bot token and webhook secret:

```bash
npm run webhook:set -- https://<RAILWAY_DOMAIN>
```

This uses `https://<RAILWAY_DOMAIN>/api/telegram/webhook` and provides the
configured secret token. Send `/start` from a non-admin Telegram account and
complete an admin approval/rejection flow. Check Railway logs for errors.

Only after that test passes should the old Vercel deployment be treated as
inactive. Remove its Telegram webhook configuration and secrets after an agreed
observation period; leave the Vercel project untouched until rollback is no
longer needed.

## Rollback

If Railway fails during cutover, set the Telegram webhook back to the last known
working Vercel deployment with the matching Vercel webhook secret. Do not enable
polling as a fallback. Record the failure, investigate Railway logs and Supabase
connectivity, correct the fault, and repeat the Railway verification steps.

## Operating Rules

- Keep exactly one Railway replica until update idempotency and all background
  work have been load-tested at multiple replicas.
- Keep Supabase PostgreSQL and Storage private; the backend serves authorized
  media rather than exposing the bucket.
- Configure external uptime monitoring separately. Railway health checks gate
  deployments but are not continuous monitoring.
- Use staged Railway variable changes and redeploy deliberately; a missing
  required value causes startup to fail by design.

## Sources

- [Railway health checks](https://docs.railway.com/deployments/healthchecks)
- [Railway public networking and `PORT`](https://docs.railway.com/public-networking)
- [Railway variables](https://docs.railway.com/variables)
- [Railway config as code](https://docs.railway.com/config-as-code)
