'use client';

// Admin › Torneios: criar/editar (capa, Discord, exigir Discord), estado e inscrições (com Discord verificado).
import { useEffect, useState } from 'react';
import { GRADIENTS, Tournament, mzn } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { GAME_ART } from '@/lib/gameArt';
import { gameKeyOf } from '@/lib/jogos';
import { uploadPhoto } from '@/lib/media';
import { Entry, discordRule, validDiscordInvite } from '@/lib/registration';
import { entriesApi } from '@/lib/entriesApi';
import { Photo } from '@/components/Photo';
import { TeamBadge } from '@/components/TeamBadge';
import { Badge, Confirm, useAdmin } from './shared';

const GAMES = ['Free Fire', 'Clash Royale', 'eFootball', 'Dream League Soccer', 'Outros'];
const MODES = ['Squad', 'Duo', 'Solo', '1v1', 'Clash Squad 4v4'];
type Draft = { name: string; game: string; mode: string; fee: number; prize: number; slots: number; date: string; cover: string; discordInvite: string; requireDiscord: boolean; rules: string };

const empty = (globalInvite?: string): Draft => ({ name: '', game: 'Free Fire', mode: 'Squad', fee: 0, prize: 0, slots: 32, date: '', cover: '', discordInvite: '', requireDiscord: validDiscordInvite(globalInvite), rules: '' });
const toDraft = (t: Tournament): Draft => ({ name: t.name, game: t.game, mode: t.mode, fee: t.fee, prize: t.prize, slots: t.slots, date: t.date.replace(' ', 'T'), cover: t.cover ?? '', discordInvite: t.discordInvite ?? '', requireDiscord: !!t.requireDiscord, rules: t.rules.join('\n') });

