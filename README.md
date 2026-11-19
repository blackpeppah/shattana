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

Open http://localhost:3000 in two separate browser profiles, or in a regular window and an incognito window. Join with different nicknames, tap **Find a Chat** in both, and send a message. Tap **Shoot Your Shot** in both windows and refresh. **Matches** should still contain the conversation.

Local mode uses an embedded PostgreSQL database in `.shattana-db/`. The guest cookie restores access in the same browser. Clearing the cookie loses access to that guest account. Unmatched chats expire after approximately 90 seconds of inactivity from either guest. Chat updates use short polling while a conversation or queue is active.

## Deploy a free-tier prototype

1. Create a Supabase Free project and run [db/schema.sql](db/schema.sql) in its SQL Editor.
2. Import this Next.js project into Vercel Hobby for personal, non-commercial use. Set the server-side `DATABASE_URL` to the Supabase transaction pooler connection string. Paste the downloaded Supabase CA PEM into `DATABASE_CA_CERT` if the certificate chain requires it. Shattana verifies the TLS certificate and hostname. The route needs a role that owns the tables or bypasses RLS. Keep the connection string out of source control.
3. Deploy and use the assigned `.vercel.app` address. The availability of `shattana.vercel.app` depends on Vercel.
4. Repeat the two-browser test against that deployment.

Before opening the deployment to guests, create a Cloudflare Turnstile widget and allowlist the deployment hostname. Add its `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Vercel. Existing sessions continue working while signup is unavailable if these keys are missing. For local testing against Supabase, use its session pooler and the CA from Database Settings. Local development without Turnstile keys uses the regular 18+ guest form.

For an existing deployment, rerun the schema before deploying updates. It adds timestamps for the chat cooldown and the limit of eight messages per guest per chat in ten seconds. Existing messages stay readable. For older chats with no recorded end time, the cooldown uses the creation time.

The application uses one same-origin API route. Review reports through the Supabase SQL Editor during a small pilot:

```sql
select r.id, r.created_at, r.reason, r.chat_id, g.nickname as reported_guest
from report r join guest g on g.id = r.target
order by r.created_at desc;
```

Reporting also blocks the guest and closes the conversation. Assign someone to handle reports before opening the pilot publicly. The guest cookie is the account identifier, so a fresh browser or cleared cookie can create a new identity. A public rollout needs stronger protections against repeat abuse.

Quick Chat pairs guests at random. Across the Bar uses a separate nickname card with a favorite hangout and prompt answer. Age, gender, and preferences are used privately to check compatibility both ways. A Say Hi is private until it’s mutual, then the chat appears in Matches. After Hours starts Fridays at 9 PM in Bacolod and uses the same Quick Chat queue.

The current build uses plain CSS and text only. It needs no SMS, email, video provider, paid API, or custom domain.
