// TXAPILOG · Camada de pagamentos agnóstica ao fornecedor (corre SÓ na Edge Function "payments", nunca no navegador).
// Cada fornecedor implementa a mesma interface. O adaptador M-Pesa é um ESQUELETO: os endpoints e as credenciais
// vêm de segredos da função (nada inventado aqui). Sem segredos → configured = false → nada é cobrado.
//
// Segredos (Supabase → Edge Functions → Secrets) — ver COMPETITIVO.md:
//   MPESA_API_BASE              URL base dada pela Vodacom/agregador no contrato (sandbox ou produção)
//   MPESA_C2B_PATH              caminho do pedido C2B (ex.: o indicado na documentação do contrato)
//   MPESA_STATUS_PATH           caminho da consulta de estado (reconciliação)
//   MPESA_BEARER_TOKEN          token de autorização (na API da Vodacom MZ é a chave da API cifrada com a chave pública;
//                               calcula-se fora da função e guarda-se aqui)
//   MPESA_SERVICE_PROVIDER_CODE código do comerciante (short code)
//   MPESA_ORIGIN                cabeçalho Origin exigido pelo fornecedor (se aplicável)
//   MPESA_WEBHOOK_SECRET        segredo HMAC-SHA256 partilhado para assinar callbacks (agregador)
//   PAYMENTS_LIVE=true          interruptor final: sem isto a função nunca contacta o fornecedor
//   MPESA_TRUST_SYNC_RESPONSE   "true" só se o contrato garantir que a resposta síncrona servidor-a-servidor é final

export type ProviderId = 'mpesa' | 'emola' | 'aggregator';
export interface StartRequest { paymentId: string; amount: number; msisdn: string; reference: string; callbackUrl: string; idempotencyKey: string }
export type StartResult =
  | { ok: true; status: 'pending' | 'success'; providerRef: string | null; raw?: unknown }
  | { ok: false; code: 'NOT_CONFIGURED' | 'REJECTED' | 'NETWORK' | 'TIMEOUT'; message: string };
export interface WebhookEvent { eventId: string; paymentId: string; providerRef: string; status: 'success' | 'failed'; amount: number }
export type VerifyResult = { valid: true; event: WebhookEvent; payloadSha256: string } | { valid: false; reason: string; payloadSha256: string };

export interface PaymentProvider {
  id: ProviderId;
  configured(): boolean;
  live(): boolean;
  startDeposit(r: StartRequest): Promise<StartResult>;
  /** Verifica assinatura + janela anti-replay e extrai o evento. NUNCA confiar em dados do cliente. */
  verifyWebhook(raw: string, headers: Headers): Promise<VerifyResult>;
  /** Consulta o estado de um pagamento (reconciliação). */
  queryStatus(paymentId: string, providerRef: string | null): Promise<{ ok: boolean; status?: 'success' | 'failed' | 'pending'; amount?: number; providerRef?: string }>;
}

