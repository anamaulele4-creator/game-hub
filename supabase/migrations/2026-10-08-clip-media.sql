-- Migração opcional (NÃO executada automaticamente): som das publicações.
-- Guarda em clips.media (jsonb) o ganho automático do som original, o volume da mistura
-- e a música escolhida (url, título, artista, licença, atribuição, início, volume).
-- Sem esta migração tudo funciona na mesma: a app guarda o mesmo objeto numa etiqueta
-- escondida "~m:<base64>" dentro de clips.tags e esconde-a ao mostrar as hashtags.
alter table public.clips add column if not exists media jsonb;

do $$ begin
  alter table public.clips add constraint clips_media_chk
    check (media is null or (jsonb_typeof(media) = 'object' and pg_column_size(media) <= 4096));
exception when duplicate_object then null; end $$;

-- Opcional: estatística de quantas publicações usam música (para o admin)
create index if not exists clips_has_music_idx on public.clips ((media ? 'music')) where media is not null;

notify pgrst, 'reload schema';
