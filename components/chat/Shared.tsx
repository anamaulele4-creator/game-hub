'use client';

// Multimédia, documentos e links partilhados numa conversa + mensagens favoritas.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ChatMsg, Star } from '@/lib/chat';

export function SharedMedia({ conv }: { conv: string }) {
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [tab, setTab] = useState<'media' | 'docs' | 'links'>('media');
  const [view, setView] = useState('');
  useEffect(() => {
    let alive = true;
    void import('@/lib/chat').then((m) => m.loadMessages(conv, { limit: 400 })).then((l) => { if (alive) setMsgs(l.filter((x) => !x.deleted)); }).catch(() => setMsgs([]));
    return () => { alive = false; };
  }, [conv]);
  const media = (msgs ?? []).filter((m) => m.meta.file && /^(image|video)\//.test(m.meta.file.mime)).reverse();
  const docs = (msgs ?? []).filter((m) => m.meta.file && !/^(image|video)\//.test(m.meta.file.mime) && m.kind !== 'voz').reverse();
  const links = (msgs ?? []).flatMap((m) => (m.body.match(/https?:\/\/\S+/g) ?? []).map((u) => ({ u, m }))).reverse();
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-panel2 p-1 text-sm">
        {([['media', `Multimédia ${media.length || ''}`], ['docs', `Docs ${docs.length || ''}`], ['links', `Links ${links.length || ''}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`min-h-[40px] rounded-lg ${tab === k ? 'bg-panel font-semibold' : 'text-white/60'}`}>{l}</button>
        ))}
      </div>
      {msgs === null ? <div className="grid grid-cols-3 gap-1">{[0, 1, 2].map((i) => <span key={i} className="skeleton aspect-square rounded" />)}</div> : (
        tab === 'media' ? (media.length ? (
          <div className="grid grid-cols-3 gap-1">
            {media.map((m) => m.meta.file!.mime.startsWith('image/')
              ? <button key={m.id} onClick={() => setView(m.meta.file!.url)} className="aspect-square overflow-hidden rounded bg-panel2"><img src={m.meta.file!.url} alt="" loading="lazy" className="h-full w-full object-cover" /></button>
              : <a key={m.id} href={m.meta.file!.url} target="_blank" rel="noopener noreferrer" className="relative flex aspect-square items-center justify-center overflow-hidden rounded bg-panel2"><video src={m.meta.file!.url + '#t=0.5'} preload="metadata" muted className="h-full w-full object-cover" /><span className="absolute text-2xl">▶</span></a>)}
          </div>
        ) : <p className="py-6 text-center text-sm text-white/50">Sem fotos ou vídeos partilhados.</p>)
        : tab === 'docs' ? (docs.length ? docs.map((m) => (
          <a key={m.id} href={m.meta.file!.url} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-3 rounded-xl bg-panel2 p-3"><span className="text-2xl">📄</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{m.meta.file!.name}</span><span className="text-xs text-white/50">{new Date(m.createdAt).toLocaleDateString('pt-PT')}</span></span></a>
        )) : <p className="py-6 text-center text-sm text-white/50">Sem documentos.</p>)
        : (links.length ? links.map(({ u, m }, i) => (
          <a key={m.id + i} href={u} target="_blank" rel="noopener noreferrer nofollow" className="mb-1 block truncate rounded-xl bg-panel2 p-3 text-sm text-neon2">🔗 {u}</a>
        )) : <p className="py-6 text-center text-sm text-white/50">Sem links.</p>)
      )}
      {view && <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black" onClick={() => setView('')}><img src={view} alt="" className="max-h-full max-w-full object-contain" /></div>}
    </div>
  );
}

export function StarredList({ conv }: { conv: string }) {
  const [list, setList] = useState<Star[] | null>(null);
  useEffect(() => { void import('@/lib/chat').then((m) => setList(m.stars().filter((x) => x.conv === conv))); }, [conv]);
  if (!list) return null;
  if (!list.length) return <p className="py-6 text-center text-sm text-white/50">⭐ Sem mensagens favoritas. Mantém premida uma mensagem e toca em “Marcar como favorita”.</p>;
  return (
    <ul className="space-y-1">
      {list.map((s) => (
        <li key={s.id}><Link href={`/mensagens/chat?c=${encodeURIComponent(conv)}`} className="block rounded-xl bg-panel2 p-3"><span className="block text-xs text-white/50">⭐ {s.from} · {new Date(s.at).toLocaleDateString('pt-PT')}</span><span className="line-clamp-2 text-sm">{s.text}</span></Link></li>
      ))}
    </ul>
  );
}
