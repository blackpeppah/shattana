import type { Metadata } from 'next';
import './style.css';

export const metadata: Metadata = {
  title: 'Shattana! | Hi lang anay.',
  description: 'Nickname-first random chat around BCD.',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
