'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Clip } from '@/lib/data';
import { clipType } from '@/lib/feed';
import { ClipThumb } from './ui';

export const GRID_TABS = ['Vídeos', 'Memes', 'Fotos', 'Momentos'] as const;
export type GridTab = (typeof GRID_TABS)[number];

export function clipsForTab(clips: Clip[], tab: GridTab) {
  return clips.filter((c) => {
    const t = clipType(c);
    return tab === 'Vídeos' ? t === 'video' || t === 'long' : tab === 'Memes' ? t === 'meme' : tab === 'Fotos' ? t === 'photo' : t === 'text';
  });
}

/** Grelha de um tipo: vídeos longos em 16:9 (2 colunas), o resto 9:14 (3 colunas). */
export function TypeGrid({ clips, tab, empty }: { clips: Clip[]; tab: GridTab; empty?: React.ReactNode }) {
  const list = clipsForTab(clips, tab);
  if (!list.length) return <>{empty ?? <p className="py-4 text-center text-sm text-white/60">Nada em {tab.toLowerCase()} ainda.</p>}</>;
  const long = list.filter((c) => clipType(c) === 'long');
  const rest = list.filter((c) => clipType(c) !== 'long');
  return (
    <>
      {long.length > 0 && <div className="mb-2 grid grid-cols-2 gap-2">{long.map((c) => <ClipThumb key={c.id} c={c} wide />)}</div>}
      {rest.length > 0 && <div className="grid grid-cols-3 gap-2">{rest.map((c) => <ClipThumb key={c.id} c={c} />)}</div>}
    </>
  );
}

/** Separadores Vídeos / Memes / Fotos / Momentos com contagem. */
export function ClipGrid({ clips, loading, mine }: { clips: Clip[]; loading?: boolean; mine?: boolean }) {
  const [tab, setTab] = useState<GridTab>('Vídeos');
  return (
    <div>
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {GRID_TABS.map((t) => {
          const n = clipsForTab(clips, t).length;
          return <button key={t} onClick={() => setTab(t)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${tab === t ? 'bg-white text-black' : 'bg-panel2 text-white/70'}`}>{t}{n ? ` · ${n}` : ''}</button>;
        })}
      </div>
      {loading ? (
        <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((k) => <div key={k} className="skeleton aspect-[9/14] rounded-xl" />)}</div>
      ) : (
        <TypeGrid clips={clips} tab={tab} empty={mine ? (
          <div className="py-4 text-center text-sm text-white/60">Ainda não publicaste {tab.toLowerCase()}. <Link href={tab === 'Memes' ? '/publicar?tipo=meme' : '/publicar'} className="text-neon2">Publicar</Link></div>
        ) : undefined} />
      )}
    </div>
  );
}
