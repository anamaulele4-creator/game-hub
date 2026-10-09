'use client';

// Grupos: criar (?novo=1), informação do grupo (?c=<id>) e convite (?convite=<código>).
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Avatar, Sheet } from '@/components/ui';
import { MoreMenu } from '@/components/Moderation';
import { PhotoCropSheet } from '@/components/chat/PhotoCrop';
import { SharedMedia, StarredList } from '@/components/chat/Shared';
import { moderate } from '@/lib/poipakAI';
import { useStore } from '@/lib/store';
import { SITE_URL } from '@/lib/config';
import type { Chat, InvitePreview, Member } from '@/lib/chat';
import type { Person } from '@/lib/social';

type Lib = typeof import('@/lib/chat');

function Bar({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel px-2 py-2"><button onClick={onBack} className="h-11 w-9 text-2xl" aria-label="Voltar">‹</button><h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>{right}</header>;
}
function Row({ icon, label, sub, onClick, danger, right }: { icon: string; label: string; sub?: string; onClick?: () => void; danger?: boolean; right?: React.ReactNode }) {
  return <button onClick={onClick} className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left ${danger ? 'text-red-300' : ''}`}><span className="w-7 text-center text-xl">{icon}</span><span className="min-w-0 flex-1"><span className="block text-base">{label}</span>{sub && <span className="block text-xs text-white/50">{sub}</span>}</span>{right}</button>;
}
function Toggle({ on }: { on: boolean }) {
  return <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-neon' : 'bg-white/20'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></span>;
}

function useFollowed(open: boolean) {
  const { s } = useStore();
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true; setPeople(null);
    void import('@/lib/social').then((m) => m.peopleIFollow(s.following)).then((l) => { if (alive) setPeople(l.filter((p) => !s.blocked.includes(p.id))); });
    return () => { alive = false; };
  }, [open, s.following, s.blocked]);
  return people;
}

function PickPeople({ people, chosen, onToggle, exclude = [] }: { people: Person[] | null; chosen: string[]; onToggle: (id: string) => void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  if (people === null) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>;
  const list = people.filter((p) => !exclude.includes(p.id) && (p.name + p.handle).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <input className="input mb-2 w-full" placeholder="Pesquisar quem segues" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisar" />
      {!people.length && <p className="py-6 text-center text-sm text-white/60">Só podes adicionar pessoas que segues. Segue jogadores em <Link href="/explorar" className="text-neon2">Explorar</Link>.</p>}
      <ul>
        {list.map((p) => {
          const on = chosen.includes(p.id);
          return <li key={p.id}><button onClick={() => onToggle(p.id)} className="flex min-h-[60px] w-full items-center gap-3 py-1.5 text-left" aria-pressed={on}>
            <span className="relative"><Avatar a={p.avatar} name={p.name} size={46} />{on && <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-bg bg-lime text-[11px] text-black">✓</span>}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{p.name}{p.verified && ' ✅'}</span><span className="block text-xs text-white/50">{p.handle}</span></span>
          </button></li>;
        })}
      </ul>
    </>
  );
}

// ---------------- Criar ----------------
function Create({ lib }: { lib: Lib }) {
  const router = useRouter();
  const { toast } = useStore();
  const people = useFollowed(true);
  const [step, setStep] = useState(1);
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [crop, setCrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [v2, setV2] = useState(true);
  useEffect(() => { void lib.chatV2().then(setV2); }, [lib]);

  const create = async () => {
    if (busy) return;
    const t = title.trim();
    if (!t) { setErr('Dá um nome ao grupo.'); return; }
    const mod = moderate(`${t} ${desc}`);
    if (mod.level === 'block') { setErr(`🛡️ ${mod.tip}`); return; }
    setBusy(true); setErr('');
    const r = await lib.createGroup({ title: t, description: desc, photo: photo?.blob ?? null, members: chosen });
    setBusy(false);
    if (!r.id) { setErr(r.error ?? 'Não foi possível criar o grupo.'); return; }
    toast('Grupo criado 👥');
    router.replace(`/mensagens/chat?c=${encodeURIComponent(r.id)}`);
  };

  return (
    <div className="min-h-[100vh] pb-28">
      <Bar title={step === 1 ? 'Novo grupo' : 'Dados do grupo'} onBack={() => (step === 2 ? setStep(1) : router.push('/mensagens'))} right={step === 1 ? <span className="pr-2 text-sm text-white/50">{chosen.length} selecionado(s)</span> : undefined} />
      {!v2 && <p className="m-4 rounded-xl bg-neon/10 p-3 text-sm text-neon3">👥 {lib.GROUPS_OFF_MSG}</p>}
      {step === 1 ? (
        <div className="px-4 pt-3">
          {chosen.length > 0 && <div className="mb-3 flex gap-3 overflow-x-auto pb-1">{chosen.map((id) => { const p = people?.find((x) => x.id === id); return p ? <button key={id} onClick={() => setChosen((c) => c.filter((x) => x !== id))} className="flex w-14 shrink-0 flex-col items-center gap-1 text-[11px]"><span className="relative"><Avatar a={p.avatar} name={p.name} size={48} /><span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-panel2 text-[10px]">✕</span></span><span className="w-full truncate text-center">{p.name.split(' ')[0]}</span></button> : null; })}</div>}
          <PickPeople people={people} chosen={chosen} onToggle={(id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))} />
          <button className="btn fixed bottom-6 left-1/2 z-30 w-[calc(100%-2rem)] max-w-[26rem] -translate-x-1/2 text-base" onClick={() => setStep(2)}>Seguinte →</button>
        </div>
      ) : (
        <div className="space-y-4 px-4 pt-5">
          <div className="flex items-center gap-4">
            <button onClick={() => setCrop(true)} className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel2 text-3xl" aria-label="Foto do grupo">
              {photo ? <img src={photo.url} alt="Foto do grupo" className="h-full w-full object-cover" /> : '📷'}
            </button>
            <label className="flex-1 text-sm text-white/70">Nome do grupo
              <input className="input mt-1 w-full" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Squad Free Fire MZ" autoFocus />
              <span className="mt-0.5 block text-right text-xs text-white/40">{title.length}/60</span>
            </label>
          </div>
          <label className="block text-sm text-white/70">Descrição (opcional)
            <textarea className="input mt-1 w-full" rows={3} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Regras, horários de treino…" />
          </label>
          <div>
            <p className="mb-2 text-sm text-white/70">Participantes: {chosen.length + 1}</p>
            <div className="flex flex-wrap gap-2">{chosen.map((id) => { const p = people?.find((x) => x.id === id); return p ? <span key={id} className="flex items-center gap-1.5 rounded-full bg-panel2 py-1 pl-1 pr-3 text-sm"><Avatar a={p.avatar} name={p.name} size={26} />{p.name.split(' ')[0]}</span> : null; })}</div>
          </div>
          {err && <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{err}</p>}
          <button className="btn min-h-[3.25rem] w-full text-base" disabled={busy || !title.trim() || !v2} onClick={() => void create()}>{busy ? 'A criar…' : '✓ Criar grupo'}</button>
          <p className="text-center text-xs text-white/40">És o administrador. Podes convidar outras pessoas com um link depois de criar.</p>
        </div>
      )}
      <PhotoCropSheet open={crop} onClose={() => setCrop(false)} title="Foto do grupo" onDone={(blob, url) => setPhoto({ blob, url })} />
    </div>
  );
}

// ---------------- Convite ----------------
function Invite({ lib, code }: { lib: Lib; code: string }) {
  const router = useRouter();
  const [g, setG] = useState<InvitePreview | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void lib.invitePreview(code).then((r) => (r.g ? setG(r.g) : setErr(r.error ?? 'Convite inválido.'))); }, [lib, code]);
  const join = async () => {
    setBusy(true);
    const r = await lib.joinByInvite(code);
    setBusy(false);
    if (r.id) router.replace(`/mensagens/chat?c=${encodeURIComponent(r.id)}`); else setErr(r.error ?? 'Não foi possível entrar.');
  };
  return (
    <div className="min-h-[100vh]">
      <Bar title="Convite para grupo" onBack={() => router.push('/mensagens')} />
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        {!g && !err && <span className="skeleton h-28 w-28 rounded-full" />}
        {g && <>
          <Avatar a={g.photo} name={g.title} size={112} />
          <p className="text-2xl font-bold">{g.title}</p>
          <p className="text-sm text-white/60">Grupo · {g.members} participantes</p>
          {g.description && <p className="max-w-sm whitespace-pre-wrap text-sm text-white/75">{g.description}</p>}
          <button className="btn mt-3 min-h-[3.25rem] w-full max-w-xs text-base" disabled={busy} onClick={() => (g.isMember ? router.replace(`/mensagens/chat?c=${encodeURIComponent(g.id)}`) : void join())}>{g.isMember ? 'Abrir grupo' : busy ? 'A entrar…' : 'Entrar no grupo'}</button>
        </>}
        {err && <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{err}</p>}
      </div>
    </div>
  );
}

// ---------------- Informação do grupo ----------------
function Info({ lib, id }: { lib: Lib; id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useStore();
  const [g, setG] = useState<Chat | null>(null);
  const [me, setMe] = useState('');
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'pessoas' | 'media' | 'favoritas'>(params.get('tab') === 'favoritas' ? 'favoritas' : 'pessoas');
  const [edit, setEdit] = useState<'' | 'nome' | 'desc'>('');
  const [val, setVal] = useState('');
  const [crop, setCrop] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [add, setAdd] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [link, setLink] = useState(false);
  const [err, setErr] = useState('');
  const people = useFollowed(add);

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([lib.getChat(id), lib.myId()]);
    if (!c || c.kind !== 'grupo') { setMissing(true); return; }
    setG(c); setMe(m);
  }, [lib, id]);
  useEffect(() => { void load(); }, [load]);

  if (missing) return <div><Bar title="Grupo" onBack={() => router.push('/mensagens')} /><p className="card m-4 text-center text-sm">Grupo não encontrado ou já não fazes parte dele.</p></div>;
  if (!g) return <div><Bar title="Grupo" onBack={() => router.back()} /><div className="flex flex-col items-center gap-3 p-8"><span className="skeleton h-28 w-28 rounded-full" /><span className="skeleton h-5 w-40 rounded" /></div></div>;

  const admin = g.myRole === 'admin';
  const canEditInfo = admin || !g.onlyAdminsEdit;
  const inviteUrl = `${SITE_URL}/mensagens/grupo/?convite=${g.inviteCode}`;
  const act = async (p: Promise<{ error?: string }>, ok: string) => { const r = await p; if (r.error) setErr(r.error); else { toast(ok); setErr(''); } void load(); };
  const saveText = async () => {
    const v = val.trim();
    if (edit === 'nome' && !v) return;
    if (moderate(v).level === 'block') { setErr('🛡️ Esse texto não é permitido.'); return; }
    const which = edit; setEdit('');
    await act(lib.updateGroup(id, g, which === 'nome' ? { title: v } : { description: v }), which === 'nome' ? 'Nome atualizado' : 'Descrição atualizada');
  };
  const call = async (video: boolean) => {
    const m = await import('@/lib/calls');
    if (!(await m.callsAvailable())) { toast(m.CALLS_OFF_MSG); return; }
    router.push(`/mensagens/chamada?c=${encodeURIComponent(id)}&v=${video ? 1 : 0}`);
  };

  return (
    <div className="min-h-[100vh] pb-16">
      <Bar title="Informação do grupo" onBack={() => router.push(`/mensagens/chat?c=${encodeURIComponent(id)}`)} />
      <div className="flex flex-col items-center gap-2 border-b border-line bg-panel px-4 pb-5 pt-6 text-center">
        <button onClick={() => canEditInfo && setCrop(true)} className="relative" aria-label="Foto do grupo">
          <Avatar a={g.photo} name={g.title} size={120} />
          {canEditInfo && <span className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full bg-neon text-base">📷</span>}
        </button>
        <button onClick={() => { if (canEditInfo) { setVal(g.title); setEdit('nome'); } }} className="mt-1 text-2xl font-bold">{g.title}{canEditInfo && <span className="ml-2 text-base text-white/40">✏️</span>}</button>
        <p className="text-sm text-white/55">Grupo · {g.memberCount} participantes</p>
        <div className="mt-3 grid w-full max-w-sm grid-cols-3 gap-2">
          <button onClick={() => void call(false)} className="flex flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-xl">📞</span>Voz</button>
          <button onClick={() => void call(true)} className="flex flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-xl">📹</span>Vídeo</button>
          {admin ? <button onClick={() => setAdd(true)} className="flex flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-xl">➕</span>Adicionar</button>
            : <Link href={`/mensagens/chat?c=${encodeURIComponent(id)}`} className="flex flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-xl">💬</span>Conversa</Link>}
        </div>
      </div>

      <button onClick={() => { if (canEditInfo) { setVal(g.description); setEdit('desc'); } }} className="block w-full border-b border-line bg-panel px-4 py-4 text-left">
        <span className="block text-xs text-white/50">Descrição{canEditInfo ? ' · toca para editar' : ''}</span>
        <span className="mt-1 block whitespace-pre-wrap text-[15px]">{g.description || <i className="text-white/40">{canEditInfo ? 'Adicionar descrição do grupo' : 'Sem descrição'}</i>}</span>
      </button>
      {err && <p className="m-3 rounded-xl bg-red-500/15 p-3 text-sm text-red-200" onClick={() => setErr('')}>{err}</p>}

      <div className="mt-2 divide-y divide-line border-y border-line bg-panel">
        <Row icon={g.muted ? '🔔' : '🔕'} label="Silenciar notificações" right={<Toggle on={g.muted} />} onClick={() => void act(lib.setMuted(id, !g.muted).then(() => ({})), g.muted ? 'Notificações ativadas' : 'Grupo silenciado 🔕')} />
        {admin && <Row icon="🔗" label="Convidar através de link" sub="Quem tiver o link pode entrar" onClick={() => setLink(true)} />}
        {admin && <Row icon="📣" label="Só administradores enviam mensagens" right={<Toggle on={g.onlyAdminsSend} />} onClick={() => void act(lib.updateGroup(id, g, { onlyAdminsSend: !g.onlyAdminsSend }), 'Definições guardadas')} />}
        {admin && <Row icon="✏️" label="Só administradores editam dados do grupo" sub="Nome, foto e descrição" right={<Toggle on={g.onlyAdminsEdit} />} onClick={() => void act(lib.updateGroup(id, g, { onlyAdminsEdit: !g.onlyAdminsEdit }), 'Definições guardadas')} />}
      </div>

      <div className="mt-2 border-y border-line bg-panel px-4 pt-3">
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-panel2 p-1 text-sm">
          {([['pessoas', `Participantes`], ['media', 'Multimédia'], ['favoritas', 'Favoritas']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`min-h-[40px] rounded-lg ${tab === k ? 'bg-panel font-semibold' : 'text-white/60'}`}>{l}</button>)}
        </div>
        {tab === 'pessoas' && (
          <ul className="pb-2">
            <li className="pb-1 text-xs text-white/50">{g.memberCount} participantes</li>
            {g.members.map((m) => (
              <li key={m.id}><button onClick={() => m.id !== me && setMember(m)} className="flex min-h-[60px] w-full items-center gap-3 py-1.5 text-left">
                <span className="relative"><Avatar a={m.avatar} name={m.name} size={46} />{lib.isOnline(m.id) && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-panel bg-lime" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.id === me ? 'Tu' : m.name}{m.verified && ' ✅'}</span><span className="block truncate text-xs text-white/50">{m.handle}</span></span>
                {m.role === 'admin' && <span className="rounded-md bg-lime/15 px-2 py-0.5 text-[11px] font-semibold text-lime">Admin</span>}
              </button></li>
            ))}
          </ul>
        )}
        {tab === 'media' && <div className="pb-4"><SharedMedia conv={id} /></div>}
        {tab === 'favoritas' && <div className="pb-4"><StarredList conv={id} /></div>}
      </div>

      <div className="mt-2 divide-y divide-line border-y border-line bg-panel">
        <Row icon="🚪" label="Sair do grupo" danger onClick={async () => { if (!window.confirm(`Sair de "${g.title}"?`)) return; const r = await lib.leaveGroup(id); if (r.error) setErr(r.error); else { toast('Saíste do grupo'); router.replace('/mensagens'); } }} />
        <div className="flex items-center px-2 py-1 text-red-300"><MoreMenu kind="utilizador" target={`grupo:${id}`} label={`Grupo: ${g.title}`} className="!text-xl" /><span className="text-base">Denunciar grupo</span></div>
      </div>
      <p className="px-4 py-3 text-center text-xs text-white/40">Criado por {g.members.find((m) => m.id === g.createdBy)?.name ?? 'um participante'}</p>

      {/* Editar nome/descrição */}
      <Sheet open={!!edit} onClose={() => setEdit('')} title={edit === 'nome' ? 'Nome do grupo' : 'Descrição do grupo'}>
        {edit === 'nome' ? <input className="input w-full" value={val} maxLength={60} onChange={(e) => setVal(e.target.value)} autoFocus /> : <textarea className="input w-full" rows={5} value={val} maxLength={500} onChange={(e) => setVal(e.target.value)} autoFocus />}
        <button className="btn mt-3 w-full" onClick={() => void saveText()}>Guardar</button>
      </Sheet>

      {/* Participante */}
      <Sheet open={!!member} onClose={() => setMember(null)} title={member?.name ?? ''}>
        {member && <div className="divide-y divide-line overflow-hidden rounded-2xl bg-panel2">
          <Row icon="💬" label={`Mensagem a ${member.name.split(' ')[0]}`} onClick={() => router.push(`/mensagens/chat?u=${encodeURIComponent(member.id)}`)} />
          <Row icon="👤" label="Ver perfil" onClick={() => router.push(`/idolo/${member.id}`)} />
          {admin && (member.role === 'admin'
            ? <Row icon="⬇️" label="Remover como administrador" onClick={() => { const m = member; setMember(null); void act(lib.setRole(id, m.id, 'membro'), `${m.name} já não é admin`); }} />
            : <Row icon="⭐" label="Tornar administrador do grupo" onClick={() => { const m = member; setMember(null); void act(lib.setRole(id, m.id, 'admin'), `${m.name} é agora admin`); }} />)}
          {admin && <Row icon="➖" label={`Remover ${member.name.split(' ')[0]}`} danger onClick={() => { const m = member; if (!window.confirm(`Remover ${m.name} do grupo?`)) return; setMember(null); void act(lib.removeMember(id, m.id), `${m.name} foi removido`); }} />}
        </div>}
      </Sheet>

      {/* Adicionar participantes */}
      <Sheet open={add} onClose={() => { setAdd(false); setChosen([]); }} title="Adicionar participantes">
        <PickPeople people={people} chosen={chosen} exclude={g.members.map((m) => m.id)} onToggle={(pid) => setChosen((c) => (c.includes(pid) ? c.filter((x) => x !== pid) : [...c, pid]))} />
        <button className="btn mt-3 w-full" disabled={!chosen.length} onClick={() => { const ids = chosen; setAdd(false); setChosen([]); void act(lib.addMembers(id, ids), `${ids.length} participante(s) adicionado(s)`); }}>Adicionar {chosen.length || ''}</button>
      </Sheet>

      {/* Link de convite */}
      <Sheet open={link} onClose={() => setLink(false)} title="Link de convite">
        <div className="mb-3 flex items-center gap-3"><Avatar a={g.photo} name={g.title} size={48} /><p className="min-w-0 break-all text-sm text-neon2">{inviteUrl}</p></div>
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-panel2">
          <Row icon="📋" label="Copiar link" onClick={() => { void navigator.clipboard?.writeText(inviteUrl).then(() => toast('Link copiado'), () => toast('Não foi possível copiar')); }} />
          <Row icon="📤" label="Partilhar link" onClick={() => { if (navigator.share) void navigator.share({ title: g.title, text: `Entra no meu grupo "${g.title}" no TXAPILOG`, url: inviteUrl }).catch(() => {}); else void navigator.clipboard?.writeText(inviteUrl).then(() => toast('Link copiado')); }} />
          <Row icon="🔄" label="Redefinir link" sub="O link antigo deixa de funcionar" danger onClick={async () => { if (!window.confirm('Redefinir o link de convite?')) return; const r = await lib.resetInvite(id); if (r.error) setErr(r.error); else { toast('Novo link criado'); void load(); } }} />
        </div>
      </Sheet>

      <PhotoCropSheet open={crop} onClose={() => setCrop(false)} title="Foto do grupo" onDone={(blob) => void act(lib.updateGroup(id, g, { photo: blob }), 'Foto do grupo atualizada')} />
    </div>
  );
}

function Grupo() {
  const params = useSearchParams();
  const { ready } = useStore();
  const [lib, setLib] = useState<Lib | null>(null);
  useEffect(() => { void import('@/lib/chat').then(setLib); }, []);
  if (!ready || !lib) return <div className="p-6"><div className="skeleton h-24 rounded-card" /></div>;
  const code = params.get('convite');
  const id = params.get('c');
  if (code) return <Invite lib={lib} code={code} />;
  if (id) return <Info lib={lib} id={id} />;
  return <Create lib={lib} />;
}

export default function GrupoPage() {
  return <Suspense fallback={<div className="p-6"><div className="skeleton h-24 rounded-card" /></div>}><Grupo /></Suspense>;
}
