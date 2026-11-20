import type { NextRequest } from 'next/server';
import type { Query } from '../../../db/store';

export const guestCookie = 'shattana_guest';
export const browserCookie = 'shattana_browser';
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function sameGuestOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  return Boolean(origin && URL.canParse(origin) && new URL(origin).host === req.headers.get('host') &&
    req.headers.get('sec-fetch-site') !== 'cross-site');
}

export async function browserSuspended(query: Query, ...ids: unknown[]) {
  const browserIds = [...new Set(ids.filter(uuid))];
  if (!browserIds.length) return false;
  const [blocked] = await query('select 1 from guest where browser_id=any($1::uuid[]) and suspended_at is not null limit 1', [browserIds]);
  return Boolean(blocked);
}

export const barEligibility = `
  from guest g join guest me on me.id=$1
  where g.id<>me.id and g.bar_answer is not null and me.bar_answer is not null
  and to_jsonb(g)->>'session_ended_at' is null and to_jsonb(g)->>'suspended_at' is null
  and g.bar_age between me.bar_min_age and me.bar_max_age
  and me.bar_age between g.bar_min_age and g.bar_max_age
  and (me.bar_interest='Everyone' or me.bar_interest=g.bar_gender)
  and (g.bar_interest='Everyone' or g.bar_interest=me.bar_gender)
  and not exists (select 1 from block where (actor=me.id and target=g.id) or (actor=g.id and target=me.id))
  and not exists (select 1 from chat where matched and least(a,b)=least(me.id,g.id)
    and greatest(a,b)=greatest(me.id,g.id))
`;

export const barCardEligibility = `${barEligibility}
  and not exists (select 1 from bar_hi where sender=me.id and recipient=g.id)`;
