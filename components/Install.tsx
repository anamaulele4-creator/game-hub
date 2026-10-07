'use client';

import { useEffect, useState } from 'react';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; listeners.forEach((l) => l()); });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((l) => l()); });
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Estado de instalação: 'prompt' (Android/Chrome pode instalar), 'ios' (instruções), 'installed', 'unavailable'. */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((x) => x + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const status: 'prompt' | 'ios' | 'installed' | 'unavailable' = !mounted ? 'unavailable' : isStandalone() ? 'installed' : deferred ? 'prompt' : isIOS() ? 'ios' : 'unavailable';
  const install = async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const r = await deferred.userChoice;
    deferred = null;
    force((x) => x + 1);
    return r.outcome === 'accepted';
  };
  return { status, install };
}

export function IOSSteps() {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-white/80">
      <li>Abre este site no <b>Safari</b>.</li>
      <li>Toca no botão <b>Partilhar</b> (quadrado com seta ↑).</li>
      <li>Escolhe <b>Adicionar ao ecrã principal</b>.</li>
      <li>Toca em <b>Adicionar</b>. O Social POIPAK aparece como app.</li>
    </ol>
  );
}

export function InstallButton({ className = 'btn w-full' }: { className?: string }) {
  const { status, install } = useInstall();
  const [showIos, setShowIos] = useState(false);
  if (status === 'installed') return <p className="text-center text-sm text-lime">✓ App instalada neste dispositivo</p>;
  if (status === 'ios') return (
    <div>
      <button className={className} onClick={() => setShowIos((x) => !x)}>📲 Instalar app (iPhone)</button>
      {showIos && <div className="mt-3 rounded-xl bg-panel2 p-3"><IOSSteps /></div>}
    </div>
  );
  if (status === 'prompt') return <button className={className} onClick={install}>📲 Instalar app</button>;
  return <p className="text-center text-xs text-white/60">No Android abre no Chrome e usa ⋮ › <b>Instalar app</b>. No computador, o ícone de instalar aparece na barra de endereço.</p>;
}
