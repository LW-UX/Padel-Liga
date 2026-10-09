begin;

create or replace function private.protect_cancelled_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.cancelled_at is not null and (
    new.cancelled_at is distinct from old.cancelled_at
    or new.match_at is not null
    or new.result_details is distinct from old.result_details
    or new.actual_sets is distinct from old.actual_sets
    or new.winner is distinct from old.winner
    or new.counts_for_ranking is distinct from old.counts_for_ranking
    or new.counts_for_elo is distinct from old.counts_for_elo
    or new.betting_open is distinct from old.betting_open
  ) then
    raise exception 'Diese Partie wurde endgültig aus der Wertung genommen.';
  end if;
  return new;
end;
$$;

update public.matches
set match_at = null
where cancelled_at is not null and match_at is not null;

alter table public.matches drop constraint if exists matches_cancelled_without_rating_check;
alter table public.matches add constraint matches_cancelled_without_rating_check check (
  cancelled_at is null or (
    competition_stage = 'league'
    and match_at is null
    and result_details is null
    and actual_sets is null
    and winner is null
    and not counts_for_ranking
    and not counts_for_elo
    and not betting_open
  )
);

create or replace function public.cancel_match(p_match_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_match record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;
  if not found or current_profile.app_role is distinct from 'admin' then
    raise exception 'Nur Admins dürfen Partien aus der Wertung nehmen.';
  end if;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id and season.results_entry_enabled
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;
  if selected_match.competition_stage <> 'league' then
    raise exception 'Nur Ligapartien können aus der Wertung genommen werden.';
  end if;
  if selected_match.cancelled_at is not null then
    raise exception 'Diese Partie wurde bereits aus der Wertung genommen.';
  end if;
  if selected_match.actual_sets is not null
    or selected_match.winner is not null
    or selected_match.result_details is not null then
    raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.';
  end if;
  if exists (
    select 1 from public.result_proposals as proposal
    where proposal.match_id = p_match_id and proposal.status = 'pending'
  ) then
    raise exception 'Für diese Partie wartet bereits ein Ergebnis auf Bestätigung.';
  end if;
  if exists (
    select 1 from public.live_match_sessions as session
    where session.match_id = p_match_id
      and session.status in ('live', 'needs_server', 'ready_to_finish')
  ) then
    raise exception 'Der laufende Liveticker muss zuerst verworfen werden.';
  end if;

  update public.matches
  set
    match_at = null,
    cancelled_at = now(),
    counts_for_ranking = false,
    counts_for_elo = false,
    betting_open = false
  where id = p_match_id;

  perform private.advance_season_tournament(selected_match.season_id);
  perform private.try_complete_season(selected_match.season_id);
end;
$$;

revoke execute on function public.cancel_match(text) from public, anon;
grant execute on function public.cancel_match(text) to authenticated;

create or replace function public.get_player_profile(p_player_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.get_player_profile_base_without_cancellation(p_player_id) as payload
  )
  select case when base.payload is null then null else jsonb_set(
    base.payload,
    '{matches}',
    coalesce((
      select jsonb_agg(
        item.value || jsonb_build_object(
          'isCancelled', match.cancelled_at is not null,
          'date', case
            when match.cancelled_at is not null then 'null'::jsonb
            else item.value -> 'date'
          end
        )
        order by
          case
            when match.cancelled_at is not null then matchday.starts_on
            else nullif(item.value ->> 'date', '')::date
          end desc nulls last,
          item.ordinality
      )
      from jsonb_array_elements(coalesce(base.payload -> 'matches', '[]'::jsonb))
        with ordinality as item(value, ordinality)
      left join public.matches as match on match.id = item.value ->> 'id'
      left join public.season_matchdays as matchday
        on matchday.season_id = match.season_id and matchday.matchday = match.matchday
    ), '[]'::jsonb)
  ) end
  from base;
$$;

revoke execute on function public.get_player_profile(text) from public;
grant execute on function public.get_player_profile(text) to anon, authenticated;

update public.season_matchdays
set starts_on = '2026-10-05', ends_on = '2026-10-09'
where season_id = 'test-2026' and matchday = 3;

commit;
