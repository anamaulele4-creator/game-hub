// Sessão guardada no dispositivo, lida de forma SÍNCRONA no arranque (sem descarregar o supabase-js nem esperar pela rede).
// Sem dependências, para poder ser testado em node.
//
// Regra: quem tem uma sessão guardada aparece com sessão iniciada logo ao recarregar. Só sai quando o servidor
// recusa de facto o refresh token (o supabase-js apaga então a sessão e emite SIGNED_OUT). Rede lenta ou sem
// resposta nunca termina a sessão: fica "pendente" e a renovação é tentada de novo em segundo plano.

/** storageKey do supabase-js (lib/supabase.ts) — a sessão ativa deste navegador. */
export const AUTH_STORAGE_KEY = 'gamehub-auth';
/** Nome/avatar/@ da conta ativa, para o cabeçalho e o perfil aparecerem já preenchidos. Nunca guarda a função (admin/moderador). */
export const ME_KEY = 'gamehub-me';
/** Quanto tempo o arranque espera pela sessão do supabase-js antes de continuar com a sessão guardada (a renovação continua). */
export const SESSION_WAIT_MS = 6000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StoredSession { uid: string; email: string; phone: string; expiresAt: number; name: string; avatar: string }
export interface Identity extends StoredSession { handle: string }

function store(s?: Store | null): Store | null {
  if (s) return s;
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** A sessão que o supabase-js guardou (mesma validação que ele faz: access_token + refresh_token + expires_at). */
export function readStoredSession(s?: Store | null): StoredSession | null {
  const st = store(s);
  if (!st) return null;
  try {
    const raw = st.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    // versões antigas do supabase-js guardavam { currentSession: … }
    const ses = v && typeof v === 'object' && 'currentSession' in v ? v.currentSession : v;
    if (!ses || typeof ses !== 'object' || !ses.access_token || !ses.refresh_token || !('expires_at' in ses)) return null;
    const u = ses.user || {};
    if (!u.id) return null;
    const md = u.user_metadata || {};
    return { uid: String(u.id), email: u.email || '', phone: u.phone || '', expiresAt: Number(ses.expires_at) || 0, name: md.full_name || md.name || '', avatar: md.avatar_url || '' };
  } catch { return null; }
}

/** Sessão guardada + nome/@ da última leitura (só se for da mesma conta — várias contas podem usar o mesmo navegador). */
export function readIdentity(s?: Store | null): Identity | null {
  const ses = readStoredSession(s);
  if (!ses) return null;
  let snap: { uid?: string; name?: string; avatar?: string; handle?: string } = {};
  try { snap = JSON.parse(store(s)?.getItem(ME_KEY) || '{}') || {}; } catch {}
  const mine = snap.uid === ses.uid;
  return { ...ses, name: (mine && snap.name) || ses.name, avatar: (mine && snap.avatar) || ses.avatar, handle: (mine && snap.handle) || '' };
}

export function saveIdentitySnapshot(snap: { uid: string; name: string; avatar: string; handle: string }, s?: Store | null) {
  try { store(s)?.setItem(ME_KEY, JSON.stringify({ uid: snap.uid, name: snap.name, avatar: snap.avatar, handle: snap.handle })); } catch {}
}
export function clearIdentitySnapshot(s?: Store | null) { try { store(s)?.removeItem(ME_KEY); } catch {} }

/**
 * Depois de pedir a sessão ao supabase-js:
 *  - 'signed-in'  → há sessão válida (renovada se preciso);
 *  - 'pending'    → não veio sessão, mas a guardada continua lá (rede lenta/falhou: o supabase-js só a apaga quando o
 *                   servidor recusa o refresh token) → manter a pessoa com sessão iniciada e tentar outra vez;
 *  - 'signed-out' → não há sessão guardada (nunca entrou, saiu, ou o refresh token foi recusado).
 */
export type BootAuth = 'signed-in' | 'pending' | 'signed-out';
export function resolveBoot(o: { session: unknown; stored: StoredSession | null }): BootAuth {
  if (o.session) return 'signed-in';
  return o.stored ? 'pending' : 'signed-out';
}

/** Espera de novo: 2 s, 4 s, 8 s, 16 s e depois a cada 30 s. */
export function retryDelay(attempt: number): number {
  return Math.min(30_000, 2000 * 2 ** Math.max(0, attempt));
}

/** Espera pela promessa no máximo `ms`; não a cancela (a renovação do token continua em segundo plano). */
export function withSoftTimeout<T>(p: Promise<T>, ms: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ timedOut: true }), ms);
    p.then((value) => { clearTimeout(t); resolve({ timedOut: false, value }); }, (e) => { clearTimeout(t); reject(e); });
  });
}
