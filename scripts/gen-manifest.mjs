// Gera public/manifest.webmanifest com o basePath certo (o ficheiro app/manifest.ts do Next não aplica o basePath ao <link>).
import { writeFileSync } from 'node:fs';
const B = process.env.NEXT_PUBLIC_BASE_PATH ?? '/game-hub';
const icon = (s, purpose, file) => ({ src: `${B}/icons/${file}`, sizes: `${s}x${s}`, type: 'image/png', purpose });
const m = {
  id: `${B}/`, name: 'TXAPZONE · Torneios, recargas e marketplace', short_name: 'TXAPZONE',
  description: 'TXAPZONE by TXAPILOG · Torneios, recargas e marketplace de Free Fire, Clash Royale, eFootball, DLS e mais.', lang: 'pt-MZ',
  start_url: `${B}/?source=pwa`, scope: `${B}/`, display: 'standalone', orientation: 'portrait',
  background_color: '#0E0F13', theme_color: '#0E0F13', categories: ['games', 'entertainment'],
  icons: [icon(192, 'any', 'icon-192.png'), icon(512, 'any', 'icon-512.png'), icon(192, 'maskable', 'maskable-192.png'), icon(512, 'maskable', 'maskable-512.png')],
  prefer_related_applications: false,
  related_applications: [{ platform: 'webapp', url: `${process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'https://anamaulele4-creator.github.io'}${B}/manifest.webmanifest` }],
  shortcuts: [['Torneios', 'torneios'], ['Recargas', 'recargas'], ['Marketplace', 'marketplace']].map(([name, p]) => ({ name, url: `${B}/${p}/`, icons: [{ src: `${B}/icons/icon-192.png`, sizes: '192x192' }] })),
};
writeFileSync(new URL('../public/manifest.webmanifest', import.meta.url), JSON.stringify(m, null, 2));
console.log('manifest.webmanifest gerado (basePath', B || '/', ')');
