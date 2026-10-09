'use client';

// Conversa estilo WhatsApp (1:1 e grupos): responder, reações, editar, apagar, reencaminhar, fotos/vídeos/ficheiros,
// mensagens de voz, ✓/✓✓ azul, "a escrever…", online, @menções, favoritas, pesquisa, chamadas.
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sheet, Avatar } from '@/components/ui';
import { MoreMenu } from '@/components/Moderation';
import { FollowToggle } from '@/components/Social';
import { VoicePlayer, useRecorder, type Recording } from '@/components/chat/Voice';
import { moderate, recordModeration } from '@/lib/poipakAI';
import { useStore } from '@/lib/store';
import { MAX_UPLOAD_MB } from '@/lib/config';
import type { Chat, ChatMsg, Member, MsgMeta } from '@/lib/chat';

const chatMod = () => import('@/lib/chat');
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJIS = ['😂', '🔥', '💜', '👍', '😎', '🎮', '🏆', '😭', '🙏', '👑', '🤯', '💎', '⚡', '😅', '🥳', '❤️', '😍', '🤝', '👏', '😡', '🎯', '💪', '😴', '✅'];
const NAME_COLORS = ['#FFC20E', '#FFFFFF', '#FFD65C', '#8FA8E8', '#FFE9A6', '#C9D6F5', '#FFE38A'];
const colorOf = (id: string) => NAME_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % NAME_COLORS.length];
const QK = 'gamehub-dm-queue';
type Queued = { id: string; conv: string; body: string; at: string };
const readQ = (): Queued[] => { try { return JSON.parse(localStorage.getItem(QK) || '[]'); } catch { return []; } };
const writeQ = (q: Queued[]) => { try { localStorage.setItem(QK, JSON.stringify(q)); } catch {} };
const isNetErr = (e?: string) => !!e && /internet|ligação|fetch|network/i.test(e);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

type Lib = typeof import('@/lib/chat');

