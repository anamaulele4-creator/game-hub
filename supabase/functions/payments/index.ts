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
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PROVIDERS, mpesa, clicpay } from './providers.ts';
const depositProvider = () => (env('DEPOSIT_PROVIDER') === 'mpesa' ? mpesa : clicpay);
// Módulo competitivo (carteira): rotas /health, /wallet-deposit, /webhook/mpesa e /reconcile — ver COMPETITIVO.md.
// O crédito na carteira acontece SÓ em comp__confirm_deposit (RPC só para service_role), depois de verificar a assinatura.

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, idempotency-key, x-signature, x-timestamp, x-reconcile-secret' };
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
const safeEq = (a: string, b: string) => safeEqual(a, b);
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;
type DepRow = { id: string; amount_mzn: number; status: string; provider?: string | null; provider_ref: string | null; method?: string; created_at: string; phone_masked?: string | null };
// Consulta o fornecedor configurado e, se pago, credita via comp__confirm_deposit. Usado por /wallet-deposit-check
// (navegador) E por /reconcile (pg_cron): o MESMO event_id ('clicpay:' + referência) nos dois caminhos, por isso o
// segundo a chegar é sempre "duplicado" e nunca credita duas vezes (comp__confirm_deposit é idempotente).
// Só responde 'pago' depois de confirmar o resultado do RPC (e, se duplicado, o estado real na tabela).
async function settleDeposit(admin: Admin, pay: DepRow): Promise<{ status: string; code?: string; recoveredRef?: boolean }> {
  const prov = depositProvider();
  let ref = pay.provider_ref;
  let recoveredRef = false;
  if (!ref && prov.findReference) {
    // Pedido enviado mas sem referência (ClicPay 409 / resposta sem clicpay_reference): tenta recuperá-la e guardá-la.
    ref = await prov.findReference({ paymentId: pay.id, amount: pay.amount_mzn, method: pay.method, createdAt: pay.created_at, phoneMasked: pay.phone_masked });
    if (ref) {
      const { error } = await admin.from('payments').update({ provider_ref: ref }).eq('id', pay.id).is('provider_ref', null);
      if (error) return { status: pay.status, code: 'REF_SAVE_FAILED' }; // ex.: referência já usada noutro pagamento
      recoveredRef = true;
      await admin.from('comp_audit').insert({ action: 'deposito_ref_recuperada', target: pay.id, details: { ref } });
    }
  }
  const st = await prov.queryStatus(pay.id, ref);
  if (st.ok && st.status === 'success' && st.providerRef) {
    const { data, error } = await admin.rpc('comp__confirm_deposit', { p_payment: pay.id, p_provider: 'mpesa', p_event_id: 'clicpay:' + st.providerRef, p_provider_ref: st.providerRef,
      p_status: 'success', p_amount: pay.amount_mzn, p_signature_ok: true, p_payload_sha256: 'status-query' });
    if (error) return { status: pay.status, code: 'RPC_ERROR', recoveredRef };
    const r = (data ?? {}) as { ok?: boolean; duplicate?: boolean; code?: string };
    if (r.ok === false) return { status: pay.status, code: r.code ?? 'RPC_REFUSED', recoveredRef };
    if (r.duplicate) {
      const { data: now } = await admin.from('payments').select('status').eq('id', pay.id).maybeSingle();
      return { status: now?.status ?? pay.status, code: now?.status === 'pago' ? undefined : 'DUPLICATE_NOT_PAID', recoveredRef };
    }
    return { status: 'pago', recoveredRef };
  }
  if (st.ok && st.status === 'failed') {
    await admin.from('payments').update({ status: 'falhou', failure_reason: 'recusado no fornecedor' }).eq('id', pay.id).in('status', ['pendente', 'em processamento']);
    await admin.from('comp_audit').insert({ action: 'deposito_falhou', target: pay.id, details: { origem: 'consulta' } });
    return { status: 'falhou', recoveredRef };
  }
  return { status: pay.status, recoveredRef };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const url = new URL(req.url);

  // ---------------- Carteira competitiva ----------------
  // Estado do fornecedor: só diz se os segredos existem (nunca os devolve). Atualiza comp_provider_status.
if (url.pathname.endsWith('/health')) {
  const prov = depositProvider();
  const live = prov.live();
  const now = new Date().toISOString();
  const viaClicpay = prov === clicpay;
  const rows = [
    { provider: 'mpesa', configured: prov.configured(), live, checked_at: now, details: { via: prov.id } },
    ...(viaClicpay ? [{ provider: 'emola', configured: !!(env('CLICPAY_TOKEN') && env('CLICPAY_WALLET_EMOLA')), live, checked_at: now, details: { via: prov.id } }] : []),
  ];
  const { error } = await admin.from('comp_provider_status').upsert(rows, { onConflict: 'provider' });
  if (error) return json({ ok: false, error: error.message, hint: error.hint ?? null }, 500);
  return json({ ok: true, providers: rows.map(({ provider, configured, live }) => ({ provider, configured, live })) });
}
if (url.pathname.endsWith('/diag-splits')) {
  if (!env('RECONCILE_SECRET') || !safeEq(req.headers.get('x-reconcile-secret') ?? '', env('RECONCILE_SECRET'))) return json({ ok: false }, 401);
  const base = env('CLICPAY_BASE_URL') || 'https://clicpay.co.mz';
  const hdr = { Authorization: `Bearer ${env('CLICPAY_TOKEN')}`, Accept: 'application/json' };
  const out: Record<string, unknown> = {};
  for (const [name, w] of [['mpesa', env('CLICPAY_WALLET_MPESA')], ['emola', env('CLICPAY_WALLET_EMOLA')]]) {
    const [wr, sr] = await Promise.all([
      fetch(`${base}/api/v2/wallets/${w}`, { headers: hdr }),
      fetch(`${base}/api/v2/wallets/${w}/splits`, { headers: hdr }),
    ]);
    out[name] = { wallet: await wr.json().catch(() => null), splits: await sr.json().catch(() => null) };
  }
  return json(out);
}
if (url.pathname.endsWith('/diag')) {
  if (!env('RECONCILE_SECRET') || !safeEq(req.headers.get('x-reconcile-secret') ?? '', env('RECONCILE_SECRET'))) return json({ ok: false }, 401);
  const t = env('CLICPAY_TOKEN');
  const base = env('CLICPAY_BASE_URL') || 'https://clicpay.co.mz';
  const r = await fetch(`${base}/api/v2/transactions/TESTE/status`, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } }).catch(() => null);
  return json({
    base,
    tokenLength: t.length,
    hasWhitespace: /\s/.test(t),
    hasQuotes: /["']/.test(t),
    startsWithBearer: /^bearer\s/i.test(t),
    clicpayStatus: r?.status ?? null,
    clicpayBody: r ? await r.text() : null,
  });
}
  // Webhook assinado do M-Pesa/agregador → comp__confirm_deposit (idempotente por event_id e por pagamento)
  if (url.pathname.endsWith('/webhook/mpesa')) {
    const raw = await req.text();
    const v = await mpesa.verifyWebhook(raw, req.headers);
    if (!v.valid) {
      // regista a tentativa (assinatura inválida) para auditoria/reconciliação, sem creditar nada
      await admin.rpc('comp__confirm_deposit', { p_payment: null, p_provider: 'mpesa', p_event_id: 'invalid:' + v.payloadSha256 + ':' + Date.now(), p_provider_ref: null,
        p_status: 'invalid', p_amount: null, p_signature_ok: false, p_payload_sha256: v.payloadSha256 });
      return json({ ok: false, error: v.reason }, 401);
    }
    const e = v.event;
    const { data, error } = await admin.rpc('comp__confirm_deposit', { p_payment: e.paymentId, p_provider: 'mpesa', p_event_id: e.eventId, p_provider_ref: e.providerRef,
      p_status: e.status, p_amount: e.amount, p_signature_ok: true, p_payload_sha256: v.payloadSha256 });
    if (error) return json({ ok: false, error: 'erro interno' }, 500);
    return json({ ok: true, result: data?.code ?? (data?.duplicate ? 'duplicado' : 'ok') });
  }

  // Iniciar o pedido ao telemóvel para um depósito criado por comp_wallet_deposit_intent (o utilizador nunca escolhe o valor aqui)
