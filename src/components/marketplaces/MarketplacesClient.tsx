'use client'

import { useState, useEffect, type ComponentType } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function MercadoLivreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#FFFFFF" />
      <ellipse cx="24" cy="25" rx="17.5" ry="13.5" fill="#FFE600" stroke="#2D3277" strokeWidth="2" />
      <path d="M11 20c2-4 5-6.5 8-6M37 20c-2-4-5-6.5-8-6" fill="none" stroke="#2D3277" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 24c4.5 5.5 10.5 8.5 16 8.5S35.5 29.5 40 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 27.5l4.5 3 3-2 4.5 3 3-2" fill="none" stroke="#2D3277" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShopeeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shopeeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF9142" />
          <stop offset="1" stopColor="#EE4D2D" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="url(#shopeeGrad)" />
      <path d="M17.5 17.5a6.5 6.5 0 0 1 13 0" fill="none" stroke="#fff" strokeWidth="2.2" />
      <rect x="13" y="17.5" width="22" height="19" rx="4" fill="#fff" />
      <text x="24" y="31.5" fontSize="14" fontWeight="700" fill="#EE4D2D" textAnchor="middle" fontFamily="Arial, sans-serif">S</text>
    </svg>
  )
}

function AmazonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#131921" />
      <text x="24" y="29" fontSize="20" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Arial, sans-serif">a</text>
      <path d="M13 33c6 4.5 16 4.5 22 0" fill="none" stroke="#FF9900" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M32.5 31.7l3.8-1.2-.6 4z" fill="#FF9900" />
    </svg>
  )
}

const PLATAFORMAS = [
  {
    id: 'mercadolivre',
    label: 'Mercado Livre',
    emoji: '🟡',
    Icone: MercadoLivreIcon,
    cor: 'border-yellow-400 bg-yellow-50',
    corAtivo: 'border-yellow-500 bg-yellow-100 ring-2 ring-yellow-400',
    badge: 'bg-yellow-400',
    labelSeller: 'Seu e-mail de cadastro no Mercado Livre',
    linkLoja: 'https://www.mercadolivre.com.br/l/vendedores',
  },
  {
    id: 'shopee',
    label: 'Shopee',
    emoji: '🧡',
    Icone: ShopeeIcon,
    cor: 'border-orange-400 bg-orange-50',
    corAtivo: 'border-orange-500 bg-orange-100 ring-2 ring-orange-400',
    badge: 'bg-orange-400',
    labelSeller: 'Shop ID (ID da sua loja na Shopee)',
    linkLoja: 'https://seller.shopee.com.br',
  },
  {
    id: 'amazon',
    label: 'Amazon',
    emoji: '📦',
    Icone: AmazonIcon,
    cor: 'border-amber-400 bg-amber-50',
    corAtivo: 'border-amber-500 bg-amber-100 ring-2 ring-amber-400',
    badge: 'bg-amber-500',
    labelSeller: 'Seller ID (encontre no Amazon Seller Central)',
    linkLoja: 'https://sellercentral.amazon.com.br',
  },
  {
    id: 'magalu',
    label: 'Magazine Luiza',
    emoji: '🛍️',
    Icone: null as ComponentType<{ className?: string }> | null,
    cor: 'border-blue-400 bg-blue-50',
    corAtivo: 'border-blue-500 bg-blue-100 ring-2 ring-blue-400',
    badge: 'bg-blue-600',
    labelSeller: 'Seu e-mail de vendedor no Magalu',
    linkLoja: 'https://marketplace.magalu.com.br',
  },
  {
    id: 'outro',
    label: 'Outro canal',
    emoji: '🏪',
    Icone: null as ComponentType<{ className?: string }> | null,
    cor: 'border-gray-300 bg-gray-50',
    corAtivo: 'border-gray-500 bg-gray-100 ring-2 ring-gray-400',
    badge: 'bg-gray-500',
    labelSeller: 'Identificador da loja (opcional)',
    linkLoja: '',
  },
]

function platInfo(id: string) { return PLATAFORMAS.find(p => p.id === id) ?? PLATAFORMAS[4] }
function PlatIcon({ p, className }: { p: typeof PLATAFORMAS[number]; className?: string }) {
  return p.Icone ? <p.Icone className={className} /> : <span className="text-2xl leading-none">{p.emoji}</span>
}
function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

const STATUS_PEDIDO_COR: Record<string, string> = {
  novo: 'bg-blue-100 text-blue-700',
  confirmado: 'bg-green-100 text-green-700',
  faturado: 'bg-purple-100 text-purple-700',
  enviado: 'bg-cyan-100 text-cyan-700',
  entregue: 'bg-green-100 text-green-800',
  cancelado: 'bg-red-100 text-red-600',
  devolvido: 'bg-orange-100 text-orange-600',
}

