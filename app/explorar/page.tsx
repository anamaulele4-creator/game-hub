'use client';

import Link from 'next/link';
import { CLIPS, IDOLS, LIVES } from '@/lib/data';
import { useStore } from '@/lib/store';
import { GAMES, byHot, byNew, clipType, feedHref, isLong } from '@/lib/feed';
import { IdolChip, LiveCard, Page, Shelf, TournamentCard } from '@/components/ui';

const SHORTCUTS: [string, string, string][] = [
  ['/lives', '📡', 'Lives'], ['/torneios', '🏆', 'Torneios'], ['/ranking', '📊', 'Ranking'], ['/idolos', '💜', 'Ídolos'],
  ['/videos', '📺', 'Vídeos'], ['/poipak-ia', '🩺', 'TXAPILOG IA'], ['/eventos', '🎟️', 'Eventos'], ['/mais', '☰', 'Mais'],
];

export default function Explorar() {
  const { s, ready } = useStore();
  const clips = CLIPS.filter((c) => !s.admin.hiddenClips.includes(c.id) && !s.blocked.includes(c.idolId));
  const short = clips.filter((c) => !isLong(c));
  const long = clips.filter(isLong);
  const lives = LIVES.filter((l) => (s.admin.liveStatus[l.id] ?? l.status ?? 'ao vivo') === 'ao vivo' && !s.blocked.includes(l.idolId));
  const tours = s.admin.tournaments.filter((t) => t.status === 'aberto').slice(0, 2);

  return (
    <Page title="Explorar">
      <Link href="/pesquisa" className="mb-4 flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-panel2 px-3.5 text-white/50">🔍 <span>Pesquisar ídolos, clipes, torneios…</span></Link>

      <div className="mb-5 grid grid-cols-4 gap-2">
        {SHORTCUTS.map(([h, e, l]) => (
          <Link key={h} href={h} className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border border-line bg-panel text-center text-[12px] text-white/85"><span className="text-xl">{e}</span>{l}</Link>
        ))}
      </div>

      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
        {[['em-alta', '🔥 Em alta'], ['memes', '😂 Memes'], ['fotos', '📷 Fotos'], ['videos', '🎬 Clipes'], ['momentos', '💭 Momentos'], ...GAMES.filter((g) => g !== 'Memes' && g !== 'Geral').map((g) => ['g:' + g, g])].map(([k, l]) => (
          <Link key={k} href={feedHref(k)} className="flex min-h-[40px] shrink-0 items-center rounded-full border border-line bg-panel2 px-3.5 text-sm text-white/85">{l}</Link>
        ))}
      </div>

      {!ready ? (
        <div className="grid grid-cols-3 gap-2">{Array.from({ length: 6 }).map((_, k) => <span key={k} className="skeleton aspect-[9/14] rounded-xl" />)}</div>
      ) : (
        <>
          {lives.length > 0 && (
            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-base font-bold">🔴 Ao vivo agora</h2><Link href="/lives" className="text-sm text-neon2">Ver tudo</Link></div>
              <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">{lives.map((l) => <LiveCard key={l.id} l={l} />)}</div>
            </section>
          )}
          {clips.length === 0 && <p className="card mb-5 text-center text-sm text-white/60">Ainda não há publicações para explorar. Volta mais tarde ou publica a primeira!</p>}
          <Shelf title="🔥 Em alta" href={feedHref('em-alta')} clips={byHot(short).slice(0, 12)} />
          <Shelf title="📺 Vídeos" href="/videos" clips={byNew(long)} wide />
          <Shelf title="😂 Memes" href={feedHref('memes')} clips={byNew(short.filter((c) => clipType(c) === 'meme'))} />
          <Shelf title="📷 Fotos" href={feedHref('fotos')} clips={byNew(short.filter((c) => clipType(c) === 'photo'))} />
          {GAMES.filter((g) => g !== 'Memes' && g !== 'Geral').map((g) => <Shelf key={g} title={g} href={feedHref('g:' + g)} clips={byHot(short.filter((c) => c.game === g))} />)}
          {IDOLS.length > 0 && (
            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-base font-bold">💜 Ídolos</h2><Link href="/idolos" className="text-sm text-neon2">Ver tudo</Link></div>
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">{IDOLS.slice(0, 12).map((i) => <IdolChip key={i.id} i={i} />)}</div>
            </section>
          )}
          {tours.length > 0 && (
            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-base font-bold">🏆 Torneios abertos</h2><Link href="/torneios" className="text-sm text-neon2">Ver tudo</Link></div>
              <div className="space-y-3">{tours.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
            </section>
          )}
        </>
      )}
    </Page>
  );
}
