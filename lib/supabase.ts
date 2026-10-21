// Cliente Supabase (modo real). Carregado só quando é preciso (import dinâmico) para não pesar no primeiro carregamento.
import type { SupabaseClient } from '@supabase/supabase-js';
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

export { fetchWithRetry, fetchWithTimeout, REQUEST_TIMEOUT_MS } from './net';
import { boundedLock, fetchWithRetry } from './net';

let loading: Promise<SupabaseClient> | null = null;

export async function sb(): Promise<SupabaseClient> {
  if (IS_DEMO) throw new Error('Supabase não configurado (modo demo)');
  if (client) return client;
  if (!loading) {
    const hasLocks = typeof navigator !== 'undefined' && !!(navigator as Navigator & { locks?: unknown }).locks;
    loading = Promise.all([import('@supabase/supabase-js'), hasLocks ? import('@supabase/auth-js') : Promise.resolve(null)]).then(([{ createClient }, authJs]) => {
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'gamehub-auth', ...(authJs ? { lock: boundedLock(authJs.navigatorLock) } : {}) },
        global: { headers: { 'x-client-info': 'gamehub-web' }, fetch: fetchWithRetry },
      });
      return client;
    });
  }
  return loading;
}
