'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import MapearAnuncioModal from './MapearAnuncioModal'
import RomaneioModal from '@/components/pedidos/RomaneioModal'
import { ehHoje } from './utils'
import { ESTEIRA, ESTEIRA_INFO, emAberto, etapaEsteira, fimDeHoje, janelaDoPrazo, notaResolvida, etiquetaImpressa, textoPrazo, type EtapaEsteira } from '@/lib/pedidos/esteira'
import { meioDeEnvio, numeroInterno, NOME_PLATAFORMA } from '@/lib/pedidos/envio'

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

// Abas abaixo dos passos. Os passos 1–4 são escolhidos pelos cards.
type Aba = 'abertos' | 'todos' | EtapaEsteira
// As etapas da esteira viram abas (antes eram cards à parte): uma linha só
// diz onde está cada pedido e deixa o resto da tela para a lista.
const PASSOS = ESTEIRA.filter(e => e.numero)
const ABAS: [Aba, string][] = [
  ['abertos', 'Em aberto'],
  ...PASSOS.map(e => [e.valor, `${e.numero}. ${e.label}`] as [Aba, string]),
  ['pendencia', ESTEIRA_INFO.pendencia.label],
  ['enviado', ESTEIRA_INFO.enviado.label],
  ['entregue', ESTEIRA_INFO.entregue.label],
  ['cancelado', ESTEIRA_INFO.cancelado.label],
  ['todos', 'Todos'],
]
const JANELAS: ['' | 'hoje' | 'atrasado' | 'futuro', string][] = [
  ['', 'Todos os prazos'], ['atrasado', 'Atrasados'], ['hoje', 'Sai hoje'], ['futuro', 'Reservados (envio futuro)'],
]

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtData(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}


