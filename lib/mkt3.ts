// TXAPILOG Marketplace 3.0 — regras puras partilhadas pelos ecrãs (sem dependências: testado em tests/mkt3.test.mjs).
// A autoridade é SEMPRE o servidor (supabase/migrations/2026-10-21-mkt3-*.sql); aqui só se decide o que mostrar.

export type OrderStatus3 =
  | 'criado' | 'aguarda_pagamento' | 'pagamento_processamento' | 'pago' | 'em_preparacao' | 'enviado' | 'em_execucao'
  | 'entregue' | 'concluido' | 'cancelado' | 'disputa' | 'reembolsado' | 'parcialmente_reembolsado';

export const ORDER_STATUS: Record<OrderStatus3, string> = {
  criado: 'Criado', aguarda_pagamento: 'Aguardando pagamento', pagamento_processamento: 'Pagamento em processamento', pago: 'Pago · valor retido',
  em_preparacao: 'Em preparação', enviado: 'Enviado', em_execucao: 'Em execução', entregue: 'Entregue · a aguardar confirmação', concluido: 'Concluído',
  cancelado: 'Cancelado', disputa: 'Em disputa', reembolsado: 'Reembolsado', parcialmente_reembolsado: 'Parcialmente reembolsado',
};
export const orderLabel = (s: string) => (ORDER_STATUS as Record<string, string>)[s] ?? s;
export const ORDER_FINAL: OrderStatus3[] = ['concluido', 'cancelado', 'reembolsado', 'parcialmente_reembolsado'];

/** Transições válidas (igual a mkt__edge_ok no SQL; o teste compara os dois). */
export const V3_EDGES: [OrderStatus3, OrderStatus3][] = [
  ['criado', 'aguarda_pagamento'], ['criado', 'cancelado'],
  ['aguarda_pagamento', 'pagamento_processamento'], ['aguarda_pagamento', 'pago'], ['aguarda_pagamento', 'cancelado'],
  ['pagamento_processamento', 'pago'], ['pagamento_processamento', 'aguarda_pagamento'], ['pagamento_processamento', 'cancelado'],
  ['pago', 'em_preparacao'], ['pago', 'em_execucao'], ['pago', 'enviado'], ['pago', 'entregue'], ['pago', 'disputa'], ['pago', 'reembolsado'], ['pago', 'parcialmente_reembolsado'],
  ['em_preparacao', 'enviado'], ['em_preparacao', 'em_execucao'], ['em_preparacao', 'entregue'], ['em_preparacao', 'disputa'], ['em_preparacao', 'reembolsado'], ['em_preparacao', 'parcialmente_reembolsado'],
  ['enviado', 'entregue'], ['enviado', 'concluido'], ['enviado', 'disputa'], ['enviado', 'reembolsado'], ['enviado', 'parcialmente_reembolsado'],
  ['em_execucao', 'entregue'], ['em_execucao', 'disputa'], ['em_execucao', 'reembolsado'], ['em_execucao', 'parcialmente_reembolsado'],
  ['entregue', 'concluido'], ['entregue', 'em_execucao'], ['entregue', 'disputa'], ['entregue', 'reembolsado'], ['entregue', 'parcialmente_reembolsado'],
  ['disputa', 'concluido'], ['disputa', 'reembolsado'], ['disputa', 'parcialmente_reembolsado'],
];
export const edgeOk = (from: string, to: string) => V3_EDGES.some(([a, b]) => a === from && b === to);

export interface OrderLike { status: string; kind?: string | null; physical?: boolean | null; revision_count?: number }
export type SellerAction = 'preparar' | 'enviar' | 'iniciar' | 'entregar' | 'cancelar_venda';
export type BuyerAction = 'confirmar' | 'pedir_revisao' | 'cancelar' | 'abrir_disputa';

