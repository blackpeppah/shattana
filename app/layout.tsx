import type { Metadata, Viewport } from 'next';
import './style.css';

export const metadata: Metadata = {
  title: 'Shattana! | Hi lang anay.',
  description: 'Nickname-first random chat around BCD.',
};
export const viewport: Viewport = { interactiveWidget: 'resizes-content' };

const themeScript = `try {
  const theme = localStorage.getItem('shattana.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {}`;

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head>
    <script dangerouslySetInnerHTML={{ __html: themeScript }} />
  </head><body>{children}</body></html>;
}
