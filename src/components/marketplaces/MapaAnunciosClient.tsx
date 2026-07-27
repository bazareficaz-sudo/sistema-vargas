'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import MapearAnuncioModal from './MapearAnuncioModal'
import EnviarPrecoEstoqueModal from './EnviarPrecoEstoqueModal'
import CriarAnuncioShopeeModal from './CriarAnuncioShopeeModal'
import CriarAnuncioMercadoLivreModal from './CriarAnuncioMercadoLivreModal'

const fmt = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

const STATUS_ANUNCIO: Record<string, { label: string; emoji: string; cor: string }> = {
  ativo:      { label: 'Ativo',      emoji: '🟢', cor: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  pausado:    { label: 'Pausado',    emoji: '🟡', cor: 'bg-amber-50 text-amber-600 border-amber-200' },
  erro:       { label: 'Erro',       emoji: '⚠️', cor: 'bg-red-50 text-red-600 border-red-200' },
  rascunho:   { label: 'Pendente',   emoji: '🔄', cor: 'bg-slate-50 text-slate-500 border-slate-200' },
  encerrado:  { label: 'Encerrado',  emoji: '⚫', cor: 'bg-gray-100 text-gray-500 border-gray-200' },
}

type Produto = { id: string; nome: string; sku: string | null; ean: string | null; tipo: string; foto_url: string | null }
type CanalStatus = { canalId: string; canalNome: string; plataforma: string; status: 'anunciado' | 'ignorado' | 'sem_anuncio'; observacao?: string | null; motivo?: string }
type Anuncio = {
  id: string; canalId: string; canalNome: string; plataforma: string; titulo: string
  idExterno: string; urlAnuncio: string | null; skuCanal: string | null; status: string
  precoVenda: number; estoqueExterno: number | null; temVariacao: boolean; sincronizadoEm: string | null
  margem?: number
}
type Kit = {
  kitId: string; nome: string; sku: string | null; quantidadeComponente: number
  estoquePossivel: number | null; custo?: number | null; precoVenda: number; margem?: number | null
  anunciado: boolean; anuncios: Anuncio[]; canais: CanalStatus[]
}
type Detalhe = {
  produto: {
    id: string; nome: string; sku: string | null; ean: string | null; tipo: string
    marca: string | null; categoria: string | null; fotoUrl: string | null
    ativo: boolean; estoque: number; precoVenda: number; precoCusto?: number; margem?: number | null
    dadosMinimos: Record<string, boolean>
  }
  estoquePorDeposito: { depositoId: string; depositoNome: string; quantidade: number }[]
  anuncios: Anuncio[]
  canais: CanalStatus[]
  kits: Kit[]
  empresasGrupo: { empresaId: string; empresaNome: string; produtoEncontrado: boolean; canais: CanalStatus[] }[] | null
  resumo: {
    totalAnuncios: number; canaisComAnuncio: number; totalKits: number
    kitsAnunciados: number; kitsNaoAnunciados: number; canaisSemAnuncio: number; alertaMargemRuim: boolean
  }
}

export default function MapaAnunciosClient({ empresaId, podeVerCustos, podeVerGrupo }: {
  empresaId: string; podeVerCustos: boolean; podeVerGrupo: boolean
}) {
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<Produto[]>([])
  const [buscando, setBuscando] = useState(false)
  const buscaRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [produtoId, setProdutoId] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [mensagem, setMensagem] = useState('')

  const [filtroStatus, setFiltroStatus] = useState('')

  const [criarAberto, setCriarAberto] = useState<{ produtoId: string; canal: { id: string; nome: string; plataforma: string } } | null>(null)
  const [selecionarAberto, setSelecionarAberto] = useState<{ canal: { id: string; nome: string; plataforma: string } } | null>(null)
  const [mapearAberto, setMapearAberto] = useState<{ anuncio: any; canal: any } | null>(null)
  const [precoAberto, setPrecoAberto] = useState<{ anuncio: any; canal: any } | null>(null)
  const [prefAberto, setPrefAberto] = useState<{ produtoId: string; canalId: string; canalNome: string; naoAnunciar: boolean; observacao: string } | null>(null)

  function avisar(msg: string) { setMensagem(msg); setTimeout(() => setMensagem(''), 4000) }

  function onBusca(q: string) {
    setBusca(q)
    if (buscaRef.current) clearTimeout(buscaRef.current)
    if (!q.trim()) { setResultados([]); return }
    setBuscando(true)
    buscaRef.current = setTimeout(async () => {
      const res = await fetch(`/api/marketplaces/mapa-anuncios/buscar?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResultados(data.resultados ?? [])
      setBuscando(false)
    }, 300)
  }

  async function selecionarProduto(id: string) {
    setProdutoId(id); setResultados([]); setBusca(''); setCarregando(true); setDetalhe(null)
    const res = await fetch(`/api/marketplaces/mapa-anuncios/${id}`)
    const data = await res.json()
    setCarregando(false)
    if (!data.ok) { avisar(data.erro ?? 'Erro ao carregar produto'); return }
    setDetalhe(data)
  }

  async function recarregar() { if (produtoId) await selecionarProduto(produtoId) }

  async function buscarAnuncioCompleto(anuncioId: string) {
    const sb = createClient()
    const { data } = await sb.from('marketplace_anuncios').select('*').eq('id', anuncioId).single()
    return data
  }

  async function abrirAtualizarPreco(a: Anuncio) {
    const anuncioCompleto = await buscarAnuncioCompleto(a.id)
    if (!anuncioCompleto) { avisar('Não foi possível carregar o anúncio.'); return }
    setPrecoAberto({ anuncio: anuncioCompleto, canal: { id: a.canalId, nome: a.canalNome, plataforma: a.plataforma } })
  }

  async function sincronizar(a: Anuncio) {
    const rota = a.plataforma === 'mercadolivre' ? '/api/marketplace/mercadolivre/sync-item' : '/api/marketplace/shopee/sync-item'
    const res = await fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canalId: a.canalId, idExterno: a.idExterno }) })
    const data = await res.json()
    avisar(data.ok ? 'Sincronizado.' : (data.erro ?? 'Erro ao sincronizar'))
    if (data.ok) recarregar()
  }

  async function salvarPreferencia(patch: { naoAnunciar?: boolean; observacao?: string }) {
    if (!prefAberto) return
    const res = await fetch('/api/marketplaces/mapa-anuncios/preferencia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produtoId: prefAberto.produtoId, canalId: prefAberto.canalId, ...patch }),
    })
    const data = await res.json()
    if (!data.ok) { avisar(data.erro ?? 'Erro ao salvar'); return }
    setPrefAberto(null)
    recarregar()
  }

  const r = detalhe?.resumo

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Mapa de Anúncios por Produto</h1>
        <p className="text-sm text-gray-500">Busque um produto pra ver onde ele (e seus kits) já estão anunciados — e onde ainda falta.</p>
      </div>

      {mensagem && <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg">{mensagem}</div>}

      {/* Busca */}
      <div className="relative">
        <input
          value={busca} onChange={e => onBusca(e.target.value)}
          placeholder="Buscar por código, SKU, EAN, nome ou código do fornecedor..."
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
        />
        {resultados.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-80 overflow-y-auto">
            {resultados.map(p => (
              <button key={p.id} onClick={() => selecionarProduto(p.id)}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-50 last:border-0">
                {p.foto_url ? <img src={p.foto_url} className="w-8 h-8 rounded object-cover flex-shrink-0" /> : <div className="w-8 h-8 rounded bg-gray-100 flex-shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 truncate">{p.nome} {p.tipo === 'kit' && <span className="text-[10px] text-violet-600">🧩 kit</span>}</p>
                  <p className="text-xs text-gray-400">SKU {p.sku ?? '—'} {p.ean && `· EAN ${p.ean}`}</p>
                </div>
              </button>
            ))}
          </div>
        )}
        {buscando && <p className="text-xs text-gray-400 mt-1">Buscando...</p>}
      </div>

      {carregando && <p className="text-sm text-gray-400 text-center py-10">Carregando...</p>}

      {detalhe && r && (
        <>
          {/* Resumo executivo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ResumoCard label="Anúncios encontrados" valor={r.totalAnuncios} />
            <ResumoCard label="Canais com anúncio" valor={r.canaisComAnuncio} />
            <ResumoCard label="Canais sem anúncio" valor={r.canaisSemAnuncio} destaque={r.canaisSemAnuncio > 0} />
            <ResumoCard label="Kits relacionados" valor={r.totalKits} sub={`${r.kitsAnunciados} anunciados · ${r.kitsNaoAnunciados} não`} />
          </div>
          {r.alertaMargemRuim && (
            <div className="px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              ⚠️ Margem ruim ou negativa encontrada — confira preço/custo abaixo.
            </div>
          )}

          {/* Painel do produto */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start gap-4">
              {detalhe.produto.fotoUrl ? <img src={detalhe.produto.fotoUrl} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" /> : <div className="w-16 h-16 rounded-lg bg-gray-100 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-gray-900">{detalhe.produto.nome}</h2>
                <p className="text-xs text-gray-400">SKU {detalhe.produto.sku ?? '—'} {detalhe.produto.ean && `· EAN ${detalhe.produto.ean}`} · {detalhe.produto.marca ?? 'sem marca'} · {detalhe.produto.categoria ?? 'sem categoria'}</p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                  <Badge cor={detalhe.produto.ativo ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>{detalhe.produto.ativo ? 'Ativo' : 'Inativo'}</Badge>
                  <Badge cor="bg-slate-50 text-slate-600 border-slate-200">Estoque: {detalhe.produto.estoque}</Badge>
                  <Badge cor="bg-blue-50 text-blue-600 border-blue-200">Preço: {fmt(detalhe.produto.precoVenda)}</Badge>
                  {podeVerCustos && detalhe.produto.precoCusto != null && (
                    <Badge cor="bg-violet-50 text-violet-600 border-violet-200">💰 Custo: {fmt(detalhe.produto.precoCusto)} {detalhe.produto.margem != null && `(margem ${detalhe.produto.margem.toFixed(0)}%)`}</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Checklist dados mínimos */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Dados mínimos pra anunciar</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries({ titulo: 'Título', imagem: 'Imagem', preco: 'Preço', categoria: 'Categoria', peso: 'Peso', medidas: 'Medidas', estoque: 'Estoque' }).map(([k, label]) => (
                  <span key={k} className={`px-2 py-1 rounded-full border ${detalhe.produto.dadosMinimos[k] ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                    {detalhe.produto.dadosMinimos[k] ? '✓' : '✗'} {label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Anúncios encontrados */}
          <Secao titulo="Anúncios encontrados" acao={
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
              <option value="">Todos os status</option>
              {Object.entries(STATUS_ANUNCIO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          }>
            <ListaAnuncios anuncios={filtrar(detalhe.anuncios, filtroStatus)} podeVerCustos={podeVerCustos}
              onSincronizar={sincronizar} onAtualizarPreco={abrirAtualizarPreco} />
          </Secao>

          {/* Kits relacionados */}
          {detalhe.kits.length > 0 && (
            <Secao titulo="🧩 Kits relacionados">
              <div className="space-y-4">
                {detalhe.kits.map(kit => (
                  <div key={kit.kitId} className="border border-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{kit.nome} <span className="text-xs text-gray-400">SKU {kit.sku ?? '—'}</span></p>
                        <p className="text-xs text-gray-500">
                          {kit.quantidadeComponente}x deste produto no kit · estoque possível: {kit.estoquePossivel ?? '—'} · preço {fmt(kit.precoVenda)}
                          {podeVerCustos && kit.custo != null && <> · custo {fmt(kit.custo)} {kit.margem != null && `(margem ${kit.margem.toFixed(0)}%)`}</>}
                        </p>
                      </div>
                      <Badge cor={kit.anunciado ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}>
                        {kit.anunciado ? '🟢 Anunciado' : '🔴 Não anunciado'}
                      </Badge>
                    </div>
                    {kit.anuncios.length > 0 && (
                      <div className="mt-3">
                        <ListaAnuncios anuncios={kit.anuncios} podeVerCustos={podeVerCustos} compacto
                          onSincronizar={sincronizar} onAtualizarPreco={abrirAtualizarPreco} />
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {kit.canais.filter(c => c.status !== 'anunciado').map(c => (
                        <CanalGapChip key={c.canalId} canal={c} produtoId={kit.kitId}
                          onCriar={() => setCriarAberto({ produtoId: kit.kitId, canal: { id: c.canalId, nome: c.canalNome, plataforma: c.plataforma } })}
                          onSelecionar={() => setSelecionarAberto({ canal: { id: c.canalId, nome: c.canalNome, plataforma: c.plataforma } })}
                          onPreferencia={() => setPrefAberto({ produtoId: kit.kitId, canalId: c.canalId, canalNome: c.canalNome, naoAnunciar: c.status === 'ignorado', observacao: c.observacao ?? '' })}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Secao>
          )}

          {/* Canais sem anúncio */}
          <Secao titulo="Canais sem anúncio deste produto">
            {detalhe.canais.filter(c => c.status !== 'anunciado').length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Todos os canais ativos já têm anúncio (ou foram marcados como ignorados). 🎉</p>
            ) : (
              <div className="space-y-2">
                {detalhe.canais.filter(c => c.status !== 'anunciado').map(c => (
                  <div key={c.canalId} className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-3">
                    <div>
                      <p className="text-sm text-gray-800">{c.status === 'ignorado' ? '⚫' : '🔴'} {c.canalNome} <span className="text-xs text-gray-400">({c.plataforma})</span></p>
                      <p className="text-xs text-gray-500">{c.status === 'ignorado' ? (c.observacao || 'Marcado como "não anunciar aqui"') : c.motivo}</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {c.status !== 'ignorado' && (
                        <>
                          <button onClick={() => setCriarAberto({ produtoId: detalhe.produto.id, canal: { id: c.canalId, nome: c.canalNome, plataforma: c.plataforma } })}
                            className="text-xs px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">+ Criar anúncio</button>
                          <button onClick={() => setSelecionarAberto({ canal: { id: c.canalId, nome: c.canalNome, plataforma: c.plataforma } })}
                            className="text-xs px-2.5 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">Mapear existente</button>
                        </>
                      )}
                      <button onClick={() => setPrefAberto({ produtoId: detalhe.produto.id, canalId: c.canalId, canalNome: c.canalNome, naoAnunciar: c.status === 'ignorado', observacao: c.observacao ?? '' })}
                        className="text-xs px-2.5 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                        {c.status === 'ignorado' ? 'Editar' : '⚫ Não anunciar / observação'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Secao>

          {/* Empresas do grupo */}
          {podeVerGrupo && (
            <Secao titulo="Outras empresas do grupo">
              {!detalhe.empresasGrupo || detalhe.empresasGrupo.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Nenhuma outra empresa no seu grupo ainda.</p>
              ) : (
                <div className="space-y-3">
                  {detalhe.empresasGrupo.map(e => (
                    <div key={e.empresaId} className="border border-gray-100 rounded-lg px-4 py-3">
                      <p className="text-sm font-medium text-gray-800">{e.empresaNome}</p>
                      {!e.produtoEncontrado ? (
                        <p className="text-xs text-gray-400 mt-1">Produto não cadastrado nessa empresa (sem SKU/EAN correspondente).</p>
                      ) : (
                        <p className="text-xs text-gray-500 mt-1">
                          {e.canais.filter(c => c.status === 'anunciado').length} canal(is) com anúncio · {e.canais.filter(c => c.status === 'sem_anuncio').length} sem anúncio
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Secao>
          )}
        </>
      )}

      {/* Modais */}
      {criarAberto && criarAberto.canal.plataforma === 'shopee' && (
        <CriarAnuncioShopeeModal canal={{ id: criarAberto.canal.id, nome: criarAberto.canal.nome }} empresaId={empresaId}
          produtoIdInicial={criarAberto.produtoId} onClose={() => setCriarAberto(null)} onCriado={() => { setCriarAberto(null); recarregar() }} />
      )}
      {criarAberto && criarAberto.canal.plataforma === 'mercadolivre' && (
        <CriarAnuncioMercadoLivreModal canal={{ id: criarAberto.canal.id, nome: criarAberto.canal.nome }} empresaId={empresaId}
          produtoIdInicial={criarAberto.produtoId} onClose={() => setCriarAberto(null)} onCriado={() => { setCriarAberto(null); recarregar() }} />
      )}
      {selecionarAberto && (
        <SelecionarAnuncioModal empresaId={empresaId} canal={selecionarAberto.canal}
          onClose={() => setSelecionarAberto(null)}
          onSelecionado={(anuncio) => { setSelecionarAberto(null); setMapearAberto({ anuncio, canal: selecionarAberto.canal }) }} />
      )}
      {mapearAberto && (
        <MapearAnuncioModal anuncio={mapearAberto.anuncio} canal={mapearAberto.canal} empresaId={empresaId} operador=""
          onClose={() => setMapearAberto(null)} onAtualizado={() => { setMapearAberto(null); recarregar() }} />
      )}
      {precoAberto && (
        <EnviarPrecoEstoqueModal anuncio={precoAberto.anuncio} canal={precoAberto.canal}
          onClose={() => setPrecoAberto(null)} onEnviado={() => { setPrecoAberto(null); recarregar() }} />
      )}
      {prefAberto && (
        <PreferenciaModal dados={prefAberto} onClose={() => setPrefAberto(null)} onSalvar={salvarPreferencia} />
      )}
    </div>
  )
}

function filtrar(anuncios: Anuncio[], status: string) {
  if (!status) return anuncios
  return anuncios.filter(a => a.status === status)
}

function ResumoCard({ label, valor, sub, destaque }: { label: string; valor: number; sub?: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${destaque ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${destaque ? 'text-red-600' : 'text-gray-900'}`}>{valor}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function Secao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">{titulo}</h2>
        {acao}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function Badge({ children, cor }: { children: React.ReactNode; cor: string }) {
  return <span className={`px-2 py-1 rounded-full border text-xs font-medium ${cor}`}>{children}</span>
}

function ListaAnuncios({ anuncios, podeVerCustos, compacto, onSincronizar, onAtualizarPreco }: {
  anuncios: Anuncio[]; podeVerCustos: boolean; compacto?: boolean
  onSincronizar: (a: Anuncio) => void; onAtualizarPreco: (a: Anuncio) => void
}) {
  if (anuncios.length === 0) return <p className="text-sm text-gray-400 text-center py-6">Nenhum anúncio encontrado ainda.</p>
  return (
    <div className="divide-y divide-gray-50">
      {anuncios.map(a => {
        const st = STATUS_ANUNCIO[a.status] ?? { label: a.status, emoji: '•', cor: 'bg-gray-50 text-gray-500 border-gray-200' }
        return (
          <div key={a.id} className={`flex items-center justify-between gap-3 ${compacto ? 'py-2' : 'py-3'}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800 truncate">{a.titulo}</p>
              <p className="text-xs text-gray-400">{a.canalNome} ({a.plataforma}) · #{a.idExterno} · {fmt(a.precoVenda)} · estoque {a.estoqueExterno ?? '—'}
                {podeVerCustos && a.margem != null && <> · margem {a.margem.toFixed(0)}%</>}
                {a.sincronizadoEm && <> · sync {new Date(a.sincronizadoEm).toLocaleDateString('pt-BR')}</>}
              </p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${st.cor}`}>{st.emoji} {st.label}</span>
            <div className="flex gap-1 flex-shrink-0">
              {a.urlAnuncio && <a href={a.urlAnuncio} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">Ver</a>}
              <button onClick={() => onSincronizar(a)} className="text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">🔄</button>
              <button onClick={() => onAtualizarPreco(a)} className="text-xs px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">Preço/estoque</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CanalGapChip({ canal, onCriar, onSelecionar, onPreferencia }: {
  canal: CanalStatus; produtoId: string
  onCriar: () => void; onSelecionar: () => void; onPreferencia: () => void
}) {
  if (canal.status === 'ignorado') {
    return <button onClick={onPreferencia} className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded-full">⚫ {canal.canalNome}</button>
  }
  return (
    <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-full pl-2.5 pr-1 py-0.5">
      <span className="text-xs text-red-600">🔴 {canal.canalNome}</span>
      <button onClick={onCriar} title="Criar anúncio" className="text-xs px-1.5 py-0.5 hover:bg-red-100 rounded-full">+</button>
      <button onClick={onSelecionar} title="Mapear existente" className="text-xs px-1.5 py-0.5 hover:bg-red-100 rounded-full">🔗</button>
      <button onClick={onPreferencia} title="Ignorar / observação" className="text-xs px-1.5 py-0.5 hover:bg-red-100 rounded-full">⚫</button>
    </div>
  )
}

function SelecionarAnuncioModal({ empresaId, canal, onClose, onSelecionado }: {
  empresaId: string; canal: { id: string; nome: string; plataforma: string }
  onClose: () => void; onSelecionado: (anuncio: any) => void
}) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<any[]>([])
  const [buscando, setBuscando] = useState(false)

  async function buscar(texto: string) {
    setQ(texto)
    if (texto.trim().length < 2) { setResultados([]); return }
    setBuscando(true)
    const sb = createClient()
    const { data } = await sb.from('marketplace_anuncios')
      .select('*').eq('empresa_id', empresaId).eq('canal_id', canal.id)
      .or(`titulo.ilike.%${texto}%,sku_canal.ilike.%${texto}%,id_externo.ilike.%${texto}%`)
      .order('produto_id', { ascending: true, nullsFirst: true })
      .limit(20)
    setResultados(data ?? [])
    setBuscando(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Buscar anúncio existente</h2>
        <p className="text-xs text-gray-400 mb-4">{canal.nome} — busque por título, SKU no canal ou código do anúncio</p>
        <input value={q} onChange={e => buscar(e.target.value)} autoFocus placeholder="Digite pra buscar..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        {buscando && <p className="text-xs text-gray-400 mt-2">Buscando...</p>}
        <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-gray-50">
          {resultados.map(a => (
            <button key={a.id} onClick={() => onSelecionado(a)} className="w-full text-left py-2.5 hover:bg-gray-50 px-2 rounded-lg">
              <p className="text-sm text-gray-800 truncate">{a.titulo} {a.produto_id && <span className="text-[10px] text-amber-600">(já mapeado)</span>}</p>
              <p className="text-xs text-gray-400">#{a.id_externo} · SKU {a.sku_canal ?? '—'}</p>
            </button>
          ))}
          {!buscando && q.trim().length >= 2 && resultados.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">Nenhum anúncio encontrado nesse canal.</p>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
        </div>
      </div>
    </div>
  )
}

function PreferenciaModal({ dados, onClose, onSalvar }: {
  dados: { canalNome: string; naoAnunciar: boolean; observacao: string }
  onClose: () => void; onSalvar: (patch: { naoAnunciar?: boolean; observacao?: string }) => void
}) {
  const [naoAnunciar, setNaoAnunciar] = useState(dados.naoAnunciar)
  const [observacao, setObservacao] = useState(dados.observacao)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    await onSalvar({ naoAnunciar, observacao })
    setSalvando(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">{dados.canalNome}</h2>
        <label className="flex items-center gap-2 mt-4 text-sm text-gray-700">
          <input type="checkbox" checked={naoAnunciar} onChange={e => setNaoAnunciar(e.target.checked)} />
          ⚫ Não anunciar neste canal
        </label>
        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-1">Observação</label>
          <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Motivo, contexto..." />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
