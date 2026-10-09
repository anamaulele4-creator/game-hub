'use client';

import Link from 'next/link';
import { useStore } from '@/lib/store';
import { GAMES_CFG, GAME_KEYS, MAIN_GAMES, fmtWhen, gameKeyOf, mtOrTba } from '@/lib/jogos';
import { Carousel, JogosHeader, Slide } from '@/components/jogos/Kit';

export default function JogosHome() {
  const { s, ready } = useStore();
  const open = s.admin.tournaments.filter((t) => t.status === 'aberto');

  // 4 flyers, um por jogo principal: o próximo torneio real com inscrições abertas, ou "a anunciar".
  const slides: Slide[] = MAIN_GAMES.map((k) => {
    const g = GAMES_CFG[k];
    const t = open.filter((x) => gameKeyOf(x.game) === k).sort((a, b) => a.date.localeCompare(b.date))[0];
    return {
      key: k, tag: g.tag, tagCls: g.tagCls, cover: g.cover, emoji: g.emoji,
      title: t ? t.name : `Torneios ${g.short}`,
      sub: t ? `${t.mode} · ${fmtWhen(t.date)} · Prémio ${mtOrTba(t.prize)}` : (ready ? 'Próximo torneio: a anunciar · Prémio: a anunciar' : 'A carregar torneios…'),
      cta: `Entrar em ${g.short}`, href: `/jogos/${k}/`,
    };
  });

  return (
    <>
      <JogosHeader />
      <main className="px-4 pb-28 pt-4">
        <h1 className="mb-3 font-display text-2xl font-bold uppercase tracking-wide">🎮 Jogos & Torneios</h1>
        <Carousel slides={slides} label="Torneios em destaque" />

        <h2 className="sec-title mb-3 mt-6">Categorias populares</h2>
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
          {GAME_KEYS.map((k) => {
            const g = GAMES_CFG[k];
            const n = open.filter((x) => gameKeyOf(x.game) === k).length;
            return (
              <Link key={k} href={`/jogos/${k}/`} className="w-32 shrink-0 overflow-hidden rounded-2xl border border-line bg-panel transition-transform active:scale-95 motion-reduce:transform-none">
                <span className={`flex h-24 items-center justify-center bg-gradient-to-br ${g.cover}`} aria-hidden>
                  <span className="font-display text-4xl font-bold text-white drop-shadow">{g.abbr}</span>
                </span>
                <span className="block p-2.5">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${g.tagCls}`}>{g.abbr}</span>
                  <span className="mt-1 block truncate text-sm font-semibold">{g.name}</span>
                  <span className="block text-[11px] text-white/55">{ready ? (n ? `${n} com inscrições abertas` : 'Sem torneios abertos') : '…'}</span>
                </span>
              </Link>
            );
          })}
        </div>
        <p className="mt-4 text-center text-xs text-white/45">Torneios publicados pela equipa TXAPILOG. Pagamentos M-Pesa/e-Mola em breve.</p>
      </main>
    </>
  );
}
