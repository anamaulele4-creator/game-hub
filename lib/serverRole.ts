// Função do utilizador lida do SERVIDOR (profiles.role da sessão atual), para decisões de interface sensíveis
// (ex.: só criadores/admin veem o tipo "Conta" no anúncio). Enquanto não carrega, devolve loaded=false e role
// 'utilizador' (tratar como sem permissão). O servidor (trigger market__tg_contas) continua a impor a regra.
import { useEffect, useState } from 'react';
import { IS_DEMO } from './config';
import { sb } from './supabase';
import { AppRole, appRole, roleFromDb } from './affiliates';

export async function fetchServerRole(): Promise<AppRole> {
  try {
    const c = await sb();
    const { data } = await c.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return 'utilizador';
    const { data: me, error } = await c.from('profiles').select('role').eq('id', uid).maybeSingle();
    if (error || !me) return 'utilizador';
    return roleFromDb(String(me.role ?? ''));
  } catch { return 'utilizador'; }
}

/** demoRole: só usado em MODO DEMO (sem servidor). */
export function useServerRole(demoRole?: string): { role: AppRole; loaded: boolean } {
  const [st, setSt] = useState<{ role: AppRole; loaded: boolean }>({ role: 'utilizador', loaded: false });
  useEffect(() => {
    if (IS_DEMO) { setSt({ role: appRole(demoRole), loaded: true }); return; }
    let live = true;
    void fetchServerRole().then((role) => { if (live) setSt({ role, loaded: true }); });
    return () => { live = false; };
  }, [demoRole]);
  return st;
}
