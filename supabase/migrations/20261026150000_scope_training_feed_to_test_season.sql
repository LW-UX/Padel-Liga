begin;

create or replace function public.get_public_training_feed(p_test_mode boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with feed as (
    select
      session.id,
      session.status,
      session.played_on,
      session.display_time,
      private.training_session_at(session.played_on, session.display_time) as training_at,
      (
        select jsonb_agg(jsonb_build_object(
          'id', case when session.guest_names ? member.player_id then null else member.player_id end,
          'displayName', private.training_participant_display_name(member.player_id, session.guest_names),
          'isGuest', session.guest_names ? member.player_id
        ) order by member.ordinality)
        from unnest(session.player_ids) with ordinality as member(player_id, ordinality)
      ) as participants,
      (select count(*)::integer from public.training_rounds as round where round.session_id = session.id) as round_count,
      (
        select coalesce(sum((private.profile_training_metrics(round.result_details))[1]), 0)::integer
        from public.training_rounds as round where round.session_id = session.id
      ) as completed_set_count
    from public.training_sessions as session
    where (
        coalesce(p_test_mode, false)
        or not (session.player_ids && array['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net']::text[])
      )
      and (
        (session.status = 'scheduled'
          and private.training_session_at(session.played_on, session.display_time) > now())
        or session.status = 'confirmed'
      )
  ), upcoming as (
    select * from feed
    where status = 'scheduled'
    order by training_at, id
    limit 3
  ), recent as (
    select * from feed
    where status = 'confirmed'
    order by training_at desc, id desc
    limit 3
  )
  select jsonb_build_object(
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sessionId', item.id,
        'playedOn', item.played_on,
        'displayTime', to_char(item.display_time, 'HH24.MI'),
        'participants', item.participants,
        'roundCount', item.round_count,
        'completedSetCount', item.completed_set_count
      ) order by item.training_at, item.id)
      from upcoming as item
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sessionId', item.id,
        'playedOn', item.played_on,
        'displayTime', to_char(item.display_time, 'HH24.MI'),
        'participants', item.participants,
        'roundCount', item.round_count,
        'completedSetCount', item.completed_set_count
      ) order by item.training_at desc, item.id desc)
      from recent as item
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_public_training_feed()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_public_training_feed(false);
$$;

revoke execute on function public.get_public_training_feed(boolean) from public;
revoke execute on function public.get_public_training_feed() from public;
grant execute on function public.get_public_training_feed(boolean) to anon, authenticated;
grant execute on function public.get_public_training_feed() to anon, authenticated;

commit;
