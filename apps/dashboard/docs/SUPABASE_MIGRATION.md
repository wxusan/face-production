# Supabase Migration Plan

## Target MVP Architecture

```text
Telegram Bot
  -> Node backend
  -> Supabase PostgreSQL for candidate and audit data
  -> Supabase Storage for photos and videos
  -> Admin portal
  -> Optional Google Sheets mirror after approval
```

Google Sheets is not the primary database. It should only mirror approved candidates after admin approval.

## What Is Ready In Code

- Candidate records switch automatically:
  - local JSON when `DATABASE_URL` is empty
  - Supabase PostgreSQL when `DATABASE_URL` is set
- Audit events switch automatically:
  - local `var/audit-log.jsonl`
  - Supabase PostgreSQL table `audit_events`
- Media switches automatically:
  - local `var/candidate-media`
  - Supabase Storage through the S3-compatible API
- `/api/health` reports:
  - `databaseProvider`
  - `mediaStorageProvider`
- `npm run check:supabase` verifies database and storage before migration.
- `npm run migrate:postgres` moves local JSON candidates into Supabase PostgreSQL.

## Supabase Setup

1. Create a Supabase project.
2. Open `Storage`.
3. Create a private bucket:

```text
face-candidate-media
```

4. Open `Project Settings -> Database -> Connect`.
5. Copy the Session Pooler connection string, or Direct connection if your network supports it.
6. Open `Project Settings -> Storage -> S3 Access Keys`.
7. Create S3 access keys and copy:
   - endpoint
   - region
   - access key ID
   - secret access key

Supabase docs say S3 access keys are server-side credentials and should be kept secure. Do not expose them in frontend code.

## Local `.env.local`

```text
DATABASE_URL=postgres://...
PGSSLMODE=require
DATABASE_SSL=true
DATABASE_POOL_MAX=3

OBJECT_STORAGE_BUCKET=face-candidate-media
OBJECT_STORAGE_ENDPOINT=https://YOUR_PROJECT_REF.supabase.co/storage/v1/s3
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_REGION=...
OBJECT_STORAGE_FORCE_PATH_STYLE=true
```

Keep your existing Telegram/admin variables:

```text
ADMIN_WEB_TOKEN=face-admin-local
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_ID=1753566525,718222668
TELEGRAM_ENABLE_POLLING=true
SERVER_PORT=8787
```

## Verify

After `.env.local` is updated:

```bash
npm run check:supabase
```

Expected result:

```json
{
  "checks": [
    {
      "name": "Supabase Postgres",
      "ok": true
    },
    {
      "name": "Supabase Storage S3",
      "ok": true
    }
  ]
}
```

## Migrate Existing Candidates

When checks pass:

```bash
npm run migrate:postgres
```

Then restart the app:

```bash
npm run server
npm run bot
```

`/api/health` should show:

```text
databaseProvider: postgres
mediaStorageProvider: object-storage
```

## Important Rules

- Photos and videos are not stored inside PostgreSQL.
- PostgreSQL stores only candidate data and media references.
- Supabase Storage bucket should stay private.
- The backend serves media to the admin portal through protected endpoints.
- Run only one active Telegram polling process at a time.

## Sources

- Supabase database connection strings: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase S3 authentication: https://supabase.com/docs/guides/storage/s3/authentication
- Supabase S3 compatibility: https://supabase.com/docs/guides/storage/s3/compatibility
