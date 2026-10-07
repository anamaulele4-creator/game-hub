'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CLIPS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { ClipSlide } from '@/components/ClipSlide';
import { Logo } from '@/components/ui';

export default function ClipesPage() {
  const [muted, setMuted] = useState(true);
  const { s } = useStore();
  const clips = CLIPS.filter((c) => !s.admin.hiddenClips.includes(c.id));
  return (
    <div className="relative">
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between p-3">
        <Link href="/"><Logo size={28} /></Link>
        <span className="rounded-full bg-black/40 px-3 py-1 text-sm font-semibold">Clipes</span>
        <Link href="/guardados" className="rounded-full bg-black/40 px-3 py-1 text-sm">🔖</Link>
      </div>
      <div className="snap-feed no-scrollbar h-[calc(100vh-56px)] overflow-y-scroll">
        {clips.map((c) => <ClipSlide key={c.id} c={c} muted={muted} setMuted={setMuted} />)}
      </div>
      <p className="pointer-events-none absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-[10px] text-white/70">Desliza ↑ · Toque duplo = 💜 · Toque = pausa</p>
    </div>
  );
}
