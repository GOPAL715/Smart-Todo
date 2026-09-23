/*
# Enable the scheduling and outbound-HTTP extensions

1. Purpose
   SmartTodo needs a server-side scheduler so reminder notifications are produced
   without any browser open and without a signed-in user. Two PostgreSQL extensions
   provide that on this platform:
   - `pg_cron`  — runs SQL on a recurring schedule inside the database.
   - `pg_net`   — lets SQL make asynchronous outbound HTTPS calls.

   Together they let the database call the `process-reminders` edge function on a
   timer. Nothing in the browser participates.

2. Changes
   - Enable `pg_cron` (scheduling).
   - Enable `pg_net` (outbound HTTPS).

3. Notes
   1. Both `CREATE EXTENSION IF NOT EXISTS` statements are idempotent, so this
      migration is safe to re-run.
   2. `pg_net` performs the HTTP call asynchronously; the response is stored in
      `net._http_response` and can be inspected for diagnostics.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
