'use client';

// Fila de jogos com capa real (Início e Explorar). Leva à área de cada jogo em /jogos/<jogo>/.
import Link from 'next/link';
import { GAMES_CFG, GAME_KEYS, GameKey } from '@/lib/jogos';
import { GAME_ART } from '@/lib/gameArt';
import { GameArt } from './GameArt';
import { Icon } from './Icons';

export function GameRail({ title = 'Jogos', compact = false }: { title?: string; compact?: boolean }) {
  return (
    <section className="mb-6" aria-label={title}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="sec-title">{title}</h2>
        <Link href="/jogos" className="flex min-h-[44px] items-center gap-0.5 text-sm font-semibold text-neon2">Torneios<Icon name="chevron" size={16} /></Link>
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
        {GAME_KEYS.map((k) => <GameTile key={k} k={k} compact={compact} />)}
      </div>
    </section>
  );
}

export function GameTile({ k, compact }: { k: GameKey; compact?: boolean }) {
  const g = GAMES_CFG[k];
  return (
    <Link href={`/jogos/${k}/`} className={`game-tile shrink-0 snap-start ${compact ? 'w-36' : 'w-40'} md:w-auto`} aria-label={`${g.name}: torneios, recargas e marketplace`}>
      <span className="relative block aspect-[4/5]">
        <GameArt id={GAME_ART[k]} sizes="(min-width: 768px) 140px, 160px" />
        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3">
          <span className="w-fit rounded-md px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider" style={{ background: g.color, color: g.onColor }}>{g.abbr}</span>
          <span className="line-clamp-2 text-[15px] font-bold leading-tight">{g.name}</span>
        </span>
      </span>
    </Link>
  );
}
