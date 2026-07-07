'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type ProdEst = {
  id: string; quantidade: number; estoque_minimo: number; estoque_maximo: number
  localizacao: string | null; ultima_movimentacao: string
  produtos: {
    id: string; nome: string; sku: string | null; ean: string | null
    unidade: string; marca: string | null; categoria: string | null
    preco_venda: number; preco_custo: number
  } | null
}
type Mov = {
  id: string; tipo: string; produto_nome: string | null; quantidade: number
  estoque_anterior: number | null; estoque_novo: number | null
  motivo: string | null; usuario: string | null; created_at: string
}
type Deposito = {
  id: string; nome: string; tipo: string; principal: boolean
  responsavel: string | null; cidade: string | null; uf: string | null; ativo: boolean
}
type OutroDeposito = { id: string; nome: string }

const TIPO_MOV: Record<string, { label: string; cor: string; sinal: string }> = {
  ajuste_entrada:  { label: 'Ajuste +',    cor: 'text-green-600',  sinal: '+' },
  ajuste_saida:    { label: 'Ajuste −',    cor: 'text-red-600',    sinal: '−' },
  venda:           { label: 'Venda',       cor: 'text-red-500',    sinal: '−' },
  compra:          { label: 'Compra',      cor: 'text-green-600',  sinal: '+' },
  transferencia_saida:  { label: 'Transf. saída',  cor: 'text-orange-600', sinal: '−' },
  transferencia_entrada:{ label: 'Transf. entrada', cor: 'text-blue-600', sinal: '+' },
  inventario:      { label: 'Inventário',  cor: 'text-purple-600', sinal: '±' },
  devolucao:       { label: 'Devolução',   cor: 'text-green-600',  sinal: '+' },
  avaria:          { label: 'Avaria',      cor: 'text-red-600',    sinal: '−' },
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDT(s: string) { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }

export default function DetalheDepositoClient({ deposito, estoqueInicial, movimentacoesIniciais, outrosDepositos, empresaId, operador }: {
  deposito: Deposito; estoqueInicial: ProdEst[]
  movimentacoesIniciais: Mov[]; outrosDepositos: OutroDeposito[]
  empresaId: string; operador: string
}) {
  const sb = createClient()
  const router = useRouter()

  const [estoque, setEstoque] = useState<ProdEst[]>(estoqueInicial)
  const [movs, setMovs] = useState<Mov[]>(movimentacoesIniciais)
  const [aba, setAba] = useState<'estoque' | 'movimentacoes' | 'transferencia'>('estoque')

  // Filtros estoque
  const [busca, setBusca] = useState('')
  const [filtroMarca, setFiltroMarca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroSaldo, setFiltroSaldo] = useState('todos')

  // Transferência
  const [transferencia, setTransferencia] = useState({
    deposito_destino: '', produto_id: '', quantidade: '', observacao: ''
  })
  const [buscaTransf, setBuscaTransf] = useState('')
  const [resultadosTransf, setResultadosTransf] = useState<any[]>([])
  const [prodTransf, setProdTransf] = useState<ProdEst | null>(null)
  const [salvandoTransf, setSalvandoTransf] = useState(false)
  const [erroTransf, setErroTransf] = useState('')
  const buscaRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Editar localização
  const [editandoLoc, setEditandoLoc] = useState<string | null>(null)
  const [novaLoc, setNovaLoc] = useState('')

  // Filtro movimentações
  const [filtroTipoMov, setFiltroTipoMov] = useState('')

  // Métricas
  const totalProdutos = estoque.length
  const totalItens = estoque.reduce((s, e) => s + e.quantidade, 0)
  const valorTotal = estoque.reduce((s, e) => s + e.quantidade * (e.produtos?.preco_custo ?? 0), 0)
  const abaixoMinimo = estoque.filter(e => e.estoque_minimo > 0 && e.quantidade < e.estoque_minimo).length

  // Filtro estoque
  const estoqueFiltrado = estoque.filter(e => {
    const p = e.produtos
    if (!p) return false
    if (filtroSaldo === 'positivo' && e.quantidade <= 0) return false
    if (filtroSaldo === 'zerado' && e.quantidade !== 0) return false
    if (filtroSaldo === 'abaixo' && (e.estoque_minimo <= 0 || e.quantidade >= e.estoque_minimo)) return false
    if (filtroMarca && p.marca !== filtroMarca) return false
    if (filtroCategoria && p.categoria !== filtroCategoria) return false
    if (!busca) return true
    const q = busca.toLowerCase()
    return p.nome.toLowerCase().includes(q) ||
      (p.sku ?? '').toLowerCase().includes(q) ||
      (p.ean ?? '').includes(q)
  })

  const marcas = [...new Set(estoque.map(e => e.produtos?.marca).filter(Boolean))].sort() as string[]
  const cats = [...new Set(estoque.map(e => e.produtos?.categoria).filter(Boolean))].sort() as string[]

  // Busca para transferência
  useEffect(() => {
    if (!buscaTransf || buscaTransf.length < 2) { setResultadosTransf([]); return }
    clearTimeout(buscaRef.current)
    buscaRef.current = setTimeout(() => {
      const q = buscaTransf.toLowerCase()
      const res = estoque.filter(e => {
        const p = e.produtos
        return p && (p.nome.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
      }).filter(e => e.quantidade > 0)
      setResultadosTransf(res)
    }, 200)
  }, [buscaTransf, estoque])

  async function executarTransferencia() {
    if (!prodTransf || !transferencia.deposito_destino || !transferencia.quantidade) return
    const qtd = parseFloat(transferencia.quantidade)
    if (isNaN(qtd) || qtd <= 0) { setErroTransf('Quantidade inválida'); return }
    if (qtd > prodTransf.quantidade) { setErroTransf('Quantidade maior que o saldo disponível'); return }

    setSalvandoTransf(true); setErroTransf('')
    const prod = prodTransf.produtos!

    // Saída do depósito origem
    const novoOrig = prodTransf.quantidade - qtd
    await sb.from('produto_estoque').upsert({
      empresa_id: empresaId, deposito_id: deposito.id, produto_id: prod.id,
      quantidade: novoOrig, ultima_movimentacao: new Date().toISOString(),
    }, { onConflict: 'empresa_id,deposito_id,produto_id' })

    // Entrada no depósito destino
    const { data: destEst } = await sb.from('produto_estoque')
      .select('quantidade').eq('deposito_id', transferencia.deposito_destino).eq('produto_id', prod.id).single()
    const novosDest = (destEst?.quantidade ?? 0) + qtd
    await sb.from('produto_estoque').upsert({
      empresa_id: empresaId, deposito_id: transferencia.deposito_destino, produto_id: prod.id,
      quantidade: novosDest, ultima_movimentacao: new Date().toISOString(),
    }, { onConflict: 'empresa_id,deposito_id,produto_id' })

    // Registrar movimentações
    const depNome = outrosDepositos.find(d => d.id === transferencia.deposito_destino)?.nome ?? ''
    await sb.from('estoque_movimentacoes').insert([
      {
        empresa_id: empresaId, deposito_id: deposito.id, deposito_destino_id: transferencia.deposito_destino,
        produto_id: prod.id, produto_nome: prod.nome,
        tipo: 'transferencia_saida', quantidade: qtd,
        estoque_anterior: prodTransf.quantidade, estoque_novo: novoOrig,
        motivo: `Transferência para ${depNome}. ${transferencia.observacao}`,
        usuario: operador,
      },
      {
        empresa_id: empresaId, deposito_id: transferencia.deposito_destino, deposito_origem_id: deposito.id,
        produto_id: prod.id, produto_nome: prod.nome,
        tipo: 'transferencia_entrada', quantidade: qtd,
        estoque_anterior: destEst?.quantidade ?? 0, estoque_novo: novosDest,
        motivo: `Transferência de ${deposito.nome}. ${transferencia.observacao}`,
        usuario: operador,
      },
    ])

    // Registra na tabela de transferências
    await sb.from('transferencias_estoque').insert({
      empresa_id: empresaId, deposito_origem: deposito.id, deposito_destino: transferencia.deposito_destino,
      produto_id: prod.id, produto_nome: prod.nome,
      quantidade: qtd, observacao: transferencia.observacao || null, usuario: operador,
    })

    // Atualiza UI
    setEstoque(p => p.map(e => e.produtos?.id === prod.id
      ? { ...e, quantidade: novoOrig, ultima_movimentacao: new Date().toISOString() }
      : e))
    setTransferencia({ deposito_destino: '', produto_id: '', quantidade: '', observacao: '' })
    setProdTransf(null); setBuscaTransf(''); setResultadosTransf([])
    setSalvandoTransf(false)
    alert(`✓ Transferência realizada!\n${qtd} ${prod.unidade} de "${prod.nome}"\npara ${depNome}`)
  }

  async function salvarLocalizacao(estoqueId: string) {
    await sb.from('produto_estoque').update({ localizacao: novaLoc || null }).eq('id', estoqueId)
    setEstoque(p => p.map(e => e.id === estoqueId ? { ...e, localizacao: novaLoc || null } : e))
    setEditandoLoc(null)
  }

  const movsFiltradas = movs.filter(m => !filtroTipoMov || m.tipo === filtroTipoMov)

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'rgb(252,251,248)' }}>

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard/depositos')} className="text-gray-400 hover:text-gray-600 text-sm">← Depósitos</button>
            <span className="text-gray-200">/</span>
            <div>
              <span className="font-bold text-gray-900">{deposito.nome}</span>
              {deposito.principal && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Principal</span>}
              {!deposito.ativo && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Inativo</span>}
            </div>
          </div>
          {/* Métricas rápidas */}
          <div className="flex gap-6 text-center">
            <div><p className="text-xl font-bold text-gray-900">{totalProdutos}</p><p className="text-xs text-gray-400">produtos</p></div>
            <div><p className="text-xl font-bold text-gray-900">{totalItens.toFixed(0)}</p><p className="text-xs text-gray-400">unidades</p></div>
            <div><p className="text-xl font-bold text-blue-700">{fmt(valorTotal)}</p><p className="text-xs text-gray-400">valor (custo)</p></div>
            {abaixoMinimo > 0 && <div><p className="text-xl font-bold text-red-600">{abaixoMinimo}</p><p className="text-xs text-red-400">abaixo mín.</p></div>}
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-0 mt-3 border-b border-gray-100 -mb-3">
          {(['estoque', 'movimentacoes', 'transferencia'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${aba === a ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {a === 'estoque' ? `Estoque (${totalProdutos})` : a === 'movimentacoes' ? `Movimentações (${movs.length})` : 'Transferência'}
            </button>
          ))}
        </div>
      </div>

      {/* ABA ESTOQUE */}
      {aba === 'estoque' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Filtros */}
          <div className="bg-white border-b border-gray-200 px-6 py-3 flex gap-3 flex-wrap flex-shrink-0">
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="🔍 SKU, EAN ou nome..."
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 w-64" />
            <select value={filtroSaldo} onChange={e => setFiltroSaldo(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              <option value="todos">Todos os saldos</option>
              <option value="positivo">Com saldo</option>
              <option value="zerado">Zerados</option>
              <option value="abaixo">Abaixo do mínimo</option>
            </select>
            <select value={filtroMarca} onChange={e => setFiltroMarca(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              <option value="">Todas marcas</option>
              {marcas.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              <option value="">Todas categorias</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-xs text-gray-400 self-center">{estoqueFiltrado.length} produtos</span>
          </div>

          {/* Tabela estoque */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-xs text-gray-500 z-10">
                <tr>
                  <th className="text-left px-4 py-2.5 w-24">SKU</th>
                  <th className="text-left px-3 py-2.5">Produto</th>
                  <th className="text-left px-3 py-2.5 w-28">Marca</th>
                  <th className="text-left px-3 py-2.5 w-32">Categoria</th>
                  <th className="text-center px-3 py-2.5 w-24">Saldo</th>
                  <th className="text-center px-3 py-2.5 w-20">Mín.</th>
                  <th className="text-right px-3 py-2.5 w-28">Val. custo</th>
                  <th className="text-left px-3 py-2.5 w-32">Localização</th>
                  <th className="text-right px-3 py-2.5 w-32">Últ. movim.</th>
                </tr>
              </thead>
              <tbody>
                {estoqueFiltrado.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-16 text-gray-300 text-sm">Nenhum produto neste depósito</td></tr>
                ) : estoqueFiltrado.map(e => {
                  const p = e.produtos
                  if (!p) return null
                  const abaixo = e.estoque_minimo > 0 && e.quantidade < e.estoque_minimo
                  return (
                    <tr key={e.id} className={`border-b border-gray-100 hover:bg-gray-50 ${abaixo ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-2.5 text-xs font-mono text-gray-400">{p.sku ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-gray-900">{p.nome}</p>
                        {p.ean && <p className="text-xs text-gray-400">{p.ean}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-indigo-600">{p.marca ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 truncate max-w-[120px]">{p.categoria ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-bold text-sm ${e.quantidade <= 0 ? 'text-gray-300' : abaixo ? 'text-red-600' : 'text-gray-900'}`}>
                          {e.quantidade}
                        </span>
                        <span className="text-xs text-gray-400 ml-1">{p.unidade}</span>
                        {abaixo && <span className="block text-[10px] text-red-500">▼ abaixo mín.</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-400">{e.estoque_minimo || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-600 font-medium">
                        {fmt(e.quantidade * p.preco_custo)}
                      </td>
                      <td className="px-3 py-2.5">
                        {editandoLoc === e.id ? (
                          <div className="flex gap-1">
                            <input autoFocus value={novaLoc} onChange={ev => setNovaLoc(ev.target.value)}
                              onKeyDown={ev => { if (ev.key === 'Enter') salvarLocalizacao(e.id); if (ev.key === 'Escape') setEditandoLoc(null) }}
                              className="w-24 border border-blue-400 rounded px-2 py-0.5 text-xs focus:outline-none" />
                            <button onClick={() => salvarLocalizacao(e.id)} className="text-green-600 text-xs font-bold">✓</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditandoLoc(e.id); setNovaLoc(e.localizacao ?? '') }}
                            className="text-xs text-gray-400 hover:text-blue-600 transition-colors">
                            {e.localizacao ?? '+ localização'}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-400">{fmtDT(e.ultima_movimentacao)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA MOVIMENTAÇÕES */}
      {aba === 'movimentacoes' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="bg-white border-b border-gray-200 px-6 py-3 flex gap-3 flex-shrink-0">
            <select value={filtroTipoMov} onChange={e => setFiltroTipoMov(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              <option value="">Todos os tipos</option>
              {Object.entries(TIPO_MOV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <span className="text-xs text-gray-400 self-center">{movsFiltradas.length} registros</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-xs text-gray-500 z-10">
                <tr>
                  <th className="text-left px-4 py-2.5 w-40">Data/Hora</th>
                  <th className="text-left px-3 py-2.5 w-32">Tipo</th>
                  <th className="text-left px-3 py-2.5">Produto</th>
                  <th className="text-center px-3 py-2.5 w-20">Qtd</th>
                  <th className="text-center px-3 py-2.5 w-24">Anterior</th>
                  <th className="text-center px-3 py-2.5 w-24">Novo</th>
                  <th className="text-left px-3 py-2.5">Motivo</th>
                  <th className="text-left px-3 py-2.5 w-28">Usuário</th>
                </tr>
              </thead>
              <tbody>
                {movsFiltradas.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-16 text-gray-300 text-sm">Nenhuma movimentação registrada</td></tr>
                ) : movsFiltradas.map(m => {
                  const tipo = TIPO_MOV[m.tipo] ?? { label: m.tipo, cor: 'text-gray-500', sinal: '·' }
                  return (
                    <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDT(m.created_at)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-semibold ${tipo.cor}`}>{tipo.label}</span>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 text-sm">{m.produto_nome ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-bold text-sm ${tipo.cor}`}>{tipo.sinal}{m.quantidade}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-400">{m.estoque_anterior ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-700 font-medium">{m.estoque_novo ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 truncate max-w-[200px]">{m.motivo ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-400">{m.usuario?.split('@')[0] ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA TRANSFERÊNCIA */}
      {aba === 'transferencia' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-lg mx-auto">
            <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">Transferência de Estoque</h2>
                <p className="text-sm text-gray-500 mt-0.5">Origem: <b>{deposito.nome}</b></p>
              </div>

              {outrosDepositos.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                  Não há outros depósitos disponíveis para transferência.
                </div>
              ) : (
                <>
                  {/* Depósito destino */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Depósito de destino *</label>
                    <select value={transferencia.deposito_destino}
                      onChange={e => setTransferencia(p => ({ ...p, deposito_destino: e.target.value }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500">
                      <option value="">Selecione o depósito...</option>
                      {outrosDepositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                    </select>
                  </div>

                  {/* Produto */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Produto *</label>
                    {prodTransf ? (
                      <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{prodTransf.produtos?.nome}</p>
                          <p className="text-xs text-gray-500">Saldo neste depósito: <b>{prodTransf.quantidade} {prodTransf.produtos?.unidade}</b></p>
                        </div>
                        <button onClick={() => { setProdTransf(null); setBuscaTransf('') }}
                          className="text-gray-400 hover:text-red-500 text-lg ml-3">×</button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input value={buscaTransf} onChange={e => setBuscaTransf(e.target.value)}
                          placeholder="Buscar produto pelo nome ou SKU..."
                          className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                        {resultadosTransf.length > 0 && (
                          <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto mt-1">
                            {resultadosTransf.map(e => (
                              <div key={e.id} onClick={() => { setProdTransf(e); setBuscaTransf(''); setResultadosTransf([]) }}
                                className="px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                                <p className="text-sm font-medium text-gray-900">{e.produtos?.nome}</p>
                                <p className="text-xs text-gray-400">Saldo: {e.quantidade} {e.produtos?.unidade}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Quantidade */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Quantidade *</label>
                    <input type="number" step="0.001" value={transferencia.quantidade}
                      onChange={e => setTransferencia(p => ({ ...p, quantidade: e.target.value }))}
                      max={prodTransf?.quantidade ?? undefined}
                      placeholder={prodTransf ? `Máx: ${prodTransf.quantidade}` : '0'}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>

                  {/* Observação */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Observação</label>
                    <input value={transferencia.observacao}
                      onChange={e => setTransferencia(p => ({ ...p, observacao: e.target.value }))}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>

                  {erroTransf && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{erroTransf}</p>}

                  <button onClick={executarTransferencia}
                    disabled={salvandoTransf || !prodTransf || !transferencia.deposito_destino || !transferencia.quantidade}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
                    {salvandoTransf ? 'Transferindo...' : '↔ Executar Transferência'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
