'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { STATUS, TIPO, ABERTOS, rotulo, FLUXO } from '@/lib/faltas/status'

// Faltas e encomendas do balcão.
//
// Duas decisões de tela que não são estética:
//
// 1. A visão padrão é POR PRODUTO, não por solicitação. Sete pessoas pedindo
//    a mesma furadeira são um sinal de compra; sete linhas soltas numa lista
//    são sete linhas soltas numa lista. Mas o agrupamento é só na leitura —
//    cada solicitação continua guardada inteira, com sua data e seu cliente,
//    porque "5 clientes diferentes desde 03/08" é justamente o que se perde
//    quando se agrupa na hora de gravar.
//
// 2. Encomenda aparece separada da falta, sempre. Falta é sinal de demanda;
//    encomenda é uma pessoa esperando, às vezes com prazo prometido e preço
//    combinado. Misturar as duas numa lista de reposição é o jeito mais
//    rápido de deixar um cliente sem resposta.

type Falta = {
  id: string
  produto_id: string | null
  produto_nome: string
  produto_sku: string | null
  cliente_nome: string | null
  cliente_telefone: string | null
  quantidade_solicitada: number
  quantidade_atendida: number
  observacao: string | null
  status: string
  tipo: 'falta' | 'encomenda'
  origem: string | null
  usuario_nome: string | null
  prazo_desejado: string | null
  preco_negociado: number | null
  created_at: string
  updated_at: string | null
  estoqueAtual: number | null
  custo: number
  categoria: string | null
  fornecedor: string | null
  noPedido: string | null
  chegou_em?: string | null
  aviso_whatsapp_em?: string | null
  aviso_whatsapp_erro?: string | null
  aviso_whatsapp_tentativas?: number | null
}

/** Produto abaixo do estoque mínimo. Não é registro: calculado na hora. */
type Automatico = {
  produtoId: string
  nome: string
  sku: string | null
  estoque: number
  minimo: number
  sugestao: number
  custo: number
  fornecedor: string | null
  noPedido: string | null
}

type Origem = '' | 'vendedor' | 'automatico' | 'com_estoque'

type Grupo = {
  chave: string
  nome: string
  sku: string | null
  produtoId: string | null
  itens: Falta[]
  solicitacoes: number
  clientes: number
  quantidade: number
  primeira: string
  ultima: string
  temEncomenda: boolean
  prazoMaisProximo: string | null
  estoqueAtual: number | null
  custo: number
  fornecedor: string | null
  noPedido: string | null
  automatico: Automatico | null
}

const dataCurta = (v: string) =>
  new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

