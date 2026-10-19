'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { COMP_GAMES, MZ_PROVINCES, ROLE_LABEL, validateTeam, compText } from '@/lib/competitive';
import type { CompGame } from '@/lib/competitive';
import { compApi } from '@/lib/competitiveApi';
import type { ChallengeView, InviteView, MemberView, TeamView } from '@/lib/competitiveApi';
import { IS_DEMO } from '@/lib/config';
import { uploadPhoto } from '@/lib/media';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { Sheet, Tabs } from '@/components/ui';
import { TeamBadge } from '@/components/TeamBadge';
import { ChallengeCard, DemoNote, Empty, ExampleTag, Field, Shortcuts, Skel, useMe, useRun } from './Kit';

export function TeamRow({ t, rank }: { t: TeamView; rank?: number }) {
  return (
    <Link href={`/equipas/equipa?id=${encodeURIComponent(t.id)}`} className="flex min-h-[64px] items-center gap-3 px-4 py-2 hover:bg-white/5">
      {rank != null && <span className="stat-num w-6 text-center text-neon2">{rank}</span>}
      <TeamBadge name={t.name} logo={t.logo} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="truncate font-bold">{t.name}</span>{t.tag && <span className="text-xs text-white/60">[{t.tag}]</span>}{t.example && <ExampleTag />}</span>
        <span className="block text-xs text-white/65">{t.game} · {t.wins}V {t.draws}E {t.losses}D</span>
      </span>
      <span className="text-right"><span className="stat-num block">{Math.round(t.rating)}</span><span className="text-[11px] text-white/55">Elo</span></span>
    </Link>
  );
}

const TABS = ['Equipas', 'Ranking', 'As minhas'] as const;
type Tab = (typeof TABS)[number];

export default function TeamsArea({ initialCreate = false, rankingOnly = false }: { initialCreate?: boolean; rankingOnly?: boolean }) {
  const [tab, setTab] = useState<Tab>(rankingOnly ? 'Ranking' : 'Equipas');
  const [q, setQ] = useState('');
  const [game, setGame] = useState<string>('');
  const [list, setList] = useState<TeamView[] | null>(null);
  const [mine, setMine] = useState<TeamView[]>([]);
  const [inv, setInv] = useState<InviteView[]>([]);
  const [create, setCreate] = useState(initialCreate);
  const need = useRequireAuth();
  const run = useRun();
  const me = useMe();

  const load = useCallback(async () => {
    setList(null);
    const [l, m, i] = await Promise.all([compApi.teams({ q: tab === 'Equipas' ? q : '', game }), compApi.myTeams().catch(() => []), compApi.myInvites().catch(() => [])]);
    setList(l); setMine(m); setInv(i);
  }, [q, game, tab]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load]);

  const shown = tab === 'As minhas' ? mine : list;
  return (
    <>
      <DemoNote />
      {!rankingOnly && <Shortcuts />}
      <div className="hud-card mb-4 flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl font-bold">{rankingOnly ? 'Ranking de equipas' : 'Equipas'}</p>
          <p className="mt-1 text-sm text-white/75">Cria a tua equipa, convida jogadores e desafia outras equipas. O ranking usa Elo calculado no servidor a partir de resultados validados.</p>
        </div>
        {!rankingOnly && <button type="button" className="btn" onClick={() => need(() => setCreate(true))}>Criar equipa</button>}
      </div>

      {inv.length > 0 && (
        <section className="card mb-4">
          <p className="mb-2 font-bold">Convites para ti</p>
          <ul className="space-y-2">{inv.map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm">👥 <b>{i.teamName}</b> convidou-te</span>
              <button type="button" className="btn !min-h-[40px] !px-3 text-sm" onClick={async () => { if (await run(compApi.respondInvite(i.id, true), 'Entraste na equipa!')) void load(); }}>Aceitar</button>
              <button type="button" className="btn-ghost !min-h-[40px] !px-3 text-sm" onClick={async () => { if (await run(compApi.respondInvite(i.id, false), 'Convite recusado')) void load(); }}>Recusar</button>
            </li>))}
          </ul>
        </section>
      )}

      {!rankingOnly && <Tabs tabs={TABS} value={tab} onChange={setTab} />}
      <div className="mb-3 flex flex-wrap gap-2">
        {tab === 'Equipas' && <input className="input min-w-[200px] flex-1" placeholder="Procurar equipa" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Procurar equipa" />}
        <select className="input w-auto" value={game} onChange={(e) => setGame(e.target.value)} aria-label="Jogo">
          <option value="">Todos os jogos</option>{COMP_GAMES.map((g) => <option key={g}>{g}</option>)}
        </select>
      </div>
      {!shown ? <Skel /> : shown.length === 0 ? <Empty>{tab === 'As minhas' ? 'Ainda não pertences a nenhuma equipa.' : 'Nenhuma equipa encontrada.'}</Empty> : (
        <ul className="card divide-y divide-line !p-0">{shown.map((t, i) => <li key={t.id}><TeamRow t={t} rank={tab === 'Ranking' ? i + 1 : undefined} /></li>)}</ul>
      )}
      <CreateTeamSheet open={create} onClose={() => setCreate(false)} meId={me?.id ?? null} onDone={() => { setCreate(false); void load(); }} />
    </>
  );
}

