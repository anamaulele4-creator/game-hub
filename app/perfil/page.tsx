'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CLIPS, Clip, LIVES, POSTS, divisionFor, levelFor, mzn } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { Sheet } from '@/components/ui';
import { ProfileSkeleton, ProfileTopBar, ProfileView } from '@/components/Social';
import { isGame, type ProfileInfo } from '@/lib/social';
import { AccountRows, AccountSheets } from '@/components/AccountSwitcher';
import { InstallMenuRow } from '@/components/Install';

const MENU: [string, string, string][] = [
  ['/definicoes', '⚙️', 'Definições e privacidade'],
  ['/poipak-ia', '🩺', 'TXAPILOG IA'],
  ['/ranking', '📊', 'Ranking semanal'],
  ['/idolos', '💜', 'Ídolos'],
  ['/missoes', '🎯', 'Missões, XP e sequência'],
  ['/conquistas', '🏅', 'Conquistas'],
  ['/guardados', '🔖', 'Guardados'],
  ['/desafios', '⚔️', 'Desafios'],
  ['/bem-estar', '🧘', 'Bem-estar'],
  ['/planos', '👑', 'Planos'],
  ['/monetizacao', '💰', 'Monetização'],
  ['/seguranca', '🔐', 'Segurança'],
  ['/mais', '☰', 'Tudo no TXAPILOG'],
];

