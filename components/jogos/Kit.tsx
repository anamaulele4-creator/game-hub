'use client';

// Kit visual da área /jogos — cópia fiel do protótipo Claude "TXAPZONE" (fundo quase preto, cartões cinza-escuro,
// laranja #FF6B1A como único acento). Estilos em app/globals.css, todos com prefixo .tz (não afetam o resto da app).

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { GameCfg, GameKey, PAY_SOON, initials } from '@/lib/jogos';
import { GameCover, GameIconImg } from '@/components/GameArt';

/** Saldo da carteira em MT. Ainda não existe carteira em meticais (pagamentos não estão ativos), por isso é sempre 0 MT —
 *  as moedas 🪙 da plataforma são outra coisa e não são convertidas. Trocar aqui quando a carteira M-Pesa/e-Mola existir. */
export function walletMZN(): number {
  return 0;
}

/** Sobe ao topo do contentor da área (a área tem scroll próprio). */
export function tzScrollTop() {
  document.getElementById('tz-scroll')?.scrollTo({ top: 0, behavior: 'auto' });
}

function Gamepad({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="1.5" y="6" width="21" height="12.5" rx="6.25" fill="#FF6B1A" />
      <path d="M7.5 9.6v5M5 12.1h5" stroke="#0E0E10" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="15.6" cy="10.9" r="1.25" fill="#0E0E10" />
      <circle cx="18.2" cy="13.4" r="1.25" fill="#0E0E10" />
    </svg>
  );
}

/** Contentor da área: ocupa o ecrã inteiro por cima da app (esconde o cromado global da TXAPILOG). */
export function TzShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="tz" id="tz-scroll">
      <TzHeader />
      {children}
    </div>
  );
}

