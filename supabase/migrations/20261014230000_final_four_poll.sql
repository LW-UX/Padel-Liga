begin;

create table public.final_four_poll_votes (
  season_id text not null references public.seasons(id) on delete cascade,
  browser_id uuid not null,
  player_id text not null references public.players(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season_id, browser_id)
);

create index final_four_poll_votes_result_idx
  on public.final_four_poll_votes(season_id, player_id);

alter table public.final_four_poll_votes enable row level security;
revoke all on public.final_four_poll_votes from public, anon, authenticated;

create trigger final_four_poll_votes_set_updated_at
before update on public.final_four_poll_votes
for each row execute function private.set_updated_at();

create or replace function public.get_public_final_four_poll(
  p_match_id text,
  p_browser_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_season_id text;
  selected_browser_vote text;
  poll_closed_at timestamptz;
  finalist_count integer;
  total_votes integer;
  poll_options jsonb;
begin
  select match.season_id into selected_season_id
  from public.matches as match
  where match.id = p_match_id
    and match.competition_stage = 'final_four'
    and match.cancelled_at is null;

  if selected_season_id is null then return null; end if;

  select count(*) into finalist_count
  from public.season_tournament_players as finalist
  where finalist.season_id = selected_season_id
    and finalist.stage = 'final_four';

  if finalist_count <> 4 then return null; end if;

  select min(session.started_at) into poll_closed_at
  from public.live_match_sessions as session
  join public.matches as match on match.id = session.match_id
  where match.season_id = selected_season_id
    and match.competition_stage = 'final_four';

  if p_browser_id is not null then
    select vote.player_id into selected_browser_vote
    from public.final_four_poll_votes as vote
    where vote.season_id = selected_season_id
      and vote.browser_id = p_browser_id;
  end if;

  select coalesce(sum(option.votes), 0)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'playerId', option.player_id,
      'displayName', option.display_name,
      'votes', option.votes,
      'percentage', option.percentage
    ) order by option.seed, option.player_id), '[]'::jsonb)
  into total_votes, poll_options
  from (
    with counts as (
      select
        finalist.player_id,
        finalist.seed::integer as seed,
        player.display_name,
        count(vote.browser_id)::integer as votes
      from public.season_tournament_players as finalist
      join public.players as player on player.id = finalist.player_id
      left join public.final_four_poll_votes as vote
        on vote.season_id = finalist.season_id
        and vote.player_id = finalist.player_id
      where finalist.season_id = selected_season_id
        and finalist.stage = 'final_four'
      group by finalist.player_id, finalist.seed, player.display_name
    ), shares as (
      select counts.*,
        sum(votes) over ()::integer as total,
        case when sum(votes) over () = 0 then 0
          else floor(votes * 100.0 / sum(votes) over ())::integer
        end as base_percentage,
        case when sum(votes) over () = 0 then 0
          else votes * 100.0 / sum(votes) over ()
            - floor(votes * 100.0 / sum(votes) over ())
        end as remainder
      from counts
    ), ranked as (
      select shares.*,
        row_number() over (order by remainder desc, votes desc, seed, player_id) as remainder_rank,
        case when total = 0 then 0
          else 100 - sum(base_percentage) over ()
        end as remaining_points
      from shares
    )
    select
      player_id,
      seed,
      display_name,
      votes,
      base_percentage
        + case when remainder_rank <= remaining_points then 1 else 0 end as percentage
    from ranked
  ) as option;

  return jsonb_build_object(
    'seasonId', selected_season_id,
    'closed', poll_closed_at is not null,
    'closedAt', poll_closed_at,
    'totalVotes', total_votes,
    'browserVote', selected_browser_vote,
    'options', poll_options
  );
end;
$$;

create or replace function public.submit_final_four_vote(
  p_match_id text,
  p_player_id text,
  p_browser_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_season_id text;
begin
  if p_browser_id is null then
    raise exception 'Der Browser konnte nicht eindeutig erkannt werden.';
  end if;

  select match.season_id into selected_season_id
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id
    and match.competition_stage = 'final_four'
    and match.cancelled_at is null
  for update of season;

  if selected_season_id is null then
    raise exception 'Das Final Four wurde nicht gefunden.';
  end if;

  if exists (
    select 1
    from public.live_match_sessions as session
    join public.matches as match on match.id = session.match_id
    where match.season_id = selected_season_id
      and match.competition_stage = 'final_four'
  ) then
    raise exception 'Die Abstimmung ist bereits beendet.';
  end if;

  if not exists (
    select 1
    from public.season_tournament_players as finalist
    where finalist.season_id = selected_season_id
      and finalist.stage = 'final_four'
      and finalist.player_id = p_player_id
  ) then
    raise exception 'Dieser Spieler gehört nicht zum Final Four.';
  end if;

  insert into public.final_four_poll_votes(season_id, browser_id, player_id)
  values (selected_season_id, p_browser_id, p_player_id)
  on conflict (season_id, browser_id) do update
    set player_id = excluded.player_id,
        updated_at = now();

  return public.get_public_final_four_poll(p_match_id, p_browser_id);
end;
$$;

create or replace function private.lock_final_four_poll_on_live_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_season_id text;
begin
  select match.season_id into selected_season_id
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = new.match_id
    and match.competition_stage = 'final_four'
  for update of season;
  return new;
end;
$$;

drop trigger if exists live_match_sessions_lock_final_four_poll
  on public.live_match_sessions;
create trigger live_match_sessions_lock_final_four_poll
before insert on public.live_match_sessions
for each row execute function private.lock_final_four_poll_on_live_start();

revoke all on function private.lock_final_four_poll_on_live_start()
  from public, anon, authenticated;
revoke all on function public.get_public_final_four_poll(text,uuid) from public;
revoke all on function public.submit_final_four_vote(text,text,uuid) from public;
grant execute on function public.get_public_final_four_poll(text,uuid) to anon, authenticated;
grant execute on function public.submit_final_four_vote(text,text,uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
