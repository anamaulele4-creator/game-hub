'use client';

import { useEffect, useState } from 'react';
import { InfoPage } from '@/components/market/InfoPage';
import { TBD } from '@/lib/market';
import { DEFAULT_MARKET_SETTINGS, MarketSettings, marketApi } from '@/lib/marketApi';

export default function Tarifas() {
  const [s, setS] = useState<MarketSettings>(DEFAULT_MARKET_SETTINGS);
  useEffect(() => { marketApi.settings().then(setS).catch(() => {}); }, []);
  const rows: [string, string][] = [
    ['Taxa da plataforma por venda', s.feePct == null ? TBD : `${s.feePct}% do valor do pedido`],
    ['Prazo de entrega do vendedor', s.deliveryHours == null ? TBD : `${s.deliveryHours} horas depois do pagamento`],
    ['Libertação automática ao vendedor', s.autoReleaseDays == null ? TBD : `${s.autoReleaseDays} dias depois da entrega, se não houver disputa`],
    ['Arredondamento na conversão para MT', `Para cima, ao múltiplo de ${s.rounding} MT`],
    ['Comprar', 'Sem taxa para o comprador'],
  ];
  return (
    <InfoPage title="Tarifas e prazos">
      <dl className="divide-y divide-[var(--bx-line)]">
        {rows.map(([k, v]) => <div key={k} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4"><dt className="bx-muted">{k}</dt><dd className="font-semibold sm:text-right">{v}</dd></div>)}
      </dl>
      <p className="bx-dim text-[12.5px]">Os valores são definidos pela TXAPILOG e aparecem aqui assim que estiverem fixados.</p>
    </InfoPage>
  );
}
