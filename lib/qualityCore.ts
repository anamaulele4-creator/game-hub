// Qualidade adaptativa — regras puras (sem React), testadas em tests/quality.test.mjs.

export type QualityLevel = 'alta' | 'equilibrada' | 'poupanca';
export type QualityPref = 'auto' | QualityLevel;
export const QUALITY_KEY = 'txp-quality';
export const QUALITY_PREFS: { id: QualityPref; label: string; hint: string }[] = [
  { id: 'auto', label: 'Automática', hint: 'Ajusta à rede e ao telemóvel' },
  { id: 'alta', label: 'Alta', hint: 'Imagens nítidas, vídeos a tocar sozinhos' },
  { id: 'equilibrada', label: 'Equilibrada', hint: 'Boa imagem com menos dados' },
  { id: 'poupanca', label: 'Poupança de dados', hint: 'Sem autoplay, imagens leves, menos animação' },
];

export interface QualitySignals {
  effectiveType?: string; // 'slow-2g' | '2g' | '3g' | '4g'
  saveData?: boolean;
  downlink?: number; // Mb/s
  deviceMemory?: number; // GB (Chrome arredonda: 0.25…8)
  cores?: number;
  dpr?: number;
  reducedMotion?: boolean;
}

/** Decide o nível automático. Rede fraca ou "poupar dados" manda sempre; depois o hardware. */
export function detectLevel(s: QualitySignals): QualityLevel {
  if (s.saveData) return 'poupanca';
  const et = (s.effectiveType || '').toLowerCase();
  if (et === 'slow-2g' || et === '2g') return 'poupanca';
  if (typeof s.downlink === 'number' && s.downlink > 0 && s.downlink < 0.7) return 'poupanca';
  if (typeof s.deviceMemory === 'number' && s.deviceMemory > 0 && s.deviceMemory <= 1) return 'poupanca';
  if (et === '3g') return 'equilibrada';
  if (typeof s.downlink === 'number' && s.downlink > 0 && s.downlink < 2.5) return 'equilibrada';
  if (typeof s.deviceMemory === 'number' && s.deviceMemory > 0 && s.deviceMemory < 4) return 'equilibrada';
  if (typeof s.cores === 'number' && s.cores > 0 && s.cores <= 4) return 'equilibrada';
  return 'alta';
}

export function resolveLevel(pref: QualityPref, s: QualitySignals): QualityLevel {
  return pref === 'auto' ? detectLevel(s) : pref;
}

export function isPref(v: unknown): v is QualityPref {
  return v === 'auto' || v === 'alta' || v === 'equilibrada' || v === 'poupanca';
}

/** Largura de imagem (px) a pedir para uma caixa de `cssWidth` px. */
export function imageWidthFor(level: QualityLevel, cssWidth: number, dpr = 1): number {
  const factor = level === 'alta' ? Math.min(dpr || 1, 2) : level === 'equilibrada' ? Math.min(dpr || 1, 1.5) : 1;
  return Math.round(cssWidth * factor);
}

/** Política de vídeo por nível. */
export function videoPolicy(level: QualityLevel): { autoplay: boolean; preload: 'auto' | 'metadata' | 'none'; preloadNeighbours: boolean } {
  if (level === 'poupanca') return { autoplay: false, preload: 'none', preloadNeighbours: false };
  if (level === 'equilibrada') return { autoplay: true, preload: 'metadata', preloadNeighbours: true };
  return { autoplay: true, preload: 'auto', preloadNeighbours: true };
}

/** Resolução da câmara (lado maior / menor) e fps por nível. */
export function cameraProfile(level: QualityLevel): { long: number; short: number; fps: number } {
  if (level === 'poupanca') return { long: 960, short: 540, fps: 24 };
  return { long: 1280, short: 720, fps: 30 };
}

/** Script inline (antes da pintura) que aplica o nível guardado/detetado, para não haver "salto". Mantém a mesma regra que detectLevel. */
export const QUALITY_BOOT = `(function(){try{var d=document.documentElement,p=null;try{p=localStorage.getItem('${QUALITY_KEY}')}catch(_){}
var n=navigator,c=n.connection||{},m=n.deviceMemory,k=n.hardwareConcurrency,et=(c.effectiveType||'').toLowerCase(),dl=c.downlink,l='alta';
if(c.saveData||et==='slow-2g'||et==='2g'||(dl>0&&dl<0.7)||(m>0&&m<=1))l='poupanca';else if(et==='3g'||(dl>0&&dl<2.5)||(m>0&&m<4)||(k>0&&k<=4))l='equilibrada';
if(p==='alta'||p==='equilibrada'||p==='poupanca')l=p;var r=false;try{r=matchMedia('(prefers-reduced-motion: reduce)').matches}catch(_){}
d.dataset.quality=l;d.dataset.motion=(r||l==='poupanca')?'reduce':'full';}catch(_){}})();`;
