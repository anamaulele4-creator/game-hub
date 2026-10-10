import type { Metadata, Viewport } from 'next';
import './globals.css';
import localFont from 'next/font/local';
import { StoreProvider } from '@/lib/store';
import { BottomNav, Overlays } from '@/components/ui';
import { LazyShell } from '@/components/LazyShell';
import { AuthGate } from '@/components/AuthGate';
import { SystemGuard } from '@/components/SystemGuard';
import { QualityProvider } from '@/components/QualityProvider';

// Fonte de títulos estilo esports (Rajdhani, self-hosted, só latin 600/700 ≈ 31 KB)
const display = localFont({ src: [{ path: './fonts/rajdhani-600.woff2', weight: '600' }, { path: './fonts/rajdhani-700.woff2', weight: '700' }], variable: '--font-display', display: 'swap', fallback: ['system-ui', 'sans-serif'] });

const B = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://anamaulele4-creator.github.io' + B).replace(/\/$/, '');
const DESC = 'TXAPILOG · Fast like a bird. Torneios, apostas e marketplace do gaming moçambicano.';

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

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0A1230', viewportFit: 'cover' };

// Captura o beforeinstallprompt o mais cedo possível (antes do React/JS da página) e regista o service worker logo no load,
// para que o botão "Instalar" funcione em qualquer página, mesmo que o evento dispare antes de /baixar carregar.
const EARLY = `(function(){try{var w=window,B=${JSON.stringify(B)};w.__bip=null;
try{var q=JSON.parse(localStorage.getItem('txp-quality-v1')||'{}');var t=q.mode&&q.mode!=='auto'?q.mode:q.auto;if(t)document.documentElement.setAttribute('data-q',t);}catch(_){}
w.addEventListener('beforeinstallprompt',function(e){e.preventDefault();w.__bip=e;w.__bipSeen=1;w.dispatchEvent(new Event('txp-install'));});
w.addEventListener('appinstalled',function(){w.__bip=null;try{localStorage.setItem('txp-installed','1')}catch(_){}w.dispatchEvent(new Event('txp-install'));});
if('serviceWorker' in navigator){var r=function(){navigator.serviceWorker.register(B+'/sw.js',{scope:B+'/'}).catch(function(){});};if(document.readyState==='complete')r();else w.addEventListener('load',r);}
}catch(_){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className={display.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY }} />
        <link rel="preconnect" href="https://interactive-examples.mdn.mozilla.net" crossOrigin="" />
        <link rel="dns-prefetch" href="https://interactive-examples.mdn.mozilla.net" />
      </head>
      <body>
        <SystemGuard>
        <QualityProvider>
        <StoreProvider>
          <div className="app-shell">
            <AuthGate>{children}</AuthGate>
            <BottomNav />
            <Overlays />
            <LazyShell />
          </div>
        </StoreProvider>
        </QualityProvider>
        </SystemGuard>
      </body>
    </html>
  );
}
