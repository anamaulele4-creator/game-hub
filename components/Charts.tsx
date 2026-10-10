// Gráficos SVG leves (sem bibliotecas) — usados no Gestor de Anúncios e no Admin.
export function LineChart({ data, height = 120, color = '#FFC20E', fmt = (n: number) => String(Math.round(n)) }: { data: { label: string; value: number }[]; height?: number; color?: string; fmt?: (n: number) => string }) {
  const w = 320;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((d, i) => [i * step, height - 18 - (d.value / max) * (height - 30)] as const);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = pts.length ? `${path} L${w},${height - 18} L0,${height - 18} Z` : '';
  // Muitos pontos: mostra ~8 rótulos (sempre o último) para não se sobreporem
  const every = Math.max(1, Math.ceil(data.length / 8));
  const showLabel = (i: number) => i === data.length - 1 || (i % every === 0 && data.length - 1 - i >= every);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="Gráfico">
      <defs><linearGradient id={`lc${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#lc${color.slice(1)})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={color} />)}
      {data.map((d, i) => !showLabel(i) ? null : <text key={i} x={Math.min(w - 12, Math.max(12, i * step))} y={height - 4} fontSize="9" textAnchor="middle" fill="rgba(255,255,255,.5)">{d.label}</text>)}
      <text x="2" y="10" fontSize="9" fill="rgba(255,255,255,.5)">máx {fmt(max)}</text>
    </svg>
  );
}

export function Bars({ data, fmt = (n: number) => String(n) }: { data: { label: string; value: number }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex justify-between text-xs"><span className="truncate pr-2">{d.label}</span><span>{fmt(d.value)}</span></div>
          <div className="mt-1 h-2 rounded bg-panel2"><div className="h-2 rounded bg-gradient-to-r from-neon to-neon2" style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
