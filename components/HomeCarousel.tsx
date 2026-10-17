'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Slide } from '@/components/jogos/Kit';
import { GameArt } from '@/components/GameArt';
import { Photo } from '@/components/Photo';

export function HomeCarousel({ slides, label }: { slides: Slide[]; label: string }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const touch = useRef<number | null>(null);
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  useEffect(() => {
    if (paused || n < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), 5000);
    return () => clearInterval(t);
  }, [paused, n]);
  if (!n) return null;
  const go = (k: number) => setI(((k % n) + n) % n);

  return (
    <section className="relative -mx-4 sm:-mx-6 lg:-mx-7 lg:-mt-5" aria-roledescription="carrossel" aria-label={label}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="overflow-hidden"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const x = touch.current; touch.current = null; if (x == null) return; const dx = e.changedTouches[0].clientX - x; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); }}>
        <div className="flex transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${i * 100}%)` }}>
          {slides.map((sl, k) => (
            <div key={sl.key} className="relative flex h-[340px] w-full shrink-0 items-center px-5 sm:h-[400px] sm:px-20 lg:h-[440px]" aria-hidden={k !== i} role="group" aria-label={`Slide ${k + 1} de ${n}`}>
              {sl.photo && sl.art
                ? <Photo src={sl.photo} fallback={sl.art} alt={sl.title} shade="none" priority={k === 0} sizes="(min-width: 1120px) 1120px, 100vw" />
                : sl.art && <GameArt id={sl.art} shade="none" priority={k === 0} sizes="(min-width: 1120px) 1120px, 100vw" />}
              {/* Gradiente roxo por cima + fusão com o fundo em baixo */}
              <div className="pointer-events-none absolute inset-0" aria-hidden
                style={{ background: 'linear-gradient(90deg, rgba(12,18,52,.92) 0%, rgba(40,25,110,.65) 38%, rgba(140,45,215,.45) 65%, rgba(185,55,235,.55) 100%), linear-gradient(180deg, rgba(21,33,58,0) 55%, #15213A 100%)' }} />
              <div className="relative flex min-w-0 max-w-[560px] flex-col items-start pb-36">
                <span className="rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider" style={{ background: sl.tagBg, color: sl.tagFg }}>{sl.tag}</span>
                <h2 className="mt-3 font-display text-4xl font-bold uppercase leading-[1.05] [text-shadow:0_2px_12px_rgba(0,0,0,.5)] sm:text-5xl">{sl.title}</h2>
                <p className="mt-2 max-w-[460px] text-sm leading-snug text-white/80 sm:text-base">{sl.sub}</p>
                {sl.href
                  ? <Link href={sl.href} tabIndex={k === i ? 0 : -1} className="btn mt-4 !min-h-[40px] !px-5 !py-2 text-sm">{sl.cta}</Link>
                  : <button type="button" tabIndex={k === i ? 0 : -1} onClick={sl.onCta} className="btn mt-4 !min-h-[40px] !px-5 !py-2 text-sm">{sl.cta}</button>}
                {sl.example && <span className="mt-3 inline-flex w-fit rounded-md border border-white/25 bg-black/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/80">Dados de exemplo</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {n > 1 && (
        <>
          <button type="button" onClick={() => go(i - 1)} aria-label="Anterior" className="absolute left-3 top-[38%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-xl text-white hover:bg-black/60 sm:flex">‹</button>
          <button type="button" onClick={() => go(i + 1)} aria-label="Seguinte" className="absolute right-3 top-[38%] hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-xl text-white hover:bg-black/60 sm:flex">›</button>
          <div className="absolute bottom-36 right-5 flex gap-1.5">
            {slides.map((sl, k) => (
              <button key={sl.key} type="button" onClick={() => go(k)} aria-label={`Slide ${k + 1}`} aria-current={k === i}
                className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-[#FFC20E]' : 'w-2 bg-white/40'}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}