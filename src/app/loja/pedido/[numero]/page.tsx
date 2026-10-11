import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import { buscarPedido } from '@/lib/commerce/pedido'
import { classesBotao, estiloPrimario, real } from '@/components/loja/ds'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Pedido confirmado',
  robots: { index: false, follow: false },
}

// Confirmação do pedido.
//
// O que esta tela precisa fazer, e é só isso: dizer que deu certo, dar o
// número, e deixar claro o que acontece a seguir. A loja não cobrou nada
// aqui, então o cliente sai sem saber quando paga se ninguém disser.
//
// Ela é acessível por link direto — quem tem o número vê o pedido. É o mesmo
// contrato de um comprovante: o número é o segredo. Por isso `buscarPedido`
// filtra pelo canal da loja (o número de uma loja não abre pedido de outra) e
// devolve lista branca de campos, sem telefone, sem documento e sem
// `cliente_id`.

export default async function PaginaPedido({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params
  const loja = await lojaObrigatoria()
  const pedido = await buscarPedido(loja, decodeURIComponent(numero))
  if (!pedido) notFound()

  const primeiroNome = pedido.clienteNome.split(' ')[0] || ''
  const freteCalculado = pedido.modo === 'entrega' && pedido.freteStatus === 'calculado'

  return (
    <div className="loja-container max-w-2xl py-10">
      <div className="rounded-[var(--raio)] border border-[var(--borda)] bg-white p-6">
        <p className="text-sm font-semibold" style={{ color: 'var(--sucesso)' }}>
          Pedido confirmado
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--tinta-forte)]">
          {primeiroNome ? `Obrigado, ${primeiroNome}!` : 'Obrigado!'}
        </h1>
        <p className="mt-2 text-sm text-[var(--tinta-media)]">
          Seu número é <strong className="font-mono text-[var(--tinta-forte)]">{pedido.numero}</strong>.
          Guarde-o: é por ele que a loja encontra sua compra.
        </p>

        <ul className="mt-6 divide-y divide-[var(--borda)]">
          {pedido.itens.map((i, n) => (
            <li key={n} className="flex justify-between gap-4 py-2.5 text-sm">
              <span className="text-[var(--tinta-media)]">{i.quantidade}× {i.nome}</span>
              <span className="shrink-0 font-medium">{real(i.subtotal)}</span>
            </li>
          ))}
        </ul>

        {freteCalculado && (
          <div className="mt-3 space-y-1 border-t border-[var(--borda)] pt-3 text-sm">
            <div className="flex justify-between text-[var(--tinta-media)]">
              <span>Produtos</span><span>{real(pedido.valorProdutos)}</span>
            </div>
            <div className="flex justify-between text-[var(--tinta-media)]">
              <span>Entrega{pedido.freteServico ? ` — ${pedido.freteServico}` : ''}</span>
              <span>{pedido.valorFrete > 0 ? real(pedido.valorFrete) : 'Grátis'}</span>
            </div>
          </div>
        )}

        <div className={`${freteCalculado ? 'mt-2' : 'mt-3 border-t border-[var(--borda)] pt-3'} flex justify-between`}>
          <span className="font-semibold">{freteCalculado ? 'Total' : 'Total dos produtos'}</span>
          <span className="text-lg font-bold">{real(pedido.total)}</span>
        </div>

        {/* O passo seguinte, escrito. Sem isto o cliente fica esperando um
            e-mail que não vem, ou uma cobrança que não existe. */}
        <div className="mt-6 rounded-[10px] bg-[var(--fundo-suave)] p-4">
          <h2 className="text-sm font-semibold text-[var(--tinta-forte)]">O que acontece agora</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-[var(--tinta-media)]">
            <li>A loja recebeu seu pedido e vai chamar no WhatsApp para confirmar.</li>
            <li>
              {pedido.modo === 'retirada'
                ? 'Você combina o horário e retira na loja.'
                : freteCalculado
                  ? 'A loja confirma o prazo da entrega com você.'
                  : 'Vocês combinam o valor e o prazo da entrega — o frete não está incluído no total acima.'}
            </li>
            <li>O pagamento é feito na {pedido.modo === 'retirada' ? 'retirada' : 'entrega'}.</li>
          </ol>
          <p className="mt-3 text-xs text-[var(--tinta-fraca)]">
            Seus itens ficam separados enquanto a loja confirma.
          </p>
        </div>

        {loja.whatsapp && (
          <a
            href={`https://wa.me/55${loja.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
              `Olá! Fiz o pedido ${pedido.numero} na ${loja.nome}.`)}`}
            target="_blank" rel="noopener noreferrer"
            className={`${classesBotao('primario')} mt-5 w-full`} style={estiloPrimario}
          >
            Falar com a loja no WhatsApp
          </a>
        )}

        <Link href="/" className={`${classesBotao('secundario')} mt-2 w-full`}>
          Continuar comprando
        </Link>
      </div>
    </div>
  )
}
