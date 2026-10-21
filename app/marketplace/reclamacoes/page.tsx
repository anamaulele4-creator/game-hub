'use client';

// Reclamações (Marketplace 3.0): as minhas reclamações como comprador e as recebidas como vendedor.
import Link from 'next/link';
import { Page } from '@/components/ui';
import { DISPUTE_REASONS, DISPUTE_STATUS, fmtDate } from '@/lib/mkt3';
import { J, mkt3, useMkt3 } from '@/lib/mkt3Api';
import { MarketNav } from '@/components/market/Kit';
import { Empty, ErrorNote, Loading, Mkt3Gate, Tag, toneFor, useLoad } from '@/components/mkt3/Bits';

export default function DisputesPage() {
  const me = useMkt3();
  const { data, error, reload } = useLoad(() => mkt3.myDisputes(), []);
  const rows = (data ?? []) as J[];
  return (
    <Page title="Reclamações" back="/marketplace/pedidos">
      <div className="bx">
        <MarketNav active="reclamacoes" />
        <Mkt3Gate allowClosed>
          <p className="bx-muted mb-3 text-[13px]">Para abrir uma reclamação, entra no pedido em “Os meus pedidos”. O dinheiro fica retido até haver acordo ou decisão da equipa.</p>
          {error ? <ErrorNote code={error} onRetry={reload} /> : !data ? <Loading /> : rows.length === 0 ? <Empty>Não tens reclamações.</Empty> : (
            <ul className="space-y-2">
              {rows.map((d) => (
                <li key={d.id}><Link href={`/marketplace/pedido/?id=${d.order_id}#reclamacao`} className="bx-card flex items-center gap-3 p-3 text-[13.5px] hover:border-[var(--bx-acc)]">
                  <span className="min-w-0 flex-1"><b>{DISPUTE_REASONS[d.reason_code] ?? d.reason_code}</b><span className="bx-dim block text-[12px]">{d.buyer_id === me.userId ? 'Abri eu' : 'Recebida (vendedor)'} · atualizada {fmtDate(d.updated_at)}</span></span>
                  <Tag tone={toneFor(d.status)}>{DISPUTE_STATUS[d.status] ?? d.status}</Tag>
                </Link></li>
              ))}
            </ul>
          )}
        </Mkt3Gate>
      </div>
    </Page>
  );
}
