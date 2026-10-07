import type { Metadata, Viewport } from 'next';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import { BottomNav, Overlays } from '@/components/ui';

export const metadata: Metadata = {
  title: 'GAME HUB · Gaming de Moçambique',
  description: 'Clipes, lives, torneios e ídolos do gaming moçambicano. Versão de teste (demo).',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b0614' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>
        <StoreProvider>
          <div className="relative mx-auto min-h-screen max-w-md bg-bg shadow-[0_0_60px_rgba(177,77,255,.15)]">
            {children}
            <BottomNav />
            <Overlays />
          </div>
        </StoreProvider>
      </body>
    </html>
  );
}
