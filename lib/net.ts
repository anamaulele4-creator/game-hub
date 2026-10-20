// Rede: fetch com limite de tempo e repetição (sem dependências, para poder ser testado em node).

/**
 * fetch com repetição (mesmo backoff de withRetry em lib/auth.ts: 0,5 s → 1 s → 2 s + jitter).
 * Só repete leituras (GET/HEAD) em falha de rede ou 502/503/504 — nunca escritas, para não duplicar dados.
 */
/** Tempo máximo de cada tentativa para leituras e pedidos de sessão (rede móvel lenta não pode prender a app). */
export const REQUEST_TIMEOUT_MS = 20_000;

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
  // Leituras e /auth/v1 (getSession → renovação do token) têm limite de tempo; envios de ficheiros não.
  const limited = safe || /\/auth\/v1\//.test(urlOf(input));
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
