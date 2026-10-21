'use client';

// Admin › Venda de contas: interruptor venda_contas_enabled (app_settings, só admin muda; fica na auditoria).
// Regra fixa, imposta no servidor: só Função 'criador' (ou admin) publica anúncios do tipo Conta.
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { getAppSetting, setAppSetting } from '@/lib/appSettings';

export default function ContasSwitch() {
  const { toast } = useStore();
  const [st, setSt] = useState<{ value: boolean; installed: boolean } | null>(null);
  const load = useCallback(async () => { const r = await getAppSetting<boolean>('venda_contas_enabled'); setSt({ value: r.value !== false, installed: r.installed }); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!st) return <div className="card h-20 animate-pulse" />;
  const flip = async () => {
    const r = await setAppSetting('venda_contas_enabled', !st.value);
    if (r.ok) { toast(st.value ? 'Venda de contas desligada.' : 'Venda de contas ligada.'); void load(); }
    else toast(r.code === 'FORBIDDEN' ? 'Só admins podem mudar este interruptor.' : r.code === 'NOT_INSTALLED' ? 'Corre primeiro o SQL de sql-contas.html.' : r.code);
  };
  return (
    <div className="bx space-y-3">
      <section className="bx-card flex items-center justify-between gap-3 p-4">
        <div>
          <b className="block text-[15px]">Venda de contas de jogos: {st.value ? 'LIGADA' : 'DESLIGADA'}</b>
          <span className="bx-muted text-[13px]">Desligada: ninguém (exceto admin) publica anúncios do tipo Conta. Os outros tipos (diamantes, itens…) não mudam.</span>
        </div>
        <button type="button" role="switch" aria-checked={st.value} className={`bx-btn !w-auto shrink-0 px-5 ${st.value ? '!bg-[#B91C1C] !text-white' : ''}`} onClick={flip}>{st.value ? 'Desligar' : 'Ligar'}</button>
      </section>
      <p className="bx-card p-4 text-[13px]">Só utilizadores com a Função <b>Criador</b> (Admin › Utilizadores) ou admins podem vender contas. Utilizadores normais e moderadores são recusados no servidor. A verificação de vendedor (documento + selfie) continua a ser exigida.</p>
      {!st.installed && <p className="bx-dim text-[12.5px]">O SQL ainda não está instalado: abre sql-contas.html (depois de sql-apostas.html).</p>}
    </div>
  );
}