function Chat() {
  const params = useSearchParams();
  const router = useRouter();
  const { s, ready, toast, toggleBlock } = useStore();
  const [lib, setLib] = useState<Lib | null>(null);
  const [cid, setCid] = useState(params.get('c') ?? '');
  const [me, setMe] = useState('');
  const [chat, setChat] = useState<Chat | null>(null);
  const [missing, setMissing] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [more, setMore] = useState(true);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [editing, setEditing] = useState<ChatMsg | null>(null);
  const [sel, setSel] = useState<ChatMsg | null>(null);
  const [allEmoji, setAllEmoji] = useState(false);
  const [fwd, setFwd] = useState<ChatMsg | null>(null);
  const [fwdList, setFwdList] = useState<Chat[] | null>(null);
  const [typing, setTyping] = useState('');
  const [present, setPresent] = useState<string[]>([]);
  const [, setPresTick] = useState(0);
  const [emo, setEmo] = useState(false);
  const [attach, setAttach] = useState(false);
  const [pend, setPend] = useState<{ file: File; url: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [uploads, setUploads] = useState<{ id: string; label: string }[]>([]);
  const [err, setErr] = useState('');
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState('');
  const [viewer, setViewer] = useState<string>('');
  const [stars, setStars] = useState<string[]>([]);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState<Queued[]>([]);
  const [gate, setGate] = useState<{ id: string; name: string } | null>(null);
  const [lock, setLock] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const typingFn = useRef<() => void>(() => {});
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ t: null, x: 0, y: 0, fired: false });
  const micStart = useRef<{ x: number; y: number } | null>(null);
  const atBottom = useRef(true);

  useEffect(() => { void chatMod().then(setLib); }, []);

  // ?u=<id> → abre/cria a conversa (só com quem segues)
  useEffect(() => {
    if (!ready || !lib) return;
    const u = params.get('u');
    if (!u || cid) return;
    if (!s.following.includes(u)) {
      void import('@/lib/social').then((m) => m.fetchProfile(u)).then((p) => setGate({ id: u, name: p?.name ?? 'esta pessoa' }));
      return;
    }
    setGate(null);
    void lib.startDirect(u).then((r) => {
      if (r.id) { setCid(r.id); router.replace(`/mensagens/chat?c=${encodeURIComponent(r.id)}`); } else setErr(r.error ?? 'Não foi possível abrir a conversa.');
    });
  }, [ready, lib, params, cid, router, s.following]);

  const refresh = useCallback(async () => {
    if (!cid || !lib) return;
    const [c, l, id] = await Promise.all([lib.getChat(cid), lib.loadMessages(cid), lib.myId()]);
    if (!c) { setMissing(true); return; }
    setChat(c); setMe(id); setStars(lib.stars().map((x) => x.id));
    setMsgs((old) => {
      const pend = old.filter((m) => m.pending);
      return [...l, ...pend.filter((p) => !l.some((x) => x.id === p.id))];
    });
    if (l.length < 120) setMore(false);
    if (c.status === 'aceite') void lib.markRead(cid);
  }, [cid, lib]);

  useEffect(() => { if (ready && cid && lib) void refresh(); }, [ready, cid, lib, refresh]);

  // Tempo real
  useEffect(() => {
    if (!cid || !me || !lib) return;
    const sub = lib.subscribe(cid, me, s.user.name || 'Alguém', {
      onMessage: (m) => {
        setMsgs((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [...l.filter((x) => !(x.pending && x.senderId === me && x.body === m.body && x.kind === m.kind)), m]));
        setTyping('');
        if (m.senderId !== me) void lib.markRead(cid);
        if (m.kind === 'sistema') void lib.getChat(cid).then((c) => c && setChat(c));
      },
      onChange: () => void refresh(),
      onRead: (u, at) => setChat((c) => (c ? { ...c, members: c.members.map((x) => (x.id === u ? { ...x, lastReadAt: at } : x)), peer: c.peer && c.peer.id === u ? { ...c.peer, lastReadAt: at } : c.peer } : c)),
      onTyping: setTyping,
      onPresent: setPresent,
    });
    typingFn.current = sub.typing;
    const off = lib.onPresence(() => setPresTick((n) => n + 1));
    return () => { sub.stop(); off(); };
  }, [cid, me, lib, refresh, s.user.name]);

  // Recurso se o Realtime falhar: verifica a cada 12 s com a conversa aberta
  useEffect(() => {
    if (!cid || !ready || !lib) return;
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); }, 12000);
    return () => clearInterval(iv);
  }, [cid, ready, lib, refresh]);

  // Fila offline (texto)
  const flush = useCallback(async () => {
    if (!navigator.onLine || !lib) return;
    let qq = readQ();
    for (const item of qq.filter((x) => x.conv === cid)) {
      const r = await lib.send(item.conv, { text: item.body });
      if (r.error && isNetErr(r.error)) break;
      qq = qq.filter((x) => x.id !== item.id); writeQ(qq);
      if (r.msg) setMsgs((l) => (l.some((x) => x.id === r.msg!.id) ? l : [...l, r.msg!]));
    }
    setQueued(readQ().filter((x) => x.conv === cid));
  }, [cid, lib]);
  useEffect(() => {
    setOnline(navigator.onLine);
    setQueued(readQ().filter((x) => x.conv === cid));
    const on = () => { setOnline(true); void flush(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    if (navigator.onLine) void flush();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [cid, flush]);

  const visible = useMemo(() => msgs.filter((m) => m.kind !== 'reacao'), [msgs]);
  const reactions = useMemo(() => (lib ? lib.reactionsOf(msgs) : {}), [lib, msgs]);
  useEffect(() => { if (atBottom.current) box.current?.scrollTo({ top: box.current.scrollHeight }); }, [visible.length, typing, uploads.length]);

  const recorder = useRecorder((r) => void sendVoice(r));

  const isGroup = chat?.kind === 'grupo';
  const peer = chat?.peer;
  const blocked = peer ? s.blocked.includes(peer.id) : false;
  const memberMap = useMemo(() => Object.fromEntries((chat?.members ?? []).map((m) => [m.id, m])), [chat?.members]);
  const others = (chat?.members ?? []).filter((m) => m.id !== me);
  const canSend = !!chat && !blocked && chat.status !== 'pedido' && !(isGroup && chat.onlyAdminsSend && chat.myRole !== 'admin');
  const nameOf = (id: string) => (id === me ? 'Tu' : memberMap[id]?.name ?? (peer?.id === id ? peer.name : 'Participante'));

  const subtitle = (() => {
    if (!chat || !lib) return '';
    if (typing) return isGroup ? `${typing.split(' ')[0]} está a escrever…` : 'a escrever…';
    if (isGroup) { const on = others.filter((m) => lib.isOnline(m.id) || present.includes(m.id)).length; return `${chat.memberCount} participantes${on ? ` · ${on} online` : ''}`; }
    if (peer && (lib.isOnline(peer.id) || present.includes(peer.id))) return 'online';
    return peer ? lib.lastSeenLabel(peer.lastReadAt) || peer.handle : '';
  })();

  const checkText = (t: string): boolean => {
    const mod = moderate(t);
    if (mod.level !== 'ok') recordModeration(mod, 'mensagem', t);
    if (mod.level === 'block') { setErr(`🛡️ ${mod.tip}`); return false; }
    if (mod.level === 'warn') toast(`💬 ${mod.tip}`);
    return true;
  };

  const replyRef = (m: ChatMsg | null): MsgMeta['reply'] | undefined => (m && lib ? { id: m.id, n: nameOf(m.senderId), t: lib.previewOf(m).slice(0, 120) } : undefined);

  const push = async (inp: { text?: string; kind?: ChatMsg['kind']; meta?: MsgMeta }, optimistic = true) => {
    if (!lib || !cid) return;
    const tmp: ChatMsg = { id: 'tmp' + Date.now(), conversationId: cid, senderId: me, kind: inp.kind ?? 'texto', body: inp.text ?? '', meta: inp.meta ?? {}, createdAt: new Date().toISOString(), edited: false, deleted: false, hidden: false, pending: true };
    if (optimistic) { atBottom.current = true; setMsgs((l) => [...l, tmp]); }
    const r = await lib.send(cid, inp);
    if (r.error) {
      setMsgs((l) => l.filter((x) => x.id !== tmp.id));
      if (isNetErr(r.error) && (inp.kind ?? 'texto') === 'texto' && inp.text) {
        const item: Queued = { id: 'q' + Date.now(), conv: cid, body: inp.text, at: new Date().toISOString() };
        writeQ([...readQ(), item]); setQueued((l) => [...l, item]); return;
      }
      setErr(r.error); return;
    }
    if (r.msg) setMsgs((l) => { const w = l.filter((x) => x.id !== tmp.id); return w.some((x) => x.id === r.msg!.id) ? w : [...w, r.msg!]; });
  };

  const mentionsIn = (t: string) => (isGroup ? others.filter((m) => t.includes(m.handle)).map((m) => m.id) : []);

  const sendText = async () => {
    const t = text.trim();
    if (!t || !lib) return;
    if (!checkText(t)) return;
    setErr('');
    if (editing) {
      const r = await lib.editMessage(editing, t);
      if (r.error) setErr(r.error); else { setMsgs((l) => l.map((x) => (x.id === editing.id ? { ...x, body: t, edited: true } : x))); toast('Mensagem editada'); }
      setEditing(null); setText(''); return;
    }
    if (!navigator.onLine) {
      const item: Queued = { id: 'q' + Date.now(), conv: cid, body: t, at: new Date().toISOString() };
      writeQ([...readQ(), item]); setQueued((l) => [...l, item]); setText(''); setReply(null); return;
    }
    const meta: MsgMeta = {};
    const rr = replyRef(reply); if (rr) meta.reply = rr;
    const mm = mentionsIn(t); if (mm.length) meta.mentions = mm;
    setText(''); setReply(null); setEmo(false);
    await push({ text: t, meta });
    ta.current?.focus();
  };

  const uploadAndSend = async (file: Blob, name: string, kind: 'media' | 'voz', extra: MsgMeta, cap = '') => {
    if (!lib) return;
    const id = 'u' + Date.now();
    const label = kind === 'voz' ? '🎤 A enviar mensagem de voz…' : `📤 A enviar ${name}…`;
    setUploads((u) => [...u, { id, label }]); atBottom.current = true;
    const r = await lib.uploadChatFile(cid, file, name, { dur: (extra as { dur?: number }).dur });
    setUploads((u) => u.filter((x) => x.id !== id));
    if (!r.file) { setErr(r.error ?? 'Falha no envio.'); return; }
    const meta: MsgMeta = { ...extra, file: { ...r.file, ...((extra as { dur?: number }).dur ? { dur: Math.round((extra as { dur?: number }).dur!) } : {}) } };
    delete (meta as { dur?: number }).dur;
    await push({ kind, text: cap, meta }, false);
  };

  async function sendVoice(r: Recording) {
    const ext = r.mime.includes('mp4') ? 'm4a' : r.mime.includes('ogg') ? 'ogg' : 'webm';
    const meta: MsgMeta & { dur?: number } = { wave: r.wave, dur: r.dur };
    const rr = replyRef(reply); if (rr) meta.reply = rr;
    setReply(null); setLock(false);
    await uploadAndSend(r.blob, `voz-${Date.now()}.${ext}`, 'voz', meta);
  }

  const sendPending = async () => {
    if (!pend) return;
    const cap = caption.trim();
    if (cap && !checkText(cap)) return;
    if (pend.file.size > MAX_UPLOAD_MB * 1024 * 1024 && !pend.file.type.startsWith('image/')) { setErr(`Ficheiro demasiado grande (máx. ${MAX_UPLOAD_MB} MB).`); return; }
    const f = pend; setPend(null); setCaption('');
    const meta: MsgMeta = {}; const rr = replyRef(reply); if (rr) meta.reply = rr; setReply(null);
    await uploadAndSend(f.file, f.file.name || 'ficheiro', 'media', meta, cap);
    URL.revokeObjectURL(f.url);
  };

  const pickFile = (f?: File | null) => {
    setAttach(false);
    if (!f) return;
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024 && !f.type.startsWith('image/')) { setErr(`Ficheiro demasiado grande (máx. ${MAX_UPLOAD_MB} MB). Envia um vídeo mais curto.`); return; }
    setPend({ file: f, url: URL.createObjectURL(f) }); setCaption('');
  };

  // ---- microfone: premir para gravar, deslizar para a esquerda cancela, para cima bloqueia ----
  const micDown = async (e: React.PointerEvent) => {
    e.preventDefault();
    micStart.current = { x: e.clientX, y: e.clientY }; setDrag({ x: 0, y: 0 });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const er = await recorder.start();
    if (er) { setErr(er); micStart.current = null; }
  };
  const micMove = (e: React.PointerEvent) => {
    const st = micStart.current; if (!st || lock) return;
    const dx = Math.min(0, e.clientX - st.x), dy = Math.min(0, e.clientY - st.y);
    setDrag({ x: dx, y: dy });
    if (dx < -110) { micStart.current = null; setDrag({ x: 0, y: 0 }); void recorder.stop(false); toast('Gravação cancelada'); }
    else if (dy < -80) { micStart.current = null; setDrag({ x: 0, y: 0 }); setLock(true); }
  };
  const micUp = async () => {
    if (!micStart.current || lock) return;
    micStart.current = null; setDrag({ x: 0, y: 0 });
    const r = await recorder.stop(true);
    if (r) await sendVoice(r); else toast('Mantém premido para gravar 🎤');
  };

  // ---- ações sobre uma mensagem ----
  const onPressStart = (m: ChatMsg) => (e: React.PointerEvent) => {
    if (m.pending || m.kind === 'sistema') return;
    press.current = { t: setTimeout(() => { press.current.fired = true; setSel(m); try { navigator.vibrate?.(20); } catch {} }, 450), x: e.clientX, y: e.clientY, fired: false };
  };
  const onPressMove = (e: React.PointerEvent) => { if (press.current.t && (Math.abs(e.clientX - press.current.x) > 10 || Math.abs(e.clientY - press.current.y) > 10)) { clearTimeout(press.current.t); press.current.t = null; } };
  const onPressEnd = () => { if (press.current.t) clearTimeout(press.current.t); press.current.t = null; };

  const doReact = async (m: ChatMsg, e: string) => {
    if (!lib) return;
    setSel(null); setAllEmoji(false);
    const mineNow = Object.entries(reactions[m.id] ?? {}).find(([, who]) => who.includes(me))?.[0];
    await push({ kind: 'reacao', meta: { to: m.id, e: mineNow === e ? '' : e } }, false);
  };
  const jump = (id: string) => {
    const el = document.getElementById('m-' + id);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setFlash(id); setTimeout(() => setFlash(''), 1600); }
    else toast('Mensagem antiga: carrega mensagens anteriores para a ver.');
  };
  const loadOlder = async () => {
    if (!lib || !msgs.length) return;
    atBottom.current = false;
    const older = await lib.loadMessages(cid, { before: msgs[0].createdAt });
    if (older.length < 120) setMore(false);
    setMsgs((l) => [...older.filter((o) => !l.some((x) => x.id === o.id)), ...l]);
  };

  const startCall = async (video: boolean) => {
    const m = await import('@/lib/calls');
    if (!(await m.callsAvailable())) { toast(m.CALLS_OFF_MSG); return; }
    if (blocked) { toast('Desbloqueia este contacto para ligar.'); return; }
    router.push(`/mensagens/chamada?c=${encodeURIComponent(cid)}&v=${video ? 1 : 0}`);
  };

  // @menções: sugestões
  const mention = isGroup ? /(^|\s)@([\p{L}\d_.]*)$/u.exec(text) : null;
  const mentionList = mention ? others.filter((m) => (m.name + m.handle).toLowerCase().includes(mention[2].toLowerCase())).slice(0, 6) : [];
  const pickMention = (m: Member) => { setText((t) => t.replace(/@([\p{L}\d_.]*)$/u, `${m.handle} `)); ta.current?.focus(); };

  const results = search && q.trim() ? visible.filter((m) => !m.deleted && (m.body + ' ' + (m.meta.file?.name ?? '')).toLowerCase().includes(q.toLowerCase())) : [];

  if (gate && !cid) return (
    <Shell title="Nova mensagem" onBack={() => router.push('/mensagens')}>
      <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/25 text-2xl">✉️</span>
        <p className="text-base font-bold">Segue esta pessoa para enviar mensagem</p>
        <p className="text-sm text-white/60">Depois de seguires {gate.name}, podes conversar à vontade.</p>
        <div className="flex w-full max-w-xs gap-2"><FollowToggle id={gate.id} className="flex-1" /><Link href={`/idolo/${gate.id}`} className="btn-ghost flex-1">Ver perfil</Link></div>
      </div>
    </Shell>
  );
  if ((!cid && !params.get('u')) || missing) return <Shell title="Mensagens" onBack={() => router.push('/mensagens')}><p className="card m-4 text-center text-sm">Conversa não encontrada.</p></Shell>;

  const infoHref = chat ? (isGroup ? `/mensagens/grupo?c=${encodeURIComponent(chat.id)}` : `/mensagens/contacto?c=${encodeURIComponent(chat.id)}`) : '#';
  let lastDay = '';

  return (
    <div className="flex h-[100vh] flex-col bg-bg supports-[height:100dvh]:h-[100dvh]">
      {/* Cabeçalho */}
      <header className="z-30 flex items-center gap-1.5 border-b border-line bg-panel px-2 py-2">
        <button onClick={() => router.push('/mensagens')} className="flex h-11 w-9 items-center justify-center text-2xl" aria-label="Voltar">‹</button>
        {search ? (
          <>
            <input autoFocus className="input min-w-0 flex-1" placeholder="Pesquisar nesta conversa" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisar mensagens" />
            <button className="h-11 px-3 text-sm text-white/70" onClick={() => { setSearch(false); setQ(''); }}>Fechar</button>
          </>
        ) : (
          <>
            <Link href={infoHref} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label="Ver informação">
              {chat ? <Avatar a={chat.photo} name={chat.title} size={42} /> : <span className="skeleton h-[42px] w-[42px] rounded-full" />}
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold leading-tight">{chat?.title ?? '…'}{peer?.verified && ' ✅'}</span>
                <span className={`block truncate text-xs ${typing || subtitle === 'online' ? 'text-lime' : 'text-white/55'}`}>{subtitle}</span>
              </span>
            </Link>
            {chat && chat.status !== 'pedido' && <>
              <button onClick={() => void startCall(true)} className="flex h-11 w-10 items-center justify-center text-xl" aria-label="Chamada de vídeo">📹</button>
              <button onClick={() => void startCall(false)} className="flex h-11 w-10 items-center justify-center text-xl" aria-label="Chamada de voz">📞</button>
            </>}
            <button onClick={() => setMenu(true)} className="flex h-11 w-9 items-center justify-center text-xl" aria-label="Mais opções">⋮</button>
          </>
        )}
      </header>

      {search && q.trim() && (
        <div className="max-h-[40vh] overflow-y-auto border-b border-line bg-panel">
          <p className="px-4 py-2 text-xs text-white/50">{results.length} resultado(s)</p>
          {results.slice(-50).reverse().map((m) => (
            <button key={m.id} onClick={() => { setSearch(false); jump(m.id); }} className="flex w-full flex-col items-start border-t border-line/60 px-4 py-2 text-left">
              <span className="text-xs text-white/50">{nameOf(m.senderId)} · {lib?.timeLabel(m.createdAt)}</span>
              <span className="line-clamp-2 text-sm">{lib?.previewOf(m)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Mensagens */}
      <div ref={box} onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }} className="flex-1 overflow-y-auto px-3 py-3" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.025) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        {!online && <p className="sticky top-0 z-10 mb-2 rounded-lg bg-neon p-2 text-center text-xs text-black">📡 Sem internet: as mensagens ficam em fila e seguem quando a ligação voltar.</p>}
        <p className="mx-auto mb-3 max-w-[85%] rounded-lg bg-panel2/80 px-3 py-1.5 text-center text-[12px] text-white/55">🔒 Mensagens e chamadas grátis pela internet TXAPILOG. Mantém premida uma mensagem para responder, reagir ou apagar.</p>
        {more && msgs.length >= 120 && <button onClick={() => void loadOlder()} className="mx-auto mb-3 block rounded-full bg-panel2 px-4 py-1.5 text-xs">Carregar mensagens anteriores</button>}
        {err && <p className="mb-2 rounded-lg bg-pink/20 p-2 text-center text-sm" onClick={() => setErr('')}>{err}</p>}
        {chat?.status === 'pedido' && (
          <div className="card mb-3 space-y-2 text-center text-sm">
            <p><b>{chat.title}</b> quer enviar-te mensagens. Não segues esta pessoa.</p>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={async () => { await lib?.setRequest(cid, 'aceite'); void refresh(); }}>Aceitar</button>
              <button className="btn-ghost flex-1" onClick={async () => { await lib?.setRequest(cid, 'recusado'); toast('Pedido recusado'); router.push('/mensagens'); }}>Recusar</button>
              <button className="flex-1 rounded-xl bg-red-600 text-xs font-semibold" onClick={() => { if (peer) toggleBlock(peer.id, peer.name); router.push('/mensagens'); }}>Bloquear</button>
            </div>
          </div>
        )}
        {chat && !isGroup && chat.peerStatus === 'pedido' && <p className="mb-2 text-center text-xs text-white/50">A tua mensagem vai como pedido: {chat.title} ainda não te segue.</p>}
        {!chat && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className={`skeleton h-12 w-2/3 rounded-2xl ${i % 2 ? 'ml-auto' : ''}`} />)}</div>}

        {visible.map((m, i) => {
          const day = lib?.dayLabel(m.createdAt) ?? '';
          const showDay = day !== lastDay; lastDay = day;
          const prev = visible[i - 1];
          const first = !prev || prev.senderId !== m.senderId || prev.kind === 'sistema' || showDay;
          return (
            <div key={m.id}>
              {showDay && <p className="my-3 text-center"><span className="rounded-lg bg-panel2 px-3 py-1 text-xs capitalize text-white/60">{day}</span></p>}
              <Bubble m={m} me={me} lib={lib} chat={chat} first={first} name={nameOf(m.senderId)} member={memberMap[m.senderId]} reacts={reactions[m.id]} starred={stars.includes(m.id)} flash={flash === m.id}
                onJump={jump} onView={setViewer} onCall={(v) => void startCall(v)}
                onPointerDown={onPressStart(m)} onPointerMove={onPressMove} onPointerUp={onPressEnd} onContext={() => { if (!m.pending && m.kind !== 'sistema') setSel(m); }}
                onReact={(e) => void doReact(m, e)} />
            </div>
          );
        })}
        {queued.map((x) => <div key={x.id} className="mb-1 flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#2F55C4]/70 px-3 py-2 text-[15px]"><p className="whitespace-pre-wrap break-words">{x.body}</p><p className="mt-0.5 text-right text-[11px] text-white/70">🕓 Por enviar</p></div></div>)}
        {uploads.map((u) => <div key={u.id} className="mb-1 flex justify-end"><div className="rounded-2xl rounded-tr-sm bg-[#2F55C4]/70 px-3 py-2 text-sm"><span className="animate-pulse">{u.label}</span></div></div>)}
        {typing && <div className="mt-1 flex"><span className="rounded-2xl bg-panel2 px-3 py-2 text-sm text-white/70">{isGroup ? `${typing.split(' ')[0]} ` : ''}<span className="animate-pulse">●●●</span></span></div>}
      </div>

      {/* Compositor */}
      {!chat ? null : blocked ? (
        <p className="border-t border-line bg-panel p-3 text-center text-sm text-white/60">Bloqueaste este contacto. <button className="text-neon2" onClick={() => peer && toggleBlock(peer.id, peer.name)}>Desbloquear</button></p>
      ) : chat.status === 'pedido' ? null : !canSend ? (
        <p className="border-t border-line bg-panel p-3 text-center text-sm text-white/60">🔒 Só os administradores podem enviar mensagens neste grupo.</p>
      ) : (
        <div className="border-t border-line bg-panel px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2">
          {(reply || editing) && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border-l-4 border-neon2 bg-panel2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-neon2">{editing ? '✏️ A editar mensagem' : `Responder a ${nameOf(reply!.senderId)}`}</p>
                <p className="truncate text-sm text-white/70">{lib?.previewOf((editing ?? reply)!)}</p>
              </div>
              <button className="h-9 w-9 rounded-full bg-panel text-sm" aria-label="Cancelar" onClick={() => { setReply(null); if (editing) { setEditing(null); setText(''); } }}>✕</button>
            </div>
          )}
          {mentionList.length > 0 && (
            <div className="mb-2 max-h-48 overflow-y-auto rounded-xl bg-panel2">
              {mentionList.map((m) => <button key={m.id} onClick={() => pickMention(m)} className="flex w-full items-center gap-2 px-3 py-2 text-left"><Avatar a={m.avatar} name={m.name} size={32} /><span className="text-sm font-semibold">{m.name}</span><span className="text-xs text-white/50">{m.handle}</span></button>)}
            </div>
          )}
          {emo && <div className="mb-2 grid grid-cols-8 gap-1">{EMOJIS.map((e) => <button key={e} className="rounded-lg p-1.5 text-2xl" onClick={() => setText((t) => t + e)}>{e}</button>)}</div>}
          {attach && (
            <div className="mb-2 grid grid-cols-3 gap-2">
              <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-2xl">🖼️</span>Galeria<input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
              <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-2xl">📸</span>Câmara<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
              <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-2xl">📄</span>Documento<input type="file" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
            </div>
          )}
          {recorder.rec ? (
            <div className="flex items-center gap-2">
              {lock ? <button className="flex h-12 w-12 items-center justify-center rounded-full bg-panel2 text-xl" aria-label="Apagar gravação" onClick={() => { setLock(false); void recorder.stop(false); }}>🗑️</button> : null}
              <div className="flex min-h-[48px] flex-1 items-center gap-2 rounded-full bg-panel2 px-4" style={{ transform: `translateX(${drag.x}px)` }}>
                <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
                <span className="font-mono text-base">{lib?.fmtSec(recorder.sec)}</span>
                <span className="flex h-6 flex-1 items-center gap-[2px] overflow-hidden">{Array.from({ length: 18 }, (_, k) => <span key={k} className="w-[3px] rounded bg-white/60" style={{ height: `${Math.max(12, Math.min(100, recorder.level * 140 * (0.5 + ((k * 7) % 5) / 5)))}%` }} />)}</span>
                {!lock && <span className="text-xs text-white/50">‹ desliza para cancelar</span>}
              </div>
              {lock ? (
                <button className="flex h-12 w-12 items-center justify-center rounded-full bg-neon text-xl" aria-label="Enviar mensagem de voz" onClick={async () => { const r = await recorder.stop(true); setLock(false); if (r) await sendVoice(r); }}>➤</button>
              ) : (
                <div className="relative">
                  <span className="pointer-events-none absolute -top-14 left-1/2 -translate-x-1/2 rounded-full bg-panel2 px-2 py-1 text-xs text-white/60" style={{ transform: `translate(-50%, ${drag.y / 2}px)` }}>🔒</span>
                  <button className="flex h-12 w-12 touch-none items-center justify-center rounded-full bg-red-500 text-xl" onPointerMove={micMove} onPointerUp={() => void micUp()} onPointerCancel={() => void micUp()} aria-label="A gravar: larga para enviar">🎤</button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-end gap-1.5">
              <div className="flex min-h-[48px] flex-1 items-end rounded-3xl bg-panel2">
                <button className="h-12 w-11 shrink-0 text-xl" aria-label="Emojis" onClick={() => { setEmo((x) => !x); setAttach(false); }}>😊</button>
                <textarea ref={ta} rows={1} className="max-h-32 min-h-[48px] flex-1 resize-none bg-transparent py-3 text-base outline-none placeholder:text-white/40" placeholder="Mensagem" value={text} maxLength={1800}
                  onChange={(e) => { setText(e.target.value); typingFn.current(); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(128, e.currentTarget.scrollHeight) + 'px'; }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); void sendText(); } }} aria-label="Escrever mensagem" />
                {!editing && <button className="h-12 w-11 shrink-0 text-xl" aria-label="Anexar" onClick={() => { setAttach((x) => !x); setEmo(false); }}>📎</button>}
              </div>
              {text.trim() || editing ? (
                <button className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neon text-xl" onClick={() => void sendText()} aria-label={editing ? 'Guardar edição' : 'Enviar'}>{editing ? '✓' : '➤'}</button>
              ) : (
                <button className="flex h-12 w-12 shrink-0 touch-none select-none items-center justify-center rounded-full bg-neon text-xl" onPointerDown={(e) => void micDown(e)} onPointerMove={micMove} onPointerUp={() => void micUp()} onContextMenu={(e) => e.preventDefault()} aria-label="Manter premido para gravar mensagem de voz">🎤</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pré-visualização de anexo */}
      {pend && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/95">
          <div className="flex items-center justify-between p-3"><button className="h-11 w-11 rounded-full bg-panel2" onClick={() => { URL.revokeObjectURL(pend.url); setPend(null); }} aria-label="Cancelar">✕</button><p className="truncate px-2 text-sm text-white/70">{pend.file.name} · {fmtSize(pend.file.size)}</p><span className="w-11" /></div>
          <div className="flex flex-1 items-center justify-center overflow-hidden p-3">
            {pend.file.type.startsWith('image/') ? <img src={pend.url} alt="Pré-visualização" className="max-h-full max-w-full rounded-xl object-contain" />
              : pend.file.type.startsWith('video/') ? <video src={pend.url} controls playsInline className="max-h-full max-w-full rounded-xl" />
              : <div className="card text-center"><p className="text-5xl">📄</p><p className="mt-2 break-all text-sm">{pend.file.name}</p><p className="text-xs text-white/50">{fmtSize(pend.file.size)}</p></div>}
          </div>
          <div className="flex items-end gap-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <input className="input flex-1" placeholder="Adicionar legenda…" value={caption} maxLength={1000} onChange={(e) => setCaption(e.target.value)} aria-label="Legenda" />
            <button className="flex h-12 w-12 items-center justify-center rounded-full bg-neon text-xl" onClick={() => void sendPending()} aria-label="Enviar anexo">➤</button>
          </div>
        </div>
      )}

      {viewer && <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black" onClick={() => setViewer('')}><img src={viewer} alt="Imagem" className="max-h-full max-w-full object-contain" /><button className="absolute right-3 top-3 h-11 w-11 rounded-full bg-panel2" aria-label="Fechar">✕</button></div>}

      {/* Ações da mensagem */}
      <Sheet open={!!sel} onClose={() => { setSel(null); setAllEmoji(false); }} title="Mensagem">
        {sel && lib && (
          <div className="space-y-2">
            {!sel.deleted && canSend && sel.kind !== 'chamada' && (
              <div className="flex flex-wrap items-center justify-between gap-1 rounded-2xl bg-panel2 p-2">
                {(allEmoji ? EMOJIS : QUICK).map((e) => <button key={e} className="h-11 w-11 rounded-full text-2xl" onClick={() => void doReact(sel, e)} aria-label={`Reagir ${e}`}>{e}</button>)}
                {!allEmoji && <button className="h-11 w-11 rounded-full bg-panel text-xl" onClick={() => setAllEmoji(true)} aria-label="Mais emojis">＋</button>}
              </div>
            )}
            <div className="divide-y divide-line overflow-hidden rounded-2xl bg-panel2 text-base">
              {!sel.deleted && canSend && <Act icon="↩️" label="Responder" onClick={() => { setReply(sel); setEditing(null); setSel(null); ta.current?.focus(); }} />}
              {!sel.deleted && sel.body && <Act icon="📋" label="Copiar" onClick={() => { void navigator.clipboard?.writeText(sel.body).then(() => toast('Copiado'), () => toast('Não foi possível copiar')); setSel(null); }} />}
              {!sel.deleted && ['texto', 'media', 'voz'].includes(sel.kind) && <Act icon="↪️" label="Reencaminhar" onClick={() => { setFwd(sel); setSel(null); setFwdList(null); void lib.listChats().then((l) => setFwdList(l.filter((c) => c.status === 'aceite'))); }} />}
              {!sel.deleted && <Act icon={stars.includes(sel.id) ? '☆' : '⭐'} label={stars.includes(sel.id) ? 'Remover das favoritas' : 'Marcar como favorita'} onClick={() => { const on = lib.toggleStar({ id: sel.id, conv: cid, text: lib.previewOf(sel), from: nameOf(sel.senderId), at: sel.createdAt, kind: sel.kind }); setStars(lib.stars().map((x) => x.id)); toast(on ? 'Mensagem favorita ⭐' : 'Removida das favoritas'); setSel(null); }} />}
              {lib.canEdit(sel, me) && <Act icon="✏️" label="Editar" onClick={() => { setEditing(sel); setReply(null); setText(sel.body); setSel(null); setTimeout(() => ta.current?.focus(), 50); }} />}
              <Act icon="🗑️" label="Apagar para mim" onClick={() => { lib.deleteForMe([sel.id]); setMsgs((l) => l.filter((x) => x.id !== sel.id)); setSel(null); toast('Apagada para ti'); }} />
              {lib.canDeleteAll(sel, me) && <Act icon="🚫" label="Apagar para todos" danger onClick={async () => { const m = sel; setSel(null); const r = await lib.deleteForAll(m); if (r.error) setErr(r.error); else { setMsgs((l) => l.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '', meta: { del: true } } : x))); toast('Apagada para todos'); } }} />}
            </div>
            {sel.senderId !== me && !sel.deleted && <div className="flex items-center rounded-2xl bg-panel2 px-2"><MoreMenu kind="mensagem" target={sel.id} label={lib.previewOf(sel).slice(0, 40)} owner={sel.senderId} ownerLabel={nameOf(sel.senderId)} className="!text-base" /><span className="text-sm text-white/70">Denunciar mensagem</span></div>}
            <p className="pt-1 text-center text-xs text-white/40">Enviada {lib.timeLabel(sel.createdAt)} às {hhmm(sel.createdAt)}{sel.senderId === me ? ` · editar até ${lib.EDIT_WINDOW_MIN} min, apagar para todos até ${lib.DELETE_WINDOW_MIN} min` : ''}</p>
          </div>
        )}
      </Sheet>

      {/* Reencaminhar */}
      <Sheet open={!!fwd} onClose={() => setFwd(null)} title="Reencaminhar para…">
        {fwdList === null ? <p className="py-6 text-center text-sm text-white/50">A carregar…</p> : fwdList.length === 0 ? <p className="py-6 text-center text-sm text-white/50">Sem conversas.</p> : (
          <ul className="divide-y divide-line">
            {fwdList.map((c) => (
              <li key={c.id}><button className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left" onClick={async () => {
                if (!fwd || !lib) return; const m = fwd; setFwd(null);
                const r = await lib.send(c.id, { kind: m.kind, text: m.body, meta: { ...(m.meta.file ? { file: m.meta.file } : {}), ...(m.meta.wave ? { wave: m.meta.wave } : {}), fwd: true } });
                if (r.error) setErr(r.error); else { toast(`Reencaminhada para ${c.title}`); if (c.id === cid && r.msg) setMsgs((l) => [...l, r.msg!]); }
              }}><Avatar a={c.photo} name={c.title} size={44} /><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{c.title}</span><span className="block text-xs text-white/50">{c.kind === 'grupo' ? `Grupo · ${c.memberCount}` : c.peer?.handle}</span></span></button></li>
            ))}
          </ul>
        )}
      </Sheet>

      {/* Menu ⋮ */}
      <Sheet open={menu} onClose={() => setMenu(false)} title={chat?.title ?? 'Conversa'}>
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-panel2 text-base">
          <Act icon={isGroup ? '👥' : '👤'} label={isGroup ? 'Informação do grupo' : 'Ver contacto'} onClick={() => { setMenu(false); router.push(infoHref); }} />
          <Act icon="🔍" label="Pesquisar" onClick={() => { setMenu(false); setSearch(true); }} />
          <Act icon="⭐" label="Mensagens favoritas" onClick={() => { setMenu(false); router.push(infoHref + '&tab=favoritas'); }} />
          <Act icon={chat?.muted ? '🔔' : '🔕'} label={chat?.muted ? 'Ativar notificações' : 'Silenciar notificações'} onClick={async () => { if (!chat || !lib) return; await lib.setMuted(cid, !chat.muted); setMenu(false); setChat({ ...chat, muted: !chat.muted }); toast(chat.muted ? 'Notificações ativadas' : 'Conversa silenciada 🔕'); }} />
          <Act icon="🧹" label="Limpar conversa (só para mim)" onClick={() => { if (!lib || !window.confirm('Limpar todas as mensagens desta conversa só no teu telemóvel?')) return; lib.deleteForMe(msgs.map((m) => m.id)); setMsgs([]); setMenu(false); toast('Conversa limpa'); }} />
          {peer && <Act icon="🚫" label={`${blocked ? 'Desbloquear' : 'Bloquear'} ${peer.name}`} danger={!blocked} onClick={() => { toggleBlock(peer.id, peer.name); setMenu(false); }} />}
        </div>
        <p className="mt-3 text-xs text-white/40">Nunca partilhes o teu PIN, códigos de verificação ou palavra-passe. A equipa TXAPILOG nunca os pede por mensagem.</p>
      </Sheet>
    </div>
  );
}

