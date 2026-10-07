'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { CLIPS, IDOLS, Idol, Live, REACTIONS, Tournament, fmt, idol, mzn } from '@/lib/data';
import { MoreMenu } from './Moderation';
import { IS_DEMO } from '@/lib/config';

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="GAME HUB">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b14dff" />
          <stop offset="1" stopColor="#00e5ff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#140c24" stroke="url(#lg)" strokeWidth="3" />
      <path d="M18 26c0-4 3-7 7-7h14c4 0 7 3 7 7v10c0 5-4 9-8 9-3 0-4-2-6-4c-2 2-3 4-6 4-4 0-8-4-8-9z" fill="url(#lg)" />
      <rect x="22" y="28" width="8" height="2.6" rx="1.3" fill="#140c24" />
      <rect x="24.7" y="25.3" width="2.6" height="8" rx="1.3" fill="#140c24" />
      <circle cx="39" cy="27.5" r="1.9" fill="#140c24" />
      <circle cx="42.5" cy="31" r="1.9" fill="#140c24" />
    </svg>
  );
}

export function TopBar({ title, back }: { title?: string; back?: string }) {
  const { s } = useStore();
  const unread = s.notifs.filter((n) => !n.read).length;
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur">
      {back ? (
        <Link href={back} className="mr-1 rounded-full bg-panel2 px-3 py-1 text-lg" aria-label="Voltar">‹</Link>
      ) : (
        <Link href="/" className="flex items-center gap-2"><Logo size={30} /></Link>
      )}
      <div className="flex-1 truncate">
        {title ? <h1 className="truncate text-lg font-bold">{title}</h1> : (
          <span className="bg-gradient-to-r from-neon to-neon2 bg-clip-text text-lg font-black tracking-wider text-transparent">GAME HUB</span>
        )}
      </div>
      <Link href="/pesquisa" className="rounded-full bg-panel2 p-2 text-sm" aria-label="Pesquisar">🔍</Link>
      <Link href="/notificacoes" className="relative rounded-full bg-panel2 p-2 text-sm" aria-label="Notificações">
        🔔
        {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-pink px-1.5 text-[10px] font-bold">{unread}</span>}
      </Link>
      <Link href="/mais" className="rounded-full bg-panel2 p-2 text-sm" aria-label="Menu">☰</Link>
    </header>
  );
}

const TABS = [
  { href: '/', label: 'Início', icon: '🏠' },
  { href: '/clipes', label: 'Clipes', icon: '🎬' },
  { href: '/torneios', label: 'Torneios', icon: '🏆' },
  { href: '/lives', label: 'Lives', icon: '📡' },
  { href: '/perfil', label: 'Perfil', icon: '👤' },
];

