'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useClipSound } from '@/lib/sound';
import { CLIPS } from '@/lib/data';
import { applyFilter, feedFilters, isLong } from '@/lib/feed';
import { useStore } from '@/lib/store';
import { ClipSlide } from '@/components/ClipSlide';
import { SponsoredSlide } from '@/components/Sponsored';
import { Logo } from '@/components/ui';

function Feed() {
  const [muted, setMuted] = useClipSound();
  const { s } = useStore();
  const router = useRouter();
  const sp = useSearchParams();
  const f = sp.get('f') || 'para-ti';
  const scroller = useRef<HTMLDivElement>(null);
  // Feed vertical = só clipes curtos (os vídeos longos vivem em /videos)
  const base = CLIPS.filter((c) => !isLong(c) && !s.admin.hiddenClips.includes(c.id) && !s.blocked.includes(c.idolId));
  const filters = useMemo(() => feedFilters(base), [base.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const clips = applyFilter(base, f, s.following);
  const pick = (k: string) => router.replace(k === 'para-ti' ? '/clipes' : `/clipes?f=${encodeURIComponent(k)}`, { scroll: false });
  useEffect(() => { scroller.current?.scrollTo({ top: 0, behavior: 'auto' }); }, [f]);

  return (
    <div className="relative">
      <div className="absolute left-0 right-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent pb-2">
        <div className="flex items-center justify-between px-3 pt-2">
          <Link href="/"><Logo size={26} /></Link>
          <Link href="/videos" className="rounded-full bg-black/50 px-3 py-1 text-xs font-semibold">📺 Vídeos longos</Link>
          <Link href="/guardados" className="rounded-full bg-black/50 px-3 py-1 text-sm" aria-label="Guardados">🔖</Link>
        </div>
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-3">
          {filters.map((x) => (
            <button key={x.key} onClick={() => pick(x.key)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${f === x.key ? 'bg-white text-black' : 'bg-black/50 text-white/85'}`}>{x.label}</button>
          ))}
        </div>
      </div>
      <div key={f} ref={scroller} className="snap-feed no-scrollbar feed-h overflow-y-scroll">
        {clips.length === 0 && (
          <div className="feed-h flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-5xl">🫥</p>
            <p className="text-sm text-white/70">Ainda não há nada aqui.</p>
            <Link href="/publicar" className="btn">＋ Publicar o primeiro</Link>
          </div>
        )}
        {clips.map((c, k) => <div key={c.id} className="contents"><ClipSlide c={c} muted={muted} setMuted={setMuted} />{k % 3 === 2 && <SponsoredSlide slot={`clip-${k}`} />}</div>)}
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return <div className="feed-h skeleton" aria-hidden />;
}

export default function ClipesPage() {
  return <Suspense fallback={<FeedSkeleton />}><Feed /></Suspense>;
}
