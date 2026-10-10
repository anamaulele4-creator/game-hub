'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { PUSH_CATEGORIES, enablePush, permission, registerSW, syncPush } from '@/lib/push';
import { useInstall } from './Install';
import { isPublic } from '@/lib/routes';
import { IS_DEMO } from '@/lib/config';

const LEGAL = ['/privacidade', '/termos', '/diretrizes', '/seguranca-infantil', '/seguranca-dados', '/cookies', '/reembolsos', '/eliminar-conta', '/legal'];

// Carregado depois da página (dynamic, ssr:false) para não pesar no primeiro carregamento.
export default function SystemOverlays() {
  const { s, set, ready } = useStore();
  const path = (usePathname() || '/').replace(process.env.NEXT_PUBLIC_BASE_PATH ?? '', '') || '/';
  const isLegal = LEGAL.some((l) => path.startsWith(l)) || isPublic(path) || (!IS_DEMO && !s.account.loggedIn);
  const { status, install } = useInstall();
  const [offline, setOffline] = useState(false);
  useEffect(() => { setOffline(!navigator.onLine); const on = () => setOffline(false); const off = () => setOffline(true); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  const [c, setC] = useState({ terms: false, privacy: false, personalizedAds: false, analytics: false });

  useEffect(() => {
    const go = () => { void registerSW(); };
    if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(go); else setTimeout(go, 2000);
  }, []);

  // Notificações push: renova a subscrição em cada entrada; se ainda não houver permissão, mostra o convite.
  const [askPush, setAskPush] = useState(false);
  const loggedIn = IS_DEMO ? false : s.account.loggedIn;
  useEffect(() => {
    if (!ready || !loggedIn || !s.consent.done) return;
    const perm = permission();
    const cats = PUSH_CATEGORIES.filter((c) => s.notifPrefs[c.id]?.push !== false).map((c) => c.id);
    if (perm === 'granted') {
      if (s.pushEnabled || !localStorage.getItem('push-off')) void syncPush(cats).then((r) => { if (r.ok && !s.pushEnabled) set((p) => ({ ...p, pushEnabled: true })); });
    } else if (perm === 'default') {
      const later = Number(localStorage.getItem('push-ask-later') || 0);
      if (Date.now() - later > 3 * 86400_000) { const t = setTimeout(() => setAskPush(true), 4000); return () => clearTimeout(t); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loggedIn, s.consent.done]);

  if (!ready) return null;
  const st = s.admin.settings;
  const isAdmin = s.user.role === 'admin';

  return (
    <>
      {askPush && !isLegal && (
        <div className="fixed bottom-[calc(var(--nav-h)+1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[60] w-[94%] max-w-sm -translate-x-1/2 rounded-2xl border border-neon/50 bg-panel p-4 shadow-2xl" role="dialog" aria-label="Ativar notificações">
          <p className="font-bold">🔔 Ativa as notificações</p>
          <p className="mt-1 text-xs text-white/70">Recebe mensagens, chamadas, lives e torneios no ecrã, mesmo com a TXAPILOG fechada.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn flex-1 !py-2 text-sm" onClick={async () => { setAskPush(false); const r = await enablePush(PUSH_CATEGORIES.filter((c) => s.notifPrefs[c.id]?.push !== false).map((c) => c.id)); if (r.ok) set((p) => ({ ...p, pushEnabled: true })); else localStorage.setItem('push-ask-later', String(Date.now())); }}>Ativar</button>
            <button className="btn-ghost flex-1 !py-2 text-sm" onClick={() => { setAskPush(false); localStorage.setItem('push-ask-later', String(Date.now())); }}>Agora não</button>
          </div>
        </div>
      )}
      {offline && <div className="fixed left-0 right-0 top-0 z-[95] mx-auto max-w-[var(--col)] bg-neon py-1 text-center text-xs font-semibold text-black">📡 Sem internet — a mostrar o que já foi carregado</div>}
      {st.banner.on && (
        <div className={`fixed left-0 right-0 top-[56px] z-[25] mx-auto max-w-[var(--col)] px-3 py-1.5 text-center text-xs ${st.banner.tone === 'aviso' ? 'bg-neon text-black' : st.banner.tone === 'promo' ? 'bg-neon' : 'bg-neon2 text-black'}`}>{st.banner.text}</div>
      )}

      {st.maintenance && !isLegal && (isAdmin ? (
        <div className="fixed bottom-[calc(var(--nav-h)+.75rem+env(safe-area-inset-bottom))] left-1/2 z-[45] w-[92%] max-w-sm -translate-x-1/2 rounded-xl bg-neon px-3 py-2 text-center text-xs text-black">🛠️ Modo manutenção ATIVO · só administradores veem a app · <Link href="/admin" className="underline">Admin</Link></div>
      ) : (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-bg p-8 text-center"><p className="text-5xl">🛠️</p><p className="text-lg font-bold">Em manutenção</p><p className="text-sm text-white/70">{st.maintenanceMsg}</p></div>
      ))}

      {!s.consent.done && !isLegal && (
        <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/70">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-neon/40 bg-panel p-5">
            <p className="text-lg font-bold">Bem-vindo ao TXAPILOG 🎮</p>
            <p className="mt-1 text-xs text-white/70">Antes de continuar, confirma as tuas escolhas. Podes mudar a qualquer momento em Definições › Privacidade.</p>
            <div className="mt-3 space-y-2 text-sm">
              <label className="flex gap-3 rounded-xl bg-panel2 p-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-neon" checked={c.terms} onChange={() => setC({ ...c, terms: !c.terms })} /><span>Tenho <b>13 anos ou mais</b> e aceito os <Link className="text-neon2 underline" href="/termos">Termos de Uso</Link> e as <Link className="text-neon2 underline" href="/diretrizes">Diretrizes</Link>. <i className="text-white/50">(obrigatório)</i></span></label>
              <label className="flex gap-3 rounded-xl bg-panel2 p-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-neon" checked={c.privacy} onChange={() => setC({ ...c, privacy: !c.privacy })} /><span>Li a <Link className="text-neon2 underline" href="/privacidade">Política de Privacidade</Link> e o uso de <Link className="text-neon2 underline" href="/cookies">armazenamento local</Link>. <i className="text-white/50">(obrigatório)</i></span></label>
              <label className="flex gap-3 rounded-xl bg-panel2 p-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-neon" checked={c.personalizedAds} onChange={() => setC({ ...c, personalizedAds: !c.personalizedAds })} /><span>Anúncios personalizados (idade, província, jogos). Sem isto vês anúncios genéricos. <i className="text-white/50">(opcional)</i></span></label>
              <label className="flex gap-3 rounded-xl bg-panel2 p-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-neon" checked={c.analytics} onChange={() => setC({ ...c, analytics: !c.analytics })} /><span>Estatísticas anónimas para melhorar a app. <i className="text-white/50">(opcional)</i></span></label>
            </div>
            <button className="btn mt-4 w-full" disabled={!c.terms || !c.privacy} onClick={() => set((p) => ({ ...p, consent: { ...c, done: true, date: new Date().toISOString() } }))}>Continuar</button>
            <button className="mt-2 w-full text-xs text-white/50" onClick={() => setC({ terms: c.terms, privacy: c.privacy, personalizedAds: false, analytics: false })}>Recusar opcionais</button>
          </div>
        </div>
      )}

      {s.consent.done && !s.installDismissed && status !== 'installed' && status !== 'loading' && path === '/' && (
        <div className="fixed bottom-[calc(var(--nav-h)+.75rem+env(safe-area-inset-bottom))] left-1/2 z-[44] w-[94%] max-w-sm -translate-x-1/2 rounded-2xl border border-neon/50 bg-panel2 p-3 shadow-lg">
          <div className="flex items-center gap-3">
            <img src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/icons/icon-192.png`} alt="" width={40} height={40} className="rounded-xl" />
            <Link href="/baixar" className="flex-1 text-xs"><p className="font-semibold">Instala o TXAPILOG</p><p className="text-white/60">Abre num toque, funciona offline e recebe alertas de lives.</p></Link>
            {status === 'prompt'
              ? <button className="btn !min-h-0 !px-3 !py-1.5 text-xs" onClick={async () => { if ((await install()) === 'accepted') set((p) => ({ ...p, installDismissed: true })); }}>📲 Instalar</button>
              : <Link href="/baixar" className="btn !min-h-0 !px-3 !py-1.5 text-xs">📲 Instalar</Link>}
            <button className="p-1 text-white/40" aria-label="Fechar" onClick={() => set((p) => ({ ...p, installDismissed: true }))}>✕</button>
          </div>
        </div>
      )}
    </>
  );
}