export default function PedidosEcommerceClient({ canais, pedidos: pedidosIniciais, totalReal, empresaId, empresaEstoqueNome, empresaFiscalNome, emissorPorCanal, qInicial, canalIdInicial, operador }: {
  canais: any[]; pedidos: any[]; totalReal: number; empresaId: string
  // Config da conta (Empresas → Estoque/Fiscal) — igual em toda linha hoje,
  // já que não existe override por canal ainda.
  empresaEstoqueNome: string; empresaFiscalNome: string
  // Empresa que emite a nota de cada canal (Configurar → canal).
  emissorPorCanal: Record<string, string>
  qInicial: string; canalIdInicial: string; operador: string
}) {
  const router = useRouter()
  const [pedidos, setPedidos] = useState(pedidosIniciais)
  // router.refresh() busca props novas do servidor, mas useState só usa o
  // valor inicial — sem este efeito a lista fica travada na primeira carga
  // mesmo depois de um sync bem-sucedido (o dado chega no banco, mas nunca
  // aparece na tela até um F5 manual).
  useEffect(() => { setPedidos(pedidosIniciais) }, [pedidosIniciais])
  const [q, setQ] = useState(qInicial)
  const [canalFiltro, setCanalFiltro] = useState(canalIdInicial)
  const [aba, setAba] = useState<Aba>('abertos')
  const [plataformaFiltro, setPlataformaFiltro] = useState('')
  const [meioFiltro, setMeioFiltro] = useState('')
  const [soNfEmitida, setSoNfEmitida] = useState(false)
  const [soImpressa, setSoImpressa] = useState(false)
  const [janela, setJanela] = useState<'' | 'hoje' | 'atrasado' | 'futuro'>('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [romaneio, setRomaneio] = useState<{ fonte: string; id: string }[] | null>(null)
  const [marcandoImpressao, setMarcandoImpressao] = useState(false)
  const [avisoAcao, setAvisoAcao] = useState('')
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
  const [baixandoItemId, setBaixandoItemId] = useState<string | null>(null)
  const [termoBuscaItem, setTermoBuscaItem] = useState('')
  const [resultadosBuscaItem, setResultadosBuscaItem] = useState<any[]>([])

  // Etiqueta de envio (Shopee)
  const [etiquetaOpcoes, setEtiquetaOpcoes] = useState<{ modalidade: string | null; enderecosColeta: any[]; filiaisDropoff: any[]; slugsDropoff: any[] } | null>(null)
  const [escolhaEnvio, setEscolhaEnvio] = useState<{ addressId?: string; branchId?: string; slug?: string; trackingNumber?: string }>({})
  const [carregandoEtiqueta, setCarregandoEtiqueta] = useState(false)
  const [pollingEtiqueta, setPollingEtiqueta] = useState(false)
  const [erroEtiqueta, setErroEtiqueta] = useState('')

  // Informar NF-e (registro manual — pra quem já emitiu por fora)
  const [nfeForm, setNfeForm] = useState({ numero: '', chave: '' })
  const [salvandoNfe, setSalvandoNfe] = useState(false)

  // Emissão fiscal real (via venda criada sob demanda a partir do pedido)
  const [nfceStatus, setNfceStatus] = useState<{
    status?: string; numero?: string; chave?: string; danfeUrl?: string; motivoRejeicao?: string
  } | null>(null)
  const [emitindoNfce, setEmitindoNfce] = useState(false)
  const [erroEmitirNfce, setErroEmitirNfce] = useState('')

  const canaisSincronizaveis = canais.filter(c => (c.plataforma === 'shopee' || c.plataforma === 'mercadolivre' || c.plataforma === 'tiktok') && c.ativo && c.access_token)

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

  // Só registra número/chave informados manualmente — não emite NF-e de
  // verdade (nenhuma infra fiscal de saída existe no sistema hoje).
  async function salvarNfe(pedido: any) {
    if (!nfeForm.numero.trim()) { alert('Informe ao menos o número da NF-e.'); return }
    setSalvandoNfe(true)
    const sb = createClient()
    const patch = { nfe_numero: nfeForm.numero.trim(), nfe_chave: nfeForm.chave.trim() || null, nfe_informada_em: new Date().toISOString() }
    await sb.from('marketplace_pedidos').update(patch).eq('id', pedido.id)
    setPedidos(prev => prev.map(p => p.id === pedido.id ? { ...p, ...patch } : p))
    if (detalhe?.id === pedido.id) setDetalhe((p: any) => ({ ...p, ...patch }))
    setNfeForm({ numero: '', chave: '' })
    setSalvandoNfe(false)
  }

  // Emissão fiscal real: se o pedido já tem venda vinculada, busca o status
  // atual (mesmo padrão de DetalheVendaModal.tsx); senão fica pendente até
  // o primeiro "Emitir NF-e".
  async function abrirNotaFiscal(pedido: any) {
    setErroEmitirNfce('')
    if (!pedido.venda_id) { setNfceStatus(null); return }
    const sb = createClient()
    const { data } = await sb.from('vendas')
      .select('nfce_status, nfce_numero, nfce_chave, nfce_motivo_rejeicao, nfce_url_pdf')
      .eq('id', pedido.venda_id).maybeSingle()
    setNfceStatus(data ? {
      status: data.nfce_status, numero: data.nfce_numero, chave: data.nfce_chave,
      motivoRejeicao: data.nfce_motivo_rejeicao, danfeUrl: data.nfce_url_pdf,
    } : null)
  }

  async function emitirNfceDoPedido(pedido: any) {
    setEmitindoNfce(true)
    setErroEmitirNfce('')
    try {
      const resp = await fetch(`/api/marketplaces/pedidos/${pedido.id}/emitir-nfce`, { method: 'POST' })
      const data = await resp.json()
      if (!data.ok && !data.jaEmitida) { setErroEmitirNfce(data.erro ?? 'Erro ao emitir NF-e'); setNfceStatus({ status: 'erro', motivoRejeicao: data.erro }); return }
      setNfceStatus({ status: data.status, numero: data.numero, chave: data.chave, danfeUrl: data.danfeUrl, motivoRejeicao: data.motivoRejeicao })
      // O pedido pode não ter venda_id ainda na lista local (primeira emissão) — atualiza pra reabrir corretamente depois.
      setPedidos(prev => prev.map(p => p.id === pedido.id ? { ...p, venda_id: p.venda_id } : p))
      router.refresh()
    } catch (e: any) {
      setErroEmitirNfce(e?.message ?? 'Erro ao emitir NF-e')
    } finally {
      setEmitindoNfce(false)
    }
  }

  // Marca/desmarca a etiqueta como impressa (passo 3 → 4 da esteira).
  async function marcarImpressao(ids: string[], impresso: boolean) {
    if (ids.length === 0) return
    setMarcandoImpressao(true); setAvisoAcao('')
    try {
      const resp = await fetch('/api/pedidos/impressao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, impresso }),
      })
      const data = await resp.json()
      if (!data.ok) { setAvisoAcao(data.erro ?? 'Erro ao registrar impressão'); return }
      const alterados = new Set<string>(data.alterados ?? [])
      const patch = impresso
        ? { etiqueta_impressa_em: new Date().toISOString(), etiqueta_impressa_por: operador }
        : { etiqueta_impressa_em: null, etiqueta_impressa_por: null }
      setPedidos(prev => prev.map(p => alterados.has(p.id) ? { ...p, ...patch } : p))
      if (detalhe && alterados.has(detalhe.id)) setDetalhe((p: any) => ({ ...p, ...patch }))
      setSelecionados(new Set())
      const ignorados = ids.length - alterados.size
      setAvisoAcao((impresso
        ? `${alterados.size} pedido(s) marcado(s) como impresso(s) — foram para "Aguardando postagem".`
        : `${alterados.size} pedido(s) voltaram para "Imprimir etiqueta".`)
        + (ignorados > 0 ? ` ${ignorados} já estava(m) assim.` : ''))
      router.refresh()
    } catch (e: any) {
      setAvisoAcao(e?.message ?? 'Erro ao registrar impressão')
    } finally {
      setMarcandoImpressao(false)
    }
  }

  // Roda a sincronização em todas as lojas Shopee/Mercado Livre/TikTok Shop
  // conectadas (ou só na selecionada, se um filtro de loja estiver ativo) e
  // agrega o resultado num resumo único — a rota (`sync-pedidos`) muda por
  // plataforma, mas o formato de resposta é o mesmo nas três.
  async function sincronizarPedidos() {
    const alvos = canalFiltro ? canaisSincronizaveis.filter(c => c.id === canalFiltro) : canaisSincronizaveis
    if (alvos.length === 0) { setResumoSync('Nenhuma loja Shopee, Mercado Livre ou TikTok Shop conectada para sincronizar.'); return }
    setSincronizando(true); setResumoSync('')
    // Cada loja é uma chamada independente ao marketplace — rodar em paralelo
    // em vez de sequencial evita que a espera total seja a soma do tempo de
    // todas as lojas (antes, a 2ª loja só começava depois da 1ª terminar).
    const resultados = await Promise.all(alvos.map(async c => {
      try {
        const endpoint = c.plataforma === 'mercadolivre' ? '/api/marketplace/mercadolivre/sync-pedidos'
          : c.plataforma === 'tiktok' ? '/api/marketplace/tiktok/sync-pedidos'
          : '/api/marketplace/shopee/sync-pedidos'
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: c.id }),
        })
        const data = await resp.json()
        return data.ok
          ? `${c.nome}: ${data.upserted} sincronizado(s), ${data.failedCount} falha(s)`
          : `${c.nome}: erro — ${data.erro ?? 'falha ao sincronizar'}`
      } catch (e: any) {
        return `${c.nome}: erro — ${e.message ?? 'falha ao sincronizar'}`
      }
    }))
    setResumoSync(resultados.join(' · '))
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

  // Item já mapeado mas a baixa falhou (normalmente "estoque insuficiente" —
  // ver pendencia_motivo do pedido) fica travado pra sempre sem isso: nada
  // tenta baixar de novo automaticamente depois que o produto é reabastecido.
  async function tentarBaixarEstoqueDeNovo(item: any) {
    setBaixandoItemId(item.id)
    try {
      const resp = await fetch('/api/marketplace/shopee/baixar-estoque-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoItemId: item.id }),
      })
      const data = await resp.json()
      if (!data.ok) { alert(data.erro ?? 'Erro ao baixar estoque.'); return }
      atualizarItemLocal(item.pedido_id, item.id, { baixou_estoque: true })
      await recalcularEtapaLocal(item.pedido_id)
      router.refresh()
    } catch (e: any) {
      alert(e.message ?? 'Erro ao baixar estoque.')
    } finally {
      setBaixandoItemId(null)
    }
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
      // A rota já registrou a impressão (primeira vez) — reflete na tela.
      if (!detalhe.etiqueta_impressa_em) {
        const patch = { etiqueta_impressa_em: new Date().toISOString(), etiqueta_impressa_por: operador }
        setPedidos(prev => prev.map(p => p.id === detalhe.id ? { ...p, ...patch } : p))
        setDetalhe((p: any) => ({ ...p, ...patch }))
      }
    } catch (e: any) {
      setErroEtiqueta(e.message ?? 'Erro ao baixar etiqueta')
    } finally {
      setCarregandoEtiqueta(false)
    }
  }

  // Cada pedido com sua etapa na esteira e a janela do prazo — calculados
  // uma vez por render e usados pela lista, pelos contadores e pelo painel.
  const agora = new Date()
  const base = pedidos
    .map(p => ({ p, etapa: etapaEsteira(p, agora), janela: janelaDoPrazo(p, agora), envio: meioDeEnvio(p) }))
    .filter(({ p, envio }) => {
      const termo = q.trim().toLowerCase()
      // Busca também por produto e SKU: é como o separador procura ("cadê o
      // pedido do arame farpado?"), não pelo número do marketplace.
      const matchQ = !termo || [
        p.cliente_nome, p.numero_pedido, p.id_externo, numeroInterno(p),
        ...(p.marketplace_pedido_itens ?? []).flatMap((i: any) => [i.nome_produto, i.sku, i.produtos?.nome, i.produtos?.sku]),
      ].some(v => String(v ?? '').toLowerCase().includes(termo))
      const matchC = !canalFiltro || p.canal_id === canalFiltro
      const matchP = !plataformaFiltro || p.marketplace_canais?.plataforma === plataformaFiltro
      const matchM = !meioFiltro || (envio.meio ?? 'Sem informação') === meioFiltro
      const matchNf = !soNfEmitida || notaResolvida(p)
      const matchImp = !soImpressa || etiquetaImpressa(p)
      return matchQ && matchC && matchP && matchM && matchNf && matchImp
    })

  const contagem: Record<string, number> = {}
  const urgentesPorEtapa: Record<string, { hoje: number; atrasado: number }> = {}
  let saemHoje = 0, atrasados = 0, impressosHoje = 0, totalAbertos = 0
  for (const x of base) {
    contagem[x.etapa] = (contagem[x.etapa] ?? 0) + 1
    if (x.p.etiqueta_impressa_em && ehHoje(x.p.etiqueta_impressa_em)) impressosHoje++
    if (!emAberto(x.etapa)) continue
    totalAbertos++
    // Sem pagamento não conta como "tem que sair hoje".
    if (x.p.status === 'novo') continue
    const u = (urgentesPorEtapa[x.etapa] ??= { hoje: 0, atrasado: 0 })
    if (x.janela === 'atrasado') { atrasados++; u.atrasado++ }
    else if (x.janela === 'hoje' || x.janela === 'sem_prazo') { saemHoje++; u.hoje++ }
  }

  const plataformasPresentes = [...new Set(pedidos.map((p: any) => p.marketplace_canais?.plataforma).filter(Boolean))] as string[]
  const meiosPresentes = [...new Set(pedidos.map((p: any) => meioDeEnvio(p).meio ?? 'Sem informação'))].sort()
  const abrirPedido = (p: any) => {
    setDetalhe(p); setEtiquetaOpcoes(null); setErroEtiqueta(''); setEscolhaEnvio({}); setNfeForm({ numero: '', chave: '' }); abrirNotaFiscal(p)
  }

  const abaEmAberto = aba === 'abertos' || (aba !== 'todos' && emAberto(aba))
  const prazoMs = (p: any) => p.prazo_postagem ? new Date(p.prazo_postagem).getTime() : fimDeHoje(agora).getTime()
  const filtrados = base
    .filter(x => {
      const matchAba = aba === 'todos' ? true : aba === 'abertos' ? emAberto(x.etapa) : x.etapa === aba
      const matchJanela = !abaEmAberto || !janela
        || (janela === 'hoje' ? (x.janela === 'hoje' || x.janela === 'sem_prazo') : x.janela === janela)
      return matchAba && matchJanela
    })
    // Em aberto: o que vence primeiro no topo. Histórico: o mais recente.
    .sort((a, b) => abaEmAberto
      ? prazoMs(a.p) - prazoMs(b.p)
      : new Date(b.p.data_pedido ?? 0).getTime() - new Date(a.p.data_pedido ?? 0).getTime())

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/marketplaces" className="hover:text-gray-600">marketplaces</a><span>›</span>
        <span className="text-gray-600 font-medium">pedidos</span>
      </div>

      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Pedidos de E-commerce</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {totalAbertos} em aberto · {totalReal} pedidos no total · todas as lojas conectadas
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.refresh()} title="Recarrega a lista a partir do banco, sem chamar os marketplaces"
            className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
            🔄 Atualizar
          </button>
          {canaisSincronizaveis.length > 0 && (
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

      <div className="mb-5">
        <p className="text-xs text-gray-400">
          📦 Estoque debitado de: <strong className="text-gray-600">{empresaEstoqueNome}</strong>
          {' · '}🧾 Nota fiscal emitida por: <strong className="text-gray-600">
            {new Set(Object.values(emissorPorCanal)).size > 1 ? 'depende do canal (Configurar → canal)' : (Object.values(emissorPorCanal)[0] || empresaFiscalNome)}
          </strong>
        </p>
      </div>

      {resumoSync && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>{resumoSync}</span>
          <button onClick={() => setResumoSync('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      {/* Painel do dia */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="text-gray-500 font-medium">Hoje</span>
        <button onClick={() => { setAba('abertos'); setJanela('hoje') }} className="hover:underline">
          <strong className={saemHoje > 0 ? 'text-orange-600' : 'text-gray-900'}>{saemHoje}</strong> <span className="text-gray-600">para sair hoje</span>
        </button>
        <button onClick={() => { setAba('abertos'); setJanela('atrasado') }} className="hover:underline">
          <strong className={atrasados > 0 ? 'text-red-600' : 'text-gray-900'}>{atrasados}</strong> <span className="text-gray-600">atrasado(s)</span>
        </button>
        <span><strong className="text-gray-900">{impressosHoje}</strong> <span className="text-gray-600">etiqueta(s) impressa(s) hoje</span></span>
        {(contagem.pendencia ?? 0) > 0 && (
          <button onClick={() => { setAba('pendencia'); setJanela('') }} className="text-amber-700 hover:underline">
            ⚠ {contagem.pendencia} com pendência
          </button>
        )}
      </div>

      {/* Filtros: marketplace, canal, meio de envio, busca, nota e etiqueta */}
      <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {['', ...plataformasPresentes].map(pl => (
            <button key={pl || 'todos'} onClick={() => setPlataformaFiltro(pl)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${plataformaFiltro === pl ? 'bg-blue-600 text-white border-blue-600 font-medium' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {pl ? (NOME_PLATAFORMA[pl] ?? pl) : 'Todos'}
            </button>
          ))}
        </div>
        <select value={canalFiltro} onChange={e => setCanalFiltro(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 bg-white">
          <option value="">Todos os canais</option>
          {canais.filter(c => !plataformaFiltro || c.plataforma === plataformaFiltro).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select value={meioFiltro} onChange={e => setMeioFiltro(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 bg-white">
          <option value="">Todo meio de envio</option>
          {meiosPresentes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cliente, produto, SKU, nº do pedido..."
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500 flex-1 min-w-[180px] bg-white" />
        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={soNfEmitida} onChange={e => setSoNfEmitida(e.target.checked)} /> NF emitida
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={soImpressa} onChange={e => setSoImpressa(e.target.checked)} /> Etiqueta impressa
        </label>
      </div>

      {/* Abas: em aberto, pendências, histórico */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200 flex-wrap">
        {ABAS.map(([chave, label]) => {
          const ativo = aba === chave
          const n = chave === 'todos' ? base.length : chave === 'abertos' ? totalAbertos : (contagem[chave] ?? 0)
          return (
            <button key={chave} onClick={() => { setAba(chave); if (!emAberto(chave as EtapaEsteira) && chave !== 'abertos') setJanela('') }}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${ativo ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label} <span className={ativo ? 'text-blue-400' : 'text-gray-400'}>({n})</span>
            </button>
          )
        })}
        {abaEmAberto && (
          <div className="ml-auto mb-1 flex items-center gap-1">
            {JANELAS.map(([chave, label]) => (
              <button key={chave || 'todas'} onClick={() => setJanela(chave)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${janela === chave
                  ? (chave === 'atrasado' ? 'bg-red-600 text-white border-red-600 font-medium' : 'bg-blue-600 text-white border-blue-600 font-medium')
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Ações em lote */}
      {selecionados.size > 0 && (
        <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-blue-800 font-medium">{selecionados.size} selecionado(s)</span>
          <button onClick={() => marcarImpressao([...selecionados], true)} disabled={marcandoImpressao}
            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
            🖨 Marcar etiqueta como impressa
          </button>
          <button onClick={() => marcarImpressao([...selecionados], false)} disabled={marcandoImpressao}
            className="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs font-medium rounded-lg">
            ↩ Desfazer impressão
          </button>
          <button onClick={() => setRomaneio([...selecionados].map(id => ({ fonte: 'marketplace', id })))}
            className="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 text-xs font-medium rounded-lg">
            📋 Romaneio de separação
          </button>
          <button onClick={() => setSelecionados(new Set())} className="ml-auto text-xs text-blue-600 hover:text-blue-800">Limpar seleção</button>
        </div>
      )}
      {avisoAcao && (
        <div className="bg-teal-50 border border-teal-200 text-teal-800 text-xs px-4 py-2.5 rounded-lg mb-3 flex items-center justify-between">
          <span>{avisoAcao}</span>
          <button onClick={() => setAvisoAcao('')} className="text-teal-500 hover:text-teal-700">✕</button>
        </div>
      )}

      {/* LISTA EM LARGURA TOTAL, agrupada por pedido: uma linha de cabeçalho
          (nº interno, nota, avisos, canal) e uma linha por item. O separador
          vê o pedido inteiro sem abrir nada; clicar abre o modal. Antes a
          tela era dividida com o detalhe ao lado, e a lista ficava cortada. */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[980px] table-fixed">
          <colgroup>
            <col className="w-9" /><col className="w-[27%]" /><col className="w-[15%]" /><col className="w-[14%]" />
            <col className="w-[14%]" /><col className="w-[15%]" /><col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left">
              <th className="px-3 py-2.5">
                <input type="checkbox" aria-label="Selecionar todos"
                  checked={filtrados.length > 0 && filtrados.every(x => selecionados.has(x.p.id))}
                  onChange={e => setSelecionados(e.target.checked ? new Set(filtrados.map(x => x.p.id)) : new Set())} />
              </th>
              <th className="px-3 py-2.5 text-xs font-medium text-gray-600">Produto</th>
              <th className="px-3 py-2.5 text-xs font-medium text-gray-600">Comprador</th>
              <th className="px-3 py-2.5 text-xs font-medium text-gray-600">Pedido no marketplace</th>
              <th className="px-3 py-2.5 text-xs font-medium text-gray-600">Tempo</th>
              <th className="px-3 py-2.5 text-xs font-medium text-gray-600">Envio</th>
              <th className="px-3 py-2.5 text-xs font-medium text-gray-600">Etapa</th>
            </tr>
          </thead>
          {filtrados.map(({ p, etapa, envio }) => {
            const prazo = emAberto(etapa) ? textoPrazo(p) : null
            const itens: any[] = p.marketplace_pedido_itens ?? []
            const semProduto = itens.filter(i => !i.produto_id).length
            const info = ESTEIRA_INFO[etapa]
            const nf = p.nfe_numero ? `NF-e ${p.nfe_numero}` : (notaResolvida(p) ? 'NF ok no canal' : null)
            const linhasItens = itens.length > 0 ? itens : [null]
            return (
              <tbody key={p.id} className="border-t border-gray-200">
                <tr className="bg-gray-50/80 text-xs">
                  <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" aria-label="Selecionar pedido" checked={selecionados.has(p.id)}
                      onChange={e => setSelecionados(prev => {
                        const novo = new Set(prev)
                        if (e.target.checked) novo.add(p.id); else novo.delete(p.id)
                        return novo
                      })} />
                  </td>
                  <td colSpan={4} className="px-3 py-1.5">
                    <button onClick={() => abrirPedido(p)} className="font-semibold text-blue-700 hover:underline">
                      #{numeroInterno(p) ?? (p.numero_pedido || p.id_externo)}
                    </button>
                    {nf && <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px]">{nf}</span>}
                    {semProduto > 0 && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[11px]">⚠ {semProduto} item(ns) sem produto</span>}
                    {etiquetaImpressa(p) && emAberto(etapa) && <span className="ml-2 px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 text-[11px]">🖨 etiqueta impressa</span>}
                    {prazo?.texto.startsWith('Atrasado') && <span className="ml-2 px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[11px] font-medium">{prazo.texto}</span>}
                  </td>
                  <td colSpan={2} className="px-3 py-1.5 text-right text-gray-500">
                    {p.marketplace_canais?.nome ?? '—'} · {NOME_PLATAFORMA[p.marketplace_canais?.plataforma] ?? p.marketplace_canais?.plataforma ?? ''}
                  </td>
                </tr>
                {linhasItens.map((item: any, idx: number) => {
                  const imagem = item?.marketplace_anuncios?.imagens?.[0]
                  const primeira = idx === 0
                  return (
                    <tr key={item?.id ?? 'vazio'} onClick={() => abrirPedido(p)} className="hover:bg-blue-50/50 cursor-pointer align-top text-xs">
                      <td />
                      <td className="px-3 py-2">
                        {item ? (
                          <div className="flex gap-2">
                            <div className="w-10 h-10 flex-shrink-0 rounded-lg overflow-hidden bg-gray-50 border border-gray-200">
                              {imagem ? <img src={imagem} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300">📦</div>}
                            </div>
                            <div className="min-w-0">
                              <p className="text-gray-900 leading-snug line-clamp-2">{item.produtos?.nome ?? item.nome_produto}</p>
                              <p className="text-gray-500 mt-0.5">
                                {item.produtos?.sku ?? item.sku ?? 's/ SKU'} · <span className="font-medium text-gray-700">{item.quantidade}×</span> · {fmt(Number(item.preco_unitario ?? 0))}
                              </p>
                              {!item.produto_id && (
                                <button onClick={e => { e.stopPropagation(); abrirPedido(p); abrirMapeamentoItem(item) }}
                                  className="mt-1 px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 text-[11px] font-medium">
                                  🔗 Mapear
                                </button>
                              )}
                            </div>
                          </div>
                        ) : <span className="text-gray-400">Pedido sem itens</span>}
                      </td>
                      {primeira ? (
                        <>
                          <td className="px-3 py-2" rowSpan={linhasItens.length}>
                            <p className="text-gray-900 truncate" title={p.cliente_nome ?? ''}>{p.cliente_nome ?? '—'}</p>
                            <p className="text-gray-500 truncate">{[p.entrega_cidade, p.entrega_estado].filter(Boolean).join(', ') || '—'}</p>
                            <p className="text-gray-400 mt-0.5">{fmt(Number(p.valor_total))}</p>
                          </td>
                          <td className="px-3 py-2 break-all text-gray-700" rowSpan={linhasItens.length}>{p.numero_pedido || p.id_externo}</td>
                          <td className="px-3 py-2" rowSpan={linhasItens.length}>
                            <p className="text-gray-400">Entrou</p>
                            <p className="text-gray-700">{fmtData(p.data_pedido)}</p>
                            {p.prazo_postagem && emAberto(etapa) && <>
                              <p className="text-gray-400 mt-0.5">Postar até</p>
                              <p className="text-gray-700">{fmtData(p.prazo_postagem)}</p>
                            </>}
                            {prazo && <p className={`mt-0.5 ${prazo.cor}`}>{prazo.texto}</p>}
                          </td>
                          <td className="px-3 py-2" rowSpan={linhasItens.length}>
                            <p className="text-gray-800">{envio.meio ?? <span className="text-gray-300">—</span>}</p>
                            {envio.detalhe && <p className="text-gray-500">{envio.detalhe}</p>}
                            {envio.rastreio && <p className="text-gray-400 font-mono break-all mt-0.5">{envio.rastreio}</p>}
                          </td>
                          <td className="px-3 py-2" rowSpan={linhasItens.length}>
                            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${info.cor}`}>
                              {info.numero ? `${info.numero}. ` : ''}{info.label}
                            </span>
                            {p.status === 'novo' && etapa === 'novos' && <p className="text-[11px] text-gray-400 mt-1">aguardando pagamento</p>}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            )
          })}
          {filtrados.length === 0 && (
            <tbody><tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm">Nenhum pedido com esses filtros.</td></tr></tbody>
          )}
        </table>
      </div>

      {/* DETALHE EM MODAL — abre por cima da lista, que continua inteira atrás. */}
      {detalhe && (
        <div className="fixed inset-0 z-40 flex items-start justify-center p-4 overflow-y-auto">
          <div className="fixed inset-0 bg-black/40" onClick={() => setDetalhe(null)} />
          <div className="relative w-full max-w-3xl my-6">
          {detalhe ? (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-2xl p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setDetalhe(null)} title="Fechar"
                      className="text-gray-400 hover:text-gray-700 text-base leading-none">✕</button>
                    <h3 className="font-semibold text-gray-900">Pedido #{numeroInterno(detalhe) ?? (detalhe.numero_pedido || detalhe.id_externo)}</h3>
                  </div>
                  <p className="text-xs text-gray-500">
                    {detalhe.marketplace_canais?.nome} · {NOME_PLATAFORMA[detalhe.marketplace_canais?.plataforma] ?? ''} · nº no marketplace <span className="font-mono">{detalhe.numero_pedido || detalhe.id_externo}</span>
                  </p>
                  {(() => {
                    const e = meioDeEnvio(detalhe)
                    return e.meio ? (
                      <p className="text-xs text-gray-500">🚚 {e.meio}{e.detalhe ? ` · ${e.detalhe}` : ''}{e.rastreio ? <> · <span className="font-mono">{e.rastreio}</span></> : null}</p>
                    ) : null
                  })()}
                </div>
                <select value={detalhe.status} onChange={e => atualizarStatus(detalhe, e.target.value)}
                  className={`text-xs font-medium px-2 py-1 rounded-lg border-0 focus:outline-none cursor-pointer ${STATUS_CORES[detalhe.status]}`}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {/* Onde o pedido está na esteira e o que falta */}
              {(() => {
                const etapa = etapaEsteira(detalhe)
                const info = ESTEIRA_INFO[etapa]
                const prazo = emAberto(etapa) ? textoPrazo(detalhe) : null
                return (
                  <div className="border border-gray-200 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${info.cor}`}>
                        {info.numero ? `${info.numero}. ` : ''}{info.label}
                      </span>
                      {prazo && <span className={`text-xs ${prazo.cor}`}>{prazo.texto}</span>}
                    </div>
                    <p className="text-[11px] text-gray-500">{detalhe.status === 'novo' ? 'Aguardando pagamento no canal.' : info.ajuda}</p>
                    {detalhe.prazo_postagem && (
                      <p className="text-[11px] text-gray-400">Postar até {fmtData(detalhe.prazo_postagem)}</p>
                    )}
                    {detalhe.envio_status && (
                      <p className="text-[11px] text-gray-400">Envio no canal: <span className="font-mono">{detalhe.envio_status}{detalhe.envio_substatus ? ` / ${detalhe.envio_substatus}` : ''}</span></p>
                    )}
                    {detalhe.etiqueta_impressa_em ? (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] text-teal-700">🖨 Etiqueta impressa {fmtData(detalhe.etiqueta_impressa_em)}{detalhe.etiqueta_impressa_por ? ` · ${detalhe.etiqueta_impressa_por}` : ''}</span>
                        <button onClick={() => marcarImpressao([detalhe.id], false)} disabled={marcandoImpressao}
                          className="text-[11px] text-gray-500 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">Desfazer</button>
                      </div>
                    ) : (etapa === 'imprimir' || etapa === 'emitir') && (
                      <button onClick={() => marcarImpressao([detalhe.id], true)} disabled={marcandoImpressao}
                        className="w-full mt-1 py-1.5 border border-teal-300 text-teal-700 hover:bg-teal-50 disabled:opacity-50 text-xs font-medium rounded-lg transition-colors">
                        🖨 Marcar etiqueta como impressa
                      </button>
                    )}
                  </div>
                )
              })()}

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
                      <div key={item.id} className="flex gap-2 text-xs border border-gray-100 rounded-lg px-2.5 py-2">
                        <div className="w-11 h-11 flex-shrink-0 rounded-lg overflow-hidden bg-gray-50 border border-gray-200">
                          {item.marketplace_anuncios?.imagens?.[0] ? (
                            <img src={item.marketplace_anuncios.imagens[0]} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300">📦</div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            {item.produtos?.nome ? (
                              <>
                                <p className="text-gray-900 font-semibold truncate">{item.quantidade}× {item.produtos.nome}</p>
                                <p className="text-gray-400 truncate">{item.nome_produto}</p>
                              </>
                            ) : (
                              <p className="text-gray-700 truncate">{item.quantidade}× {item.nome_produto}</p>
                            )}
                          </div>
                          <span className="text-gray-900 font-medium flex-shrink-0">{fmt(Number(item.subtotal))}</span>
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
                        {item.status_mapeamento === 'mapeado' && !item.baixou_estoque
                          && detalhe.status !== 'novo' && detalhe.status !== 'cancelado' && (
                          <div className="flex items-center justify-between mt-1 gap-2">
                            <span className="text-red-600 truncate" title={detalhe.pendencia_motivo ?? ''}>
                              ✗ estoque não baixado{detalhe.pendencia_motivo ? ` — ${detalhe.pendencia_motivo}` : ''}
                            </span>
                            <button onClick={() => tentarBaixarEstoqueDeNovo(item)} disabled={baixandoItemId === item.id}
                              className="text-blue-600 hover:text-blue-800 font-medium flex-shrink-0 disabled:opacity-50">
                              {baixandoItemId === item.id ? 'Tentando...' : 'Tentar novamente'}
                            </button>
                          </div>
                        )}
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

              {/* Nota Fiscal — emissão real, mesmo padrão de DetalheVendaModal.tsx.
                  Cria a venda por trás na primeira emissão (garantirVendaDoPedido),
                  reaproveita nas próximas — reemitir/consultar usa a mesma venda. */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-600">Nota Fiscal</p>
                  <p className="text-[11px] text-gray-400 truncate" title="Configurável por canal em Marketplaces → canal → Configurar">
                    emitida por {emissorPorCanal[detalhe.canal_id] || empresaFiscalNome}
                  </p>
                </div>
                {nfceStatus?.status === 'autorizada' ? (
                  <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                    <p>✓ Autorizada — Nº <span className="font-mono">{nfceStatus.numero}</span></p>
                    {nfceStatus.chave && <p className="font-mono text-[10px] break-all mt-0.5">{nfceStatus.chave}</p>}
                    {nfceStatus.danfeUrl && <a href={nfceStatus.danfeUrl} target="_blank" rel="noreferrer" className="underline">Ver DANFE</a>}
                  </div>
                ) : (
                  <>
                    {nfceStatus?.status && nfceStatus.status !== 'pendente' && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                        ⚠ {nfceStatus.status === 'erro' ? 'Erro ao emitir' : 'Não emitida'}{nfceStatus.motivoRejeicao ? ` — ${nfceStatus.motivoRejeicao}` : ''}
                      </p>
                    )}
                    {erroEmitirNfce && (
                      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">{erroEmitirNfce}</p>
                    )}
                    <button onClick={() => emitirNfceDoPedido(detalhe)} disabled={emitindoNfce}
                      className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
                      {emitindoNfce ? 'Emitindo...' : (nfceStatus?.status === 'erro' ? '🧾 Tentar emitir de novo' : '🧾 Emitir NF-e')}
                    </button>
                  </>
                )}
              </div>

              {/* Informar NF-e — só registro manual, pra quem já emitiu por fora */}
              {!detalhe.nfe_informada_em && ['novos', 'emitir'].includes(etapaEsteira(detalhe)) && (
                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-600">Já emiti por fora — registrar manualmente</p>
                  <input value={nfeForm.numero} onChange={e => setNfeForm(p => ({ ...p, numero: e.target.value }))}
                    placeholder="Número da nota"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                  <input value={nfeForm.chave} onChange={e => setNfeForm(p => ({ ...p, chave: e.target.value }))}
                    placeholder="Chave de acesso (opcional)"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-500" />
                  <button onClick={() => salvarNfe(detalhe)} disabled={salvandoNfe}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
                    {salvandoNfe ? 'Salvando...' : 'Marcar como emitida'}
                  </button>
                </div>
              )}
              {detalhe.nfe_numero && (
                <div className="text-xs text-gray-600">
                  <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">NF-e</p>
                  <p>Nº <span className="font-mono">{detalhe.nfe_numero}</span>{detalhe.nfe_chave && <> · <span className="font-mono">{detalhe.nfe_chave}</span></>}</p>
                </div>
              )}

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
          ) : null}
          </div>
        </div>
      )}

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

      {romaneio && <RomaneioModal itens={romaneio} onFechar={() => setRomaneio(null)} />}
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
