# Database Model

This document captures the initial Supabase/Postgres schema powering the recycling sorter. It mirrors the end-to-end flow outlined in `docs/PROJ.MD`: kiosk sign-in, active session tracking, edge-device categorization, and instant balance updates.

## Entity Overview
- **profiles**: Extended user metadata and cached balance tied to Supabase Auth users.
- **profile_identifiers**: Barcode or other external identifiers that let the kiosk look up a profile quickly.
- **sessions**: One active deposit flow per user, created after the kiosk reads a valid barcode.
- **session_items**: Granular record of each classified item coming from the edge computer.
- **transactions**: Ledger entries that credit (or eventually debit) user balances and roll up to both session and profile totals.
- **categories**: Canonical list of recyclables/garbage recognized by the vision model with configuration for payouts and hardware routing.
- **edge_devices**: Simple reference table so a session can optionally record which kiosk handled it. For the demo we keep a single default device.

## Table Definitions

### profiles
Holds end-user state in lock-step with `auth.users`.
- `id UUID PK` (matches `auth.users.id`).
- `display_name TEXT`.
- `email TEXT NULL` (duplicate for fast access).
- `phone TEXT NULL` (E.164; used for dashboard login).
- `balance_cents BIGINT DEFAULT 0` (cached running balance).
- `created_at TIMESTAMPTZ DEFAULT now()`.
- `updated_at TIMESTAMPTZ DEFAULT now()`.

### profile_identifiers
Maps barcodes and future identifiers to a profile.
- `id UUID PK`.
- `profile_id UUID FK -> profiles.id`.
- `type TEXT` (e.g. `student_barcode`, `rfid`, `manual_code`).
- `identifier TEXT` (barcodes stored as normalized string; unique per type).
- `created_at TIMESTAMPTZ DEFAULT now()`.
- **Unique** on (`type`, `identifier`).

### sessions
Represents a kiosk visit; only one active per profile at a time.
- `id UUID PK`.
- `profile_id UUID FK -> profiles.id`.
- `edge_device_id UUID FK -> edge_devices.id NULL` (optional; track which kiosk processed the session).
- `status TEXT` (`active`, `complete`, `expired`, `error`).
- `started_at TIMESTAMPTZ DEFAULT now()`.
- `completed_at TIMESTAMPTZ NULL`.
- `total_cents BIGINT DEFAULT 0` (denormalized running total).
- `metadata JSONB` (receipt embellishments, kiosk lane info).
- **Index** on (`profile_id`, `status`) for quick “active session” lookups.

### session_items
One row per edge-classified item.
- `id UUID PK`.
- `session_id UUID FK -> sessions.id`.
- `category_id UUID FK -> categories.id`.
- `transaction_id UUID FK -> transactions.id NULL` (set when the payout posts).
- `client_ref UUID NULL` (edge device generated idempotency key; unique per session).
- `detected_at TIMESTAMPTZ DEFAULT now()`.
- `confidence NUMERIC(5,4)` (0-1 score from CV model).
- `amount_cents BIGINT` (amount awarded for this item).
- `raw_payload JSONB` (model outputs, ESP32 feedback).
- **Index** on (`session_id`, `detected_at`).
- **Unique** on (`session_id`, `client_ref`) when `client_ref` present.

### transactions
Ledger that backs balances and receipts.
- `id UUID PK`.
- `profile_id UUID FK -> profiles.id`.
- `session_id UUID FK -> sessions.id NULL` (allows non-session adjustments).
- `category_id UUID FK -> categories.id NULL` (NULL for manual credits).
- `type TEXT` (`deposit`, `adjustment`, `reversal`).
- `amount_cents BIGINT` (positive for credit, negative for charge back).
- `description TEXT` (render on receipts).
- `created_at TIMESTAMPTZ DEFAULT now()`.
- `created_by UUID NULL` (service actor; for demo this can stay NULL).
- **Index** on (`profile_id`, `created_at DESC`).

