## Recycle Sorter

This repository hosts the software for the recycling kiosk project outlined in `docs/PROJ.MD`.

### Frontend (Next.js)
- Location: `frontend/`
- Stack: Next.js App Router with TypeScript, Tailwind CSS, ESLint

### Getting Started
1. `cd frontend`
2. `npm install` (already run when the scaffold was generated, rerun if dependencies change)
3. `npm run dev` to start the development server on http://localhost:3000
4. `npm run lint` to check code quality

### Next Steps
- Implement the kiosk UI flows described in `docs/PROJ.MD`
- Integrate Supabase for authentication, sessions, and realtime updates
- Prototype the barcode scanning and session management logic


### Supabase Development
- Schema, migration, and seed files live under `supabase/`.
- Follow `docs/SUPABASE_DEV.MD` for instructions on running the local stack and generating TypeScript types.
- Edge functions live under `supabase/functions/`; see `docs/SUPABASE_DEV.MD` for available endpoints.

### Kiosk App
- Visit `/kiosk` to launch the in-progress kiosk experience.
- Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set before running the frontend locally.
- Optional: set `NEXT_PUBLIC_ENABLE_IDLE_TIMEOUT=false` to disable kiosk auto-close.
- Optional: set `NEXT_PUBLIC_ENABLE_AUDIO_FEEDBACK=true` to surface deposit announcements.
- Optional: set `GEMINI_API_KEY` / `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID`) to enable kiosk audio announcements.
