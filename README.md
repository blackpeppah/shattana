# Shattana!

*Hi lang anay. Basi ikaw na.*

*Diin ta?*
Public, nickname-first random dating chat for adults around BCD. Guests self-attest that they are 18 or older. School is an optional self-entered label. An optional round or favorite spot supplies an icebreaker. Two private **Shoot Your Shot** taps save a conversation to **Matches**.

## Run locally for ₱0

Use Node.js 20.9 or newer.

```sh
npm ci
npm run dev
```

Run `npm test` to build and exercise two guest sessions against a temporary local database. The suite covers pairing, saved matches, safe sends, unread positions, meetup responses, reporting after Next, and earlier message pages.

Open http://localhost:3000 in two separate browser profiles, or in a regular window and an incognito window. Join with different nicknames, tap **Find a Chat** in both, and send a message. Tap **Shoot Your Shot** in both windows and refresh. **Matches** should still contain the conversation.

Local mode uses an embedded PostgreSQL database in `.shattana-db/`. The guest cookie restores access in the same browser. Clearing the cookie loses access to that guest account. Unmatched chats expire after approximately 90 seconds of inactivity from either guest. Chat updates use short polling while a conversation or queue is active.

## Deploy a free-tier prototype

1. Create a Supabase Free project and run [db/schema.sql](db/schema.sql) in its SQL Editor.
2. Import this Next.js project into Vercel Hobby for personal, non-commercial use. Set the server-side `DATABASE_URL` to the Supabase transaction pooler connection string. Paste the downloaded Supabase CA PEM into `DATABASE_CA_CERT` if the certificate chain requires it. Shattana verifies the TLS certificate and hostname. The route needs a role that owns the tables or bypasses RLS. Keep the connection string out of source control.
3. Deploy and use the assigned `.vercel.app` address. The availability of `shattana.vercel.app` depends on Vercel.
4. Repeat the two-browser test against that deployment.

