'use client';

import { useState } from 'react';
import { AdminUser } from '@/lib/data';
import { useAdmin, Badge, Confirm } from './shared';

const ROLES = ['utilizador', 'criador', 'moderador', 'admin'] as const;

export default function Users() {
  const { a, upd, act } = useAdmin();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'todos' | 'banidos' | 'suspensos' | 'premium' | 'verificados'>('todos');
  const patch = (u: AdminUser, p: Partial<AdminUser>, action: string, msg: string) => { upd({ users: a.users.map((x) => (x.id === u.id ? { ...x, ...p } : x)) }); act(action, u.handle, msg); };
  const list = a.users.filter((u) => !u.deleted)
    .filter((u) => (u.name + u.handle).toLowerCase().includes(q.toLowerCase()))
    .filter((u) => filter === 'todos' || (filter === 'banidos' && u.banned) || (filter === 'suspensos' && u.suspended) || (filter === 'premium' && u.premium) || (filter === 'verificados' && u.verified));
  return (
    <div className="space-y-2">
      <input className="input w-full" placeholder="Pesquisar nome ou @utilizador" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex flex-wrap gap-1 text-[11px]">{(['todos', 'banidos', 'suspensos', 'premium', 'verificados'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2 py-1 ${filter === f ? 'bg-neon' : 'bg-panel2'}`}>{f}</button>)}</div>
      <p className="text-[11px] text-white/50">{list.length} utilizador(es) · mostra os 1000 mais recentes</p>
      {list.map((u) => (
        <div key={u.id} className={`card !p-3 text-sm ${u.banned ? 'border-red-500/60' : u.suspended ? 'border-amber-400/60' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{u.name} {u.verified && '✅'} {u.premium && '👑'}</span>
            <div className="flex gap-1">{u.banned && <Badge tone="red">BANIDO</Badge>}{u.suspended && <Badge tone="amber">SUSPENSO</Badge>}<Badge>{u.plan}</Badge></div>
          </div>
          <p className="text-[11px] text-white/50">{u.handle} · desde {u.joined}{u.province ? ` · ${u.province}` : ''}</p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-white/60">Função</span>
            <select className="input flex-1 !py-1" value={u.role ?? 'utilizador'} onChange={(e) => patch(u, { role: e.target.value as AdminUser['role'] }, 'Alterou função', `Função de ${u.handle}: ${e.target.value}`)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
            <button className="btn-ghost !px-1 !py-1" onClick={() => patch(u, { verified: !u.verified }, u.verified ? 'Removeu verificação' : 'Verificou utilizador', u.verified ? 'Verificação removida' : 'Verificado ✅')}>{u.verified ? 'Tirar verif.' : 'Verificar'}</button>
            <button className="btn-ghost !px-1 !py-1" onClick={() => patch(u, { premium: !u.premium, plan: !u.premium ? 'Premium (oferta)' : 'Grátis' }, u.premium ? 'Removeu Premium' : 'Ofereceu Premium', u.premium ? 'Premium removido' : 'Premium oferecido')}>{u.premium ? 'Tirar Premium' : 'Dar Premium'}</button>
            <button className="rounded-xl bg-amber-500 py-1 font-semibold text-black" onClick={() => patch(u, { suspended: !u.suspended }, u.suspended ? 'Levantou suspensão' : 'Suspendeu 7 dias', u.suspended ? 'Suspensão levantada' : 'Suspenso por 7 dias')}>{u.suspended ? 'Levantar susp.' : 'Suspender 7d'}</button>
            <button className={`rounded-xl py-1 font-semibold ${u.banned ? 'bg-lime text-black' : 'bg-red-600'}`} onClick={() => patch(u, { banned: !u.banned }, u.banned ? 'Readmitiu utilizador' : 'Baniu utilizador', u.banned ? 'Readmitido' : 'Banido')}>{u.banned ? 'Readmitir' : 'Banir'}</button>
            <Confirm className="col-span-2 rounded-xl border border-red-500 py-1 text-red-300" label="Eliminar conta" question={`Eliminar a conta ${u.handle} e os seus dados? Ação irreversível.`} onYes={() => patch(u, { deleted: true }, 'Eliminou conta', `Conta ${u.handle} eliminada`)} />
          </div>
        </div>
      ))}
    </div>
  );
}
