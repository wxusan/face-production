# Communication Workflow MVP

## Admin Panel

The Candidates page now supports three outbound Telegram workflows:

1. Single candidate message
   - Open/select a candidate.
   - Use the message box in the right-side detail panel.
   - The message is sent to that candidate through the Telegram bot.

2. Selected candidate broadcast
   - Filters automatically select all matching rows.
   - Admin can uncheck specific candidates or clear/select the filtered set.
   - Broadcasts send only to selected candidates who have Telegram chat IDs and approved/verified status.
   - Empty selection sends zero messages.

3. Casting post
   - Admin writes a casting title, body, start date, and end date.
   - The casting is saved in storage.
   - If sent immediately, it is sent only to selected approved/verified candidates.

## Candidate Bot Menu

Existing candidates get a persistent Telegram menu:

- Update profile
- Current castings

When updating a profile, the bot walks through the full form again. If an existing value is present, the user can leave the current value instead of re-entering it.

## Storage

- Candidates remain in the candidate repository.
- Casting posts are stored separately in `castings`.
- Postgres is used when `DATABASE_URL` is configured.
- Local JSON fallback is used without Postgres.

## Safety Rules

- Admin-only APIs require the admin web token.
- Telegram broadcasts skip candidates without Telegram chat IDs.
- Telegram broadcasts skip candidates that are not approved/verified.
- Empty selection does not mean "send to everyone."
- Every send attempt records an audit event.
