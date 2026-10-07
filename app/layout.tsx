import type { Metadata, Viewport } from 'next';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import { BottomNav, Overlays } from '@/components/ui';
import { LazyShell } from '@/components/LazyShell';
import { AuthGate } from '@/components/AuthGate';

const B = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'Social POIPAK · Gaming de Moçambique',
  description: 'Clipes, lives, torneios e ídolos do gaming moçambicano.',
  applicationName: 'Social POIPAK',
  appleWebApp: { capable: true, title: 'Social POIPAK', statusBarStyle: 'black-translucent' },
  icons: { icon: `${B}/icons/icon-192.png`, apple: `${B}/icons/apple-touch-icon.png` },
  manifest: `${B}/manifest.webmanifest`,
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b0614', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <head>
        <link rel="preconnect" href="https://interactive-examples.mdn.mozilla.net" crossOrigin="" />
        <link rel="dns-prefetch" href="https://interactive-examples.mdn.mozilla.net" />
      </head>
      <body>
        <StoreProvider>
          <div className="app-shell relative mx-auto min-h-screen max-w-md shadow-[0_0_60px_rgba(177,77,255,.18)]">
            <AuthGate>{children}</AuthGate>
            <BottomNav />
            <Overlays />
            <LazyShell />
          </div>
        </StoreProvider>
      </body>
    </html>
  );
}
