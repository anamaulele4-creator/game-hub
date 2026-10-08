'use client';

import { useStore, State } from '@/lib/store';

export function useAdmin() {
  const st = useStore();
  const a = st.s.admin;
  const upd = (patch: Partial<State['admin']>) => st.set((p) => ({ ...p, admin: { ...p.admin, ...patch } }));
  const act = (action: string, target: string, msg?: string) => { st.audit(action, target); if (msg) st.toast(msg); };
  return { ...st, a, upd, act };
}

export function Confirm({ onYes, label, className, question }: { onYes: () => void; label: string; className?: string; question: string }) {
  return <button className={className} onClick={() => { if (window.confirm(question)) onYes(); }}>{label}</button>;
}

export function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'red' | 'amber' | 'blue' }) {
  const c = { gray: 'bg-white/10', green: 'bg-lime text-black', red: 'bg-red-600', amber: 'bg-amber-400 text-black', blue: 'bg-neon2 text-black' }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c}`}>{children}</span>;
}
