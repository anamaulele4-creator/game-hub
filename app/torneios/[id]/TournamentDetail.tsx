'use client';

import { useState } from 'react';
import { mzn } from '@/lib/data';
import { useStore } from '@/lib/store';
import { CheckoutSheet } from '@/components/Checkout';
import { Page, ShareSheet, Stat } from '@/components/ui';

const BRACKET = [
  ['Mambas A', 'Squad Tembo'], ['Beira Kings', 'Nampula Wolves'], ['Matola Fire', 'Xai-Xai Snipers'], ['Os Mbilas', 'Equipa Ana'],
];

export default function TournamentDetail({ id }: { id: string }) {
  const { s, set, unlock, toast, isSaved, toggleSave, pushNotif } = useStore();
  const t = s.admin.tournaments.find((x) => x.id === id) ?? s.admin.tournaments[0];
  const [pay, setPay] = useState(false);
  const [sh, setSh] = useState(false);
  const [team, setTeam] = useState('Equipa Ana');
  const joined = s.entries.includes(t.id);
  const full = t.filled >= t.slots;

  const register = () => {
    set((p) => ({
      ...p,
      entries: [...p.entries, t.id],
      admin: { ...p.admin, tournaments: p.admin.tournaments.map((x) => (x.id === t.id ? { ...x, filled: x.filled + 1 } : x)) },
    }));
    unlock('a9');
    pushNotif({ type: 'torneio', text: `Inscrição confirmada: ${t.name} (${team})`, href: `/torneios/${t.id}` });
    toast('Inscrição confirmada 🏆');
  };

  const cancel = () => {
    set((p) => ({
      ...p,
      entries: p.entries.filter((x) => x !== t.id),
      admin: { ...p.admin, tournaments: p.admin.tournaments.map((x) => (x.id === t.id ? { ...x, filled: x.filled - 1 } : x)) },
    }));
    toast(t.fee > 0 ? 'Inscrição cancelada. Demo: reembolso total simulado.' : 'Inscrição cancelada');
  };

  return (
    <Page title={t.name} back="/torneios">
      <div className={`-mx-4 -mt-4 mb-4 flex h-36 items-center justify-center bg-gradient-to-br ${t.gradient} text-7xl`}>🏆</div>
      <div className="mb-2 flex flex-wrap gap-2">
        <span className="chip">{t.game}</span><span className="chip">{t.mode}</span><span className="chip">📅 {t.date}</span><span className="chip">por {t.organizer}</span>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Entrada" value={mzn(t.fee)} />
        <Stat label="Prémio" value={mzn(t.prize)} />
        <Stat label="Vagas" value={`${t.filled}/${t.slots}`} />
      </div>

      {t.status === 'aberto' && !joined && !full && (
        <div className="card mb-4">
          <label className="text-xs text-white/60">Nome da equipa / jogador</label>
          <input className="input mb-3 mt-1 w-full" value={team} onChange={(e) => setTeam(e.target.value)} />
          <button className="btn w-full" onClick={() => (t.fee > 0 ? setPay(true) : register())}>
            {t.fee > 0 ? `Inscrever · ${mzn(t.fee)}` : 'Inscrever grátis'}
          </button>
          {t.fee > 0 && <p className="mt-2 text-center text-[11px] text-white/50">Cancelamento com reembolso total até 24 h antes do início.</p>}
        </div>
      )}
      {joined && (
        <div className="card mb-4 border-lime/50">
          <p className="mb-2 text-lime">✓ Estás inscrito. Check-in abre 30 min antes.</p>
          {t.status === 'aberto' && <button className="btn-ghost w-full" onClick={cancel}>Cancelar inscrição</button>}
        </div>
      )}
      {full && !joined && t.status === 'aberto' && <p className="card mb-4 text-center text-amber-300">Vagas esgotadas</p>}

      <div className="mb-4 flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setSh(true)}>📤 Partilhar</button>
        <button className="btn-ghost flex-1" onClick={() => toggleSave({ kind: 'torneio', id: t.id })}>{isSaved({ kind: 'torneio', id: t.id }) ? '🔖 Guardado' : '📑 Guardar'}</button>
      </div>

      <h3 className="mb-2 font-bold">📜 Regras</h3>
      <ul className="card mb-4 list-inside list-disc space-y-1 text-sm">{t.rules.map((r) => <li key={r}>{r}</li>)}</ul>

      <h3 className="mb-2 font-bold">🧩 Chaveamento (quartos de final)</h3>
      <div className="space-y-2">
        {BRACKET.map(([a, b], k) => (
          <div key={k} className="card flex items-center justify-between !p-3 text-sm">
            <span>{a}</span><span className="text-xs text-neon">VS</span><span>{b}</span>
          </div>
        ))}
      </div>
      <h3 className="mb-2 mt-4 font-bold">💰 Distribuição do prémio</h3>
      <div className="grid grid-cols-3 gap-2"><Stat label="1.º lugar" value={mzn(Math.round(t.prize * 0.5))} /><Stat label="2.º lugar" value={mzn(Math.round(t.prize * 0.3))} /><Stat label="3.º lugar" value={mzn(Math.round(t.prize * 0.2))} /></div>

      <CheckoutSheet open={pay} onClose={() => setPay(false)} title={`Inscrição: ${t.name}`} lines={[{ label: `Inscrição (${team})`, amount: t.fee }]} onPaid={register} />
      <ShareSheet open={sh} onClose={() => setSh(false)} path={`/torneios/${t.id}`} text={`Inscreve-te no ${t.name}:`} target={t.id} />
    </Page>
  );
}
