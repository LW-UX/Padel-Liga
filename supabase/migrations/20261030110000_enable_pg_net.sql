-- Lets the database call the send-match-notifications function on a schedule.
create extension if not exists pg_net with schema extensions;
