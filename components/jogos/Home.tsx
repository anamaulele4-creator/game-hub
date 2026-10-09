'use client';

import Link from 'next/link';
import { useStore } from '@/lib/store';
import { GAMES_CFG, GAME_KEYS, HOME_EXAMPLE_FLYERS, MAIN_GAMES, fmtWhen, gameKeyOf, mtOrTba } from '@/lib/jogos';
import { Carousel, GameIcon, Slide, TzShell } from '@/components/jogos/Kit';
import { GameCover } from '@/components/GameArt';

// Ecrã inicial da plataforma TXAPZONE (cópia fiel do protótipo): carrossel de 4 flyers + "Categorias populares".
// Usado em / (página inicial) e em /jogos.
export default function TzHome() {
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
      cta: `Entrar em ${g.short}`, href: `/jogos/${k}/`, example: !t, game: k,
    };
  });

  return (
    <TzShell>
      <main className="tz-wrap pb-16 pt-5">
        <h1 className="sr-only">TXAPZONE · Torneios, recargas e marketplace</h1>
        <Carousel slides={slides} label="Torneios em destaque" />

        <div className="mb-3 mt-9 flex items-end justify-between gap-3">
          <h2 className="tz-h2">Categorias populares</h2>
          <span className="tz-dim hidden text-xs sm:inline">{open.length ? `${open.length} torneio${open.length > 1 ? 's' : ''} com inscrições abertas` : 'Escolhe o teu jogo'}</span>
        </div>
        <div className="tz-noscroll -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-5">
          {GAME_KEYS.map((k) => {
            const g = GAMES_CFG[k];
            const n = open.filter((t) => gameKeyOf(t.game) === k).length;
            return (
              <Link key={k} href={`/jogos/${k}/`} className="tz-game group relative flex w-[46%] min-w-[150px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-[#FFFFFF1F] bg-[#16181F] transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[#FFC107]/60 md:w-auto">
                <span className="relative block aspect-[4/3] w-full overflow-hidden">
                  <GameCover game={k} sizes="(min-width: 1024px) 220px, (min-width: 768px) 33vw, 46vw" className="transition-transform duration-500 group-hover:scale-[1.04]" />
                  {n > 0 && <span className="absolute left-2 top-2 rounded-full bg-[#FFC107] px-2 py-0.5 text-[11px] font-bold text-[#0E0F13]">{n} aberto{n > 1 ? 's' : ''}</span>}
                </span>
                <span className="flex items-center gap-2.5 p-2.5">
                  <GameIcon g={g} size={34} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight line-clamp-2">{g.name}</span>
                    <span className="tz-dim hidden truncate text-[11.5px] sm:block">Torneios · Recargas · Loja</span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </main>
    </TzShell>
  );
}
