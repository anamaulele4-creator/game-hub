// Mensagens diretas 1:1.
// MODO REAL: Supabase (tabelas conversations / conversation_members / messages com RLS; Realtime para novas
// mensagens e recibos de leitura; canal "broadcast" para o indicador "a escrever…"; imagens no bucket privado dm-media).
// MODO DEMO: conversas guardadas no navegador, com respostas automáticas dos ídolos.
import { IS_DEMO } from './config';
import { IDOLS } from './data';
import { friendlyError } from './auth';

export interface DmPeer { id: string; name: string; handle: string; avatar: string; verified: boolean }
export interface DmConversation { id: string; peer: DmPeer; lastAt: string; preview: string; lastFromMe: boolean; unread: number; status: 'aceite' | 'pedido' | 'recusado'; peerStatus: 'aceite' | 'pedido' | 'recusado'; peerReadAt: string; muted: boolean }
export interface DmMessage { id: string; conversationId: string; senderId: string; body: string; image?: string; imagePath?: string; hidden: boolean; createdAt: string; pending?: boolean }

export const DEMO_ME = 'demo-user';
const KEY = 'gamehub-dm-demo-v1';
const sbMod = () => import('./supabase').then((m) => m.sb());

// ---------------- DEMO ----------------
interface DemoDb { convs: { id: string; peerId: string; status: DmConversation['status']; peerStatus: DmConversation['peerStatus']; readAt: string; peerReadAt: string; muted: boolean }[]; msgs: DmMessage[] }
function demoDb(): DemoDb {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const now = Date.now();
  const iso = (m: number) => new Date(now - m * 60000).toISOString();
  const db: DemoDb = {
    convs: [
      { id: 'dm-nyx', peerId: 'nyx', status: 'aceite', peerStatus: 'aceite', readAt: iso(30), peerReadAt: iso(25), muted: false },
      { id: 'dm-kaze', peerId: 'kaze', status: 'pedido', peerStatus: 'aceite', readAt: new Date(0).toISOString(), peerReadAt: iso(5), muted: false },
    ],
    msgs: [
      { id: 'm1', conversationId: 'dm-nyx', senderId: DEMO_ME, body: 'Olá Nyx! Adorei o clipe de ontem 🔥', hidden: false, createdAt: iso(40) },
      { id: 'm2', conversationId: 'dm-nyx', senderId: 'nyx', body: 'Obrigada! 💜 Vens à live hoje às 20h?', hidden: false, createdAt: iso(20) },
      { id: 'm3', conversationId: 'dm-kaze', senderId: 'kaze', body: 'Ei! Vi que estás a treinar sniper. Queres dicas para a AWM? 🎯', hidden: false, createdAt: iso(6) },
    ],
  };
  saveDemo(db);
  return db;
}
function saveDemo(db: DemoDb) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }
function demoPeer(id: string): DmPeer {
  const i = IDOLS.find((x) => x.id === id);
  return i ? { id, name: i.name, handle: i.handle, avatar: i.avatar, verified: i.verified } : { id, name: 'Utilizador', handle: '@utilizador', avatar: '🙂', verified: false };
}
const BOT = ['Boa! 😄', 'Combinado 💜', 'Haha verdade 😂', 'Vemo-nos na live!', 'Bora jogar uma partida? 🎮', 'Obrigado pelo apoio 🙏'];
type Listener = () => void;
const demoListeners = new Set<Listener>();
const emit = () => demoListeners.forEach((l) => l());

// ---------------- API ----------------
export async function myId(): Promise<string> {
  if (IS_DEMO) return DEMO_ME;
  const c = await sbMod();
  const { data } = await c.auth.getUser();
  return data.user?.id ?? '';
}

