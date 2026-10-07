// Centro de segurança (estilo exchange): PIN de transação, 2FA (Supabase MFA TOTP) + fallback por código,
// anti-phishing, lista branca de levantamentos, níveis KYC, dispositivos/sessões, histórico de logins, congelar conta.
// MODO REAL: funções SQL security definer (supabase/schema.sql §15) — o PIN nunca é guardado nem verificado no cliente.
// MODO DEMO: tudo simulado no navegador.
import { IS_DEMO } from './config';
import { friendlyError } from './auth';

export interface SecStatus {
  pinSet: boolean; pinLockedUntil?: string; antiPhishing?: string; withdrawalsLockedUntil?: string; frozen: boolean; kycLevel: number;
  codeFallback: boolean; newDeviceAlerts: boolean; totp: { id: string; status: string }[]; email?: string; phone?: string;
}
export interface WlEntry { id: string; method: 'M-Pesa' | 'e-Mola'; msisdn: string; label: string; activeAfter: string }
export interface Device { id: string; label: string; firstSeen: string; lastSeen: string; ip?: string; current: boolean }
export interface LoginEv { at: string; device: string; ip?: string; newDevice: boolean }
export interface SecEvent { at: string; event: string; detail: string; ip?: string }
export interface KycLimit { level: number; label: string; withdraw: number; purchase: number }
export interface KycSub { id: string; level: number; kind: string; status: string; note?: string; at: string }

export const KYC_DEFAULT: KycLimit[] = [
  { level: 0, label: 'Sem verificação', withdraw: 0, purchase: 2000 },
  { level: 1, label: 'Telemóvel verificado', withdraw: 5000, purchase: 10000 },
  { level: 2, label: 'Documento de identidade', withdraw: 50000, purchase: 100000 },
  { level: 3, label: 'Selfie com documento', withdraw: 250000, purchase: 500000 },
];

const sbMod = () => import('./supabase').then((m) => m.sb());
const DKEY = 'gamehub-sec-demo-v1';
interface Demo { pin?: string; fails: number; lockedUntil?: string; anti?: string; wlLock?: string; frozen: boolean; kyc: number; totp: boolean; fallback: boolean; alerts: boolean; wl: WlEntry[]; events: SecEvent[]; kycSubs: KycSub[]; logins: LoginEv[] }
function demo(): Demo {
  try { const r = localStorage.getItem(DKEY); if (r) return JSON.parse(r); } catch {}
  const d: Demo = { fails: 0, frozen: false, kyc: 1, totp: false, fallback: true, alerts: true, wl: [], events: [], kycSubs: [], logins: [{ at: new Date().toISOString(), device: deviceLabel(), ip: '—', newDevice: false }] };
  saveDemo(d); return d;
}
function saveDemo(d: Demo) { try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch {} }
function dlog(d: Demo, event: string, detail = '') { d.events.unshift({ at: new Date().toISOString(), event, detail }); d.events = d.events.slice(0, 100); }
const in24 = () => new Date(Date.now() + 86400000).toISOString();

export function deviceId(): string {
  try {
    let id = localStorage.getItem('gamehub-device-id');
    if (!id) { id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)) as string; localStorage.setItem('gamehub-device-id', id); }
    return id;
  } catch { return 'desconhecido'; }
}
export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Dispositivo';
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Outro';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${br} · ${os}`;
}

type R<T = void> = Promise<{ ok: boolean; error?: string; data?: T }>;
const fail = (e: unknown) => ({ ok: false, error: friendlyError(e) });

export async function status(): Promise<SecStatus | null> {
  if (IS_DEMO) { const d = demo(); return { pinSet: !!d.pin, pinLockedUntil: d.lockedUntil, antiPhishing: d.anti, withdrawalsLockedUntil: d.wlLock, frozen: d.frozen, kycLevel: d.kyc, codeFallback: d.fallback, newDeviceAlerts: d.alerts, totp: d.totp ? [{ id: 'demo', status: 'verified' }] : [], email: 'demo@poipak.mz' }; }
  const c = await sbMod();
  const { data: u } = await c.auth.getUser();
  if (!u.user) return null;
  await c.rpc('ensure_security_row');
  const [{ data: s }, f] = await Promise.all([
    c.from('security_settings').select('pin_set_at,pin_locked_until,anti_phishing_code,withdrawals_locked_until,frozen,kyc_level,code_fallback,new_device_alerts').eq('user_id', u.user.id).maybeSingle(),
    c.auth.mfa.listFactors(),
  ]);
  return {
    pinSet: !!s?.pin_set_at, pinLockedUntil: s?.pin_locked_until ?? undefined, antiPhishing: s?.anti_phishing_code ?? undefined,
    withdrawalsLockedUntil: s?.withdrawals_locked_until ?? undefined, frozen: !!s?.frozen, kycLevel: s?.kyc_level ?? 0,
    codeFallback: s?.code_fallback ?? true, newDeviceAlerts: s?.new_device_alerts ?? true,
    totp: (f.data?.totp ?? []).map((x) => ({ id: x.id, status: x.status })), email: u.user.email, phone: u.user.phone,
  };
}

