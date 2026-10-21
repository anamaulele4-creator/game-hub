'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Tournament, mzn } from '@/lib/data';
import { IS_DEMO } from '@/lib/config';
import { isAuthRoute } from '@/lib/routes';
import { Icon, IconName } from './Icons';
import { Photo } from './Photo';
import { GAME_ART } from '@/lib/gameArt';
import { fmtWhen, gameKeyOf } from '@/lib/jogos';
import { openSearch } from '@/lib/search';

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Ícone da app TXAPILOG (asa + pin amarelos sobre azul royal). Tamanho fixo para não "saltar" ao carregar. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}/icons/icon-192.png`} width={size} height={size} alt="TxapZone" decoding="async"
      className="shrink-0 rounded-[22%] bg-royal object-cover" style={{ width: size, height: size }} />
  );
}

/** Logótipo TxapZone (marca nominativa), para entrada, splash e páginas da marca. */
const LOGO_RATIO = 393 / 96;
export function BrandLogo({ width = 220, className = '' }: { width?: number; className?: string }) {
  const h = Math.round(width / LOGO_RATIO);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}/brand/txapzone-logo.svg`} width={width} height={h} alt="TxapZone" decoding="async"
      className={`select-none ${className}`} style={{ width, height: h }} />
  );
}

/** Marca horizontal TxapZone para o cabeçalho. */
export function BrandMark({ height = 28 }: { height?: number }) {
  const w = Math.round(height * LOGO_RATIO);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE}/brand/txapzone-logo.svg`} width={w} height={height} alt="TxapZone" decoding="async"
      className="shrink-0 select-none" style={{ width: w, height }} />
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
  const txt = !a || isImgAvatar(a) ? ((name ?? '').trim().charAt(0).toUpperCase() || '') : a;
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
const iconBtn = 'tap relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/5';

const TOP_MENU: { href: string; label: string }[] = [
  { href: '/', label: 'Início' },
  { href: '/jogos', label: 'Jogos' },
  { href: '/torneios', label: 'Torneios' },
  { href: '/marketplace', label: 'Marketplace' },
];

const SearchIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);

export function TopBar(_props: { title?: string; back?: string } = {}) {
  const { s, ready } = useStore();
  const path = usePathname() || '/';
  const p = path.replace(BASE, '') || '/';
  const logged = ready ? (IS_DEMO || s.account.loggedIn) : IS_DEMO;
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [path]);

  return (
    <header className="sticky top-0 z-40 bg-transparent pt-[env(safe-area-inset-top)] lg:fixed lg:inset-x-0">
      {/* Linha 1 */}
      <div className="bm-r1 flex h-12 items-center gap-2 px-3 lg:h-12 lg:gap-3 lg:px-6">
        <Link href="/" className="flex shrink-0 items-center pr-1 lg:pr-4" aria-label="TxapZone — Início">
          <span className="lg:hidden"><BrandMark height={26} /></span>
          <span className="hidden lg:block"><BrandMark height={34} /></span>
        </Link>

        <button type="button" onClick={openSearch} aria-label="Procurar"
          className="hidden h-10 w-[300px] items-center gap-2.5 rounded-lg bg-white/5 px-3.5 text-left text-[15px] text-white/55 hover:bg-white/10 lg:flex xl:w-[400px]">
          <SearchIcon /><span>Pesquisar</span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={openSearch} className={`${iconBtn} lg:hidden`} aria-label="Procurar"><Icon name="search" /></button>

          <span className="hidden h-10 items-center gap-2 rounded-lg bg-white/5 px-3.5 text-[15px] text-white/80 xl:flex">
            <span aria-hidden>🇲🇿</span>Português (MZ)<span aria-hidden className="text-[10px]">▼</span>
          </span>

          {logged ? (
            <div className="relative">
              <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
                className="flex h-10 items-center gap-2 rounded-lg bg-white/5 px-3.5 text-[15px] font-bold text-white hover:bg-[#333338]">
                <Icon name="user" size={20} /><span className="hidden sm:inline">Perfil</span><span aria-hidden className="text-[10px]">▼</span>
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} aria-hidden />
                  <div role="menu" className="absolute right-0 top-12 z-50 w-52 overflow-hidden rounded-xl bg-[#141D4A] py-1 shadow-xl">
                    <Link role="menuitem" href="/perfil" className="flex min-h-[44px] items-center gap-3 px-4 text-[15px] hover:bg-white/10"><Icon name="user" size={18} />O meu perfil</Link>
                    <Link role="menuitem" href="/definicoes" className="flex min-h-[44px] items-center gap-3 px-4 text-[15px] hover:bg-white/10"><Icon name="settings" size={18} />Definições</Link>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <Link href="/registar" className="flex h-10 items-center rounded-lg bg-neon px-4 text-[15px] font-bold text-ink lg:px-5">Criar Conta</Link>
              <Link href="/entrar" className="flex h-10 items-center rounded-lg bg-white/5 px-4 text-[15px] font-bold text-white lg:px-5">Entrar</Link>
            </>
          )}
        </div>
      </div>

      {/* Linha 2 (desktop) */}
      <nav aria-label="Secções principais" className="bm-r2 hidden h-11 items-center justify-center gap-1 lg:flex">
        {TOP_MENU.map((t) => (
          <Link key={t.href} href={t.href} aria-current={active(p, t.href) ? 'page' : undefined}
            className="flex h-9 items-center rounded-lg px-4 text-[16px] font-bold text-white">
            {t.label}
          </Link>
        ))}
      </nav>

      {/* Abas (telemóvel/tablet) */}
      <nav aria-label="Secções" className="no-scrollbar flex gap-1 overflow-x-auto bg-[#18181B] px-2 py-1.5 lg:hidden">
        {TOP_MENU.map((t) => (
          <Link key={t.href} href={t.href} aria-current={active(p, t.href) ? 'page' : undefined}
            className={`flex h-9 shrink-0 items-center rounded-lg px-3.5 text-sm font-semibold ${active(p, t.href) ? 'bg-[#2F2F33] text-white' : 'text-white/75'}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Barra de categorias com ícone (como "Futebol, Ténis…" da imagem 2). Usa-a no topo da página inicial. */
