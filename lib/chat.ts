// Chat estilo WhatsApp: conversas 1:1 e grupos, mensagens ricas (resposta, reações, editar, apagar, reencaminhar,
// fotos/vídeos/ficheiros, voz, chamadas), recibos ✓/✓✓, "a escrever…", online.
//
// MODO REAL (Supabase): usa as tabelas conversations / conversation_members / messages (schema.sql, secção 14).
//  · Sem a migração supabase/migrations/2026-10-08-chat-groups-calls.sql: tudo o que é 1:1 funciona — os
//    metadados (tipo, ficheiro, voz, resposta, reação…) vão no fim do texto da mensagem, depois de um separador invisível.
//    Grupos ficam bloqueados com uma mensagem clara.
//  · Com a migração: colunas próprias (kind, meta, reply_to, edited_at, deleted_at) e grupos ativos.
// MODO DEMO: tudo no navegador (localStorage), com respostas automáticas.
import { IS_DEMO, MAX_UPLOAD_MB } from './config';
import { IDOLS } from './data';
import { friendlyError } from './auth';

export type MsgKind = 'texto' | 'media' | 'voz' | 'sistema' | 'chamada' | 'reacao';
export interface FileRef { url: string; path?: string; mime: string; name: string; size: number; dur?: number }
export interface CallInfo { video: boolean; status: 'a chamar' | 'atendida' | 'perdida' | 'recusada'; dur?: number }
export interface ReplyRef { id: string; n: string; t: string }
export interface MsgMeta {
  k?: MsgKind;            // tipo (só no modo sem migração)
  file?: FileRef;
  wave?: string;          // forma de onda da voz: letras a–p (0–15)
  call?: CallInfo;
  to?: string; e?: string; // reação: mensagem alvo + emoji ('' = remover)
  fwd?: boolean;
  mentions?: string[];
  reply?: ReplyRef;
  edited?: boolean;
  del?: boolean;
  sys?: string;
}
export interface ChatMsg {
  id: string; conversationId: string; senderId: string; kind: MsgKind; body: string; meta: MsgMeta;
  createdAt: string; edited: boolean; deleted: boolean; hidden: boolean; image?: string; pending?: boolean;
}
export interface Member { id: string; name: string; handle: string; avatar: string; verified: boolean; role: 'admin' | 'membro'; lastReadAt: string; status: string }
export interface Chat {
  id: string; kind: 'direta' | 'grupo'; title: string; photo: string; description: string;
  peer?: Member; members: Member[]; memberCount: number;
  lastAt: string; preview: string; lastFromMe: boolean; lastSenderName: string; unread: number;
  status: 'aceite' | 'pedido' | 'recusado'; peerStatus: 'aceite' | 'pedido' | 'recusado'; muted: boolean;
  myRole: 'admin' | 'membro'; onlyAdminsSend: boolean; onlyAdminsEdit: boolean; inviteCode: string; createdBy: string;
}

export const EDIT_WINDOW_MIN = 15;
export const DELETE_WINDOW_MIN = 60;
export const VOICE_MAX_SEC = 300;
export const GROUPS_OFF_MSG = 'Grupos a ser ativados em breve: falta aplicar a atualização da base de dados.';
const SEP = '\u2063';
const sbMod = () => import('./supabase').then((m) => m.sb());

// ---------------- codificação (modo sem migração) ----------------
function b64e(s: string) { const b = new TextEncoder().encode(s); let x = ''; b.forEach((c) => { x += String.fromCharCode(c); }); return btoa(x); }
function b64d(s: string) { const x = atob(s); const b = new Uint8Array(x.length); for (let i = 0; i < x.length; i++) b[i] = x.charCodeAt(i); return new TextDecoder().decode(b); }
export function encodeBody(text: string, meta?: MsgMeta | null): string {
  if (!meta || !Object.keys(meta).length) return text;
  return `${text}${SEP}M${b64e(JSON.stringify(meta))}`;
}
export function decodeBody(raw: string): { text: string; meta: MsgMeta } {
  const i = raw.indexOf(SEP);
  if (i < 0) return { text: raw, meta: {} };
  const tail = raw.slice(i + 1);
  let meta: MsgMeta = {};
  if (tail.startsWith('M')) { try { meta = JSON.parse(b64d(tail.slice(1))) as MsgMeta; } catch {} }
  return { text: raw.slice(0, i), meta };
}
export const cleanPreview = (p: string) => (p || '').split(SEP)[0];

// ---------------- capacidades ----------------
let v2Cache: Promise<boolean> | null = null;
/** A migração do chat (grupos + colunas novas) já foi aplicada? */
export function chatV2(): Promise<boolean> {
  if (IS_DEMO) return Promise.resolve(true);
  v2Cache ??= sbMod().then(async (c) => {
    const { error } = await c.from('messages').select('kind,meta').limit(1);
    return !error;
  }).catch(() => false);
  return v2Cache;
}

// ---------------- local: apagar para mim, favoritas ----------------
const HK = 'poipak-chat-hidden';
const SK = 'poipak-chat-stars';
const rd = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || '') as T; } catch { return d; } };
const wr = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const hiddenForMe = (): string[] => rd<string[]>(HK, []);
export function deleteForMe(ids: string[]) { wr(HK, Array.from(new Set([...hiddenForMe(), ...ids])).slice(-3000)); }
export interface Star { id: string; conv: string; text: string; from: string; at: string; kind: MsgKind }
export const stars = (): Star[] => rd<Star[]>(SK, []);
export function toggleStar(s: Star): boolean {
  const l = stars(); const has = l.some((x) => x.id === s.id);
  wr(SK, has ? l.filter((x) => x.id !== s.id) : [s, ...l].slice(0, 500));
  return !has;
}

