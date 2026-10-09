// TXAPILOG · Edge Function "send-push" (Supabase / Deno)
// Envia notificações Web Push (VAPID) para todos os dispositivos do utilizador, mesmo com a app fechada.
// Chamada pela base de dados (pg_net) depois de cada INSERT em:
//   · public.notifications → notifica o dono da notificação
//   · public.messages      → notifica os outros membros da conversa (exceto silenciados / quem enviou)
// Pedido: POST { table: 'notifications' | 'messages', record: {...} }  com cabeçalho x-push-secret = PUSH_HOOK_SECRET
// Segredos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_HOOK_SECRET (+ SUPABASE_URL / SERVICE_ROLE injetados).
// Deploy: --no-verify-jwt (a função verifica o segredo ela própria).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TITLES: Record<string, string> = {
  live: 'Live a começar', social: 'TXAPILOG', torneio: 'Torneios', compra: 'Compras', sistema: 'TXAPILOG', anuncios: 'Anúncios',
};

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const HOOK = Deno.env.get('PUSH_HOOK_SECRET') ?? '';
  if (!HOOK || req.headers.get('x-push-secret') !== HOOK) return json({ ok: false, error: 'unauthorized' }, 401);
  const PUB = Deno.env.get('VAPID_PUBLIC_KEY') ?? '', PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  if (!PUB || !PRIV) return json({ ok: false, error: 'VAPID em falta' }, 503);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:suporte@txapilog.app', PUB, PRIV);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { table, record: r } = await req.json().catch(() => ({}));
  if (!r) return json({ ok: false, error: 'sem registo' }, 400);

  let users: string[] = [];
  let payload: { title: string; body: string; category: string; url: string; tag?: string; icon?: string };

  const t = String(table ?? '');
  if (t.startsWith('notifications')) {
    users = [r.user_id];
    const cat = String(r.type || 'sistema');
    payload = { title: TITLES[cat] ?? 'TXAPILOG', body: String(r.body ?? '').slice(0, 240), category: cat, url: r.href || '/notificacoes/', tag: `n-${r.id}` };
  } else if (t.startsWith('messages')) {
    if (r.kind === 'reacao' || r.kind === 'sistema' || r.hidden || r.deleted_at) return json({ ok: true, skipped: true });
    const [{ data: conv }, { data: mem }, { data: who }] = await Promise.all([
      admin.from('conversations').select('kind,title,photo_url').eq('id', r.conversation_id).maybeSingle(),
      admin.from('conversation_members').select('user_id,muted,status').eq('conversation_id', r.conversation_id),
      admin.from('profiles').select('display_name,handle,avatar_url').eq('id', r.sender_id).maybeSingle(),
    ]);
    users = (mem ?? []).filter((m) => m.user_id !== r.sender_id && !m.muted && m.status !== 'recusado').map((m) => m.user_id);
    const name = String(who?.display_name || (who?.handle ? '@' + who.handle : 'Alguém'));
    const meta = (r.meta ?? {}) as { file?: { mime?: string; name?: string } };
    const preview = r.kind === 'voz' ? 'Mensagem de voz' : r.kind === 'chamada' ? 'Chamada' : r.kind === 'media'
      ? (meta.file?.mime?.startsWith('image/') ? 'Foto' : meta.file?.mime?.startsWith('video/') ? 'Vídeo' : meta.file?.mime?.startsWith('audio/') ? 'Áudio' : `${meta.file?.name ?? 'Ficheiro'}`) + (r.body ? ` ${r.body}` : '')
      : String(r.body ?? '');
    const group = conv?.kind === 'grupo';
    payload = {
      title: group ? `${conv?.title || 'Grupo'}` : name,
      body: (group ? `${name}: ` : '') + preview.slice(0, 200),
      category: 'social', url: `/mensagens/chat/?c=${r.conversation_id}`, tag: `c-${r.conversation_id}`,
      icon: (group ? conv?.photo_url : who?.avatar_url) || undefined,
    };
  } else return json({ ok: false, error: 'tabela inválida' }, 400);

  if (!users.length) return json({ ok: true, sent: 0 });
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint,p256dh,auth,categories').in('user_id', users);
  let sent = 0; const gone: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    if (s.categories?.length && !s.categories.includes(payload.category)) return;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400, urgency: 'high' });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint);
    }
  }));
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
  return json({ ok: true, sent, removed: gone.length });
});
