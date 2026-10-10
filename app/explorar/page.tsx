'use client';

import Link from 'next/link';
import { CLIPS, IDOLS, LIVES } from '@/lib/data';
import { useStore } from '@/lib/store';
import { GAMES, byHot, byNew, clipType, feedHref, isLong } from '@/lib/feed';
import { IdolChip, LiveCard, Page, Shelf, TournamentCard } from '@/components/ui';
import { Icon, IconName } from '@/components/Icons';
import { GameRail } from '@/components/GameRail';

const SHORTCUTS: [string, IconName, string][] = [
  ['/lives', 'live', 'Lives'], ['/torneios', 'trophy', 'Torneios'], ['/ranking', 'chart', 'Ranking'], ['/idolos', 'star', 'Ídolos'],
  ['/videos', 'tv', 'Vídeos'], ['/poipak-ia', 'sparkle', 'IA'], ['/eventos', 'calendar', 'Eventos'], ['/mais', 'menu', 'Mais'],
];

export default function Explorar() {
  const { s, ready } = useStore();
  const clips = CLIPS.filter((c) => !s.admin.hiddenClips.includes(c.id) && !s.blocked.includes(c.idolId));
  const short = clips.filter((c) => !isLong(c));
  const long = clips.filter(isLong);
  const lives = LIVES.filter((l) => (s.admin.liveStatus[l.id] ?? l.status ?? 'ao vivo') === 'ao vivo' && !s.blocked.includes(l.idolId));
  const tours = s.admin.tournaments.filter((t) => t.status === 'aberto').slice(0, 4);

  return (
    <Page title="Explorar">
      <Link href="/pesquisa" className="tap mb-5 flex min-h-[48px] items-center gap-2.5 rounded-[14px] border border-line bg-panel px-4 text-white/65"><Icon name="search" size={20} /><span className="min-w-0 truncate">Pesquisar ídolos, clipes, torneios…</span></Link>

      <GameRail title="Jogos & Torneios" />

      <div className="mb-6 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {SHORTCUTS.map(([h, ic, l]) => (
          <Link key={h} href={h} className="tap flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-[16px] border border-line bg-panel text-center text-[12px] font-semibold leading-tight text-white/85 hover:bg-panel2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neon/10 text-neon2"><Icon name={ic} size={20} /></span>{l}
          </Link>
        ))}
      </div>

      {s.user.role === 'admin' && (
        <Link href="/core" className="tap mb-6 flex min-h-[56px] items-center gap-3 hud-card px-3.5 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-neon text-sm font-black text-ink">AI</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-bold">TXAPILOG AI CORE</span><span className="block truncate text-[12px] text-white/65">Jogadores Free Fire, equipas, torneios e IA · admin</span></span>
          <Icon name="chevron" size={18} className="text-white/50" />
        </Link>
      )}

      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
        {[['em-alta', '🔥 Em alta'], ['memes', '😂 Memes'], ['fotos', '📷 Fotos'], ['videos', '🎬 Clipes'], ['momentos', '💭 Momentos'], ...GAMES.filter((g) => g !== 'Memes' && g !== 'Geral').map((g) => ['g:' + g, g])].map(([k, l]) => (
          <Link key={k} href={feedHref(k)} className="tap flex min-h-[44px] shrink-0 items-center rounded-full border border-line bg-panel px-4 text-sm text-white/85 hover:bg-panel2">{l}</Link>
        ))}
      </div>

      {!ready ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, k) => <span key={k} className="skeleton aspect-[9/14] rounded-[14px]" />)}</div>
      ) : (
        <>
          {lives.length > 0 && (
            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between"><h2 className="sec-title">Ao vivo agora</h2><Link href="/lives" className="flex min-h-[44px] items-center text-sm font-semibold text-neon2">Ver tudo</Link></div>
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
              <div className="mb-2 flex items-center justify-between"><h2 className="sec-title">Ídolos</h2><Link href="/idolos" className="flex min-h-[44px] items-center text-sm font-semibold text-neon2">Ver tudo</Link></div>
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">{IDOLS.slice(0, 12).map((i) => <IdolChip key={i.id} i={i} />)}</div>
            </section>
          )}
          {tours.length > 0 && (
            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between"><h2 className="sec-title">Torneios abertos</h2><Link href="/torneios" className="flex min-h-[44px] items-center text-sm font-semibold text-neon2">Ver tudo</Link></div>
              <div className="grid gap-3 sm:grid-cols-2">{tours.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
            </section>
          )}
        </>
      )}
    </Page>
  );
}
