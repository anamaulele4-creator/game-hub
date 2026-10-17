'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Page, TournamentCard, CategoryBar } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { GameArt } from '@/components/GameArt';
import { TeamBadge } from '@/components/TeamBadge';
import { ListingCard, useMarketCfg } from '@/components/market/Kit';
import { GAME_ART } from '@/lib/gameArt';
import { GAMES_CFG, GAME_KEYS, HOME_EXAMPLE_FLYERS, MAIN_GAMES, fmtWhen, gameKeyOf, mtOrTba } from '@/lib/jogos';
import { fmtOdds } from '@/lib/bets';
import { BetsView, betsApi } from '@/lib/betsApi';
import { Listing, marketApi } from '@/lib/marketApi';
import { fmtKick } from '@/components/bets/Bets';
import { IS_DEMO } from '@/lib/config';
import type { Slide } from '@/components/jogos/Kit';
import { HomeCarousel } from '@/components/HomeCarousel';
import { HomeMarket } from '@/components/HomeMarket';

const CATS = [
  { href: '/jogos', label: 'Jogos', icon: 'gamepad' as const },
  { href: '/torneios', label: 'Torneios', icon: 'trophy' as const },
  { href: '/apostas', label: 'Apostas', icon: 'chart' as const },
  { href: '/marketplace', label: 'Marketplace', icon: 'star' as const },
  { href: '/notificacoes', label: 'Avisos', icon: 'bell' as const },
  { href: '/perfil', label: 'Perfil', icon: 'user' as const },
];

const QUICK = [
  { href: '/torneios', label: 'Torneios abertos', icon: 'trophy' as const },
  { href: '/apostas', label: 'Apostas de hoje', icon: 'calendar' as const },
  { href: '/jogos', label: 'Todos os jogos', icon: 'gamepad' as const },
  { href: '/marketplace', label: 'Marketplace', icon: 'star' as const },
];

export default function Inicio() {
  const { s, ready } = useStore();
  const { rates } = useMarketCfg();
  const [bets, setBets] = useState<BetsView | null>(null);
  const [market, setMarket] = useState<Listing[] | null>(null);

  useEffect(() => {
    if (!ready) return;
    betsApi.load().then(setBets).catch(() => setBets(null));
    marketApi.listings({ limit: 40 }).then(setMarket).catch(() => setMarket([]));
  }, [ready]);

  const logged = IS_DEMO || s.account.loggedIn;
  const open = s.admin.tournaments.filter((t) => t.status === 'aberto').slice(0, 6);
  const slides: Slide[] = MAIN_GAMES.map((k) => {
  const g = GAMES_CFG[k];
  const t = s.admin.tournaments
    .filter((x) => x.status === 'aberto' && gameKeyOf(x.game) === k)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const ex = HOME_EXAMPLE_FLYERS[k];
  return {
    key: k, tag: g.tag, tagBg: g.color, tagFg: g.onColor,
    title: t ? t.name : ex.title,
    sub: t ? `${t.mode} · ${fmtWhen(t.date)} · Prémio ${mtOrTba(t.prize)}` : ex.sub,
    cta: `Entrar em ${g.short}`, href: `/jogos/${k}/`, example: !t, art: GAME_ART[k],
  };
});
  const now = Date.now();
  const upcoming = (bets?.settings.betsEnabled ? bets.matches : [])
    .filter((m) => m.status === 'agendado' && new Date(m.startsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 8);
  const highlights = market ? [...market.filter((l) => l.featured), ...market.filter((l) => !l.featured)].slice(0, 24) : null;

  return (
    <Page>
 

     {/* 2. Carrossel */}
<HomeCarousel slides={slides} label="Torneios em destaque" />

      
{/* 3. Destaques do marketplace (sobre o carrossel) */}
<HomeMarket listings={highlights} className="relative z-10 mb-8 -mt-24 lg:-mt-28"/>
      {/* 4. Jogos em destaque: cartões com odds 1 X 2 */}
      {bets?.settings.betsEnabled !== false && (
        <section className="mb-6">
          <h2 className="mb-2.5 flex items-center gap-2 font-display text-lg font-bold uppercase text-neon2"><Icon name="star" size={18} />Jogos em destaque</h2>
          {!bets ? <div className="card h-40 animate-pulse" /> : upcoming.length === 0 ? <p className="card text-sm text-white/70">Sem jogos agendados.</p> : (
            <div className="no-scrollbar -mx-4 flex snap-x scroll-pl-4 gap-3 overflow-x-auto px-4 sm:-mx-6 sm:scroll-pl-6 sm:px-6 lg:-mx-7 lg:scroll-pl-7 lg:px-7">
              {upcoming.map((m) => {
                const mk = bets.markets.find((x) => x.matchId === m.id && (x.kind === '1x2' || x.kind === '12') && x.status === 'aberto');
                const sels = mk ? bets.selections.filter((x) => x.marketId === mk.id).sort((a, b) => a.sort - b.sort) : [];
                return (
                  <Link key={m.id} href="/apostas" className="card w-[280px] shrink-0 snap-start !p-3.5">
                    <p className="text-xs font-semibold text-white/60">{fmtKick(m.startsAt)}{m.example ? ' · exemplo' : ''}</p>
                    <p className="mb-2 truncate text-xs text-white/60">{GAMES_CFG[m.game]?.name}</p>
                    <div className="mb-3 space-y-1.5 font-bold">
                      <span className="flex items-center gap-2"><TeamBadge name={m.home} logo={bets.teams[m.homeTeamId]?.logo} size={26} /><span className="truncate">{m.home}</span></span>
                      <span className="flex items-center gap-2"><TeamBadge name={m.away} logo={bets.teams[m.awayTeamId]?.logo} size={26} /><span className="truncate">{m.away}</span></span>
                    </div>
                    {sels.length > 0 && (
                      <span className={`grid gap-1.5 ${sels.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        {sels.map((x) => (
                          <span key={x.id} className="flex min-h-[48px] flex-col items-center justify-center rounded-lg border border-line bg-panel2">
                            <span className="text-[11px] text-white/60">{x.code}</span>
                            <b className="stat-num text-[15px] text-neon2">{fmtOdds(x.odds)}</b>
                          </span>
                        ))}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
          <Link href="/apostas" className="mt-2 inline-block min-h-[44px] content-center text-sm font-semibold text-neon2">Ver todas as apostas</Link>
        </section>
      )}

      {/* 5. Torneios abertos */}
      <section className="mb-7">
        <SectionHead title="Torneios abertos" href="/torneios" />
        {open.length === 0
          ? <p className="card text-sm text-white/70">Sem torneios abertos neste momento.</p>
          : <div className="grid gap-3 sm:grid-cols-2">{open.map((t) => <TournamentCard key={t.id} t={t} />)}</div>}
      </section>

      {/* 6. Jogos (grelha) */}
      <section className="mb-7">
        <SectionHead title="Jogos" href="/jogos" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {GAME_KEYS.map((k) => (
            <Link key={k} href={`/jogos/${k}`} className="game-tile relative block aspect-[4/3] overflow-hidden">
              <GameArt id={GAME_ART[k]} shade="bottom" sizes="(min-width: 1024px) 220px, 48vw" />
              <span className="absolute inset-x-0 bottom-0 p-2.5 font-display text-[17px] font-bold leading-tight">{GAMES_CFG[k].name}</span>
            </Link>
          ))}
        </div>
      </section>

    
    </Page>
  );
}

function SectionHead({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="sec-title">{title}</h2>
      <Link href={href} className="min-h-[44px] content-center text-sm font-semibold text-neon2">Ver tudo</Link>
    </div>
  );
}