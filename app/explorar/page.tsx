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
      <Link href="/pesquisa" className="mb-4 flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-panel2 px-3.5 text-white/60">🔍 <span className="min-w-0 truncate">Pesquisar ídolos, clipes, torneios…</span></Link>

      <Link href="/jogos" className="mb-5 flex min-h-[64px] items-center gap-3 hud-card px-3.5 py-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-neon text-xl text-ink" aria-hidden>🎮</span>
        <span className="min-w-0 flex-1"><span className="block font-display text-lg font-bold uppercase leading-tight">Jogos & Torneios</span><span className="block truncate text-[12px] text-white/65">Free Fire, Clash Royale, eFootball, DLS e mais</span></span>
        <span className="text-white/50" aria-hidden>›</span>
      </Link>
      <div className="mb-5 grid grid-cols-4 gap-2">
        {SHORTCUTS.map(([h, e, l]) => (
          <Link key={h} href={h} className="hud-clip flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-md bg-panel text-center text-[12px] font-semibold text-white/90 shadow-[inset_0_0_0_1px_#3A5AB4,inset_0_-2px_0_rgba(255,194,14,.5)] transition-transform active:scale-95 [--cut:8px]"><span className="text-xl">{e}</span>{l}</Link>
        ))}
      </div>

      {s.user.role === 'admin' && (
        <Link href="/core" className="mb-5 flex min-h-[56px] items-center gap-3 hud-card px-3.5 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neon text-sm font-black text-ink">AI</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-bold">TXAPILOG AI CORE</span><span className="block truncate text-[12px] text-white/65">Jogadores Free Fire, equipas, torneios e IA · admin</span></span>
          <span className="text-white/50" aria-hidden>›</span>
        </Link>
      )}

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
              <div className="mb-2 flex items-center justify-between"><h2 className="font-display text-lg font-bold uppercase tracking-wide">🔴 Ao vivo agora</h2><Link href="/lives" className="text-sm text-neon2">Ver tudo</Link></div>
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
              <div className="mb-2 flex items-center justify-between"><h2 className="font-display text-lg font-bold uppercase tracking-wide">💜 Ídolos</h2><Link href="/idolos" className="text-sm text-neon2">Ver tudo</Link></div>
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">{IDOLS.slice(0, 12).map((i) => <IdolChip key={i.id} i={i} />)}</div>
            </section>
          )}
          {tours.length > 0 && (
            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between"><h2 className="font-display text-lg font-bold uppercase tracking-wide">🏆 Torneios abertos</h2><Link href="/torneios" className="text-sm text-neon2">Ver tudo</Link></div>
              <div className="space-y-3">{tours.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
            </section>
          )}
        </>
      )}
    </Page>
  );
}
