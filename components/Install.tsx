'use client';

// Instalação da PWA. O evento `beforeinstallprompt` é capturado por um script inline no <head> (app/layout.tsx)
// e guardado em window.__bip, para não se perder antes de esta página/componente carregar.
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
type W = Window & { __bip?: BIPEvent | null; __bipSeen?: number };

const HOST_PATH = 'anamaulele4-creator.github.io' + (process.env.NEXT_PUBLIC_BASE_PATH ?? '');

function getBip(): BIPEvent | null { return typeof window === 'undefined' ? null : (window as W).__bip ?? null; }

// Fallback: se o script inline não correu (ex.: HTML antigo em cache), captura aqui também.
if (typeof window !== 'undefined' && !('__bip' in window)) {
  (window as W).__bip = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); (window as W).__bip = e as BIPEvent; window.dispatchEvent(new Event('txp-install')); });
  window.addEventListener('appinstalled', () => { (window as W).__bip = null; try { localStorage.setItem('txp-installed', '1'); } catch {} window.dispatchEvent(new Event('txp-install')); });
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    || document.referrer.startsWith('android-app://');
}
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
export const isAndroid = () => /android/i.test(ua());
/** Navegadores dentro de outras apps (Facebook, Instagram, TikTok, WhatsApp, Snapchat, X, Line, WebView genérica): não instalam PWAs. */
export const isInApp = () => /FBAN|FBAV|FB_IAB|FB4A|Instagram|TikTok|musical_ly|Bytedance|trill|WhatsApp|Snapchat|Twitter|Line\/|MicroMessenger|; wv\)/i.test(ua());
const isSamsung = () => /SamsungBrowser/i.test(ua());
const isChromeAndroid = () => isAndroid() && /Chrome\/\d+/i.test(ua()) && !isSamsung() && !/EdgA|OPR|Firefox|FxiOS|YaBrowser|UCBrowser|MiuiBrowser/i.test(ua());
const isIOSSafari = () => isIOS() && /Safari/i.test(ua()) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/i.test(ua());

export type InstallStatus = 'loading' | 'installed' | 'prompt' | 'inapp' | 'chrome' | 'android-other' | 'ios' | 'ios-other' | 'desktop';

export function useInstall() {
  const [, force] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [related, setRelated] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  useEffect(() => {
    setMounted(true);
    const l = () => force((x) => x + 1);
    window.addEventListener('txp-install', l);
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', l);
    // Chrome Android: deteta se a PWA já está instalada (manifest.related_applications → webapp)
    const n = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
    n.getInstalledRelatedApps?.().then((a) => { if (a && a.length) setRelated(true); }).catch(() => {});
    return () => { window.removeEventListener('txp-install', l); mq.removeEventListener?.('change', l); };
  }, []);
  let status: InstallStatus = 'loading';
  if (mounted) {
    let flag = false; try { flag = localStorage.getItem('txp-installed') === '1'; } catch {}
    const bip = getBip();
    if (isStandalone() || justInstalled) status = 'installed';
    else if (bip) status = 'prompt';
    else if (related || flag) status = 'installed';
    else if (isInApp()) status = 'inapp';
    else if (isIOS()) status = isIOSSafari() ? 'ios' : 'ios-other';
    else if (isChromeAndroid()) status = 'chrome';
    else if (isAndroid()) status = 'android-other';
    else status = 'desktop';
  }
  /** Abre o diálogo nativo do Chrome. Devolve 'accepted' | 'dismissed' | 'unavailable'. */
  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const bip = getBip();
    if (!bip) return 'unavailable';
    (window as W).__bip = null; // um prompt só pode ser usado uma vez
    try {
      await bip.prompt();
      const r = await bip.userChoice;
      if (r.outcome === 'accepted') { setJustInstalled(true); try { localStorage.setItem('txp-installed', '1'); } catch {} }
      force((x) => x + 1);
      return r.outcome;
    } catch { force((x) => x + 1); return 'unavailable'; }
  };
  return { status, install };
}

