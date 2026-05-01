# Orchid Web

This package contains the Orchid web UI and the production API. The API is implemented with Hono in `app/lib/api-app.ts` and is mounted through the Next.js route handler at `app/api/[[...route]]/route.ts`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

API routes are served under `/api`, for example `http://localhost:3000/api/health`.

## Database

```bash
pnpm db:migrate
```

## Checks

```bash
pnpm check
pnpm test
pnpm test:e2e
```

## Deploy

The web UI and API deploy together on Vercel.

Required environment variables:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `NEXT_PUBLIC_URL`
