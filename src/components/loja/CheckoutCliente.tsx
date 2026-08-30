'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useCarrinho } from './CarrinhoContexto'
import { EstadoVazio, classesBotao, estiloPrimario, real } from './ds'
import { PAGAMENTO_LABEL } from '@/lib/commerce/pedido'

// Checkout — a tela que transforma a vitrine em loja.
//
// Uma página só, sem passos. Um fluxo de três etapas com barra de progresso é
// o padrão de loja grande, e ali faz sentido porque há pagamento no meio;
// aqui não há: o pedido é registrado e a loja combina o resto. Repartir esta
// tela em três seria três chances de o cliente desistir para preencher os
// mesmos oito campos.
//
// O que NÃO fica aqui: conferir preço e saldo. Isso é do servidor, e do banco
// depois dele — `loja_criar_pedido` reconfere tudo com a trava tomada. Esta
// tela pode mostrar um total que envelheceu; o pedido nunca nasce com ele.

type Campo = { nome: string; rotulo: string; largura?: 'meia' | 'inteira'; max?: number; dica?: string }

const CAMPOS_ENTREGA: Campo[] = [
  { nome: 'cep', rotulo: 'CEP', largura: 'meia', max: 9 },
  { nome: 'logradouro', rotulo: 'Rua', largura: 'inteira', max: 200 },
  { nome: 'numero', rotulo: 'Número', largura: 'meia', max: 20 },
  { nome: 'complemento', rotulo: 'Complemento', largura: 'meia', max: 100 },
  { nome: 'bairro', rotulo: 'Bairro', largura: 'meia', max: 100 },
  { nome: 'cidade', rotulo: 'Cidade', largura: 'meia', max: 100 },
]

