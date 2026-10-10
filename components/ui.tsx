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
import { LiveBadge } from './Hud';
import { Icon, IconName } from './Icons';
import { GameArt } from './GameArt';
import { GAME_ART } from '@/lib/gameArt';
import { fmtWhen, gameKeyOf } from '@/lib/jogos';

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Ícone da app TXAPILOG (asa + pin amarelos sobre azul royal). Tamanho fixo para não "saltar" ao carregar. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}/icons/icon-192.png`} width={size} height={size} alt="TXAPILOG" decoding="async"
      className="shrink-0 rounded-[22%] bg-royal object-cover" style={{ width: size, height: size }} />
  );
}

/** Logótipo completo TXAPILOG (asa + pin, nome e "FAST LIKE A BIRD"), para entrada, splash e páginas da marca. */
export function BrandLogo({ width = 220, className = '' }: { width?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}/brand/txapilog-logo.svg`} width={width} height={Math.round(width * 0.76)} alt="TXAPILOG · Fast like a bird" decoding="async"
      className={`select-none ${className}`} style={{ width, height: Math.round(width * 0.76) }} />
  );
}

/** Marca horizontal (ícone + TXAPILOG) para o cabeçalho. */
export function BrandMark({ height = 28 }: { height?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}/brand/txapilog-horizontal.svg`} width={Math.round(height * 4.75)} height={height} alt="TXAPILOG" decoding="async"
      className="shrink-0 select-none" style={{ width: Math.round(height * 4.75), height }} />
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

/** Contador discreto (mensagens/notificações). */
function Count({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-neon px-1 text-center text-[11px] font-bold leading-[18px] text-ink tabular-nums">{n > 9 ? '9+' : n}</span>;
}

/** Contagem de mensagens por ler (atualiza a cada minuto, sem bloquear o primeiro desenho). */
export function useDmUnread(every = 60000) {
  const { s, ready } = useStore();
  const [dm, setDm] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const tick = () => import('@/lib/dm').then((m) => m.unreadTotal()).then((n) => { if (alive) setDm(n); }).catch(() => {});
    const t = setTimeout(tick, 1200);
    const iv = setInterval(tick, every);
    return () => { alive = false; clearTimeout(t); clearInterval(iv); };
  }, [ready, s.account.loggedIn, every]);
  return dm;
}

const iconBtn = 'tap relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/5';

export function TopBar({ title, back }: { title?: string; back?: string }) {
  const { s } = useStore();
  const unread = s.notifs.filter((n) => !n.read).length;
  const dm = useDmUnread();
  return (
    <header className="glass sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-1 border-b border-line pl-2 pr-1.5 pt-[env(safe-area-inset-top)]">
      {back ? (
        <Link href={back} className={iconBtn} aria-label="Voltar"><Icon name="back" /></Link>
      ) : (
        <Link href="/" className="flex h-11 items-center px-1.5 lg:hidden" aria-label="TXAPILOG — Início"><Logo size={30} /></Link>
      )}
      <div className="min-w-0 flex-1 px-1">
        {title ? <h1 className="truncate text-xl font-bold leading-tight">{title}</h1> : (
          <span className="font-display text-xl font-bold tracking-[.12em] text-white">TXAPILOG</span>
        )}
      </div>
      {(IS_DEMO || s.account.loggedIn) && <>
        <Link href="/mensagens" className={`${iconBtn} lg:hidden`} aria-label={`Mensagens${dm ? ` (${dm} por ler)` : ''}`}><Icon name="chat" /><Count n={dm} /></Link>
        <Link href="/notificacoes" className={`${iconBtn} lg:hidden`} aria-label={`Notificações${unread ? ` (${unread} novas)` : ''}`}><Icon name="bell" /><Count n={unread} /></Link>
        <Link href="/mais" className={iconBtn} aria-label="Menu"><Icon name="menu" /></Link>
      </>}
    </header>
  );
}

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Início', icon: 'home' },
  { href: '/explorar', label: 'Explorar', icon: 'compass' },
  { href: '/publicar', label: 'Publicar', icon: 'plus' },
  { href: '/clipes', label: 'Clipes', icon: 'clapper' },
  { href: '/perfil', label: 'Perfil', icon: 'user' },
];
// Secções que pertencem a um separador (para o ícone ficar ativo)
const EXPLORE = ['/explorar', '/jogos', '/pesquisa', '/lives', '/torneios', '/videos', '/idolos', '/ranking', '/eventos', '/canais', '/escola', '/mais'];

/** Esconde o cromado global (barra inferior / lateral) nestes ecrãs de ecrã inteiro. */
function chromeHidden(path: string, loggedIn: boolean) {
  const p = path.replace(BASE, '') || '/';
  return isAuthRoute(path) || (!IS_DEMO && !loggedIn) || p.startsWith('/jogos') || p.startsWith('/mensagens/chat') || p.startsWith('/mensagens/chamada') || p.startsWith('/mensagens/grupo') || p.startsWith('/mensagens/contacto');
}

export function BottomNav() {
  const path = usePathname() || '/';
  const p = path.replace(BASE, '') || '/';
  const { s } = useStore();
  const [pub, setPub] = useState(false);
  if (chromeHidden(path, s.account.loggedIn)) return null;
  const isActive = (h: string) => h === '/' ? p === '/' : h === '/explorar' ? EXPLORE.some((x) => p.startsWith(x)) : p.startsWith(h);
  return (
    <>
    <PublishSheet open={pub} onClose={() => setPub(false)} />
    <SideNav onPublish={() => setPub(true)} isActive={isActive} />
    <nav aria-label="Navegação principal" className="col-fixed glass fixed bottom-0 z-40 flex border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden">
      {TABS.map((t) => {
        const active = isActive(t.href);
        if (t.href === '/publicar') return (
          <button key={t.href} type="button" onClick={() => setPub(true)} aria-label="Publicar" aria-haspopup="dialog" className="nav-tab flex h-[60px] flex-1 items-center justify-center [@media(max-height:480px)]:h-12">
            <span className={`flex h-10 w-12 items-center justify-center rounded-[14px] bg-neon text-ink shadow-[0_6px_16px_-6px_rgba(255,194,14,.7)] transition-transform ${pub ? 'scale-95' : ''}`}><Icon name="plus" size={24} strokeWidth={2.4} /></span>
          </button>
        );
        return (
          <Link key={t.href} href={t.href} aria-label={t.label} aria-current={active ? 'page' : undefined} className={`nav-tab flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 [@media(max-height:480px)]:h-12 ${active ? 'text-neon2' : 'text-white/65'}`}>
            <span className="nav-pill" aria-hidden />
            {t.href === '/perfil'
              ? <span className={`relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-panel2 text-base ${active ? 'ring-2 ring-neon' : ''}`}><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>
              : <span className="relative"><Icon name={t.icon} size={24} strokeWidth={active ? 2.2 : 1.8} /></span>}
            <span className={`relative text-[11px] leading-none [@media(max-height:480px)]:hidden ${active ? 'font-semibold' : ''}`}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}

const SIDE: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Início', icon: 'home' },
  { href: '/explorar', label: 'Explorar', icon: 'compass' },
  { href: '/jogos', label: 'Jogos & Torneios', icon: 'gamepad' },
  { href: '/clipes', label: 'Clipes', icon: 'clapper' },
  { href: '/videos', label: 'Vídeos', icon: 'tv' },
  { href: '/lives', label: 'Lives', icon: 'live' },
  { href: '/ranking', label: 'Ranking', icon: 'chart' },
  { href: '/mensagens', label: 'Mensagens', icon: 'chat' },
  { href: '/notificacoes', label: 'Notificações', icon: 'bell' },
  { href: '/perfil', label: 'Perfil', icon: 'user' },
];

/** Navegação lateral em desktop (≥1024 px): ícones (lg) e ícones + nomes (xl). */
function SideNav({ onPublish, isActive }: { onPublish: () => void; isActive: (h: string) => boolean }) {
  const { s } = useStore();
  const p = (usePathname() || '/').replace(BASE, '') || '/';
  const unread = s.notifs.filter((n) => !n.read).length;
  const dm = useDmUnread();
  const act = (h: string) => h === '/explorar' ? isActive(h) && !p.startsWith('/jogos') && !p.startsWith('/lives') && !p.startsWith('/videos') && !p.startsWith('/ranking') : h === '/' ? p === '/' : p.startsWith(h);
  return (
    <nav aria-label="Navegação lateral" className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col gap-1 border-r border-line bg-[#080F28]/95 px-3 py-5 lg:flex xl:w-64">
      <Link href="/" className="mb-5 flex h-11 items-center justify-center xl:justify-start xl:px-2" aria-label="TXAPILOG — Início">
        <span className="xl:hidden"><Logo size={36} /></span>
        <span className="hidden xl:block"><BrandMark height={30} /></span>
      </Link>
      {SIDE.map((t) => (
        <Link key={t.href} href={t.href} aria-current={act(t.href) ? 'page' : undefined} className="side-link relative justify-center xl:justify-start" title={t.label}>
          {t.href === '/perfil'
            ? <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-panel2 text-sm"><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>
            : <Icon name={t.icon} />}
          <span className="hidden xl:inline">{t.label}</span>
          {t.href === '/mensagens' && dm > 0 && <span className="absolute left-9 top-2 min-w-[18px] rounded-full bg-neon px-1 text-center text-[11px] font-bold leading-[18px] text-ink xl:static xl:ml-auto">{dm > 9 ? '9+' : dm}</span>}
          {t.href === '/notificacoes' && unread > 0 && <span className="absolute left-9 top-2 min-w-[18px] rounded-full bg-neon px-1 text-center text-[11px] font-bold leading-[18px] text-ink xl:static xl:ml-auto">{unread > 9 ? '9+' : unread}</span>}
        </Link>
      ))}
      <button type="button" onClick={onPublish} className="btn mt-4 !px-0 xl:!px-5" aria-label="Publicar"><Icon name="plus" strokeWidth={2.4} /><span className="hidden xl:inline">Publicar</span></button>
      <div className="mt-auto">
        <Link href="/mais" aria-current={p.startsWith('/mais') ? 'page' : undefined} className="side-link justify-center xl:justify-start" title="Mais"><Icon name="menu" /><span className="hidden xl:inline">Mais</span></Link>
        <Link href="/definicoes" aria-current={p.startsWith('/definicoes') ? 'page' : undefined} className="side-link justify-center xl:justify-start" title="Definições"><Icon name="settings" /><span className="hidden xl:inline">Definições</span></Link>
      </div>
    </nav>
  );
}

export function Overlays() {
  const { toastMsg, wellbeingAlert, dismissAlert, nightNow } = useStore();
  return (
    <>
      {toastMsg && (
        <div role="status" className="fade-in fixed left-1/2 top-[calc(4.25rem+env(safe-area-inset-top))] z-[70] w-[92%] max-w-sm -translate-x-1/2 rounded-2xl border border-line bg-panel2/95 px-4 py-3 text-center text-sm shadow-e3">{toastMsg}</div>
      )}
      {wellbeingAlert && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6">
          <div role="dialog" aria-modal="true" className="fade-in w-full max-w-sm rounded-[28px] border border-line bg-panel p-6 text-center shadow-e3">
            <div className="mb-2 text-4xl" aria-hidden>🧘</div>
            <p className="mb-4">{wellbeingAlert}</p>
            <div className="flex gap-2">
              <Link href="/bem-estar" onClick={dismissAlert} className="btn-ghost flex-1">Bem-estar</Link>
              <button onClick={dismissAlert} className="btn flex-1">Ok, obrigado</button>
            </div>
          </div>
        </div>
      )}
      {nightNow && (
        <div className="fixed left-0 right-0 top-0 z-[60] mx-auto max-w-[var(--col)] bg-ink/90 py-1 text-center text-xs">🌙 Silêncio noturno ativo: notificações em pausa</div>
      )}
    </>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="fade-in max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-line bg-panel p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-e3 sm:rounded-[28px] sm:pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="tap flex h-11 w-11 items-center justify-center rounded-full bg-panel2" aria-label="Fechar"><Icon name="close" size={20} /></button>
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
        <button onClick={async () => { try { await navigator.clipboard.writeText(url); } catch {} toast('Link copiado. Cola nos Stories do Instagram 📸'); window.open('https://www.instagram.com/', '_blank'); done(); }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-gradient-to-br from-neon via-panel2 to-bg p-4 text-2xl">📸</span>Instagram</button>
        <button onClick={async () => {
          const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
          if (nav.share) { try { await nav.share({ title: 'TXAPILOG', text, url }); } catch {} } else toast('Partilha nativa indisponível neste navegador');
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
    // TXAPILOG IA: bloqueia abuso claro, avisa com gentileza em linguagem rude
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
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="sec-title">{title}</h2>
        {href && <Link href={href} className="flex min-h-[44px] items-center gap-0.5 text-sm font-semibold text-neon2">Ver tudo<Icon name="chevron" size={16} /></Link>}
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
    <Link href={`/idolo/${i.id}`} className="tap flex w-20 shrink-0 flex-col items-center gap-1.5">
      <span className="overflow-hidden flex h-16 w-16 items-center justify-center rounded-full border-2 text-3xl" style={{ borderColor: i.color }}><AvatarFace a={i.avatar} name={i.name} fill /></span>
      <span className="w-full truncate text-center text-xs">{i.name}</span>
    </Link>
  );
}

export function LiveCard({ l, big }: { l: Live; big?: boolean }) {
  const i = idol(l.idolId);
  return (
    <Link href={`/lives/${l.id}`} className={`tap relative block overflow-hidden rounded-[20px] bg-gradient-to-br ${l.gradient} shadow-e1 ${big ? 'aspect-video w-full' : 'aspect-video w-60 shrink-0'}`}>
      <LiveBadge className="absolute left-3 top-3" small={!big} />
      <span className="stat-num absolute right-3 top-3 rounded bg-black/60 px-2 py-0.5 text-[12px]">👁 {fmt(l.viewers)}</span>
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
    <Link href={href} className={`tap relative block ${box} overflow-hidden rounded-[14px] bg-gradient-to-br ${c.gradient} ${className}`}>
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
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {href && <Link href={href} className="flex min-h-[44px] items-center gap-0.5 text-sm font-semibold text-neon2">Ver tudo<Icon name="chevron" size={16} /></Link>}
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4">
        {clips.slice(0, 12).map((c) => <div key={c.id} className={`${wide ? 'w-60 md:w-72' : 'w-[7.5rem] md:w-36'} shrink-0 snap-start`}><ClipThumb c={c} wide={wide} /></div>)}
      </div>
    </section>
  );
}

export function TournamentCard({ t }: { t: Tournament }) {
  const { s } = useStore();
  const joined = s.entries.includes(t.id);
  const pct = Math.min(100, (t.filled / Math.max(1, t.slots)) * 100);
  return (
    <Link href={`/torneios/${t.id}`} className="game-tile block">
      <div className="relative aspect-[21/9] w-full">
        <GameArt id={GAME_ART[gameKeyOf(t.game)]} sizes="(min-width: 640px) 640px, 100vw" />
        <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold ${t.fee === 0 ? 'bg-lime' : 'bg-neon'} text-ink`}>{t.fee === 0 ? 'GRÁTIS' : `ENTRADA ${mzn(t.fee)}`}</span>
        {t.status !== 'aberto' && <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold">{t.status === 'a decorrer' ? '⏱ A decorrer' : 'Terminado'}</span>}
        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/75">{t.game} · {t.mode}</p>
          <p className="font-display text-xl font-bold leading-tight">{t.name}</p>
        </div>
      </div>
      <div className="p-3.5">
        <div className="flex items-center justify-between gap-3 text-sm text-white/70">
          <span className="flex items-center gap-1.5"><Icon name="calendar" size={16} />{fmtWhen(t.date)}</span>
          <span>Prémio <span className="stat-num text-base text-neon2">{t.prize > 0 ? mzn(t.prize) : 'A anunciar'}</span></span>
        </div>
        <div className="hud-progress mt-2.5"><span style={{ width: `${pct}%` }} /></div>
        <div className="mt-1.5 flex justify-between text-xs text-white/65">
          <span><span className="stat-num">{t.filled}/{t.slots}</span> vagas</span>
          {joined && <span className="font-semibold text-lime">✓ Estás inscrito</span>}
        </div>
      </div>
    </Link>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)} aria-pressed={value === t} className={`tap min-h-[44px] shrink-0 rounded-full px-4 text-sm font-medium transition-colors ${value === t ? 'bg-neon text-ink' : 'bg-white/[.06] text-white/80 ring-1 ring-inset ring-white/10 hover:bg-white/10'}`}>{t}</button>
      ))}
    </div>
  );
}

export function Page({ title, back, children, noPad }: { title?: string; back?: string; children: React.ReactNode; noPad?: boolean }) {
  return (
    <>
      <TopBar title={title} back={back} />
      <main className={noPad ? 'pb-[calc(var(--nav-h)+env(safe-area-inset-bottom))]' : 'px-4 pb-[calc(var(--nav-h)+3rem+env(safe-area-inset-bottom))] pt-4 sm:px-6'}>{children}</main>
    </>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[14px] bg-panel2 p-3 text-center ring-1 ring-inset ring-white/[.06]">
      <p className="stat-num text-xl leading-tight">{value}</p>
      <p className="text-xs text-white/70">{label}</p>
    </div>
  );
}

export function DemoBanner() {
  if (!IS_DEMO) return null;
  return <p className="mb-4 rounded-[14px] bg-neon/10 p-2.5 text-center text-xs text-neon2">Modo demonstração: nenhum pagamento é cobrado.</p>;
}

export function allIdols() { return IDOLS; }
