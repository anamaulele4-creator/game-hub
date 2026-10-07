// GAME HUB · Edge Function "payments" (Supabase / Deno)
// ESTADO: STUB — NÃO ESTÁ ATIVA. Nenhum pagamento real é processado.
//
// Objetivo: iniciar pagamentos M-Pesa / e-Mola através de um agregador de pagamentos
// moçambicano (ex.: PaySuite, e2Payments, Débito, ou outro com API C2B),
// e receber o callback (webhook) para confirmar o pagamento.
//
// Variáveis de ambiente (definir em Supabase > Edge Functions > Secrets):
//   AGGREGATOR_BASE_URL   URL da API do agregador
//   AGGREGATOR_API_KEY    chave privada do agregador (nunca no frontend)
//   AGGREGATOR_WEBHOOK_SECRET  segredo para validar callbacks
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetadas automaticamente)
//   PAYMENTS_LIVE=false   enquanto for false, a função só simula
//
// Rotas:
//   POST /payments/initiate  { purpose, reference_id, amount_mzn, method: 'mpesa'|'emola', msisdn }
//   POST /payments/webhook   (chamado pelo agregador)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Method = 'mpesa' | 'emola';
interface InitiateBody {
  purpose: 'plano' | 'torneio' | 'loja' | 'bilhete' | 'moedas';
  reference_id?: string;
  amount_mzn: number;
  method: Method;
  msisdn: string; // 84/85 (M-Pesa) ou 86/87 (e-Mola)
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

function validMsisdn(method: Method, msisdn: string) {
  const n = msisdn.replace(/\D/g, '').replace(/^258/, '');
  if (!/^8[4-7]\d{7}$/.test(n)) return null;
  if (method === 'mpesa' && !/^8[45]/.test(n)) return null;
  if (method === 'emola' && !/^8[67]/.test(n)) return null;
  return '258' + n;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  const url = new URL(req.url);
  const live = Deno.env.get('PAYMENTS_LIVE') === 'true';
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (url.pathname.endsWith('/initiate') && req.method === 'POST') {
    // 1) Autenticar o utilizador pelo JWT
    const jwt = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
    const { data: auth } = await admin.auth.getUser(jwt);
    if (!auth?.user) return json({ error: 'não autenticado' }, 401);

    const body = (await req.json()) as InitiateBody;
    if (!body.amount_mzn || body.amount_mzn <= 0) return json({ error: 'valor inválido' }, 400);
    const msisdn = validMsisdn(body.method, body.msisdn);
    if (!msisdn) return json({ error: 'número inválido para o método escolhido' }, 400);

    // 2) Registar o pagamento como pendente (o valor deve ser recalculado no servidor a partir do reference_id!)
    const { data: pay, error } = await admin.from('payments').insert({
      user_id: auth.user.id, purpose: body.purpose, reference_id: body.reference_id ?? null,
      amount_mzn: body.amount_mzn, method: body.method, msisdn, status: 'pendente',
    }).select().single();
    if (error) return json({ error: error.message }, 500);

    if (!live) {
      // Modo stub: não contacta o agregador.
      return json({ payment_id: pay.id, status: 'pendente', live: false, message: 'STUB: pagamento não enviado ao agregador.' });
    }

    // 3) Pedido C2B ao agregador (formato ilustrativo — ajustar à documentação do fornecedor escolhido)
    const res = await fetch(`${Deno.env.get('AGGREGATOR_BASE_URL')}/c2b/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${Deno.env.get('AGGREGATOR_API_KEY')}` },
      body: JSON.stringify({
        amount: body.amount_mzn, currency: 'MZN', msisdn, channel: body.method,
        reference: pay.id, description: `GAME HUB ${body.purpose}`,
      }),
    });
    const provider = await res.json().catch(() => ({}));
    await admin.from('payments').update({
      status: res.ok ? 'em_processamento' : 'falhou', provider_ref: provider?.id ?? null, updated_at: new Date().toISOString(),
    }).eq('id', pay.id);
    return json({ payment_id: pay.id, status: res.ok ? 'em_processamento' : 'falhou' }, res.ok ? 200 : 502);
  }

  if (url.pathname.endsWith('/webhook') && req.method === 'POST') {
    // Validar assinatura do agregador (ajustar ao método do fornecedor: HMAC, header secreto, etc.)
    const sig = req.headers.get('x-webhook-secret');
    if (sig !== Deno.env.get('AGGREGATOR_WEBHOOK_SECRET')) return json({ error: 'assinatura inválida' }, 401);
    const evt = await req.json();
    const status = evt.status === 'success' ? 'pago' : evt.status === 'failed' ? 'falhou' : 'em_processamento';
    const { data: pay } = await admin.from('payments').update({ status, updated_at: new Date().toISOString() })
      .eq('id', evt.reference).select().single();

    // Efeitos após pagamento confirmado (idempotentes)
    if (pay && status === 'pago') {
      if (pay.purpose === 'torneio') await admin.from('tournament_entries').upsert({ tournament_id: pay.reference_id, user_id: pay.user_id, team_name: 'Equipa', payment_id: pay.id });
      if (pay.purpose === 'plano') await admin.from('subscriptions').insert({ user_id: pay.user_id, plan_id: pay.reference_id, status: 'ativa' });
      if (pay.purpose === 'moedas') await admin.rpc('noop'); // TODO: creditar moedas numa função segura
      await admin.from('notifications').insert({ user_id: pay.user_id, type: 'compra', body: `Pagamento confirmado: ${pay.amount_mzn} MZN`, href: '/perfil' });
    }
    return json({ ok: true });
  }

  return json({ error: 'rota não encontrada' }, 404);
});
