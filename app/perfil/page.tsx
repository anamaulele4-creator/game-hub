'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ACHIEVEMENTS, CLIPS, Clip, IDOLS, divisionFor, levelFor, mzn } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { ClipGrid } from '@/components/ClipGrid';
import { AvatarEditor } from '@/components/AvatarEditor';
import { useStore } from '@/lib/store';
import { Page, Stat, AvatarFace } from '@/components/ui';

export default function PerfilPage() {
  const { s, set, toast } = useStore();
  const d = divisionFor(s.xp);
  const lv = levelFor(s.xp);
  const [edit, setEdit] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [bio, setBio] = useState(s.user.bio);
  const [mine, setMine] = useState<Clip[] | null>(null);
  useEffect(() => {
    if (IS_DEMO) { setMine(CLIPS.filter((c) => c.idolId === 'me')); return; }
    let alive = true;
    void import('@/lib/clips').then((m) => m.myClips()).then((l) => { if (alive) setMine(l); }).catch(() => { if (alive) setMine([]); });
    return () => { alive = false; };
  }, [s.account.loggedIn]);

  const links = [
    ['/missoes', '🎯', 'Missões, XP e sequência'], ['/conquistas', '🏅', 'Conquistas'], ['/ranking', '📊', 'Ranking semanal'],
    ['/desafios', '⚔️', 'Desafios'], ['/guardados', '🔖', 'Meus Guardados'], ['/bem-estar', '🧘', 'Bem-estar'],
    ['/planos', '👑', 'Planos'], ['/definicoes', '⚙️', 'Definições'], ['/admin', '🛠️', 'Painel de administração'],
  ];

  return (
    <Page title="Perfil">
      <div className="card mb-4 text-center">
        <button type="button" onClick={() => setPhoto(true)} aria-label="Mudar foto de perfil" className="relative mx-auto mb-2 block h-24 w-24">
          <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-neon text-5xl"><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>
          <span className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-bg bg-neon text-base">📷</span>
        </button>
        <p className="text-xl font-bold">{s.user.name} {s.plans.includes('premium') && '👑'}</p>
        <p className="text-xs text-white/60">{s.user.handle} · {s.user.role === 'admin' ? 'Administradora' : 'Jogador'}</p>
        <button type="button" onClick={() => setPhoto(true)} className="btn-ghost mx-auto mt-3 min-h-[2.75rem] px-5 text-sm">✏️ Editar perfil · foto</button>
        {edit ? (
          <div className="mt-2 flex gap-2"><input className="input flex-1" value={bio} onChange={(e) => setBio(e.target.value)} /><button className="btn" onClick={() => { set((p) => ({ ...p, user: { ...p.user, bio } })); setEdit(false); toast('Bio atualizada'); }}>OK</button></div>
        ) : (
          <p className="mt-2 text-sm">{s.user.bio} <button onClick={() => setEdit(true)} className="text-xs text-neon2">editar</button></p>
        )}
        <div className="mt-4">
          <div className="flex justify-between text-xs"><span style={{ color: d.color }}>{d.emoji} {d.name} · Nível {lv.level}</span><span>{s.xp} XP</span></div>
          <div className="mt-1 h-2 rounded bg-panel2"><div className="h-2 rounded bg-gradient-to-r from-neon to-neon2" style={{ width: `${lv.pct}%` }} /></div>
          {d.next && <p className="mt-1 text-xs text-white/50">Faltam {d.next.minXp - s.xp} XP para {d.next.emoji} {d.next.name}</p>}
        </div>
      </div>
      <div className="mb-4 grid grid-cols-4 gap-2">
        <Stat label="Sequência" value={`🔥${s.streak}`} />
        <Stat label="A seguir" value={s.following.length} />
        <Stat label="Conquistas" value={`${s.achievements.length}/${ACHIEVEMENTS.length}`} />
        <Stat label="Moedas" value={`🪙${s.coins}`} />
      </div>

      <AvatarEditor open={photo} onClose={() => setPhoto(false)} />
      <h3 className="mb-2 font-bold">🎞️ As minhas publicações</h3>
      <div className="mb-5"><ClipGrid clips={mine ?? []} loading={mine === null} mine /></div>

      <h3 className="mb-2 font-bold">Os teus ídolos</h3>
      <div className="no-scrollbar mb-4 flex gap-3 overflow-x-auto">
        {IDOLS.filter((i) => s.following.includes(i.id)).map((i) => <Link key={i.id} href={`/idolo/${i.id}`} className="flex flex-col items-center text-xs"><span className="text-3xl"><AvatarFace a={i.avatar} name={i.name} /></span>{i.name}</Link>)}
      </div>

      <div className="card mb-4 !p-0">
        {links.map(([h, e, l]) => <Link key={h} href={h} className="flex items-center gap-3 border-b border-line p-3 last:border-0"><span className="text-xl">{e}</span><span className="flex-1 text-sm">{l}</span><span className="text-white/40">›</span></Link>)}
      </div>

      <h3 className="mb-2 font-bold">💳 Planos ativos</h3>
      <div className="card mb-4 space-y-2 text-sm">
        {s.plans.length === 0 && <p className="text-white/60">Plano grátis. <Link href="/planos" className="text-neon2">Ver planos</Link></p>}
        {s.plans.map((p) => (
          <div key={p} className="flex items-center justify-between"><span className="capitalize">{p}</span>
            <button className="text-xs text-pink underline" onClick={() => { set((x) => ({ ...x, plans: x.plans.filter((y) => y !== p) })); toast('Plano cancelado. Sem custos adicionais.'); }}>Cancelar</button></div>
        ))}
      </div>

      <h3 className="mb-2 font-bold">🎟️ Bilhetes</h3>
      <div className="card mb-4 space-y-2 text-sm">
        {s.tickets.length === 0 && <p className="text-white/60">Sem bilhetes. <Link href="/eventos" className="text-neon2">Ver eventos</Link></p>}
        {s.tickets.map((t) => { const e = s.admin.events.find((x) => x.id === t.eventId); return <div key={t.id} className="flex justify-between"><span>{e?.emoji ?? '🎟️'} {e?.name ?? 'Evento'} · {t.tier} × {t.qty}</span><span className="font-mono text-[11px] text-neon2">#{t.id.slice(-6)}</span></div>; })}
      </div>

      <h3 className="mb-2 font-bold">🧾 Compras</h3>
      <div className="card space-y-2 text-sm">
        {s.purchases.length === 0 && <p className="text-white/60">Nenhuma compra ainda.</p>}
        {s.purchases.map((p) => (
          <div key={p.id} className="flex items-center justify-between">
            <div><p>{p.item}</p><p className="text-xs text-white/50">{p.date} · {p.method} · {p.status === 'cancelado' ? 'cancelado / reembolsado' : 'demo: não cobrado'}</p></div>
            <div className="text-right"><p className="font-semibold">{mzn(p.total)}</p>
              {p.status !== 'cancelado' && <button className="text-xs text-pink underline" onClick={() => { set((x) => ({ ...x, purchases: x.purchases.map((y) => (y.id === p.id ? { ...y, status: 'cancelado' } : y)) })); toast('Compra cancelada'); }}>Cancelar</button>}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