export default function PerfilPage() {
  const { s, ready } = useStore();
  const [menu, setMenu] = useState(false);
  const [buys, setBuys] = useState(false);
  const [acc, setAcc] = useState<'' | 'switch' | 'out'>('');
  const [uid, setUid] = useState(IS_DEMO ? 'me' : '');
  const [mine, setMine] = useState<Clip[] | null>(null);
  const [extra, setExtra] = useState<ProfileInfo | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (IS_DEMO) { setMine(CLIPS.filter((c) => c.idolId === 'me')); return; }
    let alive = true;
    void import('@/lib/dm').then((m) => m.myId()).then(async (id) => {
      if (!alive || !id) return;
      setUid(id);
      const sm = await import('@/lib/social');
      const p = await sm.fetchProfile(id);
      if (alive) setExtra(p);
    });
    void import('@/lib/clips').then((m) => m.myClips()).then((l) => { if (alive) setMine(l); }).catch(() => { if (alive) setMine([]); });
    return () => { alive = false; };
  }, [ready, s.account.loggedIn]);

  const d = divisionFor(s.xp);
  const lv = levelFor(s.xp);
  const games = Array.from(new Set([...(extra?.games ?? []), ...s.account.interests.filter(isGame)])).filter(Boolean).slice(0, 4);
  const p: ProfileInfo = {
    id: uid || 'me', name: s.user.name, handle: s.user.handle, avatar: s.user.avatar, bio: s.user.bio,
    game: games[0] ?? '', games, color: '#FFC20E', followers: extra?.followers ?? 0, followingCount: s.following.length,
    verified: extra?.verified ?? false, division: d.name, rank: 0, achievements: [], role: extra?.role ?? (s.user.role === 'admin' ? 'admin' : 'user'), team: extra?.team,
  };
  const items = MENU.filter(([h]) => h !== '/admin' || s.user.role === 'admin');

  return (
    <>
      <ProfileTopBar handle={s.user.handle || s.user.name} verified={p.verified}
        right={<>
          <Link href="/publicar" className="flex h-11 w-11 items-center justify-center rounded-full text-2xl" aria-label="Publicar"><span className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-white/85 text-lg font-bold leading-none">+</span></Link>
          <button type="button" onClick={() => setMenu(true)} className="flex h-11 w-11 items-center justify-center rounded-full text-xl" aria-label="Menu">☰</button>
        </>} />
      {!ready ? <ProfileSkeleton /> : (
        <ProfileView p={p} own clips={mine} posts={POSTS.filter((x) => x.idolId === uid)} lives={LIVES.filter((l) => l.idolId === uid)} />
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title="Menu">
        <Link href="/missoes" onClick={() => setMenu(false)} className="mb-3 flex items-center gap-3 rounded-xl bg-panel2 p-3">
          <span className="text-2xl">{d.emoji}</span>
          <span className="flex-1"><span className="block text-sm font-semibold">Nível {lv.level} · {d.name}</span>
            <span className="mt-1 block h-1.5 rounded bg-bg"><span className="block h-1.5 rounded bg-neon" style={{ width: `${lv.pct}%` }} /></span></span>
          <span className="text-xs text-white/60">🔥 {s.streak} · 🪙 {s.coins}</span>
        </Link>
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-panel2">
          <InstallMenuRow onNavigate={() => setMenu(false)} />
          {items.map(([h, e, l]) => <li key={h}><Link href={h} onClick={() => setMenu(false)} className="flex min-h-[48px] items-center gap-3 px-3"><span className="w-6 text-center text-lg">{e}</span><span className="flex-1 text-sm">{l}</span><span className="text-white/30">›</span></Link></li>)}
          <li><button type="button" onClick={() => { setMenu(false); setBuys(true); }} className="flex min-h-[48px] w-full items-center gap-3 px-3 text-left"><span className="w-6 text-center text-lg">🧾</span><span className="flex-1 text-sm">Compras, planos e bilhetes</span><span className="text-white/30">›</span></button></li>
          {s.user.role === 'admin' && <li><Link href="/admin" onClick={() => setMenu(false)} className="flex min-h-[48px] items-center gap-3 px-3"><span className="w-6 text-center text-lg">🛠️</span><span className="flex-1 text-sm">Painel de administração</span><span className="text-white/30">›</span></Link></li>}
        </ul>
        <AccountRows onSwitch={() => { setMenu(false); setAcc('switch'); }} onSignOut={() => { setMenu(false); setAcc('out'); }} />
      </Sheet>

      <AccountSheets sheet={acc} onClose={() => setAcc('')} />
      <Purchases open={buys} onClose={() => setBuys(false)} />
    </>
  );
}

function Purchases({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, set, toast } = useStore();
  return (
    <Sheet open={open} onClose={onClose} title="Compras, planos e bilhetes">
      <h4 className="mb-2 text-sm font-bold">💳 Planos ativos</h4>
      <div className="mb-4 space-y-2 rounded-xl bg-panel2 p-3 text-sm">
        {s.plans.length === 0 && <p className="text-white/60">Plano grátis. <Link href="/planos" className="text-neon2">Ver planos</Link></p>}
        {s.plans.map((p) => (
          <div key={p} className="flex items-center justify-between"><span className="capitalize">{p}</span>
            <button className="min-h-[44px] text-xs text-pink underline" onClick={() => { set((x) => ({ ...x, plans: x.plans.filter((y) => y !== p) })); toast('Plano cancelado. Sem custos adicionais.'); }}>Cancelar</button></div>
        ))}
      </div>
      <h4 className="mb-2 text-sm font-bold">🎟️ Bilhetes</h4>
      <div className="mb-4 space-y-2 rounded-xl bg-panel2 p-3 text-sm">
        {s.tickets.length === 0 && <p className="text-white/60">Sem bilhetes. <Link href="/eventos" className="text-neon2">Ver eventos</Link></p>}
        {s.tickets.map((t) => { const e = s.admin.events.find((x) => x.id === t.eventId); return <div key={t.id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{e?.emoji ?? '🎟️'} {e?.name ?? 'Evento'} · {t.tier} × {t.qty}</span><span className="font-mono text-[11px] text-neon2">#{t.id.slice(-6)}</span></div>; })}
      </div>
      <h4 className="mb-2 text-sm font-bold">🧾 Compras</h4>
      <div className="space-y-2 rounded-xl bg-panel2 p-3 text-sm">
        {s.purchases.length === 0 && <p className="text-white/60">Nenhuma compra ainda.</p>}
        {s.purchases.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0"><p className="truncate">{p.item}</p><p className="text-xs text-white/50">{p.date} · {p.method}{p.status === 'cancelado' ? ' · cancelado' : ''}</p></div>
            <div className="text-right"><p className="font-semibold">{mzn(p.total)}</p>
              {p.status !== 'cancelado' && <button className="text-xs text-pink underline" onClick={() => { set((x) => ({ ...x, purchases: x.purchases.map((y) => (y.id === p.id ? { ...y, status: 'cancelado' } : y)) })); toast('Compra cancelada'); }}>Cancelar</button>}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
