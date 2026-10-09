// Rotas acessíveis sem sessão iniciada (portão de autenticação).
// Páginas legais ficam públicas: a Google Play exige URLs públicos para privacidade, eliminação de conta e segurança infantil.
export const AUTH_ROUTES = ['/bem-vindo', '/entrar', '/registar', '/recuperar', '/confirmar'];
export const PUBLIC_ROUTES = [...AUTH_ROUTES, '/baixar', '/termos', '/privacidade', '/diretrizes', '/seguranca-infantil', '/seguranca-dados', '/cookies', '/reembolsos', '/eliminar-conta', '/legal'];

export function stripBase(path: string) {
  const b = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const p = b && path.startsWith(b) ? path.slice(b.length) : path;
  return p || '/';
}
export function isPublic(path: string) {
  const p = stripBase(path).replace(/\/$/, '') || '/';
  return PUBLIC_ROUTES.some((r) => p === r || p.startsWith(r + '/'));
}
export function isAuthRoute(path: string) {
  const p = stripBase(path).replace(/\/$/, '') || '/';
  return AUTH_ROUTES.some((r) => p === r || p.startsWith(r + '/'));
}

/** Tipos de notificação que a TXAPZONE mostra (só torneios, compras/recargas e conta/sistema; a rede social foi removida). */
export const NOTIF_TYPES = ['torneio', 'compra', 'sistema'] as const;
export function isPlatformNotif(n: { type: string }) {
  return (NOTIF_TYPES as readonly string[]).includes(n.type);
}