// ---------------- presença global (online) ----------------
const online = new Set<string>();
const presL = new Set<() => void>();
export const isOnline = (id: string) => online.has(id);
export function onPresence(f: () => void) { presL.add(f); return () => { presL.delete(f); }; }
export function setOnlineIds(ids: string[]) { online.clear(); ids.forEach((i) => online.add(i)); presL.forEach((f) => f()); }

// ---------------- DEMO ----------------
export const DEMO_ME = 'demo-user';
const KEY = 'poipak-chat-demo-v1';
interface DemoChat { id: string; kind: 'direta' | 'grupo'; title: string; photo: string; description: string; members: { id: string; role: 'admin' | 'membro'; readAt: string; status: Chat['status'] }[]; muted: boolean; onlyAdminsSend: boolean; onlyAdminsEdit: boolean; invite: string; createdBy: string }
interface DemoDb { chats: DemoChat[]; msgs: ChatMsg[] }
const SAMPLE_VOICE = 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3';
const SAMPLE_IMG = 'https://interactive-examples.mdn.mozilla.net/media/cc0-images/grapefruit-slice-332-332.jpg';
function dm(id: string, conv: string, from: string, body: string, minAgo: number, kind: MsgKind = 'texto', meta: MsgMeta = {}): ChatMsg {
  return { id, conversationId: conv, senderId: from, kind, body, meta, createdAt: new Date(Date.now() - minAgo * 60000).toISOString(), edited: false, deleted: false, hidden: false };
}
function demoDb(): DemoDb {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as DemoDb; } catch {}
  const iso = (m: number) => new Date(Date.now() - m * 60000).toISOString();
  const db: DemoDb = {
    chats: [
      { id: 'dm-nyx', kind: 'direta', title: '', photo: '', description: '', members: [{ id: DEMO_ME, role: 'membro', readAt: iso(1), status: 'aceite' }, { id: 'nyx', role: 'membro', readAt: iso(2), status: 'aceite' }], muted: false, onlyAdminsSend: false, onlyAdminsEdit: true, invite: '', createdBy: DEMO_ME },
      { id: 'grp-squad', kind: 'grupo', title: 'Squad Free Fire MZ 🔥', photo: '🎮', description: 'Treinos às 20h, torneios ao fim de semana. Respeito acima de tudo.', members: [{ id: DEMO_ME, role: 'admin', readAt: iso(3), status: 'aceite' }, { id: 'nyx', role: 'admin', readAt: iso(3), status: 'aceite' }, { id: 'lua', role: 'membro', readAt: iso(8), status: 'aceite' }, { id: 'kaze', role: 'membro', readAt: iso(3), status: 'aceite' }], muted: false, onlyAdminsSend: false, onlyAdminsEdit: true, invite: 'squadmz2026', createdBy: DEMO_ME },
      { id: 'dm-kaze', kind: 'direta', title: '', photo: '', description: '', members: [{ id: DEMO_ME, role: 'membro', readAt: new Date(0).toISOString(), status: 'pedido' }, { id: 'kaze', role: 'membro', readAt: iso(5), status: 'aceite' }], muted: false, onlyAdminsSend: false, onlyAdminsEdit: true, invite: '', createdBy: 'kaze' },
    ],
    msgs: [
      dm('n1', 'dm-nyx', DEMO_ME, 'Olá Nyx! Adorei o clipe de ontem 🔥', 45),
      dm('n2', 'dm-nyx', 'nyx', 'Obrigada! 💜 Vens à live hoje às 20h?', 40),
      dm('n3', 'dm-nyx', 'nyx', '', 38, 'voz', { file: { url: SAMPLE_VOICE, mime: 'audio/mpeg', name: 'voz.mp3', size: 30000, dur: 9 }, wave: 'cfjmpnkhfdgjmolieceghkmnkgdb' }),
      dm('n4', 'dm-nyx', DEMO_ME, 'Vou sim! Guarda-me um lugar no squad 😎', 30, 'texto', { reply: { id: 'n2', n: 'Nyx Matola', t: 'Obrigada! 💜 Vens à live hoje às 20h?' } }),
      dm('n5', 'dm-nyx', 'nyx', '', 20, 'chamada', { call: { video: true, status: 'atendida', dur: 184 } }),
      dm('n6', 'dm-nyx', 'nyx', 'Combinado. Até logo 👋', 2),
      dm('g0', 'grp-squad', DEMO_ME, 'Tu criaste o grupo "Squad Free Fire MZ 🔥"', 120, 'sistema', { sys: 'criou' }),
      dm('g1', 'grp-squad', DEMO_ME, 'Tu adicionaste Nyx Matola, Lua Gamer e Kaze', 119, 'sistema', { sys: 'entrou' }),
      dm('g2', 'grp-squad', 'nyx', 'Bora treinar hoje? Mapa Bermuda às 20h 🗺️', 60),
      dm('g3', 'grp-squad', 'lua', '', 50, 'media', { file: { url: SAMPLE_IMG, mime: 'image/jpeg', name: 'tatica.jpg', size: 42000 } }),
      dm('g4', 'grp-squad', 'kaze', '@ana fica com a AWM, eu faço rush 🎯', 10, 'texto', { mentions: [DEMO_ME] }),
    ],
  };
  db.msgs.push({ ...dm('r1', 'grp-squad', 'nyx', 'Reagiu 🔥', 9, 'reacao', { to: 'g4', e: '🔥' }) });
  db.msgs.push({ ...dm('r2', 'grp-squad', 'lua', 'Reagiu 👍', 8, 'reacao', { to: 'g4', e: '👍' }) });
  saveDemo(db);
  return db;
}
function saveDemo(db: DemoDb) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }
function demoPerson(id: string): Omit<Member, 'role' | 'lastReadAt' | 'status'> {
  if (id === DEMO_ME) {
    try { const st = JSON.parse(localStorage.getItem('gamehub-demo-v1') || '{}') as { user?: { name?: string; avatar?: string; handle?: string } }; if (st.user?.name) return { id, name: st.user.name, handle: st.user.handle || '@ana', avatar: st.user.avatar || '🦄', verified: false }; } catch {}
    return { id, name: 'Ana Maulele', handle: '@ana', avatar: '🦄', verified: false };
  }
  const i = IDOLS.find((x) => x.id === id);
  return i ? { id, name: i.name, handle: i.handle, avatar: i.avatar, verified: i.verified } : { id, name: 'Utilizador', handle: '@utilizador', avatar: '🙂', verified: false };
}
const demoListeners = new Set<(conv: string) => void>();
const demoTyping = new Set<(conv: string, who: string) => void>();
const emit = (conv: string) => demoListeners.forEach((l) => l(conv));
const BOT = ['Boa! 😄', 'Combinado 💜', 'Haha verdade 😂', 'Vemo-nos na live!', 'Bora jogar uma partida? 🎮', 'Obrigado pelo apoio 🙏'];

