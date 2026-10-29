begin;

-- A withdrawn finalist stores one player fact object directly rather than the
-- overview payload with a players array. Enrich that frozen history in place.
update public.final_four_replacements as replacement
set original_prematch_facts = jsonb_set(
  replacement.original_prematch_facts,
  '{leagueHistory}',
  coalesce((
    select jsonb_agg(
      history.value || jsonb_build_object(
        'decidedByMatchTiebreak', coalesce(
          league_match.actual_sets in ('2:1', '1:2'),
          false
        )
      )
      order by history.ordinality
    )
    from jsonb_array_elements(replacement.original_prematch_facts -> 'leagueHistory')
      with ordinality as history(value, ordinality)
    left join public.matches as league_match
      on league_match.id = history.value ->> 'id'
  ), '[]'::jsonb),
  false
)
where jsonb_typeof(replacement.original_prematch_facts -> 'leagueHistory') = 'array';

commit;
