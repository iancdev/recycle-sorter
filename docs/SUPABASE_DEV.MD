# Supabase Local Development

This guide explains how to spin up the local Supabase stack, apply the database schema that lives in `supabase/migrations/`, and generate TypeScript types that the Next.js apps can consume.

## Prerequisites
- Docker Desktop (or another Docker runtime) running locally.
- Node 18+ (already required for the Next.js frontend).
- Supabase CLI (`npx supabase` works without a global install).
- A Supabase access token. The project token is stored in `.env.local` as `SUPABASE_ACCESS_TOKEN`.

## First-Time Setup
1. Authenticate the CLI so it can talk to the hosted project (needed for remote operations and secrets):
   ```bash
   npx supabase login
   ```
   Paste the access token when prompted (`SUPABASE_ACCESS_TOKEN` from `.env.local`).
2. Verify the repo has been initialised (`supabase/config.toml` and `supabase/migrations/` should exist). If not, run `npx supabase init` from the repo root.

## Running the Local Stack
The local stack mirrors Supabase's hosted services (Postgres, Auth, Storage, Realtime, etc.).

```bash
# from the repository root
npx supabase start
```

This command pulls the required Docker images and starts the containers. The first run may take several minutes while images download.

To tear down the stack:
```bash
npx supabase stop
```

## Applying Schema & Seed Data
Whenever you change migrations or want to reset your database:

```bash
# Drops, recreates, and migrates the database, then runs supabase/seed.sql
npx supabase db reset
```

Use `npx supabase db push` if you only want to apply pending migrations to the running database without dropping data.

## Generating TypeScript Types
The Supabase CLI can emit typed definitions for the current schema. Run this whenever migrations change so the frontend stays in sync.

```bash
# run from the repository root while the local stack is running
npx supabase gen types typescript --local > frontend/src/lib/database.types.ts
```

- The output file is committed so the UI can import strongly-typed helpers.
- If you need only a subset of schemas, append `--schema public` or additional schemas as needed.
- Add an ESLint disable header at the top if you plan to commit the generated file without further edits.

## Linking to a Hosted Project (Optional)
If you want to target the hosted Supabase project directly (for example, to inspect remote migrations):

```bash
npx supabase link
```

Provide the project reference (`SUPABASE_PROJECT_REF` in `.env.local`). Once linked you can run commands such as `npx supabase db pull` to download the remote schema.

## Troubleshooting
- **Connection refused** when running CLI commands: ensure `npx supabase start` completed successfully and Docker is still running.
- **Login prompts repeatedly**: delete `~/.supabase` and log in again with the access token.
- **Types not updating**: make sure migrations have run and the local database reflects the latest schema before regenerating types.

## Edge Function Environment
Edge functions read from the following environment variables when deployed or emulated locally:
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` – injected automatically when running via the Supabase platform or local stack.
- `KIOSK_REDIRECT_URL` – optional; overrides the magic-link redirect used by `authenticate-barcode`. Defaults to `http://localhost:3000/kiosk` during local development.

To provide custom values locally, add them to `supabase/.env` and start the stack with `npx supabase start`. The CLI automatically injects variables from that file into the runtime.
## Edge Functions
- `authenticate-barcode`: creates/looks up users by barcode, ensures one active session, returns magic link payload. POST payload `{ barcode, displayName?, edgeDeviceLabel? }`.
- `record-item`: invoked by the edge computer after classification. POST payload `{ sessionId, categorySlug, confidence?, amountOverrideCents?, rawPayload?, clientRef? }`.
- `close-session`: kiosk/dashboard call to mark a session finished. POST payload `{ sessionId, status? }` with status in `complete | expired | error`.

Serve functions locally with hot reload:
```bash
npx supabase functions serve --env supabase/.env
```
Then call endpoints at `http://localhost:54321/functions/v1/<function-name>`.


## Frontend Environment
Set the following variables in `frontend/.env.local` (or the Netlify UI) so the kiosk interface can talk to Supabase:
- `NEXT_PUBLIC_SUPABASE_URL` – project URL from the Supabase dashboard.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` – anon API key.
- `NEXT_PUBLIC_KIOSK_EDGE_DEVICE_LABEL` – optional; label reported to edge functions (defaults to `demo_kiosk`).
- `NEXT_PUBLIC_ENABLE_IDLE_TIMEOUT` – optional; set to `false` to disable the kiosk inactivity auto-close (defaults to `true`).

After updating environment variables, restart `npm run dev` to ensure Next.js picks up the changes.
