// Interruptores globais (public.app_settings): lidos por todos, mudados só por quem tem permissão, através
// da função app_setting_set (fica no registo de auditoria). Migração: supabase/migrations/2026-10-20-apostas-v2.sql.
// Modo demo: guardados no localStorage.
import { IS_DEMO } from './config';
import { sb } from './supabase';

export type AppSettingKey = 'apostas_enabled' | 'apostas_limits' | 'venda_contas_enabled'
  | 'mkt3_enabled' | 'mkt3_checkout_enabled' | 'mkt3_payouts_enabled' | 'mkt3_store_review_required' | 'mkt3_product_review_required';
/** Valor quando o SQL ainda não foi instalado: apostas DESLIGADAS; venda de contas como já estava (ligada). */
export const APP_SETTING_DEFAULTS: Record<AppSettingKey, unknown> = {
  apostas_enabled: false,
  apostas_limits: { min_stake: 10, max_stake: 5000, initial_test_balance: 1000 },
  venda_contas_enabled: true,
  // Marketplace 3.0 (supabase/migrations/2026-10-21-mkt3-01-base.sql): tudo desligado até o admin ligar
  mkt3_enabled: false, mkt3_checkout_enabled: false, mkt3_payouts_enabled: false, mkt3_store_review_required: true, mkt3_product_review_required: false,
};
const DEMO_KEY = 'txap-app-settings-demo-v1';
const demoRead = (): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) ?? '{}'); } catch { return {}; } };

export const isMissing = (m: string) => /does not exist|could not find|schema cache|PGRST20[0-9]|42P01|42883/i.test(m);

export async function getAppSetting<T = unknown>(key: AppSettingKey): Promise<{ value: T; installed: boolean }> {
  if (IS_DEMO) { const d = demoRead(); return { value: (key in d ? d[key] : APP_SETTING_DEFAULTS[key]) as T, installed: true }; }
  try {
    const c = await sb();
    const { data, error } = await c.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) return { value: APP_SETTING_DEFAULTS[key] as T, installed: !isMissing(error.message) };
    if (!data) return { value: APP_SETTING_DEFAULTS[key] as T, installed: false };
    return { value: data.value as T, installed: true };
  } catch { return { value: APP_SETTING_DEFAULTS[key] as T, installed: false }; }
}

export async function setAppSetting(key: AppSettingKey, value: unknown): Promise<{ ok: true } | { ok: false; code: string }> {
  if (IS_DEMO) { const d = demoRead(); d[key] = value; localStorage.setItem(DEMO_KEY, JSON.stringify(d)); return { ok: true }; }
  const c = await sb();
  const { data, error } = await c.rpc('app_setting_set', { p_key: key, p_value: value });
  if (error) return { ok: false, code: isMissing(error.message) ? 'NOT_INSTALLED' : error.message };
  return data?.ok ? { ok: true } : { ok: false, code: data?.code ?? 'ERRO' };
}