const dataHora = (v: string) =>
  new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function diasDesde(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function whatsapp(telefone: string, produto: string) {
  const num = telefone.replace(/\D/g, '')
  const msg = encodeURIComponent(`Olá! Sobre o produto "${produto}" que você procurou na loja — já temos disponível.`)
  return `https://wa.me/${num.length > 11 ? num : '55' + num}?text=${msg}`
}

export default function FaltasClient({ faltas, automaticos, erro, limite }: {
  faltas: Falta[]
  automaticos: Automatico[]
  erro: string | null
  limite: number
}) {
  const router = useRouter()
  const [visao, setVisao] = useState<'produto' | 'solicitacao'>('produto')
  const [filtroTipo, setFiltroTipo] = useState<'' | 'falta' | 'encomenda'>('')
  const [filtroStatus, setFiltroStatus] = useState<string>('abertos')
  const [filtroOrigem, setFiltroOrigem] = useState<Origem>('')
  const [busca, setBusca] = useState('')
  const [expandido, setExpandido] = useState<Set<string>>(new Set())
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')

  const autoPorProduto = useMemo(() => new Map(automaticos.map(a => [a.produtoId, a])), [automaticos])

  const filtradas = useMemo(() => faltas.filter(f => {
    if (filtroTipo && f.tipo !== filtroTipo) return false
    if (filtroStatus === 'abertos' && !ABERTOS.includes(f.status)) return false
    if (filtroStatus !== 'abertos' && filtroStatus !== '' && f.status !== filtroStatus) return false
    if (busca) {
      const t = busca.toLowerCase()
      const alvo = `${f.produto_nome} ${f.produto_sku ?? ''} ${f.cliente_nome ?? ''} ${f.observacao ?? ''} ${f.fornecedor ?? ''}`.toLowerCase()
      if (!alvo.includes(t)) return false
    }
    if (filtroOrigem === 'automatico' && !(f.produto_id && autoPorProduto.has(f.produto_id))) return false
    if (filtroOrigem === 'com_estoque' && !((f.estoqueAtual ?? 0) > 0)) return false
    return true
  }), [faltas, filtroTipo, filtroStatus, busca, filtroOrigem, autoPorProduto])

  const grupos = useMemo<Grupo[]>(() => {
    const mapa = new Map<string, Grupo>()
    for (const f of filtradas) {
      // Sem produto no cadastro, o nome digitado é a única identidade que
      // existe. Vale agrupar mesmo assim: "aquele parafuso que ninguém acha"
      // pedido cinco vezes continua sendo cinco pedidos do mesmo item.
      const chave = f.produto_id ?? `nome:${f.produto_nome.trim().toLowerCase()}`
      let g = mapa.get(chave)
      if (!g) {
        g = {
          chave, nome: f.produto_nome, sku: f.produto_sku, produtoId: f.produto_id,
          itens: [], solicitacoes: 0, clientes: 0, quantidade: 0,
          primeira: f.created_at, ultima: f.created_at,
          temEncomenda: false, prazoMaisProximo: null,
          estoqueAtual: f.estoqueAtual, custo: f.custo,
          fornecedor: f.fornecedor, noPedido: f.noPedido,
          automatico: f.produto_id ? (autoPorProduto.get(f.produto_id) ?? null) : null,
        }
        mapa.set(chave, g)
      }
      g.itens.push(f)
      g.solicitacoes++
      g.quantidade += f.quantidade_solicitada
      if (f.created_at < g.primeira) g.primeira = f.created_at
      if (f.created_at > g.ultima) g.ultima = f.created_at
      if (f.tipo === 'encomenda') g.temEncomenda = true
      if (f.prazo_desejado && (!g.prazoMaisProximo || f.prazo_desejado < g.prazoMaisProximo)) {
        g.prazoMaisProximo = f.prazo_desejado
      }
    }
    // Abaixo do mínimo sem nenhuma falta anotada: linha só "Automático".
    // Não tem status nem cliente, então só entra nas visões em que caberia
    // uma falta pendente.
    const autoCabe = filtroTipo !== 'encomenda' && ['abertos', '', 'pendente'].includes(filtroStatus)
    if (autoCabe) {
      const t = busca.toLowerCase()
      for (const a of automaticos) {
        if (mapa.has(a.produtoId)) continue
        if (t && !`${a.nome} ${a.sku ?? ''} ${a.fornecedor ?? ''}`.toLowerCase().includes(t)) continue
        mapa.set(a.produtoId, {
          chave: a.produtoId, nome: a.nome, sku: a.sku, produtoId: a.produtoId,
          itens: [], solicitacoes: 0, clientes: 0, quantidade: 0,
          primeira: '', ultima: '', temEncomenda: false, prazoMaisProximo: null,
          estoqueAtual: a.estoque, custo: a.custo,
          fornecedor: a.fornecedor, noPedido: a.noPedido, automatico: a,
        })
      }
    }
    for (const g of mapa.values()) {
      const pessoas = new Set(
        g.itens.map(i => (i.cliente_nome || i.cliente_telefone || '').trim().toLowerCase()).filter(Boolean)
      )
      g.clientes = pessoas.size
    }
    // Encomenda na frente — tem gente esperando. Depois, o que o balcão mais
    // pediu; por último o que só está abaixo do mínimo.
    return [...mapa.values()]
      .filter(g => filtroOrigem === '' || filtroOrigem === 'com_estoque'
        || (filtroOrigem === 'vendedor' ? g.itens.length > 0 : g.automatico !== null))
      .filter(g => filtroOrigem !== 'com_estoque' || g.itens.length > 0)
      .sort((a, b) => {
        if (a.temEncomenda !== b.temEncomenda) return a.temEncomenda ? -1 : 1
        if (b.solicitacoes !== a.solicitacoes) return b.solicitacoes - a.solicitacoes
        if (a.itens.length === 0 && b.itens.length === 0) return a.nome.localeCompare(b.nome, 'pt-BR')
        return b.ultima.localeCompare(a.ultima)
      })
  }, [filtradas, automaticos, autoPorProduto, filtroTipo, filtroStatus, filtroOrigem, busca])

  const kpi = useMemo(() => {
    const abertas = faltas.filter(f => ABERTOS.includes(f.status))
    return {
      encomendas: abertas.filter(f => f.tipo === 'encomenda').length,
      faltas: abertas.filter(f => f.tipo === 'falta').length,
      produtos: new Set(abertas.map(f => f.produto_id ?? f.produto_nome.toLowerCase())).size,
      chegaram: faltas.filter(f => f.status === 'recebido').length,
      semCadastro: abertas.filter(f => !f.produto_id).length,
      abaixoMinimo: automaticos.length,
    }
  }, [faltas, automaticos])

  // As abertas (exceto "Chegou") de produto que já tem estoque: candidatas a
  // fechar. Não fecham sozinhas porque há falta anotada com estoque baixo
  // mas positivo — quem decide é o comprador.
  const idsComEstoque = useMemo(() => faltas
    .filter(f => ABERTOS.includes(f.status) && f.status !== 'recebido' && (f.estoqueAtual ?? 0) > 0)
    .map(f => f.id), [faltas])

  function alternarExpandido(chave: string) {
    setExpandido(prev => {
      const n = new Set(prev)
      if (n.has(chave)) n.delete(chave); else n.add(chave)
      return n
    })
  }

  function alternarSelecao(ids: string[]) {
    setSelecionados(prev => {
      const n = new Set(prev)
      const todosDentro = ids.every(i => n.has(i))
      for (const i of ids) { if (todosDentro) n.delete(i); else n.add(i) }
      return n
    })
  }

  async function mudarStatus(ids: string[], status: string) {
    if (ids.length === 0) return
    setOcupado(true); setAviso('')
    try {
      const d = await fetch('/api/faltas/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status }),
      }).then(r => r.json())
      if (!d.ok) { setAviso(d.erro ?? 'Não foi possível atualizar.'); return }
      setSelecionados(new Set())
      setAviso(
        status === 'recebido'
          ? `${d.alteradas} marcada(s) como "chegou". As com telefone recebem o aviso por WhatsApp (se a automação estiver ligada); as sem cliente já foram fechadas.`
          : `${d.alteradas} solicitação(ões) atualizada(s).`
      )
      router.refresh()
    } catch {
      setAviso('Falha de rede.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>auxiliar de compras</span><span>›</span>
        <span className="text-gray-600 font-medium">faltas e encomendas</span>
      </div>

      <div className="mb-5">
        <h1 className="text-gray-900 text-xl font-semibold">Faltas e Encomendas</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          O que os clientes procuraram e a loja não tinha. Anotado no balcão, pelo vendedor.
        </p>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Não foi possível carregar as solicitações: {erro}
        </div>
      )}

      {/* ── Indicadores ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3 mb-5">
        <Cartao valor={kpi.encomendas} label="Encomendas abertas" destaque={kpi.encomendas > 0} />
        <Cartao valor={kpi.faltas} label="Faltas abertas" />
        <Cartao valor={kpi.produtos} label="Produtos diferentes" />
        <Cartao valor={kpi.chegaram} label="Chegaram — avisar cliente" destaque={kpi.chegaram > 0} />
        <Cartao valor={kpi.abaixoMinimo} label="Abaixo do mínimo (automático)" />
        <Cartao valor={kpi.semCadastro} label="Sem produto no cadastro" />
      </div>

      {idsComEstoque.length > 0 && filtroOrigem !== 'com_estoque' && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm text-amber-800">
          <span>
            <strong>{idsComEstoque.length}</strong> falta(s) aberta(s) de produtos que <strong>já têm estoque</strong>.
            Daqui em diante a nota de entrada fecha sozinha; estas são de antes.
          </span>
          <button onClick={() => setFiltroOrigem('com_estoque')}
            className="ml-auto px-3 py-1 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700">
            Conferir
          </button>
        </div>
      )}

      {/* ── Filtros ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex w-full sm:w-auto sm:inline-flex rounded-lg border border-slate-200 overflow-hidden">
          <button onClick={() => setVisao('produto')}
            className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 text-xs font-medium ${visao === 'produto' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            Por produto
          </button>
          <button onClick={() => setVisao('solicitacao')}
            className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 text-xs font-medium ${visao === 'solicitacao' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            Cada solicitação
          </button>
        </div>

        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as '' | 'falta' | 'encomenda')}
          className="flex-1 sm:flex-none min-w-[30%] sm:min-w-0 rounded-lg border border-slate-200 px-2 sm:px-2.5 py-2 sm:py-1.5 text-xs">
          <option value="">Falta e encomenda</option>
          <option value="encomenda">Só encomendas</option>
          <option value="falta">Só faltas</option>
        </select>

        <select value={filtroOrigem} onChange={e => setFiltroOrigem(e.target.value as Origem)}
          className="flex-1 sm:flex-none min-w-[30%] sm:min-w-0 rounded-lg border border-slate-200 px-2 sm:px-2.5 py-2 sm:py-1.5 text-xs">
          <option value="">Vendedor e automático</option>
          <option value="vendedor">👤 Anotadas pelo vendedor</option>
          <option value="automatico">🤖 Abaixo do mínimo</option>
          <option value="com_estoque">📦 Já têm estoque</option>
        </select>

        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="flex-1 sm:flex-none min-w-[30%] sm:min-w-0 rounded-lg border border-slate-200 px-2 sm:px-2.5 py-2 sm:py-1.5 text-xs">
          <option value="abertos">Em aberto</option>
          <option value="">Todos os status</option>
          {FLUXO.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
          <option value="cancelado">Cancelado</option>
        </select>

        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar produto, fornecedor, cliente ou observação..."
          className="rounded-lg border border-slate-200 px-3 py-2 sm:py-1.5 text-sm sm:text-xs basis-full sm:basis-auto flex-1 min-w-0 sm:min-w-[200px]" />

        <span className="text-xs text-slate-400">
          {visao === 'produto'
            ? `${grupos.length} produto${grupos.length !== 1 ? 's' : ''}`
            : `${filtradas.length} solicitaç${filtradas.length !== 1 ? 'ões' : 'ão'}`}
        </span>
      </div>

      {aviso && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
          {aviso}
        </div>
      )}

      {filtroOrigem === 'com_estoque' && idsComEstoque.length > 0 && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm text-emerald-800">
          <span>Confira a lista. As que já foram repostas podem ser fechadas de uma vez (ou selecione só algumas).</span>
          <button disabled={ocupado}
            onClick={() => { if (confirm(`Marcar ${idsComEstoque.length} falta(s) como Atendido?`)) mudarStatus(idsComEstoque, 'atendido') }}
            className="ml-auto px-3 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
            Fechar todas ({idsComEstoque.length})
          </button>
        </div>
      )}

      {selecionados.size > 0 && (
        <div className="mb-4 sticky bottom-2 z-10 rounded-lg border border-slate-300 bg-white shadow-lg sm:shadow-none sm:static px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">{selecionados.size} selecionada(s)</span>
          <span className="text-slate-400">→</span>
          {FLUXO.slice(1).concat('cancelado').map(s => (
            <button key={s} disabled={ocupado}
              onClick={() => mudarStatus([...selecionados], s)}
              title={STATUS[s].ajuda}
              className={`px-2.5 py-1 rounded-md text-xs font-medium disabled:opacity-50 ${STATUS[s].cor} hover:brightness-95`}>
              {STATUS[s].label}
            </button>
          ))}
          <button onClick={() => setSelecionados(new Set())}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600">limpar</button>
        </div>
      )}

      {faltas.length >= limite && (
        <p className="mb-3 text-xs text-amber-700">
          Mostrando as {limite} solicitações mais recentes. Há mais no banco.
        </p>
      )}

      {/* ── Lista ───────────────────────────────────────────────── */}
      {(visao === 'produto' ? grupos.length === 0 : filtradas.length === 0) ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-slate-500 text-sm">Nenhuma solicitação com esses filtros.</p>
          {faltas.length === 0 && automaticos.length === 0 && (
            <p className="text-slate-400 text-xs mt-2">
              As faltas são anotadas pelo vendedor no PDV do balcão, na busca de produto.
            </p>
          )}
        </div>
      ) : visao === 'produto' ? (
        <div className="space-y-2">
          {grupos.map(g => (
            <GrupoLinha key={g.chave} grupo={g}
              aberto={expandido.has(g.chave)}
              onAlternar={() => alternarExpandido(g.chave)}
              selecionados={selecionados}
              onSelecionar={alternarSelecao}
              onStatus={mudarStatus}
              ocupado={ocupado} />
          ))}
        </div>
      ) : (
        <>
        <div className="sm:hidden space-y-2">
          {filtradas.map(f => <SolicitacaoCartao key={f.id} f={f} selecionado={selecionados.has(f.id)} onSelecionar={() => alternarSelecao([f.id])} />)}
        </div>
        <div className="hidden sm:block rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="text-left px-3 py-2 font-medium">Produto</th>
                <th className="text-left px-3 py-2 font-medium">Tipo</th>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-right px-3 py-2 font-medium">Qtd</th>
                <th className="text-right px-3 py-2 font-medium">Estoque</th>
                <th className="text-left px-3 py-2 font-medium">Vendedor</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(f => (
                <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selecionados.has(f.id)}
                      onChange={() => alternarSelecao([f.id])} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{f.produto_nome}</div>
                    {f.produto_sku && <div className="text-[11px] text-slate-400">{f.produto_sku}</div>}
                    {f.observacao && <div className="text-[11px] text-slate-500 italic">{f.observacao}</div>}
                  </td>
                  <td className="px-3 py-2"><EtiquetaTipo tipo={f.tipo} /></td>
                  <td className="px-3 py-2">
                    {f.cliente_nome || f.cliente_telefone ? (
                      <>
                        <div className="text-slate-700">{f.cliente_nome ?? '—'}</div>
                        {f.cliente_telefone && (
                          <a href={whatsapp(f.cliente_telefone, f.produto_nome)} target="_blank" rel="noreferrer"
                            className="text-[11px] text-emerald-600 hover:underline">
                            {f.cliente_telefone}
                          </a>
                        )}
                      </>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{f.quantidade_solicitada}</td>
                  <td className="px-3 py-2 text-right"><Estoque valor={f.estoqueAtual} /></td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">{f.usuario_nome ?? '—'}</td>
                  <td className="px-3 py-2"><EtiquetaStatus status={f.status} /><AvisoWhatsapp f={f} /></td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">{dataHora(f.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  )
}

// ── Peças ──────────────────────────────────────────────────────

function Cartao({ valor, label, destaque = false }: { valor: number; label: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3 ${destaque && valor > 0 ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-white'}`}>
      <div className={`text-2xl font-semibold ${destaque && valor > 0 ? 'text-orange-700' : 'text-slate-800'}`}>{valor}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function EtiquetaTipo({ tipo }: { tipo: 'falta' | 'encomenda' }) {
  const t = TIPO[tipo]
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${t.cor}`}>
      {t.icone} {t.label}
    </span>
  )
}

function EtiquetaStatus({ status }: { status: string }) {
  const s = rotulo(status)
  return (
    <span title={s.ajuda}
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${s.cor}`}>
      {s.label}
    </span>
  )
}

/**
 * Resultado do aviso automático por WhatsApp (automação "Avisar cliente
 * quando a falta chegar"). Sem nada aqui numa falta "Chegou", o aviso ainda
 * não saiu — ou a regra está desligada, ou não há telefone: o vendedor avisa.
 */
function AvisoWhatsapp({ f }: { f: Falta }) {
  if (f.aviso_whatsapp_em) {
    return (
      <span className="block text-[11px] text-emerald-700" title="Aviso automático enviado ao cliente">
        📲 avisado {dataHora(f.aviso_whatsapp_em)}
      </span>
    )
  }
  if (f.aviso_whatsapp_erro && f.status === 'recebido') {
    return (
      <span className="block text-[11px] text-red-600" title={f.aviso_whatsapp_erro}>
        ⚠ aviso não enviado{(f.aviso_whatsapp_tentativas ?? 0) >= 3 ? ' — avise pelo balcão' : ', tentando de novo'}
      </span>
    )
  }
  return null
}

/** Estoque atual do produto pedido — sem isso a linha não vira decisão. */
function Estoque({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-slate-300 text-[11px]">sem cadastro</span>
  if (valor <= 0) return <span className="text-red-600 font-semibold">{valor}</span>
  return <span className="text-slate-700">{valor}</span>
}

/** "Cada solicitação" no celular: a tabela de 9 colunas não cabe — vira cartão. */
function SolicitacaoCartao({ f, selecionado, onSelecionar }: { f: Falta; selecionado: boolean; onSelecionar: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 flex items-start gap-3">
      <input type="checkbox" className="mt-1 w-4 h-4" checked={selecionado} onChange={onSelecionar} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-slate-800 break-words">{f.produto_nome}</p>
            {f.produto_sku && <p className="text-[11px] text-slate-400">{f.produto_sku}</p>}
          </div>
          <EtiquetaStatus status={f.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
          <EtiquetaTipo tipo={f.tipo} />
          <span className="whitespace-nowrap"><strong className="text-slate-800">{f.quantidade_solicitada}</strong> un pedida(s)</span>
          <span className="whitespace-nowrap">Estoque: <Estoque valor={f.estoqueAtual} /></span>
        </div>
        {(f.cliente_nome || f.cliente_telefone) && (
          <div className="text-[12px] text-slate-700">
            👤 {f.cliente_nome ?? '—'}
            {f.cliente_telefone && (
              <a href={whatsapp(f.cliente_telefone, f.produto_nome)} target="_blank" rel="noreferrer"
                className="ml-2 text-emerald-600 hover:underline">{f.cliente_telefone}</a>
            )}
          </div>
        )}
        {f.observacao && <p className="text-[12px] text-slate-500 italic">{f.observacao}</p>}
        <AvisoWhatsapp f={f} />
        <p className="text-[11px] text-slate-400">{dataHora(f.created_at)} · {f.usuario_nome ?? 'vendedor não identificado'}</p>
      </div>
    </div>
  )
}

function GrupoLinha({ grupo, aberto, onAlternar, selecionados, onSelecionar, onStatus, ocupado }: {
  grupo: Grupo
  aberto: boolean
  onAlternar: () => void
  selecionados: Set<string>
  onSelecionar: (ids: string[]) => void
  onStatus: (ids: string[], status: string) => void
  ocupado: boolean
}) {
  const g = grupo
  const ids = g.itens.map(i => i.id)
  const todosSelecionados = ids.every(i => selecionados.has(i))
  const diasPrimeira = g.primeira ? diasDesde(g.primeira) : 0
  const temSolicitacoes = ids.length > 0

  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${g.temEncomenda ? 'border-orange-200' : 'border-slate-200'}`}>
      {/* No celular os botões descem para uma linha própria; ao lado do nome
          eles espremiam o cartão até cada palavra virar uma linha. */}
      <div className="flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-2 px-3 sm:px-4 py-3">
        <input type="checkbox" className="mt-1 w-4 h-4 sm:w-auto sm:h-auto" checked={temSolicitacoes && todosSelecionados}
          disabled={!temSolicitacoes} onChange={() => onSelecionar(ids)}
          title={temSolicitacoes ? undefined : 'Linha automática: monte o pedido em Pedido ao Fornecedor › Faltas'} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800 break-words">{g.nome}</span>
            {g.temEncomenda && <EtiquetaTipo tipo="encomenda" />}
            {g.itens.length > 0 && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600" title="Anotada pelo vendedor no balcão">
                👤 Vendedor
              </span>
            )}
            {g.automatico && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700"
                title="Estoque abaixo do mínimo cadastrado. Some sozinho quando o estoque volta.">
                🤖 Automático
              </span>
            )}
            {g.sku && <span className="text-[11px] text-slate-400">{g.sku}</span>}
            {!g.produtoId && (
              <span className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                não achou no cadastro
              </span>
            )}
          </div>

          {g.itens.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
            <span className="whitespace-nowrap"><strong className="text-slate-800">{g.solicitacoes}</strong> solicitaç{g.solicitacoes === 1 ? 'ão' : 'ões'}</span>
            {g.clientes > 0 && <span className="whitespace-nowrap"><strong className="text-slate-800">{g.clientes}</strong> cliente{g.clientes !== 1 ? 's' : ''} identificado{g.clientes !== 1 ? 's' : ''}</span>}
            <span className="whitespace-nowrap"><strong className="text-slate-800">{g.quantidade}</strong> unidade{g.quantidade !== 1 ? 's' : ''} pedida{g.quantidade !== 1 ? 's' : ''}</span>
            <span className="text-slate-500 whitespace-nowrap">
              de {dataCurta(g.primeira)} a {dataCurta(g.ultima)}
              {diasPrimeira > 0 && ` · há ${diasPrimeira} dia${diasPrimeira !== 1 ? 's' : ''}`}
            </span>
          </div>
          )}

          {g.automatico && (
            <div className="mt-1.5 text-[12px] text-purple-700">
              Abaixo do mínimo: estoque {g.automatico.estoque} · mínimo {g.automatico.minimo} ·
              sugestão <strong>{g.automatico.sugestao} un</strong>
            </div>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <span className="text-slate-600 whitespace-nowrap">
              Estoque hoje: <Estoque valor={g.estoqueAtual} />
            </span>
            {g.custo > 0 && (
              <span className="text-slate-500">
                custo {brl(g.custo)} · reposição estimada {brl(g.custo * Math.max(g.quantidade, g.automatico?.sugestao ?? 0))}
              </span>
            )}
            <span className={g.fornecedor ? 'text-slate-600' : 'text-slate-400'}>
              🏭 {g.fornecedor ?? 'sem fornecedor'}
            </span>
            {g.noPedido && (
              <span className="text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded font-medium">no pedido #{g.noPedido}</span>
            )}
            {g.prazoMaisProximo && (
              <span className="text-orange-700 font-medium">
                prometido para {new Date(g.prazoMaisProximo + 'T00:00:00').toLocaleDateString('pt-BR')}
              </span>
            )}
          </div>
        </div>

        {temSolicitacoes && (
        <div className="w-full sm:w-auto pl-7 sm:pl-0 flex flex-col items-stretch sm:items-end gap-1.5 shrink-0">
          <div className="grid grid-cols-3 sm:flex gap-1">
            {(['em_analise', 'em_compra', 'recebido'] as const).map(s => (
              <button key={s} disabled={ocupado} onClick={() => onStatus(ids, s)}
                title={`Todas as ${g.solicitacoes} deste produto → ${STATUS[s].ajuda}`}
                className={`px-2 py-2 sm:py-1 rounded-md text-xs sm:text-[11px] font-medium whitespace-nowrap disabled:opacity-50 ${STATUS[s].cor} hover:brightness-95`}>
                {STATUS[s].label}
              </button>
            ))}
          </div>
          <button onClick={onAlternar} className="text-xs sm:text-[11px] text-slate-500 sm:text-slate-400 hover:text-slate-600 py-1 sm:py-0 self-center sm:self-end">
            {aberto ? 'ocultar' : 'ver as solicitações'}
          </button>
        </div>
        )}
      </div>

      {aberto && (
        <div className="border-t border-slate-100 bg-slate-50/60 divide-y divide-slate-100">
          {g.itens.map(f => (
            <div key={f.id} className="px-3 sm:px-4 py-2 flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 text-[12px]">
              <input type="checkbox" checked={selecionados.has(f.id)} onChange={() => onSelecionar([f.id])} />
              <span className="text-slate-500 sm:w-24">{dataHora(f.created_at)}</span>
              <EtiquetaTipo tipo={f.tipo} />
              <span className="font-medium text-slate-700">{f.quantidade_solicitada} un</span>
              <span className="text-slate-600">
                {f.cliente_nome ?? <span className="text-slate-300">sem cliente</span>}
              </span>
              {f.cliente_telefone && (
                <a href={whatsapp(f.cliente_telefone, f.produto_nome)} target="_blank" rel="noreferrer"
                  className="text-emerald-600 hover:underline">{f.cliente_telefone}</a>
              )}
              {f.preco_negociado != null && (
                <span className="text-orange-700">combinado {brl(Number(f.preco_negociado))}</span>
              )}
              {f.observacao && <span className="text-slate-500 italic">{f.observacao}</span>}
              <span className="text-slate-400">{f.usuario_nome ?? 'vendedor não identificado'}</span>
              <AvisoWhatsapp f={f} />
              <span className="ml-auto"><EtiquetaStatus status={f.status} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