export async function setPin(pin: string, old?: string): R {
  if (!/^\d{6}$/.test(pin)) return { ok: false, error: 'O PIN tem de ter 6 dígitos.' };
  if (IS_DEMO) {
    const d = demo();
    if (d.pin && d.pin !== old) return { ok: false, error: 'PIN atual incorreto.' };
    if (['000000', '123456', '111111', '654321'].includes(pin)) return { ok: false, error: 'PIN demasiado fácil. Escolhe outro.' };
    if (d.pin) d.wlLock = in24();
    dlog(d, d.pin ? 'PIN alterado (levantamentos bloqueados 24 h)' : 'PIN criado'); d.pin = pin; d.fails = 0; saveDemo(d); return { ok: true };
  }
  const c = await sbMod();
  const { error } = await c.rpc('set_transaction_pin', { p_pin: pin, p_old: old ?? null });
  return error ? fail(error) : { ok: true };
}

/** Verifica o PIN no servidor e devolve uma autorização de uso único (5 min) para pagamento/levantamento. */
export async function authorize(pin: string, purpose: 'pagamento' | 'levantamento', amount: number): R<string> {
  if (IS_DEMO) {
    const d = demo();
    if (d.frozen) return { ok: false, error: 'A conta está congelada.' };
    if (!d.pin) return { ok: false, error: 'Cria primeiro o teu PIN de transação.' };
    if (d.lockedUntil && d.lockedUntil > new Date().toISOString()) return { ok: false, error: 'PIN bloqueado por tentativas falhadas (30 min).' };
    if (pin !== d.pin) { d.fails += 1; if (d.fails >= 5) d.lockedUntil = new Date(Date.now() + 1800000).toISOString(); dlog(d, 'PIN incorreto', purpose); saveDemo(d); return { ok: false, error: `PIN incorreto (${d.fails} de 5 tentativas).` }; }
    d.fails = 0; dlog(d, 'Transação autorizada', `${purpose} · ${amount} MZN`); saveDemo(d); return { ok: true, data: 'demo-' + Date.now() };
  }
  const c = await sbMod();
  const { data, error } = await c.rpc('issue_tx_token', { p_pin: pin, p_purpose: purpose, p_amount: Math.round(amount) });
  if (error) return fail(error);
  if (typeof data === 'string' && data.startsWith('ERR:')) return { ok: false, error: data.slice(4) };
  return { ok: true, data: String(data) };
}

