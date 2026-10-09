// Configuração central. Tudo o que depende de contas externas (Supabase, SMS, FCM) lê daqui.
// Sem variáveis definidas, a app corre em MODO DEMO (localStorage, nada é cobrado nem enviado).

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/** true enquanto não houver projeto Supabase configurado */
export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

export const APP_NAME = 'TXAPILOG';
export const COMPANY = process.env.NEXT_PUBLIC_COMPANY_NAME ?? 'TXAPILOG (Ana Maulele)';
/** Email de contacto público (privacidade, segurança infantil, eliminação de dados). Trocar por um email da marca quando existir. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'anamaulele4@gmail.com';
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://anamaulele4-creator.github.io' + BASE_PATH;
export const MIN_AGE = 13;
/**
 * Tamanho máximo por ficheiro enviado (MB). ÚNICO sítio a mudar.
 * 50 MB = limite do bucket 'clips' no plano grátis do Supabase. Ao subir de plano: aumentar o limite do bucket no Supabase e este valor.
 */
export const MAX_UPLOAD_MB = 50;
export const POLICY_DATE = '7 de outubro de 2026';

export const PROVINCES = [
  'Maputo Cidade', 'Maputo Província', 'Gaza', 'Inhambane', 'Sofala', 'Manica',
  'Tete', 'Zambézia', 'Nampula', 'Niassa', 'Cabo Delgado',
] as const;

export const GAMES = ['Free Fire', 'eFootball', 'PUBG Mobile', 'Call of Duty Mobile', 'Mobile Legends', 'FIFA / FC Mobile'] as const;
export const INTERESTS = ['Torneios', 'Clipes', 'Lives', 'Acessórios', 'Diamantes', 'Coaching', 'Eventos', 'Equipas', 'Criadores'] as const;
