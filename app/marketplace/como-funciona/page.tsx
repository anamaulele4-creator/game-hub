'use client';

import { InfoPage } from '@/components/market/InfoPage';
import { PAY_DISABLED } from '@/lib/market';

export default function ComoFunciona() {
  return (
    <InfoPage title="Como funciona">
      <h2>Comprar</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Escolhe o anúncio e lê a descrição. Se tiveres dúvidas, pergunta ao vendedor na página do anúncio.</li>
        <li>Pagas pela compra segura. O dinheiro fica retido pela TXAPILOG, não vai logo para o vendedor.</li>
        <li>O vendedor entrega o que vendeu (conta, itens, moedas, código ou serviço).</li>
        <li>Confirmas que recebeste. Só aí o vendedor recebe o valor.</li>
        <li>Se não receberes ou não corresponder ao anúncio, abres uma disputa. A equipa analisa e decide: reembolso ou pagamento ao vendedor.</li>
      </ol>
      <h2>Vender</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Em Anunciar escolhe a categoria e o tipo, escreve título e descrição, adiciona de 1 a 5 fotos tuas e define preço e stock.</li>
        <li>Podes pôr o preço em MT, R$, US$ ou rand: convertemos para meticais com o câmbio do dia.</li>
        <li>Quando houver um pedido pago, entrega e marca o pedido como entregue.</li>
        <li>Depois de o comprador confirmar, o pedido fica concluído e ele pode avaliar-te.</li>
      </ol>
      <h2>Pagamentos</h2>
      <p>{PAY_DISABLED}. Enquanto os pagamentos não estiverem ligados, os pedidos ficam a aguardar pagamento.</p>
      <p>É proibido vender contas ou itens obtidos de forma ilegal, roubados ou que violem as regras dos jogos. Anúncios assim são removidos.</p>
    </InfoPage>
  );
}
