'use client';
// Moldura da app (navegação adaptativa):
//  • telemóvel (< 768 px): barra inferior com 5 separadores;
//  • tablet (768–1023 px): trilho lateral só com ícones;
//  • desktop (≥ 1024 px): menu lateral com nomes; ≥ 1280 px junta um painel à direita (jogos e torneios).
// As larguras vêm das variáveis --nav-w / --rail-w / --col-w em app/globals.css.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { IS_DEMO } from '@/lib/config';
import { isAuthRoute } from '@/lib/routes';
import { GAMES_CFG, GAME_KEYS, fmtWhen, gameKeyOf, mtOrTba } from '@/lib/jogos';
import { Icon, IconName } from './icons';
import { PublishSheet } from './PublishSheet';
import { AvatarFace, BrandMark, Logo } from './ui';
import { GameCover, GameIconImg } from './GameArt';
import { CountBadge, useUnread } from './Unread';

/* ---------------- Rotas ---------------- */
const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Início', icon: 'home' },
  { href: '/explorar', label: 'Explorar', icon: 'explore' },
  { href: '/jogos', label: 'Jogos & Torneios', icon: 'gamepad' },
  { href: '/clipes', label: 'Clipes', icon: 'clips' },
  { href: '/lives', label: 'Lives', icon: 'live' },
  { href: '/mensagens', label: 'Mensagens', icon: 'chat' },
  { href: '/notificacoes', label: 'Notificações', icon: 'bell' },
];
// Secções que pertencem ao separador Explorar (barra inferior)
const EXPLORE = ['/explorar', '/jogos', '/pesquisa', '/lives', '/torneios', '/videos', '/idolos', '/ranking', '/eventos', '/canais', '/escola', '/mais'];
// Ecrãs imersivos sem moldura (chat aberto, chamada, área TXAPZONE com cabeçalho próprio)
const IMMERSIVE = ['/jogos', '/mensagens/chat', '/mensagens/chamada', '/mensagens/grupo', '/mensagens/contacto', '/camera'];

function usePath() {
  return usePathname() || '/';
}
const starts = (p: string, h: string) => p === h || p.startsWith(h + '/');
function useChrome() {
  const p = usePath();
  const { s } = useStore();
  const hidden = isAuthRoute(p) || (!IS_DEMO && !s.account.loggedIn);
  const immersive = IMMERSIVE.some((x) => starts(p, x));
  return { p, hidden, immersive };
}

/* ---------------- Barra inferior (telemóvel) ---------------- */
const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Início', icon: 'home' },
  { href: '/explorar', label: 'Explorar', icon: 'explore' },
  { href: '/publicar', label: 'Publicar', icon: 'plus' },
  { href: '/clipes', label: 'Clipes', icon: 'clips' },
  { href: '/perfil', label: 'Perfil', icon: 'user' },
];

