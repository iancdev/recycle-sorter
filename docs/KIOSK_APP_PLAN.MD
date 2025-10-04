# Kiosk Frontend Implementation Plan

## Goals
- Provide the barcode-driven onboarding flow connecting to the `authenticate-barcode` edge function.
- Maintain an always-on camera loop that surfaces account state, session items, and realtime updates.
- Render high-visibility feedback (item cards, balance changes, voice prompts) aligned with hardware events.

## Architecture Overview
- **App Router structure**: create `/kiosk` route with nested segments (`/kiosk/session`, `/kiosk/summary`).
- **State orchestration**: use Zustand (or React Context + reducers) to coordinate barcode scanning, active session, realtime channel membership, and UI transitions.
- **Supabase client**: instantiate browser client with anon key; service interactions funnel through edge functions for privileged operations.
- **Realtime**: subscribe to `session:{id}` channel (custom broadcast) and table-level streaming for `session_items` / `sessions`.
- **Audio feedback**: background worker that preloads ElevenLabs voice for recognized items; triggered from realtime event queue.

## Feature Breakdown
1. **Barcode Acquisition**
   - Use `BarcodeDetector` API when available; fallback to `@zxing/library` for browsers lacking native support.
   - Manage camera permissions gracefully with a full-screen prompt and troubleshooting hints.
   - Debounce barcode events; on scan call `POST /functions/v1/authenticate-barcode`.

2. **Session Handling**
   - Persist `session` + `profile` to client state.
   - Start inactivity timer (e.g., 2 minutes) to auto-close via `close-session` function.
   - Provide restart button for staff.

3. **Realtime Integration**
   - On session activation, join `public:session_items` subscription filtered by `session_id` or use broadcast channel keyed `session:<id>`.
   - Update UI with incoming items, animate highlight card, update totals with values from payload.

4. **UI Layout**
   - Left column: running receipt (reverse chronological `session_items`).
   - Right column: user info, balance, and large hero for latest recognition.
   - Footer: instructions + status indicators (camera, Supabase, hardware).

5. **Voice & Copy**
   - Call Netlify serverless (TBD) or Supabase edge worker to fetch Gemini text + ElevenLabs audio reference.
   - Play audio in UI; handle overlapping requests by queuing.

6. **Error States**
   - Show clear messaging if Supabase request fails; allow manual barcode entry for fallback.
   - Provide offline mode banner when realtime disconnects; disable deposit prompts until reconnected.

## Implementation Steps
1. Scaffold `/kiosk` route, shared layout, and utility hooks.
2. Implement barcode scanner hook with mocked data for dev.
3. Integrate Supabase auth + session creation using edge function.
4. Wire realtime listeners and local stores for session items.
5. Build UI components, animations, and voice integration.
6. Add automated tests for session store, realtime reducers, and edge-function client wrappers.
7. Document operational runbook (camera permissions, caching, failure responses).

## Dependencies
- Browser: iPad Safari 17+ (BarcodeDetector supported).
- Libraries: `@supabase/supabase-js`, `@zxing/browser`, `zustand` or `jotai`, `framer-motion` for animations.

