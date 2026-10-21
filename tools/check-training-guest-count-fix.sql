select
  position(
    'jsonb_object_length(normalized_guest_names)'
    in pg_get_functiondef(
      'public.create_training_session(date,time without time zone,text[],jsonb,jsonb)'::regprocedure
    )
  ) = 0 as unsupported_call_removed,
  position(
    '(select count(*) from jsonb_object_keys(normalized_guest_names))'
    in pg_get_functiondef(
      'public.create_training_session(date,time without time zone,text[],jsonb,jsonb)'::regprocedure
    )
  ) > 0 as supported_count_installed;