export function BottomNav() {
  const { p, hidden, immersive } = useChrome();
  const { s } = useStore();
  const [pub, setPub] = useState(false);
  if (hidden || immersive) return null;
  const isActive = (h: string) => (h === '/' ? p === '/' : h === '/explorar' ? EXPLORE.some((x) => starts(p, x)) : starts(p, h));
  return (
    <>
      <PublishSheet open={pub} onClose={() => setPub(false)} />
      <nav aria-label="Navegação principal" className="bottom-nav fixed bottom-0 left-0 right-0 z-40 flex justify-around border-t border-line/70 bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {TABS.map((t) => {
          const active = isActive(t.href);
          if (t.href === '/publicar') return (
            <button key={t.href} type="button" onClick={() => setPub(true)} aria-label="Publicar" aria-haspopup="dialog" className="nav-tab flex min-h-[52px] flex-1 flex-col items-center justify-center">
              <span className={`flex h-9 w-12 items-center justify-center rounded-ctl transition-colors ${pub ? 'bg-neon text-ink' : 'bg-neon/95 text-ink shadow-glow'}`}><Icon name="plus" size={22} strokeWidth={2.4} /></span>
            </button>
          );
          return (
            <Link key={t.href} href={t.href} aria-label={t.label} aria-current={active ? 'page' : undefined} className="nav-tab flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1">
              {t.href === '/perfil' ? (
                <span className={`flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-full bg-panel2 text-sm ${active ? 'ring-2 ring-neon' : 'ring-1 ring-white/20'}`}><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>
              ) : (
                <Icon name={t.icon} size={24} strokeWidth={active ? 2.3 : 1.8} className={active ? 'text-neon' : 'text-white/70'} />
              )}
              <span className={`text-[10.5px] leading-none ${active ? 'font-semibold text-neon' : 'text-white/65'}`}>{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/* ---------------- Menu lateral (tablet/desktop) ---------------- */
export function SideNav() {
  const { p, hidden, immersive } = useChrome();
  const { s } = useStore();
  const { dm, notifs } = useUnread();
  const [pub, setPub] = useState(false);
  if (hidden || immersive) return null;
  const count = (h: string) => (h === '/mensagens' ? dm : h === '/notificacoes' ? notifs : 0);
  const isActive = (h: string) => (h === '/' ? p === '/' : starts(p, h) || (h === '/jogos' && starts(p, '/torneios')));
  const item = (href: string, label: string, icon: React.ReactNode, active: boolean, n = 0) => (
    <Link key={href} href={href} aria-current={active ? 'page' : undefined} title={label}
      className={`side-link group relative flex min-h-[48px] items-center gap-3.5 rounded-ctl px-3 transition-colors lg:px-3.5 ${active ? 'bg-panel2 text-white' : 'text-white/75 hover:bg-panel2/60 hover:text-white'}`}>
      <span className="relative flex h-7 w-7 items-center justify-center">{icon}<CountBadge n={n} /></span>
      <span className={`hidden truncate text-[15px] lg:block ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
      {active && <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-neon" aria-hidden />}
    </Link>
  );
  return (
    <>
      <PublishSheet open={pub} onClose={() => setPub(false)} />
      <nav id="side-nav" aria-label="Navegação principal" className="fixed inset-y-0 left-0 z-40 hidden w-[var(--nav-w)] flex-col border-r border-line/50 bg-[#132A6C]/95 px-2.5 pb-4 pt-4 md:flex lg:px-4">
        <Link href="/" className="mb-5 flex min-h-[48px] items-center justify-center lg:justify-start lg:px-2" aria-label="TXAPILOG — Início">
          <span className="lg:hidden"><Logo size={36} /></span>
          <span className="hidden lg:block"><BrandMark height={30} /></span>
        </Link>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto no-scrollbar">
          {NAV.map((n) => item(n.href, n.label, <Icon name={n.icon} size={24} strokeWidth={isActive(n.href) ? 2.3 : 1.8} className={isActive(n.href) ? 'text-neon' : ''} />, isActive(n.href), count(n.href)))}
          {item('/perfil', 'Perfil', <span className={`flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-panel2 text-sm ${isActive('/perfil') ? 'ring-2 ring-neon' : 'ring-1 ring-white/20'}`}><AvatarFace a={s.user.avatar} name={s.user.name} fill /></span>, isActive('/perfil'))}
          <button type="button" onClick={() => setPub(true)} aria-haspopup="dialog" title="Publicar"
            className="btn mt-3 !min-h-[48px] !px-0 lg:!px-5">
            <Icon name="plus" size={22} strokeWidth={2.4} /><span className="hidden lg:inline">Publicar</span>
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-1 border-t border-line/50 pt-3">
          {item('/mais', 'Mais', <Icon name="menu" size={24} />, starts(p, '/mais'))}
          {item('/definicoes', 'Definições', <Icon name="settings" size={24} />, starts(p, '/definicoes'))}
        </div>
      </nav>
    </>
  );
}

/* ---------------- Painel direito (desktop largo): jogos com capas reais + próximos torneios ---------------- */
export function RightRail() {
  const { p, hidden, immersive } = useChrome();
  const { s, ready } = useStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (hidden || immersive || p.startsWith('/clipes') || p.startsWith('/clipe/')) return null;
  const open = s.admin.tournaments.filter((t) => t.status === 'aberto').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  return (
    <aside id="right-rail" aria-label="Jogos e torneios" className="fixed inset-y-0 right-0 z-30 hidden w-[var(--rail-w)] flex-col gap-6 overflow-y-auto border-l border-line/50 px-5 py-6 no-scrollbar xl:flex">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="sec-title !text-[15px]">Jogos</h2>
          <Link href="/jogos" className="text-xs font-semibold text-neon2 hover:underline">TXAPZONE ›</Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {GAME_KEYS.map((k, i) => (
            <Link key={k} href={`/jogos/${k}/`} className={`card-hover relative block overflow-hidden rounded-ctl border border-white/10 ${i === 0 ? 'col-span-2 aspect-[16/7]' : 'aspect-video'}`}>
              {mounted && <GameCover game={k} sizes={i === 0 ? '300px' : '150px'} />}
              <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-2">
                <span className="truncate text-[13px] font-semibold drop-shadow">{i === 0 ? GAMES_CFG[k].name : GAMES_CFG[k].short}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="sec-title !text-[15px]">Próximos torneios</h2>
          <Link href="/torneios" className="text-xs font-semibold text-neon2 hover:underline">Ver tudo ›</Link>
        </div>
        {!ready ? (
          <div className="space-y-2">{[0, 1, 2].map((k) => <span key={k} className="skeleton block h-14 rounded-ctl" />)}</div>
        ) : open.length === 0 ? (
          <p className="rounded-ctl border border-dashed border-line/70 p-4 text-sm text-white/70">Sem inscrições abertas agora. Os novos torneios aparecem aqui primeiro.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((t) => {
              const k = gameKeyOf(t.game);
              return (
                <li key={t.id}>
                  <Link href={`/torneios/${t.id}/`} className="flex items-center gap-3 rounded-ctl p-2 transition-colors hover:bg-panel2/60">
                    <GameIconImg game={k} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{t.name}</span>
                      <span className="block truncate text-xs text-white/65">{fmtWhen(t.date)} · {mtOrTba(t.prize)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="mt-auto text-[11px] leading-relaxed text-white/45">TXAPILOG · Fast like a bird · <Link href="/privacidade" className="hover:underline">Privacidade</Link> · <Link href="/termos" className="hover:underline">Termos</Link></p>
    </aside>
  );
}
