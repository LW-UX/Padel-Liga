begin;

create table public.racket_bookings (
  subject_type text not null check (subject_type in ('match', 'training')),
  subject_id text not null,
  state text not null check (state in ('booked', 'partial', 'busy', 'outside_hours', 'failed')),
  clearooms_booking_id text,
  booked_from timestamptz,
  booked_until timestamptz,
  busy_from timestamptz,
  busy_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (subject_type, subject_id),
  check ((clearooms_booking_id is null) = (state not in ('booked', 'partial')))
);

comment on table public.racket_bookings is
  'Spiegel der automatischen Clearooms-Schlägerbuchungen; ausschließlich für die Edge Function racket-booking.';

alter table public.racket_bookings enable row level security;
revoke all on table public.racket_bookings from public, anon, authenticated;
grant select, insert, update, delete on table public.racket_bookings to service_role;

commit;
