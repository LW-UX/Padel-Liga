select jsonb_build_object(
  'jobs', coalesce((
    select jsonb_agg(to_jsonb(job_row))
    from (
      select jobid, jobname, schedule, active
      from cron.job
      where jobname = 'send-match-notifications'
    ) as job_row
  ), '[]'::jsonb),
  'recentRuns', coalesce((
    select jsonb_agg(to_jsonb(run_row))
    from (
      select status, start_time, end_time, return_message
      from cron.job_run_details
      where jobid in (
        select jobid from cron.job where jobname = 'send-match-notifications'
      )
      order by start_time desc
      limit 5
    ) as run_row
  ), '[]'::jsonb)
) as cron_state;
