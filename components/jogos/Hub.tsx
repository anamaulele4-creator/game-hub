'use client';

// Ecrãs de separador da TXAPZONE (Torneios, Recargas, Marketplace): escolher o jogo e saltar para o separador certo.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { GAMES_CFG, GAME_KEYS, GameKey, fmtWhen, gameKeyOf, mtOrTba } from '@/lib/jogos';
import { GameCover, TournamentCover } from '@/components/GameArt';
import { GameIcon, PaySoon, TzShell, TzSkeleton } from './Kit';
import { Icon } from '@/components/icons';

export function TzTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-[26px] font-extrabold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
      <p className="tz-muted mt-1 max-w-xl text-sm">{sub}</p>
    </div>
  );
}

/** Grelha de jogos com capa real; cada cartão abre /jogos/[jogo]/#separador. */
export function GameGrid({ hash, line }: { hash: string; line: (k: GameKey) => string }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {GAME_KEYS.map((k) => {
        const g = GAMES_CFG[k];
        return (
          <Link key={k} href={`/jogos/${k}/#${hash}`} className="tz-game group flex flex-col overflow-hidden rounded-xl border border-[#FFFFFF1F] bg-[#16181F] transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[#FFC107]/60">
            <span className="relative block aspect-[4/3] w-full overflow-hidden">
              <GameCover game={k} sizes="(min-width: 1024px) 220px, (min-width: 768px) 33vw, 50vw" className="transition-transform duration-500 group-hover:scale-[1.04]" />
            </span>
            <span className="flex items-center gap-2.5 p-2.5">
              <GameIcon g={g} size={34} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight line-clamp-2">{g.name}</span>
                <span className="tz-dim block truncate text-[11.5px]">{line(k)}</span>
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function RecargasHub() {
  return (
    <TzShell>
      <main className="tz-wrap pb-16 pt-5">
        <TzTitle title="Recargas" sub="Escolhe o jogo, indica o teu ID de jogador e o pacote. Pagas com M-Pesa ou e-Mola." />
        <GameGrid hash="recargas" line={(k) => (k === 'outros' ? 'Outros jogos' : GAMES_CFG[k].currency)} />
        <PaySoon className="mt-6" />
      </main>
    </TzShell>
  );
}

export function MarketplaceHub() {
  const { s } = useStore();
  const n = s.cart.length;
  return (
    <TzShell>
      <main className="tz-wrap pb-16 pt-5">
        <TzTitle title="Marketplace" sub="Guias, coaching, packs para lives e design por jogo, e a loja oficial da TXAPZONE." />
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <Link href="/loja" className="tz-card flex min-h-[84px] items-center gap-4 p-4 transition-colors hover:border-[#FFC107]/60">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#FFC107]/15 text-[#FFC107]"><Icon name="store" size={24} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">Loja TXAPZONE</span><span className="tz-muted block text-[13px]">Produtos e merch oficiais</span></span>
            <span className="tz-dim text-xl" aria-hidden>›</span>
          </Link>
          <Link href="/checkout" className="tz-card flex min-h-[84px] items-center gap-4 p-4 transition-colors hover:border-[#FFC107]/60">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#1D1F28] text-[#FFFFFFB8]"><Icon name="cart" size={24} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">Carrinho</span><span className="tz-muted block text-[13px]">{n ? `${n} artigo${n > 1 ? 's' : ''}` : 'Vazio'}</span></span>
            <span className="tz-dim text-xl" aria-hidden>›</span>
          </Link>
        </div>
        <h2 className="tz-h2 mb-3">Por jogo</h2>
        <GameGrid hash="marketplace" line={(k) => `${GAMES_CFG[k].market.length} produtos`} />
      </main>
    </TzShell>
  );
}

const ST: { k: 'aberto' | 'a decorrer' | 'terminado' | 'inscrito'; l: string }[] = [
  { k: 'aberto', l: 'Inscrições abertas' }, { k: 'a decorrer', l: 'A decorrer' }, { k: 'terminado', l: 'Terminados' }, { k: 'inscrito', l: 'Inscrito' },
];

export function TorneiosHub() {
  const { s, ready } = useStore();
  const [st, setSt] = useState<(typeof ST)[number]['k']>('aberto');
  const [game, setGame] = useState<GameKey | 'todos'>('todos');
  const list = useMemo(() => s.admin.tournaments
    .filter((t) => (st === 'inscrito' ? s.entries.includes(t.id) : t.status === st))
    .filter((t) => game === 'todos' || gameKeyOf(t.game) === game)
    .sort((a, b) => a.date.localeCompare(b.date)), [s.admin.tournaments, s.entries, st, game]);
  return (
    <TzShell>
      <main className="tz-wrap pb-16 pt-5">
        <TzTitle title="Torneios" sub="Torneios grátis e pagos. A taxa de inscrição e o prémio são sempre mostrados antes de confirmares." />
        <div className="tz-noscroll -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {ST.map((x) => <button key={x.k} type="button" onClick={() => setSt(x.k)} aria-pressed={st === x.k} className="tz-chip">{x.l}</button>)}
        </div>
        <div className="tz-noscroll -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          <button type="button" onClick={() => setGame('todos')} aria-pressed={game === 'todos'} className="tz-chip">Todos os jogos</button>
          {GAME_KEYS.map((k) => <button key={k} type="button" onClick={() => setGame(k)} aria-pressed={game === k} className="tz-chip">{GAMES_CFG[k].short}</button>)}
        </div>
        {!ready ? (
          <div className="space-y-3" role="status" aria-busy="true" aria-label="A carregar torneios">{[0, 1, 2].map((k) => <TzSkeleton key={k} className="h-[84px]" />)}</div>
        ) : list.length === 0 ? (
          <div className="tz-card flex flex-col items-center gap-2 p-8 text-center">
            <Icon name="trophy" size={34} className="text-[#FFC107]" />
            <p className="text-[15px] font-semibold">Nada por aqui ainda</p>
            <p className="tz-muted max-w-sm text-sm">Quando a equipa publicar torneios nesta categoria, aparecem aqui com prémio, vagas e taxa.</p>
            <Link href="/" className="tz-btn-outline mt-1">Ver jogos</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {list.map((t) => {
              const k = gameKeyOf(t.game);
              const joined = s.entries.includes(t.id);
              return (
                <Link key={t.id} href={`/torneios/${t.id}/`} className="tz-card flex min-w-0 items-center gap-3 p-3.5 transition-colors hover:border-[#FFFFFF33] sm:p-4">
                  <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg sm:w-24"><TournamentCover t={t} sizes="96px" shade={false} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{t.name}</span>
                    <span className="tz-muted block truncate text-[13px]">{GAMES_CFG[k].short} · {t.mode} · {fmtWhen(t.date)}</span>
                    <span className="tz-dim mt-0.5 block text-xs">Prémio <span className="font-semibold text-[#FFC107]">{mtOrTba(t.prize)}</span> · Entrada {t.fee > 0 ? `${t.fee.toLocaleString('pt-PT')} MT` : 'Grátis'} · <span className="tabular-nums">{t.filled}/{t.slots}</span></span>
                  </span>
                  {joined ? <span className="shrink-0 rounded-lg bg-[#22C55E]/15 px-2.5 py-1.5 text-xs font-semibold text-[#4ADE80]">✓ Inscrito</span> : <span className="tz-btn-dark shrink-0">Ver</span>}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </TzShell>
  );
}
