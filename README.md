# Face Production

One repository for the public Face Production website and the private casting dashboard. The applications share a workspace but remain independently runnable, buildable, and deployable.

## Repository structure

```text
apps/
  website/       Public multilingual website
  dashboard/     Private casting operations dashboard and backend

packages/
  brand/         Shared brand tokens
  ui/            Future shared interface components
  types/         Shared cross-application types
  api-client/    Future shared API client
```

## Local development

Install all workspace dependencies from the repository root:

```bash
npm install
```

Run only the public website:

```bash
npm run dev:website
```

Run only the dashboard:

```bash
npm run dev:dashboard
```

Run both applications:

```bash
npm run dev
```

The dashboard backend and Telegram commands remain available from its workspace:

```bash
npm run server --workspace=@face-production/dashboard
npm run bot --workspace=@face-production/dashboard
```

## Builds

```bash
npm run build
npm run build:website
npm run build:dashboard
```

## Deployment direction

- `faceproduction.uz` → `apps/website`
- `app.faceproduction.uz` → `apps/dashboard`

Each application keeps its own deployment configuration and environment variables. Dashboard documentation is available in [`apps/dashboard/docs`](./apps/dashboard/docs).