function demoToChat(cv: DemoChat, db: DemoDb): Chat {
  const msgs = db.msgs.filter((m) => m.conversationId === cv.id && m.kind !== 'reacao');
  const last = msgs[msgs.length - 1];
  const me = cv.members.find((m) => m.id === DEMO_ME) ?? cv.members[0];
  const members: Member[] = cv.members.map((m) => ({ ...demoPerson(m.id), role: m.role, lastReadAt: m.readAt, status: m.status }));
  const peer = cv.kind === 'direta' ? members.find((m) => m.id !== DEMO_ME) : undefined;
  return {
    id: cv.id, kind: cv.kind, title: cv.kind === 'grupo' ? cv.title : peer?.name ?? 'Conversa', photo: cv.kind === 'grupo' ? cv.photo : peer?.avatar ?? '🙂', description: cv.description,
    peer, members, memberCount: members.length,
    lastAt: last?.createdAt ?? '', preview: last ? previewOf(last) : '', lastFromMe: last?.senderId === DEMO_ME, lastSenderName: last ? demoPerson(last.senderId).name.split(' ')[0] : '',
    unread: msgs.filter((m) => m.senderId !== DEMO_ME && m.kind !== 'sistema' && m.createdAt > me.readAt).length,
    status: me.status, peerStatus: (peer?.status ?? 'aceite') as Chat['peerStatus'], muted: cv.muted, myRole: me.role, onlyAdminsSend: cv.onlyAdminsSend, onlyAdminsEdit: cv.onlyAdminsEdit, inviteCode: cv.invite, createdBy: cv.createdBy,
  };
}

