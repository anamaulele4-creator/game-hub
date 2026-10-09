'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { CLIPS, Clip, IDOLS, Idol, Live, REACTIONS, Tournament, fmt, idol, mzn } from '@/lib/data';
import { TYPE_ICON, clipType, fmtDuration, videoHref } from '@/lib/feed';
import { moderate, recordModeration } from '@/lib/poipakAI';
import { MoreMenu } from './Moderation';
import { IS_DEMO } from '@/lib/config';
import { LiveBadge } from './Hud';
import { Icon } from './icons';
import { CountBadge, useUnread } from './Unread';
import { GameCover } from './GameArt';
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

export function TopBar({ title, back }: { title?: string; back?: string }) {
  const { s } = useStore();
  const { dm, notifs } = useUnread();
  return (
    <header className="sticky top-0 z-30 flex min-h-[60px] items-center gap-2 border-b border-line/60 bg-bg/90 px-4 py-2 backdrop-blur-md">
      {back ? (
        <Link href={back} className="icon-btn -ml-1 mr-0.5" aria-label="Voltar"><Icon name="back" size={22} strokeWidth={2.2} /></Link>
      ) : (
        <Link href="/" className="flex items-center gap-2 md:hidden" aria-label="TXAPILOG — Início"><Logo size={30} /></Link>
      )}
      <div className="min-w-0 flex-1">
        {title ? <h1 className="truncate text-[22px] font-bold uppercase leading-tight">{title}</h1> : (
          <span className="font-display text-xl font-bold tracking-[.12em] text-white">TXAPILOG</span>
        )}
      </div>
      {(IS_DEMO || s.account.loggedIn) && <div className="flex items-center gap-1.5 md:hidden">
        <Link href="/mensagens" className="icon-btn" aria-label={`Mensagens${dm ? ` (${dm} por ler)` : ''}`}><Icon name="chat" size={22} /><CountBadge n={dm} /></Link>
        <Link href="/notificacoes" className="icon-btn" aria-label={`Notificações${notifs ? ` (${notifs} novas)` : ''}`}><Icon name="bell" size={22} /><CountBadge n={notifs} /></Link>
        <Link href="/mais" className="icon-btn" aria-label="Menu"><Icon name="menu" size={22} /></Link>
      </div>}
    </header>
  );
}

export function Overlays() {
  const { toastMsg, wellbeingAlert, dismissAlert, nightNow } = useStore();
  return (
    <>
      {toastMsg && (
        <div className="dock-x pointer-events-none fixed top-16 z-[70] flex justify-center px-4"><div role="status" aria-live="polite" className="w-full max-w-sm animate-sheetIn rounded-ctl border border-neon/40 bg-panel2/95 px-4 py-3 text-center text-sm shadow-e3 backdrop-blur">{toastMsg}</div></div>
      )}
      {wellbeingAlert && (
        <div className="fixed inset-0 z-[80] flex animate-fadeIn items-center justify-center bg-black/70 p-6">
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm animate-sheetIn rounded-sheet border border-neon2/40 bg-panel p-6 text-center shadow-e3">
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
        <div className="dock-x fixed top-0 z-[60] bg-ink/90 py-1 text-center text-xs">🌙 Silêncio noturno ativo: notificações em pausa</div>
      )}
    </>
  );
}