function CreateTeamSheet({ open, onClose, onDone, meId }: { open: boolean; onClose: () => void; onDone: () => void; meId: string | null }) {
  const [f, setF] = useState({ name: '', tag: '', game: 'Free Fire' as CompGame, province: '', bio: '' });
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRun();
  const router = useRouter();
  const v = validateTeam(f);
  return (
    <Sheet open={open} onClose={onClose} title="Criar equipa">
      <div className="space-y-3">
        <Field label="Nome da equipa"><input className="input" maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Sigla (opcional)" hint="2 a 6 letras ou números, ex.: MAM"><input className="input uppercase" maxLength={6} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value.toUpperCase() })} /></Field>
        <Field label="Jogo"><select className="input" value={f.game} onChange={(e) => setF({ ...f, game: e.target.value as CompGame })}>{COMP_GAMES.map((g) => <option key={g}>{g}</option>)}</select></Field>
        <Field label="Província"><select className="input" value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}><option value="">—</option>{MZ_PROVINCES.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Descrição"><textarea className="input min-h-[80px]" maxLength={500} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <Field label="Logótipo (opcional)">
          <div className="flex items-center gap-3">
            <TeamBadge name={f.name || '?'} logo={logo} size={48} />
            <input type="file" accept="image/*" className="text-sm" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              try { setLogo(await uploadPhoto(file, `teams/${IS_DEMO ? 'demo' : meId ?? 'anon'}`, { square: true })); } catch (err) { alert((err as Error).message); }
            }} />
          </div>
        </Field>
        {v && f.name && <p className="text-xs text-pink">{compText(v)}</p>}
        <button type="button" className="btn w-full" disabled={!!v || busy} onClick={async () => {
          setBusy(true);
          const r = await run(compApi.createTeam({ ...f, logo: IS_DEMO ? logo : logo }), 'Equipa criada! Agora convida os teus jogadores.');
          setBusy(false);
          if (r) { onDone(); router.push(`/equipas/equipa?id=${encodeURIComponent(r.teamId)}`); }
        }}>Criar equipa</button>
        <p className="text-xs text-white/55">Ficas como capitão. Só podes ser membro de uma equipa por jogo.</p>
      </div>
    </Sheet>
  );
}