const env = (k: string) => Deno.env.get(k) ?? '';
export async function sha256Hex(data: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function hmacHex(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function withTimeout(p: Promise<Response>, ms: number): Promise<Response | 'timeout'> {
  return await Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

/** Adaptador M-Pesa (Vodacom Moçambique ou agregador). Esqueleto: o formato exato dos campos tem de seguir o contrato. */
export const mpesa: PaymentProvider = {
  id: 'mpesa',
  configured: () => !!(env('MPESA_API_BASE') && env('MPESA_C2B_PATH') && env('MPESA_BEARER_TOKEN') && env('MPESA_SERVICE_PROVIDER_CODE') && env('MPESA_WEBHOOK_SECRET')),
  live: () => env('PAYMENTS_LIVE') === 'true',
  async startDeposit(r) {
    if (!this.configured() || !this.live()) return { ok: false, code: 'NOT_CONFIGURED', message: 'M-Pesa: requer segredos e PAYMENTS_LIVE=true' };
    const body = {
      // Campos no estilo da API C2B da Vodacom MZ (confirmar nomes no contrato/documentação recebida)
      input_TransactionReference: r.reference.slice(0, 20),
      input_CustomerMSISDN: r.msisdn,
      input_Amount: String(r.amount),
      input_ThirdPartyReference: r.paymentId.replace(/-/g, '').slice(0, 20),
      input_ServiceProviderCode: env('MPESA_SERVICE_PROVIDER_CODE'),
    };
    const res = await withTimeout(fetch(env('MPESA_API_BASE') + env('MPESA_C2B_PATH'), {
      method: 'POST',
      headers: { authorization: `Bearer ${env('MPESA_BEARER_TOKEN')}`, 'content-type': 'application/json', origin: env('MPESA_ORIGIN') || '*', 'idempotency-key': r.idempotencyKey },
      body: JSON.stringify(body),
    }).catch(() => null as unknown as Response), 60_000);
    if (res === 'timeout') return { ok: false, code: 'TIMEOUT', message: 'O operador não respondeu a tempo' };
    if (!res) return { ok: false, code: 'NETWORK', message: 'Sem ligação ao operador' };
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    const code = String((json as Record<string, unknown>).output_ResponseCode ?? '');
    const ref = ((json as Record<string, unknown>).output_TransactionID as string | undefined) ?? null;
    if (res.ok && code === 'INS-0') return { ok: true, status: env('MPESA_TRUST_SYNC_RESPONSE') === 'true' ? 'success' : 'pending', providerRef: ref, raw: json };
    if (res.ok && !code) return { ok: true, status: 'pending', providerRef: ref, raw: json }; // agregador assíncrono
    return { ok: false, code: 'REJECTED', message: String((json as Record<string, unknown>).output_ResponseDesc ?? `HTTP ${res.status}`) };
  },
  async verifyWebhook(raw, headers) {
    const payloadSha256 = await sha256Hex(raw);
    const secret = env('MPESA_WEBHOOK_SECRET');
    const ts = headers.get('x-timestamp') ?? '';
    const sig = (headers.get('x-signature') ?? '').replace(/^sha256=/, '');
    if (!secret || !ts || !sig) return { valid: false, reason: 'assinatura em falta', payloadSha256 };
    if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return { valid: false, reason: 'fora da janela de 5 min (replay)', payloadSha256 };
    const expected = await hmacHex(secret, `${ts}.${raw}`);
    if (!safeEqual(expected, sig)) return { valid: false, reason: 'assinatura inválida', payloadSha256 };
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(raw); } catch { return { valid: false, reason: 'JSON inválido', payloadSha256 }; }
    const event: WebhookEvent = {
      eventId: String(ev.event_id ?? ev.id ?? ''), paymentId: String(ev.reference ?? ''), providerRef: String(ev.provider_ref ?? ev.transaction_id ?? ''),
      status: ev.status === 'success' ? 'success' : 'failed', amount: Math.round(Number(ev.amount)),
    };
    if (!event.eventId || !event.paymentId || !Number.isFinite(event.amount)) return { valid: false, reason: 'campos em falta', payloadSha256 };
    return { valid: true, event, payloadSha256 };
  },
  async queryStatus(paymentId, providerRef) {
    if (!this.configured() || !env('MPESA_STATUS_PATH')) return { ok: false };
    const url = `${env('MPESA_API_BASE')}${env('MPESA_STATUS_PATH')}?input_QueryReference=${encodeURIComponent(providerRef ?? paymentId)}&input_ServiceProviderCode=${encodeURIComponent(env('MPESA_SERVICE_PROVIDER_CODE'))}&input_ThirdPartyReference=${encodeURIComponent(paymentId.replace(/-/g, '').slice(0, 20))}`;
    const res = await withTimeout(fetch(url, { headers: { authorization: `Bearer ${env('MPESA_BEARER_TOKEN')}`, origin: env('MPESA_ORIGIN') || '*' } }).catch(() => null as unknown as Response), 30_000);
    if (res === 'timeout' || !res || !res.ok) return { ok: false };
    const j = await res.json().catch(() => ({} as Record<string, unknown>));
    const st = String((j as Record<string, unknown>).output_ResponseTransactionStatus ?? '').toLowerCase();
    return { ok: true, status: st === 'completed' ? 'success' : st === 'cancelled' || st === 'expired' ? 'failed' : 'pending' };
  },
};

export const PROVIDERS: Record<string, PaymentProvider> = { mpesa };
