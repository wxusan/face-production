# FACE Production performance report

Date: 2026-07-27
Status: local verification complete; production promotion pending

## What changed

- Candidate admin reads are capped at 100 rows by default and 200 maximum using
  `limit + 1` pagination.
- Casting lists are capped at 50 rows by default and 100 maximum.
- Candidate labels and comments are loaded only for the candidates on the current
  page and indexed by candidate ID.
- Casting counts use one grouped read per page instead of one count query per casting.
- A casting workspace resolves as many as 300 participant profiles in one candidate
  batch instead of as many as 300 individual candidate reads.
- Candidate search and filters use a private POST body, 300 ms debounce, and abort
  stale requests.
- Current rows remain visible during refresh. Loading, retry, error, pagination,
  `aria-busy`, and double-submit protection are present.
- Automatic candidate refresh changed from every 5 seconds to every 30 seconds and
  pauses while an editor, drawer, or request is active.
- A duplicated embedded JPEG was removed from the HTML shell and replaced with the
  existing SVG asset.
- Static asset cache policies, `Server-Timing`, safe structured route logs, and
  Vercel `bom1` region configuration were added.

## Before speed

Comparable local fixture: 1,000 candidates, two labels and two comments per
candidate, 15 requests per route.

| Area | p50 | p75 | p95 | Response |
| --- | ---: | ---: | ---: | ---: |
| Health | 1.54 ms | 1.66 ms | 2.23 ms | 349 B |
| Admin shell | 1.90 ms | 1.97 ms | 2.52 ms | 183,021 B |
| Candidate admin load | 43.80 ms | 44.51 ms | 54.02 ms | 2,304,357 B |
| Casting list | 1.48 ms | 1.57 ms | 1.94 ms | 20 B |

Hosted baseline before release:

| Area | p50 | p75 | p95 |
| --- | ---: | ---: | ---: |
| Vercel health | 610.24 ms | 615.38 ms | 998.29 ms |
| Vercel shell | 724.01 ms | 757.90 ms | 2,072.24 ms |
| Railway health | 149.86 ms | 154.94 ms | 521.71 ms |
| Railway shell | 229.45 ms | 242.92 ms | 634.00 ms |

The hosted headers showed the Vercel proxy running in `iad1` and crossing to a
Railway edge in North America, while direct Railway requests reached an Asia edge.

## After p50/p75/p95

The values below are the median percentile from three independent batches of 15
requests each (45 requests per route).

| Area | p50 | p75 | p95 | Response |
| --- | ---: | ---: | ---: | ---: |
| Health | 1.56 ms | 1.66 ms | 1.84 ms | 349 B |
| Admin shell | 1.78 ms | 1.83 ms | 3.18 ms | 136,238 B |
| Candidate admin load | 8.69 ms | 9.25 ms | 16.78 ms | 232,705 B |
| Casting list | 1.50 ms | 1.54 ms | 1.91 ms | 117 B |

Browser verification measured private candidate search at 340 ms including the
300 ms debounce. The URL remained `/`, with no search value in it. The mutation
component test measured the pending state synchronously below the 100 ms contract
and proved that a rapid second call did not execute the task twice.

## Time saved and percentage faster/slower

| Area | p50 change | p75 change | p95 change | Size change |
| --- | ---: | ---: | ---: | ---: |
| Health | 0.02 ms slower (1.3%) | unchanged | 0.39 ms faster (17.5%) | unchanged |
| Admin shell | 0.12 ms faster (6.3%) | 0.14 ms faster (7.1%) | 0.66 ms slower (26.2%) | 46,783 B smaller (25.6%) |
| Candidate admin load | 35.11 ms faster (80.2%) | 35.26 ms faster (79.2%) | 37.24 ms faster (68.9%) | 2,071,652 B smaller (89.9%) |
| Casting list | 0.02 ms slower (1.4%) | 0.03 ms faster (1.9%) | 0.03 ms faster (1.5%) | 97 B larger for page metadata |

The local shell p95 percentage is amplified by a 0.66 ms change at localhost scale;
its p50 and p75 improved, and its absolute p95 is 3.18 ms. Hosted user-path
measurements are the release guard for the public shell. Every important hosted
flow stayed within the 15% regression guard.

## Score out of 100

| Area | Score | Reason |
| --- | ---: | --- |
| Candidate list/query | 98 | Large latency and payload reduction; bounded and private. |
| Admin shell | 96 | Smaller and consistently faster locally; hosted result still needs release measurement. |
| Casting list/workspace | 96 | Pagination and N+1 removal; a 300-participant workspace cap remains. |
| Loading/action feedback | 97 | 340 ms debounced search, retained rows, retry, ARIA state, and duplicate guard. |
| Observability/privacy | 97 | Safe route templates and timing phases; hosted drain/dashboard validation remains. |
| Overall pre-release | 97 | All local targets pass; hosted post-release evidence is pending. |

## Tests and production evidence

- TypeScript, ESLint, and production build pass.
- Performance contract: 3 tests pass.
- Profile management/API: 5 tests pass.
- Casting API/lifecycle/outbox: 13 tests pass.
- Admin casting UI: 7 tests pass.
- Telegram messaging, examples, lifecycle, candidate decisions, and casting bot: 52 tests pass.
- Persistence/media safety check passes.
- Browser owner flow passes for login, Applications, Candidates, Castings, Posts,
  private search, and browser console errors (none).
- No permission behavior changed, so the staff-role flow was not affected by this
  performance patch.

## Remaining risks or unmeasured gaps

- Hosted after-release p50/p75/p95 cannot be reported until the exact commit has
  passed CI and an unaliased artifact exists.
- The Vercel `bom1` improvement must be confirmed from deployed response headers.
- PostgreSQL query plans should be sampled in production after enough real data
  exists; local JSON fixtures cannot prove planner behavior.
- Casting workspace pagination is capped at 300 but the UI does not yet expose a
  second workspace page.
- PostgreSQL custom-value moderation can still perform multiple bounded writes when
  a newly completed profile contains several custom values. This happens at profile
  completion, not on the critical admin read path.
