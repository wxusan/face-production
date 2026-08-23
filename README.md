# FACE Production Talent Platform

Governed MVP foundation for a FACE Production casting and talent operations platform.

This first build is intentionally product-shaped: it contains an admin console, domain data model, risk controls, candidate moderation states, campaign approval gates, vendor dependency tracking, security governance, maintenance expectations, and migration planning.

## Run Locally

```bash
npm install
npm run dev
```

This starts the complete dashboard at `http://127.0.0.1:8787`. The dashboard UI and API are served together by the Node application; there is no separate frontend development server.

The same server can also be started explicitly:

```bash
npm run server
```

The Telegram bot is webhook-only. For an end-to-end bot test, deploy a staging
service or expose the local server through an authenticated public HTTPS tunnel,
then set Telegram's webhook to that URL. Do not start a local polling process.

Secrets live in `.env.local`, which is ignored by git. Use `.env.example` as the template.

Set a unique local admin dashboard passcode in `.env.local`:

```text
ADMIN_WEB_TOKEN=<generate-a-random-local-value>
```

## Current Product Slice

- Candidate registry with validation, moderation, duplicate, consent, and blacklist signals.
- Campaign governance with targeted campaign mode, response rate, fatigue risk, and human approval state.
- Product analytics overview for growth, conversion, duplicate rate, and admin efficiency.
- Secure backend shell with Telegram provider, admin-only authorization, audit events, and dry-run broadcast checks.
- Real Telegram candidate registrations loaded into the web dashboard.
- Candidate media review for full-body, closer shot, left profile, right profile, portrait photo, and intro video.
- Web approve/reject actions that notify Telegram candidates when a chat is linked.
- Recent audit events visible in the Governance tab.
- Admin panel language: Russian by default, Uzbek optional.
- Telegram bot languages: Russian, Uzbek, English.
- Telegram registration captures name, phone, age, Uzbekistan region, gender, height, weight, talents, languages, appearance/look, five required photos, and intro video.
- Telegram admin approval uses inline approve/reject buttons and writes audit events.
- Candidate CSV export is available from the admin panel.
- Governance queue for controlled feature and operating decisions.
- Security rules for admin access, export permissions, child profile visibility, credential rotation, and incident response.
- Vendor dependency register with required abstraction interfaces.
- Migration path from local JSON/files to Supabase PostgreSQL and Storage, then platform-grade search, AI indexing, analytics, and automation.

## Engineering Direction

The platform must grow behind stable boundaries:

- `CandidateRepository` for candidate records.
- `StorageProvider` for media and backup storage.
- `MessagingProvider` for Telegram and future channels.
- `AiReviewProvider` for future AI suggestions that require human approval. AI is not part of the current MVP.
- `AnalyticsProvider` for product and campaign reporting.
- `AuditLogRepository` for sensitive admin action history.
- `AdminAuthorizationService` for permission checks.

No live architecture feature should be added without product prioritization and governance review.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Governance](./docs/GOVERNANCE.md)
- [Supabase Migration](./docs/SUPABASE_MIGRATION.md)
- [Railway Migration](./docs/RAILWAY_MIGRATION.md)
- [Telegram Integration](./docs/TELEGRAM_INTEGRATION.md)
- [Technical Decisions](./docs/TECHNICAL_DECISIONS.md)
- [Vercel Deployment](./docs/VERCEL_DEPLOYMENT.md)
