# Technical Decisions

## TD-001: Build as a Product Shell First

Status: accepted

The first implementation is a TypeScript React admin console with explicit domain data and governance state. This creates a visible product foundation before vendor integrations are added.

Reason:

- The source specification stresses that this must be a platform product, not disconnected scripts.
- Admin workflows and product controls need to be understood before automation is expanded.

## TD-002: Vendor Abstraction Is Mandatory

Status: accepted

Telegram, AI APIs, Google Sheets, cloud storage, search, and analytics must be accessed through provider interfaces.

Reason:

- FACE Production must retain data ownership and migration ability.
- MVP vendors should be replaceable without a total rewrite.

## TD-003: AI Requires Human Approval

Status: accepted

AI features may suggest tags, duplicate matches, quality issues, and campaign audiences. Human operators retain authority over merge, blacklist, export, child visibility, and broadcast decisions.

Reason:

- The platform handles sensitive candidate data.
- Operational reliability and trust are more important than flashy automation.

## TD-004: MVP Uses Mock Data Until Integrations Are Approved

Status: accepted

The current app uses local TypeScript seed data. Real Google Sheets, Telegram, AI, and storage integrations should be added only after provider contracts and access rules are defined.

Reason:

- Avoid premature vendor lock-in.
- Let the team validate workflows before production data is connected.

## TD-005: Documentation Lives With the Codebase

Status: accepted

Architecture, governance, and decision records are committed beside the application.

Reason:

- The spec requires documenting all technical decisions.
- Future developers need the operating rules in the repo, not only in chat history.
