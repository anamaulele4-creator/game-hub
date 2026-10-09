'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Opções de publicação (botão "+ Publicar" e topo de /publicar). */
export const PUBLISH_OPTIONS: { href: string; icon: string; label: string; hint: string; tipo?: string; live?: boolean; wide?: boolean }[] = [
  { href: '/lives/criar', icon: '🔴', label: 'Criar live', hint: 'Transmite em direto', live: true },
  { href: '/publicar?tipo=long', icon: '📺', label: 'Vídeos', hint: 'Vídeos longos', tipo: 'long' },
  { href: '/publicar?tipo=video', icon: '🎬', label: 'Clipes', hint: 'Até 5 minutos', tipo: 'video' },
  { href: '/publicar?tipo=meme', icon: '😂', label: 'Memes', hint: 'Imagem com texto', tipo: 'meme' },
  { href: '/publicar?tipo=photo', icon: '📷', label: 'Fotos', hint: 'Da galeria ou câmara', tipo: 'photo' },
  { href: '/publicar?tipo=text', icon: '💭', label: 'Momentos', hint: 'Só texto', tipo: 'text' },
  { href: '/camera', icon: '🎥', label: 'Câmara TXAPILOG', hint: 'Grava ou fotografa com filtros de jogo', wide: true },
];

/** Folha inferior (estilo TikTok) com as opções grandes de publicação. */
export function PublishSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[66] flex animate-fadeIn items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="O que queres publicar?">
      <div className="w-full max-w-md animate-sheetIn rounded-t-sheet border-t border-line bg-panel p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-e3 sm:rounded-sheet sm:border sm:pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-white/20 sm:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">O que queres publicar?</h3>
          <button onClick={onClose} className="rounded-full bg-panel2 px-4 py-2 text-base" aria-label="Fechar">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {PUBLISH_OPTIONS.map((o) => (
            <Link key={o.href} href={o.href} onClick={() => { if (o.tipo) window.dispatchEvent(new CustomEvent('poipak-tipo', { detail: o.tipo })); onClose(); }}
              className={`flex min-h-[5.5rem] flex-col items-start justify-center gap-1 rounded-2xl border p-4 active:scale-[0.98] ${o.live ? 'col-span-2 flex-row items-center gap-3 border-red-500/50 bg-red-500/10' : o.wide ? 'col-span-2 flex-row items-center gap-3 border-neon/50 bg-neon/10' : 'border-line bg-panel2'}`}>
              <span className="text-3xl leading-none" aria-hidden>{o.icon}</span>
              <span className="flex flex-col">
                <span className="text-base font-bold leading-tight">{o.label}</span>
                <span className="text-sm text-white/60">{o.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
