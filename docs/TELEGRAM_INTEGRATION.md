# Telegram Integration

## Current State

The token is loaded from `.env.local`, never from React frontend code.

The bot is webhook-only. Telegram sends updates to
`POST /api/telegram/webhook`; there is no local polling runner.

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

For an end-to-end Telegram test, give that API a secure public HTTPS URL and
set the webhook with `npm run webhook:set -- https://<PUBLIC_DOMAIN>`.

Open the admin UI:

```text
http://127.0.0.1:8787/
```

Development admin passcode (set a unique value in `.env.local`):

```text
ADMIN_WEB_TOKEN=<generate-a-random-local-value>
```

Candidate commands:

- `/start`
- `/help`
- `/cancel`

Casting channel buttons use `/start cast_<public-token>`. The token is compact,
contains no candidate information, and restores the intended casting after a
new user completes registration.

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

The bot sends the gender-matched example from private object storage before each required photo and intro-video prompt. It keeps the user's answers and the bot's written questions, removes completed inline buttons, and annotates the selected answer on the original question. Only temporary example media is deleted after the matching candidate upload, `/cancel`, or a replacement `/start`.

The final review keeps the complete profile card and candidate media visible. Telegram `file_id` values for example media are stored in Postgres and reused after restarts. Railway's pre-deploy step uploads the ten optimized example photographs and validates all ten photos plus both intro videos, so missing required media fails deployment instead of being silently skipped.

Available admin bot commands:

- `/help`
- `/status`

Admins also receive candidate review albums with inline `Approve` / `Reject` buttons. Approval and rejection update the same candidate database used by the web dashboard.

Non-admin Telegram users can register candidate profiles. They cannot run admin commands.

## API Endpoints

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/candidates`
- `GET /api/candidates/export.csv`
- `GET /api/candidates/:id/photo`
- `GET /api/candidates/:id/media/:kind`
- `GET /api/telegram/me`
- `POST /api/telegram/webhook`
- `GET /api/castings`
- `POST /api/castings`
- `GET /api/castings/:id/workspace`
- `POST /api/castings/:id/manage`
- `POST /api/castings/:id/invitations`
- `POST /api/castings/:id/decisions`
- `POST /api/castings/:id/messages`
- `GET /api/castings/channel/health`
- `POST /api/admin/notify`
- `POST /api/admin/broadcast-dry-run`
- `POST /api/candidates/:id/approve`
- `POST /api/candidates/:id/reject`
- `POST /api/candidates/:id/consent`
- `POST /api/candidates/:id/message`
- `GET /api/audit`

Admin web endpoints require the signed, HttpOnly session cookie created by
`POST /api/auth/login`. The admin secret is never stored in browser storage,
placed in a URL, or sent on every API request.

## Governance Rules

- Broadcasts remain dry-run only in this version.
- Admin authorization checks use the configured Telegram admin ID.
- Audit events are written locally to `var/audit-log.jsonl`.
- Candidate registration through Telegram is open and requires admin approval before active use.
- A complete pending profile may apply to a casting while its general FACE
  Production approval remains pending.
- Casting delivery is queued durably, retried with backoff, and protected from
  duplicate resend when Telegram delivery becomes uncertain.
- Web admin actions require the local admin passcode.
- AI matching, AI tagging, and AI moderation are excluded from the current MVP.
- The bot token must be rotated before real production use because it has been shared during setup.
- A new clean bot should be created in BotFather, then its token should replace `TELEGRAM_BOT_TOKEN` in `.env.local`.
