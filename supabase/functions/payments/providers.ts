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
export interface StartRequest { paymentId: string; amount: number; msisdn: string; reference: string; callbackUrl: string; idempotencyKey: string; method?: string }
export type StartResult =
  | { ok: true; status: 'pending' | 'success'; providerRef: string | null; raw?: unknown; splitApplied?: boolean }
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
  /** Opcional: recupera a referência do fornecedor de um pedido já enviado (ex.: ClicPay respondeu 409 ou sem clicpay_reference). */
  findReference?(p: FindRefRequest): Promise<string | null>;
}
export interface FindRefRequest { paymentId: string; amount: number; method?: string; createdAt: string; phoneMasked?: string | null }

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

// ---------- ClicPay ----------
// Segredos: CLICPAY_BASE_URL, CLICPAY_TOKEN, CLICPAY_WALLET_MPESA, CLICPAY_WALLET_EMOLA,
//           CLICPAY_SPLIT_MPESA, CLICPAY_SPLIT_EMOLA, PAYMENTS_LIVE=true
const cpBase = () => env('CLICPAY_BASE_URL') || 'https://clicpay.co.mz';
const cpWallet = (m?: string) => (m === 'e-Mola' ? env('CLICPAY_WALLET_EMOLA') : env('CLICPAY_WALLET_MPESA'));
const cpSplit = (m?: string) => (m === 'e-Mola' ? env('CLICPAY_SPLIT_EMOLA') : env('CLICPAY_SPLIT_MPESA'));
// Valor que vai para o split da plataforma (regra do Cairo):
// e-Mola: (valor - 10%) - 3%  |  M-Pesa: valor - 3%
// Arredonda para baixo ao cêntimo, para nunca exceder o líquido.
const cpSplitAmount = (m: string | undefined, amount: number) => {
  const f = m === 'e-Mola' ? 0.87 : 0.97;
  return Math.floor(amount * f * 100) / 100;
};
const cpMethod = (m?: string) => (m === 'e-Mola' ? 'emola' : 'mpesa');
const cpHeaders = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${env('CLICPAY_TOKEN')}`, 'Content-Type': 'application/json', Accept: 'application/json', ...extra });
// Estados finais confirmados na documentação da ClicPay (vêm em MAIÚSCULAS)
const CP_OK = ['SUCCESSFUL'];
const CP_FAIL = ['FAILED', 'CANCELLED', 'REJECTED'];

export const clicpay: PaymentProvider = {
  id: 'aggregator',
  configured: () => !!(env('CLICPAY_TOKEN') && env('CLICPAY_WALLET_MPESA') && env('CLICPAY_SPLIT_MPESA')),
  live: () => env('PAYMENTS_LIVE') === 'true',
  async startDeposit(r) {
    if (!this.configured() || !this.live()) return { ok: false, code: 'NOT_CONFIGURED', message: 'ClicPay: requer segredos e PAYMENTS_LIVE=true' };
    const wallet = cpWallet(r.method);
    const splitId = Number(cpSplit(r.method));
    // falha fechada: sem carteira/split configurados nunca se cobra
    if (!wallet || !Number.isInteger(splitId) || splitId <= 0) return { ok: false, code: 'NOT_CONFIGURED', message: 'Carteira/split ClicPay em falta para ' + r.method };
    const body = {
      msisdn: r.msisdn.replace(/^258/, ''),
      amount: Number(r.amount.toFixed(2)),
      reference_description: ('TXAP ' + r.paymentId.slice(0, 8)).slice(0, 32),
      internal_notes: 'payment:' + r.paymentId,
      // Todo o valor do depósito vai para o split da plataforma
// Valor líquido (depois das deduções da ClicPay) vai para o split da plataforma
splits: [{ wallet_split_id: splitId, value_type: 'amount', value: cpSplitAmount(r.method, r.amount) }],
    };
    // 409 = outro pedido com a MESMA Idempotency-Key ainda está a ser processado. A documentação manda esperar o
    // Retry-After e repetir com a mesma chave e o mesmo corpo: a resposta guardada traz o mesmo clicpay_reference e
    // não cria uma segunda cobrança. Repetimos no máximo 2 vezes (espera limitada a 5 s cada).
    const send = () => withTimeout(fetch(`${cpBase()}/api/v2/wallets/${wallet}/c2b/${cpMethod(r.method)}`, { method: 'POST', headers: cpHeaders({ 'Idempotency-Key': r.idempotencyKey }), body: JSON.stringify(body) }).catch(() => null as unknown as Response), 20_000);
    let res = await send();
    for (let i = 0; i < 2 && res !== 'timeout' && res && res.status === 409; i++) {
      const wait = Math.min(5, Math.max(1, Number(res.headers.get('retry-after')) || 2));
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      res = await send();
    }
    if (res === 'timeout') return { ok: false, code: 'TIMEOUT', message: 'A ClicPay não respondeu a tempo' };
    if (!res) return { ok: false, code: 'NETWORK', message: 'Sem ligação à ClicPay' };
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) {
      const sum = j.split_summary as { direct?: { wallet_split_id: number }[]; collect?: { wallet_split_id: number }[] } | undefined;
      const splitApplied = [...(sum?.collect ?? []), ...(sum?.direct ?? [])].some((s) => s.wallet_split_id === splitId);
      return { ok: true, status: 'pending', providerRef: (j.clicpay_reference as string) ?? null, raw: j, splitApplied };
    }
    // Ainda 409 depois das repetições: o pedido existe na ClicPay; a referência é recuperada depois por findReference.
    if (res.status === 409) return { ok: true, status: 'pending', providerRef: (j.clicpay_reference as string) ?? null };
    return { ok: false, code: 'REJECTED', message: String(j.message ?? j.error ?? `HTTP ${res.status}`) };
  },
  async verifyWebhook(raw) { return { valid: false, reason: 'ClicPay: sem webhook (confirmação por consulta)', payloadSha256: await sha256Hex(raw) }; },
  async queryStatus(_paymentId, providerRef) {
    if (!this.configured() || !providerRef) return { ok: false };
    const res = await withTimeout(fetch(`${cpBase()}/api/v2/transactions/${encodeURIComponent(providerRef)}/status`, { headers: cpHeaders() }).catch(() => null as unknown as Response), 20_000);
    if (res === 'timeout' || !res || !res.ok) return { ok: false };
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('clicpay status', JSON.stringify(j));
    const st = String(j.status ?? '').toUpperCase();
    return { ok: true, status: CP_OK.includes(st) ? 'success' : CP_FAIL.includes(st) ? 'failed' : 'pending', providerRef: (j.clicpay_reference as string) ?? providerRef };
  },
  // Procura no histórico da carteira ClicPay o C2B deste pagamento (descrição "TXAP <8 chars do id>", mesmo valor,
  // criado a partir do dia do pedido, e — se soubermos — mesmos 2 últimos dígitos do telefone). Falha fechada: só
  // devolve a referência se houver EXATAMENTE uma correspondência. A referência serve apenas para consultar o estado;
  // o crédito continua a exigir estado SUCCESSFUL e o valor certo em comp__confirm_deposit.
  async findReference(p) {
    if (!this.configured()) return null;
    const wallet = cpWallet(p.method);
    if (!wallet) return null;
    const desc = ('TXAP ' + p.paymentId.slice(0, 8)).slice(0, 32);
    const day = new Date(new Date(p.createdAt).getTime() - 864e5).toISOString().slice(0, 10);
    const q = `filter[type]=C2B&filter[date_from]=${day}&sort=-created_at&per_page=100`;
    const res = await withTimeout(fetch(`${cpBase()}/api/v2/wallets/${wallet}/transactions?${q}`, { headers: cpHeaders() }).catch(() => null as unknown as Response), 20_000);
    if (res === 'timeout' || !res || !res.ok) return null;
    const j = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>[] };
    const last2 = (p.phoneMasked ?? '').replace(/\D/g, '').slice(-2);
    const hits = (j.data ?? []).filter((t) =>
      String(t.description ?? t.reference_description ?? '').trim() === desc &&
      Math.round(Number(t.amount)) === Math.round(p.amount) &&
      (!last2 || String(t.customer_msisdn ?? '').replace(/\D/g, '').endsWith(last2)) &&
      typeof t.clicpay_reference === 'string' && t.clicpay_reference);
    return hits.length === 1 ? String(hits[0].clicpay_reference) : null;
  },
};
export const PROVIDERS: Record<string, PaymentProvider> = { mpesa, clicpay };