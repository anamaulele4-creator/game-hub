// Cliente Supabase (modo real). Carregado só quando é preciso (import dinâmico) para não pesar no primeiro carregamento.
import type { SupabaseClient } from '@supabase/supabase-js';
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

/**
 * fetch com repetição (mesmo backoff de withRetry em lib/auth.ts: 0,5 s → 1 s → 2 s + jitter).
 * Só repete leituras (GET/HEAD) em falha de rede ou 502/503/504 — nunca escritas, para não duplicar dados.
 */
export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, tries = 3): Promise<Response> {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const safe = method === 'GET' || method === 'HEAD';
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(input, init);
      if (!safe || i >= tries - 1 || ![502, 503, 504].includes(res.status)) return res;
    } catch (e) {
      if (!safe || i >= tries - 1 || init?.signal?.aborted || (e as Error)?.name === 'AbortError') throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i + Math.random() * 250));
  }
}

let loading: Promise<SupabaseClient> | null = null;

export async function sb(): Promise<SupabaseClient> {
  if (IS_DEMO) throw new Error('Supabase não configurado (modo demo)');
  if (client) return client;
  if (!loading) {
    loading = import('@supabase/supabase-js').then(({ createClient }) => {
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'gamehub-auth' },
        global: { headers: { 'x-client-info': 'gamehub-web' }, fetch: fetchWithRetry },
      });
      return client;
    });
  }
  return loading;
}
