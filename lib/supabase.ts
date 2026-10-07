// Cliente Supabase (modo real). Carregado só quando é preciso (import dinâmico) para não pesar no primeiro carregamento.
import type { SupabaseClient } from '@supabase/supabase-js';
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;
let loading: Promise<SupabaseClient> | null = null;

export async function sb(): Promise<SupabaseClient> {
  if (IS_DEMO) throw new Error('Supabase não configurado (modo demo)');
  if (client) return client;
  if (!loading) {
    loading = import('@supabase/supabase-js').then(({ createClient }) => {
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'gamehub-auth' },
        global: { headers: { 'x-client-info': 'gamehub-web' } },
      });
      return client;
    });
  }
  return loading;
}