/** Ações que o vendedor vê (o servidor volta a validar). */
export function sellerActions(o: OrderLike): SellerAction[] {
  const svc = o.kind === 'servico'; const phys = !!o.physical; const s = o.status; const out: SellerAction[] = [];
  if (s === 'pago' && !svc) out.push('preparar');
  if (['pago', 'em_preparacao'].includes(s) && phys) out.push('enviar');
  if (['pago', 'em_preparacao'].includes(s) && svc) out.push('iniciar');
  if ((['pago', 'em_preparacao', 'em_execucao'].includes(s) && !phys) || (s === 'enviado' && phys)) out.push('entregar');
  if (['pago', 'em_preparacao', 'em_execucao'].includes(s)) out.push('cancelar_venda');
  return out;
}
export function buyerActions(o: OrderLike, hasDispute = false): BuyerAction[] {
  const s = o.status; const out: BuyerAction[] = [];
  if (['enviado', 'entregue'].includes(s)) out.push('confirmar');
  if (s === 'entregue' && o.kind === 'servico' && (o.revision_count ?? 0) < 3) out.push('pedir_revisao');
  if (['criado', 'aguarda_pagamento'].includes(s)) out.push('cancelar');
  if (!hasDispute && ['pago', 'em_preparacao', 'enviado', 'em_execucao', 'entregue'].includes(s)) out.push('abrir_disputa');
  return out;
}
export const ACTION_LABEL: Record<SellerAction | BuyerAction, string> = {
  preparar: 'Marcar em preparação', enviar: 'Registar envio', iniciar: 'Iniciar execução', entregar: 'Registar entrega', cancelar_venda: 'Cancelar e reembolsar',
  confirmar: 'Confirmar receção', pedir_revisao: 'Pedir revisão', cancelar: 'Cancelar pedido', abrir_disputa: 'Abrir reclamação',
};

/** Igual a mkt__commission_amount no SQL: arredondamento de base × pct / 100 + fixa, nunca acima da base. */
export function commissionAmount(base: number, pct: number | null, fixed = 0): number {
  const b = Math.max(0, Math.trunc(base));
  return Math.min(b, Math.floor((b * (pct ?? 0)) / 100 + 0.5) + Math.trunc(fixed || 0));
}

export const STORE_STATUS: Record<string, string> = { configuracao: 'Em configuração', pendente: 'Pendente de verificação', ativa: 'Ativa', suspensa: 'Suspensa', encerrada: 'Encerrada' };
export const PRODUCT_STATUS: Record<string, string> = { rascunho: 'Rascunho', pendente: 'Pendente de revisão', ativo: 'Publicado', esgotado: 'Esgotado', suspenso: 'Suspenso', arquivado: 'Arquivado', removido: 'Removido' };
export const PAYMENT_STATUS: Record<string, string> = {
  criado: 'Criado', pendente: 'Pendente', processamento: 'Em processamento', confirmado: 'Confirmado', recusado: 'Recusado', expirado: 'Expirado',
  cancelado: 'Cancelado', reembolsado: 'Reembolsado', parcialmente_reembolsado: 'Parcialmente reembolsado',
};
export const DISPUTE_STATUS: Record<string, string> = {
  aberta: 'Aberta', aguardando_resposta: 'Aguardando resposta', em_analise: 'Em análise', aguardando_provas: 'Aguardando provas',
  solucao_proposta: 'Solução proposta', resolvida: 'Resolvida', rejeitada: 'Rejeitada com justificação', encerrada: 'Encerrada',
};
export const DISPUTE_REASONS: Record<string, string> = {
  nao_recebido: 'Não recebi', diferente: 'Diferente do anunciado', defeituoso: 'Com defeito / não funciona', servico_incompleto: 'Serviço incompleto', fraude: 'Suspeita de fraude', outro: 'Outro motivo',
};
export const PAYOUT_STATUS: Record<string, string> = { pedido: 'Pedido', em_processamento: 'Em processamento', pago: 'Pago', recusado: 'Recusado', falhou: 'Falhou' };
export const JOURNAL_KIND: Record<string, string> = {
  pagamento_compra: 'Pagamento de compra', reembolso: 'Reembolso', comissao: 'Comissão', ajuste: 'Ajustamento autorizado', credito: 'Crédito confirmado',
  debito: 'Débito confirmado', pagamento_vendedor: 'Pagamento ao vendedor', estorno: 'Estorno', liberacao: 'Libertação',
};
/** Motivos da carteira (money_ledger) — inclui os do marketplace. */
export const LEDGER_REASON: Record<string, string> = {
  deposito: 'Depósito', levantamento: 'Levantamento', levantamento_recusado: 'Levantamento devolvido', aposta: 'Aposta', ganho: 'Ganho', reembolso: 'Reembolso',
  correcao: 'Correção', ajuste: 'Ajuste', comissao_afiliado: 'Comissão de afiliado', compra: 'Compra no marketplace', venda: 'Venda no marketplace',
  payout: 'Pagamento ao vendedor (pedido)', payout_recusado: 'Pagamento ao vendedor devolvido',
};

