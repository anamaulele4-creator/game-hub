// TXAPILOG · Edge Function "payments" (Supabase / Deno)
// Inicia pagamentos M-Pesa / e-Mola via agregador e recebe o webhook de confirmação.
// Segurança:
//   • exige sessão + autorização de PIN de uso único (tx_authorizations, emitida por issue_tx_token após PIN/2FA)
//   • chave de idempotência obrigatória (cabeçalho Idempotency-Key) → o mesmo pedido nunca cobra 2x
//   • regras de risco (evaluate_risk) → valores anómalos ficam "em processamento" e vão para a fila Risco & Fraude
//   • webhook com assinatura HMAC-SHA256 (AGGREGATOR_WEBHOOK_SECRET), comparação em tempo constante,
//     janela de 5 min contra replays e idempotência por provider_ref
// Segredos (Supabase → Edge Functions → Secrets): AGGREGATOR_BASE_URL, AGGREGATOR_API_KEY, AGGREGATOR_WEBHOOK_SECRET, PAYMENTS_LIVE=true
// Enquanto PAYMENTS_LIVE != 'true', a função responde { ok:false } e NADA é cobrado.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, idempotency-key, x-signature, x-timestamp' };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'content-type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';

function msisdnFor(method: string, phone: string) {
  const n = phone.replace(/\D/g, '').replace(/^258/, '');
  if (!/^8[2-7]\d{7}$/.test(n)) return null;
  if (method === 'M-Pesa' && !/^8[45]/.test(n)) return null;
  if (method === 'e-Mola' && !/^8[67]/.test(n)) return null;
  return '258' + n;
}

