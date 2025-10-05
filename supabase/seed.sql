insert into public.categories (id, slug, display_name, deposit_cents, routing_slot, is_refundable)
values
  (gen_random_uuid(), 'can', 'Cans', 7, 1, true),
  (gen_random_uuid(), 'bottle', 'Bottles', 8, 2, true),
  (gen_random_uuid(), 'garbage', 'Garbage', 0, 3, false)
on conflict (slug) do update
set display_name = excluded.display_name,
    deposit_cents = excluded.deposit_cents,
    routing_slot = excluded.routing_slot,
    is_refundable = excluded.is_refundable,
    updated_at = now();

insert into public.edge_devices (id, label, notes)
values (gen_random_uuid(), 'demo_kiosk', 'Default kiosk used for local development and demos')
on conflict (label) do update
set notes = excluded.notes;
