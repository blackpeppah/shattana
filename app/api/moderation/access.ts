import { NextRequest, NextResponse } from 'next/server';
import type { Query } from '../../../db/store';
import { moderatorCookie, moderatorCredentials, moderatorSameOrigin, moderatorTransport,
  validModeratorSession } from '../../moderation/session';

export const moderationReply = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const reportId = (id: unknown): id is string => typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id) &&
  BigInt(id) <= BigInt('9223372036854775807');

export function moderationDenied(req: NextRequest, write: boolean) {
  const credentials = moderatorCredentials();
  if (!credentials) return moderationReply({ error: 'Moderation is unavailable.' }, 404);
  if (!moderatorTransport(req)) return moderationReply({ error: 'Use HTTPS to access moderation.' }, 403);
  if (!validModeratorSession(req.cookies.get(moderatorCookie)?.value, credentials.sessionKey)) {
    return moderationReply({ error: 'Sign in to access moderation.' }, 401);
  }
  if (write && !moderatorSameOrigin(req)) return moderationReply({ error: 'Invalid request origin.' }, 403);
}

export async function setGuestSuspension(query: Query, id: unknown, suspended: boolean) {
  const [guest] = await query(`update guest set
    suspended_at=case when $2 then coalesce(suspended_at,now()) else null end, queued_at=null
    where id=$1 and ((session_ended_at is null and deleted_at is null) or (not $2 and suspended_at is not null))
    returning id, to_jsonb(guest)->>'browser_id' as browser`, [id, suspended]);
  if (guest && suspended) {
    if (guest.browser) {
      const linked = await query<{ id: string }>('update guest set queued_at=null where browser_id=$1 returning id', [guest.browser]);
      await query('update chat set closed=true, ended_at=now() where not closed and not matched and (a=any($1::uuid[]) or b=any($1::uuid[]))',
        [linked.map(row => row.id)]);
    } else {
      await query('update chat set closed=true, ended_at=now() where not closed and not matched and (a=$1 or b=$1)', [id]);
    }
  }
  return Boolean(guest);
}
