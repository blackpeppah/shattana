import { joinChallengeAction } from '../../options';

const testSiteKey = '1x00000000000000000000AA';
const testSecretKey = '1x0000000000000000000000000000000AA';

export function challengeConfig() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const required = Boolean(process.env.VERCEL || siteKey || secret);
  const testing = !process.env.VERCEL && siteKey === testSiteKey && secret === testSecretKey;
  const ready = Boolean(siteKey && secret && (!process.env.VERCEL ||
    (!/^\d[xX]0{8}/.test(siteKey) && !/^\d[xX]0{8}/.test(secret))));
  return { required, siteKey: ready ? siteKey : undefined, secret: ready ? secret : undefined, testing };
}

export async function verifyJoinChallenge(token: string, hostname: string, secret: string, testing: boolean) {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token }),
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Turnstile verification is unavailable');
  const result = await response.json();
  return result.success === true && (testing ||
    (result.action === joinChallengeAction && result.hostname === hostname));
}
