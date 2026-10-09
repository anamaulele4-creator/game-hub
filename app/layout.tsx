import type { Metadata, Viewport } from 'next';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import { BottomNav, Overlays } from '@/components/ui';
import { LazyShell } from '@/components/LazyShell';
import { AuthGate } from '@/components/AuthGate';
import { SystemGuard } from '@/components/SystemGuard';

const B = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://anamaulele4-creator.github.io' + B).replace(/\/$/, '');
const DESC = 'TXAPILOG · Fast like a bird. Clipes, lives, torneios e ídolos do gaming moçambicano.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE + '/'),
  title: 'TXAPILOG · Gaming de Moçambique',
  description: DESC,
  applicationName: 'TXAPILOG',
  appleWebApp: { capable: true, title: 'TXAPILOG', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: `${B}/icons/favicon-32.png`, sizes: '32x32', type: 'image/png' }, { url: `${B}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }],
    shortcut: `${B}/favicon.ico`,
    apple: `${B}/icons/apple-touch-icon.png`,
  },
  manifest: `${B}/manifest.webmanifest`,
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website', siteName: 'TXAPILOG', locale: 'pt_MZ', url: SITE + '/',
    title: 'TXAPILOG · Fast like a bird', description: DESC,
    images: [{ url: `${SITE}/brand/og-image.png`, width: 1200, height: 630, alt: 'TXAPILOG · Fast like a bird' }],
  },
  twitter: { card: 'summary_large_image', title: 'TXAPILOG · Fast like a bird', description: DESC, images: [`${SITE}/brand/og-image.png`] },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1E3A8A', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <head>
        <link rel="preconnect" href="https://interactive-examples.mdn.mozilla.net" crossOrigin="" />
        <link rel="dns-prefetch" href="https://interactive-examples.mdn.mozilla.net" />
      </head>
      <body>
        <SystemGuard>
        <StoreProvider>
          <div className="app-shell relative mx-auto min-h-screen max-w-md">
            <AuthGate>{children}</AuthGate>
            <BottomNav />
            <Overlays />
            <LazyShell />
          </div>
        </StoreProvider>
        </SystemGuard>
      </body>
    </html>
  );
}
