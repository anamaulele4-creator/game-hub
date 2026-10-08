'use client';

import { useState } from 'react';
import { PLAYERS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';

const GAMES = ['Free Fire 1v1', 'Free Fire 4v4', 'eFootball 1v1', 'PUBG TDM', 'CODM 1v1'];
const STAKES = ['Por diversão', '50 XP', '100 moedas', 'Perdedor partilha clipe do vencedor'];

export default function DesafiosPage() {
  const { s, set, unlock, toast, addXp } = useStore();
  const [to, setTo] = useState(PLAYERS[0]?.name ?? '');
  const [game, setGame] = useState(GAMES[0]);
  const [stake, setStake] = useState(STAKES[0]);

  const send = () => {
    set((p) => ({ ...p, challenges: [{ id: 'ch' + Date.now(), to, game, stake, status: 'enviado' }, ...p.challenges] }));
    unlock('a10');
    toast(`⚔️ Desafio enviado a ${to}`);
  };
  const respond = (id: string, ok: boolean) => {
    set((p) => ({ ...p, challenges: p.challenges.map((c) => (c.id === id ? { ...c, status: ok ? 'aceite' : 'recusado' } : c)) }));
    if (ok) addXp(25, 'desafio aceite'); else toast('Desafio recusado');
  };

  return (
    <Page title="Desafios" back="/perfil">
      <div className="card mb-4 space-y-3">
        <p className="font-semibold">⚔️ Novo desafio</p>
        <select className="input w-full" value={to} onChange={(e) => setTo(e.target.value)}>{PLAYERS.map((p) => <option key={p.id}>{p.name}</option>)}</select>
        <select className="input w-full" value={game} onChange={(e) => setGame(e.target.value)}>{GAMES.map((g) => <option key={g}>{g}</option>)}</select>
        <select className="input w-full" value={stake} onChange={(e) => setStake(e.target.value)}>{STAKES.map((g) => <option key={g}>{g}</option>)}</select>
        <button className="btn w-full" onClick={send}>Enviar desafio</button>
        <p className="text-xs text-white/50">Desafios com dinheiro real não são permitidos. Apenas XP e moedas virtuais.</p>
      </div>
      <h3 className="mb-2 font-bold">Os teus desafios</h3>
      <div className="space-y-2">
        {s.challenges.map((c) => (
          <div key={c.id} className="card !p-3 text-sm">
            <div className="flex justify-between"><span>{c.status === 'recebido' ? `${c.to} desafiou-te` : `Tu → ${c.to}`}</span><span className="chip">{c.status}</span></div>
            <p className="text-xs text-white/60">{c.game} · {c.stake}</p>
            {c.status === 'recebido' && <div className="mt-2 flex gap-2"><button className="btn flex-1" onClick={() => respond(c.id, true)}>Aceitar</button><button className="btn-ghost flex-1" onClick={() => respond(c.id, false)}>Recusar</button></div>}
          </div>
        ))}
      </div>
    </Page>
  );
}
