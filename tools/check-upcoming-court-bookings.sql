-- Read-only: imported future bookings and their assignment state.
select id, court_name, starts_at, ends_at, cancelled_at is not null as cancelled, match_id
from private.court_bookings
where ends_at > now()
order by starts_at;
