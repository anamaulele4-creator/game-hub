'use client';

// IA do sistema: deteta erros (render, window.onerror, promessas rejeitadas), regista-os e tenta recuperar sozinha.
// 1.º erro → volta a desenhar a página. Erros repetidos → limpa caches + service worker e recarrega UMA vez
// (protegido em sessionStorage contra ciclos). Se mesmo assim falhar → ecrã "A recuperar…".
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
  try { const { countAutoFix } = await import('@/lib/poipakAI'); countAutoFix(); } catch {}
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
    const first = hits.length === 1 && !isChunkError(error?.message || '');
    const canReload = !alreadyReloaded();
    logSystemError({ message: error?.message || String(error), stack: (error?.stack || '') + (info?.componentStack ? '\n--- componentes ---' + info.componentStack : '') }, { auto_fixed: first || canReload });
    if (first) { void import('@/lib/poipakAI').then((m) => m.countAutoFix()).catch(() => {}); this.setState({ hits, pending: false, key: this.state.key + 1 }); return; } // 1) volta a desenhar
    this.setState({ hits, pending: false, failed: true });
    void hardRecover(); // 2) limpa caches/SW e recarrega uma vez; se já o fez, fica o ecrã de recuperação
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
    <div role="alert" className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-[#0E0F13] p-6 text-center text-white">
      <div className="skeleton h-1.5 w-28 rounded-full" aria-hidden />
      <h1 className="text-xl font-bold">A recuperar…</h1>
      <p className="max-w-xs text-sm text-white/70">Algo correu mal nesta página. Já registámos o problema e estamos a tentar resolvê-lo sozinhos.</p>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <button onClick={onRetry} className="rounded-xl bg-[#FFC107] py-3 font-semibold text-[#0E0F13]">Tentar de novo</button>
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
