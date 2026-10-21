begin;

-- Admin-Trainings werden wie Admin-Ergebnisse unmittelbar offiziell.
do $migration$
declare
  function_signature constant regprocedure :=
    'public.create_training_session(date,time without time zone,text[],jsonb,jsonb)'::regprocedure;
  current_definition text;
  original_ending constant text := E'  end loop;\n\n  return new_session_id;\nend;';
  admin_ending constant text := E'  end loop;\n\n'
    || E'  if current_profile.app_role = ''admin'' then\n'
    || E'    update public.training_sessions\n'
    || E'    set status = ''confirmed'', confirmed_by = current_user_id, confirmed_at = now()\n'
    || E'    where id = new_session_id;\n'
    || E'  end if;\n\n'
    || E'  return new_session_id;\nend;';
begin
  select pg_get_functiondef(function_signature)
  into current_definition;

  if position(admin_ending in current_definition) > 0 then
    return;
  end if;

  if position(original_ending in current_definition) = 0 then
    raise exception 'Die Trainingsfunktion enthält nicht das erwartete Funktionsende.';
  end if;

  execute replace(current_definition, original_ending, admin_ending);
end;
$migration$;

commit;
