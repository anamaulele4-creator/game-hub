'use client';

// Guarda de erros: regista erros de render, window.onerror e promessas rejeitadas.
// Um erro numa página NÃO recarrega a app: mostra um aviso com "Tentar de novo".
// Só um ficheiro em falta depois de um deploy (ChunkLoadError) limpa caches e recarrega, no máximo uma vez por sessão.
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { flushSystemErrors, logSystemError } from '@/lib/systemErrors';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const RELOAD_KEY = 'gh-guard-reloaded';
const WINDOW_MS = 30_000; // erros dentro desta janela contam como "repetidos"
const HEALTHY_MS = 5 * 60_000; // 5 min sem erros → o recarregamento automático volta a ficar disponível

function alreadyReloaded() { try { return !!sessionStorage.getItem(RELOAD_KEY); } catch { return true; } }

/** Limpa caches e service worker e recarrega uma única vez. Devolve false se já o fez nesta sessão. */
export async function hardRecover(): Promise<boolean> {
  if (alreadyReloaded()) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { return false; }
  await flushSystemErrors().catch(() => {});
  try { if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } } catch {}
  try { if ('serviceWorker' in navigator) { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map((r) => r.unregister())); } } catch {}
  location.reload();
  return true;
}

const isChunkError = (m: string) => /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(m);

interface S { failed: boolean; pending: boolean; key: number; hits: number[] }

class Boundary extends Component<{ children: ReactNode }, S> {
  state: S = { failed: false, pending: false, key: 0, hits: [] };
  private healthy: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): Partial<S> { return { pending: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const now = Date.now();
    const hits = [...this.state.hits.filter((t) => t > now - WINDOW_MS), now];
    const chunk = isChunkError(error?.message || '');
    logSystemError({ message: error?.message || String(error), stack: (error?.stack || '') + (info?.componentStack ? '\n--- componentes ---' + info.componentStack : '') }, { auto_fixed: chunk && !alreadyReloaded() });
    this.setState({ hits, pending: false, failed: true });
    if (chunk) void hardRecover();
  }

  componentDidMount() { this.arm(); }
  componentDidUpdate(_: unknown, prev: S) { if (prev.key !== this.state.key) this.arm(); }
  /** Se a página ficar estável, esquece os erros antigos e volta a permitir um recarregamento automático */
  arm() {
    if (this.healthy) clearTimeout(this.healthy);
    this.healthy = setTimeout(() => { try { sessionStorage.removeItem(RELOAD_KEY); } catch {} this.setState({ hits: [] }); }, HEALTHY_MS);
  }
  componentWillUnmount() { if (this.healthy) clearTimeout(this.healthy); }

  retry = () => this.setState({ failed: false, pending: false, hits: [], key: this.state.key + 1 });

  render() {
    if (this.state.failed) return <Recovering onRetry={this.retry} />;
    if (this.state.pending) return null;
    return <Fragmentless key={this.state.key}>{this.props.children}</Fragmentless>;
  }
}

function Fragmentless({ children }: { children: ReactNode }) { return <>{children}</>; }

function Recovering({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-[#0A1230] p-6 text-center text-white">
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden><div className="skeleton h-full w-full !rounded-full" /></div>
      <h1 className="text-xl font-bold">Esta página não abriu</h1>
      <p className="max-w-xs text-sm text-white/70">O erro ficou registado para o admin. Toca em Tentar de novo ou volta ao início.</p>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <button onClick={onRetry} className="rounded-xl bg-[#FFC20E] py-3 font-semibold text-[#0B1B4D]">Tentar de novo</button>
        <button onClick={() => { location.href = `${BASE}/`; }} className="rounded-xl bg-white/10 py-3 font-semibold">Ir para o início</button>
      </div>
    </div>
  );
}

function GlobalListeners() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      const msg = ev.message || ev.error?.message || '';
      logSystemError(ev.error ?? { message: msg, stack: ev.filename ? `at ${ev.filename}:${ev.lineno}:${ev.colno}` : undefined }, { auto_fixed: isChunkError(msg) && !alreadyReloaded() });
      if (isChunkError(msg)) void hardRecover(); // ficheiro antigo depois de um deploy → limpa caches e recarrega
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const r = ev.reason as { message?: string } | undefined;
      const msg = r?.message || String(r ?? '');
      logSystemError(r instanceof Error ? r : { message: msg }, { auto_fixed: isChunkError(msg) && !alreadyReloaded() });
      if (isChunkError(msg)) void hardRecover();
    };
    const onOnline = () => { void flushSystemErrors(); };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('online', onOnline);
    const t = setTimeout(onOnline, 5000); // envia a fila guardada offline
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); window.removeEventListener('online', onOnline); clearTimeout(t); };
  }, []);
  return null;
}

export function SystemGuard({ children }: { children: ReactNode }) {
  return (
    <>
      <GlobalListeners />
      <Boundary>{children}</Boundary>
    </>
  );
}