export function BottomNav() {
  const path = usePathname() || '/';
  const p = path.replace(BASE, '') || '/';
  return (
    <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 justify-around border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {TABS.map((t) => {
        const active = t.href === '/' ? p === '/' : p.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`flex flex-1 flex-col items-center py-2 text-[11px] ${active ? 'text-neon' : 'text-white/60'}`}>
            <span className={`text-xl ${active ? 'drop-shadow-[0_0_8px_#b14dff]' : ''}`}>{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Overlays() {
  const { toastMsg, wellbeingAlert, dismissAlert, nightNow } = useStore();
  return (
    <>
      {toastMsg && (
        <div className="fixed left-1/2 top-16 z-[70] w-[90%] max-w-sm -translate-x-1/2 rounded-xl border border-neon/50 bg-panel2 px-4 py-3 text-center text-sm shadow-neon">{toastMsg}</div>
      )}
      {wellbeingAlert && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-neon2/40 bg-panel p-6 text-center shadow-cyan">
            <div className="mb-2 text-4xl">🧘</div>
            <p className="mb-4">{wellbeingAlert}</p>
            <div className="flex gap-2">
              <Link href="/bem-estar" onClick={dismissAlert} className="btn-ghost flex-1">Bem-estar</Link>
              <button onClick={dismissAlert} className="btn flex-1">Ok, obrigado</button>
            </div>
          </div>
        </div>
      )}
      {nightNow && (
        <div className="fixed left-0 right-0 top-0 z-[60] mx-auto max-w-md bg-indigo-900/90 py-1 text-center text-[11px]">🌙 Silêncio noturno ativo: notificações em pausa</div>
      )}
    </>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-neon/40 bg-panel p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-white/20" />
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-full bg-panel2 px-3 py-1" aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function shareUrl(path: string) {
  if (typeof window === 'undefined') return path;
  return window.location.origin + BASE + path;
}

export function ShareSheet({ open, onClose, path, text, target }: { open: boolean; onClose: () => void; path: string; text: string; target: string }) {
  const { share, toast } = useStore();
  const url = shareUrl(path);
  const msg = encodeURIComponent(`${text} ${url}`);
  const done = () => { share(target); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Partilhar">
      <div className="grid grid-cols-4 gap-3 text-center text-xs">
        <button onClick={async () => { try { await navigator.clipboard.writeText(url); } catch {} toast('Link copiado 🔗'); done(); }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-panel2 p-4 text-2xl">🔗</span>Copiar link</button>
        <a href={`https://wa.me/?text=${msg}`} target="_blank" rel="noreferrer" onClick={done} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-green-600/80 p-4 text-2xl">💬</span>WhatsApp</a>
        <button onClick={async () => { try { await navigator.clipboard.writeText(url); } catch {} toast('Link copiado. Cola nos Stories do Instagram 📸'); window.open('https://www.instagram.com/', '_blank'); done(); }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-gradient-to-br from-yellow-500 via-pink-600 to-purple-700 p-4 text-2xl">📸</span>Instagram</button>
        <button onClick={async () => {
          const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
          if (nav.share) { try { await nav.share({ title: 'GAME HUB', text, url }); } catch {} } else toast('Partilha nativa indisponível neste navegador');
          done();
        }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-panel2 p-4 text-2xl">📤</span>Mais</button>
      </div>
      <p className="mt-4 break-all rounded-lg bg-panel2 p-2 text-[11px] text-white/60">{url}</p>
    </Sheet>
  );
}

export function CommentsSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: string }) {
  const { s, addComment, toggleLike } = useStore();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const list = (s.comments[target] ?? []).filter((c) => !s.admin.removed.includes(c.id) && !s.blocked.includes(c.author)).map((c) => ({ ...c, replies: c.replies.filter((r) => !s.admin.removed.includes(r.id) && !s.blocked.includes(r.author)) }));
  const off = s.admin.settings.features.comentarios === false;
  const submit = () => {
    if (!text.trim()) return;
    addComment(target, text.trim(), replyTo ?? undefined);
    setText('');
    setReplyTo(null);
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Comentários (${list.reduce((a, c) => a + 1 + c.replies.length, 0)})`}>
      <div className="space-y-4">
        {list.length === 0 && <p className="text-center text-sm text-white/50">Sê o primeiro a comentar 💬</p>}
        {list.map((c) => (
          <div key={c.id}>
            <div className="flex gap-2">
              <span className="text-2xl">{c.avatar}</span>
              <div className="flex-1">
                <div className="flex items-center justify-between"><p className="text-xs font-semibold text-white/70">{c.author}</p>{c.author !== s.user.name && <MoreMenu kind="comentário" target={c.id} label={`“${c.text.slice(0, 40)}”`} owner={c.author} ownerLabel={c.author} className="!text-sm" />}</div>
                <p className="text-sm">{c.text}</p>
                <div className="mt-1 flex gap-4 text-xs text-white/50">
                  <button onClick={() => toggleLike('cm:' + c.id)} className={s.liked.includes('cm:' + c.id) ? 'text-pink' : ''}>❤️ {c.likes + (s.liked.includes('cm:' + c.id) ? 1 : 0)}</button>
                  <button onClick={() => setReplyTo(c.id)}>Responder</button>
                </div>
              </div>
            </div>
            {c.replies.map((r) => (
              <div key={r.id} className="ml-10 mt-2 flex gap-2 border-l border-line pl-3">
                <span className="text-xl">{r.avatar}</span>
                <div><p className="text-xs font-semibold text-white/70">{r.author}</p><p className="text-sm">{r.text}</p></div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 mt-4 bg-panel pt-2">
        {replyTo && <p className="mb-1 text-xs text-neon2">A responder a {list.find((c) => c.id === replyTo)?.author} · <button onClick={() => setReplyTo(null)} className="underline">cancelar</button></p>}
        {off ? <p className="text-center text-xs text-white/50">Comentários desativados temporariamente.</p> : <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Escreve um comentário respeitoso…" className="input flex-1" />
          <button onClick={submit} className="btn">Enviar</button>
        </div>}
      </div>
    </Sheet>
  );
}

export function ReactionBar({ target }: { target: string }) {
  const { s, react } = useStore();
  const mine = s.reactions[target];
  return (
    <div className="flex gap-1">
      {REACTIONS.map((r) => (
        <button key={r} onClick={() => react(target, r)} className={`rounded-full px-2 py-1 text-lg transition ${mine === r ? 'scale-110 bg-neon/30 shadow-neon' : 'bg-panel2'}`} aria-label={`Reagir ${r}`}>{r}</button>
      ))}
    </div>
  );
}

export function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">{title}</h2>
        {href && <Link href={href} className="text-xs text-neon2">Ver tudo ›</Link>}
      </div>
      {children}
    </section>
  );
}

export function FollowButton({ idolId, small }: { idolId: string; small?: boolean }) {
  const { s, toggleFollow } = useStore();
  const f = s.following.includes(idolId);
  return (
    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFollow(idolId); }} className={`${f ? 'btn-ghost' : 'btn'} ${small ? '!px-3 !py-1 text-xs' : ''}`}>
      {f ? 'A seguir ✓' : 'Seguir'}
    </button>
  );
}

export function Verified() {
  return <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-neon2 text-[10px] text-black" title="Verificado">✓</span>;
}

export function IdolChip({ i }: { i: Idol }) {
  return (
    <Link href={`/idolo/${i.id}`} className="flex w-20 shrink-0 flex-col items-center gap-1">
      <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 text-3xl" style={{ borderColor: i.color, boxShadow: `0 0 12px ${i.color}` }}>{i.avatar}</span>
      <span className="w-full truncate text-center text-xs">{i.name}</span>
    </Link>
  );
}

export function LiveCard({ l, big }: { l: Live; big?: boolean }) {
  const i = idol(l.idolId);
  return (
    <Link href={`/lives/${l.id}`} className={`relative block overflow-hidden rounded-2xl bg-gradient-to-br ${l.gradient} bg-[length:200%_200%] animate-gradientMove ${big ? 'h-52' : 'h-36 w-56 shrink-0'}`}>
      <span className="absolute left-3 top-3 animate-pulseGlow rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold">AO VIVO</span>
      <span className="absolute right-3 top-3 rounded bg-black/50 px-2 py-0.5 text-[10px]">👁 {fmt(l.viewers)}</span>
      <span className="absolute inset-0 flex items-center justify-center text-6xl opacity-70">{i.avatar}</span>
      <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 p-3">
        <p className="truncate text-sm font-semibold">{l.title}</p>
        <p className="text-xs text-white/70">{i.name} · {l.game}</p>
      </div>
    </Link>
  );
}

export function ClipThumb({ id }: { id: string }) {
  const c = CLIPS.find((x) => x.id === id)!;
  const i = idol(c.idolId);
  return (
    <Link href={`/clipe/${c.id}`} className={`relative block aspect-[9/14] overflow-hidden rounded-xl bg-gradient-to-br ${c.gradient}`}>
      <span className="absolute inset-0 flex items-center justify-center text-4xl">{c.emoji}</span>
      <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 p-2">
        <p className="truncate text-xs font-semibold">{c.title}</p>
        <p className="text-[10px] text-white/70">{i.name} · ▶ {fmt(c.views)}</p>
      </div>
    </Link>
  );
}

export function TournamentCard({ t }: { t: Tournament }) {
  const { s } = useStore();
  const joined = s.entries.includes(t.id);
  return (
    <Link href={`/torneios/${t.id}`} className="card block overflow-hidden !p-0">
      <div className={`flex h-20 items-center justify-between bg-gradient-to-r ${t.gradient} px-4`}>
        <span className="text-3xl">🏆</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.fee === 0 ? 'bg-lime text-black' : 'bg-amber-400 text-black'}`}>{t.fee === 0 ? 'GRÁTIS' : `ENTRADA ${mzn(t.fee)}`}</span>
      </div>
      <div className="p-3">
        <p className="font-semibold">{t.name}</p>
        <p className="text-xs text-white/60">{t.game} · {t.mode} · {t.date}</p>
        <div className="mt-2 h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-neon" style={{ width: `${(t.filled / t.slots) * 100}%` }} /></div>
        <div className="mt-1 flex justify-between text-[11px] text-white/60">
          <span>{t.filled}/{t.slots} vagas</span>
          <span>Prémio {mzn(t.prize)}</span>
        </div>
        {joined && <p className="mt-1 text-xs text-lime">✓ Estás inscrito</p>}
        {t.status !== 'aberto' && <p className="mt-1 text-xs text-amber-300">{t.status === 'a decorrer' ? '⏱ A decorrer' : 'Terminado'}</p>}
      </div>
    </Link>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)} className={`shrink-0 rounded-full px-4 py-1.5 text-sm ${value === t ? 'bg-neon text-white shadow-neon' : 'bg-panel2 text-white/70'}`}>{t}</button>
      ))}
    </div>
  );
}

export function Page({ title, back, children, noPad }: { title?: string; back?: string; children: React.ReactNode; noPad?: boolean }) {
  return (
    <>
      <TopBar title={title} back={back} />
      <main className={noPad ? '' : 'px-4 pb-28 pt-4'}>{children}</main>
    </>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-panel2 p-3 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[11px] text-white/60">{label}</p>
    </div>
  );
}

export function DemoBanner() {
  if (!IS_DEMO) return null;
  return <p className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-center text-[11px] text-amber-200">Modo demonstração: nenhum pagamento é cobrado.</p>;
}

export function allIdols() { return IDOLS; }
