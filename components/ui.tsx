'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { CLIPS, Clip, IDOLS, Idol, Live, REACTIONS, Tournament, fmt, idol, mzn } from '@/lib/data';
import { TYPE_ICON, clipType, fmtDuration, videoHref } from '@/lib/feed';
import { moderate, recordModeration } from '@/lib/poipakAI';
import { MoreMenu } from './Moderation';
import { IS_DEMO } from '@/lib/config';
import { isAuthRoute } from '@/lib/routes';
import { PublishSheet } from './PublishSheet';

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Logótipo da app (ícone POIPAK: coroa + comando). Tamanho fixo para não "saltar" ao carregar. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}/icons/icon-192.png`} width={size} height={size} alt="POIPAK" decoding="async"
      className="shrink-0 rounded-[22%] bg-panel2 object-cover" style={{ width: size, height: size }} />
  );
}

/** Avatar é uma imagem (foto de perfil) e não um emoji? */
export const isImgAvatar = (a?: string | null) => !!a && /^(https?:\/\/|data:image\/|blob:)/i.test(a);

/** Conteúdo de um avatar: foto (avatar_url) com recurso a emoji ou inicial do nome se falhar. */
export function AvatarFace({ a, name, fill }: { a?: string | null; name?: string; fill?: boolean }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [a]);
  if (isImgAvatar(a) && !bad) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={a!} alt={name ? `Foto de ${name}` : ''} loading="lazy" decoding="async" onError={() => setBad(true)}
      className={fill ? 'h-full w-full rounded-full object-cover' : 'inline-block h-[1.15em] w-[1.15em] rounded-full object-cover align-middle'} />;
  }
  const txt = !a || isImgAvatar(a) ? ((name ?? '').trim().charAt(0).toUpperCase() || '🙂') : a;
  return <>{txt}</>;
}

/** Avatar redondo de tamanho fixo. */
export function Avatar({ a, name, size = 40, className = '' }: { a?: string | null; name?: string; size?: number; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel2 ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}>
      <AvatarFace a={a} name={name} fill />
    </span>
  );
}

export function TopBar({ title, back }: { title?: string; back?: string }) {
  const { s, ready } = useStore();
  const unread = s.notifs.filter((n) => !n.read).length;
  const [dm, setDm] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const tick = () => import('@/lib/dm').then((m) => m.unreadTotal()).then((n) => { if (alive) setDm(n); }).catch(() => {});
    const t = setTimeout(tick, 1500);
    const iv = setInterval(tick, 60000);
    return () => { alive = false; clearTimeout(t); clearInterval(iv); };
  }, [ready, s.account.loggedIn]);
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-3">
      {back ? (
        <Link href={back} className="mr-1 rounded-full bg-panel2 px-3 py-1 text-lg" aria-label="Voltar">‹</Link>
      ) : (
        <Link href="/" className="flex items-center gap-2"><Logo size={30} /></Link>
      )}
      <div className="flex-1 truncate">
        {title ? <h1 className="truncate text-lg font-bold">{title}</h1> : (
          <span className="text-lg font-extrabold tracking-wide text-white">POIPAK</span>
        )}
      </div>
      {(IS_DEMO || s.account.loggedIn) && <>
      <Link href="/mensagens" className="relative rounded-full bg-panel2 p-2 text-sm" aria-label="Mensagens">
        💬
        {dm > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-pink px-1.5 text-[11px] font-bold">{dm}</span>}
      </Link>
      <Link href="/notificacoes" className="relative rounded-full bg-panel2 p-2 text-sm" aria-label="Notificações">
        🔔
        {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-pink px-1.5 text-[11px] font-bold">{unread}</span>}
      </Link>
      <Link href="/mais" className="rounded-full bg-panel2 p-2 text-sm" aria-label="Menu">☰</Link>
      </>}
    </header>
  );
}

const TABS = [
  { href: '/', label: 'Início', icon: '🏠' },
  { href: '/explorar', label: 'Explorar', icon: '🔍' },
  { href: '/publicar', label: 'Publicar', icon: '+' },
  { href: '/clipes', label: 'Clipes', icon: '🎬' },
  { href: '/perfil', label: 'Perfil', icon: '👤' },
];
// Secções que pertencem a um separador (para o ícone ficar ativo)
const EXPLORE = ['/explorar', '/pesquisa', '/lives', '/torneios', '/videos', '/idolos', '/ranking', '/eventos', '/canais', '/escola', '/mais'];

export function BottomNav() {
  const path = usePathname() || '/';
  const p = path.replace(BASE, '') || '/';
  const { s } = useStore();
  const [pub, setPub] = useState(false);
  if (isAuthRoute(path) || (!IS_DEMO && !s.account.loggedIn) || p.startsWith('/mensagens/chat')) return null;
  const isActive = (h: string) => h === '/' ? p === '/' : h === '/explorar' ? EXPLORE.some((x) => p.startsWith(x)) : p.startsWith(h);
  return (
    <>
    <PublishSheet open={pub} onClose={() => setPub(false)} />
    <nav aria-label="Navegação principal" className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 justify-around border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)]">
      {TABS.map((t) => {
        const active = isActive(t.href);
        if (t.href === '/publicar') return (
          <button key={t.href} type="button" onClick={() => setPub(true)} aria-label="Publicar" aria-haspopup="dialog" className="flex min-h-[52px] flex-1 flex-col items-center justify-center">
            <span className={`flex h-8 w-11 items-center justify-center rounded-xl border-2 text-2xl font-bold leading-none ${pub ? 'border-neon bg-neon text-white' : 'border-white/80 text-white'}`}>+</span>
          </button>
        );
        if (t.href === '/perfil') return (
          <Link key={t.href} href={t.href} aria-label="Perfil" aria-current={active ? 'page' : undefined} className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5">
            <span className={`flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-panel2 text-base ${active ? 'ring-2 ring-white' : 'opacity-90'}`}><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>
            <span className={`text-[10px] leading-none ${active ? 'text-white' : 'text-white/55'}`}>{t.label}</span>
          </Link>
        );
        return (
          <Link key={t.href} href={t.href} aria-label={t.label} aria-current={active ? 'page' : undefined} className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5">
            <span className={`text-[22px] leading-7 ${active ? '' : 'opacity-60 grayscale'}`}>{t.icon}</span>
            <span className={`text-[10px] leading-none ${active ? 'text-white' : 'text-white/55'}`}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}

export function Overlays() {
  const { toastMsg, wellbeingAlert, dismissAlert, nightNow } = useStore();
  return (
    <>
      {toastMsg && (
        <div className="fixed left-1/2 top-16 z-[70] w-[90%] max-w-sm -translate-x-1/2 rounded-xl border border-neon/50 bg-panel2 px-4 py-3 text-center text-sm">{toastMsg}</div>
      )}
      {wellbeingAlert && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-neon2/40 bg-panel p-6 text-center">
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
        <div className="fixed left-0 right-0 top-0 z-[60] mx-auto max-w-md bg-indigo-900/90 py-1 text-center text-xs">🌙 Silêncio noturno ativo: notificações em pausa</div>
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
        <button onClick={async () => { try { await navigator.clipboard.writeText(url); } catch {} toast('Link copiado. Cola nos Stories do Instagram 📸'); window.open('https://www.instagram.com/', '_blank'); done(); }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-gradient-to-br from-yellow-500 via-slate-600 to-slate-700 p-4 text-2xl">📸</span>Instagram</button>
        <button onClick={async () => {
          const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
          if (nav.share) { try { await nav.share({ title: 'Social POIPAK', text, url }); } catch {} } else toast('Partilha nativa indisponível neste navegador');
          done();
        }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-panel2 p-4 text-2xl">📤</span>Mais</button>
      </div>
      <p className="mt-4 break-all rounded-lg bg-panel2 p-2 text-xs text-white/60">{url}</p>
    </Sheet>
  );
}

export function CommentsSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: string }) {
  const { s, addComment, toggleLike, toast } = useStore();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const list = (s.comments[target] ?? []).filter((c) => !s.admin.removed.includes(c.id) && !s.blocked.includes(c.author)).map((c) => ({ ...c, replies: c.replies.filter((r) => !s.admin.removed.includes(r.id) && !s.blocked.includes(r.author)) }));
  const off = s.admin.settings.features.comentarios === false;
  const submit = () => {
    if (!text.trim()) return;
    // POIPAK IA: bloqueia abuso claro, avisa com gentileza em linguagem rude
    const m = moderate(text);
    if (m.level !== 'ok') recordModeration(m, 'comentário', text);
    if (m.level === 'block') { toast(`🛡️ ${m.tip}`); return; }
    if (m.level === 'warn') toast(`💬 ${m.tip}`);
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
              <span className="text-2xl"><AvatarFace a={c.avatar} name={c.author} /></span>
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
                <span className="text-xl"><AvatarFace a={r.avatar} name={r.author} /></span>
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
        <button key={r} onClick={() => react(target, r)} className={`rounded-full px-2 py-1 text-lg transition ${mine === r ? 'scale-110 bg-neon/30' : 'bg-panel2'}`} aria-label={`Reagir ${r}`}>{r}</button>
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
  return <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-neon2 text-[11px] text-black" title="Verificado">✓</span>;
}

export function IdolChip({ i }: { i: Idol }) {
  return (
    <Link href={`/idolo/${i.id}`} className="flex w-20 shrink-0 flex-col items-center gap-1">
      <span className="overflow-hidden flex h-16 w-16 items-center justify-center rounded-full border-2 text-3xl" style={{ borderColor: i.color }}><AvatarFace a={i.avatar} name={i.name} fill /></span>
      <span className="w-full truncate text-center text-xs">{i.name}</span>
    </Link>
  );
}

export function LiveCard({ l, big }: { l: Live; big?: boolean }) {
  const i = idol(l.idolId);
  return (
    <Link href={`/lives/${l.id}`} className={`relative block overflow-hidden rounded-2xl bg-gradient-to-br ${l.gradient} ${big ? 'h-52' : 'h-36 w-56 shrink-0'}`}>
      <span className="absolute left-3 top-3 rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold">AO VIVO</span>
      <span className="absolute right-3 top-3 rounded bg-black/50 px-2 py-0.5 text-[11px]">👁 {fmt(l.viewers)}</span>
      <span className="absolute inset-0 flex items-center justify-center text-6xl opacity-70"><AvatarFace a={i.avatar} name={i.name} /></span>
      <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 p-3">
        <p className="truncate text-sm font-semibold">{l.title}</p>
        <p className="text-xs text-white/70">{i.name} · {l.game}</p>
      </div>
    </Link>
  );
}

/** Miniatura de um clipe com caixa de proporção fixa (nada salta ao carregar) e aspeto por tipo: vídeo, vídeo longo, meme, foto, momento. */
export function ClipThumb({ id, c: given, className = '', wide }: { id?: string; c?: Clip; className?: string; wide?: boolean }) {
  const c = given ?? CLIPS.find((x) => x.id === id);
  const [loaded, setLoaded] = useState(false);
  if (!c) return null;
  const i = idol(c.idolId);
  const t = clipType(c);
  const img = c.thumb || c.image;
  const href = t === 'long' ? videoHref(c.id) : `/clipe/${c.id}`;
  const box = wide ? 'aspect-video' : 'aspect-[9/14]';
  return (
    <Link href={href} className={`relative block ${box} overflow-hidden rounded-xl bg-gradient-to-br ${c.gradient} ${className}`}>
      {t === 'text' ? (
        <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs font-bold leading-tight line-clamp-6">{c.title}</span>
      ) : img ? (
        <>
          {!loaded && <span className="skeleton absolute inset-0" aria-hidden />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)}
            className={`absolute inset-0 h-full w-full ${t === 'meme' || t === 'photo' ? 'bg-black object-contain' : 'object-cover'} transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`} />
        </>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-4xl">{t === 'video' ? c.emoji : TYPE_ICON[t]}</span>
      )}
      <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold">{t === 'meme' ? '😂 Meme' : t === 'long' ? '📺' : TYPE_ICON[t]}</span>
      {c.duration ? <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1 text-[11px]">{fmtDuration(c.duration)}</span> : null}
      <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 p-2">
        {t !== 'text' && <p className="truncate text-xs font-semibold">{c.title}</p>}
        <p className="truncate text-[11px] text-white/70">{i.name} · ▶ {fmt(c.views)}</p>
      </div>
    </Link>
  );
}

/** Prateleira horizontal (estilo YouTube) com título e "Ver tudo". */
export function Shelf({ title, href, clips, wide }: { title: string; href?: string; clips: Clip[]; wide?: boolean }) {
  if (!clips.length) return null;
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-bold">{title}</h2>
        {href && <Link href={href} className="text-xs text-neon2">Ver tudo ›</Link>}
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4">
        {clips.slice(0, 12).map((c) => <div key={c.id} className={`${wide ? 'w-56' : 'w-28'} shrink-0 snap-start`}><ClipThumb c={c} wide={wide} /></div>)}
      </div>
    </section>
  );
}

export function TournamentCard({ t }: { t: Tournament }) {
  const { s } = useStore();
  const joined = s.entries.includes(t.id);
  return (
    <Link href={`/torneios/${t.id}`} className="card block overflow-hidden !p-0">
      <div className={`flex h-20 items-center justify-between bg-gradient-to-r ${t.gradient} px-4`}>
        <span className="text-3xl">🏆</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${t.fee === 0 ? 'bg-lime text-black' : 'bg-amber-400 text-black'}`}>{t.fee === 0 ? 'GRÁTIS' : `ENTRADA ${mzn(t.fee)}`}</span>
      </div>
      <div className="p-3">
        <p className="font-semibold">{t.name}</p>
        <p className="text-xs text-white/60">{t.game} · {t.mode} · {t.date}</p>
        <div className="mt-2 h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-neon" style={{ width: `${(t.filled / t.slots) * 100}%` }} /></div>
        <div className="mt-1 flex justify-between text-xs text-white/60">
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
        <button key={t} onClick={() => onChange(t)} className={`shrink-0 rounded-full px-4 py-1.5 text-sm ${value === t ? 'bg-neon text-white' : 'bg-panel2 text-white/70'}`}>{t}</button>
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
      <p className="text-xs text-white/60">{label}</p>
    </div>
  );
}

export function DemoBanner() {
  if (!IS_DEMO) return null;
  return <p className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-center text-xs text-amber-200">Modo demonstração: nenhum pagamento é cobrado.</p>;
}

export function allIdols() { return IDOLS; }
