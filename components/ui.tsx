'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Tournament, mzn } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { Icon } from './icons';
import { CountBadge, useUnread } from './Unread';
import { TournamentCover } from './GameArt';
import { fmtWhen, gameKeyOf } from '@/lib/jogos';

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Ícone da app TXAPILOG (asa + pin amarelos sobre azul royal). Tamanho fixo para não "saltar" ao carregar. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}/icons/icon-192.png`} width={size} height={size} alt="TXAPZONE" decoding="async"
      className="shrink-0 rounded-[22%] bg-royal object-cover" style={{ width: size, height: size }} />
  );
}

/** Logótipo grande TXAPZONE para entrada, splash e páginas da marca. */
export function BrandLogo({ width = 220, className = '' }: { width?: number; className?: string }) {
  const icon = Math.round(width * 0.34);
  return (
    <span className={`flex select-none flex-col items-center gap-2 ${className}`} role="img" aria-label="TXAPZONE">
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="1.5" y="6" width="21" height="12.5" rx="6.25" fill="#0048FD" />
        <path d="M7.5 9.6v5M5 12.1h5" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="15.6" cy="10.9" r="1.25" fill="#FFC107" />
        <circle cx="18.2" cy="13.4" r="1.25" fill="#FFC107" />
      </svg>
      <span className="font-extrabold tracking-[.1em] text-white" style={{ fontSize: Math.round(width * 0.14) }}>TXAPZONE</span>
    </span>
  );
}

/** Avatar é uma imagem (foto de perfil)? */
export const isImgAvatar = (a?: string | null) => !!a && /^(https?:\/\/|data:image\/|blob:)/i.test(a);

/** Conteúdo de um avatar: foto (avatar_url); sem foto (ou se falhar) mostra as iniciais do nome. A app não mostra emojis. */
export function AvatarFace({ a, name, fill }: { a?: string | null; name?: string; fill?: boolean }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [a]);
  if (isImgAvatar(a) && !bad) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={a!} alt={name ? `Foto de ${name}` : ''} loading="lazy" decoding="async" onError={() => setBad(true)}
      className={fill ? 'h-full w-full rounded-full object-cover' : 'inline-block h-[1.15em] w-[1.15em] rounded-full object-cover align-middle'} />;
  }
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const txt = parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?';
  return <span className="font-semibold leading-none">{txt}</span>;
}

/** Avatar redondo de tamanho fixo. */
export function Avatar({ a, name, size = 40, className = '' }: { a?: string | null; name?: string; size?: number; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel2 ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}>
      <AvatarFace a={a} name={name} fill />
    </span>
  );
}

/** Logótipo TXAPZONE (comando laranja + nome). */
export function TzLogo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width={26} height={26} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
        <rect x="1.5" y="6" width="21" height="12.5" rx="6.25" fill="#0048FD" />
        <path d="M7.5 9.6v5M5 12.1h5" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="15.6" cy="10.9" r="1.25" fill="#FFC107" />
        <circle cx="18.2" cy="13.4" r="1.25" fill="#FFC107" />
      </svg>
      {!compact && <span className="truncate text-[17px] font-extrabold tracking-[.08em]">TXAPZONE</span>}
    </span>
  );
}

export function TopBar({ title, back, right }: { title?: string; back?: string; right?: React.ReactNode }) {
  const { s } = useStore();
  const { notifs } = useUnread();
  return (
    <header className="sticky top-0 z-30 flex min-h-[60px] items-center gap-2 border-b border-[#FFFFFF0F] bg-[#0E0F13]/95 px-4 py-2 backdrop-blur">
      {back ? (
        <Link href={back} className="icon-btn -ml-1 mr-0.5" aria-label="Voltar"><Icon name="back" size={22} strokeWidth={2.2} /></Link>
      ) : (
        <Link href="/" className="flex items-center gap-2 md:hidden" aria-label="TXAPZONE — Início"><TzLogo compact /></Link>
      )}
      <div className="min-w-0 flex-1">
        {title ? <h1 className="truncate text-[20px] font-bold leading-tight">{title}</h1> : (
          <span className="text-[17px] font-extrabold tracking-[.08em] text-white">TXAPZONE</span>
        )}
      </div>
      {right ?? ((IS_DEMO || s.account.loggedIn) && <div className="flex items-center gap-1.5 md:hidden">
        <Link href="/notificacoes" className="icon-btn" aria-label={`Notificações${notifs ? ` (${notifs} novas)` : ''}`}><Icon name="bell" size={22} /><CountBadge n={notifs} /></Link>
        <Link href="/mais" className="icon-btn" aria-label="Menu"><Icon name="menu" size={22} /></Link>
      </div>)}
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
            <Icon name="clock" size={40} strokeWidth={1.6} className="mx-auto mb-2 text-[#FFC107]" />
            <p className="mb-4">{wellbeingAlert}</p>
            <div className="flex gap-2">
                            <button onClick={dismissAlert} className="btn flex-1">Ok, obrigado</button>
            </div>
          </div>
        </div>
      )}
      {nightNow && (
        <div role="status" className="pointer-events-none fixed bottom-[calc(var(--bnav-h)+10px)] left-1/2 z-[45] -translate-x-1/2 whitespace-nowrap rounded-full border border-[#FFFFFF1F] bg-[#16181F]/95 px-3 py-1 text-[11px] text-[#FFFFFFB8] md:left-[calc(50%+var(--nav-w)/2)]">Silêncio noturno: notificações em pausa</div>
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
        <button onClick={async () => { try { await navigator.clipboard.writeText(url); } catch {} toast('Link copiado'); done(); }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-panel2 p-4"><Icon name="link" size={24} /></span>Copiar link</button>
        <a href={`https://wa.me/?text=${msg}`} target="_blank" rel="noreferrer" onClick={done} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-green-600/80 p-4"><Icon name="phone" size={24} /></span>WhatsApp</a>
        <button onClick={async () => { try { await navigator.clipboard.writeText(url); } catch {} toast('Link copiado. Cola nos Stories do Instagram'); window.open('https://www.instagram.com/', '_blank'); done(); }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-gradient-to-br from-brand2 via-panel2 to-bg p-4"><Icon name="image" size={24} /></span>Instagram</button>
        <button onClick={async () => {
          const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
          if (nav.share) { try { await nav.share({ title: 'TXAPZONE', text, url }); } catch {} } else toast('Partilha nativa indisponível neste navegador');
          done();
        }} className="flex flex-col items-center gap-1"><span className="rounded-2xl bg-panel2 p-4"><Icon name="swap" size={24} /></span>Mais</button>
      </div>
      <p className="mt-4 break-all rounded-lg bg-panel2 p-2 text-xs text-white/60">{url}</p>
    </Sheet>
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

/** Cartão de torneio com a capa real do jogo, estado, vagas e prémio. */
export function TournamentCard({ t }: { t: Tournament }) {
  const { s } = useStore();
  const joined = s.entries.includes(t.id);
  const pct = Math.min(100, (t.filled / Math.max(1, t.slots)) * 100);
  return (
    <Link href={`/torneios/${t.id}`} className="card card-hover block overflow-hidden !p-0">
      <div className="relative aspect-[16/7] w-full">
        <TournamentCover t={t} sizes="(min-width: 768px) 640px, 100vw" />
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
    <div className="rounded-ctl border border-line/60 bg-panel2/70 p-3 text-center shadow-e1" style={{ boxShadow: 'inset 0 -2px 0 rgba(255,107,26,.55)' }}>
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
export function EmptyState({ icon, title, text, action, className = '' }: { icon?: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-2 rounded-card border border-dashed border-line/70 px-5 py-8 text-center ${className}`}>
      {icon && <span className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-panel2 text-neon" aria-hidden>{icon}</span>}
      <p className="font-display text-lg font-bold">{title}</p>
      {text && <p className="max-w-sm text-sm text-white/70">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
