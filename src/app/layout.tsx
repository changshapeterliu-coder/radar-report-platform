import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import I18nProvider from '@/components/I18nProvider';

/**
 * Root layout.
 *
 * Font stack is defined in `src/app/globals.css` via the `--font-sans` token
 * (see `ui-design-system.md` §2.1). No network font loading: bilingual
 * Inter + PingFang SC + Microsoft YaHei + system fallbacks.
 */

export const metadata: Metadata = {
  title: 'Radar Report Platform',
  description: 'Amazon seller account health radar report platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <I18nProvider>
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