// ---------------- util ----------------
export const fmtSec = (s?: number) => { const t = Math.max(0, Math.round(s ?? 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export function fileKind(mime: string): 'imagem' | 'video' | 'audio' | 'doc' {
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'doc';
}
export function callLabel(c?: CallInfo, mine?: boolean) {
  if (!c) return '📞 Chamada';
  const t = c.video ? 'Chamada de vídeo' : 'Chamada de voz';
  if (c.status === 'atendida') return `${c.video ? '📹' : '📞'} ${t} · ${c.dur && c.dur >= 60 ? `${Math.round(c.dur / 60)} min` : `${c.dur ?? 0} s`}`;
  if (c.status === 'perdida') return `${mine ? '📞' : '📵'} ${t} ${mine ? 'sem resposta' : 'perdida'}`;
  if (c.status === 'recusada') return `📵 ${t} recusada`;
  return `${c.video ? '📹' : '📞'} ${t}…`;
}
export function previewOf(m: ChatMsg): string {
  if (m.deleted) return '🚫 Mensagem apagada';
  if (m.kind === 'voz') return `🎤 Mensagem de voz${m.meta.file?.dur ? ` (${fmtSec(m.meta.file.dur)})` : ''}`;
  if (m.kind === 'chamada') return callLabel(m.meta.call);
  if (m.kind === 'reacao') return `Reagiu ${m.meta.e ?? ''}`;
  if (m.kind === 'media' && m.meta.file) {
    const k = fileKind(m.meta.file.mime);
    const lab = k === 'imagem' ? '📷 Foto' : k === 'video' ? '🎬 Vídeo' : k === 'audio' ? '🎵 Áudio' : `📄 ${m.meta.file.name}`;
    return m.body ? `${lab.split(' ')[0]} ${m.body}` : lab;
  }
  if (m.image && !m.body) return '📷 Imagem';
  return m.body;
}

function fromRow(r: Record<string, unknown>, v2: boolean): ChatMsg {
  const raw = String(r.body ?? '');
  let text = raw; let meta: MsgMeta = {}; let kind: MsgKind = 'texto';
  if (v2 && r.kind) {
    kind = r.kind as MsgKind; meta = (r.meta as MsgMeta) ?? {};
    const d = decodeBody(raw); if (d.meta.k) { kind = d.meta.k; meta = { ...d.meta, ...meta }; } text = d.text;
  } else {
    const d = decodeBody(raw); text = d.text; meta = d.meta; kind = d.meta.k ?? 'texto';
  }
  // Rótulos legíveis gravados no texto (modo sem migração) não são legenda
  if (kind === 'voz' || kind === 'chamada' || kind === 'reacao' || meta.del) text = '';
  if (kind === 'media' && meta.file && /^(📷|🎬|🎵|📄) /.test(text) && !(meta as { cap?: boolean }).cap) text = '';
  const deleted = !!r.deleted_at || !!meta.del;
  return {
    id: String(r.id), conversationId: String(r.conversation_id), senderId: String(r.sender_id), kind, body: deleted ? '' : text, meta,
    createdAt: String(r.created_at), edited: !!r.edited_at || !!meta.edited, deleted, hidden: !!r.hidden,
    image: undefined, ...(r.image_path ? { imagePath: String(r.image_path) } : {}),
  } as ChatMsg;
}

async function signLegacy(list: (ChatMsg & { imagePath?: string })[]) {
  const paths = list.filter((m) => m.imagePath && !m.image).map((m) => m.imagePath!);
  if (!paths.length) return;
  const c = await sbMod();
  const { data } = await c.storage.from('dm-media').createSignedUrls(paths, 3600);
  for (const m of list) { const s = data?.find((x) => x.path === m.imagePath); if (s?.signedUrl) m.image = s.signedUrl; }
}

// ---------------- API ----------------
export async function myId(): Promise<string> {
  if (IS_DEMO) return DEMO_ME;
  const c = await sbMod();
  const { data } = await c.auth.getSession();
  return data.session?.user.id ?? '';
}

type Prof = { id: string; display_name?: string; handle?: string; avatar_url?: string; verified?: boolean };
function toMember(p: Prof | undefined, id: string, row?: Record<string, unknown>): Member {
  return { id, name: p?.display_name || p?.handle || 'Utilizador', handle: '@' + (p?.handle ?? 'utilizador'), avatar: p?.avatar_url || '🙂', verified: !!p?.verified,
    role: (row?.role as Member['role']) ?? 'membro', lastReadAt: String(row?.last_read_at ?? ''), status: String(row?.status ?? 'aceite') };
}

export async function listChats(): Promise<Chat[]> {
  if (IS_DEMO) { const db = demoDb(); return db.chats.map((cv) => demoToChat(cv, db)).sort((a, b) => b.lastAt.localeCompare(a.lastAt)); }
  const c = await sbMod();
  const me = await myId();
  if (!me) return [];
  const v2 = await chatV2();
  const { data: mine } = await c.from('conversation_members').select('*').eq('user_id', me).neq('status', 'recusado');
  const ids = (mine ?? []).map((m) => m.conversation_id as string);
  if (!ids.length) return [];
  const [{ data: convs }, { data: others }] = await Promise.all([
    c.from('conversations').select('*').in('id', ids).order('last_message_at', { ascending: false }).limit(300),
    c.from('conversation_members').select('*').in('conversation_id', ids).neq('user_id', me).limit(3000),
  ]);
  const want = new Set<string>();
  for (const cv of convs ?? []) {
    if (cv.kind === 'grupo') { if (cv.last_sender_id && cv.last_sender_id !== me) want.add(cv.last_sender_id); }
    else { const pm = (others ?? []).find((x) => x.conversation_id === cv.id); if (pm) want.add(pm.user_id); }
  }
  const { data: profs } = want.size ? await c.from('profiles').select('id,display_name,handle,avatar_url,verified').in('id', Array.from(want)) : { data: [] as Prof[] };
  const unread: Record<string, number> = {};
  await Promise.all((mine ?? []).map(async (m) => {
    let q = c.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', m.conversation_id).neq('sender_id', me).eq('hidden', false).gt('created_at', m.last_read_at);
    if (v2) q = q.not('kind', 'in', '(reacao,sistema)');
    const { count } = await q;
    unread[m.conversation_id] = count ?? 0;
  }));
  return (convs ?? []).map((cv) => {
    const mm = (mine ?? []).find((x) => x.conversation_id === cv.id)!;
    const mem = (others ?? []).filter((x) => x.conversation_id === cv.id);
    const group = cv.kind === 'grupo';
    const pm = group ? undefined : mem[0];
    const peer = pm ? toMember((profs ?? []).find((p) => p.id === pm.user_id), pm.user_id, pm) : undefined;
    const ls = (profs ?? []).find((p) => p.id === cv.last_sender_id);
    return {
      id: cv.id, kind: group ? 'grupo' : 'direta', title: group ? (cv.title || 'Grupo') : peer?.name ?? 'Conversa', photo: group ? (cv.photo_url || '👥') : peer?.avatar ?? '🙂', description: cv.description ?? '',
      peer, members: peer ? [peer] : [], memberCount: mem.length + 1,
      lastAt: cv.last_message_at, preview: cleanPreview(cv.last_message_preview), lastFromMe: cv.last_sender_id === me, lastSenderName: (ls?.display_name || ls?.handle || '').split(' ')[0],
      unread: unread[cv.id] ?? 0, status: mm.status, peerStatus: pm?.status ?? 'aceite', muted: !!mm.muted, myRole: mm.role ?? 'membro',
      onlyAdminsSend: !!cv.only_admins_send, onlyAdminsEdit: cv.only_admins_edit !== false, inviteCode: cv.invite_code ?? '', createdBy: cv.created_by ?? '',
    } as Chat;
  });
}

export async function unreadTotal(): Promise<number> {
  if (IS_DEMO) return (await listChats()).filter((c) => c.status === 'aceite' && !c.muted).reduce((t, c) => t + c.unread, 0);
  const m = await import('./dm');
  return m.unreadTotal();
}

/** Conversa completa (com todos os membros e perfis). */
export async function getChat(id: string): Promise<Chat | null> {
  if (IS_DEMO) { const db = demoDb(); const cv = db.chats.find((x) => x.id === id); return cv ? demoToChat(cv, db) : null; }
  const base = (await listChats()).find((x) => x.id === id);
  if (!base) return null;
  if (base.kind !== 'grupo') return base;
  const c = await sbMod();
  const { data: rows } = await c.from('conversation_members').select('*').eq('conversation_id', id).limit(300);
  const uids = (rows ?? []).map((r) => r.user_id as string);
  const { data: profs } = uids.length ? await c.from('profiles').select('id,display_name,handle,avatar_url,verified').in('id', uids) : { data: [] as Prof[] };
  const members = (rows ?? []).map((r) => toMember((profs ?? []).find((p) => p.id === r.user_id), r.user_id, r))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'admin' ? -1 : 1));
  return { ...base, members, memberCount: members.length };
}

export async function loadMessages(convId: string, opts: { before?: string; limit?: number } = {}): Promise<ChatMsg[]> {
  const hid = new Set(hiddenForMe());
  if (IS_DEMO) return demoDb().msgs.filter((m) => m.conversationId === convId && !hid.has(m.id));
  const c = await sbMod();
  const v2 = await chatV2();
  let q = c.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: false }).limit(opts.limit ?? 120);
  if (opts.before) q = q.lt('created_at', opts.before);
  const { data } = await q;
  const rows = (data ?? []).reverse().map((r) => fromRow(r, v2)).filter((m) => !hid.has(m.id));
  await signLegacy(rows);
  return rows;
}

