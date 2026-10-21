begin;

do $$
declare
  renamed_count integer;
begin
  if (
    select count(*)
    from public.players
    where id in ('ludi_gmail', 'ludi_gmx', 'ludi_ionos')
  ) <> 3 then
    raise exception 'Die drei erwarteten Testprofile sind nicht vollständig vorhanden.';
  end if;

  update public.players
  set
    display_name = case id
      when 'ludi_gmail' then 'Test Gmail'
      when 'ludi_gmx' then 'Test GMX'
      when 'ludi_ionos' then 'Test Ionos'
    end,
    initials = case id
      when 'ludi_gmail' then 'TGML'
      when 'ludi_gmx' then 'TGMX'
      when 'ludi_ionos' then 'TION'
    end
  where id in ('ludi_gmail', 'ludi_gmx', 'ludi_ionos');

  get diagnostics renamed_count = row_count;
  if renamed_count <> 3 then
    raise exception 'Es wurden nicht alle drei Testprofile umbenannt.';
  end if;
end;
$$;

update public.matches as match
set
  team_one_label = (
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
  )
where exists (
  select 1
  from public.match_players as member
  where member.match_id = match.id
    and member.player_id in ('ludi_gmail', 'ludi_gmx', 'ludi_ionos')
);

update public.final_four_prematch_snapshots as snapshot
set payload = jsonb_set(
  snapshot.payload,
  '{players}',
  (
    select jsonb_agg(
      jsonb_set(
        case player.value ->> 'playerId'
          when 'ludi_gmail' then jsonb_set(player.value, '{displayName}', to_jsonb('Test Gmail'::text))
          when 'ludi_gmx' then jsonb_set(player.value, '{displayName}', to_jsonb('Test GMX'::text))
          when 'ludi_ionos' then jsonb_set(player.value, '{displayName}', to_jsonb('Test Ionos'::text))
          else player.value
        end,
        '{relationships}',
        coalesce((
          select jsonb_agg(
            case relationship.value ->> 'playerId'
              when 'ludi_gmail' then jsonb_set(relationship.value, '{name}', to_jsonb('Test Gmail'::text))
              when 'ludi_gmx' then jsonb_set(relationship.value, '{name}', to_jsonb('Test GMX'::text))
              when 'ludi_ionos' then jsonb_set(relationship.value, '{name}', to_jsonb('Test Ionos'::text))
              else relationship.value
            end
            order by relationship.ordinality
          )
          from jsonb_array_elements(coalesce(player.value -> 'relationships', '[]'::jsonb))
            with ordinality as relationship(value, ordinality)
        ), '[]'::jsonb)
      )
      order by player.ordinality
    )
    from jsonb_array_elements(snapshot.payload -> 'players')
      with ordinality as player(value, ordinality)
  )
)
where exists (
  select 1
  from jsonb_array_elements(snapshot.payload -> 'players') as player(value)
  where player.value ->> 'playerId' in ('ludi_gmail', 'ludi_gmx', 'ludi_ionos')
);

commit;
