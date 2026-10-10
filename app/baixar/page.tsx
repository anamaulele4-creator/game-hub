import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo, Page } from '@/components/ui';
import { ApkDownload, BigInstall, IOSSteps } from '@/components/Install';

export const metadata: Metadata = { title: 'Baixar o app · TXAPILOG', description: 'Instala o TXAPILOG no Android, iPhone ou computador.' };

// Quando existir a página da Play Store, preencher esta variável no build.
const PLAY_URL = process.env.NEXT_PUBLIC_PLAY_URL ?? '';

export default function Baixar() {
  return (
    <Page title="Baixar o app" back="/">
      <div className="hero-bg hero-strong" aria-hidden />
      <div className="relative z-[1] mb-4 pt-2">
        <BigInstall />
      </div>
      <div className="mb-5 flex flex-col items-center gap-2 pt-4 text-center">
        <BrandLogo width={180} />
        <h1 className="text-2xl font-black text-neon">TXAPILOG no teu telemóvel</h1>
        <p className="max-w-xs text-sm text-white/70">Abre num toque, funciona com rede fraca e recebe alertas dos teus torneios e apostas. Menos de 1 MB.</p>
      </div>

      <p className="mb-3 text-center text-xs text-white/50">Instalação direta do navegador (PWA) ou pelo APK Android. Sem loja.</p>

      <div className="card mb-3 space-y-2 text-sm">
        <p className="font-semibold">Android</p>
        <ol className="list-decimal space-y-1 pl-5 text-white/80"><li>Abre este site no <b>Chrome</b>.</li><li>Toca em <b>Instalar TXAPILOG</b> (no topo) ou ⋮ › <b>Instalar app</b> / <b>Adicionar ao ecrã principal</b>.</li><li>Confirma. O ícone aparece com as tuas apps.</li></ol>
      </div>

      <div className="card mb-3 space-y-3 text-sm">
        <p className="font-semibold">⬇️ APK para Android</p>
        <p className="text-xs text-white/60">Se o Chrome não mostra &quot;Instalar app&quot;, instala o APK oficial (versão 1.0.0).</p>
        <ApkDownload />
      </div>

      <div className="card mb-3 space-y-2 text-sm"><p className="font-semibold">iPhone / iPad</p><IOSSteps /><p className="text-xs text-white/50">As notificações push no iPhone funcionam depois de adicionar ao ecrã principal (iOS 16.4+).</p></div>

      <div className="card mb-3 space-y-2 text-center text-sm">
        <p className="font-semibold">▶️ Google Play</p>
        {PLAY_URL ? (
          <a href={PLAY_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-black px-4 py-2 text-left">
            <span className="text-2xl">▶️</span><span><span className="block text-[11px] uppercase text-white/60">Disponível no</span><span className="block font-semibold">Google Play</span></span>
          </a>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/60 px-4 py-2 text-left opacity-60" aria-label="Google Play — em breve">
            <span className="text-2xl">▶️</span><span><span className="block text-[11px] uppercase text-white/60">Em breve no</span><span className="block font-semibold">Google Play</span></span>
          </div>
        )}
      </div>

      <div className="card space-y-1 text-sm"><p className="font-semibold">Computador</p><p className="text-white/70">No Chrome ou Edge, clica no ícone de instalar na barra de endereço.</p></div>
      <p className="mt-4 text-center text-xs text-white/40">Ao instalar aceitas os <Link href="/termos" className="underline">Termos</Link> e a <Link href="/privacidade" className="underline">Política de Privacidade</Link>.</p>
    </Page>
  );
}
