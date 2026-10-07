/** @type {import('next').NextConfig} */
// basePath configurável: por omissão '/game-hub' (GitHub Pages em anamaulele4-creator.github.io/game-hub).
// Para um domínio próprio na raiz (ex.: gamehub.co.mz) defina NEXT_PUBLIC_BASE_PATH="" no build.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/game-hub';

const nextConfig = {
  output: 'export',
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