// ---------------- enviar ----------------
export interface SendInput { text?: string; kind?: MsgKind; meta?: MsgMeta }
function readable(kind: MsgKind, text: string, meta: MsgMeta): string {
  const fake = { kind, body: text, meta, deleted: false } as ChatMsg;
  return (kind === 'texto' ? text : previewOf(fake)) || '·';
}

export async function send(convId: string, inp: SendInput): Promise<{ msg?: ChatMsg; error?: string }> {
  const kind = inp.kind ?? (inp.meta?.file ? 'media' : 'texto');
  const text = (inp.text ?? '').trim().slice(0, 1800);
  const meta: MsgMeta = { ...(inp.meta ?? {}) };
  if (kind === 'texto' && !text) return { error: 'Mensagem vazia.' };
  if (IS_DEMO) {
    const db = demoDb();
    const msg: ChatMsg = { id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), conversationId: convId, senderId: DEMO_ME, kind, body: text, meta, createdAt: new Date().toISOString(), edited: false, deleted: false, hidden: false };
    db.msgs.push(msg);
    const cv = db.chats.find((x) => x.id === convId);
    const mine = cv?.members.find((m) => m.id === DEMO_ME);
    if (mine) { mine.readAt = msg.createdAt; if (mine.status === 'pedido') mine.status = 'aceite'; }
    saveDemo(db);
    if (cv && kind !== 'reacao' && kind !== 'chamada') demoReply(cv, text);
    return { msg };
  }
  const c = await sbMod();
  const v2 = await chatV2();
  const row: Record<string, unknown> = { conversation_id: convId };
  if (v2) { row.body = kind === 'texto' || kind === 'media' ? text : ''; row.kind = kind; row.meta = Object.keys(meta).length ? meta : null; if (meta.reply) row.reply_to = meta.reply.id; }
  else {
    const caption = kind === 'media' && text;
    row.body = encodeBody(kind === 'texto' ? text : caption ? text : readable(kind, text, meta), { ...meta, k: kind, ...(caption ? { cap: true } : {}) } as MsgMeta);
  }
  const { data, error } = await c.from('messages').insert(row).select('*').single();
  if (error) return { error: friendlyError(error) };
  return { msg: fromRow(data, v2) };
}

function demoReply(cv: DemoChat, text: string) {
  const others = cv.members.filter((m) => m.id !== DEMO_ME && m.status === 'aceite');
  if (!others.length) return;
  const who = others[Math.floor(Math.random() * others.length)].id;
  setTimeout(() => { const d = demoDb(); const x = d.chats.find((y) => y.id === cv.id); x?.members.forEach((m) => { if (m.id !== DEMO_ME) m.readAt = new Date().toISOString(); }); saveDemo(d); emit(cv.id); demoTyping.forEach((f) => f(cv.id, who)); }, 1200);
  setTimeout(() => {
    const d = demoDb();
    const body = /\?$/.test(text) ? 'Sim! 👍' : BOT[Math.floor(Math.random() * BOT.length)];
    d.msgs.push({ id: 'm' + Date.now(), conversationId: cv.id, senderId: who, kind: 'texto', body, meta: {}, createdAt: new Date().toISOString(), edited: false, deleted: false, hidden: false });
    saveDemo(d); demoTyping.forEach((f) => f(cv.id, '')); emit(cv.id);
  }, 3400);
}

export async function react(convId: string, target: ChatMsg, emoji: string) {
  return send(convId, { kind: 'reacao', meta: { to: target.id, e: emoji } });
}

/** Junta as reações: alvo → { emoji → [quem] } (a última reação de cada pessoa ganha). */
export function reactionsOf(msgs: ChatMsg[]): Record<string, Record<string, string[]>> {
  const last: Record<string, Record<string, string>> = {};
  for (const m of msgs) if (m.kind === 'reacao' && m.meta.to) { (last[m.meta.to] ??= {})[m.senderId] = m.meta.e ?? ''; }
  const out: Record<string, Record<string, string[]>> = {};
  for (const [to, by] of Object.entries(last)) for (const [u, e] of Object.entries(by)) if (e) ((out[to] ??= {})[e] ??= []).push(u);
  return out;
}

async function updateOwn(m: ChatMsg, patch: { body?: string; meta?: MsgMeta; del?: boolean }): Promise<{ error?: string }> {
  if (IS_DEMO) {
    const db = demoDb(); const x = db.msgs.find((y) => y.id === m.id); if (!x) return {};
    if (patch.del) { x.deleted = true; x.body = ''; x.meta = { del: true }; }
    if (patch.body !== undefined) { x.body = patch.body; x.edited = true; }
    if (patch.meta) x.meta = { ...x.meta, ...patch.meta };
    saveDemo(db); emit(m.conversationId); return {};
  }
  const c = await sbMod();
  const v2 = await chatV2();
  let row: Record<string, unknown>;
  if (v2) {
    row = patch.del ? { deleted_at: new Date().toISOString() } : { ...(patch.body !== undefined ? { body: patch.body } : {}), ...(patch.meta ? { meta: { ...m.meta, ...patch.meta } } : {}) };
  } else {
    const meta: MsgMeta = { ...m.meta, ...(patch.meta ?? {}), k: m.kind };
    if (patch.del) row = { body: encodeBody('🚫 Mensagem apagada', { k: m.kind, del: true }), image_path: null };
    else if (patch.body !== undefined) row = { body: encodeBody(patch.body, { ...meta, edited: true }) };
    else row = { body: encodeBody(m.kind === 'texto' || m.kind === 'media' ? m.body : readable(m.kind, m.body, meta), meta) };
  }
  const { error } = await c.from('messages').update(row).eq('id', m.id);
  return error ? { error: friendlyError(error) } : {};
}

