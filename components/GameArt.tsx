'use client';
// Arte real dos jogos (capas 16:9 e ícones oficiais, ver public/img/games/SOURCES.md).
// A resolução segue a qualidade adaptativa: em Poupança só a versão de 640 px; nas outras o browser escolhe pelo srcset.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GAMES_CFG, GAME_KEYS, GameKey, MAIN_GAMES, gameCover, gameCoverSrcSet, gameIconSrc } from '@/lib/jogos';
import { Icon } from './icons';
import { useQuality } from '@/lib/quality';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Capa do jogo a preencher o contentor (o pai define o tamanho/proporção; usa `relative`).
 * `sizes` diz ao browser a largura em que a capa aparece (ex.: "(min-width: 768px) 30vw, 60vw").
 * `priority` = acima da dobra (carrega já, sem lazy).
 */
export function GameCover({ game, sizes = '100vw', priority = false, className = '', alt, shade = true }: {
  game: GameKey; sizes?: string; priority?: boolean; className?: string; alt?: string; shade?: boolean;
}) {
  const { level } = useQuality();
  const [ok, setOk] = useState(false);
  const [bad, setBad] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // HTML estático: a imagem pode acabar de carregar antes de o React ligar o onLoad
  useEffect(() => { if (img.current?.complete && img.current.naturalWidth) setOk(true); }, []);
  const g = GAMES_CFG[game];
  const saver = level === 'poupanca';
  return (
    <span className={`game-cover absolute inset-0 overflow-hidden ${className}`} style={{ backgroundColor: g.color }}>
      {!ok && <span className="skeleton absolute inset-0" aria-hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        src={`${BASE}${gameCover(game, 640)}`}
        srcSet={saver ? undefined : gameCoverSrcSet(game, BASE)}
        sizes={saver ? undefined : sizes}
        width={640} height={360}
        alt={alt ?? `Capa de ${g.name}`}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...({ fetchpriority: priority ? 'high' : 'auto' } as Record<string, string>)}
        onLoad={() => setOk(true)}
        onError={() => { setBad(true); setOk(true); }}
        className={`h-full w-full object-cover transition-opacity duration-300 ${ok && !bad ? 'opacity-100' : 'opacity-0'}`}
      />
      {shade && <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" aria-hidden />}
    </span>
  );
}

/** Ícone oficial do jogo (quadrado arredondado). "Outros" mostra a sigla na cor do jogo. */
export function GameIconImg({ game, size = 44, className = '' }: { game: GameKey; size?: number; className?: string }) {
  const g = GAMES_CFG[game];
  const src = gameIconSrc(game);
  const [bad, setBad] = useState(false);
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.26) };
  if (!src || bad) {
    return <span className={`flex shrink-0 items-center justify-center font-bold ${className}`} style={{ ...box, fontSize: Math.round(size * 0.36), background: g.color, color: g.onColor }} aria-hidden>{g.abbr}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}${src}`} width={size} height={size} alt="" aria-hidden loading="lazy" decoding="async" onError={() => setBad(true)}
      className={`shrink-0 object-cover ring-1 ring-white/10 ${className}`} style={box} />
  );
}

/** Entrada para Jogos & Torneios: faixa com as capas dos 4 jogos principais (Início e Explorar). */
export function GamesBanner({ sub = 'Torneios, recargas e marketplace por jogo', className = '' }: { sub?: string; className?: string }) {
  return (
    <Link href="/jogos" className={`card-hover relative block overflow-hidden rounded-card border border-neon/30 shadow-e2 ${className}`} aria-label={`Jogos & Torneios: ${sub}`}>
      <span className="grid h-[92px] grid-cols-4" aria-hidden>
        {MAIN_GAMES.map((k) => <span key={k} className="relative"><GameCover game={k} sizes="25vw" shade={false} alt="" /></span>)}
      </span>
      <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(14,14,16,.96)_0%,rgba(14,14,16,.82)_45%,rgba(14,14,16,.25)_100%)]" aria-hidden />
      <span className="absolute inset-0 flex items-center gap-3 px-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl bg-neon text-ink" aria-hidden><Icon name="gamepad" size={24} strokeWidth={2} /></span>
        <span className="min-w-0 flex-1"><span className="block font-display text-lg font-bold uppercase leading-tight">Jogos & Torneios</span><span className="block truncate text-[12px] text-white/75">{sub}</span></span>
        <Icon name="chevron" size={20} strokeWidth={2.4} className="text-neon2" />
      </span>
    </Link>
  );
}

/** Grelha/prateleira de jogos com capa real (Explorar). */
export function GameTiles() {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
      {GAME_KEYS.map((k) => (
        <Link key={k} href={`/jogos/${k}/`} className="card-hover relative block aspect-[4/5] w-[30%] min-w-[104px] shrink-0 snap-start overflow-hidden rounded-ctl border border-white/10 md:w-auto">
          <GameCover game={k} sizes="(min-width: 768px) 140px, 30vw" />
          <span className="absolute inset-x-0 bottom-0 p-2 text-[13px] font-semibold leading-tight drop-shadow">{GAMES_CFG[k].short}</span>
        </Link>
      ))}
    </div>
  );
}
