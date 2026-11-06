-- Read-only verification of the supplied historical booking/cancellation pair.
select id, court_name, starts_at, ends_at,
  extract(epoch from ends_at - starts_at)::integer / 60 as duration_minutes,
  cancelled_at is not null as cancelled,
  match_id, source_occurred_at, source_precision_seconds
from private.court_bookings
where starts_at = '2026-10-06T10:30:00Z'
  and ends_at = '2026-10-06T11:30:00Z'
  and court_name = 'Indoor H2';