export async function listConversations(): Promise<DmConversation[]> {
  if (IS_DEMO) {
    const db = demoDb();
    return db.convs.map((cv) => {
      const msgs = db.msgs.filter((m) => m.conversationId === cv.id);
      const last = msgs[msgs.length - 1];
      return { id: cv.id, peer: demoPeer(cv.peerId), lastAt: last?.createdAt ?? '', preview: last ? (last.image && !last.body ? '📷 Imagem' : last.body) : '', lastFromMe: last?.senderId === DEMO_ME, unread: msgs.filter((m) => m.senderId !== DEMO_ME && m.createdAt > cv.readAt).length, status: cv.status, peerStatus: cv.peerStatus, peerReadAt: cv.peerReadAt, muted: cv.muted };
    }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }
  const c = await sbMod();
  const me = await myId();
  if (!me) return [];
  const { data: mine } = await c.from('conversation_members').select('conversation_id,status,last_read_at,muted').eq('user_id', me).neq('status', 'recusado');
  const ids = (mine ?? []).map((m) => m.conversation_id);
  if (!ids.length) return [];
  const [{ data: convs }, { data: members }] = await Promise.all([
    c.from('conversations').select('id,last_message_at,last_message_preview,last_sender_id').in('id', ids).order('last_message_at', { ascending: false }).limit(200),
    c.from('conversation_members').select('conversation_id,user_id,status,last_read_at').in('conversation_id', ids).neq('user_id', me),
  ]);
  const peerIds = Array.from(new Set((members ?? []).map((m) => m.user_id)));
  const { data: profs } = peerIds.length ? await c.from('profiles').select('id,display_name,handle,avatar_url,verified').in('id', peerIds) : { data: [] };
  const unreadByConv: Record<string, number> = {};
  await Promise.all((mine ?? []).map(async (m) => {
    const { count } = await c.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', m.conversation_id).neq('sender_id', me).eq('hidden', false).gt('created_at', m.last_read_at);
    unreadByConv[m.conversation_id] = count ?? 0;
  }));
  return (convs ?? []).map((cv) => {
    const mm = (mine ?? []).find((x) => x.conversation_id === cv.id)!;
    const pm = (members ?? []).find((x) => x.conversation_id === cv.id);
    const p = (profs ?? []).find((x) => x.id === pm?.user_id);
    return {
      id: cv.id, lastAt: cv.last_message_at, preview: cv.last_message_preview, lastFromMe: cv.last_sender_id === me, unread: unreadByConv[cv.id] ?? 0,
      status: mm.status, peerStatus: pm?.status ?? 'aceite', peerReadAt: pm?.last_read_at ?? '', muted: mm.muted,
      peer: { id: pm?.user_id ?? '', name: p?.display_name ?? 'Utilizador', handle: '@' + (p?.handle ?? 'utilizador'), avatar: p?.avatar_url || '🙂', verified: !!p?.verified },
    };
  });
}

export async function unreadTotal(): Promise<number> {
  if (IS_DEMO) return (await import('./chat')).unreadTotal();
  try {
    const c = await sbMod();
    const { data: s } = await c.auth.getSession();
    if (!s.session) return 0;
    const { data } = await c.rpc('dm_unread_count');
    return Number(data ?? 0);
  } catch { return 0; }
}

/** Abre (ou cria) a conversa com outro utilizador. */
export async function startDm(otherId: string): Promise<{ id?: string; error?: string }> {
  if (IS_DEMO) {
    const db = demoDb();
    let cv = db.convs.find((x) => x.peerId === otherId);
    if (!cv) { cv = { id: 'dm-' + otherId, peerId: otherId, status: 'aceite', peerStatus: 'pedido', readAt: new Date().toISOString(), peerReadAt: new Date(0).toISOString(), muted: false }; db.convs.push(cv); saveDemo(db); }
    return { id: cv.id };
  }
  const c = await sbMod();
  const { data, error } = await c.rpc('start_dm', { p_other: otherId });
  return error ? { error: friendlyError(error) } : { id: String(data) };
}

export async function getConversation(id: string): Promise<DmConversation | null> {
  return (await listConversations()).find((x) => x.id === id) ?? null;
}

export async function loadMessages(convId: string, before?: string): Promise<DmMessage[]> {
  if (IS_DEMO) return demoDb().msgs.filter((m) => m.conversationId === convId);
  const c = await sbMod();
  let q = c.from('messages').select('id,conversation_id,sender_id,body,image_path,hidden,created_at').eq('conversation_id', convId).order('created_at', { ascending: false }).limit(60);
  if (before) q = q.lt('created_at', before);
  const { data } = await q;
  const rows = (data ?? []).reverse().map(fromRow);
  await signImages(rows);
  return rows;
}

function fromRow(r: Record<string, unknown>): DmMessage {
  return { id: String(r.id), conversationId: String(r.conversation_id), senderId: String(r.sender_id), body: String(r.body ?? ''), imagePath: (r.image_path as string) || undefined, hidden: !!r.hidden, createdAt: String(r.created_at) };
}

async function signImages(list: DmMessage[]) {
  const paths = list.filter((m) => m.imagePath && !m.image).map((m) => m.imagePath!);
  if (!paths.length) return;
  const c = await sbMod();
  const { data } = await c.storage.from('dm-media').createSignedUrls(paths, 3600);
  for (const m of list) { const s = data?.find((x) => x.path === m.imagePath); if (s?.signedUrl) m.image = s.signedUrl; }
}

export async function sendMessage(convId: string, body: string, file?: File): Promise<{ msg?: DmMessage; error?: string }> {
  const text = body.trim().slice(0, 2000);
  if (!text && !file) return { error: 'Mensagem vazia.' };
  if (IS_DEMO) {
    const db = demoDb();
    let image: string | undefined;
    if (file) image = await toDataUrl(file);
    const msg: DmMessage = { id: 'm' + Date.now(), conversationId: convId, senderId: DEMO_ME, body: text, image, hidden: false, createdAt: new Date().toISOString() };
    db.msgs.push(msg);
    const cv = db.convs.find((x) => x.id === convId);
    if (cv) { cv.readAt = msg.createdAt; if (cv.status === 'pedido') cv.status = 'aceite'; }
    saveDemo(db);
    // Simula leitura + "a escrever…" + resposta do ídolo
    if (cv && cv.peerStatus === 'aceite') {
      setTimeout(() => { const d = demoDb(); const x = d.convs.find((y) => y.id === convId); if (x) { x.peerReadAt = new Date().toISOString(); saveDemo(d); } emit(); typingEmit(convId, true); }, 1200);
      setTimeout(() => {
        const d = demoDb();
        d.msgs.push({ id: 'm' + Date.now(), conversationId: convId, senderId: cv.peerId, body: BOT[Math.floor(Math.random() * BOT.length)], hidden: false, createdAt: new Date().toISOString() });
        saveDemo(d); typingEmit(convId, false); emit();
      }, 3200);
    }
    return { msg };
  }
  const c = await sbMod();
  const me = await myId();
  let image_path: string | null = null;
  if (file) {
    if (!file.type.startsWith('image/')) return { error: 'Só imagens (JPG, PNG, WebP).' };
    if (file.size > 5 * 1024 * 1024) return { error: 'Imagem até 5 MB.' };
    const path = `${convId}/${me}-${Date.now()}.${(file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const up = await c.storage.from('dm-media').upload(path, await shrink(file), { contentType: 'image/jpeg', upsert: false });
    if (up.error) return { error: 'Falha ao enviar a imagem.' };
    image_path = path;
  }
  const { data, error } = await c.from('messages').insert({ conversation_id: convId, body: text, image_path }).select('id,conversation_id,sender_id,body,image_path,hidden,created_at').single();
  if (error) return { error: friendlyError(error) };
  const msg = fromRow(data);
  await signImages([msg]);
  return { msg };
}

export async function markRead(convId: string) {
  const now = new Date().toISOString();
  if (IS_DEMO) { const db = demoDb(); const cv = db.convs.find((x) => x.id === convId); if (cv) { cv.readAt = now; saveDemo(db); } return; }
  const c = await sbMod();
  const me = await myId();
  await c.from('conversation_members').update({ last_read_at: now }).eq('conversation_id', convId).eq('user_id', me);
}

export async function setRequest(convId: string, status: 'aceite' | 'recusado') {
  if (IS_DEMO) { const db = demoDb(); const cv = db.convs.find((x) => x.id === convId); if (cv) { cv.status = status; saveDemo(db); } return; }
  const c = await sbMod();
  const me = await myId();
  await c.from('conversation_members').update({ status }).eq('conversation_id', convId).eq('user_id', me);
}

export async function setMuted(convId: string, muted: boolean) {
  if (IS_DEMO) { const db = demoDb(); const cv = db.convs.find((x) => x.id === convId); if (cv) { cv.muted = muted; saveDemo(db); } return; }
  const c = await sbMod();
  const me = await myId();
  await c.from('conversation_members').update({ muted }).eq('conversation_id', convId).eq('user_id', me);
}

/** Subscreve novas mensagens, recibos de leitura e "a escrever…". Devolve função para cancelar + função para emitir "a escrever". */
export function subscribe(convId: string, me: string, h: { onMessage: (m: DmMessage) => void; onRead: (userId: string, at: string) => void; onTyping: (typing: boolean) => void; onRefresh?: () => void }): { stop: () => void; typing: () => void } {
  if (IS_DEMO) {
    const l = () => h.onRefresh?.();
    demoListeners.add(l);
    const t = (cid: string, on: boolean) => { if (cid === convId) h.onTyping(on); };
    typingListeners.add(t);
    return { stop: () => { demoListeners.delete(l); typingListeners.delete(t); }, typing: () => {} };
  }
  let channel: { send: (x: unknown) => unknown; unsubscribe: () => unknown } | null = null;
  let stopped = false;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  void sbMod().then((c) => {
    if (stopped) return;
    const ch = c.channel(`dm:${convId}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, async (p) => {
        const m = fromRow(p.new as Record<string, unknown>);
        await signImages([m]);
        h.onMessage(m);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, () => h.onRefresh?.())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${convId}` }, (p) => {
        const r = p.new as { user_id: string; last_read_at: string };
        if (r.user_id !== me) h.onRead(r.user_id, r.last_read_at);
      })
      .on('broadcast', { event: 'typing' }, (p) => {
        if ((p.payload as { user: string }).user === me) return;
        h.onTyping(true);
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = setTimeout(() => h.onTyping(false), 3500);
      })
      .subscribe();
    channel = ch as unknown as typeof channel;
  });
  let lastTyping = 0;
  return {
    stop: () => { stopped = true; void channel?.unsubscribe(); },
    typing: () => { const n = Date.now(); if (n - lastTyping > 2000 && channel) { lastTyping = n; void channel.send({ type: 'broadcast', event: 'typing', payload: { user: me } }); } },
  };
}

const typingListeners = new Set<(cid: string, on: boolean) => void>();
function typingEmit(cid: string, on: boolean) { typingListeners.forEach((l) => l(cid, on)); }

function toDataUrl(f: File): Promise<string> {
  return shrink(f).then((b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); }));
}

/** Reduz a imagem para 1080px / JPEG 0.8 (menos dados móveis). */
function shrink(f: File): Promise<Blob> {
  return new Promise((res) => {
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const s = Math.min(1, 1080 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => res(b ?? f), 'image/jpeg', 0.8);
    };
    img.onerror = () => res(f);
    img.src = url;
  });
}

export function timeLabel(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const diff = (now.getTime() - d.getTime()) / 86400000;
  return diff < 7 ? d.toLocaleDateString('pt-PT', { weekday: 'short' }) : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}
