// Pagamentos de dinheiro real (MT) — interface do fornecedor, escrita à mão.
// Hoje só existe o fornecedor MANUAL: o admin regista no painel um depósito já confirmado (com referência, auditado)
// e marca levantamentos como pagos depois de fazer a transferência. Os fornecedores M-Pesa (Vodacom) e e-Mola (Movitel)
// ficam prontos para ligar quando houver credenciais da API: até lá respondem "requer credenciais da API".
// As chaves NUNCA ficam no código: vivem como segredos de uma Edge Function do Supabase (payments).

export type PayMethod = 'M-Pesa' | 'e-Mola';
export const AUTO_DEPOSIT_PENDING = 'Depósito automático M-Pesa/e-Mola: requer credenciais da API';

export interface DepositRequest { userId: string; amountMt: number; phone: string; method: PayMethod }
export interface PayoutRequest { withdrawalId: string; amountMt: number; phone: string; method: PayMethod }
export type ProviderResult = { ok: true; reference: string } | { ok: false; code: 'NOT_CONFIGURED' | 'REJECTED' | 'NETWORK'; message: string };

/** O que cada fornecedor tem de implementar (na Edge Function `payments`, nunca no navegador). */
export interface PaymentProvider {
  id: 'manual' | 'mpesa' | 'emola';
  label: string;
  configured: boolean;
  /** Pede ao telemóvel do cliente para aprovar o pagamento (push USSD/C2B). */
  startDeposit(r: DepositRequest): Promise<ProviderResult>;
  /** Envia dinheiro para a carteira móvel do cliente (B2C). */
  payout(r: PayoutRequest): Promise<ProviderResult>;
  /** Confirma um callback/webhook do fornecedor (assinatura + valor + referência) antes de creditar. */
  verifyCallback(body: unknown, headers: Record<string, string>): Promise<{ valid: boolean; reference?: string; amountMt?: number; userId?: string }>;
}

const notConfigured = (label: string): ProviderResult => ({ ok: false, code: 'NOT_CONFIGURED', message: `${label}: requer credenciais da API` });

export function apiProvider(id: 'mpesa' | 'emola'): PaymentProvider {
  const label = id === 'mpesa' ? 'M-Pesa' : 'e-Mola';
  return {
    id, label, configured: false,
    async startDeposit() { return notConfigured(label); },
    async payout() { return notConfigured(label); },
    async verifyCallback() { return { valid: false }; },
  };
}

/** Fornecedor manual: tudo passa pelo admin (bets_admin_deposit / bets_admin_withdrawal), sempre com referência e registo. */
export const manualProvider: PaymentProvider = {
  id: 'manual', label: 'Confirmação manual pelo admin', configured: true,
  async startDeposit() { return { ok: false, code: 'NOT_CONFIGURED', message: 'O depósito é confirmado pela equipa no painel admin.' }; },
  async payout() { return { ok: false, code: 'NOT_CONFIGURED', message: 'O levantamento é pago pela equipa e marcado no painel admin.' }; },
  async verifyCallback() { return { valid: false }; },
};

export const PROVIDERS: PaymentProvider[] = [manualProvider, apiProvider('mpesa'), apiProvider('emola')];
