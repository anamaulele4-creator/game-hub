'use client';

import { useState } from 'react';
import { CHANNELS, fmt } from '@/lib/data';
import { useStore } from '@/lib/store';
import { Page, Sheet } from '@/components/ui';

const SEED: Record<string, { who: string; text: string }[]> = {
  ch1: [{ who: 'Mário_FF', text: 'Alguém para ranqueada às 21h?' }, { who: 'Shaira', text: 'Eu! Diamante aqui 💎' }],
  ch3: [{ who: 'Dércio', text: 'Procuro squad, nível 55, Maputo' }],
};

export default function CanaisPage() {
  const { s, set, toast } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [msgs, setMsgs] = useState(SEED);
  const ch = CHANNELS.find((c) => c.id === open);
  const joinedKey = (id: string) => 'canal:' + id;
  const joined = (id: string) => s.liked.includes(joinedKey(id));
  const toggle = (id: string) => { set((p) => ({ ...p, liked: joined(id) ? p.liked.filter((x) => x !== joinedKey(id)) : [...p.liked, joinedKey(id)] })); toast(joined(id) ? 'Saíste do canal' : 'Entraste no canal 🎉'); };
  const send = () => { if (!open || !text.trim()) return; setMsgs((m) => ({ ...m, [open]: [...(m[open] ?? []), { who: s.user.name, text }] })); setText(''); };

  return (
    <Page title="Canais" back="/mais">
      <div className="space-y-2">
        {CHANNELS.map((c) => (
          <div key={c.id} className="card flex items-center gap-3 !p-3">
            <span className="text-3xl">{c.emoji}</span>
            <button className="flex-1 text-left" onClick={() => setOpen(c.id)}><p className="text-sm font-semibold">{c.name}</p><p className="text-xs text-white/60">{c.desc}</p><p className="text-[11px] text-white/40">{fmt(c.members + (joined(c.id) ? 1 : 0))} membros · {c.topic}</p></button>
            <button className={joined(c.id) ? 'btn-ghost !px-3 !py-1 text-xs' : 'btn !px-3 !py-1 text-xs'} onClick={() => toggle(c.id)}>{joined(c.id) ? 'Membro' : 'Entrar'}</button>
          </div>
        ))}
      </div>
      <Sheet open={!!ch} onClose={() => setOpen(null)} title={ch ? `${ch.emoji} ${ch.name}` : ''}>
        <div className="mb-3 min-h-[30vh] space-y-2 text-sm">
          {(msgs[open ?? ''] ?? []).map((m, k) => <p key={k}><b className="text-neon">{m.who}:</b> {m.text}</p>)}
          {!(msgs[open ?? '']?.length) && <p className="text-white/50">Sem mensagens. Começa a conversa!</p>}
        </div>
        {open && joined(open) ? (
          <div className="flex gap-2"><input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Mensagem…" /><button className="btn" onClick={send}>➤</button></div>
        ) : <button className="btn w-full" onClick={() => open && toggle(open)}>Entrar para conversar</button>}
      </Sheet>
    </Page>
  );
}