export default function Tournaments() {
  const { a, upd, act, toast } = useAdmin();
  const globalInvite = a.settings.discordInvite;
  const [edit, setEdit] = useState<string | null>(null); // id ou 'novo'
  const [d, setD] = useState<Draft>(empty(globalInvite));
  const [uploading, setUploading] = useState(false);
  const [entriesOf, setEntriesOf] = useState<string | null>(null);

  const open = (t?: Tournament) => { setEdit(t ? t.id : 'novo'); setD(t ? toDraft(t) : empty(globalInvite)); };
  const save = () => {
    if (d.name.trim().length < 3) { toast('Indica o nome do torneio.'); return; }
    if (d.discordInvite.trim() && !validDiscordInvite(d.discordInvite)) { toast('Convite Discord inválido (discord.gg/… ou discord.com/invite/…).'); return; }
    const used = a.tournaments.map((t) => t.id);
    const id = edit !== 'novo' ? edit! : IS_DEMO ? ['n1', 'n2', 'n3', 'n4', 'n5'].find((x) => !used.includes(x)) : crypto.randomUUID();
    if (!id) { toast('Na demo só há 5 torneios novos (páginas estáticas pré-geradas).'); return; }
    const base = a.tournaments.find((t) => t.id === id);
    const t: Tournament = {
      id, name: d.name.trim(), game: d.game, mode: d.mode, fee: Math.max(0, d.fee), prize: Math.max(0, d.prize), slots: Math.max(1, d.slots), filled: base?.filled ?? 0,
      date: d.date.replace('T', ' ') || 'A definir', status: base?.status ?? 'aberto', organizer: base?.organizer ?? 'TXAPILOG',
      rules: d.rules.split('\n').map((r) => r.trim()).filter(Boolean), gradient: base?.gradient ?? GRADIENTS[a.tournaments.length % GRADIENTS.length],
      cover: d.cover || undefined, discordInvite: d.discordInvite.trim() || undefined, requireDiscord: d.requireDiscord,
    };
    upd({ tournaments: base ? a.tournaments.map((x) => (x.id === id ? t : x)) : [t, ...a.tournaments] });
    act(base ? 'Editou torneio' : 'Criou torneio', t.name, base ? 'Torneio atualizado' : 'Torneio criado');
    setEdit(null);
  };
  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try { setD((x) => ({ ...x, cover: '' })); const url = await uploadPhoto(file, `tournaments/${edit === 'novo' ? 'novo' : edit}`); setD((x) => ({ ...x, cover: url })); }
    catch (e) { toast((e as Error).message); }
    finally { setUploading(false); }
  };
  const rule = discordRule({ discordInvite: d.discordInvite, requireDiscord: d.requireDiscord }, globalInvite);

  return (
    <div className="space-y-3">
      {edit ? (
        <div className="card space-y-3">
          <p className="font-semibold">{edit === 'novo' ? 'Criar torneio' : 'Editar torneio'}</p>
          <div className="relative aspect-[21/9] overflow-hidden rounded-xl border border-line">
            <Photo src={d.cover || null} fallback={GAME_ART[gameKeyOf(d.game)]} alt="Capa" shade="bottom" sizes="640px" />
            <span className="absolute bottom-2 left-3 text-xs font-semibold">{d.cover ? 'Capa do torneio' : 'Sem capa: usa a arte do jogo'}</span>
          </div>
          <div className="flex gap-2">
            <label className="btn-ghost flex-1 cursor-pointer text-sm">{uploading ? 'A enviar…' : d.cover ? 'Trocar capa' : 'Carregar capa'}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pickCover(f); }} />
            </label>
            {d.cover && <button type="button" className="btn-ghost text-sm" onClick={() => setD({ ...d, cover: '' })}>Remover</button>}
          </div>
          <input className="input w-full" placeholder="Nome" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Nome" />
          <div className="grid grid-cols-2 gap-2">
            <select className="input w-full" value={d.game} onChange={(e) => setD({ ...d, game: e.target.value })} aria-label="Jogo">{GAMES.map((g) => <option key={g}>{g}</option>)}</select>
            <select className="input w-full" value={d.mode} onChange={(e) => setD({ ...d, mode: e.target.value })} aria-label="Modo">{MODES.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <label>Entrada (MT)<input type="number" min={0} className="input w-full" value={d.fee} onChange={(e) => setD({ ...d, fee: Number(e.target.value) })} /></label>
            <label>Prémio (MT)<input type="number" min={0} className="input w-full" value={d.prize} onChange={(e) => setD({ ...d, prize: Number(e.target.value) })} /></label>
            <label>Vagas<input type="number" min={1} className="input w-full" value={d.slots} onChange={(e) => setD({ ...d, slots: Number(e.target.value) })} /></label>
          </div>
          {d.fee > 0 && <p className="text-xs text-neon2">Inscrições pagas ficam desligadas até haver pagamentos M-Pesa/e-Mola.</p>}
          <input type="datetime-local" className="input w-full" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} aria-label="Início" />
          <label className="block text-xs">Convite Discord do torneio
            <input className="input mt-1 w-full" value={d.discordInvite} placeholder={globalInvite ? `Vazio = padrão (${globalInvite})` : 'https://discord.gg/…'} onChange={(e) => setD({ ...d, discordInvite: e.target.value })} />
          </label>
          <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm">Exigir Discord na inscrição
            <input type="checkbox" className="h-5 w-5" checked={d.requireDiscord} onChange={(e) => setD({ ...d, requireDiscord: e.target.checked })} />
          </label>
          {rule.missing && <p className="rounded-lg bg-pink/20 p-2 text-xs">Exige Discord mas não há convite (nem padrão em Definições): ninguém se consegue inscrever. Põe um convite ou desliga a exigência.</p>}
          <label className="block text-xs">Regras (uma por linha)<textarea className="input mt-1 min-h-[90px] w-full" value={d.rules} onChange={(e) => setD({ ...d, rules: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
            <button type="button" className="btn" disabled={uploading} onClick={save}>Guardar</button>
          </div>
        </div>
      ) : <button type="button" className="btn w-full" onClick={() => open()}>Criar torneio</button>}

      {a.tournaments.map((t) => {
        const r = discordRule(t, globalInvite);
        return (
          <div key={t.id} className="card !p-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="relative block h-12 w-20 shrink-0 overflow-hidden rounded-lg"><Photo src={t.cover} fallback={GAME_ART[gameKeyOf(t.game)]} alt="" sizes="80px" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{t.name}</p>
                <p className="text-xs text-white/55">{t.game} · {t.mode} · {t.date} · {t.filled}/{t.slots} · {t.fee > 0 ? mzn(t.fee) : 'grátis'}</p>
              </div>
            </div>
            {r.missing && <p className="mt-2 rounded-lg bg-pink/20 p-2 text-xs">Exige Discord e não tem convite configurado.</p>}
            {!r.missing && r.required && <p className="mt-1 text-xs text-white/55">Discord obrigatório{t.discordInvite ? '' : ' (convite padrão)'}</p>}
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <select className="input w-full !py-1" value={t.status} aria-label="Estado" onChange={(e) => { upd({ tournaments: a.tournaments.map((x) => (x.id === t.id ? { ...x, status: e.target.value as Tournament['status'] } : x)) }); act('Mudou estado do torneio', `${t.name} → ${e.target.value}`); }}>
                <option value="aberto">aberto</option><option value="a decorrer">a decorrer</option><option value="terminado">terminado</option>
              </select>
              <button type="button" className="btn-ghost !min-h-[44px] !px-2 !text-xs" onClick={() => open(t)}>Editar</button>
              <button type="button" className="btn-ghost !min-h-[44px] !px-2 !text-xs" onClick={() => setEntriesOf(entriesOf === t.id ? null : t.id)}>Inscrições</button>
            </div>
            {entriesOf === t.id && <EntriesList t={t} />}
            <Confirm className="mt-2 min-h-[44px] text-xs text-pink" label="Eliminar torneio" question={`Eliminar ${t.name}?`} onYes={() => { upd({ tournaments: a.tournaments.filter((x) => x.id !== t.id) }); act('Eliminou torneio', t.name, 'Torneio eliminado'); }} />
          </div>
        );
      })}
    </div>
  );
}

