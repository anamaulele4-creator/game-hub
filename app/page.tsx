'use client';

import Link from 'next/link';
import { PlayerStrip } from '@/components/Hud';
import { GamesBanner } from '@/components/GameArt';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLIPS, IDOLS, LIVES, POSTS, idol } from '@/lib/data';
import { useStore } from '@/lib/store';
import { useClipSound } from '@/lib/sound';
import { byHot } from '@/lib/feed';
import { SponsoredCard } from '@/components/Sponsored';
import { PublishSheet } from '@/components/PublishSheet';
import { FeedItem, FeedPost, FeedSkeleton, HomeTopBar, Story, StoriesRow } from '@/components/HomeFeed';

const PAGE = 6;

export default function Home() {
  const { s, ready } = useStore();
  const [muted, setMuted] = useClipSound();
  const [pub, setPub] = useState(false);
  const [n, setN] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const isLive = (id: string, status?: string) => (s.admin.liveStatus[id] ?? status ?? 'ao vivo') === 'ao vivo';
  const lives = LIVES.filter((l) => isLive(l.id, l.status) && !s.blocked.includes(l.idolId));
  const liveIds = new Set(lives.map((l) => l.idolId));
  const clips = CLIPS.filter((c) => !s.admin.hiddenClips.includes(c.id) && !s.blocked.includes(c.idolId) && c.status !== 'removed' && c.status !== 'processing');
  const posts = POSTS.filter((p) => !s.blocked.includes(p.idolId) && !s.admin.removed.includes(p.id));

  // Histórias: lives reais primeiro (anel "AO VIVO"), depois quem segues com publicações recentes (anel azul).
  const stories: Story[] = useMemo(() => {
    const out: Story[] = [];
    const seen = new Set<string>();
    for (const l of lives) { if (seen.has(l.idolId)) continue; seen.add(l.idolId); const i = idol(l.idolId); out.push({ key: 'l' + l.id, href: `/lives/${l.id}`, name: i.name, avatar: i.avatar, live: true }); }
    const recent = Date.now() - 7 * 86400000;
    const withPosts = new Set([
      ...clips.filter((c) => !c.createdAt || new Date(c.createdAt).getTime() > recent).map((c) => c.idolId),
      ...posts.map((p) => p.idolId),
    ]);
    for (const id of s.following) {
      if (seen.has(id) || !withPosts.has(id) || s.blocked.includes(id)) continue;
      seen.add(id);
      const i = idol(id);
      out.push({ key: 'f' + id, href: `/idolo/${id}`, name: i.name, avatar: i.avatar });
    }
    return out;
  }, [lives.length, clips.length, posts.length, s.following.join(), s.blocked.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feed numa coluna: quem segues primeiro, depois o resto por "em alta"; publicações de texto intercaladas.
  const feed: FeedItem[] = useMemo(() => {
    const fol = new Set(s.following);
    const ranked = byHot(clips);
    const ordered = [...ranked.filter((c) => fol.has(c.idolId)), ...ranked.filter((c) => !fol.has(c.idolId))];
    const out: FeedItem[] = [];
    let k = 0;
    ordered.forEach((c, i) => { out.push({ kind: 'clip', c }); if ((i + 1) % 3 === 0 && k < posts.length) out.push({ kind: 'post', p: posts[k++] }); });
    while (k < posts.length) out.push({ kind: 'post', p: posts[k++] });
    return out;
  }, [clips.length, posts.length, s.following.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mais publicações ao chegar ao fim (sem carregar tudo de uma vez num telemóvel modesto)
  useEffect(() => {
    const el = sentinel.current;
    if (!el || n >= feed.length) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setN((x) => x + PAGE); }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [n, feed.length]);

  const shown = feed.slice(0, n);
  const suggest = IDOLS.filter((i) => !s.following.includes(i.id) && !s.blocked.includes(i.id)).slice(0, 8);

  return (
    <>
      <HomeTopBar />
      <main className="pb-24">
        <StoriesRow stories={stories} onAdd={() => setPub(true)} loading={!ready} />
        <PlayerStrip />
        <div className="px-3 pt-3">
          <GamesBanner />
        </div>

        {!ready ? <FeedSkeleton /> : feed.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/25 text-3xl">📷</span>
            <p className="text-lg font-bold">Ainda não há publicações</p>
            <p className="text-sm text-white/60">Segue jogadores e criadores para veres os clipes, memes e fotos deles aqui. Ou sê o primeiro a publicar.</p>
            <div className="flex w-full max-w-xs gap-2">
              <button type="button" onClick={() => setPub(true)} className="btn flex-1">Publicar</button>
              <Link href="/explorar" className="btn-ghost flex-1">Explorar</Link>
            </div>
          </div>
        ) : (
          <>
            {s.following.length === 0 && suggest.length > 0 && (
              <section className="border-b border-line px-3 py-3">
                <div className="mb-2 flex items-center justify-between"><h2 className="sec-title !text-[15px]">Sugestões para seguir</h2><Link href="/idolos" className="min-h-[44px] content-center text-sm text-neon2">Ver tudo</Link></div>
                <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3">
                  {suggest.map((i) => <Link key={i.id} href={`/idolo/${i.id}`} className="w-24 shrink-0 rounded-xl border border-line bg-panel p-2 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-panel2 text-2xl">{/^(https?:|data:)/.test(i.avatar) ? <img src={i.avatar} alt="" loading="lazy" className="h-full w-full object-cover" /> : i.avatar}</span><span className="mt-1 block truncate text-xs font-semibold">{i.name}</span><span className="block truncate text-[11px] text-white/50">{i.game}</span></Link>)}
                </div>
              </section>
            )}
            {shown.map((it, k) => (
              <div key={it.kind === 'clip' ? it.c.id : 'p' + it.p.id}>
                <FeedPost item={it} muted={muted} setMuted={setMuted} liveIds={liveIds} />
                {k === 2 && <div className="border-b border-line px-3 py-3"><SponsoredCard slot="home-1" /></div>}
              </div>
            ))}
            <div ref={sentinel} />
            {n < feed.length ? <FeedSkeleton /> : (
              <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
                <span className="text-3xl">✅</span>
                <p className="text-sm font-semibold">Estás em dia</p>
                <p className="text-xs text-white/55">Viste todas as publicações recentes.</p>
                <Link href="/explorar" className="mt-2 min-h-[44px] content-center text-sm text-neon2">Descobrir mais em Explorar</Link>
              </div>
            )}
          </>
        )}
      </main>
      <PublishSheet open={pub} onClose={() => setPub(false)} />
    </>
  );
}