async function hmacHex(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const url = new URL(req.url);

  // ---------------- Webhook do agregador ----------------
  if (url.pathname.endsWith('/webhook')) {
    const raw = await req.text();
    const ts = req.headers.get('x-timestamp') ?? '';
    const sig = (req.headers.get('x-signature') ?? '').replace(/^sha256=/, '');
    if (!env('AGGREGATOR_WEBHOOK_SECRET') || !ts || !sig) return json({ ok: false, error: 'assinatura em falta' }, 401);
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return json({ ok: false, error: 'pedido expirado' }, 401);
    const expected = await hmacHex(env('AGGREGATOR_WEBHOOK_SECRET'), `${ts}.${raw}`);
    if (!safeEqual(expected, sig)) return json({ ok: false, error: 'assinatura inválida' }, 401);
    const ev = JSON.parse(raw) as { reference: string; provider_ref: string; status: 'success' | 'failed'; amount: number };
    // Idempotente: provider_ref é único em public.payments
    const { data: pay } = await admin.from('payments').select('id,status,amount_mzn,user_id,kind,item').eq('id', ev.reference).maybeSingle();
    if (!pay) return json({ ok: false, error: 'referência desconhecida' }, 404);
    if (pay.status === 'pago' || pay.status === 'reembolsado') return json({ ok: true, duplicate: true });
    if (Number(ev.amount) !== pay.amount_mzn) {
      await admin.from('risk_flags').insert({ user_id: pay.user_id, kind: 'pagamento', ref_id: pay.id, rules: ['valor_webhook_diferente'], score: 90, amount_mzn: pay.amount_mzn });
      return json({ ok: false, error: 'valor não confere' }, 400);
    }
    const status = ev.status === 'success' ? 'pago' : 'falhou';
    const { error } = await admin.from('payments').update({ status, provider_ref: ev.provider_ref }).eq('id', pay.id).neq('status', 'pago');
    if (error && !String(error.message).includes('duplicate')) return json({ ok: false, error: error.message }, 500);
    if (status === 'pago') {
      // Concede o que foi pago (exemplos; completar por tipo)
      if (pay.kind === 'ad_topup') {
        const { data: w } = await admin.from('ad_wallets').select('balance_mzn').eq('user_id', pay.user_id).maybeSingle();
        await admin.from('ad_wallets').upsert({ user_id: pay.user_id, balance_mzn: Number(w?.balance_mzn ?? 0) + pay.amount_mzn });
      }
      await admin.from('notifications').insert({ user_id: pay.user_id, type: 'compra', body: `✅ Pagamento confirmado: ${pay.item} (${pay.amount_mzn} MZN).`, href: '/perfil' });
    }
    await admin.from('security_events').insert({ user_id: pay.user_id, event: `Pagamento ${status}`, detail: `${pay.item} · ${pay.amount_mzn} MZN` });
    return json({ ok: true });
  }

  // ---------------- Iniciar pagamento ----------------
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  const { data: u } = await admin.auth.getUser(token);
  if (!u.user) return json({ ok: false, error: 'Sessão inválida' }, 401);
  const body = await req.json().catch(() => ({}));
  const idem = req.headers.get('idempotency-key') || body.idempotency_key;
  if (!idem || String(idem).length < 16) return json({ ok: false, error: 'Chave de idempotência em falta' }, 400);

  const { data: prev } = await admin.from('payments').select('id,status').eq('idempotency_key', idem).maybeSingle();
  if (prev) return json({ ok: true, id: prev.id, status: prev.status, duplicate: true });

  const total = Math.round(Number(body.total));
  const method = String(body.method);
  if (!(total > 0) || !['M-Pesa', 'e-Mola', 'Cartão'].includes(method)) return json({ ok: false, error: 'Pedido inválido' }, 400);
  const msisdn = method === 'Cartão' ? null : msisdnFor(method, String(body.phone ?? ''));
  if (method !== 'Cartão' && !msisdn) return json({ ok: false, error: 'Número inválido para ' + method }, 400);

  // Consome a autorização do PIN (uso único, 5 min, mesmo valor)
  const { data: auth } = await admin.from('tx_authorizations').update({ used_at: new Date().toISOString() })
    .eq('token', String(body.tx_token ?? '')).eq('user_id', u.user.id).eq('purpose', 'pagamento').eq('amount_mzn', total).is('used_at', null).gt('expires_at', new Date().toISOString())
    .select('token').maybeSingle();
  if (!auth) return json({ ok: false, error: 'Autorização de PIN inválida ou expirada' }, 403);

  const { data: sec } = await admin.from('security_settings').select('frozen').eq('user_id', u.user.id).maybeSingle();
  if (sec?.frozen) return json({ ok: false, error: 'Conta congelada' }, 403);

  if (env('PAYMENTS_LIVE') !== 'true') return json({ ok: false, error: 'Pagamentos ainda não ativos' }, 503);

  const { data: risk } = await admin.rpc('evaluate_risk', { p_user: u.user.id, p_kind: 'pagamento', p_amount: total, p_whitelist: null });
  const score = Number(risk?.score ?? 0);
  const { data: prof } = await admin.from('profiles').select('handle').eq('id', u.user.id).maybeSingle();
  const { data: pay, error } = await admin.from('payments').insert({
    user_id: u.user.id, user_handle: prof?.handle, kind: body.kind ?? 'outro', item: String(body.title ?? 'Compra').slice(0, 120),
    amount_mzn: total, method, status: score >= 60 ? 'em processamento' : 'pendente', idempotency_key: idem,
  }).select('id').single();
  if (error) return json({ ok: false, error: error.message }, 500);
  if (score >= 30) await admin.from('risk_flags').insert({ user_id: u.user.id, user_handle: prof?.handle, kind: 'pagamento', ref_id: pay.id, rules: risk?.rules ?? [], score, amount_mzn: total });
  if (score >= 60) return json({ ok: true, id: pay.id, review: true });

  // Pedido C2B ao agregador (formato depende do fornecedor escolhido)
  const r = await fetch(`${env('AGGREGATOR_BASE_URL')}/c2b`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env('AGGREGATOR_API_KEY')}`, 'content-type': 'application/json', 'idempotency-key': idem },
    body: JSON.stringify({ reference: pay.id, amount: total, msisdn, method, callback_url: `${env('SUPABASE_URL')}/functions/v1/payments/webhook` }),
  }).catch(() => null);
  if (!r || !r.ok) { await admin.from('payments').update({ status: 'falhou' }).eq('id', pay.id); return json({ ok: false, error: 'O operador não respondeu. Nada foi cobrado.' }, 502); }
  await admin.from('payments').update({ status: 'em processamento' }).eq('id', pay.id);
  return json({ ok: true, id: pay.id });
});
