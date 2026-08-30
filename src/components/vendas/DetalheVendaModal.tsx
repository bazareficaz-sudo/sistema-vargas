'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import BuscaCliente from '@/components/automacoes/BuscaCliente'
import PendenciasFiscais from './PendenciasFiscais'
import { abrirDanfe, type FormatoPapel } from '@/lib/fiscal/danfe'
import type { Venda } from './VendasClient'

type Item = {
  id: string; produto_nome: string; produto_sku: string | null
  // Nulo quando o item foi digitado à mão no PDV, sem produto do cadastro —
  // nesse caso não há ficha para abrir.
  produto_id: string | null
  quantidade: number; preco_unitario: number; desconto: number | null; total: number; tipo: string
}

type ClienteBusca = { id: string; nome: string; cpf_cnpj: string | null; telefone: string | null }

const FORMA_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro', debito: 'Cartão de débito', credito: 'Cartão de crédito',
  pix: 'Pix', carteira: 'Carteira/crédito loja', fiado: 'Fiado', troca: 'Troca', multiplo: 'Múltiplo',
}

function fmt(v: number) { return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

export default function DetalheVendaModal({
  venda, empresaId, modoEdicaoInicial, onClose, onImprimir, onWhatsapp, gerandoPdf, formatoImpressao, onAtualizado,
  onCorrigirItens,
}: {
  venda: Venda
  empresaId: string
  modoEdicaoInicial: boolean
  onClose: () => void
  onImprimir: () => void
  onWhatsapp: () => void
  gerandoPdf: boolean
  formatoImpressao?: FormatoPapel
  onAtualizado: (patch: Partial<Venda>) => void
  onCorrigirItens?: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [itens, setItens] = useState<Item[]>([])
  const [detalhe, setDetalhe] = useState<{
    observacao: string | null; entrega_solicitada: boolean; valor_pago: number | null; troco: number | null
    nfce_status: string | null; nfce_numero: string | null; nfce_chave: string | null; nfce_motivo_rejeicao: string | null
    nfce_url_pdf: string | null; operador_nome: string | null
    cliente_id: string | null; cliente_nome: string | null; cliente_cpf_cnpj: string | null
  } | null>(null)
  const [emitindoNfce, setEmitindoNfce] = useState(false)
  const [pendenciasAbertas, setPendenciasAbertas] = useState(false)

  // Identificação do destinatário antes de emitir. Duas formas: escolher um
  // cliente cadastrado ou digitar CPF/CNPJ na hora. Sem isso a nota sai como
  // consumidor não identificado — que foi o caso das 96 primeiras.
  const [identAberto, setIdentAberto] = useState(false)
  const [identCliId, setIdentCliId] = useState<string | null>(null)
  const [identCliNome, setIdentCliNome] = useState('')
  const [identCpf, setIdentCpf] = useState('')
  const [identNome, setIdentNome] = useState('')
  const identCpfDigitos = identCpf.replace(/\D/g, '')
  const identCpfValido = identCpfDigitos.length === 11 || identCpfDigitos.length === 14
  const identCpfIncompleto = identCpfDigitos.length > 0 && !identCpfValido

  const [edicao, setEdicao] = useState(modoEdicaoInicial)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState('')

  const [clienteId, setClienteId] = useState(venda.cliente_id)
  const [clienteNome, setClienteNome] = useState(venda.clientes?.nome ?? '')
  const [clienteBusca, setClienteBusca] = useState('')
  const [clienteResultados, setClienteResultados] = useState<ClienteBusca[]>([])
  const [observacaoEdit, setObservacaoEdit] = useState('')
  const [entregaEdit, setEntregaEdit] = useState(false)
  const [formaPagamentoEdit, setFormaPagamentoEdit] = useState(venda.forma_pagamento)

  useEffect(() => {
    (async () => {
      setCarregando(true)
      const sb = createClient()
      const [{ data: itensData }, { data: vendaData }] = await Promise.all([
        sb.from('venda_itens').select('*').eq('venda_id', venda.id),
        sb.from('vendas').select('observacao, entrega_solicitada, valor_pago, troco, nfce_status, nfce_numero, nfce_chave, nfce_motivo_rejeicao, nfce_url_pdf, operador_nome, cliente_id, cliente_nome, cliente_cpf_cnpj').eq('id', venda.id).single(),
      ])
      setItens(itensData ?? [])
      setDetalhe(vendaData as any)
      setObservacaoEdit(vendaData?.observacao ?? '')
      setEntregaEdit(vendaData?.entrega_solicitada ?? false)
      setCarregando(false)
    })()
  }, [venda.id])

  useEffect(() => {
    if (!clienteBusca.trim() || clienteBusca.length < 2) { setClienteResultados([]); return }
    const t = setTimeout(async () => {
      const sb = createClient()
      const { data } = await sb.from('clientes').select('id, nome, cpf_cnpj, telefone')
        .eq('empresa_id', empresaId)
        .or(`nome.ilike.%${clienteBusca}%,cpf_cnpj.ilike.%${clienteBusca}%,telefone.ilike.%${clienteBusca}%`)
        .limit(10)
      setClienteResultados(data ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [clienteBusca, empresaId])

  async function salvar() {
    setSalvando(true); setErroSalvar('')
    const sb = createClient()
    const mudouPagamento = formaPagamentoEdit !== venda.forma_pagamento
    const { error } = await sb.from('vendas').update({
      cliente_id: clienteId,
      observacao: observacaoEdit || null,
      entrega_solicitada: entregaEdit,
      // Mudar a forma de pagamento aqui sobrescreve o detalhamento por um
      // pagamento único pelo total — não é um editor de pagamento dividido.
      ...(mudouPagamento ? { forma_pagamento: formaPagamentoEdit, pagamentos: [{ forma: formaPagamentoEdit, valor: venda.total }] } : {}),
    }).eq('id', venda.id)
    if (error) { setErroSalvar(error.message); setSalvando(false); return }

    let clientesPatch = venda.clientes
    if (clienteId !== venda.cliente_id) {
      if (clienteId) {
        const { data: cli } = await sb.from('clientes').select('nome, telefone, cpf_cnpj').eq('id', clienteId).single()
        clientesPatch = cli ?? null
      } else {
        clientesPatch = null
      }
    }
    setDetalhe(prev => prev ? { ...prev, observacao: observacaoEdit || null, entrega_solicitada: entregaEdit } : prev)
    onAtualizado({
      cliente_id: clienteId, clientes: clientesPatch,
      ...(mudouPagamento ? { forma_pagamento: formaPagamentoEdit, pagamentos: [{ forma: formaPagamentoEdit, valor: venda.total }] } : {}),
    })
    setSalvando(false)
    setEdicao(false)
  }

  async function emitirNfce() {
    setEmitindoNfce(true)
    try {
      // Grava a identificação ANTES de emitir. A emissão lê a venda do banco,
      // então o que não estiver salvo não entra na nota.
      const patch: Record<string, any> = {}
      if (identCliId) {
        patch.cliente_id = identCliId
        patch.cliente_nome = identCliNome || null
      } else if (identCpfValido) {
        patch.cliente_cpf_cnpj = identCpfDigitos
        patch.cliente_nome = identNome.trim() || null
      }
      if (Object.keys(patch).length > 0) {
        const sb = createClient()
        const { error } = await sb.from('vendas').update(patch).eq('id', venda.id)
        if (error) throw new Error(`Não foi possível salvar a identificação: ${error.message}`)
        setDetalhe(prev => prev ? { ...prev, ...patch } : prev)
        onAtualizado(patch as any)
      }

      const res = await fetch('/api/fiscal/emitir-nfce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendaId: venda.id }),
      })
      const data = await res.json()
      setDetalhe(prev => prev ? {
        ...prev,
        nfce_status: data.status ?? (data.ok ? 'autorizada' : 'erro'),
        nfce_numero: data.numero ?? prev.nfce_numero,
        nfce_chave: data.chave ?? prev.nfce_chave,
        nfce_url_pdf: data.danfeUrl ?? prev.nfce_url_pdf,
        nfce_motivo_rejeicao: data.ok ? null : (data.erro ?? data.motivoRejeicao ?? 'Falha ao emitir'),
      } : prev)
    } catch (e: any) {
      setDetalhe(prev => prev ? { ...prev, nfce_status: 'erro', nfce_motivo_rejeicao: e.message } : prev)
    }
    setEmitindoNfce(false)
  }

  function abrirDanfeDaVenda(imprimir: boolean) {
    const r = abrirDanfe(detalhe?.nfce_url_pdf, { imprimir, formato: formatoImpressao })
    if (!r.ok) alert(r.erro)
  }

  const itensVenda = itens.filter(i => i.tipo !== 'devolucao')
  const itensDevolvidos = itens.filter(i => i.tipo === 'devolucao')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Venda #{venda.numero}</h2>
            <p className="text-xs text-gray-400">{new Date(venda.created_at).toLocaleString('pt-BR')}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {carregando ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">Carregando...</div>
        ) : (
          <div className="px-6 py-5 space-y-5">
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                venda.status === 'concluida' ? 'bg-green-100 text-green-700 border-green-200' :
                venda.status === 'cancelada' ? 'bg-red-100 text-red-600 border-red-200' :
                'bg-yellow-100 text-yellow-700 border-yellow-200'
              }`}>{venda.status}</span>
              {!edicao && (
                <button onClick={() => setEdicao(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                  ✏️ Editar
                </button>
              )}
            </div>

            {/* Cliente */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">Cliente</p>
              {!edicao ? (
                <p className="text-sm text-gray-900">{venda.clientes?.nome ?? 'Consumidor'}
                  {venda.clientes?.telefone && <span className="text-gray-400"> · {venda.clientes.telefone}</span>}
                </p>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm text-gray-800">{clienteNome || 'Consumidor (nenhum vinculado)'}</span>
                    {clienteId && (
                      <button onClick={() => { setClienteId(null); setClienteNome('') }} className="text-xs text-red-500 hover:text-red-600">remover</button>
                    )}
                  </div>
                  <input value={clienteBusca} onChange={e => setClienteBusca(e.target.value)}
                    placeholder="Buscar cliente por nome, CPF ou telefone..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  {clienteResultados.length > 0 && (
                    <div className="mt-1.5 border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                      {clienteResultados.map(c => (
                        <button key={c.id} onClick={() => { setClienteId(c.id); setClienteNome(c.nome); setClienteBusca(''); setClienteResultados([]) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                          <span className="text-gray-900">{c.nome}</span>
                          <span className="text-xs text-gray-400 ml-1.5">{c.cpf_cnpj} {c.telefone && `· ${c.telefone}`}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Itens */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-gray-700">Itens</p>
                {onCorrigirItens && venda.status !== 'cancelada' && (
                  <button onClick={onCorrigirItens}
                    title={detalhe?.nfce_status === 'autorizada'
                      ? 'Venda com NFC-e autorizada — é preciso cancelar a nota antes'
                      : 'Trocar produto, mudar quantidade, tirar item ou ajustar desconto'}
                    className="text-xs text-blue-600 hover:underline">
                    ✏ corrigir itens
                  </button>
                )}
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                {itensVenda.map(i => (
                  <div key={i.id} className="px-3 py-2 border-b border-gray-100 last:border-0 flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="text-gray-800 truncate">{i.produto_nome}</p>
                      <p className="text-xs text-gray-400">{i.quantidade}x {fmt(i.preco_unitario)}{i.produto_sku ? ` · ${i.produto_sku}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Nota recusada por falta de NCM/CEST manda o operador
                          ao cadastro do produto. Este atalho abre a ficha
                          direto na aba Fiscal, em outra aba do navegador,
                          para a venda não se perder no caminho. */}
                      {i.produto_id && (
                        <a href={`/dashboard/produtos?editar=${i.produto_id}&abaProduto=fiscal`}
                          target="_blank" rel="noreferrer"
                          title="Abrir o cadastro deste produto na aba Fiscal (nova aba)"
                          className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                          cadastro ↗
                        </a>
                      )}
                      <p className="text-gray-900 font-medium">{fmt(i.total)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {itensDevolvidos.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-red-500 mb-1">Itens devolvidos</p>
                  <div className="border border-red-100 rounded-xl overflow-hidden">
                    {itensDevolvidos.map(i => (
                      <div key={i.id} className="px-3 py-2 border-b border-red-50 last:border-0 flex items-center justify-between text-sm">
                        <p className="text-gray-700">{i.produto_nome} <span className="text-gray-400 text-xs">{i.quantidade}x</span></p>
                        <p className="text-red-500 font-medium">-{fmt(i.total)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Totais */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{fmt(venda.subtotal)}</span></div>
              {venda.desconto > 0 && <div className="flex justify-between text-gray-500"><span>Desconto</span><span>-{fmt(venda.desconto)}</span></div>}
              <div className="flex justify-between text-gray-900 font-semibold text-base pt-1 border-t border-gray-200 mt-1">
                <span>Total</span><span>{fmt(venda.total)}</span>
              </div>
            </div>

            {/* Pagamento */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">Forma de pagamento</p>
              {edicao ? (
                <div>
                  <select value={formaPagamentoEdit} onChange={e => setFormaPagamentoEdit(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                    {Object.entries(FORMA_LABEL).filter(([k]) => k !== 'troca' && k !== 'multiplo').map(([k, l]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                  </select>
                  {formaPagamentoEdit !== venda.forma_pagamento && (
                    <p className="text-xs text-amber-700 mt-1">⚠ Isso substitui o detalhamento por um pagamento único de {fmt(venda.total)}.</p>
                  )}
                </div>
              ) : (venda.pagamentos ?? []).length > 0 ? (
                <div className="space-y-1">
                  {venda.pagamentos!.map((p, idx) => (
                    <div key={idx} className="flex justify-between text-sm text-gray-700">
                      <span>{FORMA_LABEL[p.forma] ?? p.forma}</span><span>{fmt(p.valor)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-700">{FORMA_LABEL[venda.forma_pagamento] ?? venda.forma_pagamento}</p>
              )}
            </div>

            {/* NFC-e — nunca é emitida sozinha; só manual aqui ou por automação cadastrada */}
            {venda.tipo_operacao === 'venda' && (
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1.5">NFC-e</p>
                {detalhe?.nfce_status === 'autorizada' ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-gray-700">Número {detalhe.nfce_numero} <span className="text-xs text-gray-400 block">{detalhe.nfce_chave}</span></p>
                    {detalhe.nfce_url_pdf && (
                      // Botões, não link: a DANFE é guardada como data: URL e o
                      // navegador não abre data: em aba nova.
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <button onClick={() => abrirDanfeDaVenda(false)} className="text-xs text-blue-600 hover:text-blue-700 underline">Ver DANFE</button>
                        <button onClick={() => abrirDanfeDaVenda(true)} className="text-xs text-blue-600 hover:text-blue-700 underline">🖨️ Imprimir</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-amber-700">
                        ⚠ Não emitida{detalhe?.nfce_motivo_rejeicao ? ` — ${detalhe.nfce_motivo_rejeicao}` : ''}
                      </span>
                      <button onClick={emitirNfce} disabled={emitindoNfce || identCpfIncompleto}
                        className="text-xs text-amber-800 underline font-medium disabled:opacity-50 flex-shrink-0">
                        {emitindoNfce ? 'Emitindo...' : 'Emitir agora'}
                      </button>
                    </div>

                    {/* A recusa por dado fiscal tem conserto aqui mesmo.
                        Mandar o operador abrir o cadastro de cada produto era
                        o que fazia a mensagem — que já continha a resposta —
                        virar trabalho manual repetido. */}
                    {!pendenciasAbertas ? (
                      <button onClick={() => setPendenciasAbertas(true)}
                        className="text-xs text-blue-700 underline font-medium">
                        🔧 Resolver pendências fiscais dos produtos
                      </button>
                    ) : (
                      <PendenciasFiscais
                        vendaId={venda.id}
                        onResolvido={() => {
                          // Não emite sozinho: a nota é ato do operador, e ele
                          // acabou de mexer em dado fiscal. Fecha o painel e
                          // deixa "Emitir agora" à mão, agora desbloqueado.
                          setPendenciasAbertas(false)
                          setDetalhe(prev => prev ? { ...prev, nfce_motivo_rejeicao: null } : prev)
                        }}
                      />
                    )}

                    {/* Quem vai no destinatário da nota. */}
                    {detalhe?.cliente_id || detalhe?.cliente_cpf_cnpj ? (
                      <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                        🧾 Sai identificada: <b>{detalhe.cliente_nome ?? 'cliente cadastrado'}</b>
                        {detalhe.cliente_cpf_cnpj ? ` · ${detalhe.cliente_cpf_cnpj}` : ''}
                      </p>
                    ) : !identAberto ? (
                      <button onClick={() => setIdentAberto(true)}
                        className="text-xs text-blue-700 underline">
                        + Identificar cliente na nota (CPF/CNPJ)
                      </button>
                    ) : (
                      <div className="bg-white border border-gray-200 rounded-lg p-2.5 space-y-2">
                        <p className="text-[11px] text-gray-500">
                          Escolha um cliente cadastrado <b>ou</b> informe o CPF/CNPJ. Em branco, a nota sai como
                          consumidor não identificado.
                        </p>

                        <BuscaCliente empresaId={empresaId} clienteId={identCliId} clienteNome={identCliNome}
                          onChange={(id, nome) => {
                            setIdentCliId(id); setIdentCliNome(nome)
                            // Um caminho de cada vez: escolher cadastro limpa
                            // o digitado, para não sobrar dado conflitante.
                            if (id) { setIdentCpf(''); setIdentNome('') }
                          }} />

                        {!identCliId && (
                          <>
                            <div className="text-[11px] text-gray-400 text-center">ou</div>
                            <input value={identCpf} onChange={e => setIdentCpf(e.target.value)} inputMode="numeric"
                              placeholder="CPF/CNPJ — só números"
                              className={`w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none ${identCpfIncompleto ? 'border-red-400' : 'border-gray-300 focus:border-blue-500'}`} />
                            {identCpfValido && (
                              <input value={identNome} onChange={e => setIdentNome(e.target.value)}
                                placeholder="Nome do cliente (opcional)"
                                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
                            )}
                            {identCpfIncompleto && (
                              <p className="text-[11px] text-red-600">
                                Faltam dígitos — CPF tem 11 e CNPJ tem 14. Documento pela metade faz a SEFAZ
                                rejeitar a nota.
                              </p>
                            )}
                            {identCpfValido && (
                              <p className="text-[11px] text-green-700">
                                ✓ {identCpfDigitos.length === 11 ? 'CPF' : 'CNPJ'} válido — clique em Emitir agora.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Observação / entrega */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">Observação</p>
              {!edicao ? (
                <p className="text-sm text-gray-600">{detalhe?.observacao || '—'}</p>
              ) : (
                <textarea value={observacaoEdit} onChange={e => setObservacaoEdit(e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              )}
              {edicao && (
                <label className="flex items-center gap-2 text-xs text-gray-700 mt-2">
                  <input type="checkbox" checked={entregaEdit} onChange={e => setEntregaEdit(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  Entrega solicitada
                </label>
              )}
              {!edicao && detalhe?.entrega_solicitada && (
                <p className="text-xs text-blue-600 mt-1">🚚 Entrega solicitada</p>
              )}
            </div>

            {edicao && (
              <p className="text-xs text-gray-400">
                Edição limitada a cliente vinculado, forma de pagamento, observação e entrega. Itens e valores não podem ser alterados aqui — mudanças fiscais/de estoque exigem um fluxo próprio.
              </p>
            )}

            {erroSalvar && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erroSalvar}</p>}
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-200 flex justify-between gap-3 flex-shrink-0">
          <div className="flex gap-2">
            {!edicao && (
              <>
                <button onClick={onImprimir} disabled={gerandoPdf}
                  className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  {gerandoPdf ? '⏳' : '🖨️'} Imprimir
                </button>
                <button onClick={onWhatsapp} disabled={gerandoPdf}
                  className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  {gerandoPdf ? '⏳' : '📱'} WhatsApp
                </button>
              </>
            )}
          </div>
          <div className="flex gap-3">
            {edicao ? (
              <>
                <button onClick={() => { setEdicao(false); setErroSalvar(''); setFormaPagamentoEdit(venda.forma_pagamento) }} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
                <button onClick={salvar} disabled={salvando}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </>
            ) : (
              <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Fechar</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