function Act({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={`flex min-h-[52px] w-full items-center gap-3 px-4 text-left ${danger ? 'text-red-300' : ''}`}><span className="w-6 text-center text-lg">{icon}</span>{label}</button>;
}

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return <div className="min-h-[100vh]"><header className="flex items-center gap-2 border-b border-line bg-panel px-2 py-2"><button onClick={onBack} className="h-11 w-9 text-2xl" aria-label="Voltar">‹</button><h1 className="text-lg font-bold">{title}</h1></header>{children}</div>;
}

function renderText(t: string, members: Member[], me: string) {
  if (!t) return null;
  const parts = t.split(/(@[\p{L}\d_.]+|https?:\/\/\S+)/u);
  return parts.map((p, i) => {
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-neon2 underline">{p}</a>;
    if (p.startsWith('@')) { const m = members.find((x) => x.handle.toLowerCase() === p.toLowerCase()); if (m) return <span key={i} className={`font-semibold ${m.id === me ? 'rounded bg-neon2/20 px-0.5 text-neon2' : 'text-neon2'}`}>{p}</span>; }
    return <span key={i}>{p}</span>;
  });
}

function Bubble({ m, me, lib, chat, first, name, member, reacts, starred, flash, onJump, onView, onCall, onPointerDown, onPointerMove, onPointerUp, onContext, onReact }: {
  m: ChatMsg; me: string; lib: Lib | null; chat: Chat | null; first: boolean; name: string; member?: Member; reacts?: Record<string, string[]>; starred: boolean; flash: boolean;
  onJump: (id: string) => void; onView: (u: string) => void; onCall: (video: boolean) => void;
  onPointerDown: (e: React.PointerEvent) => void; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: () => void; onContext: () => void; onReact: (e: string) => void;
}) {
  const mine = m.senderId === me;
  const isGroup = chat?.kind === 'grupo';
  if (m.kind === 'sistema') return <p className="my-2 text-center"><span className="inline-block max-w-[85%] rounded-lg bg-panel2/90 px-3 py-1 text-xs text-white/65">{m.body}</span></p>;
  if (m.kind === 'chamada') {
    const c = m.meta.call;
    const missed = c?.status === 'perdida' || c?.status === 'recusada';
    return (
      <div id={'m-' + m.id} className={`mb-1 flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <button onClick={() => onCall(!!c?.video)} onContextMenu={(e) => { e.preventDefault(); onContext(); }} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${mine ? 'bg-[#2F55C4]' : 'bg-panel2'}`}>
          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${missed ? 'bg-red-500/25' : 'bg-black/25'} text-lg`}>{c?.video ? '📹' : '📞'}</span>
          <span><span className={`block text-sm font-semibold ${missed && !mine ? 'text-red-300' : ''}`}>{lib?.callLabel(c, mine).replace(/^\S+ /, '')}</span><span className="block text-[11px] text-white/60">{mine ? '↗ Efetuada' : '↙ Recebida'} · {hhmm(m.createdAt)} · Ligar de novo</span></span>
        </button>
      </div>
    );
  }
  const read = (() => {
    if (!mine || !chat || m.pending) return null;
    const others = chat.members.filter((x) => x.id !== me);
    const all = others.length > 0 && others.every((x) => x.lastReadAt && x.lastReadAt >= m.createdAt);
    const delivered = others.some((x) => lib?.isOnline(x.id)) || all;
    return <span className={all ? 'text-neon2' : 'text-white/60'} aria-label={all ? 'Lida' : delivered ? 'Entregue' : 'Enviada'}>{all || delivered ? '✓✓' : '✓'}</span>;
  })();
  const f = m.meta.file;
  const fk = f && lib ? lib.fileKind(f.mime) : null;
  const rx = reacts ? Object.entries(reacts) : [];
  const myReact = rx.find(([, who]) => who.includes(me))?.[0];
  return (
    <div id={'m-' + m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${first ? 'mt-2' : 'mt-0.5'} ${rx.length ? 'mb-4' : ''}`}>
      {isGroup && !mine && <span className="mr-1.5 w-8 shrink-0 self-end">{first && member ? <Avatar a={member.avatar} name={member.name} size={30} /> : null}</span>}
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onContextMenu={(e) => { e.preventDefault(); onContext(); }}
        className={`relative max-w-[80%] select-none rounded-2xl px-2.5 pb-1 pt-1.5 text-[15px] leading-snug transition-colors ${mine ? 'bg-[#2F55C4]' : 'bg-panel2'} ${first ? (mine ? 'rounded-tr-sm' : 'rounded-tl-sm') : ''} ${flash ? 'ring-2 ring-neon2' : ''} ${m.pending ? 'opacity-70' : ''}`}>
        {isGroup && !mine && first && <p className="mb-0.5 text-[13px] font-semibold" style={{ color: colorOf(m.senderId) }}>{name}{member?.role === 'admin' ? <span className="ml-1 text-[10px] font-normal text-white/40">admin</span> : null}</p>}
        {m.meta.fwd && !m.deleted && <p className="mb-0.5 text-[12px] italic text-white/55">↪ Reencaminhada</p>}
        {m.meta.reply && !m.deleted && (
          <button onClick={() => onJump(m.meta.reply!.id)} className="mb-1 block w-full rounded-lg border-l-4 border-neon2 bg-black/20 px-2 py-1 text-left">
            <span className="block text-[12px] font-semibold text-neon2">{m.meta.reply.n}</span>
            <span className="line-clamp-2 block text-[13px] text-white/70">{m.meta.reply.t}</span>
          </button>
        )}
        {m.hidden ? <i className="text-white/60">Mensagem removida pela moderação</i> : m.deleted ? (
          <i className="text-white/55">🚫 {mine ? 'Apagaste esta mensagem' : 'Esta mensagem foi apagada'}</i>
        ) : (
          <>
            {m.image && <img src={m.image} alt="Imagem enviada" loading="lazy" className="mb-1 max-h-72 rounded-xl" onClick={() => onView(m.image!)} />}
            {f && fk === 'imagem' && <img src={f.url} alt={m.body || 'Foto'} loading="lazy" className="mb-1 max-h-80 w-full rounded-xl object-cover" onClick={() => onView(f.url)} />}
            {f && fk === 'video' && <video src={f.url} controls playsInline preload="metadata" className="mb-1 max-h-80 w-full rounded-xl bg-black" />}
            {f && (fk === 'audio' || m.kind === 'voz') && (m.kind === 'voz'
              ? <VoicePlayer src={f.url} dur={f.dur} wave={m.meta.wave} mine={mine} />
              : <audio src={f.url} controls preload="none" className="mb-1 w-60" />)}
            {f && fk === 'doc' && (
              <a href={f.url} target="_blank" rel="noopener noreferrer" download={f.name} className="mb-1 flex items-center gap-3 rounded-xl bg-black/20 p-2.5" onClick={(e) => e.stopPropagation()}>
                <span className="text-3xl">📄</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{f.name}</span><span className="block text-[11px] text-white/60">{fmtSize(f.size)} · {f.name.split('.').pop()?.toUpperCase()} · Toca para abrir</span></span>
              </a>
            )}
            {m.body && <p className="whitespace-pre-wrap break-words px-0.5">{renderText(m.body, chat?.members ?? [], me)}</p>}
          </>
        )}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-white/60">
          {starred && <span aria-label="Favorita">⭐</span>}
          {m.edited && !m.deleted && <span>editada</span>}
          <span>{m.pending ? '🕓' : hhmm(m.createdAt)}</span>
          {read}
        </p>
        {rx.length > 0 && (
          <button onClick={() => onReact(myReact ?? rx[0][0])} className={`absolute -bottom-4 ${mine ? 'right-2' : 'left-2'} flex items-center gap-0.5 rounded-full border border-bg bg-panel2 px-1.5 py-0.5 text-sm shadow`} aria-label="Reações">
            {rx.slice(0, 3).map(([e]) => <span key={e}>{e}</span>)}
            {rx.reduce((t, [, w]) => t + w.length, 0) > 1 && <span className="text-[11px] text-white/70">{rx.reduce((t, [, w]) => t + w.length, 0)}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  return <Suspense fallback={<div className="p-6"><div className="card h-24 animate-pulse" /></div>}><Chat /></Suspense>;
}
