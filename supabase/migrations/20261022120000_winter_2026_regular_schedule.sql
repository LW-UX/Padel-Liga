begin;

-- Regulärer Ligaspielplan Winter 2026: einmalige seedbasierte Auslosung (Seed 20261022), unverändert übernommen.

do $$
declare
  winter_season_id text;
begin
  select id into winter_season_id
  from public.seasons
  where id in ('2026-winter', 'winter-2026');

  if winter_season_id is null then
    raise exception 'Die Saison Winter 2026 wurde nicht gefunden.';
  end if;

  if exists (
    select 1 from public.matches
    where season_id = winter_season_id and competition_stage = 'league'
  ) then
    raise exception 'Winter 2026 enthält bereits Ligapartien.';
  end if;

  if (
    select count(*) from public.season_players
    where season_id = winter_season_id and league_id = 'main'
  ) <> 20 then
    raise exception 'Winter 2026 enthält nicht genau 20 Teilnehmer.';
  end if;

  -- Halbfinale und Final Four folgen auf die sechs Ligaspieltage.
  update public.matches
  set matchday = case competition_stage when 'semifinal' then 7 else 8 end
  where season_id = winter_season_id
    and competition_stage in ('semifinal', 'final_four');

  insert into public.season_matchdays (season_id, matchday, starts_on, ends_on, title)
  select winter_season_id, matchday.matchday, matchday.starts_on, matchday.ends_on, matchday.title
  from (values
    (1, date '2026-11-02', date '2026-11-13', null),
    (2, date '2026-11-16', date '2026-11-27', null),
    (3, date '2026-11-30', date '2026-12-11', null),
    (4, date '2027-01-18', date '2027-01-29', null),
    (5, date '2027-02-01', date '2027-02-12', null),
    (6, date '2027-02-15', date '2027-02-26', null),
    (7, null::date, null::date, 'Halbfinale'),
    (8, null::date, null::date, 'Final Four')
  ) as matchday(matchday, starts_on, ends_on, title)
  on conflict (season_id, matchday) do update set
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    title = excluded.title;

  insert into public.matches (
    id, season_id, league_id, matchday, match_type, competition_stage, format,
    counts_for_ranking, counts_for_elo, team_one_label, team_two_label
  )
  select
    planned.id, winter_season_id, 'main', planned.matchday, 'season', 'league', 'best-of-three',
    true, true, planned.team_one_label, planned.team_two_label
  from (values
    ('winter-2026-partie-1', 1, 'Ludwig W. / Florian Z.', 'Luca W. / Christoph L.'),
    ('winter-2026-partie-2', 1, 'Leonie R. / Christian H.', 'Jonas L. / Agnes K.'),
    ('winter-2026-partie-3', 1, 'Chris M. / Raphael H.', 'Marcel M. / Niklas K.'),
    ('winter-2026-partie-4', 1, 'Lisa S. / Lukas P.', 'Marco M. / Lukas T.'),
    ('winter-2026-partie-5', 1, 'Andreas L. / Yonatan G.', 'Greta P. / Martin B.'),
    ('winter-2026-partie-6', 2, 'Marcel M. / Christoph L.', 'Greta P. / Luca W.'),
    ('winter-2026-partie-7', 2, 'Agnes K. / Lukas P.', 'Niklas K. / Raphael H.'),
    ('winter-2026-partie-8', 2, 'Florian Z. / Lisa S.', 'Martin B. / Christian H.'),
    ('winter-2026-partie-9', 2, 'Jonas L. / Ludwig W.', 'Andreas L. / Chris M.'),
    ('winter-2026-partie-10', 2, 'Yonatan G. / Marco M.', 'Lukas T. / Leonie R.'),
    ('winter-2026-partie-11', 3, 'Florian Z. / Lukas P.', 'Leonie R. / Marcel M.'),
    ('winter-2026-partie-12', 3, 'Marco M. / Lisa S.', 'Agnes K. / Greta P.'),
    ('winter-2026-partie-13', 3, 'Jonas L. / Andreas L.', 'Luca W. / Niklas K.'),
    ('winter-2026-partie-14', 3, 'Raphael H. / Lukas T.', 'Ludwig W. / Martin B.'),
    ('winter-2026-partie-15', 3, 'Chris M. / Yonatan G.', 'Christoph L. / Christian H.'),
    ('winter-2026-partie-16', 4, 'Martin B. / Marco M.', 'Chris M. / Niklas K.'),
    ('winter-2026-partie-17', 4, 'Leonie R. / Greta P.', 'Christian H. / Ludwig W.'),
    ('winter-2026-partie-18', 4, 'Luca W. / Lisa S.', 'Lukas P. / Yonatan G.'),
    ('winter-2026-partie-19', 4, 'Andreas L. / Agnes K.', 'Marcel M. / Lukas T.'),
    ('winter-2026-partie-20', 4, 'Jonas L. / Raphael H.', 'Christoph L. / Florian Z.'),
    ('winter-2026-partie-21', 5, 'Martin B. / Marcel M.', 'Marco M. / Christoph L.'),
    ('winter-2026-partie-22', 5, 'Lukas P. / Lukas T.', 'Christian H. / Jonas L.'),
    ('winter-2026-partie-23', 5, 'Raphael H. / Lisa S.', 'Andreas L. / Leonie R.'),
    ('winter-2026-partie-24', 5, 'Agnes K. / Luca W.', 'Greta P. / Chris M.'),
    ('winter-2026-partie-25', 5, 'Ludwig W. / Yonatan G.', 'Florian Z. / Niklas K.'),
    ('winter-2026-partie-26', 6, 'Marco M. / Agnes K.', 'Yonatan G. / Florian Z.'),
    ('winter-2026-partie-27', 6, 'Marcel M. / Christian H.', 'Niklas K. / Martin B.'),
    ('winter-2026-partie-28', 6, 'Greta P. / Ludwig W.', 'Lukas P. / Jonas L.'),
    ('winter-2026-partie-29', 6, 'Lisa S. / Andreas L.', 'Chris M. / Christoph L.'),
    ('winter-2026-partie-30', 6, 'Leonie R. / Raphael H.', 'Lukas T. / Luca W.')
  ) as planned(id, matchday, team_one_label, team_two_label);

  insert into public.match_players (match_id, player_id, team, position)
  values
    ('winter-2026-partie-1', 'ludwig_w', 1, 1),
    ('winter-2026-partie-1', 'florian_z', 1, 2),
    ('winter-2026-partie-1', 'luca_w', 2, 1),
    ('winter-2026-partie-1', 'christoph_l', 2, 2),
    ('winter-2026-partie-2', 'leonie_r', 1, 1),
    ('winter-2026-partie-2', 'christian_h', 1, 2),
    ('winter-2026-partie-2', 'jonas_l', 2, 1),
    ('winter-2026-partie-2', 'agnes_k', 2, 2),
    ('winter-2026-partie-3', 'chris_m', 1, 1),
    ('winter-2026-partie-3', 'raphael_h', 1, 2),
    ('winter-2026-partie-3', 'marcel_m', 2, 1),
    ('winter-2026-partie-3', 'niklas_k', 2, 2),
    ('winter-2026-partie-4', 'lisa_s', 1, 1),
    ('winter-2026-partie-4', 'lukas_p', 1, 2),
    ('winter-2026-partie-4', 'marco_m', 2, 1),
    ('winter-2026-partie-4', 'lukas_t', 2, 2),
    ('winter-2026-partie-5', 'andreas_l', 1, 1),
    ('winter-2026-partie-5', 'yonatan_g', 1, 2),
    ('winter-2026-partie-5', 'greta_p', 2, 1),
    ('winter-2026-partie-5', 'martin_b', 2, 2),
    ('winter-2026-partie-6', 'marcel_m', 1, 1),
    ('winter-2026-partie-6', 'christoph_l', 1, 2),
    ('winter-2026-partie-6', 'greta_p', 2, 1),
    ('winter-2026-partie-6', 'luca_w', 2, 2),
    ('winter-2026-partie-7', 'agnes_k', 1, 1),
    ('winter-2026-partie-7', 'lukas_p', 1, 2),
    ('winter-2026-partie-7', 'niklas_k', 2, 1),
    ('winter-2026-partie-7', 'raphael_h', 2, 2),
    ('winter-2026-partie-8', 'florian_z', 1, 1),
    ('winter-2026-partie-8', 'lisa_s', 1, 2),
    ('winter-2026-partie-8', 'martin_b', 2, 1),
    ('winter-2026-partie-8', 'christian_h', 2, 2),
    ('winter-2026-partie-9', 'jonas_l', 1, 1),
    ('winter-2026-partie-9', 'ludwig_w', 1, 2),
    ('winter-2026-partie-9', 'andreas_l', 2, 1),
    ('winter-2026-partie-9', 'chris_m', 2, 2),
    ('winter-2026-partie-10', 'yonatan_g', 1, 1),
    ('winter-2026-partie-10', 'marco_m', 1, 2),
    ('winter-2026-partie-10', 'lukas_t', 2, 1),
    ('winter-2026-partie-10', 'leonie_r', 2, 2),
    ('winter-2026-partie-11', 'florian_z', 1, 1),
    ('winter-2026-partie-11', 'lukas_p', 1, 2),
    ('winter-2026-partie-11', 'leonie_r', 2, 1),
    ('winter-2026-partie-11', 'marcel_m', 2, 2),
    ('winter-2026-partie-12', 'marco_m', 1, 1),
    ('winter-2026-partie-12', 'lisa_s', 1, 2),
    ('winter-2026-partie-12', 'agnes_k', 2, 1),
    ('winter-2026-partie-12', 'greta_p', 2, 2),
    ('winter-2026-partie-13', 'jonas_l', 1, 1),
    ('winter-2026-partie-13', 'andreas_l', 1, 2),
    ('winter-2026-partie-13', 'luca_w', 2, 1),
    ('winter-2026-partie-13', 'niklas_k', 2, 2),
    ('winter-2026-partie-14', 'raphael_h', 1, 1),
    ('winter-2026-partie-14', 'lukas_t', 1, 2),
    ('winter-2026-partie-14', 'ludwig_w', 2, 1),
    ('winter-2026-partie-14', 'martin_b', 2, 2),
    ('winter-2026-partie-15', 'chris_m', 1, 1),
    ('winter-2026-partie-15', 'yonatan_g', 1, 2),
    ('winter-2026-partie-15', 'christoph_l', 2, 1),
    ('winter-2026-partie-15', 'christian_h', 2, 2),
    ('winter-2026-partie-16', 'martin_b', 1, 1),
    ('winter-2026-partie-16', 'marco_m', 1, 2),
    ('winter-2026-partie-16', 'chris_m', 2, 1),
    ('winter-2026-partie-16', 'niklas_k', 2, 2),
    ('winter-2026-partie-17', 'leonie_r', 1, 1),
    ('winter-2026-partie-17', 'greta_p', 1, 2),
    ('winter-2026-partie-17', 'christian_h', 2, 1),
    ('winter-2026-partie-17', 'ludwig_w', 2, 2),
    ('winter-2026-partie-18', 'luca_w', 1, 1),
    ('winter-2026-partie-18', 'lisa_s', 1, 2),
    ('winter-2026-partie-18', 'lukas_p', 2, 1),
    ('winter-2026-partie-18', 'yonatan_g', 2, 2),
    ('winter-2026-partie-19', 'andreas_l', 1, 1),
    ('winter-2026-partie-19', 'agnes_k', 1, 2),
    ('winter-2026-partie-19', 'marcel_m', 2, 1),
    ('winter-2026-partie-19', 'lukas_t', 2, 2),
    ('winter-2026-partie-20', 'jonas_l', 1, 1),
    ('winter-2026-partie-20', 'raphael_h', 1, 2),
    ('winter-2026-partie-20', 'christoph_l', 2, 1),
    ('winter-2026-partie-20', 'florian_z', 2, 2),
    ('winter-2026-partie-21', 'martin_b', 1, 1),
    ('winter-2026-partie-21', 'marcel_m', 1, 2),
    ('winter-2026-partie-21', 'marco_m', 2, 1),
    ('winter-2026-partie-21', 'christoph_l', 2, 2),
    ('winter-2026-partie-22', 'lukas_p', 1, 1),
    ('winter-2026-partie-22', 'lukas_t', 1, 2),
    ('winter-2026-partie-22', 'christian_h', 2, 1),
    ('winter-2026-partie-22', 'jonas_l', 2, 2),
    ('winter-2026-partie-23', 'raphael_h', 1, 1),
    ('winter-2026-partie-23', 'lisa_s', 1, 2),
    ('winter-2026-partie-23', 'andreas_l', 2, 1),
    ('winter-2026-partie-23', 'leonie_r', 2, 2),
    ('winter-2026-partie-24', 'agnes_k', 1, 1),
    ('winter-2026-partie-24', 'luca_w', 1, 2),
    ('winter-2026-partie-24', 'greta_p', 2, 1),
    ('winter-2026-partie-24', 'chris_m', 2, 2),
    ('winter-2026-partie-25', 'ludwig_w', 1, 1),
    ('winter-2026-partie-25', 'yonatan_g', 1, 2),
    ('winter-2026-partie-25', 'florian_z', 2, 1),
    ('winter-2026-partie-25', 'niklas_k', 2, 2),
    ('winter-2026-partie-26', 'marco_m', 1, 1),
    ('winter-2026-partie-26', 'agnes_k', 1, 2),
    ('winter-2026-partie-26', 'yonatan_g', 2, 1),
    ('winter-2026-partie-26', 'florian_z', 2, 2),
    ('winter-2026-partie-27', 'marcel_m', 1, 1),
    ('winter-2026-partie-27', 'christian_h', 1, 2),
    ('winter-2026-partie-27', 'niklas_k', 2, 1),
    ('winter-2026-partie-27', 'martin_b', 2, 2),
    ('winter-2026-partie-28', 'greta_p', 1, 1),
    ('winter-2026-partie-28', 'ludwig_w', 1, 2),
    ('winter-2026-partie-28', 'lukas_p', 2, 1),
    ('winter-2026-partie-28', 'jonas_l', 2, 2),
    ('winter-2026-partie-29', 'lisa_s', 1, 1),
    ('winter-2026-partie-29', 'andreas_l', 1, 2),
    ('winter-2026-partie-29', 'chris_m', 2, 1),
    ('winter-2026-partie-29', 'christoph_l', 2, 2),
    ('winter-2026-partie-30', 'leonie_r', 1, 1),
    ('winter-2026-partie-30', 'raphael_h', 1, 2),
    ('winter-2026-partie-30', 'lukas_t', 2, 1),
    ('winter-2026-partie-30', 'luca_w', 2, 2);

  if exists (
    select 1
    from public.season_players as participant
    where participant.season_id = winter_season_id
      and (
        select count(*)
        from public.match_players as member
        join public.matches as match on match.id = member.match_id
        where match.season_id = winter_season_id
          and match.competition_stage = 'league'
          and member.player_id = participant.player_id
      ) <> 6
  ) then
    raise exception 'Nicht jeder Teilnehmer hat genau sechs Ligapartien.';
  end if;

  if exists (
    select 1
    from public.match_players as member
    join public.matches as match on match.id = member.match_id
    where match.season_id = winter_season_id
      and match.competition_stage = 'league'
      and not exists (
        select 1 from public.season_players as participant
        where participant.season_id = winter_season_id
          and participant.player_id = member.player_id
      )
  ) then
    raise exception 'Der Spielplan enthält Spieler außerhalb der Teilnehmerliste.';
  end if;

  update public.seasons
  set starts_on = date '2026-11-02',
      regular_schedule_locked = true
  where id = winter_season_id;
end;
$$;

commit;
