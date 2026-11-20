import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
import type { Query } from '../../db/store';

export function connectionSubject(req: NextRequest, secret: string | Buffer | undefined = process.env.RATE_LIMIT_SECRET || process.env.TURNSTILE_SECRET_KEY) {
  if (!process.env.VERCEL) return 'local';
  const address = req.headers.get('x-vercel-forwarded-for')?.trim();
  if (!secret || !address || !isIP(address)) throw new Error('Connection rate limiter is unavailable');
  return createHmac('sha256', secret).update(address).digest('hex');
}

export async function allowAttempt(query: Query, scope: string, subject: string, windowSeconds: number, maximum: number) {
  const [attempt] = await query(`insert into guest_rate_limit(scope,subject,bucket,expires_at)
    values($1,$2,floor(extract(epoch from now())/$3::integer),now()+make_interval(secs=>$3::integer))
    on conflict (scope,subject,bucket) do update set hits=guest_rate_limit.hits+1
    where guest_rate_limit.hits<$4 returning hits`, [scope, subject, windowSeconds, maximum]);
  return Boolean(attempt);
}
