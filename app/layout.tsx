import { BrandBackdrop } from '@/components/BrandBackdrop';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import localFont from 'next/font/local';
import { StoreProvider } from '@/lib/store';
import { Overlays } from '@/components/ui';
import { BottomNav, SideNav } from '@/components/Shell';
import { QualityRoot } from '@/lib/quality';
import { QUALITY_BOOT } from '@/lib/qualityCore';
import { LazyShell } from '@/components/LazyShell';
import { AuthGate } from '@/components/AuthGate';
import { SystemGuard } from '@/components/SystemGuard';

// Lexend (SIL OFL 1.1, app/fonts/OFL.txt), alojada localmente: só latin 400/500/600/700.
const lexend = localFont({
  src: [
    { path: './fonts/lexend-400.woff2', weight: '400' },
    { path: './fonts/lexend-500.woff2', weight: '500' },
    { path: './fonts/lexend-600.woff2', weight: '600' },
    { path: './fonts/lexend-700.woff2', weight: '700' },
  ],
  variable: '--font-lexend', display: 'swap', fallback: ['system-ui', 'sans-serif'],
});

const B = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://anamaulele4-creator.github.io' + B).replace(/\/$/, '');
const DESC = 'TXAPZONE by TXAPILOG · Torneios, recargas e marketplace de Free Fire, Clash Royale, eFootball, DLS e mais.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE + '/'),
  title: 'TXAPZONE · Torneios, recargas e marketplace',
  description: DESC,
  applicationName: 'TXAPZONE',
  appleWebApp: { capable: true, title: 'TXAPZONE', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: `${B}/icons/favicon-32.png`, sizes: '32x32', type: 'image/png' }, { url: `${B}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }],
    shortcut: `${B}/favicon.ico`,
    apple: `${B}/icons/apple-touch-icon.png`,
  },
  manifest: `${B}/manifest.webmanifest`,
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website', siteName: 'TXAPZONE', locale: 'pt_MZ', url: SITE + '/',
    title: 'TXAPZONE · Torneios e recargas', description: DESC,
    images: [{ url: `${SITE}/brand/og-image.png`, width: 1200, height: 630, alt: 'TXAPILOG · Fast like a bird' }],
  },
  twitter: { card: 'summary_large_image', title: 'TXAPZONE · Torneios e recargas', description: DESC, images: [`${SITE}/brand/og-image.png`] },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0E0F13', viewportFit: 'cover' };

// Captura o beforeinstallprompt o mais cedo possível (antes do React/JS da página) e regista o service worker logo no load,
// para que o botão "Instalar" funcione em qualquer página, mesmo que o evento dispare antes de /baixar carregar.
const EARLY = `(function(){try{var w=window,B=${JSON.stringify(B)};w.__bip=null;
w.addEventListener('beforeinstallprompt',function(e){e.preventDefault();w.__bip=e;w.__bipSeen=1;w.dispatchEvent(new Event('txp-install'));});
w.addEventListener('appinstalled',function(){w.__bip=null;try{localStorage.setItem('txp-installed','1')}catch(_){}w.dispatchEvent(new Event('txp-install'));});
if('serviceWorker' in navigator){var r=function(){navigator.serviceWorker.register(B+'/sw.js',{scope:B+'/'}).catch(function(){});};if(document.readyState==='complete')r();else w.addEventListener('load',r);}
}catch(_){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className={lexend.variable} data-quality="equilibrada" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY }} />
        <script dangerouslySetInnerHTML={{ __html: QUALITY_BOOT }} />
      </head>
      <body>
        <SystemGuard>
        <StoreProvider>
          <QualityRoot />
          <BrandBackdrop />
          <SideNav />
          <div className="app-frame">
            <div className="app-shell relative mx-auto min-h-screen w-full">
              <AuthGate>{children}</AuthGate>
              <Overlays />
              <LazyShell />
            </div>
          </div>
          <BottomNav />
        </StoreProvider>
        </SystemGuard>
      </body>
    </html>
  );
}
