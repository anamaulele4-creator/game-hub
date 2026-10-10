// Qualidade adaptativa ("as telas adaptam-se ao dispositivo").
// Escolhe um nível low / medium / high a partir de sinais do próprio aparelho e da rede, guarda-o,
// e permite à pessoa escolher à mão em Definições › Qualidade. Funções puras (testadas em tests/quality.test.mjs);
// a parte React (contexto + medição de fps) vive em components/QualityProvider.tsx.

export type QualityTier = 'low' | 'medium' | 'high';
/** Escolha da pessoa. 'auto' = decide o aparelho. */
export type QualityMode = 'auto' | 'high' | 'medium' | 'low';

export const QUALITY_MODES: { mode: QualityMode; label: string; help: string }[] = [
  { mode: 'auto', label: 'Automática', help: 'A TXAPILOG escolhe pela memória, rede e velocidade do teu telemóvel.' },
  { mode: 'high', label: 'Alta', help: 'Imagens nítidas, vídeos pré-carregados e todas as animações.' },
  { mode: 'medium', label: 'Equilibrada', help: 'Boa qualidade com menos consumo de bateria.' },
  { mode: 'low', label: 'Poupança de dados', help: 'Imagens leves, vídeos só ao tocar, sem efeitos de desfoque.' },
];

export const TIER_LABEL: Record<QualityTier, string> = { high: 'Alta', medium: 'Equilibrada', low: 'Poupança de dados' };

export interface DeviceSignals {
  /** navigator.deviceMemory (GB, arredondado pelo browser: 0.25 … 8) */
  memory?: number;
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.connection.effectiveType: 'slow-2g' | '2g' | '3g' | '4g' */
  effectiveType?: string;
  /** navigator.connection.saveData (Poupança de dados do Android/Chrome) */
  saveData?: boolean;
  devicePixelRatio?: number;
  reducedMotion?: boolean;
  /** fps medido (requestAnimationFrame) nos primeiros segundos */
  fps?: number;
}

/**
 * Pontuação simples e explicável. Sinais desconhecidos não penalizam (Safari não expõe memória nem rede).
 * saveData ou rede 2G forçam 'low' (respeita a escolha do sistema e o custo dos dados móveis em Moçambique).
 */
export function scoreTier(sig: DeviceSignals): QualityTier {
  const et = (sig.effectiveType || '').toLowerCase();
  if (sig.saveData || et === 'slow-2g' || et === '2g') return 'low';
  if (typeof sig.fps === 'number' && sig.fps > 0 && sig.fps < 30) return 'low';
  let score = 0;
  if (typeof sig.memory === 'number') score += sig.memory <= 1 ? -3 : sig.memory <= 2 ? -2 : sig.memory <= 3 ? -1 : sig.memory >= 6 ? 1 : 0;
  if (typeof sig.cores === 'number') score += sig.cores <= 2 ? -2 : sig.cores <= 4 ? -1 : sig.cores >= 8 ? 1 : 0;
  if (et === '3g') score -= 2;
  if (typeof sig.fps === 'number' && sig.fps > 0) score += sig.fps < 45 ? -2 : sig.fps >= 55 ? 1 : 0;
  if (typeof sig.devicePixelRatio === 'number' && sig.devicePixelRatio >= 2.5) score += 0; // ecrã denso: não é sinal de potência
  if (score <= -3) return 'low';
  if (score <= -1) return 'medium';
  return score >= 1 ? 'high' : 'medium';
}

/** Nível efetivo: escolha manual vence; 'auto' usa o medido. */
export function effectiveTier(mode: QualityMode, auto: QualityTier): QualityTier {
  return mode === 'auto' ? auto : mode;
}

/** Larguras disponíveis das imagens otimizadas (public/games/*-{w}.webp). */
export const IMAGE_WIDTHS = [480, 960, 1600] as const;

/** Larguras permitidas por nível (srcset filtrado: em poupança nunca se descarrega a versão grande). */
export function allowedWidths(tier: QualityTier): number[] {
  return tier === 'low' ? [480] : tier === 'medium' ? [480, 960] : [480, 960, 1600];
}

/** Largura ideal para uma caixa com `cssWidth` px num ecrã com `dpr` (limitado pelo nível). */
export function pickWidth(tier: QualityTier, cssWidth: number, dpr = 1): number {
  const ws = allowedWidths(tier);
  const cap = tier === 'low' ? 1 : tier === 'medium' ? Math.min(dpr, 2) : Math.min(dpr, 3);
  const need = cssWidth * cap;
  return ws.find((w) => w >= need) ?? ws[ws.length - 1];
}

export interface VideoPolicy { preload: 'none' | 'metadata' | 'auto'; autoplay: boolean }

/** Vídeo: em poupança só carrega ao tocar; equilibrada pede metadados; alta pré-carrega o visível. */
export function videoPolicy(tier: QualityTier, autoplayPref = true): VideoPolicy {
  if (tier === 'low') return { preload: 'none', autoplay: false };
  return { preload: tier === 'high' ? 'auto' : 'metadata', autoplay: autoplayPref };
}

export interface CameraProfile { startLow: boolean; fps: number }

/** Câmara: em aparelhos fracos começa logo em 540p e 24 fps (lib/cameraFx desenha o mesmo, só menos píxeis). */
export function cameraProfile(tier: QualityTier): CameraProfile {
  return tier === 'low' ? { startLow: true, fps: 24 } : { startLow: false, fps: 30 };
}

/* ---------- persistência ---------- */
export const QUALITY_KEY = 'txp-quality-v1';

export interface QualityPrefs {
  mode: QualityMode;
  autoplay: boolean;
  /** último nível automático medido (para arrancar logo certo na próxima visita) */
  auto?: QualityTier;
  fps?: number;
}

export const DEFAULT_PREFS: QualityPrefs = { mode: 'auto', autoplay: true };

export function parsePrefs(raw: string | null | undefined): QualityPrefs {
  try {
    const p = JSON.parse(raw || '{}') as Partial<QualityPrefs>;
    const mode: QualityMode = p.mode === 'high' || p.mode === 'medium' || p.mode === 'low' ? p.mode : 'auto';
    const auto: QualityTier | undefined = p.auto === 'low' || p.auto === 'medium' || p.auto === 'high' ? p.auto : undefined;
    return { mode, autoplay: p.autoplay !== false, auto, fps: typeof p.fps === 'number' ? p.fps : undefined };
  } catch { return { ...DEFAULT_PREFS }; }
}

/** Lê os sinais do navegador (sem fps). Seguro em SSR. */
export function readSignals(): DeviceSignals {
  if (typeof navigator === 'undefined') return {};
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; saveData?: boolean } };
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
  return {
    memory: n.deviceMemory, cores: n.hardwareConcurrency,
    effectiveType: n.connection?.effectiveType, saveData: n.connection?.saveData,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : undefined, reducedMotion,
  };
}
