import { NextRequest, NextResponse } from 'next/server';
import { issueModeratorSession, moderatorCookie, moderatorCookieOptions, moderatorSameOrigin,
  moderationHostAllowed, moderatorCredentials, moderatorTransport, verifyModeratorPassword } from '../../../moderation/session';
import { moderationReply as reply } from '../access';
import { transact } from '../../../../db/store';
import { allowAttempt, connectionSubject } from '../../safety';

function invalidRequest(req: NextRequest) {
  if (!moderationHostAllowed(req.headers.get('host'))) return reply({ error: 'Not found.' }, 404);
  if (!moderatorTransport(req)) return reply({ error: 'Use HTTPS to access moderation.' }, 403);
  if (!moderatorSameOrigin(req)) return reply({ error: 'Invalid request origin.' }, 403);
}

export async function POST(req: NextRequest) {
  const invalid = invalidRequest(req);
  if (invalid) return invalid;
  const credentials = moderatorCredentials();
  if (!credentials) return reply({ error: 'Moderation is unavailable.' }, 404);
  const input = await req.json().catch(() => null);
  try {
    const allowed = await transact(true, query => allowAttempt(query, 'moderator-login',
      connectionSubject(req, credentials.sessionKey), 300, 10));
    if (!allowed) return NextResponse.json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, {
      status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' },
    });
    if (!await verifyModeratorPassword(credentials, input?.username, input?.password)) {
      return reply({ error: 'Incorrect username or password.' }, 401);
    }
    const response = reply({ ok: true });
    response.cookies.set(moderatorCookie, issueModeratorSession(credentials.sessionKey), moderatorCookieOptions(req));
    return response;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Moderator sign-in error');
    return reply({ error: 'Sign-in is temporarily unavailable.' }, 503);
  }
}

export function DELETE(req: NextRequest) {
  const invalid = invalidRequest(req);
  if (invalid) return invalid;
  const response = reply({ ok: true });
  response.cookies.set(moderatorCookie, '', moderatorCookieOptions(req, 0));
  return response;
}
