'use client';
// Qualidade adaptativa: escolhe "alta", "equilibrada" ou "poupança" a partir do dispositivo e da rede
// (navigator.connection, deviceMemory, hardwareConcurrency, devicePixelRatio, prefers-reduced-motion)
// ou da escolha do utilizador em Definições (guardada em localStorage).
// O nível é aplicado em <html data-quality="…" data-motion="…"> para o CSS e lido por imagens, vídeos e câmara.
// As regras puras estão em lib/qualityCore.ts (testadas em tests/quality.test.mjs).

import { useEffect, useSyncExternalStore } from 'react';

import { QUALITY_KEY, isPref, resolveLevel } from './qualityCore';
import type { QualityLevel, QualityPref, QualitySignals } from './qualityCore';
export * from './qualityCore';

/* ---------------- Estado no browser ---------------- */

type Conn = { effectiveType?: string; saveData?: boolean; downlink?: number; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
const conn = (): Conn | undefined => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: Conn }).connection);

export function readSignals(): QualitySignals {
  if (typeof window === 'undefined') return {};
  const c = conn();
  const nav = navigator as Navigator & { deviceMemory?: number };
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
  return { effectiveType: c?.effectiveType, saveData: c?.saveData, downlink: c?.downlink, deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency, dpr: window.devicePixelRatio || 1, reducedMotion };
}

export function readPref(): QualityPref {
  try { const v = localStorage.getItem(QUALITY_KEY); return isPref(v) ? v : 'auto'; } catch { return 'auto'; }
}

interface Snap { pref: QualityPref; level: QualityLevel; reducedMotion: boolean; dpr: number }
let snap: Snap = { pref: 'auto', level: 'equilibrada', reducedMotion: false, dpr: 1 };
const subs = new Set<() => void>();

function compute(): Snap {
  const s = readSignals();
  const pref = readPref();
  return { pref, level: resolveLevel(pref, s), reducedMotion: !!s.reducedMotion, dpr: s.dpr ?? 1 };
}

function apply(next: Snap) {
  const changed = next.pref !== snap.pref || next.level !== snap.level || next.reducedMotion !== snap.reducedMotion || next.dpr !== snap.dpr;
  snap = next;
  if (typeof document !== 'undefined') {
    const el = document.documentElement;
    el.dataset.quality = next.level;
    el.dataset.motion = next.reducedMotion || next.level === 'poupanca' ? 'reduce' : 'full';
  }
  if (changed) subs.forEach((f) => f());
}

/** Nível atual (para código fora do React, ex.: câmara). */
export function getQuality(): QualityLevel {
  if (typeof document !== 'undefined') {
    const q = document.documentElement.dataset.quality;
    if (q === 'alta' || q === 'equilibrada' || q === 'poupanca') return q;
  }
  return snap.level;
}

export function setQualityPref(p: QualityPref) {
  try { if (p === 'auto') localStorage.removeItem(QUALITY_KEY); else localStorage.setItem(QUALITY_KEY, p); } catch {}
  apply(compute());
}

const SERVER: Snap = { pref: 'auto', level: 'equilibrada', reducedMotion: false, dpr: 1 };

/** Hook: { pref, level, reducedMotion, dpr }. No servidor (export estático) devolve "equilibrada". */
export function useQuality(): Snap {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => snap,
    () => SERVER,
  );
}

/** Montado uma vez no layout: calcula o nível e segue mudanças de rede, de movimento e de outra aba. */
export function QualityRoot() {
  useEffect(() => {
    apply(compute());
    const re = () => apply(compute());
    const c = conn();
    c?.addEventListener?.('change', re);
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener?.('change', re); } catch {}
    const onStorage = (e: StorageEvent) => { if (e.key === QUALITY_KEY) re(); };
    window.addEventListener('storage', onStorage);
    return () => { c?.removeEventListener?.('change', re); mq?.removeEventListener?.('change', re); window.removeEventListener('storage', onStorage); };
  }, []);
  return null;
}
