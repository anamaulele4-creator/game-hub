'use client';

import Link from 'next/link';
import { useStore } from '@/lib/store';
import { GAMES_CFG, GAME_KEYS, HOME_EXAMPLE_FLYERS, MAIN_GAMES, fmtWhen, gameKeyOf, mtOrTba } from '@/lib/jogos';
import { Carousel, Slide, TzShell } from '@/components/jogos/Kit';
import { GameArt } from '@/components/GameArt';
import { GAME_ART } from '@/lib/gameArt';

// Ecrã inicial TXAPZONE (cópia fiel do protótipo): carrossel de 4 flyers + "Categorias populares".
export default function JogosHome() {
  const { s } = useStore();
  const open = s.admin.tournaments.filter((t) => t.status === 'aberto');

  // 4 flyers, um por jogo principal: o próximo torneio real com inscrições abertas; senão o flyer de exemplo do protótipo.
  const slides: Slide[] = MAIN_GAMES.map((k) => {
    const g = GAMES_CFG[k];
    const t = open.filter((x) => gameKeyOf(x.game) === k).sort((a, b) => a.date.localeCompare(b.date))[0];
    const ex = HOME_EXAMPLE_FLYERS[k];
    return {
      key: k, tag: g.tag, tagBg: g.color, tagFg: g.onColor,
      title: t ? t.name : ex.title,
      sub: t ? `${t.mode} · ${fmtWhen(t.date)} · Prémio ${mtOrTba(t.prize)}` : ex.sub,
      cta: `Entrar em ${g.short}`, href: `/jogos/${k}/`, example: !t, art: GAME_ART[k],
    };
  });

  return (
    <TzShell>
      <main className="tz-wrap pb-16 pt-5">
        <h1 className="sr-only">TXAPZONE · Jogos e torneios</h1>
        <Carousel slides={slides} label="Torneios em destaque" />

        <h2 className="tz-h2 mb-3 mt-8">Categorias populares</h2>
        <div className="tz-noscroll -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
          {GAME_KEYS.map((k) => {
            const g = GAMES_CFG[k];
            return (
              <Link key={k} href={`/jogos/${k}/`} className="tz-card tz-tile flex w-40 shrink-0 flex-col gap-2.5 p-2 md:w-auto">
                <span className="tz-cover relative block aspect-[4/3] w-full"><GameArt id={GAME_ART[k]} shade="none" sizes="(min-width: 768px) 220px, 160px" /></span>
                <span className="flex items-center gap-2 px-0.5 pb-0.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold" style={{ background: g.color, color: g.onColor }}>{g.abbr}</span>
                  <span className="truncate text-sm font-semibold">{g.name}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </main>
    </TzShell>
  );
}
