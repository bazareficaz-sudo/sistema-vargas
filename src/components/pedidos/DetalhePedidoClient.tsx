'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ETAPAS, ETAPA_INFO, proximaEtapa, transicaoPermitida, type Etapa } from '@/lib/pedidos/etapas'

// Ficha do pedido em abas, com as duas origens no mesmo layout.
//
// A tradução para o formato comum acontece aqui, e não no servidor, porque
// cada origem tem campos que a outra não tem (venda tem troco e vendedor;
// pedido de marketplace tem endereço e rastreio). Achatar tudo num tipo só
// perderia informação que o operador precisa ver.

const brl = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

type Aba = 'itens' | 'cliente' | 'pagamento' | 'historico'

export default function DetalhePedidoClient({ fonte, pedido, itens, canal }: {
  fonte: 'venda' | 'marketplace'
  pedido: any
  itens: any[]
  canal: { id: string; nome: string; plataforma: string } | null
}) {
  const [aba, setAba] = useState<Aba>('itens')
  const [etapa, setEtapa] = useState<Etapa>((pedido.etapa_operacional ?? (fonte === 'venda' ? 'concluido' : 'novo')) as Etapa)
  const [eventos, setEventos] = useState<any[] | null>(null)
  const [salvando, setSalvando] = useState<Etapa | null>(null)
  const [erro, setErro] = useState('')

  const ehVenda = fonte === 'venda'
  const numero = ehVenda ? pedido.numero : (pedido.numero_pedido ?? pedido.id_externo)
  const total = Number(ehVenda ? pedido.total : pedido.valor_total)
  const desconto = Number(ehVenda ? (pedido.desconto ?? pedido.desconto_total ?? 0) : pedido.valor_desconto)
  const frete = ehVenda ? 0 : Number(pedido.valor_frete ?? 0)
  const subtotal = Number(ehVenda ? pedido.subtotal : pedido.valor_produtos) || (total + desconto - frete)

  async function carregarEventos() {
    const d = await fetch(`/api/pedidos/etapa?fonte=${fonte}&id=${pedido.id}`).then(r => r.json())
    if (d.ok) setEventos(d.eventos)
  }
  useEffect(() => { carregarEventos() }, [])

  async function mudarEtapa(nova: Etapa) {
    const permite = transicaoPermitida(etapa, nova)
    if (!permite.ok) { setErro(permite.motivo ?? ''); return }
    setSalvando(nova); setErro('')
    try {
      const d = await fetch('/api/pedidos/etapa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fonte, id: pedido.id, etapa: nova }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível mudar a etapa'); return }
      setEtapa(nova); carregarEventos()
    } finally {
      setSalvando(null)
    }
  }

  const info = ETAPA_INFO[etapa]
  const proxima = proximaEtapa(etapa)

  const notaNumero = ehVenda ? pedido.nfce_numero : pedido.nfe_numero
  const notaChave = ehVenda ? pedido.nfce_chave : pedido.nfe_chave

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/dashboard/pedidos" className="text-xs text-gray-500 hover:text-gray-700">← Pedidos</Link>

      {/* Cabeçalho */}
      <div className="mt-2 mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pedido {numero}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {ehVenda ? (pedido.canal === 'app' ? 'Aplicativo' : 'PDV') : (canal?.nome ?? 'Marketplace')}
            {' · '}{dt(ehVenda ? pedido.created_at : (pedido.data_pedido ?? pedido.created_at))}
            {pedido.cliente_nome && <> · {pedido.cliente_nome}</>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Total</p>
          <p className="text-2xl font-semibold text-gray-900">{brl(total)}</p>
        </div>
      </div>

      {/* Os dois eixos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-[11px] text-gray-500">O canal informa</p>
          <p className="text-sm text-gray-900 mt-0.5">
            {ehVenda
              ? (pedido.status === 'cancelada' ? 'Cancelada' : pedido.tipo_operacao === 'devolucao' ? 'Devolução' : 'Concluída')
              : (pedido.status ?? '—')}
            {!ehVenda && pedido.status_externo && <span className="text-gray-400"> · {pedido.status_externo}</span>}
          </p>
        </div>
        <div className={`border rounded-xl px-4 py-3 ${info.cor}`}>
          <p className="text-[11px] opacity-70">Aqui no galpão</p>
          <p className="text-sm font-medium mt-0.5">{info.icone} {info.label}</p>
          {pedido.etapa_operacional_em && (
            <p className="text-[11px] opacity-60 mt-0.5">desde {dt(pedido.etapa_operacional_em)}</p>
          )}
        </div>
      </div>

      {/* Mudar etapa */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-5">
        <p className="text-xs font-medium text-gray-600 mb-2">Mudar etapa</p>
        <div className="flex flex-wrap gap-1.5">
          {ETAPAS.filter(e => e.valor !== etapa).map(e => {
            const permite = transicaoPermitida(etapa, e.valor)
            return (
              <button key={e.valor} onClick={() => mudarEtapa(e.valor)}
                disabled={!permite.ok || salvando !== null}
                title={permite.ok ? e.ajuda : permite.motivo}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  e.valor === proxima ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                {salvando === e.valor ? '...' : `${e.icone} ${e.label}`}
              </button>
            )
          })}
        </div>
        {erro && <p className="text-xs text-red-600 mt-1.5">{erro}</p>}
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {([['itens', `Itens (${itens.length})`], ['cliente', ehVenda ? 'Cliente' : 'Cliente e entrega'],
           ['pagamento', 'Pagamento e nota'], ['historico', 'Linha do tempo']] as [Aba, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${aba === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'itens' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Produto</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Qtd</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Unitário</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itens.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400 text-sm">Nenhum item registrado.</td></tr>
                )}
                {itens.map(i => {
                  const nome = ehVenda ? i.produto_nome : i.nome_produto
                  const sku = ehVenda ? i.produto_sku : i.sku
                  const totalItem = ehVenda ? i.total : i.subtotal
                  const semProduto = !i.produto_id
                  return (
                    <tr key={i.id}>
                      <td className="px-3 py-2">
                        <p className="text-gray-900">{nome}</p>
                        <p className="text-xs text-gray-400">
                          {sku ? `SKU ${sku}` : 'sem SKU'}
                          {semProduto && <span className="text-amber-700"> · sem produto vinculado no cadastro</span>}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 font-mono">{Number(i.quantidade)}</td>
                      <td className="px-3 py-2 text-right text-gray-600 font-mono">{brl(i.preco_unitario)}</td>
                      <td className="px-3 py-2 text-right text-gray-900 font-mono font-medium">{brl(totalItem)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-100 px-4 py-3 space-y-1 text-sm">
            <Linha rotulo="Subtotal" valor={brl(subtotal)} />
            {desconto > 0 && <Linha rotulo="Desconto" valor={`− ${brl(desconto)}`} cor="text-green-700" />}
            {frete > 0 && <Linha rotulo="Frete" valor={brl(frete)} />}
            <Linha rotulo="Total" valor={brl(total)} forte />
          </div>
        </div>
      )}

      {aba === 'cliente' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <Campo rotulo="Nome" valor={pedido.cliente_nome ?? pedido.clientes?.nome} />
          {ehVenda ? (
            <>
              <Campo rotulo="Telefone" valor={pedido.clientes?.telefone} />
              <Campo rotulo="E-mail" valor={pedido.clientes?.email} />
              <Campo rotulo="CPF/CNPJ" valor={pedido.clientes?.cpf_cnpj} />
              <Campo rotulo="Vendedor" valor={pedido.vendedor_nome} />
              <Campo rotulo="Operador" valor={pedido.operador_nome} />
              {pedido.entrega_solicitada && <Campo rotulo="Entrega" valor="Solicitada" />}
            </>
          ) : (
            <>
              <Campo rotulo="E-mail" valor={pedido.cliente_email} />
              <Campo rotulo="Documento" valor={pedido.cliente_doc} />
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Entrega</p>
                <Campo rotulo="Endereço" valor={[pedido.entrega_logradouro, pedido.entrega_numero].filter(Boolean).join(', ')} />
                <Campo rotulo="Bairro" valor={pedido.entrega_bairro} />
                <Campo rotulo="Cidade" valor={[pedido.entrega_cidade, pedido.entrega_estado].filter(Boolean).join(' / ')} />
                <Campo rotulo="CEP" valor={pedido.entrega_cep} />
                <Campo rotulo="Transportadora" valor={pedido.transportadora} />
                <Campo rotulo="Rastreio" valor={pedido.codigo_rastreio} mono />
                <Campo rotulo="Prazo de postagem" valor={pedido.prazo_postagem ? dt(pedido.prazo_postagem) : null} />
                <Campo rotulo="Enviado em" valor={pedido.data_envio ? dt(pedido.data_envio) : null} />
                <Campo rotulo="Entregue em" valor={pedido.data_entrega ? dt(pedido.data_entrega) : null} />
              </div>
            </>
          )}
        </div>
      )}

      {aba === 'pagamento' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          {ehVenda ? (
            <>
              <Campo rotulo="Forma de pagamento" valor={pedido.forma_pagamento} />
              <Campo rotulo="Valor recebido" valor={pedido.valor_recebido ? brl(pedido.valor_recebido) : null} />
              <Campo rotulo="Troco" valor={pedido.troco ? brl(pedido.troco) : null} />
              {pedido.credito_gerado > 0 && <Campo rotulo="Crédito gerado" valor={brl(pedido.credito_gerado)} />}
            </>
          ) : (
            <>
              <Campo rotulo="Pago em" valor={pedido.data_pagamento ? dt(pedido.data_pagamento) : null} />
              <Campo rotulo="Baixa de estoque" valor={pedido.baixou_estoque ? 'Feita' : 'Não feita'} />
            </>
          )}

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Nota fiscal</p>
            {notaNumero ? (
              <>
                <Campo rotulo="Número" valor={String(notaNumero)} />
                <Campo rotulo="Chave" valor={notaChave} mono />
                {ehVenda && <Campo rotulo="Situação" valor={pedido.nfce_status} />}
                {ehVenda && pedido.nfce_url_pdf && (
                  <a href={pedido.nfce_url_pdf} target="_blank" rel="noreferrer"
                    className="text-sm text-blue-600 hover:underline">abrir DANFE →</a>
                )}
                {!ehVenda && !pedido.venda_id && (
                  <p className="text-xs text-gray-400 mt-1">Número informado manualmente — não foi emitido pelo sistema.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">
                Sem nota emitida.
                {ehVenda && pedido.nfce_motivo_rejeicao && (
                  <span className="block text-xs text-red-600 mt-1">Última rejeição: {pedido.nfce_motivo_rejeicao}</span>
                )}
                <Link href={ehVenda ? '/dashboard/vendas' : '/dashboard/pedidos-ecommerce'}
                  className="block text-blue-600 hover:underline text-sm mt-1">emitir na tela de origem →</Link>
              </p>
            )}
          </div>

          {pedido.observacao || pedido.observacoes ? (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Observação</p>
              <p className="text-sm text-gray-700">{pedido.observacao ?? pedido.observacoes}</p>
            </div>
          ) : null}
        </div>
      )}

      {aba === 'historico' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          {eventos === null && <p className="text-sm text-gray-400">Carregando...</p>}
          {eventos?.length === 0 && (
            <p className="text-sm text-gray-400">
              Nada registrado ainda. A partir de agora, toda mudança de etapa aparece aqui com autor e horário.
            </p>
          )}
          <div className="space-y-3">
            {eventos?.map(ev => (
              <div key={ev.id} className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900">{ev.descricao}</p>
                  {ev.observacao && <p className="text-xs text-gray-600 mt-0.5">{ev.observacao}</p>}
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {dt(ev.created_at)}
                    {ev.automatico ? ' · automático' : ev.usuario_nome ? ` · ${ev.usuario_nome}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Linha({ rotulo, valor, forte, cor }: { rotulo: string; valor: string; forte?: boolean; cor?: string }) {
  return (
    <div className="flex justify-between">
      <span className={forte ? 'font-medium text-gray-900' : 'text-gray-600'}>{rotulo}</span>
      <span className={`font-mono ${forte ? 'font-semibold text-gray-900' : cor ?? 'text-gray-700'}`}>{valor}</span>
    </div>
  )
}

function Campo({ rotulo, valor, mono }: { rotulo: string; valor: string | null | undefined; mono?: boolean }) {
  if (!valor) return null
  return (
    <div className="flex flex-wrap gap-2">
      <span className="text-xs text-gray-500 w-36 flex-shrink-0">{rotulo}</span>
      <span className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{valor}</span>
    </div>
  )
}
