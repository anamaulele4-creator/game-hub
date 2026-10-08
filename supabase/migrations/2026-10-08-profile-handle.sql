-- Migração opcional (NÃO executada automaticamente): permite ao utilizador mudar o próprio @username
-- a partir de "Editar perfil". O trigger tg_protect_profile bloqueia alterações diretas a profiles.handle,
-- por isso esta função security definer valida o formato/unicidade e marca a transação como confiável.
-- Sem esta migração, tudo o resto do perfil funciona; só o campo @username mostra "ainda não disponível".
create or replace function public.set_my_handle(p_handle text) returns text
language plpgsql security definer set search_path = public as $$
declare h text := lower(trim(both '@' from coalesce(p_handle, '')));
begin
  if auth.uid() is null then raise exception 'Entra na tua conta.'; end if;
  if not public.is_active_user() then raise exception 'A tua conta está restringida.'; end if;
  if h !~ '^[a-z0-9_.]{3,30}$' then raise exception 'Formato inválido: 3 a 30 letras minúsculas, números, _ ou .'; end if;
  if h in ('admin','poipak','suporte','moderador','oficial') then raise exception 'Esse @username está reservado.'; end if;
  if exists (select 1 from profiles where lower(handle) = h and id <> auth.uid()) then raise exception 'Esse @username já está em uso.'; end if;
  perform set_config('gamehub.trusted', '1', true);
  update profiles set handle = h where id = auth.uid();
  perform set_config('gamehub.trusted', '', true);
  return h;
end $$;
revoke all on function public.set_my_handle(text) from public;
grant execute on function public.set_my_handle(text) to authenticated;
