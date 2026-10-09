'use client';
// TXAPILOG AI CORE · painel de inteligência (admin, moderador, organizador). Código carregado só ao abrir.
import dynamic from 'next/dynamic';

const CoreApp = dynamic(() => import('@/components/core/CoreApp'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-[55] flex items-center justify-center bg-core-bg text-sm text-white/70">A carregar o TXAPILOG AI CORE…</div>,
});

export default function CorePage() { return <CoreApp />; }
