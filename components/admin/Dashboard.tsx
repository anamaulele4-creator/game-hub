'use client';

import { REVENUE, fmt, mzn } from '@/lib/data';
import { campaignTotals } from '@/lib/ads';
import { Stat } from '@/components/ui';
import { Bars, LineChart } from '@/components/Charts';
import { useAdmin } from './shared';
import { IS_DEMO } from '@/lib/config';

export default function Dashboard() {
  const { s, a } = useAdmin();
  const adRevenue = s.adsMgr.campaigns.reduce((t, c) => t + campaignTotals(s.adsMgr, c.id).spend, 0);
  const rev = REVENUE.map((r) => (r.source.startsWith('Anúncios') ? { ...r, value: r.value + Math.round(adRevenue) } : r));
  const total = rev.reduce((x, r) => x + r.value, 0);
  const users = a.users.filter((u) => !u.deleted);
  const realRev = a.payments.filter((p) => p.status === 'pago').reduce((t, p) => t + p.amount, 0);
  const dau = IS_DEMO ? [31200, 33900, 32800, 36100, 38400, 41200, 44900] : [0, 0, 0, 0, 0, 0, 0];
  const days = ['Qui', 'Sex', 'Sáb', 'Dom', 'Seg', 'Ter', 'Qua'];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Receita" value={mzn(IS_DEMO ? total : realRev + Math.round(adRevenue))} />
        <Stat label={IS_DEMO ? 'Utilizadores ativos (30d)' : 'Utilizadores registados'} value={fmt(IS_DEMO ? 48210 : users.length)} />
        <Stat label={IS_DEMO ? 'Ativos hoje (DAU)' : 'Banidos / suspensos'} value={IS_DEMO ? fmt(dau[6]) : users.filter((u) => u.banned || u.suspended).length} />
        <Stat label="Assinantes pagos" value={fmt((IS_DEMO ? 1238 : 0) + users.filter((u) => u.premium).length)} />
        <Stat label="Denúncias abertas" value={a.reports.filter((r) => r.status === 'aberta').length} />
        <Stat label="Anúncios em revisão" value={s.adsMgr.ads.filter((x) => x.review === 'pendente').length} />
        <Stat label="Levantamentos pendentes" value={a.payouts.filter((p) => p.status === 'pendente').length} />
        <Stat label="Encomendas por enviar" value={a.orders.filter((o) => o.status === 'pendente').length} />
        <Stat label="Lives ao vivo" value={Object.values(a.liveStatus).filter((x) => x === 'ao vivo').length} />
        <Stat label="Torneios abertos" value={a.tournaments.filter((t) => t.status === 'aberto').length} />
      </div>
      {IS_DEMO && <div className="card"><p className="mb-1 text-sm font-semibold">Utilizadores ativos por dia</p><LineChart data={dau.map((v, i) => ({ label: days[i], value: v }))} fmt={fmt} /></div>}
      <div className="card"><p className="mb-2 text-sm font-semibold">Receita por fonte</p><Bars data={rev.map((r) => ({ label: r.source, value: r.value }))} fmt={mzn} /></div>
      <div className="card text-xs text-white/60">
        <p className="mb-1 text-sm font-semibold text-white">Estado do sistema</p>
        <p>Manutenção: <b>{a.settings.maintenance ? 'ATIVA' : 'desligada'}</b> · Registos: <b>{a.settings.signupsOpen ? 'abertos' : 'fechados'}</b> · Faixa: <b>{a.settings.banner.on ? 'visível' : 'oculta'}</b></p>
        <p>Funcionalidades desligadas: {Object.entries(a.settings.features).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'nenhuma'}</p>
        <p>Última ação: {a.audit[0] ? `${a.audit[0].action} — ${a.audit[0].target} (${a.audit[0].at})` : '—'}</p>
      </div>
    </div>
  );
}
