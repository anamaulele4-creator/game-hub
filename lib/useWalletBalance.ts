'use client';

import { useCallback, useEffect, useState } from 'react';
// competitiveApi (~20 KB gz) só é descarregado quando há sessão: não pesa no primeiro carregamento de todas as páginas.
const compApiMod = () => import('@/lib/competitiveApi').then((m) => m.compApi);
import { IS_DEMO } from '@/lib/config';
import { sb } from '@/lib/supabase';

// Saldo disponível do utilizador, na mesma fonte da página da carteira (compApi.wallet).
// Devolve null enquanto carrega ou se não for possível ler (nunca mostra um valor inventado).
export function useWalletBalance(enabled: boolean): number | null {
  const [bal, setBal] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await compApiMod().then((api) => api.wallet()).catch(() => null);
    setBal(r && 'available' in r ? r.available : null);
  }, []);

  useEffect(() => {
    if (!enabled) { setBal(null); return; }
    void load();
    if (IS_DEMO) return;
    let stop = false; let off: (() => void) | null = null;
    void (async () => {
      try {
        const c = await sb(); const { data } = await c.auth.getSession(); const uid = data.session?.user.id;
        if (!uid || stop) return;
        // nome de canal diferente do da página da carteira, para não colidirem
        const ch = c.channel(`saldo-header-${uid}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'money_ledger', filter: `user_id=eq.${uid}` }, () => { void load(); })
          .subscribe();
        off = () => { void c.removeChannel(ch); };
        if (stop) off();
      } catch { /* sem realtime: fica o refresh ao voltar à app */ }
    })();
    const vis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; off?.(); document.removeEventListener('visibilitychange', vis); };
  }, [enabled, load]);

  return bal;
}