export const PERMISSIONS = [
  'USERS_VIEW', 'USERS_MANAGE', 'CREATORS_VIEW', 'CREATORS_MANAGE', 'STORES_VIEW', 'STORES_MANAGE', 'PRODUCTS_VIEW', 'PRODUCTS_MODERATE', 'ORDERS_VIEW', 'PAYMENTS_VIEW',
  'REFUNDS_MANAGE', 'PAYOUTS_VIEW', 'PAYOUTS_MANAGE', 'DISPUTES_VIEW', 'DISPUTES_MANAGE', 'REPORTS_VIEW', 'AUDIT_LOGS_VIEW', 'AUDIT_LOGS_EXPORT', 'SECURITY_MANAGE', 'SETTINGS_MANAGE',
] as const;
export type Perm = typeof PERMISSIONS[number];
export const PERM_LABEL: Record<Perm, string> = {
  USERS_VIEW: 'Ver utilizadores', USERS_MANAGE: 'Gerir utilizadores (suspensões)', CREATORS_VIEW: 'Ver criadores', CREATORS_MANAGE: 'Gerir criadores', STORES_VIEW: 'Ver lojas',
  STORES_MANAGE: 'Gerir lojas', PRODUCTS_VIEW: 'Ver produtos', PRODUCTS_MODERATE: 'Moderar produtos', ORDERS_VIEW: 'Ver pedidos', PAYMENTS_VIEW: 'Ver pagamentos e reconciliar',
  REFUNDS_MANAGE: 'Fazer reembolsos', PAYOUTS_VIEW: 'Ver pagamentos a vendedores', PAYOUTS_MANAGE: 'Pagar vendedores', DISPUTES_VIEW: 'Ver reclamações',
  DISPUTES_MANAGE: 'Decidir reclamações', REPORTS_VIEW: 'Ver relatórios', AUDIT_LOGS_VIEW: 'Ver auditoria', AUDIT_LOGS_EXPORT: 'Exportar auditoria',
  SECURITY_MANAGE: 'Segurança e risco', SETTINGS_MANAGE: 'Configurações e comissões',
};

