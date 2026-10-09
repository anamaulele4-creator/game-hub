'use client';

import dynamic from 'next/dynamic';
import { LiveBadge } from '@/components/Hud';
import { useEffect, useRef, useState } from 'react';
import { COIN_PACKS, GIFTS, LIVES, Live, UPCOMING_LIVES, fmt, idol } from '@/lib/data';
import { PLATFORM_ICON, PLATFORM_NAME, canEmbed, fetchLive, myUid, parseStream, setLiveStatus, whenLabel } from '@/lib/lives';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { CheckoutSheet } from '@/components/LazyCheckout';
import { Avatar, FollowButton, Page, ShareSheet, Sheet, Verified } from '@/components/ui';

interface Msg { id: number; who: string; text: string; gift?: string; mine?: boolean }

const BOT = [
  ['Mário_FF', 'Booyah hoje! 🔥'], ['Shaira', 'Que mira 🤯'], ['Dércio', 'Saudações da Beira 👋'],
  ['Kiara', 'Lenda 👑'], ['Zito', 'Joga de M1887!'], ['Neyma', 'Quem vem ao Fest?'],
];

function Missing({ what, back }: { what: string; back: string }) {
  return <Page title={what} back={back}><div className="card mt-6 text-center"><p className="text-4xl">🔎</p><p className="mt-2 text-sm text-white/70">{what} não encontrado ou ainda a carregar.</p></div></Page>;
}
export default function LiveRoom({ id }: { id: string }) {
  const [l, setL] = useState<Live | null>(() => LIVES.find((x) => x.id === id) ?? UPCOMING_LIVES.find((x) => x.id === id) ?? null);
  const [loading, setLoading] = useState(!IS_DEMO);
  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    // Modo real: lê sempre a versão mais recente (estado, link) — nunca lança erro
    fetchLive(id).then((r) => { if (alive && r) setL(r); }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);
  if (!l) return loading ? <Page title="Live" back="/lives"><div className="card mt-6 text-center text-sm text-white/70">A carregar a live…</div></Page> : <Missing what="Live" back="/lives" />;
  return <Inner key={l.id + (l.status ?? '')} l={l} onChange={setL} />;
}

const PoipakHost = dynamic(() => import('@/components/PoipakLive').then((m) => m.PoipakHost), { ssr: false, loading: () => <div className="flex h-64 items-center justify-center text-sm text-white/60">A abrir a câmara…</div> });
const PoipakViewer = dynamic(() => import('@/components/PoipakLive').then((m) => m.PoipakViewer), { ssr: false, loading: () => <div className="flex h-64 items-center justify-center text-sm text-white/60">A ligar à live…</div> });

