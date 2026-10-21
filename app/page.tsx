'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Page, TournamentCard, CategoryBar } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { GameArt } from '@/components/GameArt';
import { TeamBadge } from '@/components/TeamBadge';
import { GAME_ART } from '@/lib/gameArt';
import { GAMES_CFG, GAME_KEYS, MAIN_GAMES, fmtWhen, gameKeyOf, mtOrTba } from '@/lib/jogos';
import { UpcomingView, upcomingMatches } from '@/lib/upcomingMatches';
import { fmtKick } from '@/lib/fmtKick';
import type { Slide } from '@/components/jogos/Kit';
import { HomeCarousel } from '@/components/HomeCarousel';

const CATS = [
  { href: '/jogos', label: 'Jogos', icon: 'gamepad' as const },
  { href: '/torneios', label: 'Torneios', icon: 'trophy' as const },
  { href: '/desafios', label: 'Desafios', icon: 'sparkle' as const },
  { href: '/marketplace', label: 'Marketplace', icon: 'star' as const },
  { href: '/notificacoes', label: 'Avisos', icon: 'bell' as const },
  { href: '/perfil', label: 'Perfil', icon: 'user' as const },
];

const QUICK = [
  { href: '/torneios', label: 'Torneios abertos', icon: 'trophy' as const },
  { href: '/desafios', label: 'Desafios', icon: 'sparkle' as const },
  { href: '/jogos', label: 'Todos os jogos', icon: 'gamepad' as const },
  { href: '/marketplace', label: 'Marketplace', icon: 'star' as const },
];

/** Sem torneios reais abertos: um único destaque da marca, sem datas nem "dados de exemplo". */
const BRAND_SLIDE: Slide = {
  key: 'txapzone', tag: 'TxapZone', tagBg: '#FFC20E', tagFg: '#0B1B4D',
  title: 'Campeonatos de gaming', sub: 'Torneios, desafios e marketplace de Free Fire, Clash Royale, eFootball, DLS e outros jogos.',
  cta: 'Ver torneios', href: '/torneios', art: GAME_ART.ff,
};

export default function Inicio() {
  const { s, ready } = useStore();
  const [games, setGames] = useState<UpcomingView | null>(null);

  useEffect(() => {
    if (!ready) return;
    upcomingMatches(8).then(setGames).catch(() => setGames(null));
  }, [ready]);

  const open = s.admin.tournaments.filter((t) => t.status === 'aberto').slice(0, 6);
  // Só torneios reais com inscrições abertas (os flyers de exemplo datados foram retirados).
  const real: Slide[] = MAIN_GAMES.flatMap((k) => {
    const g = GAMES_CFG[k];
    const t = s.admin.tournaments
      .filter((x) => x.status === 'aberto' && gameKeyOf(x.game) === k)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!t) return [];
    return [{
      key: k, tag: g.tag, tagBg: g.color, tagFg: g.onColor,
      title: t.name, sub: `${t.mode} · ${fmtWhen(t.date)} · Prémio ${mtOrTba(t.prize)}`,
      cta: `Entrar em ${g.short}`, href: `/jogos/${k}/`, art: GAME_ART[k],
    }];
  });
  const slides: Slide[] = real.length ? real : [BRAND_SLIDE];
  const now = Date.now();
  const upcoming = (games?.matches ?? [])
    .filter((m) => new Date(m.startsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 8);

  return (
    <Page>
      {/* Carrossel */}
      <HomeCarousel slides={slides} label="Torneios em destaque" />

      {/* Jogos em destaque: só aparece quando há jogos agendados (sem odds) */}
      {upcoming.length > 0 && games && (
        <section className="mb-6">
          <h2 className="mb-2.5 flex items-center gap-2 font-display text-lg font-bold uppercase text-neon2"><Icon name="star" size={18} />Jogos em destaque</h2>
          <div className="no-scrollbar -mx-4 flex snap-x scroll-pl-4 gap-3 overflow-x-auto px-4 sm:-mx-6 sm:scroll-pl-6 sm:px-6 lg:-mx-7 lg:scroll-pl-7 lg:px-7">
            {upcoming.map((m) => (
              <Link key={m.id} href={`/jogos/${GAMES_CFG[m.game] ? m.game : 'outros'}/`} className="card w-[280px] shrink-0 snap-start !p-3.5">
                <p className="text-xs font-semibold text-white/60">{fmtKick(m.startsAt)}</p>
                <p className="mb-2 truncate text-xs text-white/60">{GAMES_CFG[m.game]?.name}{m.tournamentName ? ` · ${m.tournamentName}` : ''}</p>
                <div className="space-y-1.5 font-bold">
                  <span className="flex items-center gap-2"><TeamBadge name={m.home} logo={games.logos[m.homeTeamId]} size={26} /><span className="truncate">{m.home}</span></span>
                  <span className="flex items-center gap-2"><TeamBadge name={m.away} logo={games.logos[m.awayTeamId]} size={26} /><span className="truncate">{m.away}</span></span>
                </div>
              </Link>
            ))}
          </div>
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