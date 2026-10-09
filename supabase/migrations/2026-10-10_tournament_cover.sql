-- TXAPZONE · Imagem de capa dos torneios (v12, 10 out. 2026)
-- Idempotente: pode correr-se mais do que uma vez. Já está também incluído no fim de supabase/schema.sql.
-- Sem isto a app continua a funcionar: os torneios mostram a capa do jogo e a imagem escolhida não fica gravada.

-- 1. Coluna da capa (URL público do Storage, WebP 16:9 até 1280 px)
alter table public.tournaments add column if not exists cover_url text;
do $$ begin
  if to_regclass('public.core_tournaments') is not null then
    execute 'alter table public.core_tournaments add column if not exists cover_url text';
  end if;
end $$;

-- 2. Só aceitar URLs https (nunca javascript: nem data: gigantes na base de dados)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_cover_url_https') then
    alter table public.tournaments add constraint tournaments_cover_url_https
      check (cover_url is null or (cover_url ~ '^https://' and char_length(cover_url) <= 600));
  end if;
end $$;

-- 3. Storage: as capas ficam no bucket público 'clips' (já existente), pasta tournaments/.
--    Leitura pública já é dada pela política "clips leitura". Só administradores enviam/substituem/apagam nesta pasta.
--    (Se esta parte não correr, a app guarda a capa na pasta do próprio admin, <id do utilizador>/tournament-*.webp.)
drop policy if exists "capas torneio admin envia" on storage.objects;
create policy "capas torneio admin envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and (storage.foldername(name))[1] = 'tournaments' and public.is_admin());
drop policy if exists "capas torneio admin atualiza" on storage.objects;
create policy "capas torneio admin atualiza" on storage.objects for update to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = 'tournaments' and public.is_admin());
drop policy if exists "capas torneio admin apaga" on storage.objects;
create policy "capas torneio admin apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and (storage.foldername(name))[1] = 'tournaments' and public.is_admin());

notify pgrst, 'reload schema';