export default function CheckoutCliente({
  entregaAtiva, retiradaAtiva, pagamentoFormas, enderecoLoja,
}: {
  entregaAtiva: boolean
  retiradaAtiva: boolean
  pagamentoFormas: string[]
  /** Para onde o cliente vai, quando escolhe retirar. */
  enderecoLoja: string | null
}) {
  const router = useRouter()
  const { itens, quantidadeTotal, carregado, limpar } = useCarrinho()

  const [modo, setModo] = useState<'entrega' | 'retirada'>(entregaAtiva ? 'entrega' : 'retirada')
  const [form, setForm] = useState<Record<string, string>>({})
  const [pagamento, setPagamento] = useState(pagamentoFormas[0] ?? 'pix')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recusados, setRecusados] = useState<{ nome: string; disponivel: number }[]>([])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const total = itens.reduce((s, i) => s + i.precoVisto * i.quantidade, 0)

  async function enviar() {
    setEnviando(true); setErro(null); setRecusados([])
    try {
      const r = await fetch('/api/loja/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens: itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
          cliente: { nome: form.nome, telefone: form.telefone, doc: form.doc, email: form.email },
          entrega: { modo, ...form },
          pagamento,
          observacao: form.observacao,
        }),
      })
      const dados = await r.json()
      if (!r.ok) {
        setErro(dados.erro ?? 'Não foi possível concluir o pedido.')
        if (Array.isArray(dados.itens)) setRecusados(dados.itens)
        return
      }
      // O carrinho só é esvaziado DEPOIS de o pedido existir. Limpar antes,
      // otimista, deixaria o cliente sem carrinho e sem pedido se falhasse.
      limpar()
      router.push(`/pedido/${encodeURIComponent(dados.numero)}`)
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  if (!carregado) return <div className="loja-container py-16" />

  if (quantidadeTotal === 0) {
    return (
      <EstadoVazio
        titulo="Seu carrinho está vazio"
        descricao="Escolha os produtos e volte aqui para fechar o pedido."
        acao={<Link href="/" className={classesBotao('primario')} style={estiloPrimario}>Ver produtos</Link>}
      />
    )
  }

  const faltaEndereco = modo === 'entrega'
    && ['logradouro', 'numero', 'bairro', 'cidade'].some(k => !form[k]?.trim())
  const podeEnviar = !!form.nome?.trim()
    && (form.telefone ?? '').replace(/\D/g, '').length >= 10
    && !faltaEndereco && !enviando

  return (
    <div className="loja-container grid gap-6 py-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-5">
        <Secao titulo="Seus dados">
          <div className="grid gap-3 sm:grid-cols-2">
            <Entrada rotulo="Nome completo" valor={form.nome ?? ''} onChange={v => set('nome', v)} inteira obrigatorio />
            <Entrada rotulo="WhatsApp com DDD" valor={form.telefone ?? ''} onChange={v => set('telefone', v)} obrigatorio
              dica="É por aqui que a loja combina entrega e pagamento." />
            <Entrada rotulo="CPF (opcional)" valor={form.doc ?? ''} onChange={v => set('doc', v)}
              dica="Só se quiser CPF na nota." />
          </div>
        </Secao>

        {entregaAtiva && retiradaAtiva && (
          <Secao titulo="Como você quer receber">
            <div className="flex flex-wrap gap-2">
              {(['entrega', 'retirada'] as const).map(m => (
                <button key={m} onClick={() => setModo(m)}
                  className={`rounded-[10px] border px-4 py-2 text-sm font-semibold ${
                    modo === m
                      ? 'border-transparent text-white'
                      : 'border-[var(--borda)] bg-white text-[var(--tinta-forte)]'}`}
                  style={modo === m ? estiloPrimario : undefined}>
                  {m === 'entrega' ? 'Entrega' : 'Retirar na loja'}
                </button>
              ))}
            </div>
          </Secao>
        )}

        {modo === 'entrega' ? (
          <Secao titulo="Endereço de entrega">
            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPOS_ENTREGA.map(c => (
                <Entrada key={c.nome} rotulo={c.rotulo} valor={form[c.nome] ?? ''}
                  onChange={v => set(c.nome, v)} inteira={c.largura === 'inteira'}
                  obrigatorio={['logradouro', 'numero', 'bairro', 'cidade'].includes(c.nome)} />
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--tinta-media)]">
              O valor da entrega é combinado pela loja no WhatsApp — ele não entra neste total.
            </p>
          </Secao>
        ) : (
          <Secao titulo="Retirada na loja">
            <p className="text-sm text-[var(--tinta-media)]">
              {enderecoLoja ?? 'A loja informa o endereço de retirada no contato.'}
            </p>
          </Secao>
        )}

        {pagamentoFormas.length > 0 && (
          <Secao titulo="Pagamento">
            <div className="flex flex-wrap gap-2">
              {pagamentoFormas.map(f => (
                <button key={f} onClick={() => setPagamento(f)}
                  className={`rounded-[10px] border px-4 py-2 text-sm font-semibold ${
                    pagamento === f
                      ? 'border-transparent text-white'
                      : 'border-[var(--borda)] bg-white text-[var(--tinta-forte)]'}`}
                  style={pagamento === f ? estiloPrimario : undefined}>
                  {PAGAMENTO_LABEL[f] ?? f}
                </button>
              ))}
            </div>
            {/* Dito com todas as letras: a loja não cobra aqui. Deixar
                ambíguo faria o cliente esperar uma tela de pagamento que
                não existe, e abandonar o pedido achando que falhou. */}
            <p className="mt-2 text-xs text-[var(--tinta-media)]">
              Você <strong>não paga agora</strong>. O pagamento é combinado na{' '}
              {modo === 'entrega' ? 'entrega' : 'retirada'}.
            </p>
          </Secao>
        )}

        <Secao titulo="Observação (opcional)">
          <textarea value={form.observacao ?? ''} onChange={ev => set('observacao', ev.target.value)}
            rows={3} maxLength={500}
            placeholder="Ponto de referência, horário melhor para entrega…"
            className="w-full rounded-[10px] border border-[var(--borda)] p-3 text-sm outline-none focus:border-[var(--loja-primaria)]" />
        </Secao>
      </div>

      {/* Resumo. `sticky` no desktop porque o formulário é longo e o botão
          não pode ficar a uma rolagem de distância do total. */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-[var(--raio)] border border-[var(--borda)] bg-white p-4">
          <h2 className="font-semibold text-[var(--tinta-forte)]">Resumo</h2>
          <ul className="mt-3 space-y-2">
            {itens.map(i => (
              <li key={i.produtoId} className="flex justify-between gap-3 text-sm">
                <span className="loja-linhas-2 text-[var(--tinta-media)]">{i.quantidade}× {i.nome}</span>
                <span className="shrink-0 font-medium">{real(i.precoVisto * i.quantidade)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-[var(--borda)] pt-3">
            <span className="font-semibold">Total</span>
            <span className="text-lg font-bold">{real(total)}</span>
          </div>

          {erro && (
            <div className="mt-3 rounded-[10px] border border-[var(--alerta)] bg-amber-50 p-3">
              <p className="text-sm font-medium text-[var(--alerta)]">{erro}</p>
              {recusados.length > 0 && (
                <>
                  <ul className="mt-1 list-disc pl-4 text-xs text-[var(--tinta-media)]">
                    {recusados.map(i => (
                      <li key={i.nome}>
                        {i.nome} — {i.disponivel > 0 ? `restam ${i.disponivel}` : 'esgotado'}
                      </li>
                    ))}
                  </ul>
                  <Link href="/carrinho" className="mt-2 inline-block text-xs font-semibold underline">
                    Voltar ao carrinho e ajustar
                  </Link>
                </>
              )}
            </div>
          )}

          <button onClick={enviar} disabled={!podeEnviar}
            className={`${classesBotao('primario')} mt-4 w-full`} style={estiloPrimario}>
            {enviando ? 'Enviando…' : 'Confirmar pedido'}
          </button>
          <p className="mt-2 text-center text-[0.6875rem] text-[var(--tinta-fraca)]">
            Ao confirmar, a loja recebe seu pedido e entra em contato.
          </p>
        </div>
      </aside>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--raio)] border border-[var(--borda)] bg-white p-4">
      <h2 className="mb-3 font-semibold text-[var(--tinta-forte)]">{titulo}</h2>
      {children}
    </section>
  )
}

function Entrada({ rotulo, valor, onChange, inteira, obrigatorio, dica }: {
  rotulo: string; valor: string; onChange: (v: string) => void
  inteira?: boolean; obrigatorio?: boolean; dica?: string
}) {
  return (
    <label className={inteira ? 'sm:col-span-2' : ''}>
      <span className="block text-xs font-medium text-[var(--tinta-media)]">
        {rotulo}{obrigatorio && <span className="text-[var(--alerta)]"> *</span>}
      </span>
      <input value={valor} onChange={e => onChange(e.target.value)}
        className="mt-1 h-11 w-full rounded-[10px] border border-[var(--borda)] px-3 text-sm outline-none focus:border-[var(--loja-primaria)]" />
      {dica && <span className="mt-0.5 block text-[0.6875rem] text-[var(--tinta-fraca)]">{dica}</span>}
    </label>
  )
}
