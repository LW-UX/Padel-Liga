-- Kurzinfos für Winter 2026 und kein Tippspiel in dieser Saison.
-- Beide Saison-IDs, damit die Migration vor und nach der ID-Vereinheitlichung greift.
update public.seasons
set
  short_info = array[
    'Jeder Teilnehmer hat 6 Partien.',
    'Partner und Gegner werden jede Partie neu gelost.',
    'Es gibt kein fixes Datum, sondern Zeitfenster. Die Spieler stimmen sich selbst ab.',
    'Eine Partie hat 2 Gewinnsätze, bei 1:1 entscheidet der Match-Tie-Break bis 10 Punkte.',
    'Die Top 8 nach jeweils 6 Partien qualifizieren sich für das Halbfinale.',
    'Die vier Spieler der beiden siegreichen Halbfinalteams spielen im Final Four um den Titel.'
  ],
  predictions_enabled = false
where id in ('winter-2026', '2026-winter');

do $$
begin
  if not exists (
    select 1
    from public.seasons
    where id in ('winter-2026', '2026-winter')
      and not predictions_enabled
      and cardinality(short_info) = 6
  ) then
    raise exception 'Winter 2026 wurde nicht aktualisiert.';
  end if;
end;
$$;