function Player({ l, avatar, isHost }: { l: Live; avatar: string; isHost: boolean }) {
  const st = parseStream(l.streamUrl);
  if (st?.platform === 'poipak' && l.status !== 'terminada') return isHost ? <PoipakHost liveId={l.id} /> : <PoipakViewer liveId={l.id} />;
  const [embedOk, setEmbedOk] = useState(false);
  useEffect(() => { setEmbedOk(!!st && canEmbed(st)); }, [st?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  if (st && embedOk && l.status !== 'terminada' && st.embed) {
    return (
      <div className="relative aspect-video w-full bg-black">
        <iframe src={st.embed} title={l.title} className="absolute inset-0 h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  }
  return (
    <div className={`relative flex h-64 flex-col items-center justify-center gap-3 bg-gradient-to-br ${l.gradient}`}>
      <span className="text-7xl opacity-80">{avatar.startsWith('http') ? '🎮' : avatar}</span>
      {st && l.status !== 'terminada' && st.platform === 'tiktok' && <p className="max-w-xs text-center text-sm text-white/85">O TikTok não deixa mostrar a live dentro de outras apps. Abre no TikTok e volta para falar no chat 💬</p>}
      {st && l.status !== 'terminada' && st.platform !== 'poipak' && (
        <a href={st.url} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-black/70 px-5 py-3 text-base font-bold shadow-lg">
          {PLATFORM_ICON[st.platform]} {st.platform === 'tiktok' ? 'Abrir no TikTok' : `Ver a live em ${PLATFORM_NAME[st.platform]}`}
        </a>
      )}
    </div>
  );
}

function Inner({ l, onChange }: { l: Live; onChange: (l: Live) => void }) {
  const i = idol(l.idolId);
  const { s, set, toast, addXp, track } = useStore();
  const [isHost, setHost] = useState(false);
  const [hostChecked, setHostChecked] = useState(IS_DEMO);
  const [hostBusy, setHostBusy] = useState(false);
  const st = parseStream(l.streamUrl);
  const status = l.status ?? 'ao vivo';
  useEffect(() => { if (!IS_DEMO) void myUid().then((u) => setHost(!!u && u === l.idolId)).catch(() => {}).finally(() => setHostChecked(true)); }, [l.idolId]);
  const changeStatus = async (to: 'ao vivo' | 'terminada') => {
    if (to === 'terminada' && !window.confirm('Terminar esta live? Os seguidores deixam de a ver no TXAPILOG.')) return;
    setHostBusy(true);
    const r = await setLiveStatus(l.id, to);
    setHostBusy(false);
    if (!r.ok) { toast(r.error ?? 'Não foi possível atualizar a live.'); return; }
    set((p) => ({ ...p, admin: { ...p.admin, liveStatus: { ...p.admin.liveStatus, [l.id]: to } } }));
    onChange({ ...l, status: to, startedMin: to === 'ao vivo' ? 0 : l.startedMin, startsAt: to === 'ao vivo' ? new Date().toISOString() : l.startsAt });
    toast(to === 'terminada' ? 'Live terminada. Obrigado por transmitires 💙' : 'Estás ao vivo 🔴');
  };
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, who: 'TXAPILOG', text: 'Bem-vindo ao chat! Sê respeitoso 💜' }]);
  const [text, setText] = useState('');
  const [viewers, setViewers] = useState(l.viewers);
  const [giftOpen, setGift] = useState(false);
  const [coinOpen, setCoin] = useState(false);
  const [pack, setPack] = useState(COIN_PACKS[0]);
  const [buyOpen, setBuy] = useState(false);
  const [shOpen, setSh] = useState(false);
  const [floating, setFloating] = useState<{ k: number; e: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      if (!IS_DEMO) return;
      const [who, t] = BOT[Math.floor(Math.random() * BOT.length)];
      setMsgs((m) => [...m.slice(-40), { id: Date.now(), who, text: t }]);
      setViewers((v) => v + Math.floor(Math.random() * 21) - 8);
    }, 2500);
    const once = setTimeout(() => track('watch'), 3000);
    return () => { clearInterval(iv); clearTimeout(once); };
  }, [track]);

  useEffect(() => { box.current?.scrollTo({ top: 99999, behavior: 'smooth' }); }, [msgs]);

  const send = () => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { id: Date.now(), who: s.user.name, text: text.trim(), mine: true }]);
    setText('');
  };

  const gift = (g: (typeof GIFTS)[number]) => {
    if (s.coins < g.coins) { setGift(false); setCoin(true); toast('Moedas insuficientes. Compra mais moedas.'); return; }
    if (!IS_DEMO) void import('@/lib/monetization').then((m) => m.sendGift(l.idolId, 'live', l.id, g.id, g.coins)).then((r) => { if (!r.ok) toast(r.error!); });
    set((p) => ({ ...p, coins: p.coins - g.coins }));
    setMsgs((m) => [...m, { id: Date.now(), who: s.user.name, text: `enviou ${g.name}`, gift: g.emoji, mine: true }]);
    const k = Date.now();
    setFloating((f) => [...f, { k, e: g.emoji }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.k !== k)), 1400);
    addXp(Math.max(5, g.coins), 'presente enviado');
    setGift(false);
  };

  return (
    <Page title={l.title} back="/lives" noPad>
      <div className="relative">
        {st?.platform === 'poipak' && !hostChecked ? <div className="flex h-64 items-center justify-center text-sm text-white/60">A carregar…</div> : <Player l={l} avatar={i.avatar} isHost={isHost} />}
        {status === 'ao vivo' ? <LiveBadge className="pointer-events-none absolute left-3 top-3" /> : <span className={`pointer-events-none absolute left-3 top-3 rounded px-2 py-0.5 font-display text-sm font-bold tracking-wider ${status === 'agendada' ? 'bg-white text-ink' : 'bg-black/70'}`}>{status === 'agendada' ? `AGENDADA · ${whenLabel(l.startsAt)}` : 'TERMINADA'}</span>}
        {status === 'ao vivo' && !st?.embed && st?.platform !== 'poipak' && <span className="pointer-events-none absolute right-3 top-3 rounded bg-black/50 px-2 py-0.5 text-xs">👁 {fmt(viewers)} · {l.startedMin} min</span>}
        {floating.map((f) => <span key={f.k} className="pointer-events-none absolute bottom-6 right-10 animate-floatUp text-5xl">{f.e}</span>)}
      </div>
      {st && st.embed && st.platform !== 'poipak' && status !== 'terminada' && (
        <a href={st.url} target="_blank" rel="noopener noreferrer" className="block border-b border-line px-3 py-2 text-center text-sm text-white/70">Não aparece? {PLATFORM_ICON[st.platform]} Abrir no {PLATFORM_NAME[st.platform]} ›</a>
      )}
      {isHost && (
        <div className="space-y-2 border-b border-line p-3">
          {status === 'agendada' && <button disabled={hostBusy} onClick={() => changeStatus('ao vivo')} className="btn min-h-[3rem] w-full text-base disabled:opacity-50">🔴 Começar agora</button>}
          {status !== 'terminada' && <button disabled={hostBusy} onClick={() => changeStatus('terminada')} className="min-h-[3rem] w-full rounded-2xl border border-red-500/60 bg-red-500/10 text-base font-semibold text-red-200 disabled:opacity-50">⏹ Terminar live</button>}
          <p className="text-xs leading-relaxed text-white/60">{st?.platform === 'poipak' ? 'Estás a transmitir com a câmara TXAPILOG. Os fãs veem-te aqui e falam contigo no chat.' : `A transmissão é feita na app do ${st ? PLATFORM_NAME[st.platform] : 'YouTube, TikTok ou Facebook'}; o TXAPILOG mostra-a aos teus seguidores.`}</p>
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-line p-3">
        <Avatar a={i.avatar} name={i.name} size={40} />
        <div className="flex-1"><p className="font-semibold">{i.name}{i.verified && <Verified />}</p><p className="text-xs text-white/60">{l.game} · {fmt(i.followers)} seguidores</p></div>
        <button onClick={() => setSh(true)} className="rounded-full bg-panel2 px-3 py-1">📤</button>
        <FollowButton idolId={i.id} small />
      </div>
      <div ref={box} className="h-[38vh] space-y-1 overflow-y-auto p-3 text-sm">
        {msgs.map((m) => (
          <p key={m.id} className={m.gift ? 'rounded-lg bg-neon/20 px-2 py-1' : ''}>
            <span className={`font-semibold ${m.mine ? 'text-neon2' : 'text-neon'}`}>{m.who}: </span>{m.gift && <span className="text-lg">{m.gift} </span>}{m.text}
          </p>
        ))}
      </div>
      <div className="fixed bottom-14 left-1/2 z-30 flex w-full max-w-md -translate-x-1/2 gap-2 border-t border-line bg-bg p-2">
        <input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Diz algo no chat…" />
        <button onClick={() => setGift(true)} className="rounded-xl bg-panel2 px-3 text-xl" aria-label="Presentes">🎁</button>
        <button onClick={send} className="btn">➤</button>
      </div>

      <Sheet open={giftOpen} onClose={() => setGift(false)} title={`Enviar presente · 🪙 ${s.coins} moedas`}>
        <div className="grid grid-cols-5 gap-2 text-center text-xs">
          {GIFTS.map((g) => (
            <button key={g.id} onClick={() => gift(g)} className="rounded-xl bg-panel2 p-2"><span className="block text-3xl">{g.emoji}</span>{g.name}<span className="block text-neon">🪙 {g.coins}</span></button>
          ))}
        </div>
        <button onClick={() => { setGift(false); setCoin(true); }} className="btn-ghost mt-4 w-full">Comprar moedas</button>
        <p className="mt-2 text-center text-xs text-white/50">70% do valor dos presentes vai para o criador.</p>
      </Sheet>

      <Sheet open={coinOpen} onClose={() => setCoin(false)} title="Comprar moedas">
        <div className="space-y-2">
          {COIN_PACKS.map((p) => (
            <button key={p.id} onClick={() => { setPack(p); setCoin(false); setBuy(true); }} className="flex w-full justify-between rounded-xl bg-panel2 p-3"><span>🪙 {p.coins} moedas</span><span className="font-bold">{p.price} MZN</span></button>
          ))}
        </div>
      </Sheet>
      <CheckoutSheet open={buyOpen} onClose={() => setBuy(false)} title={`${pack.coins} moedas`} lines={[{ label: `Pacote de ${pack.coins} moedas`, amount: pack.price }]}
        onPaid={() => set((p) => ({ ...p, coins: p.coins + pack.coins }))} />
      <ShareSheet open={shOpen} onClose={() => setSh(false)} path={`/lives/${l.id}`} text={`${i.name} está em direto no TXAPILOG!`} target={l.id} />
    </Page>
  );
}
