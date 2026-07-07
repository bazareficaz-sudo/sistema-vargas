'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type InvItem = {
  id: string; inventario_id: string; produto_id: string
  produto_nome: string; produto_sku: string | null; produto_ean: string | null
  categoria: string | null; marca: string | null; unidade: string
  origem: string; estoque_sistema: number; qtd_contada: number | null
  diferenca: number | null; preco_custo: number; status_item: string
}
type Inventario = {
  id: string; numero: number; descricao: string; tipo: string; status: string
  deposito_id: string | null; deposito_nome: string | null
  responsavel: string | null; observacao: string | null
  data_abertura: string; criado_por: string | null
  total_itens: number; itens_contados: number; itens_divergentes: number
}
type Historico = { id: string; acao: string; descricao: string | null; usuario: string | null; created_at: string }
type Cat = { id: string; nome: string }

const STATUS_ITEM: Record<string, { label: string; cor: string }> = {
  pendente:   { label: 'Pendente',   cor: 'bg-gray-100 text-gray-500' },
  contado:    { label: 'Contado',    cor: 'bg-green-100 text-green-700' },
  divergente: { label: 'Divergente', cor: 'bg-orange-100 text-orange-700' },
  ajustado:   { label: 'Ajustado',   cor: 'bg-blue-100 text-blue-700' },
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

export default function InventarioDetalheClient({ inventario: inv0, itensIniciais, historicoInicial, empresaId, operador, categorias, marcas }: {
  inventario: Inventario; itensIniciais: InvItem[]; historicoInicial: Historico[]
  empresaId: string; operador: string; categorias: Cat[]; marcas: Cat[]
}) {
  const sb = createClient()
  const router = useRouter()

  const [inv, setInv] = useState<Inventario>(inv0)
  const [itens, setItens] = useState<InvItem[]>(itensIniciais)
  const [historico, setHistorico] = useState<Historico[]>(historicoInicial)
  const [aba, setAba] = useState<'contagem' | 'adicionar' | 'historico' | 'finalizar'>('contagem')

  // Filtros contagem
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroMarca, setFiltroMarca] = useState('')

  // Adicionar produtos
  const [modoAdicionar, setModoAdicionar] = useState<'manual' | 'categoria' | 'marca'>('manual')
  const [buscaProd, setBuscaProd] = useState('')
  const [resultadosProd, setResultadosProd] = useState<any[]>([])
  const [catsSelect, setCatsSelect] = useState<string[]>([])
  const [marcasSelect, setMarcasSelect] = useState<string[]>([])
  const [adicionando, setAdicionando] = useState(false)

  // Finalização
  const [modalFinalizar, setModalFinalizar] = useState(false)
  const [modalCancelar, setModalCancelar] = useState(false)
  const [motivoCancelamento, setMotivoCancelamento] = useState('')
  const [finalizando, setFinalizando] = useState(false)

  const buscaRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const bloqueado = inv.status === 'finalizado' || inv.status === 'cancelado'

  // ── Métricas ──────────────────────────────────────────────────
  const totalItens = itens.length
  const contados = itens.filter(i => i.qtd_contada !== null).length
  const pendentes = totalItens - contados
  const divergentes = itens.filter(i => i.qtd_contada !== null && i.qtd_contada !== i.estoque_sistema).length
  const semDivergencia = itens.filter(i => i.qtd_contada !== null && i.qtd_contada === i.estoque_sistema).length

  // ── Busca de produtos para adicionar ─────────────────────────
  useEffect(() => {
    if (!buscaProd || buscaProd.length < 2) { setResultadosProd([]); return }
    clearTimeout(buscaRef.current)
    buscaRef.current = setTimeout(async () => {
      let q = sb.from('produtos').select('id, nome, sku, ean, estoque, unidade, categoria, marca, preco_custo')
        .eq('empresa_id', empresaId).eq('ativo', true)
      const pals = buscaProd.trim().split(/\s+/)
      for (const p of pals) q = q.ilike('nome', `%${p}%`)
      const { data } = await q.order('nome').limit(15)
      const idsExistentes = new Set(itens.map(i => i.produto_id))
      setResultadosProd((data ?? []).filter((p: any) => !idsExistentes.has(p.id)))
    }, 250)
  }, [buscaProd])

  async function adicionarProduto(prod: any, origem = 'manual') {
    if (itens.find(i => i.produto_id === prod.id)) return
    const { data, error } = await sb.from('inventario_itens').insert({
      inventario_id: inv.id,
      produto_id: prod.id,
      produto_nome: prod.nome,
      produto_sku: prod.sku,
      produto_ean: prod.ean,
      categoria: prod.categoria,
      marca: prod.marca,
      unidade: prod.unidade,
      origem,
      estoque_sistema: prod.estoque ?? 0,
      preco_custo: prod.preco_custo ?? 0,
      status_item: 'pendente',
    }).select().single()
    if (!error && data) {
      setItens(p => [...p, data as InvItem])
      await atualizarContadores(itens.length + 1, contados, divergentes)
      await registrarHistorico(`produto_adicionado`, `Produto "${prod.nome}" adicionado (${origem})`)
    }
  }

  async function adicionarPorCategoria() {
    if (catsSelect.length === 0) return
    setAdicionando(true)
    const idsExistentes = new Set(itens.map(i => i.produto_id))
    const { data } = await sb.from('produtos')
      .select('id, nome, sku, ean, estoque, unidade, categoria, marca, preco_custo')
      .eq('empresa_id', empresaId).eq('ativo', true).in('categoria', catsSelect)
    const novos = (data ?? []).filter((p: any) => !idsExistentes.has(p.id))
    for (const p of novos) await adicionarProduto(p, 'categoria')
    setCatsSelect([])
    setAdicionando(false)
  }

  async function adicionarPorMarca() {
    if (marcasSelect.length === 0) return
    setAdicionando(true)
    const idsExistentes = new Set(itens.map(i => i.produto_id))
    const { data } = await sb.from('produtos')
      .select('id, nome, sku, ean, estoque, unidade, categoria, marca, preco_custo')
      .eq('empresa_id', empresaId).eq('ativo', true).in('marca', marcasSelect)
    const novos = (data ?? []).filter((p: any) => !idsExistentes.has(p.id))
    for (const p of novos) await adicionarProduto(p, 'marca')
    setMarcasSelect([])
    setAdicionando(false)
  }

  // ── Contagem ─────────────────────────────────────────────────
  async function salvarContagem(itemId: string, qtd: number | null) {
    const item = itens.find(i => i.id === itemId)
    if (!item) return
    const novoStatus = qtd === null ? 'pendente' : qtd === item.estoque_sistema ? 'contado' : 'divergente'
    const { error } = await sb.from('inventario_itens').update({
      qtd_contada: qtd, status_item: novoStatus,
      contado_por: operador, contado_em: new Date().toISOString(),
    }).eq('id', itemId)
    if (!error) {
      const novosItens = itens.map(i => i.id === itemId
        ? { ...i, qtd_contada: qtd, status_item: novoStatus, diferenca: qtd !== null ? qtd - i.estoque_sistema : null }
        : i)
      setItens(novosItens)
      const nc = novosItens.filter(i => i.qtd_contada !== null).length
      const nd = novosItens.filter(i => i.qtd_contada !== null && i.qtd_contada !== i.estoque_sistema).length
      await atualizarContadores(novosItens.length, nc, nd)
    }
  }

  async function atualizarContadores(total: number, cont: number, div: number) {
    await sb.from('inventarios').update({ total_itens: total, itens_contados: cont, itens_divergentes: div }).eq('id', inv.id)
    setInv(p => ({ ...p, total_itens: total, itens_contados: cont, itens_divergentes: div }))
  }

  async function registrarHistorico(acao: string, descricao: string) {
    const { data } = await sb.from('inventario_historico').insert({
      inventario_id: inv.id, acao, descricao, usuario: operador,
    }).select().single()
    if (data) setHistorico(p => [data as Historico, ...p])
  }

  // ── Finalização ──────────────────────────────────────────────
  async function finalizar() {
    setFinalizando(true)
    const divergs = itens.filter(i => i.qtd_contada !== null && i.qtd_contada !== i.estoque_sistema)

    // Ajusta estoque para cada divergente
    for (const item of divergs) {
      const novoEstoque = item.qtd_contada!
      const anterior = item.estoque_sistema
      await sb.from('produtos').update({ estoque: novoEstoque }).eq('id', item.produto_id)
      await sb.from('estoque_movimentacoes').insert({
        empresa_id: empresaId,
        deposito_id: inv.deposito_id,
        produto_id: item.produto_id,
        produto_nome: item.produto_nome,
        tipo: novoEstoque > anterior ? 'ajuste_entrada' : 'ajuste_saida',
        quantidade: Math.abs(novoEstoque - anterior),
        estoque_anterior: anterior,
        estoque_novo: novoEstoque,
        motivo: 'Ajuste por inventário',
        referencia_id: inv.id,
        referencia_tipo: 'inventario',
        usuario: operador,
      })
      await sb.from('inventario_itens').update({ status_item: 'ajustado' }).eq('id', item.id)
    }

    // Marca inventário como finalizado
    await sb.from('inventarios').update({
      status: 'finalizado',
      data_finalizacao: new Date().toISOString(),
      finalizado_por: operador,
    }).eq('id', inv.id)

    await registrarHistorico('finalizado', `Inventário finalizado por ${operador}. ${divergs.length} ajustes aplicados.`)
    setItens(p => p.map(i => divergs.find(d => d.id === i.id) ? { ...i, status_item: 'ajustado' } : i))
    setInv(p => ({ ...p, status: 'finalizado' }))
    setModalFinalizar(false)
    setFinalizando(false)
  }

  async function cancelar() {
    await sb.from('inventarios').update({
      status: 'cancelado', cancelado_por: operador, motivo_cancelamento: motivoCancelamento,
    }).eq('id', inv.id)
    await registrarHistorico('cancelado', `Cancelado por ${operador}. Motivo: ${motivoCancelamento}`)
    setInv(p => ({ ...p, status: 'cancelado' }))
    setModalCancelar(false)
  }

  // ── Filtro itens ─────────────────────────────────────────────
  const itensFiltrados = itens.filter(i => {
    if (filtroStatus !== 'todos' && i.status_item !== filtroStatus) return false
    if (filtroCategoria && i.categoria !== filtroCategoria) return false
    if (filtroMarca && i.marca !== filtroMarca) return false
    if (!busca) return true
    const q = busca.toLowerCase()
    return i.produto_nome.toLowerCase().includes(q) ||
      (i.produto_sku ?? '').toLowerCase().includes(q) ||
      (i.produto_ean ?? '').includes(q)
  })

  const pct = totalItens > 0 ? Math.round((contados / totalItens) * 100) : 0

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'rgb(252,251,248)' }}>

      {/* ── HEADER ──────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard/inventarios')} className="text-gray-400 hover:text-gray-600 text-sm">← Inventários</button>
            <span className="text-gray-200">/</span>
            <div>
              <span className="font-bold text-gray-900">#{inv.numero} — {inv.descricao}</span>
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${inv.status === 'finalizado' ? 'bg-green-100 text-green-700' : inv.status === 'cancelado' ? 'bg-red-100 text-red-600' : inv.status === 'em_contagem' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                {inv.status === 'finalizado' ? 'Finalizado' : inv.status === 'cancelado' ? 'Cancelado' : inv.status === 'em_contagem' ? 'Em Contagem' : 'Aberto'}
              </span>
            </div>
          </div>
          {/* Progresso */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="flex gap-4 text-xs text-gray-500">
                  <span><b className="text-gray-900">{totalItens}</b> total</span>
                  <span><b className="text-green-600">{contados}</b> contados</span>
                  <span><b className="text-gray-400">{pendentes}</b> pendentes</span>
                  {divergentes > 0 && <span><b className="text-orange-600">{divergentes}</b> divergentes</span>}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-48 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-700">{pct}%</span>
                </div>
              </div>
            </div>
            {!bloqueado && (
              <div className="flex gap-2">
                <button onClick={() => { setAba('finalizar'); setModalFinalizar(true) }}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl">
                  Finalizar ✓
                </button>
                <button onClick={() => setModalCancelar(true)}
                  className="px-3 py-2 border border-red-200 text-red-500 hover:bg-red-50 text-sm rounded-xl">
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-0 mt-3 border-b border-gray-100 -mb-3">
          {(['contagem', 'adicionar', 'historico'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${aba === a ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {a === 'contagem' ? `Contagem (${totalItens})` : a === 'adicionar' ? 'Adicionar Produtos' : 'Histórico'}
            </button>
          ))}
        </div>
      </div>

      {/* ── ABA CONTAGEM ────────────────────────────────────────── */}
      {aba === 'contagem' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Filtros */}
          <div className="bg-white border-b border-gray-200 px-6 py-3 flex gap-3 flex-wrap flex-shrink-0">
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="🔍 SKU, EAN ou nome..."
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 w-64" />
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
              <option value="todos">Todos status</option>
              {Object.entries(STATUS_ITEM).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
              <option value="">Todas categorias</option>
              {[...new Set(itens.map(i => i.categoria).filter(Boolean))].sort().map(c => <option key={c!} value={c!}>{c}</option>)}
            </select>
            <select value={filtroMarca} onChange={e => setFiltroMarca(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
              <option value="">Todas marcas</option>
              {[...new Set(itens.map(i => i.marca).filter(Boolean))].sort().map(m => <option key={m!} value={m!}>{m}</option>)}
            </select>
            <span className="text-xs text-gray-400 self-center">{itensFiltrados.length} produtos</span>
          </div>

          {/* Tabela */}
          <div className="flex-1 overflow-y-auto">
            {itensFiltrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
                <span className="text-4xl">📋</span>
                <p className="text-sm">{totalItens === 0 ? 'Nenhum produto adicionado. Vá em "Adicionar Produtos".' : 'Nenhum item neste filtro.'}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-xs text-gray-500 z-10">
                  <tr>
                    <th className="text-left px-4 py-2.5 w-24">SKU</th>
                    <th className="text-left px-3 py-2.5">Produto</th>
                    <th className="text-left px-3 py-2.5 w-28">Categoria</th>
                    <th className="text-left px-3 py-2.5 w-24">Marca</th>
                    <th className="text-center px-3 py-2.5 w-24">Estoque sist.</th>
                    <th className="text-center px-3 py-2.5 w-28">Qtd contada</th>
                    <th className="text-center px-3 py-2.5 w-24">Diferença</th>
                    <th className="text-center px-3 py-2.5 w-24">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {itensFiltrados.map(item => (
                    <LinhaContagem
                      key={item.id}
                      item={item}
                      bloqueado={bloqueado}
                      onSalvar={(qtd) => salvarContagem(item.id, qtd)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── ABA ADICIONAR ───────────────────────────────────────── */}
      {aba === 'adicionar' && !bloqueado && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Seletor de modo */}
            <div className="flex gap-2 bg-gray-100 rounded-xl p-1 w-fit">
              {(['manual', 'categoria', 'marca'] as const).map(m => (
                <button key={m} onClick={() => setModoAdicionar(m)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${modoAdicionar === m ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                  {m === 'manual' ? 'Manual' : m === 'categoria' ? 'Por Categoria' : 'Por Marca'}
                </button>
              ))}
            </div>

            {/* Manual */}
            {modoAdicionar === 'manual' && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-3">Buscar produto</h3>
                <input value={buscaProd} onChange={e => setBuscaProd(e.target.value)}
                  placeholder="SKU, EAN ou nome do produto..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 mb-3" />
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {resultadosProd.map((p: any) => (
                    <div key={p.id}
                      className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-gray-50 cursor-pointer border border-transparent hover:border-gray-200"
                      onClick={() => { adicionarProduto(p, 'manual'); setBuscaProd(''); setResultadosProd([]) }}>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{p.nome}</p>
                        <p className="text-xs text-gray-400">{p.sku} {p.marca && `· ${p.marca}`} · {p.categoria}</p>
                      </div>
                      <div className="text-right text-sm flex-shrink-0 ml-4">
                        <p className="text-gray-600">Est: <b>{p.estoque}</b> {p.unidade}</p>
                        <button className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Adicionar</button>
                      </div>
                    </div>
                  ))}
                  {buscaProd.length >= 2 && resultadosProd.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">Nenhum produto encontrado ou já adicionado</p>
                  )}
                </div>
              </div>
            )}

            {/* Por Categoria */}
            {modoAdicionar === 'categoria' && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Selecionar categorias</h3>
                <p className="text-xs text-gray-400 mb-4">Todos os produtos das categorias selecionadas serão adicionados ao inventário.</p>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto mb-4">
                  {categorias.map(c => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                      <input type="checkbox" checked={catsSelect.includes(c.nome)}
                        onChange={e => setCatsSelect(p => e.target.checked ? [...p, c.nome] : p.filter(x => x !== c.nome))}
                        className="rounded" />
                      <span className="text-sm text-gray-700">{c.nome}</span>
                    </label>
                  ))}
                </div>
                <button onClick={adicionarPorCategoria} disabled={catsSelect.length === 0 || adicionando}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium rounded-xl text-sm">
                  {adicionando ? 'Adicionando...' : `Adicionar produtos das ${catsSelect.length} categorias selecionadas`}
                </button>
              </div>
            )}

            {/* Por Marca */}
            {modoAdicionar === 'marca' && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Selecionar marcas</h3>
                <p className="text-xs text-gray-400 mb-4">Todos os produtos das marcas selecionadas serão adicionados ao inventário.</p>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto mb-4">
                  {marcas.map(m => (
                    <label key={m.id} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                      <input type="checkbox" checked={marcasSelect.includes(m.nome)}
                        onChange={e => setMarcasSelect(p => e.target.checked ? [...p, m.nome] : p.filter(x => x !== m.nome))}
                        className="rounded" />
                      <span className="text-sm text-gray-700">{m.nome}</span>
                    </label>
                  ))}
                </div>
                <button onClick={adicionarPorMarca} disabled={marcasSelect.length === 0 || adicionando}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium rounded-xl text-sm">
                  {adicionando ? 'Adicionando...' : `Adicionar produtos das ${marcasSelect.length} marcas selecionadas`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ABA HISTÓRICO ───────────────────────────────────────── */}
      {aba === 'historico' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-2">
            {historico.length === 0 ? (
              <p className="text-center text-gray-400 py-10 text-sm">Nenhum registro de histórico</p>
            ) : historico.map(h => (
              <div key={h.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{h.descricao ?? h.acao}</p>
                    <p className="text-xs text-gray-400 mt-0.5">por {h.usuario}</p>
                  </div>
                  <p className="text-xs text-gray-400 flex-shrink-0">
                    {new Date(h.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODAL FINALIZAR ─────────────────────────────────────── */}
      {modalFinalizar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModalFinalizar(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Confirmar Finalização</h2>
              <button onClick={() => setModalFinalizar(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Resumo */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total de produtos', valor: totalItens, cor: 'text-gray-900' },
                  { label: 'Contados', valor: contados, cor: 'text-green-600' },
                  { label: 'Sem divergência', valor: semDivergencia, cor: 'text-green-600' },
                  { label: 'Com divergência', valor: divergentes, cor: divergentes > 0 ? 'text-orange-600' : 'text-gray-400' },
                ].map(c => (
                  <div key={c.label} className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className={`text-2xl font-bold ${c.cor}`}>{c.valor}</p>
                    <p className="text-xs text-gray-500">{c.label}</p>
                  </div>
                ))}
              </div>

              {divergentes > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-orange-800 mb-2">Produtos com divergência:</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {itens.filter(i => i.qtd_contada !== null && i.qtd_contada !== i.estoque_sistema).map(i => (
                      <div key={i.id} className="flex justify-between text-xs text-orange-700">
                        <span className="truncate flex-1">{i.produto_nome}</span>
                        <span className="flex-shrink-0 ml-3 font-mono">
                          {i.estoque_sistema} → {i.qtd_contada}
                          <span className={`ml-1 ${(i.qtd_contada! - i.estoque_sistema) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ({(i.qtd_contada! - i.estoque_sistema) > 0 ? '+' : ''}{(i.qtd_contada! - i.estoque_sistema).toFixed(2)})
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* Valor total da diferença */}
                  {(() => {
                    const valorDif = itens
                      .filter(i => i.qtd_contada !== null && i.qtd_contada !== i.estoque_sistema)
                      .reduce((s, i) => s + (i.qtd_contada! - i.estoque_sistema) * i.preco_custo, 0)
                    return (
                      <p className="text-xs text-orange-800 font-semibold mt-2 border-t border-orange-200 pt-2">
                        Valor estimado da diferença: {fmt(valorDif)}
                      </p>
                    )
                  })()}
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <p className="text-xs text-blue-800">
                  Ao confirmar, o sistema ajustará automaticamente o estoque de todos os produtos com divergência.
                  Esta ação não pode ser desfeita.
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button onClick={() => setModalFinalizar(false)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                Voltar
              </button>
              <button onClick={finalizar} disabled={finalizando}
                className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm">
                {finalizando ? 'Aplicando ajustes...' : '✓ Confirmar e Ajustar Estoque'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL CANCELAR ──────────────────────────────────────── */}
      {modalCancelar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModalCancelar(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="font-bold text-gray-900">Cancelar Inventário</h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-600">O inventário será cancelado sem ajuste de estoque.</p>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Motivo *</label>
                <textarea autoFocus value={motivoCancelamento} onChange={e => setMotivoCancelamento(e.target.value)}
                  rows={3} placeholder="Descreva o motivo do cancelamento..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-red-400" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button onClick={() => setModalCancelar(false)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm">Voltar</button>
              <button onClick={cancelar} disabled={!motivoCancelamento.trim()}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-semibold rounded-xl text-sm">
                Cancelar Inventário
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Linha de contagem ─────────────────────────────────────────
function LinhaContagem({ item, bloqueado, onSalvar }: {
  item: InvItem; bloqueado: boolean; onSalvar: (qtd: number | null) => void
}) {
  const [valor, setValor] = useState(item.qtd_contada !== null ? String(item.qtd_contada) : '')
  const [editando, setEditando] = useState(false)

  useEffect(() => {
    setValor(item.qtd_contada !== null ? String(item.qtd_contada) : '')
  }, [item.qtd_contada])

  function confirmar() {
    const qtd = valor.trim() === '' ? null : parseFloat(valor.replace(',', '.'))
    if (qtd !== null && isNaN(qtd)) return
    onSalvar(qtd)
    setEditando(false)
  }

  const diff = item.qtd_contada !== null ? item.qtd_contada - item.estoque_sistema : null

  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${item.status_item === 'divergente' ? 'bg-orange-50/40' : ''}`}>
      <td className="px-4 py-2.5 text-xs font-mono text-gray-400">{item.produto_sku ?? '—'}</td>
      <td className="px-3 py-2.5">
        <div className="font-medium text-gray-900 text-sm">{item.produto_nome}</div>
        {item.produto_ean && <div className="text-xs text-gray-400">{item.produto_ean}</div>}
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-500 truncate max-w-[100px]">{item.categoria ?? '—'}</td>
      <td className="px-3 py-2.5 text-xs text-indigo-600 truncate max-w-[90px]">{item.marca ?? '—'}</td>
      <td className="px-3 py-2.5 text-center">
        <span className="text-sm font-semibold text-gray-700">{item.estoque_sistema}</span>
        <span className="text-xs text-gray-400 ml-1">{item.unidade}</span>
      </td>
      <td className="px-3 py-2.5 text-center">
        {bloqueado ? (
          <span className="text-sm">{item.qtd_contada ?? '—'}</span>
        ) : editando ? (
          <div className="flex items-center justify-center gap-1">
            <input
              autoFocus
              value={valor}
              onChange={e => setValor(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') setEditando(false) }}
              onFocus={e => e.target.select()}
              className="w-20 text-center border-2 border-blue-400 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none"
            />
            <button onClick={confirmar} className="text-green-600 hover:text-green-800 font-bold text-lg leading-none">✓</button>
          </div>
        ) : (
          <button onClick={() => setEditando(true)}
            className={`px-3 py-1 rounded-lg text-sm font-semibold border transition-colors ${item.qtd_contada !== null ? 'border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-600' : 'border-dashed border-gray-300 text-gray-300 hover:border-blue-400 hover:text-blue-400'}`}>
            {item.qtd_contada !== null ? item.qtd_contada : 'Contar'}
          </button>
        )}
      </td>
      <td className="px-3 py-2.5 text-center">
        {diff !== null ? (
          <span className={`text-sm font-bold ${diff === 0 ? 'text-gray-400' : diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {diff > 0 ? '+' : ''}{diff}
          </span>
        ) : <span className="text-gray-300 text-sm">—</span>}
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_ITEM[item.status_item]?.cor}`}>
          {STATUS_ITEM[item.status_item]?.label}
        </span>
      </td>
    </tr>
  )
}