if (url.pathname.endsWith('/wallet-deposit')) {
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  const { data: u } = await admin.auth.getUser(token);
  if (!u.user) return json({ ok: false, code: 'AUTH' }, 401);
  const body = await req.json().catch(() => ({}));
  const { data: pay } = await admin.from('payments').select('id,user_id,amount_mzn,status,kind,method,idempotency_key').eq('id', String(body.payment_id ?? '')).maybeSingle();
  if (!pay || pay.user_id !== u.user.id || pay.kind !== 'carteira') return json({ ok: false, code: 'NOT_FOUND' }, 404);
  if (pay.status !== 'pendente') return json({ ok: true, status: pay.status, duplicate: true });
  const prov = depositProvider();
  if (!prov.configured() || !prov.live()) return json({ ok: false, code: 'PROVIDER_NOT_CONFIGURED' }, 503);
  const msisdn = msisdnFor(pay.method, String(body.phone ?? body.msisdn ?? ''));
  if (!msisdn) return json({ ok: false, code: 'BAD_PHONE', message: 'Número inválido para ' + pay.method }, 400);
  const r = await prov.startDeposit({ paymentId: pay.id, amount: pay.amount_mzn, msisdn, method: pay.method, reference: 'TXAP' + pay.id.slice(0, 8), idempotencyKey: pay.idempotency_key,
    callbackUrl: `${env('SUPABASE_URL')}/functions/v1/payments/webhook/mpesa` });
  if (!r.ok) {
    await admin.from('payments').update({ status: 'falhou', failure_reason: r.code + ': ' + r.message }).eq('id', pay.id).eq('status', 'pendente');
    await admin.from('comp_audit').insert({ action: 'deposito_falhou', target: pay.id, details: { codigo: r.code } });
    return json({ ok: false, code: r.code === 'NOT_CONFIGURED' ? 'PROVIDER_NOT_CONFIGURED' : 'PROVIDER_ERROR', message: 'Nada foi cobrado.' }, 502);
  }
  await admin.from('payments').update({ status: 'em processamento', provider_ref: r.providerRef }).eq('id', pay.id).eq('status', 'pendente');
  return json({ ok: true, status: 'em processamento' });
}
if (url.pathname.endsWith('/wallet-deposit-check')) {
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  const { data: u } = await admin.auth.getUser(token);
  if (!u.user) return json({ ok: false, code: 'AUTH' }, 401);
  const body = await req.json().catch(() => ({}));
  const { data: pay } = await admin.from('payments')
    .select('id,user_id,amount_mzn,status,kind,method,provider,provider_ref,created_at,phone_masked')
    .eq('id', String(body.payment_id ?? '')).maybeSingle();
  if (!pay || pay.user_id !== u.user.id || pay.kind !== 'carteira') return json({ ok: false, code: 'NOT_FOUND' }, 404);
  if (!['pendente', 'em processamento'].includes(pay.status)) return json({ ok: true, status: pay.status });
  const r = await settleDeposit(admin, pay);
  return json({ ok: true, status: r.status, code: r.code ?? null });
}

  // Reconciliação agendada (pg_cron + pg_net a cada 2 min — migrations/2026-10-20-reconcile-cron.sql — ou manual).
  // Exige o cabeçalho x-reconcile-secret = RECONCILE_SECRET. Consulta o fornecedor CONFIGURADO (ClicPay por defeito)
  // para depósitos pendentes com mais de 2 min e até 7 dias, para que o crédito não dependa de a /carteira estar aberta.
 if (url.pathname.endsWith('/reconcile')) {
  if (!env('RECONCILE_SECRET') || !safeEq(req.headers.get('x-reconcile-secret') ?? '', env('RECONCILE_SECRET'))) return json({ ok: false }, 401);
  const { data: pend } = await admin.from('payments')
    .select('id,amount_mzn,status,method,provider,provider_ref,created_at,phone_masked')
    .eq('kind', 'carteira').in('status', ['pendente', 'em processamento'])
    .lt('created_at', new Date(Date.now() - 2 * 60e3).toISOString())
    .gt('created_at', new Date(Date.now() - 48 * 3600e3).toISOString())
    .order('created_at', { ascending: true })
    .limit(15);
  const out: unknown[] = [];
  for (const p of pend ?? []) {
    const r = await settleDeposit(admin, p);
    if (r.status !== p.status || r.recoveredRef || r.code) out.push({ id: p.id, ...r });
  }
  return json({ ok: true, checked: (pend ?? []).length, changed: out });
} 

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
