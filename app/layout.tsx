import type { Metadata, Viewport } from 'next';
import './style.css';

export const metadata: Metadata = {
  title: 'Shattana! | Hi lang anay.',
  description: 'Nickname-first random chat around BCD.',
};
export const viewport: Viewport = { interactiveWidget: 'resizes-content' };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