export function CategoryBar({ items }: { items: { href: string; label: string; icon: IconName }[] }) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 sm:-mx-6 lg:hidden">
      {items.map((c) => (
        <Link key={c.href + c.label} href={c.href} className="tap flex w-[72px] shrink-0 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-white/80">
          <Icon name={c.icon} size={26} />
          <span className="w-full truncate text-center">{c.label}</span>
        </Link>
      ))}
    </div>
  );
}



const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Início', icon: 'home' },
  { href: '/jogos', label: 'Jogos', icon: 'gamepad' },
  { href: '/torneios', label: 'Torneios', icon: 'trophy' },
  { href: '/perfil', label: 'Perfil', icon: 'user' },
];

/** Esconde o cromado global (barra inferior / lateral) nestes ecrãs de ecrã inteiro. */
function chromeHidden(path: string, loggedIn: boolean) {
  const p = path.replace(BASE, '') || '/';
 return isAuthRoute(path);
}

const active = (p: string, h: string) => (h === '/' ? p === '/' : p.startsWith(h));

export function BottomNav() {
  const path = usePathname() || '/';
  const p = path.replace(BASE, '') || '/';
  const { s, ready } = useStore();
  if (!ready || chromeHidden(path, s.account.loggedIn)) return null;
  return (
    <>
      <SideNav p={p} />
      {/* BARRA INFERIOR DESATIVADA (para reativar, remove este comentário)
      <nav aria-label="Navegação principal" className="col-fixed glass fixed bottom-0 z-40 flex border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden">
        {TABS.map((t) => {
          const on = active(p, t.href);
          return (
            <Link key={t.href} href={t.href} aria-label={t.label} aria-current={on ? 'page' : undefined} className={`nav-tab flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 [@media(max-height:480px)]:h-12 ${on ? 'text-neon2' : 'text-white/65'}`}>
              <span className="nav-pill" aria-hidden />
              <span className="relative"><Icon name={t.icon} size={24} strokeWidth={on ? 2.2 : 1.8} /></span>
              <span className={`relative text-[11px] leading-none [@media(max-height:480px)]:hidden ${on ? 'font-semibold' : ''}`}>{t.label}</span>
            </Link>
          );
        })}
      </nav>
      */}
    </>
  );
}

const SIDE: { href: string; label: string; icon: IconName; img?: string }[] = [
  { href: '/', label: 'Início', icon: 'home' ,img: 'home.png' },
  { href: '/jogos', label: 'Jogos & Torneios', icon: 'gamepad', img: 'game.png' },
  { href: '/torneios', label: 'Torneios', icon: 'trophy', img: 'tournament.png' },
  { href: '/desafios', label: 'Desafios', icon: 'sparkle' },
  { href: '/equipas', label: 'Equipas', icon: 'user' },
  { href: '/marketplace', label: 'Marketplace', icon: 'star', img: 'cart.png' },
  { href: '/carteira', label: 'Carteira', icon: 'shield' },
];

