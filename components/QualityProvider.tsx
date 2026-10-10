'use client';

// Contexto de qualidade adaptativa. Mede o aparelho (memória, núcleos, rede, poupança de dados, fps reais),
// guarda o resultado e expõe o nível efetivo. Escreve data-q="low|medium|high" no <html> para o CSS
// desligar desfoques e animações decorativas em telemóveis modestos.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PREFS, QUALITY_KEY, QualityMode, QualityPrefs, QualityTier, cameraProfile, effectiveTier, parsePrefs, readSignals, scoreTier, videoPolicy,
} from '@/lib/deviceQuality';

interface QualityCtx {
  tier: QualityTier;
  auto: QualityTier;
  mode: QualityMode;
  autoplay: boolean;
  fps?: number;
  reducedMotion: boolean;
  setMode: (m: QualityMode) => void;
  setAutoplay: (on: boolean) => void;
}

const Ctx = createContext<QualityCtx>({ tier: 'medium', auto: 'medium', mode: 'auto', autoplay: true, reducedMotion: false, setMode: () => {}, setAutoplay: () => {} });

/** Mede fps durante ~1,2 s com requestAnimationFrame (só com a página visível). */
function measureFps(ms = 1200): Promise<number> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined' || document.hidden) return resolve(0);
    let frames = 0; let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      frames++;
      if (t - t0 >= ms) resolve(Math.round((frames * 1000) / (t - t0)));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function save(p: QualityPrefs) { try { localStorage.setItem(QUALITY_KEY, JSON.stringify(p)); } catch {} }

export function QualityProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<QualityPrefs>(DEFAULT_PREFS);
  const [auto, setAuto] = useState<QualityTier>('medium');
  const [reducedMotion, setRM] = useState(false);

  useEffect(() => {
    const p = parsePrefs(typeof localStorage !== 'undefined' ? localStorage.getItem(QUALITY_KEY) : null);
    setPrefs(p);
    const sig = readSignals();
    setRM(!!sig.reducedMotion);
    // Arranca já com o último valor medido (ou só com os sinais) e afina com fps reais quando o browser estiver livre.
    setAuto(p.auto ?? scoreTier(sig));
    let alive = true;
    const run = async () => {
      const fps = await measureFps();
      if (!alive) return;
      const t = scoreTier({ ...readSignals(), fps: fps || undefined });
      setAuto(t);
      setPrefs((cur) => { const n = { ...cur, auto: t, fps: fps || cur.fps }; save(n); return n; });
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => void run(), { timeout: 2500 }) : window.setTimeout(() => void run(), 1500);
    // A rede pode mudar (Wi-Fi → dados móveis): reavaliar
    const conn = (navigator as Navigator & { connection?: EventTarget }).connection;
    const onNet = () => setAuto(scoreTier({ ...readSignals(), fps: undefined }));
    conn?.addEventListener?.('change', onNet);
    let mq: MediaQueryList | null = null;
    const onMq = () => setRM(!!mq?.matches);
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener?.('change', onMq); } catch {}
    return () => { alive = false; conn?.removeEventListener?.('change', onNet); mq?.removeEventListener?.('change', onMq); if (!w.requestIdleCallback) clearTimeout(id); };
  }, []);

  const tier = effectiveTier(prefs.mode, auto);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.q = tier;
    el.dataset.motion = reducedMotion ? 'reduce' : 'full';
  }, [tier, reducedMotion]);

  const setMode = useCallback((m: QualityMode) => setPrefs((cur) => { const n = { ...cur, mode: m }; save(n); return n; }), []);
  const setAutoplay = useCallback((on: boolean) => setPrefs((cur) => { const n = { ...cur, autoplay: on }; save(n); return n; }), []);

  const value = useMemo<QualityCtx>(() => ({ tier, auto, mode: prefs.mode, autoplay: prefs.autoplay, fps: prefs.fps, reducedMotion, setMode, setAutoplay }), [tier, auto, prefs.mode, prefs.autoplay, prefs.fps, reducedMotion, setMode, setAutoplay]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useQuality = () => useContext(Ctx);

/** Política de vídeo do nível atual (preload/autoplay). */
export function useVideoPolicy() {
  const q = useQuality();
  return videoPolicy(q.tier, q.autoplay);
}

/** Perfil de câmara do nível atual (fps e arranque em 540p). */
export function useCameraProfile() {
  return cameraProfile(useQuality().tier);
}
