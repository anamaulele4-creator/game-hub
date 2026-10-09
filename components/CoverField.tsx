'use client';
// Campo "Imagem de capa" dos formulários de torneio (Admin e AI CORE).
// Escolher JPG/PNG/WebP → recorte central 16:9 e compressão WebP no próprio telemóvel → pré-visualização 16:9.
// Sem imagem, a pré-visualização mostra a capa do jogo (é o que aparece no cartão).
import { useId, useRef, useState } from 'react';
import { TournamentCover } from './GameArt';
import { Icon } from './icons';
import { COVER_TYPES } from '@/lib/cover';
import type { CoverResult } from '@/lib/coverImage';

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * `value` = capa atual (URL ou data URL) para mostrar; `pending` = imagem nova ainda não guardada.
 * `onPick(r)` recebe a imagem já recortada/comprimida; `onRemove()` limpa.
 */
export function CoverField({ game, value, pending, onPick, onRemove, busy = false, label = 'Imagem de capa', compact = false }: {
  game: string; value?: string; pending?: CoverResult | null; onPick: (r: CoverResult) => void; onRemove: () => void; busy?: boolean; label?: string; compact?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const [working, setWorking] = useState(false);
  const shown = pending?.dataUrl ?? value;
  const has = !!shown;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setWorking(true);
    try {
      const { prepareCover } = await import('@/lib/coverImage');
      onPick(await prepareCover(f));
    } catch (e) {
      setErr((e as Error).message || 'Não foi possível usar esta imagem.');
    } finally {
      setWorking(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-white/70">{label}</label>
        <span className="text-[11px] text-white/50">16:9 · JPG, PNG ou WebP</span>
      </div>
      <div className={`relative w-full overflow-hidden rounded-ctl border border-line bg-[#14161C] ${compact ? 'max-w-[320px]' : ''}`} style={{ aspectRatio: '16 / 9' }}>
        <TournamentCover t={{ game, cover: shown }} sizes="(min-width: 768px) 420px, 100vw" shade={false} alt={has ? 'Pré-visualização da capa' : 'Sem imagem: é usada a capa do jogo'} />
        {!has && <span className="absolute inset-x-0 bottom-0 bg-[#0E0F13]/80 px-3 py-1.5 text-[11px] text-white/80">Sem imagem: o cartão usa a capa do jogo</span>}
        {(working || busy) && (
          <span className="absolute inset-0 flex items-center justify-center bg-[#0E0F13]/70 text-sm font-semibold" role="status">{working ? 'A preparar a imagem…' : 'A enviar…'}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} id={id} type="file" accept={COVER_TYPES.join(',')} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} disabled={working || busy} />
        <button type="button" className="btn-ghost !min-h-[40px] !px-3 text-sm" onClick={() => input.current?.click()} disabled={working || busy}>
          <Icon name="image" size={18} /> {has ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
        {has && (
          <button type="button" className="btn-quiet !min-h-[40px] !px-3 text-sm" onClick={() => { setErr(''); onRemove(); }} disabled={working || busy}>
            <Icon name="trash" size={18} /> Remover
          </button>
        )}
        {pending && <span className="text-[11px] text-white/50">{pending.width}x{pending.height} · {kb(pending.bytes)} · {pending.type === 'image/webp' ? 'WebP' : 'JPEG'}</span>}
      </div>
      {err && <p className="text-xs text-[#F87171]" role="alert">{err}</p>}
    </div>
  );
}
