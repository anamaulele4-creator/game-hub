'use client';

// Camada global do chat (carregada à parte): presença "online" e ecrã de chamada a chegar (atender / recusar).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { Avatar } from '../ui';
import type { RingPayload } from '@/lib/calls';

export default function ChatLayer() {
  const { s, ready } = useStore();
  const router = useRouter();
  const [me, setMe] = useState('');
  const [inc, setInc] = useState<RingPayload | null>(null);
  const stopTone = useRef<() => void>(() => {});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ready || IS_DEMO || !s.account.loggedIn) return;
    void import('@/lib/chat').then((m) => m.myId()).then(setMe).catch(() => {});
  }, [ready, s.account.loggedIn]);

  // Presença global (quem está online agora)
  useEffect(() => {
    if (!me) return;
    let ch: { unsubscribe: () => unknown } | null = null; let stop = false;
    void Promise.all([import('@/lib/supabase').then((x) => x.sb()), import('@/lib/chat')]).then(([c, chat]) => {
      if (stop) return;
      const x = c.channel('poipak-online', { config: { presence: { key: me } } });
      x.on('presence', { event: 'sync' }, () => chat.setOnlineIds(Object.keys(x.presenceState())))
        .subscribe((st) => { if (st === 'SUBSCRIBED') void x.track({ at: Date.now() }).catch(() => {}); });
      ch = x;
    }).catch(() => {});
    return () => { stop = true; try { void ch?.unsubscribe(); } catch {} };
  }, [me]);

  // Toques
  useEffect(() => {
    if (!me) return;
    let off = () => {};
    void import('@/lib/calls').then((m) => {
      off = m.listenRing(me, (ev, p) => {
        if (ev === 'ring') {
          if (s.blocked.includes(p.from) || Date.now() - (p.at || 0) > 60_000) return;
          if (location.pathname.includes('/mensagens/chamada')) { void m.ringUsers([p.from], 'decline', { ...p, from: me }); return; }
          setInc(p); stopTone.current(); stopTone.current = m.ringtone('in');
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => { stopTone.current(); setInc(null); }, m.RING_TIMEOUT_MS);
        } else if (ev === 'hangup') {
          setInc((cur) => { if (cur && cur.conv === p.conv) { stopTone.current(); return null; } return cur; });
        }
      });
    });
    return () => { off(); stopTone.current(); };
  }, [me, s.blocked]);

  if (!inc) return null;
  const answer = (ok: boolean) => {
    stopTone.current();
    const p = inc; setInc(null);
    if (timer.current) clearTimeout(timer.current);
    void import('@/lib/calls').then((m) => m.ringUsers([p.from], ok ? 'accept' : 'decline', { ...p, from: me }));
    if (ok) router.push(`/mensagens/chamada?c=${encodeURIComponent(p.conv)}&v=${p.video ? 1 : 0}&in=1`);
  };
  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-between bg-[#0E1F52] px-6 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-24 text-center" role="dialog" aria-label="Chamada a chegar">
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-white/60">{inc.video ? '📹 Chamada de vídeo TXAPILOG' : '📞 Chamada de voz TXAPILOG'}</p>
        <Avatar a={inc.avatar} name={inc.name} size={112} className="animate-pulseGlow" />
        <p className="text-2xl font-bold">{inc.group || inc.name}</p>
        {inc.group && <p className="text-sm text-white/60">{inc.name} está a ligar</p>}
        <p className="text-sm text-white/50">A tocar…</p>
      </div>
      <div className="flex w-full max-w-xs justify-between">
        <button onClick={() => answer(false)} className="flex flex-col items-center gap-2 text-sm"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-2xl">✕</span>Recusar</button>
        <button onClick={() => answer(true)} className="flex flex-col items-center gap-2 text-sm"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-2xl">{inc.video ? '📹' : '📞'}</span>Atender</button>
      </div>
    </div>
  );
}
