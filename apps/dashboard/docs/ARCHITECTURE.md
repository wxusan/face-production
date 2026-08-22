# Architecture

## Product Shape

FACE Production Talent Platform is a governed operations system for talent intake, candidate records, campaign outreach, moderation, analytics, and future commercialization paths.

The MVP can use Google Drive, Google Sheets, Telegram, and manual operations, but those choices must be implementation details behind interfaces.

## Core Domains

- Candidate intake and profile management.
- Data validation and moderation.
- Admin authorization and auditability.
- Campaign targeting and notification controls.
- Vendor abstraction and migration readiness.
- Analytics and operational reporting.

## Required Boundaries

```text
Admin Console
  -> Application Services
    -> Domain Rules
      -> Provider Interfaces
        -> Google Sheets, Telegram, AI APIs, storage vendors
```

Provider interfaces required before production integration:

- `CandidateRepository`
- `StorageProvider`
- `MessagingProvider`
- `AiReviewProvider`
- `AnalyticsProvider`
- `AuditLogRepository`
- `AdminAuthorizationService`

## Human Control

AI is allowed to classify, summarize, suggest tags, detect duplicates, and recommend campaigns.

AI is not allowed to independently:

- merge profiles
- blacklist candidates
- approve exports
- message minors
- expose child profiles
- grant admin permissions

## Telegram Backend

Telegram integration runs only through the Node backend. The React frontend checks API health, but it never receives the bot token.

Current backend capabilities:

- verify bot configuration
- send admin notifications
- process Telegram webhook payloads
- run Telegram long polling for local development
- restrict admin commands to the configured admin Telegram ID
- write audit events for admin actions and rejected non-admin messages

## Migration Path

MVP:

- Google Drive
- Google Sheets
- basic search

Phase migration:

- cloud object storage
- database-backed candidate repository
- search engine
- AI indexing with review
- analytics layer
- advanced automation

Avoid a total rewrite by isolating vendor-specific logic behind provider interfaces from the beginning.