/** Cabeçalho do protótipo: logo com comando + "TXAPZONE"; à direita "Carteira 0 MT" e avatar circular com iniciais. */
export function TzHeader() {
  const { s } = useStore();
  const [wallet, setWallet] = useState(false);
  const [menu, setMenu] = useState(false);
  const bal = walletMZN();
  const ini = initials(s.user.name && s.user.name !== 'Visitante' ? s.user.name : s.account?.email ?? '');
  return (
    <header className="sticky top-0 z-30 border-b border-[#1F1F23] bg-[#0E0E10]/95 backdrop-blur">
      <div className="tz-wrap flex h-[60px] items-center gap-2">
        <Link href="/jogos" className="flex min-w-0 flex-1 items-center gap-2" aria-label="TXAPZONE · início">
          <Gamepad />
          <span className="truncate text-[17px] font-extrabold tracking-[.08em]">TXAPZONE</span>
        </Link>
        <button type="button" onClick={() => setWallet(true)} className="tz-pill flex h-11 shrink-0 items-center gap-1.5 px-3.5 text-[13px] transition-colors hover:border-[#3F3F46]" aria-label={`Carteira ${bal} MT`}>
          <span className="tz-muted max-[399px]:hidden">Carteira</span><span className="font-semibold tabular-nums">{bal.toLocaleString('pt-PT')} MT</span>
        </button>
        <button type="button" onClick={() => setMenu(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#27272A] text-[13px] font-semibold text-white ring-1 ring-[#3F3F46] transition-colors hover:ring-[#FF6B1A]" aria-label="Menu da conta">
          {ini}
        </button>
      </div>
      <TzSheet open={wallet} onClose={() => setWallet(false)} title="Carteira">
        <p className="text-3xl font-bold tabular-nums">{bal.toLocaleString('pt-PT')} MT</p>
        <p className="tz-muted mt-2 text-sm">A carteira em meticais abre com os pagamentos M-Pesa/e-Mola. Até lá não é possível carregar nem levantar saldo.</p>
        <PaySoon className="mt-3" />
      </TzSheet>
      <TzSheet open={menu} onClose={() => setMenu(false)} title={s.user.name || 'Conta'}>
        <div className="grid gap-2">
          <Link href="/" className="tz-card flex min-h-[48px] items-center px-4 text-sm font-semibold">‹ Voltar à TXAPILOG</Link>
          <Link href="/perfil" className="tz-card flex min-h-[48px] items-center px-4 text-sm font-semibold">O meu perfil</Link>
          <Link href="/torneios" className="tz-card flex min-h-[48px] items-center px-4 text-sm font-semibold">Todos os torneios</Link>
        </div>
      </TzSheet>
    </header>
  );
}

/** Folha inferior no estilo escuro da área. */
export function TzSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex animate-fadeIn items-end justify-center bg-black/70 sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[85vh] w-full max-w-md animate-sheetIn overflow-y-auto rounded-t-2xl border border-[#2A2A2F] bg-[#141416] p-5 pb-8 text-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#222226] transition-colors hover:bg-[#2A2A2F]" aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface Slide { key: string; tag: string; tagBg: string; tagFg: string; title: string; sub: string; cta: string; onCta?: () => void; href?: string; example?: boolean; /** capa real do jogo por trás do flyer */ game?: GameKey }

/** Carrossel de flyers do protótipo: setas ‹ › "Flyer anterior/seguinte" nas margens, pontos (ativo = pílula laranja), volta ao início. */
export function Carousel({ slides, label }: { slides: Slide[]; label: string }) {
  const [i, setI] = useState(0);
  const n = slides.length;
  const touch = useRef<number | null>(null);
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  if (!n) return null;
  const go = (k: number) => setI(((k % n) + n) % n);
  return (
    <section className="relative" aria-roledescription="carrossel" aria-label={label}>
      <div className="overflow-hidden rounded-2xl border border-[#2A2A2F] bg-[#18181B] shadow-[0_24px_60px_-24px_rgba(0,0,0,.8)]"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const x = touch.current; touch.current = null; if (x == null) return; const dx = e.changedTouches[0].clientX - x; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); }}>
        <div className="flex transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${i * 100}%)` }}>
          {slides.map((sl, k) => (
            <div key={sl.key} className="relative flex min-h-[230px] w-full shrink-0 items-end overflow-hidden sm:min-h-[300px] lg:min-h-[340px]" aria-hidden={k !== i} role="group" aria-label={`Flyer ${k + 1} de ${n}`}>
              {sl.game && <GameCover game={sl.game} priority={k === 0} sizes="(min-width: 1120px) 1088px, 100vw" shade={false} alt="" />}
              <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(14,14,16,.94)_0%,rgba(14,14,16,.78)_42%,rgba(14,14,16,.15)_100%)]" aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0E0E10]/90 to-transparent sm:hidden" aria-hidden />
              <div className="relative flex min-w-0 max-w-[560px] flex-1 flex-col items-start justify-end pb-6 pl-12 pr-14 pt-10 sm:px-16 sm:pb-9">
                <span className="tz-tag" style={{ background: sl.tagBg, color: sl.tagFg }}>{sl.tag}</span>
                <h2 className="mt-3 text-[24px] font-extrabold leading-[1.1] tracking-tight [text-wrap:balance] sm:text-[38px]">{sl.title}</h2>
                <p className="mt-1.5 text-[13px] leading-snug text-[#D4D4D8] sm:text-[15px]">{sl.sub}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {sl.href ? (
                    <Link href={sl.href} tabIndex={k === i ? 0 : -1} className="tz-btn !min-h-[44px]">{sl.cta}</Link>
                  ) : (
                    <button type="button" tabIndex={k === i ? 0 : -1} onClick={sl.onCta} className="tz-btn !min-h-[44px]">{sl.cta}</button>
                  )}
                  {sl.example && <ExampleTag />}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {n > 1 && <>
        <button type="button" onClick={() => go(i - 1)} aria-label="Flyer anterior" className="absolute left-1.5 top-1/2 flex h-11 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-[#0E0E10]/70 text-xl leading-none text-white backdrop-blur transition-colors hover:bg-[#0E0E10]/90 sm:left-3 sm:w-11">‹</button>
        <button type="button" onClick={() => go(i + 1)} aria-label="Flyer seguinte" className="absolute right-1.5 top-1/2 flex h-11 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-[#0E0E10]/70 text-xl leading-none text-white backdrop-blur transition-colors hover:bg-[#0E0E10]/90 sm:right-3 sm:w-11">›</button>
      </>}
      {n > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1">
          {slides.map((sl, k) => (
            <button key={sl.key} type="button" onClick={() => go(k)} aria-label={`Flyer ${k + 1}`} aria-current={k === i}
              className="flex h-7 min-w-[28px] items-center justify-center px-0.5">
              <span className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${k === i ? 'w-6 bg-[#FF6B1A]' : 'w-2 bg-[#3F3F46]'}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Etiqueta discreta para conteúdo que não é real. */
export function ExampleTag({ className = '' }: { className?: string }) {
  return <span className={`inline-flex w-fit items-center rounded-md border border-[#3F3F46] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#A1A1AA] ${className}`}>Dados de exemplo</span>;
}

/** Aviso de pagamentos ainda não ativos (sem sucesso falso). */
export function PaySoon({ className = '' }: { className?: string }) {
  return (
    <div role="status" className={`rounded-xl border border-[#FF6B1A]/50 bg-[#FF6B1A]/10 p-3 text-sm ${className}`}>
      <p className="font-semibold text-[#FF8A4A]">{PAY_SOON} – Nada foi cobrado</p>
      <p className="mt-1 text-xs text-[#A1A1AA]">Avisamos quando os pagamentos estiverem ativos.</p>
    </div>
  );
}

/** Ícone do jogo: ícone oficial (Play Store); "Outros" usa a sigla na cor do jogo. */
export function GameIcon({ g, size = 44 }: { g: GameCfg; size?: number }) {
  return <GameIconImg game={g.key} size={size} />;
}

/** Esqueleto escuro da área TXAPZONE. */
export function TzSkeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`tz-skel block rounded-xl ${className}`} />;
}

export function SummaryRow({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-[#2A2A2F] py-2 text-sm last:border-0"><span className="text-[#A1A1AA]">{k}</span><span className={`text-right ${strong ? 'text-base font-bold text-[#FF6B1A]' : 'font-medium'}`}>{v}</span></div>;
}
