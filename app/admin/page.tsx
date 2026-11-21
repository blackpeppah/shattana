import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { moderationHostAllowed } from '../moderation/session';
import { AdminLogin } from './login';

export default async function AdminPage() {
  if (!moderationHostAllowed((await headers()).get('host'))) notFound();
  return <AdminLogin />;
}