/** APK Android (TWA) servido pelo GitHub Pages em public/downloads/txapilog.apk. */
export const APK_HREF = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/downloads/txapilog.apk`;

/** Botão grande amarelo para baixar o APK + passos curtos. */
export function ApkDownload({ compact = false }: { compact?: boolean }) {
  const cls = compact
    ? 'btn w-full'
    : 'flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-neon px-5 py-4 text-lg font-black text-ink shadow-lg active:scale-[.98]';
  return (
    <div className="space-y-2">
      <a href={APK_HREF} download="txapilog.apk" type="application/vnd.android.package-archive" className={cls}>⬇️ Baixar APK (Android)</a>
      <ol className="list-decimal space-y-1 pl-5 text-left text-sm text-white/80">
        <li><b>Baixa</b> o ficheiro <b>txapilog.apk</b>.</li>
        <li><b>Abre o ficheiro</b> (nas notificações ou na pasta Transferências).</li>
        <li>Se pedir, <b>permite &quot;Instalar apps desconhecidas&quot;</b> para o Chrome / Ficheiros.</li>
        <li>Toca em <b>Instalar</b>. O TXAPILOG aparece com as tuas apps.</li>
      </ol>
    </div>
  );
}

export const CHROME_INTENT = `intent://${HOST_PATH}/baixar/#Intent;scheme=https;package=com.android.chrome;end`;

export function IOSSteps() {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-left text-sm text-white/80">
      <li>Abre este site no <b>Safari</b>.</li>
      <li>Toca no botão <b>Partilhar</b> (quadrado com seta ↑).</li>
      <li>Escolhe <b>Adicionar ao ecrã principal</b>.</li>
      <li>Toca em <b>Adicionar</b>. O TXAPILOG aparece como app.</li>
    </ol>
  );
}

export function ChromeSteps() {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-left text-sm text-white/85">
      <li>Toca nos <b>três pontos ⋮</b> no canto superior direito do Chrome.</li>
      <li>Escolhe <b>Instalar app</b> (ou <b>Adicionar ao ecrã principal</b>).</li>
      <li>Confirma em <b>Instalar</b>. O ícone do TXAPILOG aparece com as tuas apps.</li>
    </ol>
  );
}

