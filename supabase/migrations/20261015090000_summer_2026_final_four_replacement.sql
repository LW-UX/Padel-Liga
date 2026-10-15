begin;

-- Keep the original qualifier's facts without freezing the four active
-- finalists before their first match. This record is private and season-bound.
create table public.final_four_replacements (
  season_id text primary key references public.seasons(id)
    on update cascade on delete cascade,
  original_player_id text not null references public.players(id),
  replacement_player_id text not null references public.players(id),
  original_prematch_facts jsonb not null,
  replaced_at timestamptz not null default now()
);
alter table public.final_four_replacements enable row level security;
revoke all on public.final_four_replacements from public, anon, authenticated;

do $$
declare
  summer_id text;
  original_facts jsonb;
  marco_facts jsonb;
begin
  select season.id into summer_id
  from public.seasons as season
  where season.id in ('2026', '2026-sommer')
    and season.label = 'Sommer 2026'
  for update;
  if summer_id is null then
    raise exception 'Sommer 2026 wurde nicht eindeutig gefunden.';
  end if;

  if not exists (
    select 1 from private.season_player_statistics as stats
    where stats.season_id = summer_id
      and stats.league_id = 'main'
      and stats.rank = 5
      and stats.player_id = 'ludwig_w'
  ) then
    raise exception 'Ludwig W. steht nicht auf Ligaplatz 5.';
  end if;

  if (
    select count(*) from public.season_tournament_players as finalist
    where finalist.season_id = summer_id and finalist.stage = 'final_four'
  ) <> 4 or not exists (
    select 1 from public.season_tournament_players as finalist
    where finalist.season_id = summer_id and finalist.stage = 'final_four'
      and finalist.seed = 1 and finalist.player_id = 'marco_m'
      and finalist.league_rank = 1
  ) then
    raise exception 'Die ursprüngliche Final-Four-Besetzung stimmt nicht mehr.';
  end if;

  if (
    select count(*) from public.matches as match
    where match.season_id = summer_id
      and match.competition_stage = 'final_four'
      and match.cancelled_at is null
      and match.actual_sets is null
      and match.winner is null
  ) <> 3 or exists (
    select 1 from public.matches as match
    where match.season_id = summer_id
      and match.competition_stage = 'final_four'
      and (match.cancelled_at is not null
        or match.actual_sets is not null or match.winner is not null)
  ) then
    raise exception 'Die drei Final-Four-Partien sind nicht mehr vollständig offen.';
  end if;

  if exists (
    select 1 from public.result_proposals as proposal
    join public.matches as match on match.id = proposal.match_id
    where match.season_id = summer_id and match.competition_stage = 'final_four'
  ) or exists (
    select 1 from public.live_match_sessions as session
    join public.matches as match on match.id = session.match_id
    where match.season_id = summer_id and match.competition_stage = 'final_four'
  ) or exists (
    select 1 from public.final_four_prematch_snapshots as snapshot
    where snapshot.season_id = summer_id
  ) then
    raise exception 'Das Final Four wurde bereits begonnen oder eingefroren.';
  end if;

  -- A vote for the withdrawn player would require a separate vote decision.
  if exists (
    select 1 from public.final_four_poll_votes as vote
    where vote.season_id = summer_id and vote.player_id = 'marco_m'
  ) then
    raise exception 'Für Marco M. liegen bereits Final-Four-Stimmen vor.';
  end if;

  original_facts := private.build_final_four_prematch_facts(
    summer_id, now(), 'season-2026-partie-28'
  );
  select player.value into marco_facts
  from jsonb_array_elements(coalesce(original_facts -> 'players', '[]'::jsonb))
    as player(value)
  where player.value ->> 'playerId' = 'marco_m';
  if marco_facts is null then
    raise exception 'Marcos Prematch-Fakten konnten nicht gesichert werden.';
  end if;

  insert into public.final_four_replacements (
    season_id, original_player_id, replacement_player_id, original_prematch_facts
  ) values (summer_id, 'marco_m', 'ludwig_w', marco_facts);

  update public.season_tournament_players as finalist
  set player_id = 'ludwig_w', league_rank = 5, qualified_at = now()
  where finalist.season_id = summer_id and finalist.stage = 'final_four'
    and finalist.seed = 1 and finalist.player_id = 'marco_m';
  if not found then raise exception 'Der Final-Four-Platz wurde nicht ersetzt.'; end if;

  update public.match_players as member
  set player_id = 'ludwig_w'
  from public.matches as match
  where match.id = member.match_id
    and match.season_id = summer_id
    and match.competition_stage = 'final_four'
    and member.player_id = 'marco_m';
  if (select count(*) from public.match_players as member
      join public.matches as match on match.id = member.match_id
      where match.season_id = summer_id
        and match.competition_stage = 'final_four'
        and member.player_id = 'ludwig_w') <> 3 then
    raise exception 'Ludwig W. wurde nicht in alle drei Partien eingesetzt.';
  end if;

  update public.matches as match
  set team_one_label = (
        select string_agg(player.display_name, ' / ' order by member.position)
        from public.match_players as member
        join public.players as player on player.id = member.player_id
        where member.match_id = match.id and member.team = 1
      ),
      team_two_label = (
        select string_agg(player.display_name, ' / ' order by member.position)
        from public.match_players as member
        join public.players as player on player.id = member.player_id
        where member.match_id = match.id and member.team = 2
      ),
      updated_at = now()
  where match.season_id = summer_id
    and match.competition_stage = 'final_four';

  -- Marco keeps the award for reaching the Final Four; Ludwig joins him as
  -- its actual participant.
  perform private.award_final_four_players(summer_id);
