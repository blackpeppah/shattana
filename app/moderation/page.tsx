import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Dashboard } from './dashboard';
import { moderatorCookie, validModeratorSession } from './session';

export default async function Moderation({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  const session = (await cookies()).get(moderatorCookie)?.value;
  if (!validModeratorSession(session)) redirect('/admin');
  return <Dashboard sectionName={(await searchParams).section} />;
}
