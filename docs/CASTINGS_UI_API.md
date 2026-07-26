# Castings admin UI API

The admin portal treats castings as a dedicated workspace. Legacy `active` status is displayed as `published`.

## List and create

- `GET /api/castings` returns `{ castings }`.
- `POST /api/castings` accepts `title`, `body`, `startsAt`, `endsAt`, `status`, `sendNow`, and `operationId`.

Each casting may include `counts: { applications, candidates, invitations, awaiting }`.

## Workspace

`GET /api/castings/:id/workspace` returns:

```json
{
  "casting": {},
  "applications": [],
  "candidates": [],
  "invitations": [
    {
      "candidateId": "candidate-id",
      "candidate": {},
      "status": "awaiting",
      "invitedAt": "ISO timestamp"
    }
  ]
}
```

## Actions

- `POST /api/castings/:id/manage` accepts `action: edit | publish | close | cancel`, editable casting fields, and an `operationId`. Publish sends `audiences: ["channel", "eligible_bot_users"]` and returns `delivery.queuedCount` plus `delivery.skipped` so the portal can show durable queued work and visible configuration problems.
- `POST /api/castings/:id/invitations` accepts `candidateIds` and `operationId`.
- `POST /api/castings/:id/decisions` accepts `candidateId`, `castingDecision: accept | reject`, `profileDecision: unchanged | approve | reject`, and `operationId`.
- Existing `POST /api/candidates/:id/approve` and `/reject` actions remain available for profile-only decisions; the casting decision endpoint supports the combined action.
- `POST /api/castings/:id/messages` accepts `candidateIds`, `audience: applications | candidates | invitations`, `text`, and `operationId`.
- `POST /api/castings/:id/invitations/:candidateId/cancel` cancels an unanswered invitation.
- `DELETE /api/castings/:id/participants/:candidateId` removes a selected participant.

The workspace renders a localized empty state when a casting does not exist. Closed and cancelled castings are terminal: their detail pages remain readable, but editing and lifecycle actions are hidden.
