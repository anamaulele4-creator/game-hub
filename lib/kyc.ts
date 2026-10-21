// KYC unificado — regras puras (iguais às do SQL em supabase/migrations/2026-10-21-kyc-unificado.sql).
// Um só sítio para todas as verificações de identidade e documentos, para todos os utilizadores.
// Testes: tests/kyc.test.mjs (regras) e tests/kyc-sql.test.mjs (base de dados real em memória: RLS, permissões, estados).

export type KycPurpose = 'identidade' | 'vendedor' | 'afiliado' | 'levantamento' | 'criador';
export type KycStatus = 'pendente' | 'em_analise' | 'aprovado' | 'recusado' | 'mais_documentos';
export type KycDocType = 'bi' | 'passaporte' | 'carta_conducao' | 'dire' | 'nuit' | 'comprovativo_morada' | 'selfie' | 'selfie_documento' | 'outro' | 'documento';
export type KycSide = 'frente' | 'verso' | 'unico';
export type KycAction = 'em_analise' | 'aprovado' | 'recusado' | 'mais_documentos';

export const PURPOSES: KycPurpose[] = ['identidade', 'vendedor', 'afiliado', 'levantamento', 'criador'];
export const PURPOSE_LABEL: Record<KycPurpose, string> = {
  identidade: 'Identidade (geral)', vendedor: 'Vendedor (contas e diamantes)', afiliado: 'Afiliado / moderador', levantamento: 'Levantamentos', criador: 'Criador',
};
export const PURPOSE_HINT: Record<KycPurpose, string> = {
  identidade: 'Confirma quem és. Basta um documento.',
  vendedor: 'Obrigatória para vender contas e diamantes/moedas: documento com foto + selfie.',
  afiliado: 'Para o programa de afiliados e moderadores: documento com foto + selfie.',
  levantamento: 'Para levantar dinheiro e subir os limites diários: documento com foto + selfie (de preferência a segurar o documento).',
  criador: 'Para o programa de criadores: documento com foto.',
};
/** Tipos que o utilizador pode escolher ('documento' é só para registos antigos migrados). */
export const DOC_TYPES: Exclude<KycDocType, 'documento'>[] = ['bi', 'passaporte', 'carta_conducao', 'dire', 'nuit', 'comprovativo_morada', 'selfie', 'selfie_documento', 'outro'];
export const DOC_LABEL: Record<KycDocType, string> = {
  bi: 'BI', passaporte: 'Passaporte', carta_conducao: 'Carta de condução', dire: 'DIRE', nuit: 'NUIT', comprovativo_morada: 'Comprovativo de morada',
  selfie: 'Selfie', selfie_documento: 'Selfie a segurar o documento', outro: 'Outro documento', documento: 'Documento de identificação',
};
/** Documentos com frente e verso. */
export const TWO_SIDED: KycDocType[] = ['bi', 'carta_conducao', 'dire'];
export const SIDE_LABEL: Record<KycSide, string> = { frente: 'Frente', verso: 'Verso', unico: 'Foto' };
export const STATUSES: KycStatus[] = ['pendente', 'em_analise', 'aprovado', 'recusado', 'mais_documentos'];
export const STATUS_LABEL: Record<KycStatus, string> = {
  pendente: 'Pendente', em_analise: 'Em análise', aprovado: 'Aprovado', recusado: 'Recusado', mais_documentos: 'Pedir mais documentos',
};
/** Como o utilizador vê o estado do próprio pedido. */
export const STATUS_USER: Record<KycStatus, string> = {
  pendente: 'Enviado — à espera de análise', em_analise: 'Em análise', aprovado: 'Aprovado', recusado: 'Recusado', mais_documentos: 'Faltam documentos',
};
export const STATUS_TONE: Record<KycStatus, 'amber' | 'blue' | 'green' | 'red' | 'gray'> = {
  pendente: 'amber', em_analise: 'blue', aprovado: 'green', recusado: 'red', mais_documentos: 'gray',
};
export const ACTION_LABEL: Record<KycAction, string> = { em_analise: 'Marcar em análise', aprovado: 'Aprovar', recusado: 'Recusar', mais_documentos: 'Pedir mais documentos' };

export const isIdDoc = (t: string) => ['bi', 'passaporte', 'carta_conducao', 'dire', 'documento'].includes(t);
export const isSelfie = (t: string) => t === 'selfie' || t === 'selfie_documento';
export const isOpen = (s: KycStatus) => s === 'pendente' || s === 'em_analise' || s === 'mais_documentos';
const SELFIE_PURPOSES: KycPurpose[] = ['vendedor', 'afiliado', 'levantamento'];

