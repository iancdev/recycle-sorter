-- Supabase initial schema for recycling sorter project
-- Mirrors data model defined in docs/DB.MD

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

-- Profiles table synced with auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  phone text,
  balance_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- External identifiers (e.g. student barcode)
create table if not exists public.profile_identifiers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  identifier text not null,
  created_at timestamptz not null default now(),
  constraint profile_identifiers_type_identifier_key unique (type, identifier)
);

create index if not exists profile_identifiers_profile_idx on public.profile_identifiers (profile_id);

-- Categories recognized by CV + payout schedule
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  deposit_cents bigint not null,
  routing_slot smallint not null,
  is_refundable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Edge devices / kiosks metadata
create table if not exists public.edge_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint edge_devices_label_key unique (label)
);

-- Sessions representing an active kiosk run
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  edge_device_id uuid references public.edge_devices (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'complete', 'expired', 'error')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_cents bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists sessions_profile_status_idx on public.sessions (profile_id, status);
create unique index if not exists sessions_single_active_idx on public.sessions (profile_id) where status = 'active';

-- Transactions ledger
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  type text not null default 'deposit' check (type in ('deposit', 'adjustment', 'reversal')),
  amount_cents bigint not null check (amount_cents <> 0),
  description text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists transactions_profile_created_idx on public.transactions (profile_id, created_at desc);
create index if not exists transactions_session_idx on public.transactions (session_id);

-- Session items recorded from edge computer classifications
create table if not exists public.session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  transaction_id uuid unique references public.transactions (id) on delete set null,
  detected_at timestamptz not null default now(),
  confidence numeric(5,4),
  amount_cents bigint not null,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists session_items_session_detected_idx on public.session_items (session_id, detected_at);
create index if not exists session_items_category_idx on public.session_items (category_id);

-- Timestamp update helper
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

-- Ledger trigger to keep balances in sync
create or replace function public.handle_transaction_change()
returns trigger as $$
declare
  amount_diff bigint;
begin
  if tg_op = 'INSERT' then
    update public.profiles
      set balance_cents = balance_cents + new.amount_cents,
          updated_at = now()
      where id = new.profile_id;

    if new.session_id is not null then
      update public.sessions
        set total_cents = total_cents + new.amount_cents
        where id = new.session_id;
    end if;

    return new;
  elsif tg_op = 'UPDATE' then
    -- Handle balance adjustments when profile changes or amount changes
    if new.profile_id is distinct from old.profile_id then
      update public.profiles
        set balance_cents = balance_cents - old.amount_cents,
            updated_at = now()
        where id = old.profile_id;

      update public.profiles
        set balance_cents = balance_cents + new.amount_cents,
            updated_at = now()
        where id = new.profile_id;
    elsif new.amount_cents <> old.amount_cents then
      amount_diff := new.amount_cents - old.amount_cents;
      update public.profiles
        set balance_cents = balance_cents + amount_diff,
            updated_at = now()
        where id = new.profile_id;
    end if;

    -- Update session totals when session linkage or amount changes
    if new.session_id is distinct from old.session_id then
      if old.session_id is not null then
        update public.sessions
          set total_cents = total_cents - old.amount_cents
          where id = old.session_id;
      end if;

      if new.session_id is not null then
        update public.sessions
          set total_cents = total_cents + new.amount_cents
          where id = new.session_id;
      end if;
    elsif new.session_id is not null and new.amount_cents <> old.amount_cents then
      amount_diff := new.amount_cents - old.amount_cents;
      update public.sessions
        set total_cents = total_cents + amount_diff
        where id = new.session_id;
    end if;

    return new;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger handle_transactions_change
after insert or update on public.transactions
for each row execute function public.handle_transaction_change();

