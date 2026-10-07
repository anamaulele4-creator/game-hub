/** @type {import('next').NextConfig} */
// basePath configurável: por omissão '/game-hub' (GitHub Pages em anamaulele4-creator.github.io/game-hub).
// Para um domínio próprio na raiz (ex.: poipak.co.mz) defina NEXT_PUBLIC_BASE_PATH="" no build.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/game-hub';

// Supabase (modo real). Valores PÚBLICOS (URL + chave publicável/anon) — podem estar no código.
// Para forçar o modo demo num build: NEXT_PUBLIC_DEMO=1
const demo = process.env.NEXT_PUBLIC_DEMO === '1';
const SUPABASE_URL = demo ? '' : process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://nmdauzpbwnepmqyafaqs.supabase.co';
const SUPABASE_ANON_KEY = demo ? '' : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_VnpxzpxwVME94OZFqoteXw_JrGZ2i0L';

const nextConfig = {
  output: 'export',
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY },
};

export default nextConfig;
