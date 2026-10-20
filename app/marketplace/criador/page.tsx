'use client';

// Creator OS — painel do criador/vendedor (Marketplace 3.0).
import Link from 'next/link';
import { useState } from 'react';
import { Page } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useMkt3 } from '@/lib/mkt3Api';
import { MarketNav } from '@/components/market/Kit';
import { Empty, Mkt3Gate, Tabs } from '@/components/mkt3/Bits';
import { Coupons, Finance, NotifPrefs, Overview, Products, Reports, Reviews, Sales, StoreEditor } from '@/components/mkt3/Creator';

const TABS = [['resumo', 'Resumo'], ['loja', 'Loja'], ['produtos', 'Produtos e serviços'], ['vendas', 'Pedidos'], ['financas', 'Finanças'], ['avaliacoes', 'Avaliações'],
  ['cupoes', 'Descontos'], ['relatorios', 'Relatórios'], ['avisos', 'Notificações']] as const;
type T = typeof TABS[number][0];

export default function CreatorPage() {
  const { s } = useStore();
  const m = useMkt3();
  const [t, setT] = useState<T>('resumo');
  return (
    <Page title="Painel do criador" back="/marketplace">
      <div className="bx">
        <MarketNav active="criador" />
        <Mkt3Gate allowClosed>
          {!s.account.loggedIn && !m.userId ? <Empty>Entra na tua conta para abrir o teu painel. <Link className="bx-acc font-semibold" href="/entrar">Entrar</Link></Empty> : <>
            {!m.open && <p className="mb-3 rounded-lg bg-[#F59E0B]/15 p-2 text-[13px]">O Marketplace 3.0 está fechado ao público: podes acompanhar vendas e finanças, mas lojas novas e compras pelo carrinho estão em pausa.</p>}
            <Tabs items={TABS} value={t} onChange={setT} />
            {t === 'resumo' && <Overview />}
            {t === 'loja' && <StoreEditor />}
            {t === 'produtos' && <Products />}
            {t === 'vendas' && <Sales />}
            {t === 'financas' && <Finance />}
            {t === 'avaliacoes' && <Reviews />}
            {t === 'cupoes' && <Coupons />}
            {t === 'relatorios' && <Reports />}
            {t === 'avisos' && <NotifPrefs />}
          </>}
        </Mkt3Gate>
      </div>
    </Page>
  );
}
