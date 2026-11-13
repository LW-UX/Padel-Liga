-- Nutzerangaben vom 13.11.2026; erst nach ausdrücklicher Datenbankfreigabe ausführen.
-- Die ersten beiden Aufschläger je Satz bestimmen die Viererrotation.
-- Partie 9 enthält die vom Nutzer ergänzte abschließende 6:3.
begin;
do $import$
declare
  entry jsonb; m public.matches; roster jsonb; author uuid; part jsonb; parsed text[]; i integer;
  payload jsonb := $histories$[
  {
    "matchId": "winter-2026-partie-1",
    "result": "6:4, 6:0",
    "players": [
      [
        "ludwig_w",
        1,
        1
      ],
      [
        "florian_z",
        1,
        2
      ],
      [
        "luca_w",
        2,
        1
      ],
      [
        "christoph_l",
        2,
        2
      ]
    ],
    "sections": [
      {
        "winners": [
          2,
          1,
          1,
          2,
          2,
          2,
          1,
          1,
          1,
          1
        ],
        "servers": [
          "florian_z",
          "christoph_l",
          "ludwig_w",
          "luca_w",
          "florian_z",
          "christoph_l",
          "ludwig_w",
          "luca_w",
          "florian_z",
          "christoph_l"
        ],
        "points": []
      },
      {
        "winners": [
          1,
          1,
          1,
          1,
          1,
          1
        ],
        "servers": [
          "luca_w",
          "ludwig_w",
          "christoph_l",
          "florian_z",
          "luca_w",
          "ludwig_w"
        ],
        "points": []
      }
    ]
  },
  {
    "matchId": "winter-2026-partie-9",
    "result": "6:2, 6:3",
    "players": [
      [
        "jonas_l",
        1,
        1
      ],
      [
        "ludwig_w",
        1,
        2
      ],
      [
        "andreas_l",
        2,
        1
      ],
      [
        "chris_m",
        2,
        2
      ]
    ],
    "sections": [
      {
        "winners": [
          1,
          1,
          1,
          1,
          1,
          2,
          2,
          1
        ],
        "servers": [
          "chris_m",
          "ludwig_w",
          "andreas_l",
          "jonas_l",
          "chris_m",
          "ludwig_w",
          "andreas_l",
          "jonas_l"
        ],
        "points": []
      },
      {
        "winners": [
          1,
          1,
          2,
          1,
          1,
          1,
          2,
          2,
          1
        ],
        "servers": [
          "chris_m",
          "ludwig_w",
          "andreas_l",
          "jonas_l",
          "chris_m",
          "ludwig_w",
          "andreas_l",
          "jonas_l",
          "chris_m"
        ],
        "points": []
      }
    ]
  }
]$histories$::jsonb;
begin
  select p.id into author from public.profiles p join auth.users u on u.id=p.id
    where p.player_id='ludwig_w' and p.app_role='admin' and u.email_confirmed_at is not null;
  if author is null then raise exception 'Das bestätigte Admin-Konto von Ludwig W. fehlt.'; end if;
  for entry in select value from jsonb_array_elements(payload) loop
    select * into m from public.matches where id=entry->>'matchId' for update;
    select jsonb_agg(jsonb_build_array(player_id,team,position) order by team,position) into roster
      from public.match_players where match_id=m.id;
    if m.id is null or m.result_details is distinct from entry->>'result' or m.competition_stage is distinct from 'league'
      or m.match_type <> 'season' or m.cancelled_at is not null or m.winner is distinct from 1::smallint
      or m.actual_sets is distinct from '2:0' or roster is distinct from entry->'players' then
      raise exception 'Ergebnis oder Besetzung von % stimmt nicht mehr mit dem vorbereiteten Verlauf überein.',entry->>'matchId';
    end if;
    if exists(select 1 from private.league_match_history where match_id=m.id) then
      raise exception 'Für % existiert bereits ein Verlauf; Import abgebrochen.',m.id;
    end if;
    perform private.validate_result_for_format(m.format,m.result_details,m.actual_sets,m.winner);
    for i in 0..1 loop
      part:=entry->'sections'->i;
      parsed:=regexp_match(split_part(m.result_details,',',i+1),'(\d+):([0-9]+)');
      perform private.validate_history_sequence(part->'winners',parsed[1]::integer,parsed[2]::integer,null);
    end loop;
    insert into private.league_match_history(match_id,version,sections,result_snapshot,players_snapshot,reason,created_by)
      values(m.id,1,entry->'sections',m.result_details,roster,
        'Vom Nutzer am 13.11.2026 mitgeteilte Spielgewinne und erste Aufschläger; weitere Aufschläger nach regulärer Rotation.',author);
  end loop;
end;
$import$;
commit;
