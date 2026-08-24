# Face Production

Repository for the public Face Production website. The retired dashboard has been removed. The current private platform remains at `admin.faceproduction.uz` and must only be added here from its current source.

## Repository structure

```text
apps/
  website/       Public multilingual website

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

Run the public website:

```bash
npm run dev:website
```

## Builds

```bash
npm run build
npm run build:website
```

## Deployment direction

- `faceproduction.uz` → `apps/website`
- `admin.faceproduction.uz` → current private platform (not the retired dashboard)
