'use client';
// TXAPILOG · HUD gamer: emblemas de rank, barra de XP, chips de conquistas e selo AO VIVO.
// Tudo calculado a partir dos dados que já existem (XP, divisão, conquistas) — nada inventado.
import Link from 'next/link';
import { ACHIEVEMENTS, DIVISIONS, divisionFor, levelFor } from '@/lib/data';
import { useStore } from '@/lib/store';

type Div = (typeof DIVISIONS)[number];

/** Emblema de rank (Bronze → Lenda) com a cor da divisão. */
export function RankBadge({ name, size = 'md', iconOnly }: { name: string; size?: 'sm' | 'md'; iconOnly?: boolean }) {
  const d: Div = DIVISIONS.find((x) => x.name === name) ?? DIVISIONS[0];
  return (
    <span className={`rank-badge ${size === 'sm' ? 'rank-sm' : ''}`} style={{ ['--rank' as string]: d.color }} title={`Divisão ${d.name}`}>
      <span aria-hidden>{d.emoji}</span>{iconOnly ? <span className="sr-only">{d.name}</span> : d.name}
    </span>
  );
}

/** Barra de XP segmentada com brilho. */
export function XpBar({ pct, label }: { pct: number; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label ?? 'Progresso de XP'}>
      <span className="xp-fill" style={{ width: `${v}%` }} />
    </div>
  );
}

/** Selo AO VIVO com ponto a pulsar (pára com "reduzir movimento"). */
export function LiveBadge({ className = '', small }: { className?: string; small?: boolean }) {
  return <span className={`live-badge ${small ? 'live-sm' : ''} ${className}`}><span className="live-dot" aria-hidden />AO VIVO</span>;
}

/** Cartão de jogador do próprio perfil: nível, divisão, XP, sequência, moedas e conquistas. */
export function PlayerHud() {
  const { s } = useStore();
  const d = divisionFor(s.xp);
  const lv = levelFor(s.xp);
  const toNext = d.next ? d.next.minXp - s.xp : 0;
  const divPct = d.next ? ((s.xp - d.minXp) / (d.next.minXp - d.minXp)) * 100 : 100;
  const mine = ACHIEVEMENTS.filter((a) => s.achievements.includes(a.id));
  return (
    <div className="hud-card mt-3 p-3">
      <div className="flex items-center gap-3">
        <div className="level-hex" aria-label={`Nível ${lv.level}`}><span className="text-[10px] font-semibold leading-none text-ink/80">NV</span><span className="stat-num text-xl leading-none text-ink">{lv.level}</span></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <RankBadge name={d.name} />
            <span className="stat-num text-sm text-white/80">{s.xp.toLocaleString('pt-PT')} XP</span>
          </div>
          <div className="mt-2"><XpBar pct={lv.pct} label={`Nível ${lv.level}: ${lv.pct}%`} /></div>
          <p className="mt-1 flex justify-between text-[12px] text-white/70">
            <span><span className="stat-num">{250 - lv.into}</span> XP p/ nível {lv.level + 1}</span>
            {d.next ? <span><span className="stat-num">{toNext.toLocaleString('pt-PT')}</span> p/ {d.next.name}</span> : <span>Divisão máxima 👑</span>}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Link href="/missoes" className="hud-stat"><span className="stat-num text-lg">🔥{s.streak}</span><span className="text-[11px] text-white/70">Sequência</span></Link>
        <Link href="/loja" className="hud-stat"><span className="stat-num text-lg">🪙{s.coins}</span><span className="text-[11px] text-white/70">Moedas</span></Link>
        <Link href="/conquistas" className="hud-stat"><span className="stat-num text-lg">🏅{mine.length}<span className="text-white/50">/{ACHIEVEMENTS.length}</span></span><span className="text-[11px] text-white/70">Conquistas</span></Link>
      </div>
      {d.next && <div className="mt-2.5"><p className="mb-1 flex justify-between text-[11px] text-white/60"><span>Divisão {d.name}</span><span>{Math.round(divPct)}% até {d.next.name}</span></p><div className="h-1 overflow-hidden rounded bg-ink/60" aria-hidden><div className="h-1 rounded" style={{ width: `${Math.round(divPct)}%`, background: d.next.color }} /></div></div>}
      {mine.length > 0 && (
        <div className="no-scrollbar -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
          {mine.slice(0, 6).map((a) => <span key={a.id} className="ach-chip" title={a.desc}><span aria-hidden>{a.emoji}</span>{a.name}</span>)}
          {mine.length > 6 && <Link href="/conquistas" className="ach-chip">+{mine.length - 6}</Link>}
        </div>
      )}
    </div>
  );
}

/** Barra compacta de jogador para o Início (nível, divisão e XP). */
export function PlayerStrip() {
  const { s, ready } = useStore();
  if (!ready) return <div className="mx-4 mt-3 h-[62px] skeleton rounded-[20px] sm:mx-6" aria-hidden />;
  const d = divisionFor(s.xp);
  const lv = levelFor(s.xp);
  return (
    <Link href="/missoes" className="hud-card tap mx-4 mt-3 flex min-h-[62px] items-center gap-3 px-3.5 py-2.5 sm:mx-6" aria-label={`Nível ${lv.level}, divisão ${d.name}. Ver missões`}>
      <div className="level-hex !h-10 !w-10"><span className="stat-num text-base leading-none text-ink">{lv.level}</span></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><RankBadge name={d.name} size="sm" /><span className="stat-num text-[13px] text-white/80">{lv.into}/250 XP</span></div>
        <div className="mt-1.5"><XpBar pct={lv.pct} /></div>
      </div>
      <span className="stat-num shrink-0 text-sm text-neon">🔥{s.streak}</span>
    </Link>
  );
}