> Trigger idea: `transactions` has an `AFTER INSERT OR UPDATE` trigger that adjusts `profiles.balance_cents` and, when `session_id` is present, increments `sessions.total_cents`.

### categories
Configurable lookup powering both payouts and hardware routing.
- `id UUID PK`.
- `slug TEXT UNIQUE` (e.g. `can`, `juice_box`, `garbage`).
- `display_name TEXT`.
- `deposit_cents BIGINT` (payout per item).
- `routing_slot SMALLINT` (Lazy Susan position or command ID for the ESP32).
- `is_refundable BOOLEAN DEFAULT true` (garbage may be `false`).
- `created_at TIMESTAMPTZ DEFAULT now()`.
- `updated_at TIMESTAMPTZ DEFAULT now()`.

### edge_devices
Current deployment keeps the table minimal: a single row with a friendly label.
- `id UUID PK`.
- `label TEXT` (e.g. `demo_kiosk`).
- `notes TEXT NULL` (hardware details, location, or maintenance info).
- `created_at TIMESTAMPTZ DEFAULT now()`.

> Scaling hook: when additional kiosks arrive we can add columns for `api_key`, `last_seen`, and `status`, or split those concerns into a companion `device_secrets` table.

## Realtime Channels
- `public:sessions` streaming the current active session per kiosk (filtered by `edge_device_id` when present).
- `public:session_items` for new classifications pushed by the edge computer.
- `public:transactions` for kiosk UI to refresh balances and receipts instantly.

## Security and RLS Sketch
- `profiles`: end-users can `SELECT` their row; kiosk service role can `upsert` during scan.
- `profile_identifiers`: only service role + kiosk hardware has access.
- `sessions`: end-users can `SELECT` rows where `profile_id = auth.uid()`; edge devices insert/update rows assigned to them (service role handles inserts for demo).
- `session_items`: insert by edge device key/service role; select by owning profile.
- `transactions`: select by owning profile; insert by kiosk service role or backend jobs.
- `categories`: read-only public.
- `edge_devices`: service role only (read/write) until a multi-device rollout requires per-device restrictions.

## Data Flow Highlights
1. **Sign-in**: Kiosk scans barcode, looks up `profile_identifiers`. Missing profile triggers `profiles` insert inside the same transaction, linking `auth.users` row.
2. **Session boot**: New row in `sessions` (`status = active`, `total_cents = 0`). Kiosk subscribes to this session via Realtime and shows baseline balance from `profiles`.
3. **Classification**: Edge device invokes the `record_session_item` RPC via an edge function, which atomically calculates the payout (respecting overrides), inserts the ledger entry when refundable, and links the resulting `session_items` row using an optional `client_ref` idempotency key.
4. **Balance update**: Trigger on `transactions` bumps `profiles.balance_cents` and `sessions.total_cents`. Realtime pushes the results to kiosk and dashboard.
5. **Session close**: Kiosk sets `status = complete`, stamps `completed_at`. A cleanup job can expire dormant sessions.

## Future Extensions
- Replace `balance_cents` cache with SQL view if concurrency pressure is low.
- Add `session_events` table to log kiosk prompts, errors, and manual overrides.
- Introduce `payout_rules` table if deposit values vary over time or by location.
- Support multi-campus deployments via `locations` and partitioned `kiosks` tables keyed into `sessions` and `edge_devices`.
- Harden multi-device deployments by layering API keys/heartbeat tracking and expanding RLS policies when needed.


### record_session_item RPC
- Wraps session classification inserts in a single transaction to keep ledger, session totals, and item audit trail consistent.
- Accepts `session_id`, `category_slug`, optional `amount_override`, `confidence`, `raw_payload`, and `client_ref` (for idempotent retries).
- Returns JSON containing the inserted `session_items` row, the associated `transactions` row when applicable, and the current session + category metadata.
- Ignores repeat submissions automatically when `client_ref` matches an existing row for the same session.
