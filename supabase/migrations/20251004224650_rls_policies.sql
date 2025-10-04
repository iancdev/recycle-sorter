-- Enable row level security and define base policies for end-user access

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.session_items enable row level security;
alter table public.transactions enable row level security;
alter table public.profile_identifiers enable row level security;

-- Profiles: owners can view and update their record
create policy "Profiles are viewable by owner"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "Profiles are updatable by owner"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Sessions: owners can read/update their sessions
create policy "Sessions readable by owner"
  on public.sessions
  for select
  using (auth.uid() = profile_id);

create policy "Sessions mutable by owner"
  on public.sessions
  for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- Session items: visible to session owner only
create policy "Session items visible to session owner"
  on public.session_items
  for select
  using (
    auth.uid() = (
      select s.profile_id from public.sessions s where s.id = session_items.session_id
    )
  );

-- Transactions: visible to profile owner only
create policy "Transactions visible to owner"
  on public.transactions
  for select
  using (auth.uid() = profile_id);

-- Utility function to close or expire sessions atomically
create or replace function public.close_session(
  session_id uuid,
  next_status text default 'complete'
)
returns public.sessions
language plpgsql
as $$
declare
  v_session public.sessions%rowtype;
  v_target_status text := lower(next_status);
begin
  if v_target_status not in ('complete', 'expired', 'error') then
    raise exception 'Invalid session status %', next_status using errcode = '22023';
  end if;

  select * into v_session
    from public.sessions
   where id = session_id
   for update;

  if not found then
    raise exception 'Session % not found', session_id using errcode = 'P0002';
  end if;

  if v_session.status = v_target_status then
    return v_session;
  end if;

  update public.sessions
     set status = v_target_status,
         completed_at = case when v_target_status = 'active' then null else now() end
   where id = session_id
   returning * into v_session;

  return v_session;
end;
$$;

