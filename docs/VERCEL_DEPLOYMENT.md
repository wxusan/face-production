# Vercel Deployment

## What Vercel Will Run

Vercel runs the admin portal and backend as serverless functions:

```text
/                  -> admin portal
/api/*             -> backend API
/api/telegram/webhook -> Telegram webhook
```

The bot does not use long polling on Vercel. Telegram sends each update to the webhook endpoint.

## Important Difference From Local

Local:

```bash
npm run server
```

Vercel:

```text
Telegram webhook calls /api/telegram/webhook
Bot sessions are stored in Supabase
```

## Required Vercel Environment Variables

Add these in Vercel Project Settings -> Environment Variables:

```text
ADMIN_WEB_TOKEN=
DATABASE_POOL_MAX=3
DATABASE_SSL=true
DATABASE_URL=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_BUCKET=face-candidate-media
OBJECT_STORAGE_ENDPOINT=https://chyktpjxhpfooekqiqww.storage.supabase.co/storage/v1/s3
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_REGION=ap-southeast-1
OBJECT_STORAGE_SECRET_ACCESS_KEY=
PGSSLMODE=require
TELEGRAM_ADMIN_ID=1753566525,718222668
TELEGRAM_BOT_TOKEN=
TELEGRAM_ENABLE_POLLING=false
TELEGRAM_WEBHOOK_SECRET=
```

Use a random value for `TELEGRAM_WEBHOOK_SECRET`. It must match the value used when setting Telegram webhook.

## Deploy

Before deploy, run:

```bash
npm run check:vercel
npm run check:supabase
```

1. Generate a webhook secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. Push this project to GitHub, including the `dist/` folder.
3. Import the repo into Vercel.
4. Add the environment variables above.
5. Deploy.
6. Open:

```text
https://YOUR_APP.vercel.app/api/health
```

Expected:

```text
databaseProvider: postgres
mediaStorageProvider: object-storage
```

## Set Telegram Webhook

After deployment, from this local project run:

```bash
npm run webhook:set -- https://YOUR_APP.vercel.app
```

This sets Telegram to send messages to:

```text
https://YOUR_APP.vercel.app/api/telegram/webhook
```

## Migration Status

This document is retained only for Vercel rollback reference. The active
deployment target is Railway; follow [Railway Migration](./RAILWAY_MIGRATION.md).
The bot is webhook-only, so do not switch it to local polling.

## Known Vercel Risks

- The current MVP deploys the generated `dist/` admin portal because the local Vite build tool has been unreliable. After frontend source changes, rebuild or refresh `dist/` locally and push it too.
- Serverless cold starts can make some replies slower.
- Large videos may hit function time or response limits.
- Old local media paths will not exist on Vercel. New media uploaded after Supabase Storage setup will work.
- Webhook retries can happen, so future hardening should add update-id deduplication.