/** Folha: desliza de baixo no telemóvel, diálogo centrado em ecrãs grandes. Fecha com Esc, toque fora ou ✕. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    box.current?.focus({ preventScroll: true });
    return () => { window.removeEventListener('keydown', onKey); try { prev?.focus?.({ preventScroll: true }); } catch {} };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex animate-fadeIn items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className="max-h-[85vh] w-full max-w-md animate-sheetIn overflow-y-auto rounded-t-sheet border-t border-neon/30 bg-panel p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-e3 outline-none sm:max-w-lg sm:rounded-sheet sm:border sm:pb-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-white/20 sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="icon-btn !h-10 !w-10" aria-label="Fechar"><Icon name="close" size={18} strokeWidth={2.2} /></button>
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
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="sec-title">{title}</h2>
        {href && <Link href={href} className="flex min-h-[44px] items-center gap-0.5 text-xs font-semibold text-neon2 hover:underline">Ver tudo <Icon name="chevron" size={14} strokeWidth={2.4} /></Link>}
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

/** Cartão de live: capa real do jogo por baixo (quando é um dos jogos principais), avatar do criador e espectadores. */
export function LiveCard({ l, big }: { l: Live; big?: boolean }) {
  const i = idol(l.idolId);
  const k = gameKeyOf(l.game);
  return (
    <Link href={`/lives/${l.id}`} className={`card-hover relative block overflow-hidden rounded-card border border-white/10 bg-gradient-to-br ${l.gradient} shadow-e1 ${big ? 'aspect-video w-full' : 'aspect-video w-60 shrink-0'}`}>
      {k !== 'outros' && <GameCover game={k} sizes={big ? '(min-width: 768px) 640px, 100vw' : '240px'} shade={false} className="opacity-70" />}
      <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/30" aria-hidden />
      <LiveBadge className="absolute left-3 top-3" small={!big} />
      <span className="stat-num absolute right-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[12px] backdrop-blur-sm">👁 {fmt(l.viewers)}</span>
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-3">
        <Avatar a={i.avatar} name={i.name} size={big ? 40 : 32} className="ring-2 ring-neon" />
        <div className="min-w-0 flex-1">
          <p className={`truncate font-semibold ${big ? 'text-base' : 'text-sm'}`}>{l.title}</p>
          <p className="truncate text-xs text-white/75">{i.name} · {l.game}</p>
        </div>
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
    <Link href={href} className={`card-hover relative block ${box} overflow-hidden rounded-ctl bg-gradient-to-br ${c.gradient} ${className}`}>
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
        {href && <Link href={href} className="flex min-h-[44px] items-center text-xs font-semibold text-neon2 hover:underline">Ver tudo ›</Link>}
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4">
        {clips.slice(0, 12).map((c) => <div key={c.id} className={`${wide ? 'w-56 md:w-64' : 'w-28 md:w-36'} shrink-0 snap-start`}><ClipThumb c={c} wide={wide} /></div>)}
      </div>
    </section>
  );
}

