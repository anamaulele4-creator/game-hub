'use client';

// TXAPILOG IA em segundo plano: verificação de saúde periódica (auto-reparação), modo seguro e lembrete noturno.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';

const FIRST_MS = 20_000;
const EVERY_MS = 5 * 60_000;

export default function PoipakAI() {
  const { ready, toast } = useStore();
  const [safe, setSafe] = useState(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const run = () => { if (document.visibilityState === 'visible') void import('@/lib/poipakAI').then((m) => m.checkHealth()).then((h) => { if (alive) setSafe(h.safeMode); }).catch(() => {}); };
    const t = setTimeout(run, FIRST_MS);
    const iv = setInterval(run, EVERY_MS);
    window.addEventListener('online', run);
    // Lembrete gentil depois das 23:00 (uma vez por noite)
    const night = setInterval(() => {
      const d = new Date(); const h = d.getHours();
      if (h < 23 && h >= 5) return;
      const key = 'gh-ai-night-' + (h >= 23 ? d.toDateString() : new Date(d.getTime() - 86400000).toDateString());
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
      toastRef.current('🌙 TXAPILOG IA: já passa das 23:00. Dormir bem também melhora a tua mira. Até amanhã?');
    }, 60_000);
    return () => { alive = false; clearTimeout(t); clearInterval(iv); clearInterval(night); window.removeEventListener('online', run); };
  }, [ready]);

  if (!safe) return null;
  return (
    <div role="status" className="fixed left-1/2 top-2 z-[60] w-[92%] max-w-sm -translate-x-1/2 rounded-xl border border-line bg-panel px-3 py-2 text-center text-sm text-white/85">
      🩺 Modo seguro: sem ligação ao servidor. A mostrar o que está guardado — a TXAPILOG IA tenta de novo sozinha.
    </div>
  );
}
