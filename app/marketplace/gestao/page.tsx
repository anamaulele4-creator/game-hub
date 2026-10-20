'use client';

// Gestão do Marketplace 3.0: painel administrativo (admin e equipa com permissões granulares).
import { Page } from '@/components/ui';
import { MarketNav } from '@/components/market/Kit';
import { Mkt3Admin } from '@/components/mkt3/Admin';

export default function GestaoPage() {
  return (
    <Page title="Gestão do marketplace" back="/marketplace">
      <div className="bx">
        <MarketNav active="gestao" />
        <Mkt3Admin />
      </div>
    </Page>
  );
}
