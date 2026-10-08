// IA do sistema: registo de erros do cliente → RPC log_system_error (Supabase).
// Agrupado (debounce), sem duplicados repetidos e com fila em localStorage quando não há internet.
import { IS_DEMO } from './config';

export interface SysErr { message: string; stack?: string; route: string; user_agent: string; fingerprint: string; auto_fixed?: boolean; at: number }

const QUEUE_KEY = 'gh-syserr-queue';
const LOCAL_KEY = 'gh-syserr-local'; // modo demo: lista local para o painel admin
const SEEN_MS = 60_000;
const seen = new Map<string, number>();
let pending: SysErr[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const currentRoute = () => { try { return (location.pathname.replace(BASE, '') || '/'); } catch { return '/'; } };

function hash(s: string) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
/** Impressão digital estável: mensagem sem números/URLs + 1.ª linha útil da stack + rota */
export function fingerprint(message: string, stack: string | undefined, route: string) {
  const norm = (x: string) => x.replace(/https?:\/\/\S+/g, '').replace(/\d+/g, '#').trim();
  const frame = (stack || '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('at ') || l.includes('@')) || '';
  return hash(norm(message).slice(0, 300) + '|' + norm(frame.replace(/\?.*$/, '')).slice(0, 200) + '|' + route);
}

const readQ = (k: string): SysErr[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const writeQ = (k: string, q: SysErr[], max: number) => { try { localStorage.setItem(k, JSON.stringify(q.slice(-max))); } catch {} };

/** Ruído conhecido que não vale a pena registar */
export function isNoise(msg: string) {
  return !msg || /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection captured|AbortError|The user aborted/i.test(msg);
}

export function logSystemError(err: unknown, opts: { auto_fixed?: boolean; route?: string } = {}) {
  if (typeof window === 'undefined') return;
  const e = err as { message?: string; stack?: string; reason?: unknown } | undefined;
  const message = String((e && (e.message ?? (typeof err === 'string' ? err : ''))) || (err ? String(err) : 'Erro desconhecido')).slice(0, 1000);
  if (isNoise(message)) return;
  const route = opts.route ?? currentRoute();
  const stack = typeof e?.stack === 'string' ? e.stack.slice(0, 4000) : undefined;
  const fp = fingerprint(message, stack, route);
  const now = Date.now();
  if ((seen.get(fp) ?? 0) > now - SEEN_MS && !opts.auto_fixed) return; // dedupe na mesma sessão
  seen.set(fp, now);
  pending.push({ message, stack, route, user_agent: navigator.userAgent.slice(0, 300), fingerprint: fp, auto_fixed: opts.auto_fixed, at: now });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flushSystemErrors(); }, 2000);
}

export async function flushSystemErrors() {
  if (flushing || typeof window === 'undefined') return;
  const batch = [...readQ(QUEUE_KEY), ...pending];
  pending = [];
  if (!batch.length) return;
  if (IS_DEMO) {
    const local = readQ(LOCAL_KEY);
    for (const b of batch) {
      const x = local.find((l) => l.fingerprint === b.fingerprint) as (SysErr & { count?: number }) | undefined;
      if (x) { x.count = (x.count ?? 1) + 1; x.at = b.at; } else local.push({ ...b, count: 1 } as SysErr);
    }
    writeQ(LOCAL_KEY, local, 50); writeQ(QUEUE_KEY, [], 0); return;
  }
  if (!navigator.onLine) { writeQ(QUEUE_KEY, batch, 30); return; }
  flushing = true;
  const failed: SysErr[] = [];
  try {
    const { sb } = await import('./supabase');
    const c = await sb();
    for (const b of batch) {
      const { error } = await c.rpc('log_system_error', { p_message: b.message, p_stack: b.stack ?? null, p_route: b.route, p_user_agent: b.user_agent, p_fingerprint: b.fingerprint, p_auto_fixed: !!b.auto_fixed });
      // Rede em baixo → volta para a fila; erro de BD (ex.: SQL por correr) → descarta para não acumular
      if (error && /fetch|network|Failed to fetch/i.test(error.message || '')) failed.push(b);
    }
  } catch { failed.push(...batch); }
  flushing = false;
  writeQ(QUEUE_KEY, failed, 30);
}

/** Modo demo: erros guardados neste navegador (para o painel admin) */
export function localSystemErrors() { return readQ(LOCAL_KEY) as (SysErr & { count?: number; status?: string })[]; }
export function setLocalSystemErrors(list: (SysErr & { count?: number; status?: string })[]) { writeQ(LOCAL_KEY, list, 50); }
