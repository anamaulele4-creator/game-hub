'use client';

import { InfoPage } from '@/components/market/InfoPage';

export default function ReembolsosMarketplace() {
  return (
    <InfoPage title="Política de reembolso">
      <p>Na compra segura o dinheiro só chega ao vendedor depois de confirmares a receção. Tens direito a reembolso total quando:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>o vendedor não entrega dentro do prazo indicado em Tarifas e prazos;</li>
        <li>o que recebeste não corresponde ao anúncio (descrição, fotos, quantidade);</li>
        <li>a conta ou o código deixam de funcionar por causa do vendedor logo após a entrega.</li>
      </ul>
      <h2>Como pedir</h2>
      <p>Em Os meus pedidos, abre uma disputa antes de confirmares a receção e explica o problema. Guarda capturas de ecrã. A equipa ouve as duas partes e decide; a decisão fica registada no pedido.</p>
      <h2>Quando não há reembolso</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>depois de confirmares a receção;</li>
        <li>se mudares a palavra-passe da conta comprada e perderes o acesso por tua causa;</li>
        <li>se a conta for banida por violação das regras do jogo cometida depois da entrega.</li>
      </ul>
      <p>O reembolso é feito pelo mesmo método de pagamento, quando os pagamentos M-Pesa/e-Mola estiverem ativos.</p>
    </InfoPage>
  );
}