Before opening the deployment to guests, create a Cloudflare Turnstile widget and allowlist the deployment hostname. Add its `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Vercel. Existing sessions continue working while signup is unavailable if these keys are missing. For local testing against Supabase, use its session pooler and the CA from Database Settings. Local development without Turnstile keys uses the regular 18+ guest form.

For an existing deployment, rerun the schema before deploying updates. It adds timestamps for the chat cooldown and the limit of eight messages per guest per chat in ten seconds. Existing messages stay readable. For older chats with no recorded end time, the cooldown uses the creation time.

### Optional profile photos

1. Run [db/schema.sql](db/schema.sql) to add the photo fields and file cleanup queue.
2. In the Supabase project, open **Storage → New bucket**. Name it `profile-photos`, keep it **Private**, limit files to **150 KB**, and allow only `image/webp`. Leave guest and public Storage policies unset. The server handles access using the app’s existing guest sessions.
3. Set `SUPABASE_URL` to the project URL and `SUPABASE_SECRET_KEY` to a server-only Supabase secret key (`sb_secret_…`). Use the same project as `DATABASE_URL`. Keep the key out of client code, `NEXT_PUBLIC_` variables, and source control. See [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) and [secret keys](https://supabase.com/docs/guides/getting-started/api-keys).

Without a remote database, local photos use `.shattana-photos/`. With a remote database and missing photo storage settings, guests can still use the app with initials. Photos are available on eligible Across the Bar cards. Quick Chat uses initials unless the guest turns on photo sharing. Photo links expire after 90 seconds. A previously issued Supabase link can remain usable through its expiry when sharing is switched off. Replacing or removing a photo retires the old file. The app retries failed Storage deletions from a cleanup queue on subsequent photo changes. Ending or deleting a guest session removes its photo. Say Hi allows eight attempts per minute per guest.

### Pilot moderation and privacy

1. Apply `db/schema.sql` and set `MODERATION_USERNAME`, `MODERATION_PASSWORD_HASH`, and a separate random `MODERATION_SESSION_SECRET` of at least 32 characters. The hash format is `salt:hash`, both in hex. Generate it with a random 16-byte salt and Node's `scryptSync(password, salt, 64)`. Share the username and password securely with the pilot moderator. Sign in at `/admin` via HTTPS or loopback during local testing. The session opens `/moderation` and lasts four hours or until sign-out. Changing the configured username, password hash, or signing secret invalidates existing sessions.
2. In **Reports**, start with **Pending**. Underage reports appear first. Choose **Open report** to see the reason, time, reported nickname, and any available conversation evidence. **Suspend guest** blocks the session and closes its open chats while the report stays pending. Choose **Mark reviewed** once your review is complete, or **Dismiss report** when no further action is needed. Use **Reviewed** and **Dismissed** to revisit cases and **Reopen report** to move a case back to Pending. Use **Refresh reports** to check for new cases.
3. Set up the daily job below to enforce retention.

Guests can report a chat for 15 minutes after it closes. Reporting blocks the guest, and the moderator can suspend that guest separately. A separate browser cookie blocks new guest signups in that browser after a suspension, including after the guest ends their session or deletes their data. Use **Guests → Reinstate** to lift the restriction. A deleted profile is listed as **Deleted guest** while suspended. Existing sessions link to the cookie on their next visit. The restriction depends on that cookie, which lasts up to a year. Clearing site data, switching browsers, or using a private window can bypass browser recognition. The pilot allows six completed signups per address per hour on Vercel and five Next Chat actions per guest per 30-second window. Signup throttling stores a keyed hash rather than the IP address. Use `RATE_LIMIT_SECRET` to set a separate hashing key. Local mode shares one signup bucket.

**Overview** refreshes every 10 seconds while visible. A guest counts as active if seen in the past 90 seconds. **Guests** lets you search nicknames and reinstate suspended sessions. **Venues** manages options for Quick Chat and meetup invitations in saved matches. Existing invites keep the venue name they were sent with.

The guest session controls revoke the browser credential. Ending a session closes its chats and removes access to its matches. Use **Delete my data** first if you want to remove the profile fields, authored messages, invitations and Say Hi records. Pending report evidence and limited safety records can remain under the retention schedule. School is no longer collected or included in chat responses.

Suspension ends active Quick Chats and hides the guest from discovery. Saved matches remain in place, with messaging and meetup invites paused for both participants. Reinstatement restores access to open saved matches. Chats already closed by a block, report, unmatch, deletion, or older suspension stay closed.

### Daily retention setup

Ordinary closed-chat messages and meetup invites are eligible for deletion after 30 days. A pending report protects evidence from the time of the report, up to 90 days after the chat closed. Reports expire 90 days after submission. A fake-photo report can retain the exact version shown for up to 90 days after submission while a case is pending. The report queue serves the photo to signed-in moderators only. Replacing or removing a photo retires that version from the profile. A recent card view can hold the old file for up to 15 minutes so the viewer can finish reporting it. Once the version is off the profile and its last hold ends, cleanup removes its file through the Storage API. Guest deletion uses the same evidence rules and keeps closed-chat records for rematch and moderation rules.

For one-time setup, install [db/schema.sql](db/schema.sql), then run [db/retention.sql](db/retention.sql) in the Supabase SQL Editor. The latter defines the job without executing cleanup. Configure your app with a separate random `RETENTION_SECRET` of at least 32 characters. Enable Cron and `pg_net` in Supabase. In Vault, create `shattana_app_url` with your HTTPS app origin and `shattana_retention_secret` with the same secret. Use the SQL Editor to schedule the job. This example runs daily at 19:00 UTC, which is 3:00 AM in Bacolod. Scheduling with the same name updates the job. [Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart)

```sql
select cron.schedule('shattana-retention', '0 19 * * *', $job$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='shattana_app_url'), '/') || '/api/retention',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='shattana_retention_secret')),
    timeout_milliseconds := 60000
  );
$job$);
```

Replace the old scheduled SQL cleanup job if you installed it earlier. Check the app response in `net._http_response` using the request ID. A `200` confirms completion. A Storage error leaves files queued for retry during the next run or eligible photo operation. Use the private bucket credentials for Storage cleanup and keep Vault secrets server-side. [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)

Quick Chat pairs guests at random. Guests who chatted without matching can meet again two minutes after their chat ends. Across the Bar uses a separate nickname card with a favorite hangout and prompt answer. Age, gender, and preferences are used privately to check compatibility both ways. A Say Hi is private until it’s mutual, then the chat appears in Matches. After Hours starts Fridays at 9 PM in Bacolod and uses the same Quick Chat queue.

The current build uses plain CSS and text only. It needs no SMS, email, video provider, paid API, or custom domain.
