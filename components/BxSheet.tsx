'use client';

import { useEffect } from 'react';

/** Folha inferior com o tema .bx (azul-marinho/amarelo; escuro/laranja dentro de /jogos). */
export function BxSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[66] flex items-end justify-center bg-black/70 sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bx max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-[var(--bx-line)] bg-[var(--bx-card)] p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-white sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--bx-card2)]" aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
