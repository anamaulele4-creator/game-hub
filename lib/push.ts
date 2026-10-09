// Web Push + service worker.
// Demo: pede permissão e mostra notificações locais via service worker (sem servidor).
// Produção: com NEXT_PUBLIC_VAPID_PUBLIC_KEY, cria PushSubscription e grava em public.push_subscriptions (Supabase).
// O envio é feito pela Edge Function `send-push` (web-push com VAPID) ou FCM para a app Android (TWA).

import { BASE_PATH, IS_DEMO, VAPID_PUBLIC_KEY } from './config';

export type PushCategory = 'live' | 'social' | 'torneio' | 'compra' | 'sistema' | 'anuncios';
export const PUSH_CATEGORIES: { id: PushCategory; label: string; desc: string }[] = [
  { id: 'torneio', label: 'Torneios', desc: 'Inscrições, check-in e resultados' },
  { id: 'compra', label: 'Compras e recargas', desc: 'Recibos e estado de pagamentos' },
  { id: 'sistema', label: 'Sistema e segurança', desc: 'Avisos da conta e da plataforma' },
];

/** Formato do payload enviado pelo servidor (Edge Function / FCM data message). */
export interface PushPayload {
  title: string;
  body: string;
  category: PushCategory;
  url: string; // caminho relativo à app, ex.: /lives/l1
  icon?: string;
  tag?: string;
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'Notification' in window;
}

export function permission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` });
  } catch {
    return null;
  }
}

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getReg(): Promise<ServiceWorkerRegistration | null> {
  const reg = (await navigator.serviceWorker.getRegistration(`${BASE_PATH}/`)) || (await registerSW());
  if (!reg) return null;
  try { return await navigator.serviceWorker.ready; } catch { return reg; }
}

/** Cria (ou reaproveita) a subscrição push deste dispositivo e grava-a na conta. Não pede permissão. */
export async function syncPush(categories: PushCategory[]): Promise<{ ok: boolean; msg: string }> {
  if (!pushSupported() || Notification.permission !== 'granted') return { ok: false, msg: 'Sem permissão para notificações.' };
  if (!VAPID_PUBLIC_KEY || IS_DEMO) return { ok: true, msg: 'Notificações ativadas neste dispositivo.' };
  const reg = await getReg();
  if (!reg || !('pushManager' in reg)) return { ok: false, msg: 'Este navegador não suporta push com a app fechada.' };
  try {
    const key = urlB64ToUint8Array(VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    // Subscrição antiga com outra chave → renovar
    if (sub) {
      const old = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey as ArrayBuffer) : null;
      if (old && (old.length !== key.length || old.some((b, i) => b !== key[i]))) { await sub.unsubscribe().catch(() => {}); sub = null; }
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const { sb } = await import('./supabase');
    const c = await sb();
    const { data: u } = await c.auth.getUser();
    if (!u.user) return { ok: false, msg: 'Entra na tua conta para receber notificações.' };
    const k = sub.toJSON().keys ?? {};
    const { error } = await c.from('push_subscriptions').upsert({ endpoint: sub.endpoint, user_id: u.user.id, p256dh: k.p256dh, auth: k.auth, categories }, { onConflict: 'endpoint' });
    if (error) return { ok: false, msg: 'Não foi possível guardar as notificações nesta conta.' };
    return { ok: true, msg: 'Notificações ativadas. Vais recebê-las mesmo com a app fechada.' };
  } catch {
    return { ok: false, msg: 'Falha ao ativar push neste dispositivo.' };
  }
}

/** Pede permissão (chamar num toque) e subscreve. Devolve o estado final. */
export async function enablePush(categories: PushCategory[]): Promise<{ ok: boolean; msg: string }> {
  if (!pushSupported()) return { ok: false, msg: 'Este navegador não suporta notificações push. No iPhone, instala a app no ecrã principal primeiro.' };
  const p = await Notification.requestPermission();
  if (p !== 'granted') return { ok: false, msg: 'Permissão recusada. Podes ativar nas definições do navegador.' };
  try { localStorage.removeItem('push-off'); } catch {}
  return syncPush(categories);
}

/** Desliga o push neste dispositivo (apaga a subscrição). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(`${BASE_PATH}/`);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    if (!IS_DEMO) { const { sb } = await import('./supabase'); const c = await sb(); await c.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); }
    await sub.unsubscribe();
  } catch {}
}

/** Mostra uma notificação local através do service worker (usado na demo e para testar). */
export async function localPush(p: PushPayload) {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration(`${BASE_PATH}/`);
  if (!reg) return false;
  await reg.showNotification(p.title, {
    body: p.body,
    icon: p.icon ?? `${BASE_PATH}/icons/icon-192.png`,
    badge: `${BASE_PATH}/icons/icon-192.png`,
    tag: p.tag ?? p.category,
    data: { url: `${BASE_PATH}${p.url}` },
  });
  return true;
}