/** Documentos obrigatórios por finalidade. Devolve o código de erro (igual ao do servidor) ou null. */
export function missingDocs(purpose: KycPurpose, types: string[]): 'FILES' | 'NEED_ID' | 'NEED_SELFIE' | null {
  if (types.length === 0) return 'FILES';
  if (purpose !== 'identidade' && !types.some(isIdDoc)) return 'NEED_ID';
  if (SELFIE_PURPOSES.includes(purpose) && !types.some(isSelfie)) return 'NEED_SELFIE';
  return null;
}
export const needsSelfie = (p: KycPurpose) => SELFIE_PURPOSES.includes(p);

/** Transições que o revisor pode fazer. mais_documentos → pendente acontece quando o utilizador envia mais ficheiros. */
export function canTransition(from: KycStatus, to: KycAction): boolean {
  if (from === 'pendente') return ['em_analise', 'aprovado', 'recusado', 'mais_documentos'].includes(to);
  if (from === 'em_analise') return ['aprovado', 'recusado', 'mais_documentos'].includes(to);
  if (from === 'mais_documentos') return to === 'recusado' || to === 'em_analise';
  return false;
}
export const actionsFor = (s: KycStatus): KycAction[] => (['em_analise', 'mais_documentos', 'recusado', 'aprovado'] as KycAction[]).filter((a) => canTransition(s, a));
/** Motivo obrigatório (mín. 5 caracteres) para aprovar, recusar e pedir documentos. */
export const needsReason = (a: KycAction) => a !== 'em_analise';
export const validReason = (a: KycAction, r: string) => !needsReason(a) || r.trim().length >= 5;

/** Uma finalidade fica coberta por pedidos aprovados (igual a kyc__verified no SQL). */
export function verifiedFor(purpose: KycPurpose, approved: KycPurpose[], legacySeller = false): boolean {
  const strong = approved.some((p) => SELFIE_PURPOSES.includes(p)) || legacySeller;
  if (purpose === 'identidade') return approved.length > 0 || legacySeller;
  if (purpose === 'criador') return strong || approved.includes('criador');
  return strong;
}

/** Caminho no bucket privado: <uid>/kyc-<tipo>-<lado>-<carimbo>.<ext> */
export function filePath(uid: string, type: KycDocType, side: KycSide, ext: string, stamp: string): string {
  const e = ext.toLowerCase().replace('jpeg', 'jpg');
  return `${uid}/kyc-${type}-${side}-${stamp}.${['webp', 'jpg', 'png', 'pdf'].includes(e) ? e : 'jpg'}`;
}
export const validPath = (uid: string, p: string) => new RegExp(`^${uid.replace(/[-]/g, '\\-')}/[A-Za-z0-9._-]{1,100}\\.(webp|jpe?g|png|pdf)$`).test(p);

export const KYC_ERR: Record<string, string> = {
  AUTH: 'Entra na tua conta.', FORBIDDEN: 'Sem permissão (precisas de ser admin ou ter a permissão KYC_REVIEW).', PURPOSE: 'Escolhe a finalidade da verificação.',
  FILES: 'Adiciona pelo menos um ficheiro válido (JPG, PNG, WebP ou PDF).', FILES_MISSING: 'Um dos ficheiros não chegou ao servidor. Tenta enviar outra vez.',
  DOC_TYPE: 'Tipo de documento inválido.', NEED_ID: 'Falta um documento com foto (BI, passaporte, carta de condução ou DIRE).',
  NEED_SELFIE: 'Falta a selfie (ou a selfie a segurar o documento).', OPEN: 'Já tens um pedido aberto para esta finalidade. Espera pela decisão ou completa-o.',
  ALREADY: 'Já estás verificado para esta finalidade.', RATE: 'Demasiados pedidos hoje. Tenta amanhã.', NOTE: 'Nota demasiado longa (máx. 500).',
  STATE: 'Este pedido já mudou de estado. Atualiza a lista.', REASON: 'Escreve o motivo (mín. 5 caracteres). O utilizador vê-o.', ACTION: 'Ação inválida.',
  NOT_FOUND: 'Pedido não encontrado.', SELF: 'Não podes decidir o teu próprio pedido.', NOT_INSTALLED: 'KYC unificado ainda não instalado no servidor (corre /sql-kyc.html).',
  TOO_BIG: 'Ficheiro acima de 8 MB.', FORMAT: 'Formato não suportado. Usa JPG, PNG, WebP ou PDF.',
};