const STATUS_TONE = { confirmada: 'green', pendente: 'amber', cancelada: 'red' } as const;

function EntriesList({ t }: { t: Tournament }) {
  const { toast, act } = useAdmin();
  const [list, setList] = useState<Entry[] | null>(null);
  const load = () => entriesApi.forTournament(t.id).then(setList).catch((e) => { toast((e as Error).message); setList([]); });
  useEffect(() => { load(); }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (e: Entry, action: Parameters<typeof entriesApi.adminAction>[2], label: string) => {
    const r = await entriesApi.adminAction(e.userId, t.id, action);
    if (r.ok) { act(label, `${t.name} · ${e.playerName}`); load(); } else toast(r.code);
  };
  if (!list) return <div className="mt-2 h-12 animate-pulse rounded-lg bg-panel2" />;
  if (!list.length) return <p className="mt-2 text-xs text-white/55">Ainda sem inscrições.</p>;
  return (
    <ul className="mt-2 space-y-2">
      {list.map((e) => (
        <li key={e.userId} className="rounded-lg bg-panel2 p-2.5 text-xs">
          <div className="flex items-center gap-2">
            {e.team && <TeamBadge name={e.team} logo={e.teamLogo} size={28} />}
            <p className="min-w-0 flex-1 truncate"><b className="text-sm">{e.playerName}</b>{e.team ? ` · ${e.team}` : ''}{e.handle ? ` · ${e.handle}` : ''}</p>
            <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
          </div>
          <p className="mt-1 text-white/60">ID {e.gameId} · {e.contact}</p>
          <p className="mt-0.5 text-white/60">Discord: {e.discordUsername || '—'}{e.discordJoined ? ' · diz que entrou' : ''} {e.discordVerified && <b className="text-lime">· verificado</b>}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {e.discordUsername && <button type="button" className="btn-ghost !min-h-[40px] !px-2.5 !text-xs" onClick={() => run(e, e.discordVerified ? 'discord_nao' : 'discord_ok', e.discordVerified ? 'Discord por verificar' : 'Discord verificado')}>{e.discordVerified ? 'Tirar verificação' : 'Discord verificado'}</button>}
            {e.status !== 'confirmada' && <button type="button" className="btn-ghost !min-h-[40px] !px-2.5 !text-xs" onClick={() => run(e, 'confirmar', 'Confirmou inscrição')}>Confirmar</button>}
            {e.status !== 'pendente' && <button type="button" className="btn-ghost !min-h-[40px] !px-2.5 !text-xs" onClick={() => run(e, 'pendente', 'Inscrição pendente')}>Pendente</button>}
            {e.status !== 'cancelada' && <button type="button" className="btn-ghost !min-h-[40px] !px-2.5 !text-xs text-pink" onClick={() => run(e, 'cancelar', 'Cancelou inscrição')}>Cancelar</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}