export function TeamDetail({ id }: { id: string }) {
  const [d, setD] = useState<{ team: TeamView; members: MemberView[]; challenges: ChallengeView[]; invites: InviteView[] } | null | undefined>(undefined);
  const [handle, setHandle] = useState('');
  const [edit, setEdit] = useState(false);
  const me = useMe();
  const run = useRun();
  const load = useCallback(() => { compApi.team(id).then(setD).catch(() => setD(null)); }, [id]);
  useEffect(load, [load]);
  if (d === undefined) return <Skel />;
  if (!d) return <Empty>Equipa não encontrada.</Empty>;
  const { team: t, members } = d;
  const myM = members.find((m) => m.userId === (IS_DEMO ? 'demo' : me?.id));
  const captain = myM?.role === 'capitao';
  const canInvite = myM && myM.role !== 'membro';
  return (
    <>
      <DemoNote />
      <div className="hud-card mb-4 p-5">
        <div className="flex items-center gap-4">
          <TeamBadge name={t.name} logo={t.logo} size={72} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold">{t.name}{t.tag && <span className="text-base text-white/60">[{t.tag}]</span>}{t.example && <ExampleTag />}</p>
            <p className="text-sm text-white/75">{t.game}{t.province ? ` · ${t.province}` : ''}{t.status !== 'ativa' ? ` · ${t.status}` : ''}</p>
          </div>
        </div>
        {t.bio && <p className="mt-3 text-sm text-white/80">{t.bio}</p>}
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[['Elo', Math.round(t.rating)], ['Vitórias', t.wins], ['Empates', t.draws], ['Derrotas', t.losses]].map(([l, v]) => (
            <div key={l as string} className="rounded-[14px] bg-panel2 p-2"><p className="stat-num text-lg">{v}</p><p className="text-[11px] text-white/65">{l}</p></div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {myM && myM.role !== 'membro' && <Link className="btn" href={`/desafios?criar=1&equipa=${encodeURIComponent(t.id)}`}>Criar desafio</Link>}
          {!myM && <Link className="btn" href={`/desafios?criar=1&adversario=${encodeURIComponent(t.id)}`}>Desafiar esta equipa</Link>}
          {captain && <button type="button" className="btn-ghost" onClick={() => setEdit(true)}>Editar perfil</button>}
          {myM && <button type="button" className="btn-ghost" onClick={async () => { if (window.confirm('Sair da equipa?') && await run(compApi.memberAction(t.id, 'me', 'sair'), 'Saíste da equipa')) load(); }}>Sair</button>}
        </div>
      </div>

      <section className="card mb-4">
        <p className="mb-2 font-bold">Membros ({members.length})</p>
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2">
              <Link href={`/jogador?u=${encodeURIComponent(m.handle)}`} className="min-w-0 flex-1"><span className="font-semibold">{m.name}</span> <span className="text-xs text-white/60">@{m.handle}</span></Link>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{ROLE_LABEL[m.role]}{m.role === 'vice' && m.canManageChallenges ? ' · gere desafios' : ''}</span>
              {captain && m.role !== 'capitao' && (
                <span className="flex flex-wrap gap-1">
                  <button type="button" className="chip text-xs" onClick={async () => { if (await run(compApi.memberAction(t.id, m.userId, 'vice', m.role !== 'vice'))) load(); }}>{m.role === 'vice' ? 'Tirar vice' : 'Fazer vice'}</button>
                  {m.role === 'vice' && <button type="button" className="chip text-xs" onClick={async () => { if (await run(compApi.memberAction(t.id, m.userId, 'gerir_desafios', !m.canManageChallenges))) load(); }}>{m.canManageChallenges ? 'Sem desafios' : 'Pode gerir desafios'}</button>}
                  <button type="button" className="chip text-xs" onClick={async () => { if (window.confirm(`Passar a capitania a @${m.handle}?`) && await run(compApi.memberAction(t.id, m.userId, 'capitao'), 'Capitania transferida')) load(); }}>Passar capitania</button>
                  <button type="button" className="chip text-xs" onClick={async () => { if (window.confirm(`Remover @${m.handle}?`) && await run(compApi.memberAction(t.id, m.userId, 'remover'), 'Membro removido')) load(); }}>Remover</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {canInvite && (
          <div className="mt-3 flex gap-2">
            <input className="input flex-1" placeholder="@utilizador" value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="Convidar utilizador" />
            <button type="button" className="btn" disabled={handle.trim().length < 3} onClick={async () => { if (await run(compApi.invite(t.id, handle), 'Convite enviado')) { setHandle(''); load(); } }}>Convidar</button>
          </div>
        )}
        {canInvite && d.invites.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-white/75">{d.invites.map((i) => (
            <li key={i.id} className="flex items-center gap-2"><span className="flex-1">⏳ @{i.userHandle} (pendente)</span><button type="button" className="chip text-xs" onClick={async () => { if (await run(compApi.cancelInvite(i.id))) load(); }}>Cancelar</button></li>))}
          </ul>
        )}
      </section>

      <section>
        <p className="sec-title mb-2 font-bold">Histórico de desafios</p>
        {d.challenges.length === 0 ? <Empty>Sem desafios ainda.</Empty> : <div className="grid gap-3 sm:grid-cols-2">{d.challenges.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>}
      </section>
      {captain && <EditTeamSheet open={edit} onClose={() => setEdit(false)} t={t} meId={me?.id ?? null} onDone={() => { setEdit(false); load(); }} />}
    </>
  );
}

function EditTeamSheet({ open, onClose, t, onDone, meId }: { open: boolean; onClose: () => void; t: TeamView; onDone: () => void; meId: string | null }) {
  const [f, setF] = useState({ bio: t.bio, province: t.province ?? '', tag: t.tag ?? '' });
  const [logo, setLogo] = useState<string | null>(t.logo);
  const run = useRun();
  return (
    <Sheet open={open} onClose={onClose} title="Editar equipa">
      <div className="space-y-3">
        <Field label="Sigla"><input className="input uppercase" maxLength={6} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value.toUpperCase() })} /></Field>
        <Field label="Província"><select className="input" value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}><option value="">—</option>{MZ_PROVINCES.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Descrição"><textarea className="input min-h-[80px]" maxLength={500} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <Field label="Logótipo">
          <div className="flex items-center gap-3"><TeamBadge name={t.name} logo={logo} size={48} />
            <input type="file" accept="image/*" className="text-sm" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setLogo(await uploadPhoto(file, `teams/${IS_DEMO ? 'demo' : meId ?? 'anon'}`, { square: true })); } catch (err) { alert((err as Error).message); } }} />
            {logo && <button type="button" className="chip text-xs" onClick={() => setLogo(null)}>Remover</button>}
          </div>
        </Field>
        <button type="button" className="btn w-full" onClick={async () => { if (await run(compApi.updateTeam(t.id, { bio: f.bio, province: f.province || null, tag: f.tag || null, logo }), 'Equipa atualizada')) onDone(); }}>Guardar</button>
      </div>
    </Sheet>
  );
}
