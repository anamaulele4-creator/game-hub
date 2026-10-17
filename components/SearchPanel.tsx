'use client';

import { useEffect, useState } from 'react';

export function SearchPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener('txp-search', on);
    return () => window.removeEventListener('txp-search', on);
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/60" onClick={() => setOpen(false)}>
      <div className="absolute inset-y-0 right-0 w-full bg-[#0A1230] p-4 sm:w-[420px]" onClick={(e) => e.stopPropagation()}>
        Pesquisa (teste)
      </div>
    </div>
  );
}