export default function MarketplacesClient({
  canais: canaisIniciais, anunciosTotais, pedidosTotais, empresaId,
}: {
  canais: any[]
  anunciosTotais: any[]
  pedidosTotais: any[]
  empresaId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [canais, setCanais] = useState(canaisIniciais)
  const [toast, setToast] = useState<{ tipo: 'ok' | 'erro'; msg: string } | null>(null)

  useEffect(() => {
    const sucesso = searchParams.get('sucesso')
    const erro = searchParams.get('erro')
    if (sucesso) {
      const nomes: Record<string, string> = { shopee: 'Shopee', mercadolivre: 'Mercado Livre' }
      setToast({ tipo: 'ok', msg: `✓ ${nomes[sucesso] ?? sucesso} conectado com sucesso!` })
      router.replace('/dashboard/marketplaces')
      setTimeout(() => setToast(null), 5000)
    } else if (erro) {
      const msgs: Record<string, string> = {
        cancelado: 'Conexão cancelada.',
        'token-invalido': 'Não foi possível obter o token de acesso. Tente novamente.',
        'sem-credenciais': 'Configure as credenciais do sistema em Configurações → Integrações primeiro.',
      }
      setToast({ tipo: 'erro', msg: msgs[erro] ?? 'Erro ao conectar.' })
      router.replace('/dashboard/marketplaces')
      setTimeout(() => setToast(null), 6000)
    }
  }, [searchParams])
  const [modal, setModal] = useState(false)
  const [passo, setPasso] = useState(1)
  const [salvando, setSalvando] = useState(false)
  const [conectando, setConectando] = useState(false)
  const [aguardandoUrl, setAguardandoUrl] = useState(false)
  const [urlRetorno, setUrlRetorno] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState({
    nome: '', plataforma: '', markup_canal: '0',
    sincronizar_estoque: true, sincronizar_preco: true,
    seller_id: '',
  })

  // Plataformas que suportam OAuth automático
  const OAUTH_PLATAFORMAS = ['shopee', 'mercadolivre']

  function f(k: string, v: any) { setForm(p => ({ ...p, [k]: v })) }

  function abrirModal() {
    setModal(true); setPasso(1); setErro('')
    setForm({ nome: '', plataforma: '', markup_canal: '0', sincronizar_estoque: true, sincronizar_preco: true, seller_id: '' })
  }

  function fecharModal() { setModal(false); setPasso(1) }

  function avancar() {
    if (passo === 1 && !form.plataforma) { setErro('Selecione uma plataforma.'); return }
    if (passo === 2 && !form.nome.trim()) { setErro('Informe o nome da sua loja.'); return }
    setErro(''); setPasso(p => p + 1)
  }

  async function conectarOAuth() {
    setConectando(true); setErro('')
    const plat = form.plataforma
    const res = await fetch(`/api/marketplace/${plat}/auth-url?nome=${encodeURIComponent(form.nome)}&markup=${form.markup_canal}`)
    const data = await res.json()
    setConectando(false)
    if (data.error) { setErro(data.error); return }
    // Abre o marketplace em nova aba e aguarda a URL de retorno
    window.open(data.url, '_blank')
    setAguardandoUrl(true)
  }

  async function processarUrlRetorno() {
    if (!urlRetorno.trim()) { setErro('Cole a URL da página que abriu após o login.'); return }
    setProcessando(true); setErro('')
    try {
      const url = new URL(urlRetorno.trim())
      const code = url.searchParams.get('code')
      const shopId = url.searchParams.get('shop_id')
      const state = url.searchParams.get('state')
      if (!code || !shopId) {
        setErro('URL inválida — verifique se copiou a URL completa após o login na Shopee.')
        setProcessando(false); return
      }
      // Chama o callback localmente com os parâmetros extraídos
      const callbackUrl = `/api/marketplace/${form.plataforma}/callback?code=${code}&shop_id=${shopId}&state=${state ?? ''}&via=fetch`
      const r = await fetch(callbackUrl)
      const json = await r.json()
      if (json.ok) {
        setToast({ tipo: 'ok', msg: `✓ Loja "${json.nome}" conectada com sucesso!` })
        setModal(false); setAguardandoUrl(false); setUrlRetorno('')
        setTimeout(() => setToast(null), 5000)
        router.refresh()
      } else {
        setErro(json.erro ?? 'Erro ao finalizar conexão.')
      }
    } catch (e) {
      setErro('URL inválida — cole a URL completa começando com https://')
    }
    setProcessando(false)
  }

  async function criarCanalManual() {
    setSalvando(true); setErro('')
    const sb = createClient()
    const { data, error } = await sb.from('marketplace_canais').insert({
      empresa_id: empresaId,
      nome: form.nome.trim(),
      plataforma: form.plataforma,
      markup_canal: parseFloat(form.markup_canal) || 0,
      sincronizar_estoque: form.sincronizar_estoque,
      sincronizar_preco: form.sincronizar_preco,
      seller_id: form.seller_id || null,
      ativo: true,
    }).select().single()
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setCanais(prev => [...prev, data])
    fecharModal()
    router.refresh()
  }

  async function toggleAtivo(canal: any) {
    const sb = createClient()
    await sb.from('marketplace_canais').update({ ativo: !canal.ativo }).eq('id', canal.id)
    setCanais(prev => prev.map(c => c.id === canal.id ? { ...c, ativo: !c.ativo } : c))
  }

  function metricasCanal(canalId: string) {
    const a = anunciosTotais.filter(a => a.canal_id === canalId)
    const p = pedidosTotais.filter(p => p.canal_id === canalId)
    return {
      anunciosAtivos: a.filter(a => a.status === 'ativo').length,
      totalAnuncios: a.length,
      pedidosNovos: p.filter(p => p.status === 'novo').length,
      totalPedidos: p.length,
      faturamento: p.filter(p => !['cancelado','devolvido'].includes(p.status)).reduce((s, p) => s + Number(p.valor_total), 0),
    }
  }

  const totalAnunciosAtivos = anunciosTotais.filter(a => a.status === 'ativo').length
  const totalPedidosNovos = pedidosTotais.filter(p => p.status === 'novo').length
  const faturamentoTotal = pedidosTotais.filter(p => !['cancelado','devolvido'].includes(p.status)).reduce((s, p) => s + Number(p.valor_total), 0)

  const plat = platInfo(form.plataforma)

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast.tipo === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span className="text-gray-600 font-medium">marketplaces</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Gestão de Marketplaces</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gerencie seus canais de venda, anúncios e pedidos</p>
        </div>
        <button onClick={abrirModal}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Novo canal
        </button>
      </div>

      {/* Cards resumo global */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card titulo="Canais ativos" valor={String(canais.filter(c => c.ativo).length)} sub={`de ${canais.length} cadastrados`} cor="blue" />
        <Card titulo="Anúncios ativos" valor={String(totalAnunciosAtivos)} sub={`de ${anunciosTotais.length} total`} cor="green" />
        <Card titulo="Pedidos novos" valor={String(totalPedidosNovos)} sub="aguardando processamento" cor="orange" destaque={totalPedidosNovos > 0} />
        <Card titulo="Faturamento canais" valor={fmt(faturamentoTotal)} sub="pedidos não cancelados" cor="purple" />
      </div>

      {/* Lista de canais */}
      {canais.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-2xl py-16 text-center" style={{ background: 'rgb(252,251,248)' }}>
          <p className="text-4xl mb-3">🛒</p>
          <p className="text-gray-700 font-medium mb-1">Nenhum canal cadastrado</p>
          <p className="text-gray-400 text-sm mb-5">Conecte seu primeiro marketplace para gerenciar anúncios e pedidos.</p>
          <button onClick={abrirModal}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Conectar marketplace
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {canais.map(canal => {
            const p = platInfo(canal.plataforma)
            const m = metricasCanal(canal.id)
            return (
              <div key={canal.id} className={`bg-white border rounded-2xl p-5 transition-all ${canal.ativo ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 ${p.badge} rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0`}>
                    <PlatIcon p={p} className="w-12 h-12" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold text-gray-900">{canal.nome}</h3>
                      <span className="text-xs text-gray-400">{p.label}</span>
                      {!canal.ativo && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inativo</span>}
                    </div>
                    {canal.seller_id && <p className="text-xs text-gray-400 mb-2">{canal.seller_id}</p>}
                    <div className="flex items-center gap-6 mt-3">
                      <Metrica label="Anúncios ativos" valor={m.anunciosAtivos} total={m.totalAnuncios} />
                      <Metrica label="Pedidos novos" valor={m.pedidosNovos} total={m.totalPedidos} destaque={m.pedidosNovos > 0} />
                      <div><p className="text-xs text-gray-400">Faturamento</p><p className="text-sm font-semibold text-gray-900">{fmt(m.faturamento)}</p></div>
                      <div><p className="text-xs text-gray-400">Markup canal</p><p className="text-sm font-semibold text-gray-900">{canal.markup_canal ?? 0}%</p></div>
                      {canal.ultima_sincronizacao
                        ? <div><p className="text-xs text-gray-400">Última sync</p><p className="text-xs text-gray-600">{new Date(canal.ultima_sincronizacao).toLocaleString('pt-BR')}</p></div>
                        : <div><p className="text-xs text-gray-400">Sincronização</p><p className="text-xs text-gray-400 italic">Nunca sincronizado</p></div>
                      }
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <Link href={`/dashboard/marketplaces/${canal.id}/anuncios`}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg text-center transition-colors">
                      Anúncios
                    </Link>
                    <Link href={`/dashboard/marketplaces/${canal.id}/pedidos`}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg text-center transition-colors border ${m.pedidosNovos > 0 ? 'bg-orange-500 hover:bg-orange-600 text-white border-orange-500' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                      Pedidos {m.pedidosNovos > 0 && <span className="ml-1">({m.pedidosNovos})</span>}
                    </Link>
                    <Link href={`/dashboard/marketplaces/${canal.id}`}
                      className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded-lg text-center hover:bg-gray-50 transition-colors">
                      Configurar
                    </Link>
                    <button onClick={() => toggleAtivo(canal)}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${canal.ativo ? 'text-gray-400 hover:text-red-500' : 'text-green-600 hover:text-green-700'}`}>
                      {canal.ativo ? 'Desativar' : 'Ativar'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── MODAL WIZARD ─────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={fecharModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">

            {/* Cabeçalho com progresso */}
            <div className="px-6 pt-5 pb-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">
                  {passo === 1 && 'Onde você vende?'}
                  {passo === 2 && 'Sua loja'}
                  {passo === 3 && 'Conectar conta'}
                </h2>
                <button onClick={fecharModal} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              {/* Barra de progresso */}
              <div className="flex gap-1.5">
                {[1,2,3].map(n => (
                  <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= passo ? 'bg-blue-500' : 'bg-gray-200'}`} />
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Passo {passo} de 3</p>
            </div>

            <div className="px-6 py-5">

              {/* ── PASSO 1: Escolher plataforma ── */}
              {passo === 1 && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 mb-4">Selecione o marketplace em que você tem produtos à venda:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PLATAFORMAS.map(p => (
                      <button key={p.id} onClick={() => { f('plataforma', p.id); setErro('') }}
                        className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${form.plataforma === p.id ? p.corAtivo : p.cor + ' hover:opacity-90'}`}>
                        <PlatIcon p={p} className="w-9 h-9 flex-shrink-0" />
                        <span className="font-medium text-gray-800 text-sm">{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── PASSO 2: Nome da loja + markup ── */}
              {passo === 2 && (
                <div className="space-y-4">
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${plat.cor}`}>
                    <PlatIcon p={plat} className="w-9 h-9 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Plataforma escolhida</p>
                      <p className="font-semibold text-gray-800 text-sm">{plat.label}</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Como você quer chamar essa loja? *</label>
                    <input value={form.nome} onChange={e => f('nome', e.target.value)} autoFocus
                      placeholder={`Ex: ${plat.label} - Loja Principal`}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                    <p className="text-xs text-gray-400 mt-1">Use um nome fácil de identificar. Ex: "Shopee Vargas", "ML Ouro"</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Comissão / taxa do marketplace (%)</label>
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.1" min="0" max="100" value={form.markup_canal}
                        onChange={e => f('markup_canal', e.target.value)}
                        className="w-32 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                      <span className="text-sm text-gray-400">% sobre o preço de venda</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Esse percentual é adicionado ao preço ao publicar neste canal</p>
                  </div>

                  <div className="flex gap-6 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.sincronizar_estoque} onChange={e => f('sincronizar_estoque', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                      <span className="text-sm text-gray-700">Sincronizar estoque</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.sincronizar_preco} onChange={e => f('sincronizar_preco', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                      <span className="text-sm text-gray-700">Sincronizar preços</span>
                    </label>
                  </div>
                </div>
              )}

              {/* ── PASSO 3: Conectar ── */}
              {passo === 3 && (
                <div className="space-y-4">
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${plat.cor}`}>
                    <PlatIcon p={plat} className="w-9 h-9 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Conectando</p>
                      <p className="font-semibold text-gray-800 text-sm">{form.nome} — {plat.label}</p>
                    </div>
                  </div>

                  {OAUTH_PLATAFORMAS.includes(form.plataforma) ? (
                    /* OAuth: abre marketplace e cola URL de retorno */
                    !aguardandoUrl ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 space-y-1">
                          <p className="text-sm font-medium text-green-800">🔗 Autenticação automática</p>
                          <p className="text-xs text-green-700">Clique no botão abaixo — uma nova aba abrirá para você fazer login na {plat.label}. Após autorizar, copie a URL que aparecer no navegador e cole aqui.</p>
                        </div>
                        <button onClick={conectarOAuth} disabled={conectando}
                          className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                            form.plataforma === 'shopee' ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-yellow-400 hover:bg-yellow-500 text-gray-900'
                          } disabled:opacity-60`}>
                          {conectando ? '⏳ Abrindo...' : <><PlatIcon p={plat} className="w-6 h-6 rounded-md flex-shrink-0" /> Entrar com {plat.label}</>}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                          <p className="text-sm font-medium text-blue-800 mb-1">📋 Cole a URL aqui</p>
                          <p className="text-xs text-blue-700">Após o login na {plat.label}, você foi redirecionado para uma página. Copie a URL completa da barra do navegador e cole abaixo:</p>
                        </div>
                        <textarea
                          value={urlRetorno}
                          onChange={e => setUrlRetorno(e.target.value)}
                          autoFocus rows={3}
                          placeholder={`https://www.vargasnexus.com.br/dashboard/marketplaces/callback/${form.plataforma}?code=...&shop_id=...`}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none focus:border-blue-500 resize-none"
                        />
                        <button onClick={processarUrlRetorno} disabled={processando}
                          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                          {processando ? '⏳ Finalizando...' : '✓ Finalizar conexão'}
                        </button>
                        <button onClick={() => { setAguardandoUrl(false); setUrlRetorno('') }}
                          className="w-full py-1.5 text-xs text-gray-400 hover:text-gray-600">
                          ← Tentar novamente
                        </button>
                      </div>
                    )
                  ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{plat.labelSeller}</label>
                      <input value={form.seller_id} onChange={e => f('seller_id', e.target.value)} autoFocus
                        placeholder="Digite o ID ou e-mail da sua loja"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                      {plat.linkLoja && (
                        <a href={plat.linkLoja} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1.5 text-xs text-blue-600 hover:text-blue-800">
                          🔗 Onde encontro? Abrir {plat.label}
                        </a>
                      )}
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
                      <p className="text-xs font-medium text-gray-600">O que acontece ao salvar?</p>
                      <p className="text-xs text-gray-500">✓ Seus produtos poderão ser publicados nesta loja</p>
                      <p className="text-xs text-gray-500">✓ Pedidos recebidos aparecerão aqui automaticamente</p>
                      <p className="text-xs text-gray-500">✓ Estoque e preços sincronizados conforme configurado</p>
                    </div>

                    <p className="text-xs text-gray-400">Pode deixar em branco e preencher depois em "Configurar".</p>
                  </div>
                  )}
                </div>
              )}

              {erro && <p className="text-sm text-red-600 mt-3">{erro}</p>}
            </div>

            {/* Rodapé */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              {passo > 1
                ? <button onClick={() => { setPasso(p => p - 1); setErro('') }}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">← Voltar</button>
                : <div />
              }
              <div className="flex gap-2">
                {passo < 3 && (
                  <button onClick={avancar}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                    Próximo →
                  </button>
                )}
                {passo === 3 && !OAUTH_PLATAFORMAS.includes(form.plataforma) && (
                  <button onClick={criarCanalManual} disabled={salvando}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                    {salvando ? 'Salvando...' : '✓ Salvar canal'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ titulo, valor, sub, cor, destaque }: { titulo: string; valor: string; sub: string; cor: string; destaque?: boolean }) {
  const cores: Record<string, string> = {
    blue: 'text-blue-600', green: 'text-green-600', orange: 'text-orange-500', purple: 'text-purple-600'
  }
  return (
    <div className={`bg-white border rounded-xl p-4 ${destaque ? 'border-orange-200 bg-orange-50' : 'border-gray-200'}`}>
      <p className="text-xs text-gray-500 mb-1">{titulo}</p>
      <p className={`text-2xl font-bold ${cores[cor]}`}>{valor}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

function Metrica({ label, valor, total, destaque }: { label: string; valor: number; total: number; destaque?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-sm font-semibold ${destaque ? 'text-orange-500' : 'text-gray-900'}`}>
        {valor} <span className="text-gray-400 font-normal text-xs">/ {total}</span>
      </p>
    </div>
  )
}
