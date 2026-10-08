import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { InstallButton, IOSSteps } from '@/components/Install';

export const metadata: Metadata = { title: 'Instalar a app · Social POIPAK' };

export default function Instalar() {
  return (
    <Page title="Instalar app" back="/mais">
      <div className="card mb-3 space-y-3 text-center">
        <p className="text-4xl">📲</p>
        <p className="font-semibold">Social POIPAK no teu ecrã principal</p>
        <p className="text-sm text-white/70">Abre num toque, ocupa menos de 1 MB, funciona offline e recebe notificações de lives.</p>
        <InstallButton />
      </div>
      <div className="card mb-3 space-y-2 text-sm">
        <p className="font-semibold">🤖 Android (Chrome)</p>
        <ol className="list-decimal space-y-1 pl-5 text-white/80"><li>Abre o site no Chrome.</li><li>Toca em <b>Instalar app</b> (ou ⋮ › <b>Instalar app</b> / <b>Adicionar ao ecrã principal</b>).</li><li>Confirma. O ícone aparece com as tuas apps.</li></ol>
      </div>
      <div className="card mb-3 space-y-2 text-sm"><p className="font-semibold">🍎 iPhone / iPad (Safari)</p><IOSSteps /><p className="text-xs text-white/50">No iPhone, as notificações push só funcionam depois de instalar (iOS 16.4+).</p></div>
      <div className="card space-y-2 text-sm"><p className="font-semibold">▶️ Google Play</p><p className="text-white/70">Em breve na Play Store (app Android empacotada a partir desta PWA).</p></div>
    </Page>
  );
}