export const canEdit = (m: ChatMsg, me: string) => m.senderId === me && m.kind === 'texto' && !m.deleted && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MIN * 60000;
export const canDeleteAll = (m: ChatMsg, me: string) => m.senderId === me && !m.deleted && m.kind !== 'sistema' && Date.now() - new Date(m.createdAt).getTime() < DELETE_WINDOW_MIN * 60000;
export const editMessage = (m: ChatMsg, body: string) => updateOwn(m, { body: body.trim().slice(0, 1800) });
export const deleteForAll = (m: ChatMsg) => updateOwn(m, { del: true });
export const updateCall = (m: ChatMsg, call: CallInfo) => updateOwn(m, { meta: { call } });

export async function markRead(convId: string) {
  const now = new Date().toISOString();
  if (IS_DEMO) { const db = demoDb(); const m = db.chats.find((x) => x.id === convId)?.members.find((y) => y.id === DEMO_ME); if (m) { m.readAt = now; saveDemo(db); } return; }
  const c = await sbMod(); const me = await myId();
  await c.from('conversation_members').update({ last_read_at: now }).eq('conversation_id', convId).eq('user_id', me);
}
export async function setMuted(convId: string, muted: boolean) {
  if (IS_DEMO) { const db = demoDb(); const cv = db.chats.find((x) => x.id === convId); if (cv) { cv.muted = muted; saveDemo(db); } return; }
  const c = await sbMod(); const me = await myId();
  await c.from('conversation_members').update({ muted }).eq('conversation_id', convId).eq('user_id', me);
}
export async function setRequest(convId: string, status: 'aceite' | 'recusado') {
  if (IS_DEMO) { const db = demoDb(); const m = db.chats.find((x) => x.id === convId)?.members.find((y) => y.id === DEMO_ME); if (m) { m.status = status; saveDemo(db); } return; }
  const c = await sbMod(); const me = await myId();
  await c.from('conversation_members').update({ status }).eq('conversation_id', convId).eq('user_id', me);
}

/** Abre (ou cria) a conversa 1:1. Só com quem segues (verificado na página e no servidor). */
export async function startDirect(otherId: string): Promise<{ id?: string; error?: string }> {
  if (IS_DEMO) {
    const db = demoDb();
    let cv = db.chats.find((x) => x.kind === 'direta' && x.members.some((m) => m.id === otherId));
    if (!cv) { cv = { id: 'dm-' + otherId, kind: 'direta', title: '', photo: '', description: '', members: [{ id: DEMO_ME, role: 'membro', readAt: new Date().toISOString(), status: 'aceite' }, { id: otherId, role: 'membro', readAt: new Date(0).toISOString(), status: 'aceite' }], muted: false, onlyAdminsSend: false, onlyAdminsEdit: true, invite: '', createdBy: DEMO_ME }; db.chats.push(cv); saveDemo(db); }
    return { id: cv.id };
  }
  return (await import('./dm')).startDm(otherId);
}

// ---------------- ficheiros ----------------
export const TOO_BIG = `Ficheiro demasiado grande (máx. ${MAX_UPLOAD_MB} MB).`;
function shrinkImage(f: Blob, max = 1600): Promise<Blob> {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(f);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      cv.toBlob((b) => res(b && b.size < f.size ? b : f), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(f); };
    img.src = url;
  });
}
const toDataUrl = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(''); r.readAsDataURL(b); });

