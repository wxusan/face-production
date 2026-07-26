# Casting Workflow

This document is the product contract for casting announcements, applications,
invitations, selection, and casting-context communication.

## Independent decisions

A FACE Production profile decision and a casting participation decision are
independent.

Profile statuses:

- `incomplete`
- `pending_review`
- `approved`
- `rejected`
- legacy `verified` is treated as approved

Casting statuses:

- `draft`
- `published`
- `closed`
- `cancelled`
- legacy `active` is treated as published

Participation sources:

- `self_apply`
- `invitation`
- `admin_added`

Participation statuses:

- `applied`
- `invited`
- `selected`
- `rejected`
- `declined`
- `withdrawn`
- `removed`
- `cancelled`

There may be only one participation record for a candidate and casting. Every
command is idempotent so Telegram retries, rapid taps, admin retries, and service
restarts do not create duplicate applications or invitations.

## Publication

Publishing a casting may create:

- one Telegram channel announcement with a URL button;
- localized private bot announcements for the selected approved and
  consent-verified audience.

The channel button uses a compact deep link:

```text
https://t.me/<bot username>?start=cast_<public token>
```

Private messages use `cast:apply:<public token>` callback data. The public token
contains only `A-Z`, `a-z`, `0-9`, `_`, or `-` and never contains a candidate ID.

Publication and delivery use stable operation and recipient keys. A channel post
or candidate message that is already recorded as sent must not be sent again.
Closing or cancelling a casting makes every old application button harmless
because the live casting state is checked on every tap.

## Self-application

| Candidate state | Result |
| --- | --- |
| Complete, approved profile | Create `applied` participation |
| Complete, pending profile | Create `applied`; keep profile pending |
| Missing or incomplete profile | Save pending casting intent and continue registration |
| Rejected profile | Require profile update/resubmission |
| Existing `applied` participation | Return the current state without a duplicate |
| Existing `invited` participation | Treat Apply as accepting the invitation |
| Existing `selected` participation | Report that the candidate is already selected |
| Closed/cancelled/not-yet-open casting | Reject the application with a localized explanation |

After registration completes, the bot shows an explicit **Apply now** button.
Completing a profile never silently applies to a casting.

Only a self-owned Telegram profile may self-apply. A friend/proxy profile cannot
be selected implicitly from the submitter's Telegram account.

## Invitations

Admins invite approved, reachable, consent-verified candidates. The participation
row is created before Telegram delivery.

Invitation callback data:

- `cast:accept:<public token>`
- `cast:decline:<public token>`

Accepting an admin invitation changes `invited` to `selected`. Declining changes
it to `declined`. A candidate who already applied, was invited, or was selected is
not invited again.

## Admin workspace

The Castings workspace is separate from Posts. Posts remains for general
broadcasts only.

Each casting has:

- **Applications**: `applied` participations awaiting a casting decision;
- **Candidates**: `selected` participations;
- **Invitations**: invitation selection, awaiting response, and response history.

For an applicant whose FACE profile is pending, the administrator may:

- approve the casting only;
- approve the FACE profile only;
- approve both;
- reject the casting only;
- reject both after explicit confirmation.

Saving or editing profile data must not change either decision automatically.

## Contextual communication

Candidate-profile messages use a general FACE Production heading. Messages sent
from a casting workspace include the casting title and casting ID on the server
side. The server must not depend on a browser-only label for message context.

An individual casting message may be sent to any reachable applicant, including
a pending or rejected FACE profile. Mass publication and invitations remain
limited to the approved, reachable, consent-verified audience.

Every application, invitation, decision, message, publication, retry, delivery
failure, close, and cancellation records the actor, time, target, previous state,
new state, and casting ID in the audit history.

## Required evidence before production

- Applying from a channel without a profile resumes the intended casting after
  registration and requires explicit confirmation.
- Approved and pending complete profiles can apply.
- Repeated Apply taps create exactly one participation.
- Invitation accept and decline are idempotent.
- Existing applicants cannot receive duplicate invitations.
- Separate and combined profile/casting decisions preserve the unselected state.
- Casting messages are visibly contextual in Uzbek, Russian, and English.
- Closing and cancelling a casting stop old buttons.
- A profile snapshot is retained and current-profile changes are visible.
- Channel and direct-message publication resumes safely after a Railway restart.
- Missing channel permissions and Telegram failures are visible to the admin.
- The admin list counts match the Applications, Candidates, and Invitations tabs.