/** Cartão de torneio com a capa real do jogo, estado, vagas e prémio. */
export function TournamentCard({ t }: { t: Tournament }) {
  const { s } = useStore();
  const joined = s.entries.includes(t.id);
  const k = gameKeyOf(t.game);
  const pct = Math.min(100, (t.filled / Math.max(1, t.slots)) * 100);
  return (
    <Link href={`/torneios/${t.id}`} className="card card-hover block overflow-hidden !p-0">
      <div className="relative aspect-[16/7] w-full">
        <GameCover game={k} sizes="(min-width: 768px) 640px, 100vw" />
        <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-e1 ${t.fee === 0 ? 'bg-lime text-ink' : 'bg-neon text-ink'}`}>{t.fee === 0 ? 'GRÁTIS' : `ENTRADA ${mzn(t.fee)}`}</span>
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="eyebrow !text-white/80">{t.game} · {t.mode}</p>
          <p className="font-display text-xl font-bold leading-tight">{t.name}</p>
        </div>
      </div>
      <div className="p-3.5">
        <div className="hud-progress"><span style={{ width: `${pct}%` }} /></div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-white/70">
          <span className="whitespace-nowrap"><span className="stat-num text-sm text-white">{t.filled}/{t.slots}</span> vagas · {fmtWhen(t.date)}</span>
          <span className="whitespace-nowrap">Prémio <span className="stat-num text-sm text-neon2">{mzn(t.prize)}</span></span>
        </div>
        {(joined || t.status !== 'aberto') && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {joined && <Badge tone="ok">✓ Estás inscrito</Badge>}
            {t.status !== 'aberto' && <Badge tone={t.status === 'a decorrer' ? 'accent' : 'muted'}>{t.status === 'a decorrer' ? 'A decorrer' : 'Terminado'}</Badge>}
          </div>
        )}
      </div>
    </Link>
  );
}

/** Separadores em pílula (rolam na horizontal no telemóvel). */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
      {tabs.map((t) => (
        <button key={t} type="button" onClick={() => onChange(t)} aria-pressed={value === t}
          className={`min-h-[44px] shrink-0 rounded-chip px-4 text-sm font-medium transition-colors duration-150 ${value === t ? 'bg-neon font-semibold text-ink shadow-glow' : 'bg-panel2/80 text-white/80 hover:bg-panel2 hover:text-white'}`}>{t}</button>
      ))}
    </div>
  );
}

export function Page({ title, back, children, noPad }: { title?: string; back?: string; children: React.ReactNode; noPad?: boolean }) {
  return (
    <>
      <TopBar title={title} back={back} />
      <main className={noPad ? '' : 'px-4 pb-28 pt-4 md:px-6 md:pb-12 md:pt-6'}>{children}</main>
    </>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-ctl border border-line/60 bg-panel2/70 p-3 text-center shadow-e1" style={{ boxShadow: 'inset 0 -2px 0 rgba(255,194,14,.55)' }}>
      <p className="stat-num text-xl leading-tight">{value}</p>
      <p className="text-xs text-white/70">{label}</p>
    </div>
  );
}

export function DemoBanner() {
  if (!IS_DEMO) return null;
  return <p className="mb-4 rounded-ctl border border-neon/40 bg-neon/10 p-2 text-center text-xs text-neon2">Modo demonstração: nenhum pagamento é cobrado.</p>;
}

/* =====================================================================
   Primitivos do design system (usar estes em vez de classes soltas)
   ===================================================================== */

type BtnVariant = 'primary' | 'ghost' | 'quiet' | 'danger';
const BTN: Record<BtnVariant, string> = { primary: 'btn', ghost: 'btn-ghost', quiet: 'btn-quiet', danger: 'btn-danger' };

/** Botão (≥ 44 px de altura). `href` transforma-o em ligação. */
export function Button({ variant = 'primary', href, block, className = '', children, ...rest }: {
  variant?: BtnVariant; href?: string; block?: boolean; className?: string; children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  const cls = `${BTN[variant]} ${block ? 'w-full' : ''} ${className}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

/** Superfície base. `interactive` dá elevação ao passar o rato/tocar. */
export function Card({ children, className = '', interactive, flat, as: As = 'div' }: { children: React.ReactNode; className?: string; interactive?: boolean; flat?: boolean; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <As className={`card ${interactive ? 'card-hover' : ''} ${flat ? 'card-flat' : ''} ${className}`}>{children}</As>;
}

/** Filtro/opção em pílula com estado (aria-pressed). */
export function Chip({ active, onClick, children, className = '' }: { active?: boolean; onClick?: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active}
      className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-chip border px-3.5 text-sm transition-colors ${active ? 'border-neon bg-neon font-semibold text-ink' : 'border-line/70 bg-panel2/60 text-white/85 hover:border-neon/50'} ${className}`}>
      {children}
    </button>
  );
}

const BADGE = { accent: 'bg-neon text-ink', ok: 'bg-ok/15 text-[#86EFAC] ring-1 ring-ok/40', danger: 'bg-danger/15 text-red-200 ring-1 ring-danger/40', muted: 'bg-white/10 text-white/75', info: 'bg-panel2 text-white ring-1 ring-line' } as const;
/** Etiqueta pequena de estado. */
export function Badge({ tone = 'muted', children, className = '' }: { tone?: keyof typeof BADGE; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold leading-5 ${BADGE[tone]} ${className}`}>{children}</span>;
}

/** Bloco de carregamento (em vez de spinners). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`skeleton block rounded-ctl ${className}`} />;
}

/** Lista de blocos de carregamento com rótulo acessível. */
export function SkeletonList({ rows = 3, h = 'h-20', className = '' }: { rows?: number; h?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="A carregar" className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={`${h} w-full !rounded-card`} />)}
    </div>
  );
}

/** Estado vazio útil: diz o que se passa e qual é o próximo passo. */
export function EmptyState({ icon = '✨', title, text, action, className = '' }: { icon?: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-2 rounded-card border border-dashed border-line/70 px-5 py-8 text-center ${className}`}>
      <span className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-panel2 text-2xl" aria-hidden>{icon}</span>
      <p className="font-display text-lg font-bold">{title}</p>
      {text && <p className="max-w-sm text-sm text-white/70">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function allIdols() { return IDOLS; }
