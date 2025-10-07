# Kiosk Operations Runbook

This runbook covers day-to-day operating procedures, diagnostics, and recovery steps for the recycling kiosk.

## Environment Configuration
Ensure the following environment variables are configured in Netlify (and `.env.local` for local testing):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (`https://<project>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key for kiosk client. |
| `NEXT_PUBLIC_KIOSK_EDGE_DEVICE_LABEL` | Human-friendly label reported to Supabase edge functions (defaults to `demo_kiosk`). |
| `NEXT_PUBLIC_ENABLE_IDLE_TIMEOUT` | Toggle the two-minute auto-close (default `true`). |
| `NEXT_PUBLIC_ENABLE_AUDIO_FEEDBACK` | Enable Gemini/ElevenLabs announcements (default `false`). |
| `SUPABASE_PROJECT_ID` | Optional fallback used during builds when public URL is missing. |
| `SUPABASE_ANON_KEY` | Optional fallback used during builds when public anon key is missing. |
| `GEMINI_API_KEY` | Required for AI-generated narration when audio feedback is enabled. |
| `ELEVENLABS_API_KEY` | Required for voice synthesis when audio feedback is enabled. |
| `ELEVENLABS_VOICE_ID` | Voice identifier to use with ElevenLabs (e.g. `21m00Tcm4TlvDq8ikWAM`). |

## Pre-flight Checklist
1. **Network** – Confirm the kiosk iPad and edge computer are on the trusted network with outbound HTTPS.
2. **Camera** – Open `/` (root) or `/kiosk` and verify the video feed shows the front-facing camera.
3. **Barcode Test** – Scan a known Code 128 barcode; the kiosk should authenticate and display session info.
4. **Edge Link** – Confirm the edge computer establishes a session and classification posts appear in the receipt.
5. **Audio (Optional)** – With audio enabled, deposit an item and verify the announcement plays.

## Diagnostics Panel
The kiosk sidebar now shows:
- **Camera** – Current scanner status (idle/requesting/scanning/error).
- **Realtime** – Supabase realtime connection state (idle/connecting/online/disconnected).
Use this panel to triage connectivity issues before escalating.

## Common Recovery Steps
| Symptom | Action |
| --- | --- |
| Camera status stuck on "requesting" | Reload the homepage (`/`) or `/kiosk`. If unresolved, open Safari settings and grant camera permission. |
| Realtime status shows "Disconnected" | Check network connectivity; verify Supabase credentials. Reload kiosk after resolving network. |
| Session stuck in "Error" overlay | Tap **Reset kiosk** (clears local state) and re-scan barcode. |
| Audio not playing | Confirm audio env vars are set and iPad volume is up; check browser permissions for autoplay. |
| Edge classifications not appearing | Ensure edge service is running, can reach Supabase, and the locker device label matches `NEXT_PUBLIC_KIOSK_EDGE_DEVICE_LABEL`. |

## Logging & Monitoring
- **Browser console** – Temporary logs for barcode scans, audio synthesis, and Supabase errors.
- **Supabase dashboard** – Monitor Realtime connections, logs, and edge function invocations.
- **Netlify deploy logs** – Validate build success and environment variable exposure.

## Escalation
If the above steps fail, collect:
- Screenshot of the diagnostics panel
- Recent console logs (via Safari dev tools)
- Supabase edge function logs for `record-item` and `authenticate-barcode`

Escalate with collected data to the engineering team.
