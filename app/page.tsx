'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Page, TournamentCard } from '@/components/ui';
import { GameArt } from '@/components/GameArt';
import { TeamBadge } from '@/components/TeamBadge';
import { ListingCard, useMarketCfg } from '@/components/market/Kit';
import { GAME_ART } from '@/lib/gameArt';
import { GAMES_CFG, GAME_KEYS } from '@/lib/jogos';
import { fmtOdds } from '@/lib/bets';
import { BetsView, betsApi } from '@/lib/betsApi';
import { Listing, marketApi } from '@/lib/marketApi';
import { fmtKick } from '@/components/bets/Bets';

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

  const open = s.admin.tournaments.filter((t) => t.status === 'aberto').slice(0, 4);
  const now = Date.now();
  const upcoming = (bets?.settings.betsEnabled ? bets.matches : [])
    .filter((m) => m.status === 'agendado' && new Date(m.startsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4);
  const highlights = market ? [...market.filter((l) => l.featured), ...market.filter((l) => !l.featured)].slice(0, 6) : null;

  return (
    <Page>
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

      <section className="mb-7">
        <SectionHead title="Torneios abertos" href="/torneios" />
        {open.length === 0
          ? <p className="card text-sm text-white/70">Sem torneios abertos neste momento.</p>
          : <div className="grid gap-3 sm:grid-cols-2">{open.map((t) => <TournamentCard key={t.id} t={t} />)}</div>}
      </section>

      {bets?.settings.betsEnabled !== false && (
        <section className="mb-7">
          <SectionHead title="Jogos para apostar" href="/apostas" />
          {!bets ? <div className="card h-24 animate-pulse" /> : upcoming.length === 0 ? <p className="card text-sm text-white/70">Sem jogos agendados.</p> : (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {upcoming.map((m) => {
                const mk = bets.markets.find((x) => x.matchId === m.id && (x.kind === '1x2' || x.kind === '12') && x.status === 'aberto');
                const sels = mk ? bets.selections.filter((x) => x.marketId === mk.id).sort((a, b) => a.sort - b.sort) : [];
                return (
                  <li key={m.id}>
                    <Link href="/apostas" className="card flex flex-col gap-2.5 !p-3.5">
                      <span className="text-xs text-white/60">{GAMES_CFG[m.game]?.name} · {fmtKick(m.startsAt)}{m.example ? ' · exemplo' : ''}</span>
                      <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <span className="flex min-w-0 items-center gap-2"><TeamBadge name={m.home} logo={bets.teams[m.homeTeamId]?.logo} size={32} /><b className="truncate text-[14.5px]">{m.home}</b></span>
                        <span className="text-xs text-white/50">vs</span>
                        <span className="flex min-w-0 items-center justify-end gap-2"><b className="truncate text-[14.5px]">{m.away}</b><TeamBadge name={m.away} logo={bets.teams[m.awayTeamId]?.logo} size={32} /></span>
                      </span>
                      {sels.length > 0 && (
                        <span className={`grid gap-1.5 ${sels.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                          {sels.map((x) => <span key={x.id} className="flex items-center justify-between rounded-lg bg-panel2 px-2.5 py-1.5 text-[12.5px]"><span className="text-white/60">{x.code}</span><b className="stat-num text-neon2">{fmtOdds(x.odds)}</b></span>)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="bx mb-4">
        <SectionHead title="Destaques do marketplace" href="/marketplace" />
        {!highlights ? <div className="card h-24 animate-pulse" /> : highlights.length === 0 ? <p className="card text-sm text-white/70">Ainda sem anúncios.</p> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{highlights.map((l) => <ListingCard key={l.id} l={l} rates={rates} />)}</div>
        )}
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
