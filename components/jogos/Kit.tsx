'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Avatar, BrandMark, Sheet } from '@/components/ui';
import { GameCfg, PAY_SOON } from '@/lib/jogos';

/** Saldo da carteira em MT. Ainda não existe carteira em meticais (pagamentos não estão ativos), por isso é sempre 0 MT —
 *  as moedas 🪙 da plataforma são outra coisa e não são convertidas. Trocar aqui quando a carteira M-Pesa/e-Mola existir. */
export function walletMZN(): number {
  return 0;
}

/** Cabeçalho da área Jogos & Torneios: marca TXAPILOG, pílula da carteira e avatar. */
export function JogosHeader({ back, backLabel }: { back?: string; backLabel?: string }) {
  const { s } = useStore();
  const [wallet, setWallet] = useState(false);
  const bal = walletMZN();
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/95 px-3 py-2.5">
      {back ? (
        <Link href={back} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel2 text-2xl leading-none" aria-label={backLabel ?? 'Voltar'}>‹</Link>
      ) : null}
      <Link href="/jogos" className="min-w-0 flex-1" aria-label="TXAPILOG · Jogos & Torneios"><BrandMark height={26} /></Link>
      <button type="button" onClick={() => setWallet(true)} className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border border-neon/50 bg-ink/60 px-3 text-sm" aria-label={`Carteira ${bal} MT`}>
        <span className="text-white/70">Carteira</span><span className="stat-num text-neon2">{bal.toLocaleString('pt-PT')} MT</span>
      </button>
      <Link href="/perfil" className="shrink-0" aria-label="O meu perfil"><Avatar a={s.user.avatar} name={s.user.name} size={40} className="ring-2 ring-neon/60" /></Link>
      <Sheet open={wallet} onClose={() => setWallet(false)} title="Carteira">
        <p className="stat-num text-3xl text-neon2">{bal.toLocaleString('pt-PT')} MT</p>
        <p className="mt-2 text-sm text-white/70">A carteira em meticais abre com os pagamentos M-Pesa/e-Mola. Até lá não é possível carregar nem levantar saldo.</p>
        <p className="mt-3 rounded-xl border border-neon/40 bg-neon/10 p-3 text-sm text-neon2">{PAY_SOON}</p>
      </Sheet>
    </header>
  );
}

export interface Slide { key: string; tag: string; tagCls: string; title: string; sub: string; cta: string; onCta?: () => void; href?: string; cover: string; emoji: string; note?: string }

/** Carrossel de flyers: setas "Flyer anterior/seguinte", pontos "Flyer N", volta ao início, deslizar com o dedo. Sem rotação automática. */
export function Carousel({ slides, label }: { slides: Slide[]; label: string }) {
  const [i, setI] = useState(0);
  const n = slides.length;
  const touch = useRef<number | null>(null);
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  if (!n) return null;
  const go = (k: number) => setI(((k % n) + n) % n);
  return (
    <section className="relative" aria-roledescription="carrossel" aria-label={label}>
      <div className="overflow-hidden rounded-2xl border border-line"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const x = touch.current; touch.current = null; if (x == null) return; const dx = e.changedTouches[0].clientX - x; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); }}>
        <div className="flex transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${i * 100}%)` }}>
          {slides.map((sl, k) => (
            <div key={sl.key} className="relative flex w-full shrink-0 items-stretch gap-3 bg-panel p-4 pr-3" aria-hidden={k !== i} role="group" aria-label={`Flyer ${k + 1} de ${n}`}>
              <div className="flex min-w-0 flex-1 flex-col items-start justify-center py-1 pl-7">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wider ${sl.tagCls}`}>{sl.tag}</span>
                <h2 className="mt-2 font-display text-2xl font-bold uppercase leading-tight">{sl.title}</h2>
                <p className="mt-1 text-xs leading-snug text-white/75">{sl.sub}</p>
                {sl.note && <p className="mt-1 text-[11px] text-white/50">{sl.note}</p>}
                {sl.href ? (
                  <Link href={sl.href} tabIndex={k === i ? 0 : -1} className="btn mt-3 !min-h-[40px] !px-4 !text-sm">{sl.cta}</Link>
                ) : (
                  <button type="button" tabIndex={k === i ? 0 : -1} onClick={sl.onCta} className="btn mt-3 !min-h-[40px] !px-4 !text-sm">{sl.cta}</button>
                )}
              </div>
              <div className={`mr-6 flex w-24 shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-br ${sl.cover} sm:w-32`} aria-hidden>
                <span className="text-4xl">{sl.emoji}</span>
                <span className="mt-1 font-display text-xs font-bold uppercase tracking-widest text-white/85">TXAPILOG</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {n > 1 && <>
        <button type="button" onClick={() => go(i - 1)} aria-label="Flyer anterior" className="absolute left-1 top-1/2 flex h-10 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-ink/70 text-2xl leading-none text-white">‹</button>
        <button type="button" onClick={() => go(i + 1)} aria-label="Flyer seguinte" className="absolute right-1 top-1/2 flex h-10 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-ink/70 text-2xl leading-none text-white">›</button>
      </>}
      {n > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {slides.map((sl, k) => (
            <button key={sl.key} type="button" onClick={() => go(k)} aria-label={`Flyer ${k + 1}`} aria-current={k === i}
              className="flex h-6 items-center justify-center px-0.5">
              <span className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${k === i ? 'w-6 bg-neon' : 'w-2 bg-white/35'}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Etiqueta para conteúdo que não é real. */
export function ExampleTag({ className = '' }: { className?: string }) {
  return <span className={`inline-flex items-center rounded border border-white/25 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60 ${className}`}>Dados de exemplo</span>;
}

/** Aviso de pagamentos ainda não ativos (sem sucesso falso). */
export function PaySoon() {
  return (
    <div role="status" className="rounded-xl border border-neon/50 bg-neon/10 p-3 text-sm">
      <p className="font-bold text-neon2">⏳ {PAY_SOON}</p>
      <p className="mt-1 text-xs text-white/70">Nada foi cobrado. Avisamos quando os pagamentos estiverem ativos.</p>
    </div>
  );
}

export function GameIcon({ g, size = 44 }: { g: GameCfg; size?: number }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${g.cover} font-display font-bold text-white`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>{g.abbr}</span>
  );
}

export function SummaryRow({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 text-sm last:border-0"><span className="text-white/65">{k}</span><span className={`text-right ${strong ? 'stat-num text-lg text-neon2' : 'font-semibold'}`}>{v}</span></div>;
}

export { Sheet };
