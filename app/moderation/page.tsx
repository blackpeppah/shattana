import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Dashboard } from './dashboard';
import { moderationHostAllowed, moderatorCookie, validModeratorSession } from './session';

export default async function Moderation({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  if (!moderationHostAllowed((await headers()).get('host'))) notFound();
  const session = (await cookies()).get(moderatorCookie)?.value;
  if (!validModeratorSession(session)) redirect('/admin');
  return <Dashboard sectionName={(await searchParams).section} />;
}