end;
$$;

alter function public.get_public_final_four_overview(text) set schema private;
alter function private.get_public_final_four_overview(text)
  rename to get_public_final_four_overview_base;

create function public.get_public_final_four_overview(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.get_public_final_four_overview_base(p_match_id) as payload
  ), replacement as (
    select history.*
    from public.final_four_replacements as history
    join public.matches as match on match.season_id = history.season_id
    where match.id = p_match_id
  )
  select case
    when base.payload is null or replacement.season_id is null then base.payload
    else jsonb_set(base.payload, '{players}', (
      select jsonb_agg(player.facts order by player.league_rank, player.player_id)
      from (
        select (replacement.original_prematch_facts
          || jsonb_build_object('titleForecast', null, 'participationStatus', 'withdrawn'))
            as facts,
          (replacement.original_prematch_facts ->> 'leagueRank')::integer as league_rank,
          replacement.original_player_id as player_id
        union all
        select case
            when active.value ->> 'playerId' = replacement.replacement_player_id
              then active.value || jsonb_build_object(
                'participationStatus', 'replacement',
                'replacesDisplayName', replacement.original_prematch_facts ->> 'displayName'
              )
            else active.value
          end,
          (active.value ->> 'leagueRank')::integer,
          active.value ->> 'playerId'
        from jsonb_array_elements(base.payload -> 'players') as active(value)
      ) as player
    ))
  end
  from base
  left join replacement on true;
$$;

revoke all on function private.get_public_final_four_overview_base(text)
  from public, anon, authenticated;
revoke all on function public.get_public_final_four_overview(text) from public;
grant execute on function public.get_public_final_four_overview(text) to anon, authenticated;

alter function public.get_public_final_four_poll(text, uuid) set schema private;
alter function private.get_public_final_four_poll(text, uuid)
  rename to get_public_final_four_poll_base;

create function public.get_public_final_four_poll(p_match_id text, p_browser_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.get_public_final_four_poll_base(p_match_id, p_browser_id) as payload
  )
  select case when base.payload is null then null else jsonb_set(
    base.payload, '{options}', coalesce((
      select jsonb_agg(option.value order by finalist.league_rank, finalist.seed)
      from jsonb_array_elements(base.payload -> 'options') as option(value)
      join public.matches as match on match.id = p_match_id
      join public.season_tournament_players as finalist
        on finalist.season_id = match.season_id
       and finalist.stage = 'final_four'
       and finalist.player_id = option.value ->> 'playerId'
    ), '[]'::jsonb)
  ) end
  from base;
$$;

revoke all on function private.get_public_final_four_poll_base(text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_public_final_four_poll(text, uuid) from public;
grant execute on function public.get_public_final_four_poll(text, uuid) to anon, authenticated;

-- The replacement occupies Marco's pairing slot (seed 1), but league rank 5
-- decides a complete sporting tie. For all existing finalists these values
-- already coincide.
create or replace function private.award_tournament_winner(p_season_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_count integer;
  completed_count integer;
  winner_player_id text;
  default_league_id text;
  season_label text;
begin
  select count(*), count(*) filter (where match.actual_sets is not null and match.winner is not null)
  into final_count, completed_count
  from public.matches as match
  where match.season_id = p_season_id and match.competition_stage = 'final_four';
  if final_count <> 3 or completed_count <> 3 then return; end if;

  with finalist_stats as (
    select
      finalist.player_id,
      finalist.league_rank,
      count(*) filter (where match.winner = member.team)::integer as wins,
      coalesce(sum(case member.team when 1 then score.team_one else score.team_two end), 0)::integer as games_won,
      coalesce(sum(case member.team when 1 then score.team_one - score.team_two else score.team_two - score.team_one end), 0)::integer as game_diff
    from public.season_tournament_players as finalist
    join public.match_players as member on member.player_id = finalist.player_id
    join public.matches as match
      on match.id = member.match_id
     and match.season_id = finalist.season_id
     and match.competition_stage = 'final_four'
    cross join lateral (
      select (score_parts.capture)[1]::integer as team_one, (score_parts.capture)[2]::integer as team_two
      from regexp_matches(match.result_details, '([0-9]+)\s*:\s*([0-9]+)', 'g') as score_parts(capture)
      limit 1
    ) as score
    where finalist.season_id = p_season_id and finalist.stage = 'final_four'
    group by finalist.player_id, finalist.league_rank
  )
  select finalist.player_id into winner_player_id
  from finalist_stats as finalist
  order by finalist.wins desc, finalist.game_diff desc, finalist.games_won desc,
    finalist.league_rank, finalist.player_id
  limit 1;

  if winner_player_id is null then return; end if;
  select league.id, season.label into default_league_id, season_label
  from public.seasons as season
  join public.leagues as league on league.season_id = season.id and league.is_default
  where season.id = p_season_id;

  insert into public.player_achievements (
    player_id, season_id, league_id, kind, title, subtitle, achieved_on, priority
  )
  select winner_player_id, p_season_id, default_league_id, 'winner', 'Gewinner',
    'Padel-Liga ' || season_label, null, 200
  where not exists (
    select 1 from public.player_achievements as achievement
    where achievement.player_id = winner_player_id
      and achievement.season_id = p_season_id
      and achievement.league_id = default_league_id
      and achievement.kind = 'winner'
  );
end;
$$;

commit;
