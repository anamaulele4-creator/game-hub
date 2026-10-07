// Web Push + service worker.
// Demo: pede permissão e mostra notificações locais via service worker (sem servidor).
// Produção: com NEXT_PUBLIC_VAPID_PUBLIC_KEY, cria PushSubscription e grava em public.push_subscriptions (Supabase).
// O envio é feito pela Edge Function `send-push` (web-push com VAPID) ou FCM para a app Android (TWA).

import { BASE_PATH, IS_DEMO, VAPID_PUBLIC_KEY } from './config';

export type PushCategory = 'live' | 'social' | 'torneio' | 'compra' | 'sistema' | 'anuncios';
export const PUSH_CATEGORIES: { id: PushCategory; label: string; desc: string }[] = [
  { id: 'live', label: 'Lives', desc: 'Quando um ídolo que segues entra em direto' },
  { id: 'social', label: 'Social', desc: 'Comentários, respostas, desafios e novos seguidores' },
  { id: 'torneio', label: 'Torneios', desc: 'Inscrições, check-in e resultados' },
  { id: 'compra', label: 'Compras e bilhetes', desc: 'Recibos e estado de pagamentos' },
  { id: 'sistema', label: 'Sistema e segurança', desc: 'Avisos da conta e da plataforma' },
  { id: 'anuncios', label: 'Os meus anúncios', desc: 'Orçamento esgotado, revisão aprovada/rejeitada' },
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

/** Pede permissão e (se houver VAPID) subscreve. Devolve o estado final. */
export async function enablePush(categories: PushCategory[]): Promise<{ ok: boolean; msg: string }> {
  if (!pushSupported()) return { ok: false, msg: 'Este navegador não suporta notificações push. No iPhone, instala a app no ecrã principal primeiro.' };
  const p = await Notification.requestPermission();
  if (p !== 'granted') return { ok: false, msg: 'Permissão recusada. Podes ativar nas definições do navegador.' };
  const reg = (await navigator.serviceWorker.getRegistration(`${BASE_PATH}/`)) || (await registerSW());
  if (!reg) return { ok: false, msg: 'Não foi possível registar o service worker.' };
  if (!VAPID_PUBLIC_KEY || IS_DEMO) return { ok: true, msg: IS_DEMO ? 'Notificações ativadas (demo: apenas locais, neste dispositivo).' : 'Notificações ativadas neste dispositivo.' };
  try {
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
    const { sb } = await import('./supabase');
    const c = await sb();
    const { data: u } = await c.auth.getUser();
    const k = sub.toJSON().keys ?? {};
    await c.from('push_subscriptions').upsert({ endpoint: sub.endpoint, user_id: u.user?.id ?? null, p256dh: k.p256dh, auth: k.auth, categories }, { onConflict: 'endpoint' });
    return { ok: true, msg: 'Notificações push ativadas.' };
  } catch {
    return { ok: false, msg: 'Falha ao subscrever push.' };
  }
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
