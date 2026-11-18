-- Supabase Cron setup. Run ONCE in the Supabase SQL editor after:
--   1. the migrations are applied,
--   2. the `deliver` Edge Function is deployed,
--   3. the Next.js app is deployed (for the reconcile job).
--
-- Secrets live in Supabase Vault, not in this file. Replace the three
-- placeholder values below in the SQL editor only; do not commit them.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Store secrets in Vault (run once; use vault.update_secret to change later)
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('https://YOUR-APP-DOMAIN', 'app_base_url');
select vault.create_secret('SAME-VALUE-AS-CRON_SECRET-ENV', 'cron_secret');

-- 2) Delivery: every minute, call the deliver Edge Function.
--    timeout is generous because one run may send for ~50 seconds.
select cron.schedule(
  'pigeon-deliver',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/deliver',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 58000
  );
  $$
);

-- 3) Payment reconciliation + checkout expiry: every 5 minutes, call the app.
select cron.schedule(
  'pigeon-reconcile-payments',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/cron/reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Useful checks
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select id, status_code, left(content, 300) from net._http_response order by id desc limit 20;
--   select * from public.scheduler_runs order by started_at desc limit 5;
--
-- Pause delivery in an emergency:
--   select cron.unschedule('pigeon-deliver');
