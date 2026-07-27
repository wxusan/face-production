# FACE Production performance contract

This contract adapts the shop-portal performance requirements to FACE Production's
Node.js, PostgreSQL, Railway, Vercel, and Telegram architecture.

## User-facing targets

- Normal authenticated admin route p50: 700 ms or faster.
- Normal authenticated admin route p95: 1,500 ms or faster; investigate slower outliers.
- Click-to-pending feedback: 100 ms or faster.
- Admin shell usable: 700 ms or faster.
- Candidate and casting context fully usable: 1,000 ms or faster.
- Debounced candidate search complete: 700 ms or faster after the user types.
- No important flow may become more than 15% slower than its comparable baseline.

## Architecture rules

- Candidate and casting list endpoints use bounded `limit + 1` pagination.
- Critical list routes do not load every candidate, label assignment, comment, or
  casting participation into application memory.
- Candidate search and private filter values use a POST body. They must not appear
  in URLs, structured logs, or analytics.
- Automatic searches are debounced and stale requests are aborted.
- Existing rows stay visible while a refresh is pending. The portal exposes
  `aria-busy`, a visible activity state, retry, and error feedback.
- Important mutations disable immediately, show a pending label, and reject a
  rapid duplicate submission.
- Candidate and casting queries use bounded batch reads rather than N+1 reads.
- API responses expose safe `Server-Timing` phases. Structured logs contain route
  templates, status, duration, and request ID, but no candidate search text,
  request bodies, Telegram identifiers, or message contents.
- The process-global PostgreSQL pool is reused. Request-scoped database pools are
  forbidden.
- The Vercel API proxy remains in `bom1` while the database and Railway service are
  in the current Asia deployment topology.
- RBAC, consent checks, audit logs, casting operation IDs, outbox idempotency,
  Telegram privacy, and candidate status invariants must not be weakened.

## Project-specific substitutions

- The copied Nasiya targets map to the admin portal shell and candidate/casting
  context; FACE Production has no Nasiya flow.
- Prisma rules map to the existing process-global `pg.Pool`; FACE Production does
  not use Prisma.
- Shop tenant and financial invariants are not applicable. FACE Production's
  equivalent protected invariants are admin RBAC, candidate consent, audit history,
  casting lifecycle rules, and message/outbox idempotency.

## Required verification

Before completion:

1. Run `npm run typecheck` and `npm run lint`.
2. Run the performance contract, profile, casting, Telegram, UI, and persistence tests.
3. Run `npm run build`.
4. Exercise the complete super-admin browser flow. Exercise a staff flow when a
   change affects permissions.
5. Measure at least three comparable runs and report p50, p75, and p95.
6. Compare each affected area to the recorded baseline and investigate any
   important-flow regression above 15%.

Before production promotion:

1. Use a branch and pull request.
2. Require pull-request CI and exact-main CI to pass.
3. Create an unaliased artifact before changing the live alias.
4. Verify HTTP health, database health, exact commit, and deployment region.
5. Promote only that verified artifact. If any preflight fails, leave the existing
   live deployment active.
