// Contas guardadas neste dispositivo (estilo Instagram): mudar de conta, adicionar conta, sair, remover.
// Guardamos só o mínimo: id, nome, @, avatar (emoji ou URL curto), email (para preencher o login) e o fornecedor.
// Sessões das OUTRAS contas: guardamos o refresh token do Supabase na mesma área onde o próprio supabase-js
// já guarda a sessão ativa (localStorage deste site) — não aumenta a exposição. Nunca é enviado a terceiros.
// Trocar de conta NÃO revoga a sessão anterior no servidor (para poder voltar a ela sem palavra-passe).

import { BASE_PATH, IS_DEMO } from './config';

export interface SavedAccount {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  email?: string;
  provider?: string; // 'google' | 'email' | 'phone' | 'demo'
  refreshToken?: string; // só para contas que NÃO são a atual
  lastUsed: number;
}

const KEY = 'poipak-accounts-v1';
const AUTH_KEY = 'gamehub-auth'; // storageKey do supabase-js (lib/supabase.ts)
export const MAX_ACCOUNTS = 5;

export function listAccounts(): SavedAccount[] {
  if (typeof window === 'undefined') return [];
  try { const l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
}
function save(l: SavedAccount[]) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} window.dispatchEvent(new Event('poipak:accounts')); }

/** "a***e@gmail.com" */
export function emailHint(e?: string) {
  if (!e) return '';
  const [u, d] = e.split('@');
  if (!d) return e.length > 4 ? e.slice(0, 3) + '•••' + e.slice(-2) : e;
  return (u.length <= 2 ? u[0] + '•' : u[0] + '•••' + u[u.length - 1]) + '@' + d;
}

/** Regista/atualiza a conta atual (chamado quando a sessão carrega). Mantém no máx. 5 (remove a mais antiga). */
export function rememberAccount(a: Omit<SavedAccount, 'lastUsed' | 'refreshToken'>) {
  if (!a.id) return;
  const avatar = a.avatar && a.avatar.length > 600 ? '' : a.avatar; // não guardar data: URLs enormes
  let l = listAccounts();
  const prev = l.find((x) => x.id === a.id);
  const item: SavedAccount = { ...prev, ...a, avatar, refreshToken: undefined, lastUsed: Date.now() };
  l = [item, ...l.filter((x) => x.id !== a.id)];
  if (l.length > MAX_ACCOUNTS) l = l.sort((x, y) => (x.id === a.id ? -1 : y.id === a.id ? 1 : y.lastUsed - x.lastUsed)).slice(0, MAX_ACCOUNTS);
  save(l);
}

export function removeAccount(id: string) { save(listAccounts().filter((x) => x.id !== id)); }

function patch(id: string, p: Partial<SavedAccount>) { save(listAccounts().map((x) => (x.id === id ? { ...x, ...p } : x))); }

export function canAddAccount() { return listAccounts().length < MAX_ACCOUNTS; }

/** Guarda a sessão atual (refresh token mais recente) na lista, para poder voltar a ela depois. */
async function stashCurrent(): Promise<string | null> {
  if (IS_DEMO) return null;
  const { sb } = await import('./supabase');
  const c = await sb();
  const { data } = await c.auth.getSession();
  const s = data.session;
  if (!s) return null;
  const l = listAccounts();
  if (!l.some((x) => x.id === s.user.id)) {
    rememberAccount({ id: s.user.id, name: s.user.user_metadata?.full_name || s.user.email || 'Conta', handle: '', avatar: s.user.user_metadata?.avatar_url || '', email: s.user.email, provider: s.user.app_metadata?.provider });
  }
  patch(s.user.id, { refreshToken: s.refresh_token });
  return s.user.id;
}

/** Limpa caches locais do utilizador (mantém preferências não sensíveis: som, consentimento, instalação, id do dispositivo). */
export function clearUserCaches() {
  try {
    localStorage.removeItem('gamehub-session');
    localStorage.removeItem('gamehub-dm-queue');
    localStorage.removeItem('gh-ai-recent-posts');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i) || '';
      if (k.startsWith('poipak-coach-')) localStorage.removeItem(k);
    }
  } catch {}
  try { ['gh-auth-next', 'gamehub-login-logged'].forEach((k) => sessionStorage.removeItem(k)); } catch {}
}

/** Remove a sessão ativa SÓ deste navegador, sem a revogar no servidor (fica guardada na lista). */
function dropLocalSession() {
  try { localStorage.removeItem(AUTH_KEY); localStorage.removeItem(AUTH_KEY + '-code-verifier'); } catch {}
}

const go = (path: string) => window.location.replace(BASE_PATH + path);

export function loginUrl(a?: Pick<SavedAccount, 'email' | 'provider'>) {
  const q = new URLSearchParams();
  if (a?.email) q.set('email', a.email);
  if (a?.provider === 'google') q.set('via', 'google');
  q.set('next', '/perfil');
  return '/entrar/?' + q.toString();
}

/** Muda para outra conta guardada. Se a sessão guardada já não for válida, abre /entrar com o email preenchido. */
export async function switchTo(id: string): Promise<{ ok: boolean; error?: string }> {
  const target = listAccounts().find((x) => x.id === id);
  if (!target) return { ok: false, error: 'Conta não encontrada.' };
  if (IS_DEMO) { go(loginUrl(target)); return { ok: true }; }
  const { sb } = await import('./supabase');
  const c = await sb();
  const cur = await stashCurrent();
  if (cur === id) return { ok: true };
  if (target.refreshToken) {
    const { data, error } = await c.auth.refreshSession({ refresh_token: target.refreshToken });
    if (!error && data.session && data.session.user.id === id) {
      patch(id, { refreshToken: undefined, lastUsed: Date.now() });
      clearUserCaches();
      go('/perfil/');
      return { ok: true };
    }
    patch(id, { refreshToken: undefined });
  }
  // Sessão expirada: tira a atual deste navegador (fica guardada) e pede para entrar de novo.
  dropLocalSession();
  clearUserCaches();
  go(loginUrl(target));
  return { ok: true };
}

/** "Adicionar conta": guarda a sessão atual na lista e abre /entrar sem sessão. */
export async function addAccount() {
  if (!IS_DEMO) { await stashCurrent().catch(() => null); dropLocalSession(); }
  clearUserCaches();
  go('/entrar/?next=/perfil');
}

/** "Sair da conta": termina a sessão neste dispositivo. remember=false também a tira da lista. */
export async function signOutHere(remember = true) {
  let uid = '';
  if (!IS_DEMO) {
    try {
      const { sb } = await import('./supabase');
      const c = await sb();
      const { data } = await c.auth.getSession();
      uid = data.session?.user.id ?? '';
      await c.auth.signOut({ scope: 'local' });
    } catch { dropLocalSession(); }
  }
  if (uid) { if (remember) patch(uid, { refreshToken: undefined }); else removeAccount(uid); }
  clearUserCaches();
  try { localStorage.removeItem('gamehub-session'); } catch {}
  go('/entrar/');
}
