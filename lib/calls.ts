// Chamadas de voz e vídeo (1:1 e grupo) pela plataforma, com LiveKit.
//  · Token: Edge Function "livekit-token" com { call_conversation_id } → sala "call-<conversa>" (só membros).
//  · Toque: Supabase Realtime broadcast no canal "ring:<utilizador>" (ring / decline / hangup).
//  · Registo: mensagem do tipo 'chamada' na conversa ("Chamada de voz · 3 min").
// Enquanto a função não estiver publicada com suporte a chamadas, callsAvailable() = false e a app mostra
// "Chamadas a ser ativadas em breve" sem erros.
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const CALLS_OFF_MSG = 'Chamadas a ser ativadas em breve 📞';
const FN = `${SUPABASE_URL}/functions/v1/livekit-token`;
export const RING_TIMEOUT_MS = 45_000;

async function fn(body: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; status?: number }> {
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
    const data = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (!r.ok || !data?.ok) return { ok: false, status: r.status, error: (data?.error as string) || CALLS_OFF_MSG };
    return { ok: true, data };
  } catch {
    return { ok: false, error: CALLS_OFF_MSG };
  }
}

let probe: Promise<boolean> | null = null;
/** As chamadas estão ativas? (função publicada, segredos LIVEKIT_* definidos e versão com chamadas) */
export function callsAvailable(): Promise<boolean> {
  if (IS_DEMO) return Promise.resolve(true);
  probe ??= fn({ probe: true }).then((r) => !!r.ok && r.data?.calls === true).catch(() => false);
  return probe;
}

export async function getCallToken(convId: string): Promise<{ token?: string; url?: string; room?: string; error?: string }> {
  const r = await fn({ call_conversation_id: convId });
  if (!r.ok || !r.data) return { error: r.error ?? CALLS_OFF_MSG };
  return { token: String(r.data.token), url: String(r.data.url), room: String(r.data.room) };
}

export interface RingPayload { conv: string; from: string; name: string; avatar: string; video: boolean; group?: string; msg?: string; at: number }
type RingEvent = 'ring' | 'decline' | 'hangup' | 'accept';

/** Envia um evento de toque para vários utilizadores (canal ring:<id>). */
export async function ringUsers(ids: string[], event: RingEvent, payload: RingPayload): Promise<void> {
  if (IS_DEMO || !ids.length) return;
  try {
    const { sb } = await import('./supabase');
    const c = await sb();
    await Promise.all(ids.map((id) => new Promise<void>((resolve) => {
      const ch = c.channel(`ring:${id}`, { config: { broadcast: { self: false, ack: false } } });
      const done = () => { try { void c.removeChannel(ch); } catch {} resolve(); };
      const t = setTimeout(done, 6000);
      ch.subscribe((st) => {
        if (st === 'SUBSCRIBED') void ch.send({ type: 'broadcast', event, payload }).finally(() => { clearTimeout(t); setTimeout(done, 300); });
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); done(); }
      });
    })));
  } catch {}
}

/** Escuta toques dirigidos a mim. Devolve função para parar. */
export function listenRing(me: string, on: (event: RingEvent, p: RingPayload) => void): () => void {
  if (IS_DEMO || !me) return () => {};
  let stop = false;
  let ch: { unsubscribe: () => unknown } | null = null;
  void import('./supabase').then(({ sb }) => sb()).then((c) => {
    if (stop) return;
    const x = c.channel(`ring:${me}`, { config: { broadcast: { self: false } } });
    (['ring', 'decline', 'hangup', 'accept'] as RingEvent[]).forEach((ev) => x.on('broadcast', { event: ev }, (m) => on(ev, m.payload as RingPayload)));
    x.subscribe();
    ch = x;
  }).catch(() => {});
  return () => { stop = true; try { void ch?.unsubscribe(); } catch {} };
}

/** Toque simples (WebAudio), sem ficheiros. */
export function ringtone(kind: 'in' | 'out'): () => void {
  let ctx: AudioContext | null = null; let iv: ReturnType<typeof setInterval> | null = null;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return () => {};
    ctx = new AC();
    const beep = () => {
      if (!ctx) return;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = kind === 'in' ? 660 : 425; g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination); o.start();
      const t = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(kind === 'in' ? 0.18 : 0.08, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'in' ? 0.9 : 1.2));
      o.stop(t + 1.3);
      if (kind === 'in') try { navigator.vibrate?.([400, 200, 400]); } catch {}
    };
    beep(); iv = setInterval(beep, kind === 'in' ? 2000 : 3000);
  } catch {}
  return () => { if (iv) clearInterval(iv); try { void ctx?.close(); } catch {} try { navigator.vibrate?.(0); } catch {} };
}
