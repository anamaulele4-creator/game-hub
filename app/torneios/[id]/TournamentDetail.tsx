'use client';

import { useState } from 'react';
import { Tournament, mzn } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Stat } from '@/components/ui';
import { Photo } from '@/components/Photo';
import { RegistrationSheet } from '@/components/RegistrationSheet';
import { GAME_ART } from '@/lib/gameArt';
import { fmtWhen, gameKeyOf } from '@/lib/jogos';
import { entriesApi } from '@/lib/entriesApi';
import { REG_ERROR, discordRule } from '@/lib/registration';

export default function TournamentDetail({ id }: { id: string }) {
  const { s } = useStore();
  const t = s.admin.tournaments.find((x) => x.id === id);
  if (!t) return <Page title="Torneio" back="/torneios"><p className="card mt-6 text-center text-sm text-white/70">Torneio não encontrado ou ainda a carregar.</p></Page>;
  return <Inner t={t} />;
}

function Inner({ t }: { t: Tournament }) {
  const { s, set, toast } = useStore();
  const [open, setOpen] = useState(false);
  const joined = s.entries.includes(t.id);
  const full = t.filled >= t.slots;
  const rule = discordRule(t, s.admin.settings.discordInvite);
  const wa = (s.admin.settings.gameLinks ?? {})[gameKeyOf(t.game)];

  const cancel = async () => {
    if (!window.confirm('Cancelar a tua inscrição?')) return;
    const r = await entriesApi.unregister(t.id);
    if (!r.ok) { toast(REG_ERROR[r.code] ?? r.code); return; }
    set((p) => ({ ...p, entries: p.entries.filter((x) => x !== t.id), admin: { ...p.admin, tournaments: p.admin.tournaments.map((x) => (x.id === t.id ? { ...x, filled: Math.max(0, x.filled - 1) } : x)) } }));
    toast('Inscrição cancelada.');
  };

  return (
    <Page title={t.name} back="/torneios">
      <div className="relative -mx-4 -mt-4 mb-4 aspect-[16/8] sm:-mx-6 sm:aspect-[16/7]">
        <Photo src={t.cover} fallback={GAME_ART[gameKeyOf(t.game)]} alt={t.name} shade="bottom" priority sizes="(min-width: 640px) 720px, 100vw" />
        <div className="absolute inset-x-0 bottom-0 p-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{t.game} · {t.mode}</p>
          <p className="font-display text-2xl font-bold leading-tight">{t.name}</p>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="chip">{fmtWhen(t.date)}</span><span className="chip">por {t.organizer}</span>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Entrada" value={t.fee > 0 ? mzn(t.fee) : 'Grátis'} />
        <Stat label="Prémio" value={t.prize > 0 ? mzn(t.prize) : 'A anunciar'} />
        <Stat label="Vagas" value={`${t.filled}/${t.slots}`} />
      </div>

      {t.status === 'aberto' && !joined && !full && <button type="button" className="btn mb-4 w-full" onClick={() => setOpen(true)}>Inscrever-se</button>}
      {joined && (
        <div className="card mb-4">
          <p className="mb-2 font-semibold text-lime">✓ Estás inscrito.</p>
          {rule.invite && <a href={rule.invite} target="_blank" rel="noopener noreferrer" className="btn-ghost mb-2 w-full">Abrir o grupo do Discord</a>}
          {t.status === 'aberto' && <button type="button" className="btn-ghost w-full" onClick={cancel}>Cancelar inscrição</button>}
        </div>
      )}
      {full && !joined && t.status === 'aberto' && <p className="card mb-4 text-center text-neon">Vagas esgotadas</p>}
      {wa && /^https:\/\/chat\.whatsapp\.com\//.test(wa) && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-ghost mb-4 w-full">Grupo do WhatsApp</a>}

      <h3 className="mb-2 font-bold">Regras</h3>
      <ul className="card mb-4 list-inside list-disc space-y-1 text-sm">{t.rules.map((r) => <li key={r}>{r}</li>)}</ul>

      <h3 className="mb-2 font-bold">Distribuição do prémio</h3>
      {t.prize > 0
        ? <div className="grid grid-cols-3 gap-2"><Stat label="1.º lugar" value={mzn(Math.round(t.prize * 0.5))} /><Stat label="2.º lugar" value={mzn(Math.round(t.prize * 0.3))} /><Stat label="3.º lugar" value={mzn(Math.round(t.prize * 0.2))} /></div>
        : <p className="card text-sm text-white/70">A anunciar pelo organizador.</p>}

      <RegistrationSheet t={open ? t : null} onClose={() => setOpen(false)} />
    </Page>
  );
}