/** Botão grande amarelo "Instalar TXAPILOG" com todos os casos (prompt, já instalado, in-app, Chrome sem prompt, iOS). */
export function BigInstall({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const { status, install } = useInstall();
  const [help, setHelp] = useState(false);
  const [msg, setMsg] = useState('');
  const big = compact ? 'btn w-full' : 'flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-neon px-5 py-4 text-lg font-black text-ink shadow-lg active:scale-[.98]';

  if (status === 'loading') return <button className={big} disabled>Instalar TXAPILOG</button>;
  if (status === 'installed') return (
    <div className="space-y-1 text-center">
      <div className={`${big} !bg-lime`} role="status">Já instalado ✓</div>
      {!isStandalone() && <p className="text-xs text-white/60">Procura o ícone <b>TXAPILOG</b> nas tuas apps para abrir.</p>}
    </div>
  );
  if (status === 'inapp') return (
    <div className="space-y-2 text-center">
      {isAndroid()
        ? <a href={CHROME_INTENT} className={big}>Abrir no Chrome para instalar</a>
        : <button className={big} onClick={() => setHelp(true)}>Abrir no Safari para instalar</button>}
      <p className="text-xs text-white/70">Estás dentro de outra app (Facebook, Instagram, TikTok, WhatsApp…). Aqui não é possível instalar. {isAndroid() ? 'Toca no botão para abrir no Chrome e depois em Instalar.' : 'Toca em ⋯ / Partilhar › Abrir no Safari.'}</p>
      {isAndroid() && <a href={APK_HREF} download="txapilog.apk" className="btn-ghost w-full">⬇️ Baixar APK (Android)</a>}
      {help && !isAndroid() && <div className="rounded-xl bg-panel2 p-3"><IOSSteps /></div>}
    </div>
  );

  const onClick = async () => {
    setMsg('');
    if (status === 'prompt') {
      const r = await install();
      if (r === 'accepted') { setMsg(' A instalar… o ícone aparece nas tuas apps em segundos.'); onDone?.(); }
      else if (r === 'dismissed') setMsg('Instalação cancelada. Podes tentar de novo quando quiseres.');
      else { setMsg(''); setHelp(true); }
      return;
    }
    setHelp((x) => !x);
  };

  return (
    <div className="space-y-2 text-center">
      <button className={big} onClick={onClick}>Instalar TXAPILOG</button>
      {msg && <p className="text-sm text-lime" role="status">{msg}</p>}
      {(help || (!compact && status !== 'prompt')) && (
        <div className="rounded-xl bg-panel2 p-3 text-left">
          {status === 'ios' && <IOSSteps />}
          {status === 'ios-other' && <><p className="mb-2 text-sm">No iPhone só o <b>Safari</b> instala apps web. Copia o link e abre-o no Safari:</p><IOSSteps /></>}
          {(status === 'chrome' || status === 'prompt') && <><p className="mb-2 text-sm font-semibold">Instala pelo menu do Chrome:</p><ChromeSteps /><p className="mb-2 mt-3 text-sm font-semibold">Não aparece &quot;Instalar app&quot;? Baixa o APK:</p><ApkDownload compact /></>}
          {status === 'android-other' && <>
            <p className="mb-2 text-sm">Para a melhor experiência abre no <b>Chrome</b>:</p>
            <a href={CHROME_INTENT} className="btn-ghost mb-2 w-full">Abrir no Chrome</a>
            <p className="text-xs text-white/60">Ou no menu deste navegador (☰ / ⋮) escolhe <b>Adicionar à página inicial</b> / <b>Instalar</b>.</p>
            <p className="mb-2 mt-3 text-sm font-semibold">Ou instala o APK Android:</p><ApkDownload compact />
          </>}
          {status === 'desktop' && <p className="text-sm text-white/80">No Chrome ou Edge, clica no ícone <b>Instalar</b> (⊕) na barra de endereço, ou no menu ⋮ › <b>Transmitir, guardar e partilhar › Instalar página como app</b>.</p>}
        </div>
      )}
    </div>
  );
}

/** Compatibilidade: botão usado em Definições e /instalar. */
export function InstallButton({ className }: { className?: string }) {
  void className;
  return <BigInstall compact />;
}

/** Linha do menu ☰ do perfil. */
export function InstallMenuRow({ onNavigate }: { onNavigate?: () => void }) {
  const { status, install } = useInstall();
  if (status === 'installed') return <li><div className="flex min-h-[48px] items-center gap-3 px-3"><span className="flex-1 text-sm">App TXAPILOG</span><span className="text-xs text-lime">Já instalado ✓</span></div></li>;
  if (status === 'prompt') return <li><button type="button" onClick={() => { void install(); }} className="flex min-h-[48px] w-full items-center gap-3 px-3 text-left"><span className="flex-1 text-sm font-semibold text-neon">Instalar TXAPILOG</span><span className="rounded-lg bg-neon px-2 py-0.5 text-xs font-bold text-ink">Instalar</span></button></li>;
  return <><li><Link href="/baixar" onClick={onNavigate} className="flex min-h-[48px] items-center gap-3 px-3"><span className="flex-1 text-sm font-semibold text-neon">Instalar TXAPILOG</span><span className="text-white/30">›</span></Link></li>
    <li><a href={APK_HREF} download="txapilog.apk" className="flex min-h-[48px] items-center gap-3 px-3"><span className="w-6 text-center text-lg">⬇️</span><span className="flex-1 text-sm">Baixar APK (Android)</span><span className="text-white/30">›</span></a></li></>;
}
