'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Page, Sheet } from '@/components/ui';
import { MoreMenu } from '@/components/Moderation';
import { useStore } from '@/lib/store';
import type { DmConversation, DmMessage } from '@/lib/dm';

const EMOJIS = ['😂', '🔥', '💜', '👍', '😎', '🎮', '🏆', '😭', '🙏', '👑', '🤯', '💎', '⚡', '😅', '🥳', '❤️'];
const dmMod = () => import('@/lib/dm');
// Fila offline: mensagens de texto por enviar ficam guardadas e são reenviadas quando a internet voltar.
const QK = 'gamehub-dm-queue';
type Queued = { id: string; conv: string; body: string; at: string };
const readQ = (): Queued[] => { try { return JSON.parse(localStorage.getItem(QK) || '[]'); } catch { return []; } };
const writeQ = (q: Queued[]) => { try { localStorage.setItem(QK, JSON.stringify(q)); } catch {} };
const isNetErr = (e?: string) => !!e && /internet|ligação|fetch|network/i.test(e);

function Chat() {
  const params = useSearchParams();
  const router = useRouter();
  const { s, ready, toast, toggleBlock } = useStore();
  const [cid, setCid] = useState(params.get('c') ?? '');
  const [me, setMe] = useState('');
  const [conv, setConv] = useState<DmConversation | null>(null);
  const [msgs, setMsgs] = useState<DmMessage[]>([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [typing, setTyping] = useState(false);
  const [emo, setEmo] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [peerRead, setPeerRead] = useState('');
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState<Queued[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const typingFn = useRef<() => void>(() => {});

  // ?u=<id> → cria/abre a conversa e troca o endereço para ?c=<conversa>
  useEffect(() => {
    if (!ready) return;
    const u = params.get('u');
    if (u && !cid) void dmMod().then((m) => m.startDm(u)).then((r) => {
      if (r.id) { setCid(r.id); router.replace(`/mensagens/chat?c=${encodeURIComponent(r.id)}`); } else setErr(r.error ?? 'Não foi possível abrir a conversa.');
    });
  }, [ready, params, cid, router]);

  const refresh = useCallback(async () => {
    if (!cid) return;
    const m = await dmMod();
    const [c, l, id] = await Promise.all([m.getConversation(cid), m.loadMessages(cid), m.myId()]);
    setConv(c); setMsgs(l); setMe(id); setPeerRead(c?.peerReadAt ?? '');
    if (c?.status === 'aceite') void m.markRead(cid);
  }, [cid]);

  useEffect(() => { if (ready && cid) void refresh(); }, [ready, cid, refresh]);

  useEffect(() => {
    if (!cid || !me) return;
    let sub: { stop: () => void; typing: () => void } | null = null;
    void dmMod().then((m) => {
      sub = m.subscribe(cid, me, {
        onMessage: (msg) => { setMsgs((l) => (l.some((x) => x.id === msg.id) ? l : [...l, msg])); setTyping(false); if (msg.senderId !== me) void m.markRead(cid); },
        onRead: (_u, at) => setPeerRead(at),
        onTyping: setTyping,
        onRefresh: () => void refresh(),
      });
      typingFn.current = sub.typing;
    });
    return () => sub?.stop();
  }, [cid, me, refresh]);

  const flush = useCallback(async () => {
    if (!navigator.onLine) return;
    const m = await dmMod();
    let q = readQ();
    for (const item of q.filter((x) => x.conv === cid)) {
      const r = await m.sendMessage(item.conv, item.body);
      if (r.error && isNetErr(r.error)) break;
      q = q.filter((x) => x.id !== item.id);
      writeQ(q);
      if (r.msg) setMsgs((l) => (l.some((x) => x.id === r.msg!.id) ? l : [...l, r.msg!]));
    }
    setQueued(readQ().filter((x) => x.conv === cid));
  }, [cid]);

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueued(readQ().filter((x) => x.conv === cid));
    const on = () => { setOnline(true); void flush(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    if (navigator.onLine) void flush();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [cid, flush]);

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, typing]);

  const send = async () => {
    if (busy || (!text.trim() && !file)) return;
    const enqueue = () => {
      if (!text.trim()) { setErr('Sem internet: as imagens são enviadas quando a ligação voltar. Tenta de novo depois.'); return; }
      const item: Queued = { id: 'q' + Date.now(), conv: cid, body: text.trim(), at: new Date().toISOString() };
      writeQ([...readQ(), item]); setQueued((l) => [...l, item]); setText(''); setEmo(false);
    };
    if (!navigator.onLine) { enqueue(); return; }
    setBusy(true); setErr('');
    const m = await dmMod();
    const r = await m.sendMessage(cid, text, file ?? undefined);
    setBusy(false);
    if (r.error && isNetErr(r.error)) { enqueue(); return; }
    if (r.error) { setErr(r.error); return; }
    if (r.msg) setMsgs((l) => (l.some((x) => x.id === r.msg!.id) ? l : [...l, r.msg!]));
    setText(''); setFile(null); setPreview(''); setEmo(false);
  };

  if (!cid && !params.get('u')) return <Page title="Mensagens" back="/mensagens"><p className="card mt-6 text-center text-sm">Conversa não encontrada.</p></Page>;
  const peer = conv?.peer;
  const blocked = peer ? s.blocked.includes(peer.id) : false;
  const lastMine = [...msgs].reverse().find((x) => x.senderId === me);

  return (
    <Page title={peer ? peer.name : 'Conversa'} back="/mensagens" noPad>
      <div className="flex h-[calc(100vh-56px-64px)] flex-col">
        {peer && (
          <div className="flex items-center gap-2 border-b border-line bg-panel/70 px-4 py-2 text-xs">
            <span className="text-2xl">{peer.avatar}</span>
            <div className="flex-1"><p className="font-semibold">{peer.name}{peer.verified && ' ✅'} <span className="ml-1 rounded-full bg-lime/15 px-1.5 py-0.5 text-[9px] font-semibold text-lime">Mensagens grátis</span></p><p className="text-white/50">{typing ? <span className="text-neon2">a escrever…</span> : peer.handle}</p></div>
            <button className="rounded-full bg-panel2 px-3 py-1" onClick={() => setMenu(true)} aria-label="Opções">⋯</button>
          </div>
        )}
        <div ref={box} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {!online && <p className="sticky top-0 z-10 rounded-lg bg-amber-500 p-2 text-center text-xs text-black">📡 Sem internet — as mensagens ficam em fila e são enviadas quando a ligação voltar.</p>}
          <p className="text-center text-[11px] text-white/40">💬 As mensagens são grátis: vão pela internet (dados ou Wi-Fi), sem moedas nem SMS.</p>
          {err && <p className="rounded-lg bg-pink/20 p-2 text-center text-xs">{err}</p>}
          {conv?.status === 'pedido' && (
            <div className="card space-y-2 text-center text-sm">
              <p><b>{peer?.name}</b> quer enviar-te mensagens. Não segues esta pessoa.</p>
              <div className="flex gap-2">
                <button className="btn flex-1" onClick={async () => { await (await dmMod()).setRequest(cid, 'aceite'); void refresh(); }}>Aceitar</button>
                <button className="btn-ghost flex-1" onClick={async () => { await (await dmMod()).setRequest(cid, 'recusado'); toast('Pedido recusado'); router.push('/mensagens'); }}>Recusar</button>
                <button className="flex-1 rounded-xl bg-red-600 text-xs font-semibold" onClick={() => { if (peer) toggleBlock(peer.id, peer.name); router.push('/mensagens'); }}>Bloquear</button>
              </div>
            </div>
          )}
          {conv?.peerStatus === 'pedido' && <p className="text-center text-xs text-white/50">A tua mensagem vai como pedido: {peer?.name} ainda não te segue.</p>}
          {msgs.map((m) => {
            const mine = m.senderId === me;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`group relative max-w-[78%] rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-sm bg-neon' : 'rounded-bl-sm bg-panel2'}`}>
                  {m.hidden ? <i className="text-white/60">Mensagem removida pela moderação</i> : (
                    <>
                      {m.image && <img src={m.image} alt="Imagem enviada" loading="lazy" className="mb-1 max-h-64 rounded-xl" />}
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    </>
                  )}
                  <p className="mt-0.5 text-right text-[9px] text-white/60">{new Date(m.createdAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}{mine && m.id === lastMine?.id ? (peerRead && peerRead >= m.createdAt ? ' · Visto ✓✓' : ' · Enviado ✓') : ''}</p>
                  {!mine && !m.hidden && <div className="absolute -right-8 top-1"><MoreMenu kind="mensagem" target={m.id} label={m.body.slice(0, 40) || 'Imagem'} owner={peer?.id} ownerLabel={peer?.name} className="!text-sm" /></div>}
                </div>
              </div>
            );
          })}
          {queued.map((q) => <div key={q.id} className="flex justify-end"><div className="max-w-[78%] rounded-2xl rounded-br-sm bg-gradient-to-r from-neon/50 to-pink/50 px-3 py-2 text-sm opacity-80"><p className="whitespace-pre-wrap break-words">{q.body}</p><p className="mt-0.5 text-right text-[9px] text-white/70">⏳ Por enviar</p></div></div>)}
          {typing && <div className="flex"><span className="rounded-2xl bg-panel2 px-3 py-2 text-sm"><span className="animate-pulse">●●●</span></span></div>}
        </div>
        {blocked ? (
          <p className="border-t border-line p-3 text-center text-xs text-white/60">Bloqueaste este utilizador. <button className="text-neon2" onClick={() => peer && toggleBlock(peer.id, peer.name)}>Desbloquear</button></p>
        ) : conv?.status === 'pedido' ? null : (
          <div className="border-t border-line bg-panel/90 p-2">
            {preview && <div className="mb-2 flex items-center gap-2"><img src={preview} alt="" className="h-14 rounded-lg" /><button className="text-xs text-pink" onClick={() => { setFile(null); setPreview(''); }}>Remover</button></div>}
            {emo && <div className="mb-2 flex flex-wrap gap-1">{EMOJIS.map((e) => <button key={e} className="rounded-lg bg-panel2 p-1.5 text-xl" onClick={() => setText((t) => t + e)}>{e}</button>)}</div>}
            <div className="flex items-end gap-2">
              <button className="rounded-full bg-panel2 p-2" aria-label="Emojis" onClick={() => setEmo((x) => !x)}>😊</button>
              <label className="cursor-pointer rounded-full bg-panel2 p-2" aria-label="Imagem">📷<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setPreview(URL.createObjectURL(f)); } }} /></label>
              <textarea rows={1} className="input max-h-28 flex-1 resize-none" placeholder="Escreve uma mensagem…" value={text} maxLength={2000}
                onChange={(e) => { setText(e.target.value); typingFn.current(); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              <button className="btn !px-3" disabled={busy} onClick={() => void send()} aria-label="Enviar">{busy ? '…' : '➤'}</button>
            </div>
          </div>
        )}
      </div>
      <Sheet open={menu} onClose={() => setMenu(false)} title="Conversa">
        <div className="space-y-2 text-sm">
          {peer && <Link href={`/idolo/${peer.id}`} className="flex rounded-xl bg-panel2 p-3">👤 Ver perfil</Link>}
          <button className="flex w-full rounded-xl bg-panel2 p-3" onClick={async () => { if (!conv) return; await (await dmMod()).setMuted(cid, !conv.muted); setMenu(false); void refresh(); toast(conv.muted ? 'Notificações ativadas' : 'Conversa silenciada'); }}>{conv?.muted ? '🔔 Ativar notificações' : '🔕 Silenciar conversa'}</button>
          {peer && <button className="flex w-full rounded-xl bg-panel2 p-3" onClick={() => { toggleBlock(peer.id, peer.name); setMenu(false); }}>🚫 {blocked ? 'Desbloquear' : 'Bloquear'} {peer.name}</button>}
          {peer && <div className="rounded-xl bg-panel2 p-1"><MoreMenu kind="utilizador" target={peer.handle} label={`${peer.name} (mensagens)`} owner={peer.id} ownerLabel={peer.name} className="w-full text-left !text-sm" /><span className="text-xs text-white/60"> Denunciar conversa</span></div>}
          <p className="text-xs text-white/40">Nunca partilhes o teu PIN, códigos de verificação ou palavra-passe. A equipa do Social POIPAK nunca os pede por mensagem.</p>
        </div>
      </Sheet>
    </Page>
  );
}

export default function ChatPage() {
  return <Suspense fallback={<div className="p-6"><div className="card h-24 animate-pulse" /></div>}><Chat /></Suspense>;
}
