-- Adds idempotency support and stored procedure for session item recording

alter table public.session_items
  add column if not exists client_ref uuid;

create unique index if not exists session_items_session_client_ref_idx
  on public.session_items (session_id, client_ref)
  where client_ref is not null;

create or replace function public.record_session_item(
  session_id uuid,
  category_slug text,
  amount_override bigint default null,
  confidence numeric(5,4) default null,
  raw_payload jsonb default '{}'::jsonb,
  client_ref uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_session public.sessions%rowtype;
  v_category public.categories%rowtype;
  v_amount bigint;
  v_transaction_id uuid;
  v_transaction_json jsonb;
  v_session_item public.session_items%rowtype;
  v_existing public.session_items%rowtype;
begin
  select *
    into v_session
    from public.sessions
   where id = session_id
   for update;

  if not found then
    raise exception 'Session % not found', session_id using errcode = 'P0002';
  end if;

  if v_session.status <> 'active' then
    raise exception 'Session % is not active', session_id using errcode = 'P0001';
  end if;

  select *
    into v_category
    from public.categories
   where slug = category_slug;

  if not found then
    raise exception 'Category % not found', category_slug using errcode = 'P0002';
  end if;

  if client_ref is not null then
    select *
      into v_existing
      from public.session_items si
     where si.session_id = session_id
       and si.client_ref = client_ref;

    if found then
      return jsonb_build_object(
        'session_item', to_jsonb(v_existing),
        'transaction', to_jsonb((select t from public.transactions t where t.id = v_existing.transaction_id)),
        'category', to_jsonb(v_category)
      );
    end if;
  end if;

  v_amount := coalesce(amount_override, v_category.deposit_cents, 0);

  if v_amount < 0 then
    raise exception 'amount_cents must be non-negative' using errcode = '22003';
  end if;

  v_transaction_id := null;
  v_transaction_json := null;

  if v_amount > 0 then
    insert into public.transactions (
      profile_id,
      session_id,
      category_id,
      type,
      amount_cents,
      description
    ) values (
      v_session.profile_id,
      v_session.id,
      v_category.id,
      'deposit',
      v_amount,
      concat(v_category.display_name, ' deposit')
    )
    returning id, to_jsonb(transactions.*)
      into v_transaction_id, v_transaction_json;
  end if;

  insert into public.session_items (
    session_id,
    category_id,
    transaction_id,
    detected_at,
    confidence,
    amount_cents,
    raw_payload,
    client_ref
  ) values (
    v_session.id,
    v_category.id,
    v_transaction_id,
    now(),
    confidence,
    v_amount,
    coalesce(raw_payload, '{}'::jsonb),
    client_ref
  )
  returning * into v_session_item;

  return jsonb_build_object(
    'session_item', to_jsonb(v_session_item),
    'transaction', v_transaction_json,
    'category', to_jsonb(v_category),
    'session', to_jsonb(v_session)
  );
end;
$$;

