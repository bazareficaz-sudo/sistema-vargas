'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import MapearAnuncioModal from './MapearAnuncioModal'

const STATUS_CORES: Record<string, string> = {
  novo:       'bg-blue-100 text-blue-700',
  confirmado: 'bg-green-100 text-green-700',
  faturado:   'bg-purple-100 text-purple-700',
  enviado:    'bg-cyan-100 text-cyan-700',
  entregue:   'bg-green-100 text-green-800',
  cancelado:  'bg-red-100 text-red-600',
  devolvido:  'bg-orange-100 text-orange-600',
}
const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo', confirmado: 'Confirmado', faturado: 'Faturado',
  enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado', devolvido: 'Devolvido',
}

const ETAPA_CORES: Record<string, string> = {
  novo:                 'bg-blue-100 text-blue-700',
  pendencia_mapeamento: 'bg-amber-100 text-amber-700',
  separacao:            'bg-indigo-100 text-indigo-700',
  pronto_expedicao:     'bg-teal-100 text-teal-700',
  enviado:              'bg-cyan-100 text-cyan-700',
  concluido:            'bg-green-100 text-green-800',
  cancelado:            'bg-gray-100 text-gray-500',
  com_pendencia:        'bg-red-100 text-red-600',
}
const ETAPA_LABEL: Record<string, string> = {
  novo: 'Novo', pendencia_mapeamento: 'Pendência de mapeamento', separacao: 'Separação',
  pronto_expedicao: 'Pronto p/ expedição', enviado: 'Enviado', concluido: 'Concluído',
  cancelado: 'Cancelado', com_pendencia: 'Com pendência',
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtData(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Prazo de postagem: quanto falta (ou quanto já passou) até `prazo_postagem`.
// Etapas finais (enviado/concluído/cancelado) não têm mais prazo relevante.
function prazoInfo(pedido: any): { texto: string; cor: string } | null {
  if (!pedido.prazo_postagem) return null
  if (['enviado', 'concluido', 'cancelado'].includes(pedido.etapa_interna)) return null
  const diffMs = new Date(pedido.prazo_postagem).getTime() - Date.now()
  const diffH = diffMs / (1000 * 60 * 60)
  if (diffH < 0) return { texto: `Atrasado ${Math.abs(diffH) < 24 ? Math.round(Math.abs(diffH)) + 'h' : Math.round(Math.abs(diffH) / 24) + 'd'}`, cor: 'text-red-600 font-medium' }
  if (diffH < 24) return { texto: `${Math.round(diffH)}h restantes`, cor: 'text-orange-600 font-medium' }
  return { texto: `${Math.round(diffH / 24)}d restantes`, cor: 'text-gray-500' }
}

export default function PedidosEcommerceClient({ canais, pedidos: pedidosIniciais, empresaId, statusInicial, qInicial, canalIdInicial, operador }: {
  canais: any[]; pedidos: any[]; empresaId: string; statusInicial: string; qInicial: string; canalIdInicial: string; operador: string
}) {
  const router = useRouter()
  const [pedidos, setPedidos] = useState(pedidosIniciais)
  const [q, setQ] = useState(qInicial)
  const [statusFiltro, setStatusFiltro] = useState(statusInicial)
  const [canalFiltro, setCanalFiltro] = useState(canalIdInicial)
  const [etapaFiltro, setEtapaFiltro] = useState('')
  const [somenteAtrasados, setSomenteAtrasados] = useState(false)
  const [detalhe, setDetalhe] = useState<any | null>(null)
  const [modal, setModal] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [rastreioForm, setRastreioForm] = useState({ transportadora: '', codigo_rastreio: '' })
  const [sincronizando, setSincronizando] = useState(false)
  const [resumoSync, setResumoSync] = useState('')

  // Mapear item sem sair do pedido
  const [mapeandoItem, setMapeandoItem] = useState<any | null>(null)
  const [anuncioParaMapear, setAnuncioParaMapear] = useState<any | null>(null)
  const [carregandoAnuncio, setCarregandoAnuncio] = useState(false)
  const [buscaItemId, setBuscaItemId] = useState<string | null>(null)
  const [termoBuscaItem, setTermoBuscaItem] = useState('')
  const [resultadosBuscaItem, setResultadosBuscaItem] = useState<any[]>([])

  // Etiqueta de envio (Shopee)
  const [etiquetaOpcoes, setEtiquetaOpcoes] = useState<{ modalidade: string | null; enderecosColeta: any[]; filiaisDropoff: any[]; slugsDropoff: any[] } | null>(null)
  const [escolhaEnvio, setEscolhaEnvio] = useState<{ addressId?: string; branchId?: string; slug?: string; trackingNumber?: string }>({})
  const [carregandoEtiqueta, setCarregandoEtiqueta] = useState(false)
  const [pollingEtiqueta, setPollingEtiqueta] = useState(false)
  const [erroEtiqueta, setErroEtiqueta] = useState('')

  const canaisShopee = canais.filter(c => c.plataforma === 'shopee' && c.ativo && c.access_token)

  const formPedidoVazio = {
    canal_id: canais[0]?.id ?? '',
    id_externo: '', numero_pedido: '', cliente_nome: '', cliente_email: '', cliente_doc: '',
    entrega_cep: '', entrega_logradouro: '', entrega_numero: '', entrega_bairro: '', entrega_cidade: '', entrega_estado: '',
    valor_produtos: '', valor_frete: '', valor_desconto: '', data_pedido: '', observacoes: '', status: 'novo',
  }
  const [formPedido, setFormPedido] = useState(formPedidoVazio)
  const [itensForm, setItensForm] = useState<{ nome_produto: string; quantidade: string; preco_unitario: string }[]>([
    { nome_produto: '', quantidade: '1', preco_unitario: '' }
  ])

  function fp(k: string, v: any) { setFormPedido(p => ({ ...p, [k]: v })) }

  async function salvarPedido() {
    if (!formPedido.canal_id) { alert('Selecione a loja.'); return }
    if (!formPedido.id_externo.trim()) { alert('ID externo obrigatório.'); return }
    setSalvando(true)
    const sb = createClient()
    const vProd = parseFloat(formPedido.valor_produtos) || 0
    const vFrete = parseFloat(formPedido.valor_frete) || 0
    const vDesc = parseFloat(formPedido.valor_desconto) || 0
    const { data: pedido, error } = await sb.from('marketplace_pedidos').insert({
      empresa_id: empresaId, canal_id: formPedido.canal_id,
      id_externo: formPedido.id_externo.trim(),
      numero_pedido: formPedido.numero_pedido || null,
      cliente_nome: formPedido.cliente_nome || null,
      cliente_email: formPedido.cliente_email || null,
      cliente_doc: formPedido.cliente_doc || null,
      entrega_cep: formPedido.entrega_cep || null,
      entrega_logradouro: formPedido.entrega_logradouro || null,
      entrega_numero: formPedido.entrega_numero || null,
      entrega_bairro: formPedido.entrega_bairro || null,
      entrega_cidade: formPedido.entrega_cidade || null,
      entrega_estado: formPedido.entrega_estado || null,
      valor_produtos: vProd, valor_frete: vFrete, valor_desconto: vDesc,
      valor_total: vProd + vFrete - vDesc,
      status: formPedido.status,
      data_pedido: formPedido.data_pedido ? new Date(formPedido.data_pedido).toISOString() : new Date().toISOString(),
      observacoes: formPedido.observacoes || null,
    }).select('*, marketplace_canais(id, nome, plataforma)').single()
    if (error) { alert(error.message); setSalvando(false); return }

    const itensFiltrados = itensForm.filter(i => i.nome_produto.trim())
    if (itensFiltrados.length > 0) {
      await sb.from('marketplace_pedido_itens').insert(itensFiltrados.map(i => ({
        pedido_id: pedido.id,
        nome_produto: i.nome_produto,
        quantidade: parseInt(i.quantidade) || 1,
        preco_unitario: parseFloat(i.preco_unitario) || 0,
        subtotal: (parseInt(i.quantidade) || 1) * (parseFloat(i.preco_unitario) || 0),
      })))
    }

    setPedidos(prev => [{ ...pedido, marketplace_pedido_itens: itensFiltrados }, ...prev])
    setModal(false)
    setFormPedido(formPedidoVazio)
    setItensForm([{ nome_produto: '', quantidade: '1', preco_unitario: '' }])
    setSalvando(false)
    router.refresh()
  }

  async function atualizarStatus(pedido: any, novoStatus: string) {
    const sb = createClient()
    await sb.from('marketplace_pedidos').update({ status: novoStatus, updated_at: new Date().toISOString() }).eq('id', pedido.id)
    setPedidos(prev => prev.map(p => p.id === pedido.id ? { ...p, status: novoStatus } : p))
    if (detalhe?.id === pedido.id) setDetalhe((p: any) => ({ ...p, status: novoStatus }))
  }

  async function salvarRastreio(pedido: any) {
    setSalvando(true)
    const sb = createClient()
    await sb.from('marketplace_pedidos').update({
      transportadora: rastreioForm.transportadora || null,
      codigo_rastreio: rastreioForm.codigo_rastreio || null,
      status: 'enviado',
      data_envio: new Date().toISOString(),
    }).eq('id', pedido.id)
    setPedidos(prev => prev.map(p => p.id === pedido.id ? { ...p, ...rastreioForm, status: 'enviado' } : p))
    if (detalhe?.id === pedido.id) setDetalhe((p: any) => ({ ...p, ...rastreioForm, status: 'enviado' }))
    setRastreioForm({ transportadora: '', codigo_rastreio: '' })
    setSalvando(false)
  }

  // Roda a sincronização em todas as lojas Shopee conectadas (ou só na
  // selecionada, se um filtro de loja estiver ativo) e agrega o resultado
  // num resumo único — a rota em si (`sync-pedidos`) não muda, é a mesma
  // usada na tela por canal.
  async function sincronizarPedidos() {
    const alvos = canalFiltro ? canaisShopee.filter(c => c.id === canalFiltro) : canaisShopee
    if (alvos.length === 0) { setResumoSync('Nenhuma loja Shopee conectada para sincronizar.'); return }
    setSincronizando(true); setResumoSync('')
    const partes: string[] = []
    for (const c of alvos) {
      try {
        const resp = await fetch('/api/marketplace/shopee/sync-pedidos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: c.id }),
        })
        const data = await resp.json()
        partes.push(data.ok
          ? `${c.nome}: ${data.upserted} sincronizado(s), ${data.failedCount} falha(s)`
          : `${c.nome}: erro — ${data.erro ?? 'falha ao sincronizar'}`)
      } catch (e: any) {
        partes.push(`${c.nome}: erro — ${e.message ?? 'falha ao sincronizar'}`)
      }
    }
    setResumoSync(partes.join(' · '))
    setSincronizando(false)
    router.refresh()
  }

  function atualizarItemLocal(pedidoId: string, itemId: string, patch: any) {
    setPedidos(prev => prev.map(p => p.id !== pedidoId ? p : {
      ...p, marketplace_pedido_itens: (p.marketplace_pedido_itens ?? []).map((i: any) => i.id === itemId ? { ...i, ...patch } : i),
    }))
    if (detalhe?.id === pedidoId) {
      setDetalhe((p: any) => ({ ...p, marketplace_pedido_itens: (p.marketplace_pedido_itens ?? []).map((i: any) => i.id === itemId ? { ...i, ...patch } : i) }))
    }
  }

  // Item já tem anúncio resolvido na importação → reaproveita o modal de
  // mapeamento existente (mesmo usado na tela de Anúncios). Item órfão (sem
  // anúncio sincronizado) → cai na busca inline abaixo.
  async function abrirMapeamentoItem(item: any) {
    if (!item.anuncio_id) { setBuscaItemId(item.id); setTermoBuscaItem(''); setResultadosBuscaItem([]); return }
    setCarregandoAnuncio(true)
    const sb = createClient()
    const { data } = await sb.from('marketplace_anuncios').select('*').eq('id', item.anuncio_id).single()
    setCarregandoAnuncio(false)
    if (data) { setAnuncioParaMapear(data); setMapeandoItem(item) }
  }

  async function dispararBaixaSeNecessario(item: any) {
    if (detalhe?.status === 'novo' || detalhe?.status === 'cancelado') return // ainda não pago, ou cancelado
    try {
      await fetch('/api/marketplace/shopee/baixar-estoque-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoItemId: item.id }),
      })
    } catch { /* falha aqui não deve travar o mapeamento já salvo — fica pendente pra próxima sincronização */ }
  }

  // etapa_interna só é recalculada automaticamente durante a sincronização —
  // sem isto, um pedido mapeado manualmente ficava travado em "pendência de
  // mapeamento" pra sempre até o próximo sync.
  async function recalcularEtapaLocal(pedidoId: string) {
    try {
      const resp = await fetch('/api/marketplace/shopee/recalcular-etapa-pedido', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoId }),
      })
      const data = await resp.json()
      if (data.ok && data.etapa) {
        setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, etapa_interna: data.etapa } : p))
        if (detalhe?.id === pedidoId) setDetalhe((p: any) => ({ ...p, etapa_interna: data.etapa }))
      }
    } catch { /* não crítico — próxima sincronização recalcula de novo */ }
  }

  async function onAnuncioMapeado(anuncioAtualizado: any) {
    if (!mapeandoItem) return
    const item = mapeandoItem
    const sb = createClient()
    await sb.from('marketplace_pedido_itens').update({ produto_id: anuncioAtualizado.produto_id, status_mapeamento: 'mapeado' }).eq('id', item.id)
    atualizarItemLocal(item.pedido_id, item.id, { produto_id: anuncioAtualizado.produto_id, status_mapeamento: 'mapeado' })
    await dispararBaixaSeNecessario(item)
    await recalcularEtapaLocal(item.pedido_id)
    setMapeandoItem(null); setAnuncioParaMapear(null)
    router.refresh()
  }

  async function vincularItemDireto(item: any, produto: any) {
    const sb = createClient()
    await sb.from('marketplace_pedido_itens').update({ produto_id: produto.id, status_mapeamento: 'mapeado' }).eq('id', item.id)
    atualizarItemLocal(item.pedido_id, item.id, { produto_id: produto.id, status_mapeamento: 'mapeado' })
    await dispararBaixaSeNecessario(item)
    await recalcularEtapaLocal(item.pedido_id)
    setBuscaItemId(null); setTermoBuscaItem(''); setResultadosBuscaItem([])
    router.refresh()
  }

  async function buscarProdutoParaItem(termo: string) {
    setTermoBuscaItem(termo)
    if (termo.trim().length < 2) { setResultadosBuscaItem([]); return }
    const sb = createClient()
    const { data } = await sb.from('produtos')
      .select('id, nome, sku, preco_venda, estoque')
      .eq('empresa_id', empresaId).eq('ativo', true)
      .or(`nome.ilike.%${termo}%,sku.ilike.%${termo}%,ean.ilike.%${termo}%`)
      .limit(8)
    setResultadosBuscaItem(data ?? [])
  }

  function atualizarPacoteLocal(pedidoId: string, patch: any) {
    const aplicar = (p: any) => ({
      ...p,
      marketplace_pedido_pacotes: p.marketplace_pedido_pacotes?.length
        ? p.marketplace_pedido_pacotes.map((pac: any, i: number) => i === 0 ? { ...pac, ...patch } : pac)
        : [{ ...patch }],
    })
    setPedidos(prev => prev.map(p => p.id === pedidoId ? aplicar(p) : p))
    if (detalhe?.id === pedidoId) setDetalhe((p: any) => aplicar(p))
  }

  async function prepararEtiqueta() {
    if (!detalhe) return
    setCarregandoEtiqueta(true); setErroEtiqueta(''); setEtiquetaOpcoes(null)
    try {
      const resp = await fetch('/api/marketplace/shopee/etiqueta/preparar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: detalhe.canal_id, pedidoId: detalhe.id }),
      })
      const data = await resp.json()
      if (!data.ok) { setErroEtiqueta(data.erro ?? 'Erro ao preparar envio'); return }
      setEtiquetaOpcoes(data)
      setEscolhaEnvio({})
    } catch (e: any) {
      setErroEtiqueta(e.message ?? 'Erro ao preparar envio')
    } finally {
      setCarregandoEtiqueta(false)
    }
  }

  async function pollStatusEtiqueta(canalId: string, pedidoId: string, tentativa: number) {
    setPollingEtiqueta(true)
    try {
      const resp = await fetch('/api/marketplace/shopee/etiqueta/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canalId, pedidoId }),
      })
      const data = await resp.json()
      if (data.ok && data.status === 'pronta') {
        atualizarPacoteLocal(pedidoId, { status_etiqueta: 'pronta' })
        setPollingEtiqueta(false); setCarregandoEtiqueta(false); router.refresh()
        return
      }
      if (data.ok && data.status === 'erro') {
        atualizarPacoteLocal(pedidoId, { status_etiqueta: 'erro' })
        setErroEtiqueta(data.erro ?? 'Falha ao gerar etiqueta')
        setPollingEtiqueta(false); setCarregandoEtiqueta(false)
        return
      }
    } catch { /* tenta de novo na próxima rodada */ }
    if (tentativa >= 19) {
      setPollingEtiqueta(false); setCarregandoEtiqueta(false)
      setErroEtiqueta('A etiqueta ainda está sendo processada — tente novamente em instantes.')
      return
    }
    setTimeout(() => pollStatusEtiqueta(canalId, pedidoId, tentativa + 1), 3000)
  }

  async function confirmarEtiqueta() {
    if (!detalhe || !etiquetaOpcoes?.modalidade) return
    setErroEtiqueta('')
    let escolha: any
    if (etiquetaOpcoes.modalidade === 'pickup') {
      if (!escolhaEnvio.addressId) { setErroEtiqueta('Escolha o endereço de coleta.'); return }
      escolha = { modalidade: 'pickup', addressId: Number(escolhaEnvio.addressId) }
    } else if (etiquetaOpcoes.modalidade === 'dropoff') {
      escolha = { modalidade: 'dropoff', branchId: escolhaEnvio.branchId ? Number(escolhaEnvio.branchId) : undefined, slug: escolhaEnvio.slug || undefined }
    } else {
      escolha = { modalidade: 'non_integrated', trackingNumber: escolhaEnvio.trackingNumber || undefined }
    }

    setCarregandoEtiqueta(true)
    try {
      const resp = await fetch('/api/marketplace/shopee/etiqueta/confirmar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: detalhe.canal_id, pedidoId: detalhe.id, escolha }),
      })
      const data = await resp.json()
      if (!data.ok) { setErroEtiqueta(data.erro ?? 'Erro ao confirmar envio'); setCarregandoEtiqueta(false); return }
      atualizarPacoteLocal(detalhe.id, { status_etiqueta: 'processando' })
      setEtiquetaOpcoes(null)
      pollStatusEtiqueta(detalhe.canal_id, detalhe.id, 0)
    } catch (e: any) {
      setErroEtiqueta(e.message ?? 'Erro ao confirmar envio')
      setCarregandoEtiqueta(false)
    }
  }

  async function baixarEtiquetaAction() {
    if (!detalhe) return
    setCarregandoEtiqueta(true); setErroEtiqueta('')
    try {
      const resp = await fetch('/api/marketplace/shopee/etiqueta/baixar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: detalhe.canal_id, pedidoId: detalhe.id }),
      })
      const data = await resp.json()
      if (!data.ok) { setErroEtiqueta(data.erro ?? 'Erro ao baixar etiqueta'); return }
      window.open(data.url, '_blank')
    } catch (e: any) {
      setErroEtiqueta(e.message ?? 'Erro ao baixar etiqueta')
    } finally {
      setCarregandoEtiqueta(false)
    }
  }

  const filtrados = pedidos.filter(p => {
    const matchQ = !q || (p.cliente_nome ?? '').toLowerCase().includes(q.toLowerCase()) || (p.numero_pedido ?? '').includes(q) || p.id_externo.includes(q)
    const matchS = !statusFiltro || p.status === statusFiltro
    const matchC = !canalFiltro || p.canal_id === canalFiltro
    const matchE = !etapaFiltro || p.etapa_interna === etapaFiltro
    const matchAtraso = !somenteAtrasados || !!prazoInfo(p)?.texto.startsWith('Atrasado')
    return matchQ && matchS && matchC && matchE && matchAtraso
  })

  const contagemEtapas: Record<string, number> = {}
  for (const p of pedidos) contagemEtapas[p.etapa_interna ?? 'novo'] = (contagemEtapas[p.etapa_interna ?? 'novo'] ?? 0) + 1
  const atrasados = pedidos.filter(p => prazoInfo(p)?.texto.startsWith('Atrasado')).length

  const faturamento = pedidos.filter(p => !['cancelado', 'devolvido'].includes(p.status)).reduce((s, p) => s + Number(p.valor_total), 0)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/marketplaces" className="hover:text-gray-600">marketplaces</a><span>›</span>
        <span className="text-gray-600 font-medium">pedidos</span>
      </div>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Pedidos de E-commerce</h1>
          <p className="text-gray-500 text-sm mt-0.5">{pedidos.length} pedidos · {fmt(faturamento)} faturados · todas as lojas conectadas</p>
        </div>
        <div className="flex gap-2">
          {canaisShopee.length > 0 && (
            <button onClick={sincronizarPedidos} disabled={sincronizando}
              className="px-4 py-2 border border-blue-300 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors">
              {sincronizando ? 'Sincronizando...' : '↺ Sincronizar pedidos'}
            </button>
          )}
          <button onClick={() => setModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Lançar pedido manual
          </button>
        </div>
      </div>

      {resumoSync && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>{resumoSync}</span>
          <button onClick={() => setResumoSync('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      {/* Cards status (comercial) */}
      <div className="grid grid-cols-5 gap-3 mb-3">
        {[['novo','Novos','blue'],['confirmado','Confirmados','green'],['enviado','Enviados','cyan'],['entregue','Entregues','green'],['cancelado','Cancelados','red']].map(([s, l, c]) => {
          const n = pedidos.filter(p => p.status === s).length
          return (
            <button key={s} onClick={() => setStatusFiltro(statusFiltro === s ? '' : s)}
              className={`bg-white border rounded-xl p-3 text-left transition-all ${statusFiltro === s ? 'border-blue-400 ring-1 ring-blue-400' : 'border-gray-200 hover:border-gray-300'}`}>
              <p className="text-xs text-gray-500">{l}</p>
              <p className={`text-xl font-bold ${n > 0 && s === 'novo' ? 'text-orange-500' : 'text-gray-900'}`}>{n}</p>
            </button>
          )
        })}
      </div>

      {/* Indicadores por etapa operacional interna */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        <span className="text-xs text-gray-400 mr-1">Etapa:</span>
        {(['pendencia_mapeamento','pronto_expedicao','com_pendencia'] as const).map(e => (
          <button key={e} onClick={() => setEtapaFiltro(etapaFiltro === e ? '' : e)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${etapaFiltro === e ? `${ETAPA_CORES[e]} border-transparent font-medium` : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
            {ETAPA_LABEL[e]} ({contagemEtapas[e] ?? 0})
          </button>
        ))}
        <button onClick={() => setSomenteAtrasados(v => !v)}
          className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${somenteAtrasados ? 'bg-red-600 text-white border-red-600 font-medium' : atrasados > 0 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-gray-400 border-gray-200'}`}>
          Atrasados ({atrasados})
        </button>
        {etapaFiltro && (
          <button onClick={() => setEtapaFiltro('')} className="text-xs text-gray-400 hover:text-gray-600 ml-1">✕ limpar etapa</button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente, nº pedido, ID..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-72 bg-white" />
        <select value={canalFiltro} onChange={e => setCanalFiltro(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
          <option value="">Todas as lojas</option>
          {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {statusFiltro && (
          <button onClick={() => setStatusFiltro('')} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_CORES[statusFiltro]}`}>{STATUS_LABEL[statusFiltro]}</span>
            ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* Lista */}
        <div className="col-span-3 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Pedido / Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Loja</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Etapa</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Prazo</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Total</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(p => {
                const prazo = prazoInfo(p)
                return (
                <tr key={p.id} onClick={() => { setDetalhe(p); setEtiquetaOpcoes(null); setErroEtiqueta(''); setEscolhaEnvio({}) }}
                  className={`hover:bg-blue-50 transition-colors cursor-pointer ${detalhe?.id === p.id ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 text-xs">{p.numero_pedido || p.id_externo}</p>
                    <p className="text-xs text-gray-500">{p.cliente_nome || '—'}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{fmtData(p.data_pedido)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[6rem]" title={p.marketplace_canais?.nome}>
                    {p.marketplace_canais?.nome ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {p.etapa_interna && p.etapa_interna !== 'novo' && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ETAPA_CORES[p.etapa_interna] ?? 'bg-gray-100 text-gray-500'}`}>
                        {ETAPA_LABEL[p.etapa_interna] ?? p.etapa_interna}
                      </span>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-xs ${prazo?.cor ?? 'text-gray-300'}`}>{prazo?.texto ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 text-sm">{fmt(Number(p.valor_total))}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CORES[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                </tr>
              )})}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-gray-400 text-sm">Nenhum pedido encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detalhe do pedido selecionado */}
        <div className="col-span-2">
          {detalhe ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 sticky top-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{detalhe.numero_pedido || detalhe.id_externo}</h3>
                  <p className="text-xs text-gray-400 font-mono">ID: {detalhe.id_externo}</p>
                  <p className="text-xs text-gray-400">{detalhe.marketplace_canais?.nome}</p>
                </div>
                <select value={detalhe.status} onChange={e => atualizarStatus(detalhe, e.target.value)}
                  className={`text-xs font-medium px-2 py-1 rounded-lg border-0 focus:outline-none cursor-pointer ${STATUS_CORES[detalhe.status]}`}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {/* Cliente */}
              {detalhe.cliente_nome && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Cliente</p>
                  <p className="text-sm text-gray-900">{detalhe.cliente_nome}</p>
                  {detalhe.cliente_email && <p className="text-xs text-gray-500">{detalhe.cliente_email}</p>}
                  {detalhe.cliente_doc && <p className="text-xs text-gray-400 font-mono">{detalhe.cliente_doc}</p>}
                </div>
              )}

              {/* Endereço */}
              {detalhe.entrega_logradouro && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Entrega</p>
                  <p className="text-xs text-gray-600">
                    {detalhe.entrega_logradouro}, {detalhe.entrega_numero}<br />
                    {detalhe.entrega_bairro} — {detalhe.entrega_cidade}/{detalhe.entrega_estado}<br />
                    CEP {detalhe.entrega_cep}
                  </p>
                </div>
              )}

              {/* Itens */}
              {detalhe.marketplace_pedido_itens?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Itens</p>
                  <div className="space-y-2">
                    {detalhe.marketplace_pedido_itens.map((item: any) => (
                      <div key={item.id} className="text-xs border border-gray-100 rounded-lg px-2.5 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-700">{item.quantidade}× {item.nome_produto}</span>
                          <span className="text-gray-900 font-medium">{fmt(Number(item.subtotal))}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          {item.status_mapeamento === 'mapeado' ? (
                            <span className="text-emerald-600">✓ mapeado{item.baixou_estoque ? ' · estoque baixado' : ''}</span>
                          ) : (
                            <span className="text-amber-600">⚠ sem produto vinculado</span>
                          )}
                          {item.status_mapeamento !== 'mapeado' && (
                            <button onClick={() => abrirMapeamentoItem(item)} disabled={carregandoAnuncio}
                              className="text-blue-600 hover:text-blue-800 font-medium">Mapear</button>
                          )}
                        </div>
                        {buscaItemId === item.id && (
                          <div className="mt-2 border border-blue-200 bg-blue-50/40 rounded-lg p-2 space-y-1.5">
                            <p className="text-[11px] text-gray-500">Anúncio não sincronizado no catálogo — vincule direto a um produto:</p>
                            <input value={termoBuscaItem} onChange={e => buscarProdutoParaItem(e.target.value)} autoFocus
                              placeholder="Nome, SKU ou EAN..."
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 bg-white" />
                            {resultadosBuscaItem.length > 0 && (
                              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                                {resultadosBuscaItem.map(prod => (
                                  <button key={prod.id} onClick={() => vincularItemDireto(item, prod)}
                                    className="w-full text-left px-2.5 py-1.5 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                                    <p className="text-gray-900 font-medium">{prod.nome}</p>
                                    <p className="text-[11px] text-gray-400">{prod.sku} · {fmt(prod.preco_venda)} · Estoque: {prod.estoque}</p>
                                  </button>
                                ))}
                              </div>
                            )}
                            <button onClick={() => setBuscaItemId(null)} className="text-[11px] text-gray-400 hover:text-gray-600">cancelar</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Valores */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Produtos</span><span>{fmt(Number(detalhe.valor_produtos))}</span>
                </div>
                {Number(detalhe.valor_frete) > 0 && (
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Frete</span><span>{fmt(Number(detalhe.valor_frete))}</span>
                  </div>
                )}
                {Number(detalhe.valor_desconto) > 0 && (
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Desconto</span><span>-{fmt(Number(detalhe.valor_desconto))}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
                  <span>Total</span><span>{fmt(Number(detalhe.valor_total))}</span>
                </div>
              </div>

              {/* Etiqueta de envio (Shopee) */}
              {detalhe.marketplace_canais?.plataforma === 'shopee' && (
                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-600">Etiqueta de envio</p>
                  {(() => {
                    const pacote = detalhe.marketplace_pedido_pacotes?.[0]
                    if (pacote?.status_etiqueta === 'pronta') {
                      return (
                        <>
                          {pacote.codigo_rastreio && <p className="text-xs text-gray-600">Rastreio: <span className="font-mono">{pacote.codigo_rastreio}</span></p>}
                          <button onClick={baixarEtiquetaAction} disabled={carregandoEtiqueta}
                            className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
                            {carregandoEtiqueta ? 'Abrindo...' : '🖨 Baixar / reimprimir etiqueta'}
                          </button>
                        </>
                      )
                    }
                    if (pollingEtiqueta || pacote?.status_etiqueta === 'processando') {
                      return <p className="text-xs text-gray-500">Gerando etiqueta na Shopee... isso pode levar alguns segundos.</p>
                    }
                    if (etiquetaOpcoes) {
                      return (
                        <div className="space-y-2">
                          {etiquetaOpcoes.modalidade === 'pickup' && (
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Endereço de coleta</label>
                              <select value={escolhaEnvio.addressId ?? ''} onChange={e => setEscolhaEnvio(p => ({ ...p, addressId: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
                                <option value="">Selecione...</option>
                                {etiquetaOpcoes.enderecosColeta.map((a: any, i: number) => (
                                  <option key={a.address_id ?? i} value={a.address_id}>{a.address ?? a.full_address ?? `Endereço ${i + 1}`}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          {etiquetaOpcoes.modalidade === 'dropoff' && etiquetaOpcoes.filiaisDropoff.length > 0 && (
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Filial de postagem</label>
                              <select value={escolhaEnvio.branchId ?? ''} onChange={e => setEscolhaEnvio(p => ({ ...p, branchId: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
                                <option value="">Selecione...</option>
                                {etiquetaOpcoes.filiaisDropoff.map((b: any, i: number) => (
                                  <option key={b.branch_id ?? i} value={b.branch_id}>{b.name ?? b.branch_name ?? `Filial ${i + 1}`}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          {etiquetaOpcoes.modalidade === 'non_integrated' && (
                            <input value={escolhaEnvio.trackingNumber ?? ''} onChange={e => setEscolhaEnvio(p => ({ ...p, trackingNumber: e.target.value }))}
                              placeholder="Código de rastreio (opcional)"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                          )}
                          <button onClick={confirmarEtiqueta} disabled={carregandoEtiqueta}
                            className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
                            {carregandoEtiqueta ? 'Confirmando...' : 'Confirmar e gerar etiqueta'}
                          </button>
                        </div>
                      )
                    }
                    return (
                      <button onClick={prepararEtiqueta} disabled={carregandoEtiqueta}
                        className="w-full py-1.5 border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-xs font-medium rounded-lg transition-colors">
                        {carregandoEtiqueta ? 'Consultando...' : 'Preparar envio'}
                      </button>
                    )
                  })()}
                  {erroEtiqueta && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">{erroEtiqueta}</p>}
                </div>
              )}

              {/* Rastreio */}
              {['confirmado','faturado'].includes(detalhe.status) && (
                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-600">Informar envio</p>
                  <input value={rastreioForm.transportadora} onChange={e => setRastreioForm(p => ({ ...p, transportadora: e.target.value }))}
                    placeholder="Transportadora"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                  <input value={rastreioForm.codigo_rastreio} onChange={e => setRastreioForm(p => ({ ...p, codigo_rastreio: e.target.value }))}
                    placeholder="Código de rastreio"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                  <button onClick={() => salvarRastreio(detalhe)} disabled={salvando}
                    className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium rounded-lg transition-colors">
                    Marcar como enviado
                  </button>
                </div>
              )}

              {detalhe.codigo_rastreio && (
                <div className="text-xs text-gray-600">
                  <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Rastreio</p>
                  <p>{detalhe.transportadora} · <span className="font-mono">{detalhe.codigo_rastreio}</span></p>
                </div>
              )}

              {detalhe.observacoes && (
                <p className="text-xs text-gray-500 italic border-t border-gray-100 pt-3">{detalhe.observacoes}</p>
              )}
            </div>
          ) : (
            <div className="bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-400">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm">Selecione um pedido para ver os detalhes</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal lançar pedido manual */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">Lançar Pedido Manual</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Loja *</label>
                  <select value={formPedido.canal_id} onChange={e => fp('canal_id', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    <option value="">Selecione a loja</option>
                    {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
                <FP label="ID externo *" value={formPedido.id_externo} onChange={v => fp('id_externo', v)} placeholder="ID na plataforma" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FP label="Nº do pedido" value={formPedido.numero_pedido} onChange={v => fp('numero_pedido', v)} />
                <FP label="Nome do cliente" value={formPedido.cliente_nome} onChange={v => fp('cliente_nome', v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FP label="E-mail" value={formPedido.cliente_email} onChange={v => fp('cliente_email', v)} />
                <FP label="CPF/CNPJ" value={formPedido.cliente_doc} onChange={v => fp('cliente_doc', v)} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <FP label="Valor produtos (R$)" value={formPedido.valor_produtos} onChange={v => fp('valor_produtos', v)} />
                <FP label="Frete (R$)" value={formPedido.valor_frete} onChange={v => fp('valor_frete', v)} />
                <FP label="Desconto (R$)" value={formPedido.valor_desconto} onChange={v => fp('valor_desconto', v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FP label="Data do pedido" value={formPedido.data_pedido} onChange={v => fp('data_pedido', v)} type="datetime-local" />
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status inicial</label>
                  <select value={formPedido.status} onChange={e => fp('status', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Itens */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Itens do pedido</label>
                  <button onClick={() => setItensForm(p => [...p, { nome_produto: '', quantidade: '1', preco_unitario: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-700">+ Adicionar item</button>
                </div>
                <div className="space-y-2">
                  {itensForm.map((it, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input value={it.nome_produto} onChange={e => setItensForm(p => p.map((x, j) => j === i ? { ...x, nome_produto: e.target.value } : x))}
                        placeholder="Nome do produto"
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                      <input type="number" value={it.quantidade} onChange={e => setItensForm(p => p.map((x, j) => j === i ? { ...x, quantidade: e.target.value } : x))}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 text-center" placeholder="Qtd" />
                      <input type="number" step="0.01" value={it.preco_unitario} onChange={e => setItensForm(p => p.map((x, j) => j === i ? { ...x, preco_unitario: e.target.value } : x))}
                        className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 text-right" placeholder="R$ unit." />
                      {itensForm.length > 1 && (
                        <button onClick={() => setItensForm(p => p.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 text-lg">×</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <FP label="Observações" value={formPedido.observacoes} onChange={v => fp('observacoes', v)} />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvarPedido} disabled={salvando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : 'Lançar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mapeandoItem && anuncioParaMapear && detalhe && (
        <MapearAnuncioModal
          anuncio={anuncioParaMapear}
          canal={detalhe.marketplace_canais}
          empresaId={empresaId}
          operador={operador}
          onClose={() => { setMapeandoItem(null); setAnuncioParaMapear(null) }}
          onAtualizado={onAnuncioMapeado}
        />
      )}
    </div>
  )
}

function FP({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
    </div>
  )
}
