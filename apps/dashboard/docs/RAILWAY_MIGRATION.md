# Railway Migration Plan

Status: superseded for the current MVP migration. Use [Supabase Migration](./SUPABASE_MIGRATION.md) as the active plan because Railway free trial ended and Supabase gives the MVP both PostgreSQL and Storage on a free plan.

## Target MVP Architecture

```text
Telegram Bot
  -> Railway Node backend
  -> Railway PostgreSQL for candidate and audit data
  -> Railway/S3-compatible object storage for photos and videos
  -> Google Sheets mirror after admin approval
```

Google Sheets is not the primary database. It is only an approved-candidate mirror for operations.

## What Is Ready In Code

- `CandidateRepository` now supports two modes:
  - local JSON when `DATABASE_URL` is empty
  - PostgreSQL when `DATABASE_URL` is set
- Audit events support two modes:
  - local `var/audit-log.jsonl`
  - PostgreSQL `audit_events`
- Media supports two modes:
  - local files when object storage variables are empty
  - S3-compatible storage when object storage variables are set
- `/api/health` reports:
  - `databaseProvider`
  - `mediaStorageProvider`

## Railway Services To Create

1. Node backend service.
2. PostgreSQL database.
3. Object storage bucket, or another S3-compatible bucket if Railway object storage is unavailable.

## Required Railway Variables

```text
ADMIN_WEB_TOKEN=change-this-to-a-private-pass
SERVER_PORT=8787
TELEGRAM_ADMIN_ID=1753566525,718222668
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_ENABLE_POLLING=true
DATABASE_URL=railway-postgres-url
```

For object storage:

```text
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_FORCE_PATH_STYLE=true
```

## Migration Command

After `DATABASE_URL` is set locally or in Railway:

```bash
npm run migrate:postgres
```

This reads `var/candidate-intakes.json` and upserts the candidates into PostgreSQL.

## Deployment Notes

- Railway should run the backend with `npm run server`.
- Run only one Telegram polling process at a time. If Railway polling is enabled, stop the local bot/server polling.
- Keep `TELEGRAM_BOT_TOKEN` private and rotate it after testing.
- Photos and videos should never be stored as binary blobs in PostgreSQL. The database stores file references only.

## Next Feature After Railway

Google Sheets sync should trigger only after status changes to `approved`.
