'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import EditarOrcamentoModal from './EditarOrcamentoModal'
import CondicoesOrcamentoModal from './CondicoesOrcamentoModal'
import EnviarWhatsAppModal, { type EnviarWppPayload } from '@/components/integracoes/EnviarWhatsAppModal'
import { calcSaude, CONFIG_PADRAO, FAIXAS_PADRAO, type SaudeConfig, type FaixaSaude } from '@/lib/saude-venda'
import { calcularVitrinePromo, linhasCondicoes, montarMensagemOrcamento, temCondicoes, totalAvista, type CondicoesOrcamento } from '@/lib/orcamentos/condicoes'

type OrcItem = {
  id: string; produto_id: string | null; produto_nome: string
  quantidade: number; preco_unitario: number; desconto: number; total: number
}
type Orcamento = {
  id: string; numero: number; status: string
  cliente_nome: string | null; operador_nome: string | null
  subtotal: number; desconto: number; total: number
  observacao: string | null; validade: string | null
  created_at: string
  clientes: { nome: string; telefone: string | null } | null
  orcamento_itens: OrcItem[]
  desconto_avista_pct?: number | null
  avista_formas?: string[] | null
  parcelas_max?: number | null
  parcelas_sem_juros?: boolean | null
  condicoes_observacao?: string | null
  enviado_em?: string | null
}

function condicoesDe(o: Orcamento): CondicoesOrcamento {
  return {
    descontoAvistaPct: Number(o.desconto_avista_pct ?? 0),
    avistaFormas: o.avista_formas ?? [],
    parcelasMax: o.parcelas_max ?? null,
    parcelasSemJuros: o.parcelas_sem_juros ?? true,
    observacao: o.condicoes_observacao ?? null,
  }
}

const STATUS_LABEL: Record<string, { label: string; cor: string }> = {
  aberto:     { label: 'Aberto',     cor: 'bg-blue-100 text-blue-700' },
  aprovado:   { label: 'Aprovado',   cor: 'bg-green-100 text-green-700' },
  cancelado:  { label: 'Cancelado',  cor: 'bg-red-100 text-red-600' },
  convertido: { label: 'Convertido', cor: 'bg-gray-100 text-gray-500' },
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('pt-BR') }
function fmtDateTime(s: string) { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }

export default function OrcamentosClient({
  empresaId, empresaNome, orcamentos: inicial, custoPorProduto, precoCheioPorProduto,
  saudeConfig, saudeFaixas,
}: {
  empresaId: string
  empresaNome?: string | null
  orcamentos: Orcamento[]
  custoPorProduto?: Record<string, number>
  precoCheioPorProduto?: Record<string, number>
  saudeConfig?: SaudeConfig | null
  saudeFaixas?: FaixaSaude[] | null
}) {
  const sb = createClient()
  const router = useRouter()
  const [lista, setLista] = useState<Orcamento[]>(inicial)
  const [selecionado, setSelecionado] = useState<Orcamento | null>(null)
  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [atualizando, setAtualizando] = useState(false)
  const [editando, setEditando] = useState<Orcamento | null>(null)
  const [condicionando, setCondicionando] = useState<Orcamento | null>(null)
  const [wppAberto, setWppAberto] = useState(false)
  const [wppPayload, setWppPayload] = useState<EnviarWppPayload | null>(null)

  const cfgSaude = saudeConfig ?? CONFIG_PADRAO
  const faixasSaude = (saudeFaixas && saudeFaixas.length > 0) ? saudeFaixas : FAIXAS_PADRAO

  // Saúde do orçamento: sobra quanto depois de custo, taxa, imposto e
  // comissão. Mesma régua da tela de Vendas — orçamento é uma venda que
  // ainda não aconteceu, e medir diferente daria dois números para a mesma
  // pergunta.
  //
  // A forma de pagamento assumida é a MAIS CARA que o orçamento oferece: se
  // tem parcelamento, calcula no crédito parcelado. Um orçamento que só
  // fecha se o cliente pagar no Pix não é um orçamento saudável.
  function saudeDo(o: Orcamento) {
    const cond = condicoesDe(o)
    const itens = (o.orcamento_itens ?? []).map(i => ({
      custo: i.produto_id ? (custoPorProduto?.[i.produto_id] ?? 0) : 0,
      preco_unitario: i.preco_unitario,
      quantidade: i.quantidade,
      tipo: 'venda' as const,
    }))
    const semCusto = (o.orcamento_itens ?? []).some(
      i => !i.produto_id || !(Number(custoPorProduto?.[i.produto_id] ?? 0) > 0))
    const parcelas = (cond.parcelasMax ?? 1) > 1 ? cond.parcelasMax! : 1
    const forma = parcelas > 1 ? 'credito' : 'pix'
    return {
      resultado: calcSaude(itens, o.desconto ?? 0, forma, parcelas, cfgSaude, faixasSaude),
      semCusto,
      forma, parcelas,
    }
  }

  // ── Estratégia: promoção vira desconto à vista ──────────────
  const estrategiaLigada = !!cfgSaude.orcamento_promo_vira_desconto
  const formasDaEstrategia = cfgSaude.orcamento_promo_formas ?? ['pix', 'dinheiro']

  function vitrineDe(o: Orcamento) {
    return calcularVitrinePromo((o.orcamento_itens ?? []).map(i => ({
      quantidade: i.quantidade,
      precoCheio: i.produto_id ? (precoCheioPorProduto?.[i.produto_id] ?? i.preco_unitario) : i.preco_unitario,
      precoPraticado: i.preco_unitario,
    })))
  }
  // A estratégia só entra em cena quando há promoção de verdade — sem
  // diferença entre cheio e praticado, mostrar "desconto de 0%" seria ruído.
  const aplicaEstrategia = (o: Orcamento) => estrategiaLigada && vitrineDe(o).temPromo

  // Condições que valem de fato. Se a estratégia está ligada e ninguém abriu
  // o modal ainda, o desconto da promoção já vale — senão o orçamento sairia
  // com preço cheio e sem o desconto correspondente, que é pior que não ter
  // a estratégia.
  function condicoesEfetivas(o: Orcamento): CondicoesOrcamento {
    const salvas = condicoesDe(o)
    if (!aplicaEstrategia(o) || salvas.descontoAvistaPct > 0) return salvas
    return {
      ...salvas,
      descontoAvistaPct: vitrineDe(o).descontoPct,
      avistaFormas: salvas.avistaFormas.length > 0 ? salvas.avistaFormas : formasDaEstrategia,
    }
  }

  // Preço e total que o cliente enxerga.
  const precoExibido = (o: Orcamento, i: OrcItem) =>
    aplicaEstrategia(o) && i.produto_id
      ? Math.max(precoCheioPorProduto?.[i.produto_id] ?? i.preco_unitario, i.preco_unitario)
      : i.preco_unitario
  const totalItemExibido = (o: Orcamento, i: OrcItem) => precoExibido(o, i) * i.quantidade
  const totalExibido = (o: Orcamento) => aplicaEstrategia(o) ? vitrineDe(o).totalCheio : o.total

  function abrirWhatsapp(o: Orcamento) {
    const mensagem = montarMensagemOrcamento({
      numero: o.numero,
      empresaNome,
      clienteNome: o.cliente_nome ?? o.clientes?.nome ?? null,
      itens: (o.orcamento_itens ?? []).map(i => ({
        produto_nome: i.produto_nome,
        quantidade: i.quantidade,
        preco_unitario: precoExibido(o, i),
        total: totalItemExibido(o, i),
      })),
      total: totalExibido(o),
      validade: o.validade,
      condicoes: condicoesEfetivas(o),
    })
    setWppPayload({
      telefone: o.clientes?.telefone ?? '',
      mensagem,
      tipo: 'orcamento',
      cliente_nome: o.cliente_nome ?? o.clientes?.nome ?? null,
      referencia_tipo: 'orcamento',
      referencia_id: o.id,
    })
    setWppAberto(true)
  }

  // Marca o envio — separa "montei um orçamento" de "mandei para o cliente",
  // que é a diferença entre papel na gaveta e proposta viva.
  async function marcarEnviado(id: string) {
    const agora = new Date().toISOString()
    await sb.from('orcamentos').update({ enviado_em: agora }).eq('id', id)
    setLista(p => p.map(o => o.id === id ? { ...o, enviado_em: agora } : o))
    setSelecionado(p => p && p.id === id ? { ...p, enviado_em: agora } : p)
  }

  function imprimir() { window.print() }

  const filtrado = lista.filter(o => {
    const matchStatus = filtroStatus === 'todos' || o.status === filtroStatus
    const q = filtroBusca.toLowerCase()
    const matchBusca = !q || String(o.numero).includes(q) ||
      (o.cliente_nome ?? '').toLowerCase().includes(q) ||
      (o.observacao ?? '').toLowerCase().includes(q)
    return matchStatus && matchBusca
  })

  async function alterarStatus(id: string, status: string) {
    setAtualizando(true)
    await sb.from('orcamentos').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setLista(p => p.map(o => o.id === id ? { ...o, status } : o))
    if (selecionado?.id === id) setSelecionado(p => p ? { ...p, status } : p)
    setAtualizando(false)
  }

  async function excluir(id: string) {
    if (!confirm('Excluir este orçamento?')) return
    await sb.from('orcamentos').delete().eq('id', id)
    setLista(p => p.filter(o => o.id !== id))
    if (selecionado?.id === id) setSelecionado(null)
  }

  const vencido = (o: Orcamento) => o.validade && o.status === 'aberto' && new Date(o.validade) < new Date()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'rgb(252,251,248)' }}>

      {/* ── LISTA ───────────────────────────────────────────────── */}
      <div className={`flex flex-col border-r border-gray-200 bg-white ${selecionado ? 'w-96 flex-shrink-0' : 'flex-1'}`}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Orçamentos</h1>
            <button onClick={() => router.push('/pdv')}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded-lg">
              + Novo no PDV
            </button>
          </div>
          <input value={filtroBusca} onChange={e => setFiltroBusca(e.target.value)}
            placeholder="Buscar por número, cliente..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 mb-2" />
          <div className="flex gap-1">
            {['todos', 'aberto', 'aprovado', 'cancelado', 'convertido'].map(s => (
              <button key={s} onClick={() => setFiltroStatus(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${filtroStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {s === 'todos' ? 'Todos' : STATUS_LABEL[s]?.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filtrado.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
              <span className="text-4xl">📋</span>
              <p className="text-sm">Nenhum orçamento encontrado</p>
            </div>
          ) : (
            filtrado.map(o => (
              <div key={o.id} onClick={() => setSelecionado(o.id === selecionado?.id ? null : o)}
                className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${o.id === selecionado?.id ? 'bg-amber-50 border-l-2 border-l-amber-400' : 'hover:bg-gray-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-sm">#{o.numero}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_LABEL[o.status]?.cor}`}>
                        {STATUS_LABEL[o.status]?.label}
                      </span>
                      {vencido(o) && <span className="text-xs text-red-500 font-medium">vencido</span>}
                    </div>
                    <p className="text-sm text-gray-600 truncate mt-0.5">
                      {o.cliente_nome ?? o.clientes?.nome ?? 'Consumidor'}
                    </p>
                    <p className="text-xs text-gray-400">{fmtDateTime(o.created_at)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-900">{fmt(o.total)}</p>
                    <p className="text-xs text-gray-400">{o.orcamento_itens.length} itens</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── DETALHE ─────────────────────────────────────────────── */}
      {selecionado && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6 space-y-5 print-orcamento">
            {/* Header detalhe */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-gray-900">Orçamento #{selecionado.numero}</h2>
                  <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_LABEL[selecionado.status]?.cor}`}>
                    {STATUS_LABEL[selecionado.status]?.label}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1">{fmtDateTime(selecionado.created_at)}</p>
              </div>
              <button onClick={() => setSelecionado(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            {/* Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">Cliente</p>
                <p className="font-medium text-gray-900">{selecionado.cliente_nome ?? selecionado.clientes?.nome ?? 'Consumidor'}</p>
                {selecionado.clientes?.telefone && <p className="text-xs text-gray-500">{selecionado.clientes.telefone}</p>}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">Validade</p>
                <p className={`font-medium ${vencido(selecionado) ? 'text-red-600' : 'text-gray-900'}`}>
                  {selecionado.validade ? fmtDate(selecionado.validade) : 'Sem prazo'}
                  {vencido(selecionado) && ' (vencido)'}
                </p>
                <p className="text-xs text-gray-500">Operador: {selecionado.operador_nome?.split('@')[0]}</p>
              </div>
            </div>

            {/* Itens */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2">Produto</th>
                    <th className="text-center px-2 py-2 w-16">Qtd</th>
                    <th className="text-right px-2 py-2 w-24">Preço</th>
                    <th className="text-center px-2 py-2 w-16">Desc%</th>
                    <th className="text-right px-4 py-2 w-24">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selecionado.orcamento_itens.map(item => {
                    const emPromo = aplicaEstrategia(selecionado) && precoExibido(selecionado, item) > item.preco_unitario
                    return (
                      <tr key={item.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2 font-medium text-gray-900">
                          {item.produto_nome}
                          {emPromo && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold print:hidden">
                              promoção no desconto à vista
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center text-gray-600">{item.quantidade}</td>
                        <td className="px-2 py-2 text-right text-gray-600">{fmt(precoExibido(selecionado, item))}</td>
                        <td className="px-2 py-2 text-center text-gray-500">{item.desconto > 0 ? `${item.desconto}%` : '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmt(totalItemExibido(selecionado, item))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Totais */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span>
                <span>{fmt(aplicaEstrategia(selecionado) ? vitrineDe(selecionado).totalCheio : selecionado.subtotal)}</span>
              </div>
              {selecionado.desconto > 0 && !aplicaEstrategia(selecionado) && (
                <div className="flex justify-between text-sm text-orange-600">
                  <span>Desconto</span><span>−{fmt(selecionado.desconto)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg border-t border-gray-100 pt-2 mt-2">
                <span>Total</span><span className="text-blue-700">{fmt(totalExibido(selecionado))}</span>
              </div>
              {aplicaEstrategia(selecionado) && (
                <p className="text-xs text-gray-500 pt-1 print:hidden">
                  Preço cheio de tabela. A promoção ({vitrineDe(selecionado).descontoPct}%) aparece abaixo,
                  nas condições de pagamento — o cliente paga {fmt(vitrineDe(selecionado).totalPraticado)} à vista.
                </p>
              )}
            </div>

            {/* Condições de pagamento — o que o cliente vê */}
            <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 print:break-inside-avoid">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-green-900">Condições de pagamento</p>
                <button onClick={() => setCondicionando(selecionado)}
                  className="text-xs text-green-700 hover:text-green-900 underline print:hidden">
                  {temCondicoes(condicoesEfetivas(selecionado)) ? 'alterar' : 'definir'}
                </button>
              </div>
              {temCondicoes(condicoesEfetivas(selecionado)) ? (
                <>
                  <ul className="mt-2 space-y-1">
                    {linhasCondicoes(totalExibido(selecionado), condicoesEfetivas(selecionado)).map((l, i) => (
                      <li key={i} className="text-sm text-green-900">✅ {l}</li>
                    ))}
                  </ul>
                  {aplicaEstrategia(selecionado) && condicoesDe(selecionado).descontoAvistaPct === 0 && (
                    <p className="text-[11px] text-green-700 mt-2 print:hidden">
                      Desconto calculado da promoção dos produtos. Abra "alterar" para ajustar ou
                      acrescentar parcelamento.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-green-700 mt-1">
                  Nenhuma ainda. Desconto à vista e parcelamento são o que fazem o cliente fechar —
                  vale definir antes de enviar.
                </p>
              )}
            </div>

            {/* Saúde do orçamento — só para dentro de casa */}
            {(() => {
              const s = saudeDo(selecionado)
              const r = s.resultado
              // Sem faixa configurada que case com a margem, mostra em
              // cinza em vez de inventar uma cor que sugira aprovação.
              const cor = r.faixa?.cor ?? '#9ca3af'
              return (
                <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 print:hidden">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">Saúde do orçamento</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: `${cor}22`, color: cor }}>
                        {r.faixa ? `${r.faixa.emoji} ${r.faixa.nome}` : 'sem faixa definida'}
                      </span>
                    </div>
                    <p className="text-sm">
                      <span className="text-gray-500">Sobra </span>
                      <span className="font-semibold" style={{ color: cor }}>
                        {fmt(r.lucroLiquido)} ({r.margem.toFixed(1)}%)
                      </span>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
                    <Bloco rotulo="Custo dos produtos" valor={fmt(r.custoTotal)} />
                    <Bloco rotulo={`Taxa (${s.parcelas > 1 ? `crédito ${s.parcelas}x` : 'Pix/dinheiro'})`} valor={fmt(r.custoTaxaPag)} />
                    <Bloco rotulo="Imposto + operacional" valor={fmt(r.custoImposto + r.custoOperacional)} />
                    <Bloco rotulo="Comissão" valor={fmt(r.custoComissao)} />
                  </div>

                  {condicoesDe(selecionado).descontoAvistaPct > 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Se o cliente pagar à vista, entra {fmt(totalAvista(selecionado.total, condicoesDe(selecionado)))} —
                      {' '}{fmt(selecionado.total - totalAvista(selecionado.total, condicoesDe(selecionado)))} a menos,
                      compensado por não ter taxa de cartão.
                    </p>
                  )}
                  {s.semCusto && (
                    <p className="text-xs text-amber-700 mt-2">
                      ⚠ Algum item está sem custo cadastrado — o lucro mostrado está otimista.
                    </p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1">
                    Usa o custo de hoje dos produtos, não o do dia em que o orçamento foi montado.
                  </p>
                </div>
              )
            })()}

            {selecionado.observacao && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-xs text-amber-700 font-medium mb-1">Observação</p>
                <p className="text-sm text-gray-700">{selecionado.observacao}</p>
              </div>
            )}

            {/* Ações */}
            <div className="flex gap-2 flex-wrap print:hidden">
              <button onClick={() => abrirWhatsapp(selecionado)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">
                💬 Enviar por WhatsApp
              </button>
              <button onClick={() => setCondicionando(selecionado)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg">
                💰 Condições de pagamento
              </button>
              <button onClick={imprimir}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg">
                🖨 Imprimir
              </button>
              {selecionado.status !== 'convertido' && (
                <button onClick={() => setEditando(selecionado)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
                  ✏ Editar
                </button>
              )}
              {selecionado.status === 'aberto' && (
                <>
                  <button onClick={() => alterarStatus(selecionado.id, 'aprovado')} disabled={atualizando}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">
                    ✓ Aprovar
                  </button>
                  <button onClick={() => alterarStatus(selecionado.id, 'cancelado')} disabled={atualizando}
                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded-lg">
                    Cancelar
                  </button>
                </>
              )}
              {selecionado.status === 'aprovado' && (
                <button onClick={() => router.push('/pdv')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
                  Converter em venda (PDV)
                </button>
              )}
              {selecionado.status !== 'aberto' && (
                <button onClick={() => alterarStatus(selecionado.id, 'aberto')} disabled={atualizando}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg">
                  Reabrir
                </button>
              )}
              <button onClick={() => excluir(selecionado.id)}
                className="px-4 py-2 border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium rounded-lg ml-auto">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <EditarOrcamentoModal
          empresaId={empresaId}
          orcamento={editando}
          onClose={() => setEditando(null)}
          onSalvo={() => { setEditando(null); router.refresh() }}
        />
      )}

      {condicionando && (
        <CondicoesOrcamentoModal
          orcamentoId={condicionando.id}
          total={totalExibido(condicionando)}
          // Já chega com o desconto da promoção preenchido quando a
          // estratégia está ligada — é exatamente o que ela promete.
          inicial={condicoesEfetivas(condicionando)}
          dicaPromo={aplicaEstrategia(condicionando)
            ? `${vitrineDe(condicionando).descontoPct}% vem da promoção dos produtos (de ${fmt(vitrineDe(condicionando).totalCheio)} para ${fmt(vitrineDe(condicionando).totalPraticado)}).`
            : undefined}
          onFechar={() => setCondicionando(null)}
          onSalvo={c => {
            const patch = {
              desconto_avista_pct: c.descontoAvistaPct,
              avista_formas: c.avistaFormas,
              parcelas_max: c.parcelasMax,
              parcelas_sem_juros: c.parcelasSemJuros,
              condicoes_observacao: c.observacao,
            }
            setLista(p => p.map(o => o.id === condicionando.id ? { ...o, ...patch } : o))
            setSelecionado(p => p && p.id === condicionando.id ? { ...p, ...patch } : p)
          }}
        />
      )}

      {wppAberto && wppPayload && (
        <EnviarWhatsAppModal
          aberto={wppAberto}
          titulo="Enviar orçamento por WhatsApp"
          payload={wppPayload}
          onChange={setWppPayload}
          onClose={() => setWppAberto(false)}
          onEnviado={() => { if (selecionado) marcarEnviado(selecionado.id) }}
        />
      )}

      {/* Na impressão sai só a ficha do orçamento — lista lateral, filtros e
          painel de saúde ficam de fora. Saúde é número de dentro de casa e
          jamais pode sair numa folha entregue ao cliente. */}
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .print-orcamento, .print-orcamento * { visibility: visible; }
          .print-orcamento { position: absolute; left: 0; top: 0; width: 100%; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  )
}

function Bloco({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
      <p className="text-[11px] text-gray-500">{rotulo}</p>
      <p className="text-sm font-medium text-gray-800 mt-0.5">{valor}</p>
    </div>
  )
}
