begin;

do $migration$
declare
  function_signature constant regprocedure :=
    'public.create_training_session(date,time without time zone,text[],jsonb,jsonb)'::regprocedure;
  current_definition text;
  fixed_definition text;
  unsupported_expression constant text := 'jsonb_object_length(normalized_guest_names)';
  supported_expression constant text :=
    '(select count(*) from jsonb_object_keys(normalized_guest_names))';
begin
  select pg_get_functiondef(function_signature)
  into current_definition;

  if position(unsupported_expression in current_definition) = 0 then
    if position(supported_expression in current_definition) = 0 then
      raise exception 'Die Trainingsfunktion enthält nicht die erwartete Gastzählung.';
    end if;
    return;
  end if;

  fixed_definition := replace(
    current_definition,
    unsupported_expression,
    supported_expression
  );
  execute fixed_definition;
end;
$migration$;

commit;
