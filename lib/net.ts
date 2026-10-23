// Rede: fetch com limite de tempo e repetição (sem dependências, para poder ser testado em node).

/**
 * fetch com repetição (mesmo backoff de withRetry em lib/auth.ts: 0,5 s → 1 s → 2 s + jitter).
 * Só repete leituras (GET/HEAD) em falha de rede ou 502/503/504 — nunca escritas, para não duplicar dados.
 */
/** Tempo máximo de cada tentativa para leituras e pedidos de sessão (rede móvel lenta não pode prender a app). */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Pedido de renovação da sessão do supabase-js (POST /auth/v1/token?grant_type=refresh_token). */
export function isTokenRefresh(url: string) { return /\/auth\/v1\/token\?(?:.*&)?grant_type=refresh_token/.test(url); }

/**
 * Limite da renovação do token: longo (rede móvel lenta), mas nunca infinito. Enquanto a renovação está pendurada o
 * supabase-js segura o seu cadeado e TUDO o que precisa da sessão espera (getSession, 2FA, leituras): era isto que fazia
 * "entrar" com a palavra-passe certa não dar em nada.
 */
export const REFRESH_TIMEOUT_MS = 60_000;

// Renovações em curso e refresh tokens postos de lado (a pessoa está a entrar de novo e a sessão antiga já não interessa).
const inflightRefresh = new Set<AbortController>();
const droppedTokens = new Set<string>();

function refreshTokenOf(init?: RequestInit): string {
  try { const b = init?.body; return typeof b === 'string' ? String(JSON.parse(b)?.refresh_token || '') : ''; } catch { return ''; }
}

/**
 * Antes de um novo início de sessão: põe de lado o refresh token da sessão antiga e cancela a renovação pendurada.
 * O supabase-js recebe "refresh token inválido" para esse token (resposta local, sem ir ao servidor), apaga a sessão
 * antiga e liberta o cadeado — e o novo login segue logo. Devolve a função que volta a permitir esse token.
 */
export function dropStaleRefresh(token?: string): () => void {
  if (token) droppedTokens.add(token);
  for (const c of inflightRefresh) c.abort();
  return () => { if (token) droppedTokens.delete(token); };
}

/** Resposta igual à do servidor quando o refresh token não existe (o supabase-js trata-a como sessão terminada). */
function droppedResponse() {
  return new Response(JSON.stringify({ code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }), { status: 400, headers: { 'content-type': 'application/json' } });
}

/** A renovação do token: limite longo (REFRESH_TIMEOUT_MS) e cancelável por dropStaleRefresh(). */
async function refreshFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const rt = refreshTokenOf(init);
  if (rt && droppedTokens.has(rt)) return droppedResponse();
  const ctl = new AbortController();
  inflightRefresh.add(ctl);
  try { return await fetchWithTimeout(input, { ...init, signal: ctl.signal }, REFRESH_TIMEOUT_MS); }
  catch (e) { if (rt && droppedTokens.has(rt)) return droppedResponse(); throw e; }
  finally { inflightRefresh.delete(ctl); }
}

function urlOf(input: RequestInfo | URL) { return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; }

/** Corre o pedido com um limite de tempo, respeitando também o signal de quem chamou (sem AbortSignal.any, que falta em Androids antigos). */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const outer = init?.signal;
  if (outer?.aborted) ctl.abort();
  const onAbort = () => ctl.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(input, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(t); outer?.removeEventListener('abort', onAbort); }
}

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, tries = 3): Promise<Response> {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const safe = method === 'GET' || method === 'HEAD';
  // Leituras e /auth/v1 têm limite de tempo; envios de ficheiros não.
  // EXCEÇÃO: a renovação do token (grant_type=refresh_token) não usa o limite de 20 s (só o de REFRESH_TIMEOUT_MS). O servidor roda o refresh token assim que
  // recebe o pedido; se a resposta fosse cortada a meio numa rede lenta, a nova tentativa usaria o token antigo e, passado o
  // intervalo de reutilização do Supabase, era recusada ("Already Used") e a pessoa ficava sem sessão ao recarregar.
  // O arranque já não espera por este pedido (lib/sessionCache.ts), por isso não o cancelar não prende o ecrã.
  const url = urlOf(input);
  if (isTokenRefresh(url)) return refreshFetch(input, init);
  const limited = !isTokenRefresh(url) && (safe || /\/auth\/v1\//.test(url));
  for (let i = 0; ; i++) {
    try {
      const res = limited ? await fetchWithTimeout(input, init, REQUEST_TIMEOUT_MS) : await fetch(input, init);
      if (!safe || i >= tries - 1 || ![502, 503, 504].includes(res.status)) return res;
    } catch (e) {
      if (!safe || i >= tries - 1 || init?.signal?.aborted || (e as Error)?.name === 'AbortError') throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i + Math.random() * 250));
  }
}

/** Quanto tempo uma operação de sessão espera pelo cadeado que outro separador/janela da app tem (antes era sem limite). */
export const LOCK_WAIT_MS = 10_000;
type LockFn = <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>;
/**
 * Cadeado da sessão do supabase-js com espera limitada. O supabase-js partilha um cadeado entre separadores
 * (navigator.locks) e espera por ele SEM limite; um separador antigo com a renovação pendurada prendia o login em todos.
 * Pedidos sem limite (-1) esperam no máximo LOCK_WAIT_MS e depois correm na mesma. Os de limite 0 (renovação automática,
 * "só se estiver livre") ficam como estão.
 */
/**
 * O tempo de espera pelo cadeado acabou. ATENÇÃO: o navigatorLock do supabase-js cancela navigator.locks.request com
 * abortController.abort() e o navegador rejeita com um AbortError ("signal is aborted without reason"), não com um erro
 * isAcquireTimeout. Era isso que aparecia no 2FA (/entrar, 2026-10-23) quando outro separador segurava a sessão.
 */
export function isLockWaitTimeout(e: unknown): boolean {
  const x = e as { isAcquireTimeout?: boolean; name?: string } | null;
  return !!x && (x.isAcquireTimeout === true || x.name === 'AbortError');
}
export function boundedLock(base: LockFn, waitMs = LOCK_WAIT_MS): LockFn {
  return async (name, acquireTimeout, fn) => {
    if (acquireTimeout >= 0) return base(name, acquireTimeout, fn);
    let ran = false;
    try { return await base(name, waitMs, () => { ran = true; return fn(); }); }
    catch (e) { if (!ran && isLockWaitTimeout(e)) return fn(); throw e; }
  };
}