/** Navegação lateral em desktop (≥1024 px): ícones (lg) e ícones + nomes (xl). */
function SideNav({ p }: { p: string }) {
  const { s } = useStore();
  const unread = s.notifs.filter((n) => !n.read).length;
  return (
<nav aria-label="Navegação lateral" className="side-nav fixed bottom-0 left-0 top-12 z-30 hidden w-56 flex-col gap-1 overflow-y-auto border-r border-line bg-transparent px-3 py-4 lg:flex">
      <p className="px-3 pb-1 font-display text-lg font-bold text-neon2">Popular</p>
      {SIDE.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active(p, t.href) ? 'page' : undefined} className="side-link">
          {t.img
  // eslint-disable-next-line @next/next/no-img-element
  ? <img src={`${BASE}/icons/nav/${t.img}`} alt="" width={16} height={16} className="h-10 w-10 shrink-0 object-contain" />
  : <Icon name={t.icon} />}
<span>{t.label}</span>
          {t.href === '/notificacoes' && unread > 0 && <span className="ml-auto min-w-[18px] rounded-full bg-neon px-1 text-center text-[11px] font-bold leading-[18px] text-ink">{unread > 9 ? '9+' : unread}</span>}
        </Link>
      ))}
      <div className="mt-auto border-t border-line pt-2">
        {s.user.role === 'admin' && <Link href="/admin" aria-current={p.startsWith('/admin') ? 'page' : undefined} className="side-link"><Icon name="shield" /><span>Admin</span></Link>}
        <Link href="/mais" aria-current={p.startsWith('/mais') ? 'page' : undefined} className="side-link"><Icon name="menu" /><span>Mais</span></Link>
       {/* <Link href="/definicoes" aria-current={p.startsWith('/definicoes') ? 'page' : undefined} className="side-link"><Icon name="settings" /><span>Definições</span></Link> */}
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
            <div className="mb-2 text-4xl" aria-hidden></div>
            <p className="mb-4">{wellbeingAlert}</p>
            <div className="flex gap-2">
              <Link href="/bem-estar" onClick={dismissAlert} className="btn-ghost flex-1">Bem-estar</Link>
              <button onClick={dismissAlert} className="btn flex-1">Ok, obrigado</button>
            </div>
          </div>
        </div>
      )}
      {nightNow && (
        <div className="fixed left-0 right-0 top-0 z-[60] mx-auto max-w-[var(--col)] bg-ink/90 py-1 text-center text-xs">Silêncio noturno ativo: notificações em pausa</div>
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

export function TournamentCard({ t }: { t: Tournament }) {
  const { s } = useStore();
  const joined = s.entries.includes(t.id);
  const pct = Math.min(100, (t.filled / Math.max(1, t.slots)) * 100);
  return (
    <Link href={`/torneio/?id=${t.id}`} className="game-tile block">
      <div className="relative aspect-[21/9] w-full">
        <Photo src={t.cover} fallback={GAME_ART[gameKeyOf(t.game)]} alt={t.name} shade="bottom" sizes="(min-width: 640px) 640px, 100vw" />
        <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold ${t.fee === 0 ? 'bg-lime' : 'bg-neon'} text-ink`}>{t.fee === 0 ? 'GRÁTIS' : `ENTRADA ${mzn(t.fee)}`}</span>
        {t.status !== 'aberto' && <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold">{t.status === 'a decorrer' ? 'A decorrer' : 'Terminado'}</span>}
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
     
      <main className={`page-main ${noPad ? 'pb-[calc(var(--nav-h)+env(safe-area-inset-bottom))]' : 'px-4 pb-[calc(var(--nav-h)+3rem+env(safe-area-inset-bottom))] pt-4 sm:px-6'}`}>
        {(title || back) && (
          <div className={`mb-4 flex items-center gap-1 ${noPad ? 'px-4 pt-3' : ''}`}>
            {back && <Link href={back} className={iconBtn} aria-label="Voltar"><Icon name="back" /></Link>}
            {title && <h1 className="min-w-0 flex-1 truncate text-2xl font-bold leading-tight">{title}</h1>}
          </div>
        )}
        {children}
      </main>
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
