-- =====================================================================
-- TXAPILOG · Chat estilo WhatsApp: grupos, mensagens ricas, chamadas
-- Migração (NÃO executada automaticamente). Idempotente: pode correr-se várias vezes.
-- Requer que supabase/schema.sql (secção 14 · mensagens diretas) já tenha sido corrido.
--
-- Sem esta migração a app funciona na mesma em conversas 1:1:
--   texto, responder, reações, editar, apagar para todos, reencaminhar, fotos/vídeos/ficheiros,
--   mensagens de voz e registo de chamadas vão codificados no próprio texto da mensagem.
-- Com esta migração passam a ter colunas próprias e ficam ATIVOS:
--   grupos (criar, admins, convites, só admins enviam/editam), menções com notificação,
--   proteção no servidor (editar ≤ 15 min, apagar para todos ≤ 1 h, mensagens de sistema só pelo servidor).
-- =====================================================================

-- 1. Conversas: tipo grupo + perfil do grupo + definições ------------------------------
alter table public.conversations drop constraint if exists conversations_kind_check;
do $$ begin
  alter table public.conversations add constraint conversations_kind_check check (kind in ('direta','grupo'));
exception when duplicate_object then null; end $$;
alter table public.conversations add column if not exists title text check (title is null or char_length(title) between 1 and 60);
alter table public.conversations add column if not exists description text check (description is null or char_length(description) <= 500);
alter table public.conversations add column if not exists photo_url text check (photo_url is null or char_length(photo_url) <= 500);
alter table public.conversations add column if not exists invite_code text unique;
alter table public.conversations add column if not exists only_admins_send boolean not null default false;
alter table public.conversations add column if not exists only_admins_edit boolean not null default true;

-- 2. Membros: papel (admin/membro) ------------------------------------------------------
alter table public.conversation_members add column if not exists role text not null default 'membro';
do $$ begin
  alter table public.conversation_members add constraint conversation_members_role_chk check (role in ('membro','admin'));
exception when duplicate_object then null; end $$;

-- 3. Mensagens: tipo, metadados (ficheiro, voz, chamada, reação…), resposta, edição ------
alter table public.messages add column if not exists kind text not null default 'texto';
do $$ begin
  alter table public.messages add constraint messages_kind_chk check (kind in ('texto','media','voz','sistema','chamada','reacao'));
exception when duplicate_object then null; end $$;
alter table public.messages add column if not exists meta jsonb;
do $$ begin
  alter table public.messages add constraint messages_meta_chk check (meta is null or (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 4096));
exception when duplicate_object then null; end $$;
alter table public.messages add column if not exists reply_to text;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
create index if not exists messages_conv_kind_idx on public.messages (conversation_id, kind, created_at desc);

create or replace function public.is_conv_admin(p_conv text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = p_conv and user_id = auth.uid() and role = 'admin' and status <> 'recusado');
$$;

-- Mensagem de sistema ("Ana criou o grupo"): só as funções abaixo as podem escrever.
create or replace function public._sys_message(p_conv text, p_body text, p_meta jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('poipak.sys', '1', true);
  insert into messages (conversation_id, body, kind, meta) values (p_conv, left(p_body, 300), 'sistema', p_meta);
  perform set_config('poipak.sys', '0', true);
end $$;
revoke all on function public._sys_message(text, text, jsonb) from public, anon, authenticated;

create or replace function public._my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(display_name, ''), handle, 'Alguém') from profiles where id = auth.uid();
$$;

