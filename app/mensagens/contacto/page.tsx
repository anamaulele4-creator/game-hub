'use client';

// Perfil do contacto a partir do chat (estilo WhatsApp): foto, nome, @, bio, multimédia partilhada, favoritas, bloquear, denunciar.
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Avatar, Sheet } from '@/components/ui';
import { MoreMenu } from '@/components/Moderation';
import { SharedMedia, StarredList } from '@/components/chat/Shared';
import { useStore } from '@/lib/store';
import type { Chat } from '@/lib/chat';
import type { ProfileInfo } from '@/lib/social';

function Contacto() {
  const params = useSearchParams();
  const router = useRouter();
  const { s, ready, toast, toggleBlock } = useStore();
  const cid = params.get('c') ?? '';
  const [lib, setLib] = useState<typeof import('@/lib/chat') | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [prof, setProf] = useState<ProfileInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'media' | 'favoritas'>(params.get('tab') === 'favoritas' ? 'favoritas' : 'media');
  const [photo, setPhoto] = useState(false);
  const [groups, setGroups] = useState<Chat[]>([]);

  useEffect(() => {
    if (!ready || !cid) return;
    void import('@/lib/chat').then(async (m) => {
      setLib(m);
      const c = await m.getChat(cid);
      if (!c || !c.peer) { setMissing(true); return; }
      setChat(c);
      const p = await (await import('@/lib/social')).fetchProfile(c.peer.id).catch(() => null);
      setProf(p);
      // Grupos em comum (dos que já carregaram os membros)
      const all = await m.listChats();
      const gs = await Promise.all(all.filter((x) => x.kind === 'grupo').slice(0, 20).map((x) => m.getChat(x.id)));
      setGroups(gs.filter((g): g is Chat => !!g && g.members.some((mm) => mm.id === c.peer!.id)));
    });
  }, [ready, cid]);

  if (missing || !cid) return <div><header className="flex items-center gap-2 border-b border-line bg-panel px-2 py-2"><button onClick={() => router.push('/mensagens')} className="h-11 w-9 text-2xl" aria-label="Voltar">‹</button><h1 className="text-lg font-bold">Contacto</h1></header><p className="card m-4 text-center text-sm">Contacto não encontrado.</p></div>;
  const peer = chat?.peer;
  const blocked = peer ? s.blocked.includes(peer.id) : false;
  const on = peer && lib?.isOnline(peer.id);
  const bio = prof?.bio ? (prof.bio.split('\n🔗')[0] || '').trim() : '';
  const call = async (video: boolean) => {
    const m = await import('@/lib/calls');
    if (!(await m.callsAvailable())) { toast(m.CALLS_OFF_MSG); return; }
    if (blocked) { toast('Desbloqueia para ligar.'); return; }
    router.push(`/mensagens/chamada?c=${encodeURIComponent(cid)}&v=${video ? 1 : 0}`);
  };

  return (
    <div className="min-h-[100vh] pb-16">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel px-2 py-2"><button onClick={() => router.push(`/mensagens/chat?c=${encodeURIComponent(cid)}`)} className="h-11 w-9 text-2xl" aria-label="Voltar">‹</button><h1 className="text-lg font-bold">Informação do contacto</h1></header>
      {!peer ? <div className="flex flex-col items-center gap-3 p-8"><span className="skeleton h-28 w-28 rounded-full" /><span className="skeleton h-5 w-40 rounded" /></div> : <>
        <div className="flex flex-col items-center gap-1.5 border-b border-line bg-panel px-4 pb-5 pt-6 text-center">
          <button onClick={() => setPhoto(true)} aria-label="Ver foto"><Avatar a={peer.avatar} name={peer.name} size={120} /></button>
          <p className="mt-2 text-2xl font-bold">{peer.name}{peer.verified && ' ✅'}</p>
          <p className="text-sm text-white/60">{peer.handle}</p>
          <p className={`text-xs ${on ? 'text-lime' : 'text-white/45'}`}>{on ? '● online' : lib?.lastSeenLabel(peer.lastReadAt)}</p>
          <div className="mt-3 grid w-full max-w-sm grid-cols-4 gap-2">
            <Link href={`/mensagens/chat?c=${encodeURIComponent(cid)}`} className="flex flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-xl">💬</span>Mensagem</Link>
            <button onClick={() => void call(false)} className="flex flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-xl">📞</span>Voz</button>
            <button onClick={() => void call(true)} className="flex flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-xl">📹</span>Vídeo</button>
            <Link href={`/idolo/${peer.id}`} className="flex flex-col items-center gap-1 rounded-xl bg-panel2 py-3 text-xs"><span className="text-xl">👤</span>Perfil</Link>
          </div>
        </div>
        <div className="border-b border-line bg-panel px-4 py-4">
          <p className="text-xs text-white/50">Bio</p>
          <p className="mt-1 whitespace-pre-wrap text-[15px]">{bio || <i className="text-white/40">Sem bio</i>}</p>
          {prof?.game && <p className="mt-2 text-sm text-white/60">🎮 {prof.games.join(' · ') || prof.game}{prof.team ? ` · ${prof.team}` : ''}</p>}
        </div>

        <div className="mt-2 border-y border-line bg-panel px-4 pt-3">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-panel2 p-1 text-sm">
            {([['media', 'Multimédia, links e docs'], ['favoritas', 'Favoritas']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`min-h-[40px] rounded-lg ${tab === k ? 'bg-panel font-semibold' : 'text-white/60'}`}>{l}</button>)}
          </div>
          <div className="pb-4">{tab === 'media' ? <SharedMedia conv={cid} /> : <StarredList conv={cid} />}</div>
        </div>

        {groups.length > 0 && (
          <div className="mt-2 border-y border-line bg-panel px-4 py-3">
            <p className="mb-1 text-xs text-white/50">{groups.length} grupo(s) em comum</p>
            {groups.map((g) => <Link key={g.id} href={`/mensagens/chat?c=${encodeURIComponent(g.id)}`} className="flex min-h-[56px] items-center gap-3"><Avatar a={g.photo} name={g.title} size={42} /><span className="min-w-0"><span className="block truncate font-semibold">{g.title}</span><span className="block truncate text-xs text-white/50">{g.members.map((m) => m.name.split(' ')[0]).slice(0, 5).join(', ')}</span></span></Link>)}
          </div>
        )}

        <div className="mt-2 divide-y divide-line border-y border-line bg-panel">
          <button onClick={async () => { if (!chat || !lib) return; await lib.setMuted(cid, !chat.muted); setChat({ ...chat, muted: !chat.muted }); toast(chat.muted ? 'Notificações ativadas' : 'Conversa silenciada 🔕'); }} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left"><span className="w-7 text-center text-xl">{chat?.muted ? '🔔' : '🔕'}</span>{chat?.muted ? 'Ativar notificações' : 'Silenciar notificações'}</button>
          <button onClick={() => toggleBlock(peer.id, peer.name)} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left text-red-300"><span className="w-7 text-center text-xl">🚫</span>{blocked ? `Desbloquear ${peer.name}` : `Bloquear ${peer.name}`}</button>
          <div className="flex items-center px-2 py-1 text-red-300"><MoreMenu kind="utilizador" target={peer.handle} label={`${peer.name} (mensagens)`} owner={peer.id} ownerLabel={peer.name} className="!text-xl" /><span className="text-base">Denunciar {peer.name}</span></div>
        </div>
      </>}
      <Sheet open={photo && !!peer} onClose={() => setPhoto(false)} title={peer?.name ?? ''}>
        <div className="flex justify-center"><Avatar a={peer?.avatar} name={peer?.name} size={260} /></div>
      </Sheet>
    </div>
  );
}

export default function ContactoPage() {
  return <Suspense fallback={<div className="p-6"><div className="card h-24 animate-pulse" /></div>}><Contacto /></Suspense>;
}
