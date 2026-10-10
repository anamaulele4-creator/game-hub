'use client';

import { useState } from 'react';
import { Tournament, mzn } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { useStore } from '@/lib/store';
import { CheckoutSheet } from '@/components/LazyCheckout';
import { Page, ShareSheet, Stat } from '@/components/ui';
import { GameArt } from '@/components/GameArt';
import { GAME_ART } from '@/lib/gameArt';
import { fmtWhen, gameKeyOf } from '@/lib/jogos';

const BRACKET = [
  ['Mambas A', 'Squad Tembo'], ['Beira Kings', 'Nampula Wolves'], ['Matola Fire', 'Xai-Xai Snipers'], ['Os Mbilas', 'Equipa Ana'],
];

function Missing({ what, back }: { what: string; back: string }) {
  return <Page title={what} back={back}><div className="card mt-6 text-center"><p className="text-4xl">🔎</p><p className="mt-2 text-sm text-white/70">{what} não encontrado ou ainda a carregar.</p></div></Page>;
}
export default function TournamentDetail({ id }: { id: string }) {
  const { s } = useStore();
  const t = s.admin.tournaments.find((x) => x.id === id);
  if (!t) return <Missing what="Torneio" back="/torneios" />;
  return <Inner t={t} />;
}

function Inner({ t }: { t: Tournament }) {
  const { s, set, unlock, toast, isSaved, toggleSave, pushNotif } = useStore();
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
      <div className="relative -mx-4 -mt-4 mb-4 aspect-[16/8] sm:-mx-6 sm:aspect-[16/7]">
        <GameArt id={GAME_ART[gameKeyOf(t.game)]} sizes="(min-width: 640px) 720px, 100vw" priority />
        <div className="absolute inset-x-0 bottom-0 p-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{t.game} · {t.mode}</p>
          <p className="font-display text-2xl font-bold leading-tight">{t.name}</p>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="chip">📅 {fmtWhen(t.date)}</span><span className="chip">por {t.organizer}</span>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Entrada" value={mzn(t.fee)} />
        <Stat label="Prémio" value={t.prize > 0 ? mzn(t.prize) : 'A anunciar'} />
        <Stat label="Vagas" value={`${t.filled}/${t.slots}`} />
      </div>

      {t.status === 'aberto' && !joined && !full && (
        <div className="card mb-4">
          <label className="text-xs text-white/60">Nome da equipa / jogador</label>
          <input className="input mb-3 mt-1 w-full" value={team} onChange={(e) => setTeam(e.target.value)} />
          <button className="btn w-full" onClick={() => (t.fee > 0 ? setPay(true) : register())}>
            {t.fee > 0 ? `Inscrever · ${mzn(t.fee)}` : 'Inscrever grátis'}
          </button>
          {t.fee > 0 && <p className="mt-2 text-center text-xs text-white/50">Cancelamento com reembolso total até 24 h antes do início.</p>}
        </div>
      )}
      {joined && (
        <div className="card mb-4 border-lime/50">
          <p className="mb-2 text-lime">✓ Estás inscrito. Check-in abre 30 min antes.</p>
          {t.status === 'aberto' && <button className="btn-ghost w-full" onClick={cancel}>Cancelar inscrição</button>}
        </div>
      )}
      {full && !joined && t.status === 'aberto' && <p className="card mb-4 text-center text-neon">Vagas esgotadas</p>}

      <div className="mb-4 flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setSh(true)}>📤 Partilhar</button>
        <button className="btn-ghost flex-1" onClick={() => toggleSave({ kind: 'torneio', id: t.id })}>{isSaved({ kind: 'torneio', id: t.id }) ? '🔖 Guardado' : '📑 Guardar'}</button>
      </div>

      <h3 className="mb-2 font-bold">📜 Regras</h3>
      <ul className="card mb-4 list-inside list-disc space-y-1 text-sm">{t.rules.map((r) => <li key={r}>{r}</li>)}</ul>

      <h3 className="mb-2 font-bold">🧩 Chaveamento (quartos de final)</h3>
      {IS_DEMO ? <p className="mb-2 inline-flex rounded-md border border-white/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/70">Dados de exemplo</p>
        : <p className="card mb-2 text-center text-sm text-white/65">O chaveamento é publicado depois de fecharem as inscrições.</p>}
      <div className="space-y-2">
        {(IS_DEMO ? BRACKET : []).map(([a, b], k) => (
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