/** Mensagens de erro compreensíveis para os códigos do servidor. */
export const MKT3_ERR: Record<string, string> = {
  AUTH: 'Entra na tua conta para continuar.', FORBIDDEN: 'Não tens permissão para esta ação.', NOT_FOUND: 'Não encontrado.', MKT3_OFF: 'Esta área do marketplace ainda não está aberta.',
  NOT_SELLER: 'Só criadores ou vendedores verificados podem ter loja.', SLUG_TAKEN: 'Esse endereço da loja já está ocupado.', INVALID: 'Dados inválidos: revê os campos.',
  PHOTOS: 'Só podes usar imagens que carregaste aqui.', STORE_SUSPENDED: 'A tua loja está suspensa.', STATE: 'Esta ação já não é possível neste estado.', REASON: 'Indica o motivo (mais detalhe).',
  RATE: 'Demasiados pedidos seguidos. Tenta daqui a pouco.', STOCK: 'Stock insuficiente.', OWN: 'Não podes comprar o teu próprio produto.', VARIANT: 'Opção indisponível.',
  VARIANT_REQUIRED: 'Escolhe uma opção.', NO_PRICE: 'Produto sem preço definido.', CART_FULL: 'Carrinho cheio (máx. 50 linhas).', EMPTY: 'O carrinho está vazio.',
  CART_ISSUES: 'Há produtos indisponíveis no carrinho. Revê o carrinho.', ADDRESS: 'Preenche o nome, telefone (84–87…), cidade e morada de entrega.',
  PAYMENT_UNAVAILABLE: 'Pagamento ainda não disponível. Nada foi cobrado.', COMMISSION_UNDEFINED: 'A plataforma ainda não definiu a comissão. Pagamento ainda não disponível.',
  IDEMPOTENCY: 'Pedido inválido. Atualiza a página.', ACCOUNT: 'A tua conta está suspensa ou limitada.', BALANCE: 'Saldo insuficiente na carteira.', EXPIRED: 'O prazo de pagamento terminou. O pedido foi cancelado.',
  EVIDENCE: 'Descreve a entrega (o que foi entregue e como) — fica como evidência.', CARRIER: 'Indica a transportadora/meio de envio.', REVISIONS: 'Limite de 3 revisões atingido.',
  PAYOUTS_OFF: 'Pagamentos aos vendedores ainda não disponíveis.', IDENTITY: 'Verifica primeiro a tua identidade (documento + selfie).', PHONE: 'Número inválido para o método escolhido.',
  AMOUNT: 'Valor inválido.', PAYOUT_OPEN: 'Já tens um pedido de pagamento em curso.', REF: 'Indica a referência da transação do operador.', DUP_REF: 'Essa referência já foi usada.',
  ALREADY: 'Já existe.', TEXT: 'Escreve uma mensagem.', BLOCKED: 'Não é possível enviar: existe um bloqueio entre vocês.', RATING: 'Escolhe de 1 a 5 estrelas.',
  EDIT_LOCKED: 'A avaliação já não pode ser editada.', TOO_LATE: 'O prazo para avaliar terminou.', HIDDEN: 'Avaliação oculta pela moderação.', MANDATORY: 'Este aviso é obrigatório.',
  NOT_PAID: 'O pedido ainda não está pago.', ALREADY_SETTLED: 'O pedido já foi liquidado.', DUPLICATE: 'Já existe uma opção com esse nome.', LIMIT: 'Limite atingido.',
  STORE: 'Loja inválida.', VIDEOS: 'Vídeos: só links do YouTube.', PROHIBITED: 'Conteúdo proibido no marketplace.', STATUS_FORBIDDEN: 'Esse estado só pode ser mudado pela moderação.',
  USER_NOT_FOUND: 'Não existe nenhum utilizador com esse @.', SELF: 'Não te podes adicionar a ti próprio.',
  CONTAS_CRIADOR: 'Só criadores podem vender contas.', CONTAS_OFF: 'A venda de contas está desativada pelo admin.', FEATURE_FORBIDDEN: 'Não podes destacar este anúncio.',
  DIRECT_IN_PROGRESS: 'Já há um pagamento por M-Pesa/e-Mola em curso para este pedido. Aprova-o no telemóvel ou espera uns minutos.',
  PROVIDER_NOT_CONFIGURED: 'Pagamento ainda não disponível. Nada foi cobrado.', PROVIDER_ERROR: 'O operador não respondeu. Nada foi cobrado; tenta de novo.',
  BAD_PHONE: 'Número inválido para o método escolhido.', DEPOSIT_LIMIT: 'Ultrapassa o limite de depósitos que definiste na carteira.', REDE: 'Sem ligação. Tenta de novo.',
  NOT_INSTALLED: 'O SQL do Marketplace 3.0 ainda não foi instalado.', DEMO: 'Disponível só com a base de dados ligada.',
};
export function errText(code?: string | null): string {
  if (!code) return 'Erro desconhecido.';
  if (MKT3_ERR[code]) return MKT3_ERR[code];
  const k = (code.match(/[A-Z][A-Z_]{2,}/g) ?? []).find((x) => MKT3_ERR[x]);
  return k ? MKT3_ERR[k] : code;
}

/** CSV com separador ; (abre bem no Excel em pt-PT) e aspas quando necessário. */
export function toCsv(rows: Record<string, unknown>[], cols: string[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s; // evita fórmulas (injeção em folhas de cálculo)
    return /[";\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  return [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
}

/** Histórico de pesquisa (só neste dispositivo; o utilizador pode apagar). */
export function pushHistory(list: string[], q: string, max = 10): string[] {
  const t = q.trim().slice(0, 80);
  if (t.length < 2) return list;
  return [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, max);
}

export const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export const validSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(s);
export const validYoutube = (u: string) => /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{6,20}([?&][A-Za-z0-9_=&-]*)?$/.test(u);
export const mzPhone = (p: string) => p.replace(/[\s-]/g, '').replace(/^\+?258/, '');

export const fmtMt = (v: number | null | undefined) => `${Math.round(Number(v ?? 0)).toLocaleString('pt-PT')} MT`;
export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Maputo' }) : '—');

export const COUPON_KEY = 'txap-mkt3-coupons';
