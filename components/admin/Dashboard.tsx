'use client';

import { fmt } from '@/lib/data';
import { Stat } from '@/components/ui';
import { useAdmin } from './shared';

export default function Dashboard() {
  const { a } = useAdmin();
  const users = a.users.filter((u) => !u.deleted);
  const open = a.tournaments.filter((t) => t.status === 'aberto');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Utilizadores registados" value={fmt(users.length)} />
        <Stat label="Banidos / suspensos" value={users.filter((u) => u.banned || u.suspended).length} />
        <Stat label="Torneios abertos" value={open.length} />
        <Stat label="Inscrições nos abertos" value={open.reduce((n, t) => n + t.filled, 0)} />
      </div>
      <div className="card text-xs text-white/60">
        <p className="mb-1 text-sm font-semibold text-white">Estado do sistema</p>
        <p>Manutenção: <b>{a.settings.maintenance ? 'ATIVA' : 'desligada'}</b> · Registos: <b>{a.settings.signupsOpen ? 'abertos' : 'fechados'}</b> · Faixa: <b>{a.settings.banner.on ? 'visível' : 'oculta'}</b></p>
        <p>Última ação: {a.audit[0] ? `${a.audit[0].action} — ${a.audit[0].target} (${a.audit[0].at})` : '—'}</p>
      </div>
    </div>
  );
}
