// Social POIPAK · Edge Function "delete-account" (Supabase / Deno)
// Eliminação de conta pedida na app (Definições › Eliminar conta). Exigida pela Google Play.
// Deploy: supabase functions deploy delete-account   (usa SUPABASE_SERVICE_ROLE_KEY injetada automaticamente)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type' };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u.user) return json({ ok: false, error: 'Sessão inválida' }, 401);
  const { reason } = await req.json().catch(() => ({ reason: '' }));
  const id = u.user.id;
  // 1) registo (sem dados pessoais) e anonimização imediata do perfil
  await admin.from('audit_log').insert({ actor_id: null, actor_handle: 'sistema', action: 'Conta eliminada pelo utilizador', target: `${id} · ${String(reason ?? '').slice(0, 120)}` });
  await admin.from('profiles').update({ deleted_at: new Date().toISOString(), display_name: 'Conta eliminada', bio: '', avatar_url: null, birth_date: null, province: null, email: null, phone: null }).eq('id', id);
  // 2) conteúdo do utilizador
  await admin.from('clips').delete().eq('author_id', id);
  await admin.from('posts').delete().eq('author_id', id);
  await admin.from('comments').delete().eq('author_id', id);
  await admin.from('push_subscriptions').delete().eq('user_id', id);
  // 3) apaga o utilizador de auth (cascata para profiles e tabelas com FK on delete cascade).
  //    Pagamentos ficam (user_id → null) por obrigação fiscal.
  const del = await admin.auth.admin.deleteUser(id);
  if (del.error) return json({ ok: false, error: del.error.message }, 500);
  return json({ ok: true });
});