export async function setAntiPhishing(code: string): R {
  if (code.length < 4 || code.length > 20) return { ok: false, error: '4 a 20 caracteres.' };
  if (IS_DEMO) { const d = demo(); d.anti = code; dlog(d, 'Código anti-phishing definido'); saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { error } = await c.rpc('set_anti_phishing_code', { p_code: code });
  if (error) return fail(error);
  await c.auth.updateUser({ data: { anti_phishing: code } }); // disponível nos modelos de email como {{ .Data.anti_phishing }}
  return { ok: true };
}

export async function setPrefs(p: { codeFallback?: boolean; newDeviceAlerts?: boolean }): R {
  if (IS_DEMO) { const d = demo(); if (p.codeFallback != null) d.fallback = p.codeFallback; if (p.newDeviceAlerts != null) d.alerts = p.newDeviceAlerts; saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { data: u } = await c.auth.getUser();
  const { error } = await c.from('security_settings').update({ ...(p.codeFallback != null ? { code_fallback: p.codeFallback } : {}), ...(p.newDeviceAlerts != null ? { new_device_alerts: p.newDeviceAlerts } : {}) }).eq('user_id', u.user?.id ?? '');
  return error ? fail(error) : { ok: true };
}

export async function freeze(): R {
  if (IS_DEMO) { const d = demo(); d.frozen = true; d.wlLock = in24(); dlog(d, 'Conta congelada pelo próprio utilizador'); saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { error } = await c.rpc('freeze_my_account');
  if (error) return fail(error);
  await c.auth.signOut({ scope: 'global' }); // termina todas as sessões em todos os dispositivos
  return { ok: true };
}

// ----- 2FA (Supabase MFA TOTP) -----
export async function enrollTotp(): R<{ factorId: string; qr: string; secret: string }> {
  if (IS_DEMO) return { ok: true, data: { factorId: 'demo', qr: '', secret: 'DEMO-JBSWY3DPEHPK3PXP' } };
  const c = await sbMod();
  const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Social POIPAK ' + deviceLabel() });
  if (error || data.type !== 'totp') return fail(error ?? { message: 'Falha ao ativar 2FA' });
  return { ok: true, data: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}
export async function verifyTotp(factorId: string, code: string): R {
  if (IS_DEMO) { if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Código de 6 dígitos.' }; const d = demo(); d.totp = true; d.wlLock = in24(); dlog(d, '2FA ativado'); saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { data: ch, error: e1 } = await c.auth.mfa.challenge({ factorId });
  if (e1) return fail(e1);
  const { error } = await c.auth.mfa.verify({ factorId, challengeId: ch.id, code });
  return error ? fail(error) : { ok: true };
}
export async function unenrollTotp(factorId: string): R {
  if (IS_DEMO) { const d = demo(); d.totp = false; d.wlLock = in24(); dlog(d, '2FA removido (levantamentos bloqueados 24 h)'); saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { error } = await c.auth.mfa.unenroll({ factorId });
  return error ? fail(error) : { ok: true };
}
/** Depois do login com palavra-passe: falta confirmar o 2FA? */
export async function needsMfa(): Promise<string | null> {
  if (IS_DEMO) return null;
  const c = await sbMod();
  const { data } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
    const f = await c.auth.mfa.listFactors();
    return f.data?.totp.find((x) => x.status === 'verified')?.id ?? null;
  }
  return null;
}

// ----- Lista branca -----
export async function whitelist(): Promise<WlEntry[]> {
  if (IS_DEMO) return demo().wl;
  const c = await sbMod();
  const { data } = await c.from('withdrawal_whitelist').select('id,method,msisdn,label,active_after').order('created_at');
  return (data ?? []).map((r) => ({ id: r.id, method: r.method, msisdn: r.msisdn, label: r.label, activeAfter: r.active_after }));
}
export async function addWhitelist(method: 'M-Pesa' | 'e-Mola', msisdn: string, label: string): R {
  const n = msisdn.replace(/\D/g, '').replace(/^258/, '');
  if (!/^8[2-7]\d{7}$/.test(n)) return { ok: false, error: 'Número moçambicano inválido (ex.: 84 123 4567).' };
  if (method === 'M-Pesa' && !/^8[45]/.test(n)) return { ok: false, error: 'M-Pesa usa números 84 ou 85.' };
  if (method === 'e-Mola' && !/^8[67]/.test(n)) return { ok: false, error: 'e-Mola usa números 86 ou 87.' };
  if (IS_DEMO) { const d = demo(); d.wl.push({ id: 'wl' + Date.now(), method, msisdn: '258' + n, label, activeAfter: in24() }); d.wlLock = in24(); dlog(d, 'Número adicionado à lista branca', method); saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { error } = await c.from('withdrawal_whitelist').insert({ method, msisdn: n, label });
  return error ? fail(error) : { ok: true };
}
export async function removeWhitelist(id: string): R {
  if (IS_DEMO) { const d = demo(); d.wl = d.wl.filter((x) => x.id !== id); saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { error } = await c.from('withdrawal_whitelist').delete().eq('id', id);
  return error ? fail(error) : { ok: true };
}

// ----- KYC -----
export async function kycLimits(): Promise<KycLimit[]> {
  if (IS_DEMO) return KYC_DEFAULT;
  const c = await sbMod();
  const { data } = await c.from('kyc_limits').select('*').order('level');
  return data?.length ? data.map((r) => ({ level: r.level, label: r.label, withdraw: r.daily_withdraw_mzn, purchase: r.daily_purchase_mzn })) : KYC_DEFAULT;
}
export async function kycSubs(): Promise<KycSub[]> {
  if (IS_DEMO) return demo().kycSubs;
  const c = await sbMod();
  const { data } = await c.from('kyc_submissions').select('id,level,kind,status,note,created_at').order('created_at', { ascending: false });
  return (data ?? []).map((r) => ({ id: r.id, level: r.level, kind: r.kind, status: r.status, note: r.note ?? undefined, at: r.created_at }));
}
export async function submitKyc(level: number, kind: 'telefone' | 'documento' | 'selfie', file?: File): R {
  if (IS_DEMO) { const d = demo(); d.kycSubs.unshift({ id: 'k' + Date.now(), level, kind, status: 'pendente', at: new Date().toISOString() }); dlog(d, 'Verificação enviada', kind); saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { data: u } = await c.auth.getUser();
  let doc_path: string | null = null;
  if (file) {
    if (file.size > 8 * 1024 * 1024) return { ok: false, error: 'Ficheiro até 8 MB.' };
    doc_path = `${u.user?.id}/${kind}-${Date.now()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`;
    const up = await c.storage.from('kyc-docs').upload(doc_path, file, { upsert: false });
    if (up.error) return fail(up.error);
  }
  const { error } = await c.from('kyc_submissions').insert({ level, kind, doc_path });
  return error ? fail(error) : { ok: true };
}

// ----- Dispositivos, sessões, histórico -----
export async function logLogin(): Promise<void> {
  if (IS_DEMO) return;
  try {
    if (sessionStorage.getItem('gamehub-login-logged')) return;
    const c = await sbMod();
    const { data } = await c.auth.getSession();
    if (!data.session) return;
    await c.rpc('log_login', { p_device_id: deviceId(), p_device_label: deviceLabel() });
    sessionStorage.setItem('gamehub-login-logged', '1');
  } catch {}
}
export async function devices(): Promise<Device[]> {
  if (IS_DEMO) return [{ id: deviceId(), label: deviceLabel(), firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), current: true }];
  const c = await sbMod();
  const { data } = await c.from('known_devices').select('device_id,label,first_seen,last_seen,last_ip').order('last_seen', { ascending: false });
  return (data ?? []).map((r) => ({ id: r.device_id, label: r.label, firstSeen: r.first_seen, lastSeen: r.last_seen, ip: r.last_ip ?? undefined, current: r.device_id === deviceId() }));
}
export async function removeDevice(id: string): R {
  if (IS_DEMO) return { ok: true };
  const c = await sbMod();
  const { error } = await c.from('known_devices').delete().eq('device_id', id);
  return error ? fail(error) : { ok: true };
}
export async function signOutOthers(): R {
  if (IS_DEMO) { const d = demo(); dlog(d, 'Sessões noutros dispositivos terminadas'); saveDemo(d); return { ok: true }; }
  const c = await sbMod();
  const { error } = await c.auth.signOut({ scope: 'others' });
  return error ? fail(error) : { ok: true };
}
export async function loginHistory(): Promise<LoginEv[]> {
  if (IS_DEMO) return demo().logins;
  const c = await sbMod();
  const { data } = await c.from('login_events').select('created_at,device_label,ip,new_device').order('created_at', { ascending: false }).limit(30);
  return (data ?? []).map((r) => ({ at: r.created_at, device: r.device_label ?? '—', ip: r.ip ?? undefined, newDevice: r.new_device }));
}
export async function events(): Promise<SecEvent[]> {
  if (IS_DEMO) return demo().events;
  const c = await sbMod();
  const { data } = await c.from('security_events').select('created_at,event,detail,ip').order('created_at', { ascending: false }).limit(50);
  return (data ?? []).map((r) => ({ at: r.created_at, event: r.event, detail: r.detail, ip: r.ip ?? undefined }));
}

/** Pedido de levantamento (idempotente: a mesma chave nunca cria dois pedidos). */
export async function requestWithdrawal(whitelistId: string, amount: number, token: string, idem: string): R<{ id: string; review: boolean }> {
  if (IS_DEMO) {
    const d = demo();
    const w = d.wl.find((x) => x.id === whitelistId);
    if (d.frozen) return { ok: false, error: 'Conta congelada.' };
    if (d.wlLock && d.wlLock > new Date().toISOString()) return { ok: false, error: `Levantamentos bloqueados por segurança até ${new Date(d.wlLock).toLocaleString('pt-PT')}.` };
    if (!w) return { ok: false, error: 'Escolhe um número da lista branca.' };
    if (w.activeAfter > new Date().toISOString()) return { ok: false, error: 'Este número só fica ativo 24 h após ser adicionado.' };
    const lim = KYC_DEFAULT[d.kyc].withdraw;
    if (amount > lim) return { ok: false, error: `Limite diário do teu nível: ${lim} MZN.` };
    dlog(d, 'Pedido de levantamento', `${amount} MZN`); saveDemo(d);
    return { ok: true, data: { id: idem, review: amount > 10000 } };
  }
  const c = await sbMod();
  const { data, error } = await c.rpc('request_withdrawal', { p_whitelist: whitelistId, p_amount: Math.round(amount), p_tx_token: token, p_idem: idem });
  return error ? fail(error) : { ok: true, data: { id: data.id, review: !!data.review } };
}

/** Demo: permite ver o fluxo sem esperar 24 h. */
export function demoSkipLocks() {
  if (!IS_DEMO) return;
  const d = demo(); d.wlLock = undefined; d.wl = d.wl.map((w) => ({ ...w, activeAfter: new Date(0).toISOString() })); saveDemo(d);
}
