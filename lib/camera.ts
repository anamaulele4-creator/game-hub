// Câmara TXAPILOG: filtros/stickers animados (ver lib/cameraFx.ts) + captura para /publicar.
export * from './cameraFx';

// ---------- Captura para /publicar ----------
export interface Capture { file: File; kind: 'video' | 'long' | 'photo' | 'meme'; duration?: number }
let pending: Capture | null = null;
export function setPendingCapture(c: Capture) { pending = c; }
export function takePendingCapture(): Capture | null { const c = pending; pending = null; return c; }

/** Formato de gravação suportado (mp4 se possível, senão webm). */
export function pickRecorderType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
  for (const t of list) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {} }
  return '';
}

export function stopStream(s?: MediaStream | null) {
  try { s?.getTracks().forEach((t) => { try { t.stop(); } catch {} }); } catch {}
}

/** Mensagem amigável para erros do getUserMedia. */
export function cameraError(e: unknown): string {
  const n = (e as { name?: string })?.name ?? '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Não deste permissão para usar a câmara. Podes ativá-la nas definições do navegador (ícone 🔒 na barra de endereço) ou escolher um ficheiro do dispositivo.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Não encontrámos nenhuma câmara neste dispositivo. Escolhe um ficheiro do dispositivo.';
  if (n === 'NotReadableError') return 'A câmara está a ser usada por outra app. Fecha a outra app e tenta outra vez.';
  return 'Não foi possível abrir a câmara neste navegador. Escolhe um ficheiro do dispositivo.';
}
