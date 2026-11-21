import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextRequest } from 'next/server';

export const moderatorCookie = 'shattana_moderator';
const sessionAge = 4 * 60 * 60;
const derivePassword = promisify(scrypt);

export function moderatorCredentials() {
  const username = process.env.MODERATION_USERNAME?.trim();
  const passwordHash = process.env.MODERATION_PASSWORD_HASH?.trim();
  const secret = process.env.MODERATION_SESSION_SECRET?.trim();
  if (!username || username.length > 128 || !passwordHash ||
    !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash) || !secret || secret.length < 32) return;
  const [salt, hash] = passwordHash.split(':');
  const sessionKey = createHmac('sha256', secret).update(JSON.stringify([username, passwordHash])).digest();
  return { username, salt, hash, sessionKey };
}

function matchesSecret(candidate: string, expected: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

export async function verifyModeratorPassword(
  credentials: NonNullable<ReturnType<typeof moderatorCredentials>>, username: unknown, password: unknown,
) {
  if (typeof username !== 'string' || username.length > 128 || typeof password !== 'string' || password.length > 256) return false;
  const hash = await derivePassword(password, Buffer.from(credentials.salt, 'hex'), 64) as Buffer;
  const validPassword = timingSafeEqual(hash, Buffer.from(credentials.hash, 'hex'));
  return matchesSecret(username.trim(), credentials.username) && validPassword;
}

export function moderationHostAllowed(host: string | null) {
  const configured = process.env.MODERATION_HOST?.trim().toLowerCase();
  if (!configured) return true;
  const allowed = configured === 'vercel-branch' ? process.env.VERCEL_BRANCH_URL?.trim().toLowerCase() : configured;
  return Boolean(allowed) && host?.toLowerCase().replace(/:\d+$/, '') === allowed;
}

export function moderatorHttps(req: NextRequest) {
  return req.nextUrl.protocol === 'https:' ||
    Boolean(process.env.VERCEL && req.headers.get('x-forwarded-proto') === 'https');
}

export function moderatorTransport(req: NextRequest) {
  return moderatorHttps(req) ||
    (!process.env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname));
}

export function moderatorSameOrigin(req: NextRequest) {
  const protocol = moderatorHttps(req) ? 'https' : 'http';
  return req.headers.get('origin') === `${protocol}://${req.headers.get('host') ?? req.nextUrl.host}` &&
    req.headers.get('sec-fetch-site') !== 'cross-site';
}

function sign(value: string, secret: Buffer) {
  return createHmac('sha256', secret).update('shattana-moderator:' + value).digest('base64url');
}

export function issueModeratorSession(secret: Buffer) {
  const value = `${Math.floor(Date.now() / 1000) + sessionAge}.${randomBytes(16).toString('hex')}`;
  return `${value}.${sign(value, secret)}`;
}

export function validModeratorSession(value: string | undefined, secret = moderatorCredentials()?.sessionKey) {
  if (!secret || !value || !/^\d{10}\.[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [expires, nonce, signature] = value.split('.');
  return Number(expires) > Math.floor(Date.now() / 1000) &&
    matchesSecret(signature, sign(`${expires}.${nonce}`, secret));
}

export function moderatorCookieOptions(req: NextRequest, maxAge = sessionAge) {
  return { httpOnly: true, secure: moderatorHttps(req), sameSite: 'strict' as const, path: '/', maxAge };
}