/** Envia um ficheiro do chat para o Storage (bucket clips, pasta chat/<conversa>/…). Devolve o FileRef. */
export async function uploadChatFile(convId: string, file: Blob, name: string, opts: { dur?: number } = {}): Promise<{ file?: FileRef; error?: string }> {
  let blob: Blob = file; let mime = file.type || 'application/octet-stream';
  if (mime.startsWith('image/') && mime !== 'image/gif') { blob = await shrinkImage(file); if (blob !== file) mime = 'image/jpeg'; }
  if (blob.size > MAX_UPLOAD_MB * 1024 * 1024) return { error: TOO_BIG };
  const ref = (url: string, path?: string): FileRef => ({ url, path, mime, name: name.slice(0, 80), size: blob.size, ...(opts.dur ? { dur: Math.round(opts.dur) } : {}) });
  if (IS_DEMO) return { file: ref(blob.size < 1_500_000 ? await toDataUrl(blob) : URL.createObjectURL(blob)) };
  try {
    const c = await sbMod();
    const uid = await myId();
    if (!uid) return { error: 'Entra na tua conta.' };
    const ext = (name.split('.').pop() || mime.split('/')[1] || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
    const fn = `${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const opt = { contentType: mime, upsert: false, cacheControl: '31536000' };
    let path = `chat/${convId}/${fn}`;
    let up = await c.storage.from('clips').upload(path, blob, opt);
    if (up.error) {
      if (/exceed|too large|413|maximum/i.test(up.error.message)) return { error: TOO_BIG };
      // Sem a migração: a pasta tem de começar pelo id do utilizador
      path = `${uid}/chat/${convId}/${fn}`;
      up = await c.storage.from('clips').upload(path, blob, opt);
    }
    if (up.error) return { error: /mime|type/i.test(up.error.message) ? 'Este tipo de ficheiro não é aceite.' : 'Não foi possível enviar o ficheiro. Verifica a ligação.' };
    return { file: ref(c.storage.from('clips').getPublicUrl(path).data.publicUrl, path) };
  } catch {
    return { error: 'Não foi possível enviar o ficheiro. Verifica a ligação.' };
  }
}

// ---------------- grupos ----------------
export async function createGroup(inp: { title: string; description: string; photo: Blob | null; members: string[] }): Promise<{ id?: string; error?: string }> {
  const title = inp.title.trim().slice(0, 60);
  if (!title) return { error: 'Dá um nome ao grupo.' };
  if (IS_DEMO) {
    const db = demoDb(); const id = 'grp-' + Date.now();
    const photo = inp.photo ? await toDataUrl(inp.photo) : '👥';
    const now = new Date().toISOString();
    db.chats.push({ id, kind: 'grupo', title, photo, description: inp.description.trim().slice(0, 500), members: [{ id: DEMO_ME, role: 'admin', readAt: now, status: 'aceite' }, ...inp.members.map((m) => ({ id: m, role: 'membro' as const, readAt: now, status: 'aceite' as const }))], muted: false, onlyAdminsSend: false, onlyAdminsEdit: true, invite: Math.random().toString(36).slice(2, 12), createdBy: DEMO_ME });
    db.msgs.push(dm('s' + Date.now(), id, DEMO_ME, `Tu criaste o grupo "${title}"`, 0, 'sistema', { sys: 'criou' }));
    if (inp.members.length) db.msgs.push(dm('s' + Date.now() + 1, id, DEMO_ME, `Tu adicionaste ${inp.members.map((m) => demoPerson(m).name).join(', ')}`, 0, 'sistema', { sys: 'entrou' }));
    saveDemo(db); return { id };
  }
  if (!(await chatV2())) return { error: GROUPS_OFF_MSG };
  const c = await sbMod();
  let photo = '';
  if (inp.photo) {
    const uid = await myId();
    const path = `${uid}/grupo-${Date.now()}.jpg`;
    const up = await c.storage.from('clips').upload(path, inp.photo, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (!up.error) photo = c.storage.from('clips').getPublicUrl(path).data.publicUrl;
  }
  const { data, error } = await c.rpc('create_group', { p_title: title, p_description: inp.description.trim().slice(0, 500), p_photo: photo, p_members: inp.members });
  return error ? { error: friendlyError(error) } : { id: String(data) };
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> {
  if (!(await chatV2())) return { error: GROUPS_OFF_MSG };
  const c = await sbMod();
  const { data, error } = await c.rpc(fn, args);
  return error ? { error: friendlyError(error) } : { data };
}
function demoSys(conv: string, body: string) { const db = demoDb(); db.msgs.push(dm('s' + Date.now() + Math.random(), conv, DEMO_ME, body, 0, 'sistema')); saveDemo(db); emit(conv); }
function demoEdit(conv: string, f: (cv: DemoChat) => void) { const db = demoDb(); const cv = db.chats.find((x) => x.id === conv); if (cv) f(cv); saveDemo(db); emit(conv); }

export async function addMembers(conv: string, ids: string[]) {
  if (IS_DEMO) { const now = new Date().toISOString(); demoEdit(conv, (cv) => ids.forEach((id) => { if (!cv.members.some((m) => m.id === id)) cv.members.push({ id, role: 'membro', readAt: now, status: 'aceite' }); })); ids.forEach((id) => demoSys(conv, `Tu adicionaste ${demoPerson(id).name}`)); return {}; }
  return rpc('group_add_members', { p_conv: conv, p_members: ids });
}
export async function setRole(conv: string, user: string, role: 'admin' | 'membro') {
  if (IS_DEMO) { demoEdit(conv, (cv) => { const m = cv.members.find((x) => x.id === user); if (m) m.role = role; }); demoSys(conv, `${demoPerson(user).name} ${role === 'admin' ? 'é agora administrador' : 'deixou de ser administrador'}`); return {}; }
  return rpc('group_set_role', { p_conv: conv, p_user: user, p_role: role });
}
export async function removeMember(conv: string, user: string) {
  if (IS_DEMO) { demoSys(conv, `Tu removeste ${demoPerson(user).name}`); demoEdit(conv, (cv) => { cv.members = cv.members.filter((m) => m.id !== user); }); return {}; }
  return rpc('group_remove_member', { p_conv: conv, p_user: user });
}
export async function leaveGroup(conv: string) {
  if (IS_DEMO) { const db = demoDb(); db.chats = db.chats.filter((x) => x.id !== conv); db.msgs = db.msgs.filter((m) => m.conversationId !== conv); saveDemo(db); return {}; }
  return rpc('group_leave', { p_conv: conv });
}
export async function updateGroup(conv: string, g: Chat, patch: { title?: string; description?: string; photo?: Blob | null; onlyAdminsSend?: boolean; onlyAdminsEdit?: boolean }) {
  let photo = g.photo;
  if (patch.photo) {
    if (IS_DEMO) photo = await toDataUrl(patch.photo);
    else {
      const c = await sbMod(); const uid = await myId(); const path = `${uid}/grupo-${Date.now()}.jpg`;
      const up = await c.storage.from('clips').upload(path, patch.photo, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
      if (up.error) return { error: 'Não foi possível enviar a foto.' };
      photo = c.storage.from('clips').getPublicUrl(path).data.publicUrl;
    }
  } else if (patch.photo === null) photo = '';
  const next = { title: (patch.title ?? g.title).trim().slice(0, 60) || g.title, description: (patch.description ?? g.description).slice(0, 500), photo, send: patch.onlyAdminsSend ?? g.onlyAdminsSend, edit: patch.onlyAdminsEdit ?? g.onlyAdminsEdit };
  if (IS_DEMO) {
    demoEdit(conv, (cv) => { cv.title = next.title; cv.description = next.description; cv.photo = next.photo || '👥'; cv.onlyAdminsSend = next.send; cv.onlyAdminsEdit = next.edit; });
    if (next.title !== g.title) demoSys(conv, `Tu mudaste o nome do grupo para "${next.title}"`);
    if (patch.photo !== undefined) demoSys(conv, 'Tu mudaste a foto do grupo');
    if (patch.description !== undefined && next.description !== g.description) demoSys(conv, 'Tu mudaste a descrição do grupo');
    if (patch.onlyAdminsSend !== undefined && next.send !== g.onlyAdminsSend) demoSys(conv, next.send ? 'Tu definiste que só administradores enviam mensagens' : 'Tu permitiste que todos enviem mensagens');
    return {};
  }
  return rpc('group_update', { p_conv: conv, p_title: next.title, p_description: next.description, p_photo: /^https?:/.test(next.photo) ? next.photo : '', p_only_admins_send: next.send, p_only_admins_edit: next.edit });
}
export async function resetInvite(conv: string): Promise<{ code?: string; error?: string }> {
  if (IS_DEMO) { const code = Math.random().toString(36).slice(2, 12); demoEdit(conv, (cv) => { cv.invite = code; }); return { code }; }
  const r = await rpc('group_reset_invite', { p_conv: conv });
  return r.error ? { error: r.error } : { code: String(r.data) };
}
export interface InvitePreview { id: string; title: string; description: string; photo: string; members: number; isMember: boolean }
export async function invitePreview(code: string): Promise<{ g?: InvitePreview; error?: string }> {
  if (IS_DEMO) { const db = demoDb(); const cv = db.chats.find((x) => x.invite === code); if (!cv) return { error: 'Convite inválido ou expirado.' }; return { g: { id: cv.id, title: cv.title, description: cv.description, photo: cv.photo, members: cv.members.length, isMember: cv.members.some((m) => m.id === DEMO_ME) } }; }
  const r = await rpc('group_invite_preview', { p_code: code });
  if (r.error) return { error: r.error };
  const d = r.data as Record<string, unknown> | null;
  if (!d) return { error: 'Convite inválido ou expirado.' };
  return { g: { id: String(d.id), title: String(d.title ?? 'Grupo'), description: String(d.description ?? ''), photo: String(d.photo_url || '👥'), members: Number(d.members ?? 0), isMember: !!d.is_member } };
}
export async function joinByInvite(code: string): Promise<{ id?: string; error?: string }> {
  if (IS_DEMO) { const db = demoDb(); const cv = db.chats.find((x) => x.invite === code); if (!cv) return { error: 'Convite inválido.' }; if (!cv.members.some((m) => m.id === DEMO_ME)) { cv.members.push({ id: DEMO_ME, role: 'membro', readAt: new Date().toISOString(), status: 'aceite' }); saveDemo(db); demoSys(cv.id, 'Tu entraste através do link de convite'); } return { id: cv.id }; }
  const r = await rpc('join_group_by_invite', { p_code: code });
  return r.error ? { error: r.error } : { id: String(r.data) };
}

// ---------------- tempo real ----------------
export interface SubHandlers { onMessage: (m: ChatMsg) => void; onChange: () => void; onRead: (userId: string, at: string) => void; onTyping: (who: string) => void; onPresent?: (ids: string[]) => void }
export function subscribe(convId: string, me: string, myName: string, h: SubHandlers): { stop: () => void; typing: () => void } {
  if (IS_DEMO) {
    const l = (c: string) => { if (c === convId) h.onChange(); };
    const t = (c: string, who: string) => { if (c === convId) h.onTyping(who ? demoPerson(who).name : ''); };
    demoListeners.add(l); demoTyping.add(t);
    h.onPresent?.(['nyx', 'lua']);
    return { stop: () => { demoListeners.delete(l); demoTyping.delete(t); }, typing: () => {} };
  }
  let ch: { send: (x: unknown) => unknown; unsubscribe: () => unknown; track?: (x: unknown) => unknown; presenceState?: () => Record<string, { user?: string }[]> } | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  void Promise.all([sbMod(), chatV2()]).then(([c, v2]) => {
    if (stopped) return;
    const x = c.channel(`chat:${convId}`, { config: { broadcast: { self: false }, presence: { key: me } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, async (p) => {
        const m = fromRow(p.new as Record<string, unknown>, v2); await signLegacy([m]); h.onMessage(m);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, () => h.onChange())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${convId}` }, (p) => {
        const r = p.new as { user_id: string; last_read_at: string }; if (r.user_id !== me) h.onRead(r.user_id, r.last_read_at);
      })
      .on('broadcast', { event: 'typing' }, (p) => {
        const pl = p.payload as { user: string; name?: string }; if (pl.user === me) return;
        h.onTyping(pl.name || 'Alguém');
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => h.onTyping(''), 3500);
      })
      .on('presence', { event: 'sync' }, () => {
        const st = (x as unknown as { presenceState: () => Record<string, unknown[]> }).presenceState();
        h.onPresent?.(Object.keys(st));
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void (x as unknown as { track: (p: unknown) => Promise<unknown> }).track({ user: me, at: Date.now() }).catch(() => {}); });
    ch = x as unknown as typeof ch;
  }).catch(() => {});
  let last = 0;
  return {
    stop: () => { stopped = true; try { void ch?.unsubscribe(); } catch {} },
    typing: () => { const n = Date.now(); if (n - last > 2000 && ch) { last = n; try { void ch.send({ type: 'broadcast', event: 'typing', payload: { user: me, name: myName } }); } catch {} } },
  };
}

export function timeLabel(iso: string) {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  const diff = (now.getTime() - d.getTime()) / 86400000;
  return diff < 7 ? d.toLocaleDateString('pt-PT', { weekday: 'short' }) : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
export function dayLabel(iso: string) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hoje';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
}
export function lastSeenLabel(iso: string) {
  if (!iso || iso.startsWith('1970')) return '';
  const d = new Date(iso); const now = new Date();
  const t = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `visto por último hoje às ${t}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `visto por último ontem às ${t}`;
  return `visto por último a ${d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })}`;
}
