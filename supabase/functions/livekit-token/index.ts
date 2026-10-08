// Social POIPAK · Edge Function "livekit-token" (Supabase / Deno)
// Lives com a câmara da app (LiveKit Cloud). Gera tokens de acesso à sala da live:
//  - anfitrião (lives.host_id = utilizador) → pode publicar câmara + microfone
//  - espectadores com sessão → só podem ver/ouvir (subscribe-only)
// A sala vem SEMPRE da base de dados (lives.stream_url = 'poipak://<sala>'), nunca do pedido.
//
// Deploy:   supabase functions deploy livekit-token --no-verify-jwt   (a função verifica o JWT ela própria)
// Segredos: supabase secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_URL=wss://<projeto>.livekit.cloud
//           (opcional) supabase secrets set ALLOWED_ORIGINS=https://anamaulele4-creator.github.io
// Usa SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (injetadas automaticamente pelo Supabase).
// Pedido:   POST { live_id: string }  ou  POST { probe: true } (só verifica se está configurada)
//           POST { call_conversation_id: string }  → chamada de voz/vídeo do chat (1:1 ou grupo):
//             o utilizador tem de ser membro (não recusado) da conversa; sala = "call-<id da conversa>";
//             todos podem publicar câmara + microfone. Em conversas 1:1, bloqueios impedem a chamada.
// Resposta: { ok: true, token, url, room, role: 'host' | 'viewer' | 'call' }  ·  erro: { ok: false, error }
//           probe → { ok: true, url, calls: true }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEFAULT_ORIGINS = ['https://anamaulele4-creator.github.io', 'http://localhost:3000'];
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED = ORIGINS.length ? ORIGINS : DEFAULT_ORIGINS;

function corsFor(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'access-control-allow-origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

const b64url = (b: Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Token de acesso LiveKit (JWT HS256 assinado com o API secret). */
async function livekitToken(key: string, secret: string, identity: string, name: string, room: string, host: boolean, ttlSec: number, role = host ? 'host' : 'viewer') {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: key, sub: identity, name, nbf: now - 10, exp: now + ttlSec, jti: crypto.randomUUID(),
    video: { room, roomJoin: true, canSubscribe: true, canPublish: host, canPublishData: host, canUpdateOwnMetadata: false, ...(host ? { canPublishSources: ['camera', 'microphone'] } : {}) },
    metadata: JSON.stringify({ role }),
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não suportado' }, 405);

  const LK_KEY = Deno.env.get('LIVEKIT_API_KEY') ?? '';
  const LK_SECRET = Deno.env.get('LIVEKIT_API_SECRET') ?? '';
  const LK_URL = Deno.env.get('LIVEKIT_URL') ?? '';
  if (!LK_KEY || !LK_SECRET || !LK_URL) return json({ ok: false, error: 'LiveKit ainda não configurado' }, 503);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.probe) return json({ ok: true, url: LK_URL, calls: true });

    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ ok: false, error: 'Entra na tua conta para ver a live.' }, 401);
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) return json({ ok: false, error: 'Sessão inválida. Entra outra vez.' }, 401);
    const uid = u.user.id;

    // ---- Chamadas do chat ----
    const callConv = String(body?.call_conversation_id ?? '').slice(0, 80);
    if (callConv) {
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(callConv)) return json({ ok: false, error: 'Conversa inválida' }, 400);
      const { data: prof } = await admin.from('profiles').select('display_name,handle,banned,deleted_at').eq('id', uid).maybeSingle();
      if (!prof || prof.banned || prof.deleted_at) return json({ ok: false, error: 'Conta sem acesso a chamadas.' }, 403);
      const { data: mem } = await admin.from('conversation_members').select('status').eq('conversation_id', callConv).eq('user_id', uid).maybeSingle();
      if (!mem || mem.status === 'recusado') return json({ ok: false, error: 'Não fazes parte desta conversa.' }, 403);
      const { data: conv } = await admin.from('conversations').select('id,kind').eq('id', callConv).maybeSingle();
      if (!conv) return json({ ok: false, error: 'Conversa não encontrada' }, 404);
      if (conv.kind !== 'grupo') {
        const { data: other } = await admin.from('conversation_members').select('user_id').eq('conversation_id', callConv).neq('user_id', uid).limit(1).maybeSingle();
        if (other) {
          const { data: bl } = await admin.from('blocks').select('user_id')
            .or(`and(user_id.eq.${other.user_id},blocked.eq.${uid}),and(user_id.eq.${uid},blocked.eq.${other.user_id})`).limit(1);
          if (bl && bl.length) return json({ ok: false, error: 'Não é possível ligar a este utilizador.' }, 403);
        }
      }
      const room = `call-${callConv}`;
      const token = await livekitToken(LK_KEY, LK_SECRET, uid, String(prof.display_name || prof.handle || 'Jogador'), room, true, 2 * 3600, 'call');
      return json({ ok: true, token, url: LK_URL, room, role: 'call' });
    }

    const liveId = String(body?.live_id ?? '').slice(0, 80);
    if (!liveId) return json({ ok: false, error: 'Live em falta' }, 400);
    const { data: live } = await admin.from('lives').select('id,host_id,status,stream_url').eq('id', liveId).maybeSingle();
    if (!live) return json({ ok: false, error: 'Live não encontrada' }, 404);
    const m = String(live.stream_url ?? '').match(/^poipak:\/\/([A-Za-z0-9_-]{6,80})$/);
    if (!m) return json({ ok: false, error: 'Esta live não usa a câmara POIPAK' }, 400);
    const room = m[1];

    const { data: prof } = await admin.from('profiles').select('display_name,handle,banned,deleted_at').eq('id', uid).maybeSingle();
    if (!prof || prof.banned || prof.deleted_at) return json({ ok: false, error: 'Conta sem acesso a lives.' }, 403);

    const host = live.host_id === uid;
    if (!host && live.status !== 'ao vivo') return json({ ok: false, error: live.status === 'agendada' ? 'A live ainda não começou.' : 'A live já terminou.' }, 409);
    if (host && (live.status === 'terminada' || live.status === 'suspensa')) return json({ ok: false, error: 'Esta live já terminou.' }, 409);

    const token = await livekitToken(LK_KEY, LK_SECRET, uid, String(prof.display_name || prof.handle || 'Jogador'), room, host, host ? 6 * 3600 : 4 * 3600);
    return json({ ok: true, token, url: LK_URL, room, role: host ? 'host' : 'viewer' });
  } catch (e) {
    return json({ ok: false, error: 'Erro ao gerar acesso à live: ' + ((e as Error)?.message ?? '') }, 500);
  }
});
