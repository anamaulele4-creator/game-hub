// Lives com a câmara da app (LiveKit). O cliente livekit-client só é carregado (import dinâmico) nas páginas de live.
// O token vem da Edge Function "livekit-token" (supabase/functions/livekit-token). Nunca lança erro: devolve { error }.
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const POIPAK_OFF_MSG = 'Live na câmara POIPAK a ser ativada — usa TikTok/YouTube/Facebook por agora.';
const FN = `${SUPABASE_URL}/functions/v1/livekit-token`;

export interface LkToken { token: string; url: string; room: string; role: 'host' | 'viewer' }

async function call(body: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; status?: number }> {
  if (IS_DEMO) return { ok: false, error: POIPAK_OFF_MSG };
  try {
    const { sb } = await import('./supabase');
    const c = await sb();
    const jwt = (await c.auth.getSession()).data.session?.access_token;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    const r = await fetch(FN, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${jwt ?? SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body),
    }).finally(() => clearTimeout(t));
    const data = await r.json().catch(() => null) as Record<string, unknown> | null;
    if (!r.ok || !data?.ok) return { ok: false, status: r.status, error: (data?.error as string) || POIPAK_OFF_MSG };
    return { ok: true, data };
  } catch {
    return { ok: false, error: POIPAK_OFF_MSG };
  }
}

let probeCache: Promise<boolean> | null = null;
/** A câmara POIPAK está ativa? (função publicada e com LIVEKIT_* configurado) */
export function poipakLiveAvailable(): Promise<boolean> {
  probeCache ??= call({ probe: true }).then((r) => r.ok).catch(() => false);
  return probeCache;
}

export async function getLiveToken(liveId: string): Promise<{ token?: LkToken; error?: string; off?: boolean }> {
  const r = await call({ live_id: liveId });
  if (!r.ok || !r.data) return { error: r.error, off: !r.status || r.status === 404 || r.status === 503 || r.status >= 500 };
  return { token: { token: String(r.data.token), url: String(r.data.url), room: String(r.data.room), role: r.data.role === 'host' ? 'host' : 'viewer' } };
}

/** Nome da sala novo (guardado em lives.stream_url como poipak://<sala>). */
export function newRoomName() {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `poipak-${id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40)}`;
}

export const loadLiveKit = () => import('livekit-client');
