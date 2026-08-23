# Telegram Integration

## Current State

The token is loaded from `.env.local`, never from React frontend code.

The standalone bot runner is now the Telegram polling owner:

```bash
npm run bot
```

The web API should run with Telegram polling disabled:

```bash
TELEGRAM_ENABLE_POLLING=false npm run server
```

Do not run API polling and the standalone bot at the same time. Telegram updates should be consumed by one poller only.

Configured admin:

- Telegram user ID: `1753566525`

## Languages

Admin panel:

- Russian default
- Uzbek optional
- No English admin UI labels

Telegram bot:

- Russian
- Uzbek
- English

Bot language selection is inline. `/start` shows one welcome message in Russian, Uzbek, and English, then the user chooses the interface language with inline buttons.

## Local Development

Start the API:

```bash
npm run server
```

Start the standalone Telegram bot:

```bash
npm run bot
```

Open the admin UI:

```text
http://127.0.0.1:8787/
```

Development admin passcode:

```text
face-admin-local
```

Candidate commands:

- `/start`
- `/help`
- `/cancel`

The candidate registration flow collects:

- full name
- phone number through Telegram contact request
- age
- Uzbekistan region/city
- gender
- height
- weight
- performance talents
- sports talents
- physical skills
- languages
- ethnicity/look
- full-body photo
- closer shot photo
- left profile side photo
- right profile side photo
- portrait photo
- intro video up to 90 seconds (1:30)

The bot sends local example photos from `~/Downloads` before each required photo prompt. It deletes completed prompt/answer messages where Telegram allows it, shows an emoji progress bar, then sends the user a profile review album with photos, video, and profile information. The user can approve the card or choose a section to edit.

Available admin bot commands:

- `/help`
- `/status`

Admins also receive candidate review albums with inline `Approve` / `Reject` buttons. Approval and rejection update the same candidate database used by the web dashboard.

Non-admin Telegram users can register candidate profiles. They cannot run admin commands.

## API Endpoints

- `GET /api/health`
- `GET /api/candidates`
- `GET /api/candidates/export.csv`
- `GET /api/candidates/:id/photo`
- `GET /api/candidates/:id/media/:kind`
- `GET /api/telegram/me`
- `POST /api/telegram/webhook`
- `POST /api/admin/notify`
- `POST /api/admin/broadcast-dry-run`
- `POST /api/candidates/:id/approve`
- `POST /api/candidates/:id/reject`
- `POST /api/candidates/:id/message`
- `GET /api/audit`

Admin web endpoints require the `x-admin-token` header.

## Governance Rules

- Broadcasts remain dry-run only in this version.
- Admin authorization checks use the configured Telegram admin ID.
- Audit events are written locally to `var/audit-log.jsonl`.
- Candidate registration through Telegram is open and requires admin approval before active use.
- Web admin actions require the local admin passcode.
- AI matching, AI tagging, and AI moderation are excluded from the current MVP.
- The bot token must be rotated before real production use because it has been shared during setup.
- A new clean bot should be created in BotFather, then its token should replace `TELEGRAM_BOT_TOKEN` in `.env.local`.