-- 4. Validação de cada mensagem (substitui a da secção 14) ------------------------------
create or replace function public.tg_message_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare other uuid; st text; rl text; ck text; adm_only boolean;
begin
  new.sender_id := auth.uid();
  select kind, only_admins_send into ck, adm_only from conversations where id = new.conversation_id;
  if new.kind = 'sistema' and coalesce(current_setting('poipak.sys', true), '0') <> '1' then
    raise exception 'Mensagem não permitida.';
  end if;
  select status, role into st, rl from conversation_members where conversation_id = new.conversation_id and user_id = new.sender_id;
  if st is null or st = 'recusado' then raise exception 'Não fazes parte desta conversa.'; end if;
  if ck = 'grupo' then
    if adm_only and rl <> 'admin' and new.kind not in ('sistema','reacao') then
      raise exception 'Só os administradores podem enviar mensagens neste grupo.';
    end if;
  else
    if st = 'pedido' then update conversation_members set status = 'aceite' where conversation_id = new.conversation_id and user_id = new.sender_id; end if;
    select user_id into other from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id limit 1;
    if exists (select 1 from blocks where (user_id = other and blocked = new.sender_id::text) or (user_id = new.sender_id and blocked = other::text)) then
      raise exception 'Não é possível enviar mensagens a este utilizador.';
    end if;
  end if;
  if new.kind <> 'sistema' and (select count(*) from messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 40 then
    raise exception 'Estás a enviar mensagens demasiado depressa. Aguarda um pouco.';
  end if;
  new.hidden := false; new.edited_at := null; new.deleted_at := null;
  return new;
end $$;

-- 5. Depois de cada mensagem: pré-visualização, lido, notificações (+ menções) -----------
create or replace function public.tg_message_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; sender_name text; conv record; prev text; mentions uuid[];
begin
  if new.kind = 'reacao' then return null; end if;
  select kind, title into conv from conversations where id = new.conversation_id;
  prev := case
    when new.kind = 'voz' then '🎤 Mensagem de voz'
    when new.kind = 'chamada' then '📞 Chamada'
    when new.kind = 'media' and new.body = '' then '📎 Anexo'
    when new.image_path is not null and new.body = '' then '📷 Imagem'
    else left(split_part(new.body, chr(8291), 1), 80) end;
  update conversations set last_message_at = new.created_at, last_sender_id = new.sender_id, last_message_preview = prev where id = new.conversation_id;
  update conversation_members set last_read_at = new.created_at where conversation_id = new.conversation_id and user_id = new.sender_id;
  if new.kind = 'sistema' then return null; end if;
  select display_name into sender_name from profiles where id = new.sender_id;
  begin
    select array_agg(x::uuid) into mentions from jsonb_array_elements_text(coalesce(new.meta->'mentions', '[]'::jsonb)) x;
  exception when others then mentions := null; end;
  for r in select user_id, status, muted from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id loop
    if r.status = 'aceite' and (not r.muted or r.user_id = any(coalesce(mentions, '{}'))) then
      insert into notifications (user_id, type, body, href) values (r.user_id, 'social',
        case when conv.kind = 'grupo' then
          case when r.user_id = any(coalesce(mentions, '{}')) then '📣 ' || coalesce(sender_name, 'Alguém') || ' mencionou-te em ' || coalesce(conv.title, 'grupo')
               else '👥 ' || coalesce(conv.title, 'Grupo') || ' · ' || coalesce(sender_name, 'Alguém') || ': ' || left(prev, 50) end
        else '💬 ' || coalesce(sender_name, 'Alguém') || ': ' || left(prev, 60) end,
        '/mensagens/chat/?c=' || new.conversation_id);
    end if;
  end loop;
  return null;
end $$;

-- 6. Editar / apagar: só o autor, só o texto/meta, dentro do prazo ----------------------
create or replace function public.tg_message_update_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_mod() then return new; end if;
  if old.sender_id <> auth.uid() then raise exception 'Sem permissão.'; end if;
  new.id := old.id; new.conversation_id := old.conversation_id; new.sender_id := old.sender_id;
  new.created_at := old.created_at; new.hidden := old.hidden; new.kind := old.kind; new.reply_to := old.reply_to;
  if old.deleted_at is not null then raise exception 'Mensagem já apagada.'; end if;
  if new.deleted_at is not null then
    if old.created_at < now() - interval '1 hour' and old.kind <> 'chamada' then raise exception 'Só podes apagar para todos até 1 hora depois de enviar.'; end if;
    new.body := ''; new.image_path := null; new.meta := jsonb_build_object('del', true); new.deleted_at := now();
  elsif new.body is distinct from old.body then
    if old.kind <> 'texto' then raise exception 'Só podes editar mensagens de texto.'; end if;
    if old.created_at < now() - interval '15 minutes' then raise exception 'Só podes editar até 15 minutos depois de enviar.'; end if;
    new.edited_at := now();
  end if;
  return new;
end $$;
drop trigger if exists message_update_guard on public.messages;
create trigger message_update_guard before update on public.messages for each row execute function public.tg_message_update_guard();
-- permitir corpo vazio em mensagens apagadas / de sistema / com meta
alter table public.messages drop constraint if exists messages_check;
do $$ begin
  alter table public.messages add constraint messages_content_chk check (char_length(body) > 0 or image_path is not null or meta is not null or deleted_at is not null);
exception when duplicate_object then null; end $$;

-- 7. Membros: só o próprio altera a sua linha (lido, silenciar); papel/estado só pelas funções
create or replace function public.tg_member_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or coalesce(current_setting('poipak.sys', true), '0') = '1' then return new; end if;
  if new.user_id <> auth.uid() then raise exception 'Sem permissão.'; end if;
  new.conversation_id := old.conversation_id; new.user_id := old.user_id; new.joined_at := old.joined_at; new.role := old.role;
  return new;
end $$;

-- Contagem de não lidas: ignora reações e sistema
create or replace function public.dm_unread_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from messages m join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.sender_id <> auth.uid() and not m.hidden and m.kind not in ('reacao','sistema') and m.created_at > cm.last_read_at and cm.status = 'aceite';
$$;

-- 8. Grupos: criar, gerir membros, admins, convites -------------------------------------
create or replace function public.create_group(p_title text, p_description text, p_photo text, p_members uuid[]) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid text; u uuid; n int := 0;
begin
  if me is null then raise exception 'Entra na tua conta.'; end if;
  if not public.is_active_user() then raise exception 'A tua conta está restringida.'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Dá um nome ao grupo.'; end if;
  if coalesce(array_length(p_members, 1), 0) > 255 then raise exception 'Máximo 256 participantes.'; end if;
  if (select count(*) from conversations where created_by = me and kind = 'grupo' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Criaste muitos grupos hoje. Tenta amanhã.';
  end if;
  insert into conversations (kind, title, description, photo_url, created_by, invite_code)
    values ('grupo', left(trim(p_title), 60), nullif(left(coalesce(p_description, ''), 500), ''), nullif(p_photo, ''), me, substr(md5(random()::text || clock_timestamp()::text), 1, 18))
    returning id into cid;
  perform set_config('poipak.sys', '1', true);
  insert into conversation_members (conversation_id, user_id, status, role) values (cid, me, 'aceite', 'admin');
  foreach u in array coalesce(p_members, '{}') loop
    -- Só se adiciona quem o criador segue, sem bloqueios, conta ativa
    if u <> me and exists (select 1 from follows where follower_id = me and followed_id = u)
       and exists (select 1 from profiles where id = u and not banned and deleted_at is null)
       and not exists (select 1 from blocks where (user_id = u and blocked = me::text) or (user_id = me and blocked = u::text)) then
      insert into conversation_members (conversation_id, user_id, status, role) values (cid, u, 'aceite', 'membro') on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  perform public._sys_message(cid, public._my_name() || ' criou o grupo "' || left(trim(p_title), 60) || '"', jsonb_build_object('sys', 'criou'));
  return cid;
end $$;

create or replace function public.group_add_members(p_conv text, p_members uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); u uuid; n int := 0; nm text;
begin
  if not public.is_conv_admin(p_conv) then raise exception 'Só administradores podem adicionar participantes.'; end if;
  perform set_config('poipak.sys', '1', true);
  foreach u in array coalesce(p_members, '{}') loop
    if exists (select 1 from follows where follower_id = me and followed_id = u)
       and exists (select 1 from profiles where id = u and not banned and deleted_at is null)
       and not exists (select 1 from blocks where (user_id = u and blocked = me::text) or (user_id = me and blocked = u::text)) then
      insert into conversation_members (conversation_id, user_id, status, role) values (p_conv, u, 'aceite', 'membro')
        on conflict (conversation_id, user_id) do update set status = 'aceite';
      select coalesce(nullif(display_name, ''), handle) into nm from profiles where id = u;
      perform public._sys_message(p_conv, public._my_name() || ' adicionou ' || coalesce(nm, 'alguém'), jsonb_build_object('sys', 'entrou', 'user', u));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.group_set_role(p_conv text, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not public.is_conv_admin(p_conv) then raise exception 'Só administradores.'; end if;
  if p_role not in ('admin','membro') then raise exception 'Papel inválido.'; end if;
  if p_role = 'membro' and (select count(*) from conversation_members where conversation_id = p_conv and role = 'admin' and status = 'aceite') <= 1
     and exists (select 1 from conversation_members where conversation_id = p_conv and user_id = p_user and role = 'admin') then
    raise exception 'O grupo precisa de pelo menos um administrador.';
  end if;
  perform set_config('poipak.sys', '1', true);
  update conversation_members set role = p_role where conversation_id = p_conv and user_id = p_user;
  select coalesce(nullif(display_name, ''), handle) into nm from profiles where id = p_user;
  perform public._sys_message(p_conv, coalesce(nm, 'Alguém') || case when p_role = 'admin' then ' é agora administrador' else ' deixou de ser administrador' end);
end $$;

create or replace function public.group_remove_member(p_conv text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if p_user = auth.uid() then perform public.group_leave(p_conv); return; end if;
  if not public.is_conv_admin(p_conv) then raise exception 'Só administradores podem remover participantes.'; end if;
  select coalesce(nullif(display_name, ''), handle) into nm from profiles where id = p_user;
  perform public._sys_message(p_conv, public._my_name() || ' removeu ' || coalesce(nm, 'alguém'), jsonb_build_object('sys', 'saiu', 'user', p_user));
  delete from conversation_members where conversation_id = p_conv and user_id = p_user;
end $$;

create or replace function public.group_leave(p_conv text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); next_admin uuid;
begin
  if not exists (select 1 from conversations where id = p_conv and kind = 'grupo') then raise exception 'Grupo não encontrado.'; end if;
  if not public.is_member(p_conv) then return; end if;
  perform public._sys_message(p_conv, public._my_name() || ' saiu', jsonb_build_object('sys', 'saiu', 'user', me));
  perform set_config('poipak.sys', '1', true);
  if public.is_conv_admin(p_conv) and (select count(*) from conversation_members where conversation_id = p_conv and role = 'admin') <= 1 then
    select user_id into next_admin from conversation_members where conversation_id = p_conv and user_id <> me order by joined_at limit 1;
    if next_admin is not null then update conversation_members set role = 'admin' where conversation_id = p_conv and user_id = next_admin; end if;
  end if;
  delete from conversation_members where conversation_id = p_conv and user_id = me;
end $$;

create or replace function public.group_update(p_conv text, p_title text, p_description text, p_photo text, p_only_admins_send boolean, p_only_admins_edit boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c record; adm boolean := public.is_conv_admin(p_conv);
begin
  select * into c from conversations where id = p_conv and kind = 'grupo';
  if c is null or not public.is_member(p_conv) then raise exception 'Grupo não encontrado.'; end if;
  if c.only_admins_edit and not adm then raise exception 'Só administradores podem editar os dados do grupo.'; end if;
  if not adm and (p_only_admins_send is distinct from c.only_admins_send or p_only_admins_edit is distinct from c.only_admins_edit) then
    raise exception 'Só administradores podem mudar as definições.';
  end if;
  update conversations set title = coalesce(nullif(left(trim(p_title), 60), ''), title), description = nullif(left(coalesce(p_description, ''), 500), ''),
    photo_url = nullif(p_photo, ''), only_admins_send = coalesce(p_only_admins_send, only_admins_send), only_admins_edit = coalesce(p_only_admins_edit, only_admins_edit)
  where id = p_conv;
  if p_title is distinct from c.title then perform public._sys_message(p_conv, public._my_name() || ' mudou o nome do grupo para "' || left(trim(p_title), 60) || '"'); end if;
  if nullif(p_photo, '') is distinct from c.photo_url then perform public._sys_message(p_conv, public._my_name() || ' mudou a foto do grupo'); end if;
  if nullif(left(coalesce(p_description, ''), 500), '') is distinct from c.description then perform public._sys_message(p_conv, public._my_name() || ' mudou a descrição do grupo'); end if;
  if p_only_admins_send is distinct from c.only_admins_send then
    perform public._sys_message(p_conv, case when p_only_admins_send then public._my_name() || ' definiu que só administradores enviam mensagens' else public._my_name() || ' permitiu que todos enviem mensagens' end);
  end if;
end $$;

create or replace function public.group_reset_invite(p_conv text) returns text
language plpgsql security definer set search_path = public as $$
declare code text := substr(md5(random()::text || clock_timestamp()::text), 1, 18);
begin
  if not public.is_conv_admin(p_conv) then raise exception 'Só administradores.'; end if;
  update conversations set invite_code = code where id = p_conv and kind = 'grupo';
  return code;
end $$;

-- Pré-visualização do convite (quem ainda não é membro não consegue ler a tabela)
create or replace function public.group_invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description, 'photo_url', c.photo_url,
    'members', (select count(*) from conversation_members m where m.conversation_id = c.id and m.status = 'aceite'),
    'is_member', exists (select 1 from conversation_members m where m.conversation_id = c.id and m.user_id = auth.uid()))
  from conversations c where c.invite_code = p_code and c.kind = 'grupo';
$$;

create or replace function public.join_group_by_invite(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare cid text; me uuid := auth.uid();
begin
  if me is null then raise exception 'Entra na tua conta.'; end if;
  if not public.is_active_user() then raise exception 'A tua conta está restringida.'; end if;
  select id into cid from conversations where invite_code = p_code and kind = 'grupo';
  if cid is null then raise exception 'Convite inválido ou expirado.'; end if;
  if exists (select 1 from conversation_members where conversation_id = cid and user_id = me) then return cid; end if;
  if (select count(*) from conversation_members where conversation_id = cid) >= 256 then raise exception 'O grupo está cheio.'; end if;
  perform set_config('poipak.sys', '1', true);
  insert into conversation_members (conversation_id, user_id, status, role) values (cid, me, 'aceite', 'membro');
  perform public._sys_message(cid, public._my_name() || ' entrou através do link de convite', jsonb_build_object('sys', 'entrou', 'user', me));
  return cid;
end $$;

grant execute on function public.create_group(text, text, text, uuid[]) to authenticated;
grant execute on function public.group_add_members(text, uuid[]) to authenticated;
grant execute on function public.group_set_role(text, uuid, text) to authenticated;
grant execute on function public.group_remove_member(text, uuid) to authenticated;
grant execute on function public.group_leave(text) to authenticated;
grant execute on function public.group_update(text, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.group_reset_invite(text) to authenticated;
grant execute on function public.group_invite_preview(text) to authenticated;
grant execute on function public.join_group_by_invite(text) to authenticated;
grant execute on function public.is_conv_admin(text) to authenticated;

-- 9. Anexos do chat no bucket 'clips': pasta chat/<conversa>/… só para membros -----------
drop policy if exists "clips chat membros enviam" on storage.objects;
create policy "clips chat membros enviam" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = 'chat' and public.is_member((storage.foldername(name))[2]));
drop policy if exists "clips chat autor apaga" on storage.objects;
create policy "clips chat autor apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = 'chat' and owner = auth.uid());
-- Tipos aceites no bucket: se o bucket tiver lista de tipos, junta os do chat (voz, documentos).
update storage.buckets set allowed_mime_types = (select array(select distinct unnest(allowed_mime_types || array[
  'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','application/pdf','application/zip','text/plain',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'])))
where id = 'clips' and allowed_mime_types is not null;

-- 10. Realtime: atualizações de conversas (nome/foto do grupo) -------------------------
do $$ begin alter publication supabase_realtime add table public.conversations; exception when others then null; end $$;
alter table public.messages replica identity default;

notify pgrst, 'reload schema';
