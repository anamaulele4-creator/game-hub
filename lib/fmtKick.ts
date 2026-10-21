// Data/hora de um jogo: "Hoje · 18h", "Amanhã · 15h30", "Sáb 24 Out · 17h".
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export function fmtKick(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(now))) / 86400e3);
  const hm = `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
  const lbl = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : diff === -1 ? 'Ontem' : `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]}`;
  return `${lbl} · ${hm}`;
}
