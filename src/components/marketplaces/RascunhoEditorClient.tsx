'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { limparTextoOrigem } from '@/lib/marketplaces/limparTextoOrigem'

type ProdutoVinculado = {
  id: string; nome: string; sku: string | null; ean: string | null
  preco_venda: number | null; preco_custo: number | null; estoque: number | null; marca: string | null
}

type Rascunho = {
  id: string
  titulo: string | null
  origem_marketplace: string | null
  origem_id_externo: string | null
  origem_url: string | null
  origem_vendedor: string | null
  preco_origem: number | null
  imagem_principal: string | null
  qtd_imagens: number
  tem_variacao: boolean
  produto_id: string | null
  mapeamento_metodo: string | null
  mapeamento_score: number | null
  status: string
  colecao: string | null
  observacao: string | null
  capturado_em: string
  dados_origem: any
  dados_editados: any
  produtos: ProdutoVinculado | null
}

type Candidato = {
  id: string; nome: string; sku: string | null; ean?: string | null; marca?: string | null
  precoVenda: number; precoCusto?: number; estoque: number
  metodo: 'sku' | 'ean' | 'nome'; score: number
}

const brl = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  capturado: { rotulo: 'Capturado', cor: 'bg-slate-100 text-slate-700' },
  aguardando_mapeamento: { rotulo: 'Aguardando mapeamento', cor: 'bg-amber-100 text-amber-800' },
  aguardando_revisao: { rotulo: 'Aguardando revisão', cor: 'bg-blue-100 text-blue-700' },
  pronto: { rotulo: 'Pronto para publicar', cor: 'bg-emerald-100 text-emerald-700' },
  publicado: { rotulo: 'Publicado', cor: 'bg-purple-100 text-purple-700' },
}

const METODO_ROTULO: Record<string, string> = {
  ean: 'código de barras', sku: 'código', nome: 'semelhança de nome', manual: 'escolha manual',
}

function BadgeConfianca({ metodo, score }: { metodo: string; score: number }) {
  // EAN é código global do produto — não coincide por acaso. Semelhança de
  // nome é palpite, e o número precisa aparecer para o operador decidir.
  const alta = metodo === 'ean' || score >= 50
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${alta ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
      {alta ? '🟢' : '🟡'} {metodo === 'ean' ? 'código de barras' : `${score}% de semelhança`}
    </span>
  )
}

export default function RascunhoEditorClient({
  rascunho, historico,
}: {
  rascunho: Rascunho
  historico: { id: string; acao: string; observacao: string | null; created_at: string; usuario_nome: string | null }[]
}) {
  const router = useRouter()
  const origem = rascunho.dados_origem ?? {}
  const editados = rascunho.dados_editados ?? {}

  const [aba, setAba] = useState<'conteudo' | 'imagens' | 'produto' | 'origem'>(
    rascunho.produto_id ? 'conteudo' : 'produto')

  // Conteúdo de trabalho: começa do que já foi editado; se nada foi editado
  // ainda, começa vazio — em branco é o sinal de "isto ainda é texto de
  // terceiro, precisa virar seu".
  const [titulo, setTitulo] = useState<string>(editados.titulo ?? '')
  const [descricao, setDescricao] = useState<string>(editados.descricao ?? '')
  const [marca, setMarca] = useState<string>(editados.marca ?? origem.marca ?? '')
  const [categoria, setCategoria] = useState<string>(editados.categoria ?? origem.categoriaAparente ?? '')
  const [preco, setPreco] = useState<string>(editados.preco != null ? String(editados.preco) : '')
  const [observacao, setObservacao] = useState<string>(rascunho.observacao ?? '')

  const [produto, setProduto] = useState<ProdutoVinculado | null>(rascunho.produtos)
  const [metodo, setMetodo] = useState<string | null>(rascunho.mapeamento_metodo)
  const [score, setScore] = useState<number | null>(rascunho.mapeamento_score)

  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  // Imagens da origem e a escolha do operador. Enquanto ele não escolhe nada,
  // a seleção fica vazia — e vazio aqui significa "ainda não decidi", não
  // "não quero nenhuma".
  const imagensOrigem: string[] = Array.isArray(origem.imagens) ? origem.imagens : []
  const [imagensEscolhidas, setImagensEscolhidas] = useState<string[]>(
    Array.isArray(editados.imagens) ? editados.imagens : [])
  const [zoom, setZoom] = useState<string | null>(null)

  function alternarImagem(src: string) {
    setImagensEscolhidas(atual =>
      atual.includes(src) ? atual.filter(x => x !== src) : [...atual, src])
  }
  function moverImagem(src: string, delta: number) {
    setImagensEscolhidas(atual => {
      const i = atual.indexOf(src)
      const j = i + delta
      if (i < 0 || j < 0 || j >= atual.length) return atual
      const copia = [...atual]
      ;[copia[i], copia[j]] = [copia[j], copia[i]]
      return copia
    })
  }

  // ── Base a partir do original ─────────────────────────────────────────────
  const [mudancasLimpeza, setMudancasLimpeza] = useState<string[] | null>(null)

  // ── Reescrita com IA ──────────────────────────────────────────────────────
  const [reescrevendo, setReescrevendo] = useState(false)
  const [erroReescrita, setErroReescrita] = useState('')
  const [vazouNaReescrita, setVazouNaReescrita] = useState<string[]>([])

  async function reescreverComIA() {
    setReescrevendo(true); setErroReescrita(''); setVazouNaReescrita([])
    try {
      const res = await fetch(`/api/marketplaces/rascunhos/${rascunho.id}/reescrever`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status}`)
      setTitulo(d.titulo)
      setDescricao(d.descricao)
      setVazouNaReescrita(d.vazou ?? [])
      setMudancasLimpeza(null)
    } catch (e: any) {
      setErroReescrita(String(e?.message ?? e))
    } finally {
      setReescrevendo(false)
    }
  }

  function gerarBaseDoOriginal() {
    const opcoes = {
      vendedor: rascunho.origem_vendedor,
      marcaOrigem: origem.marca,
      // A marca que entra no lugar é a do SEU cadastro, quando há produto
      // vinculado. Sem vínculo, a marca de origem só é removida.
      marcaDestino: produto?.marca ?? null,
    }
    const t = limparTextoOrigem(origem.titulo, opcoes)
    const d = limparTextoOrigem(origem.descricao, opcoes)
    setTitulo(t.texto)
    setDescricao(d.texto)
    if (produto?.marca) setMarca(produto.marca)
    setMudancasLimpeza([...new Set([...t.mudancas, ...d.mudancas])])
  }

  // ── Sugestão de produto ───────────────────────────────────────────────────
  const [sugestao, setSugestao] = useState<Candidato | null>(null)
  const [alternativas, setAlternativas] = useState<Candidato[]>([])
  const [eanEncontrado, setEanEncontrado] = useState<string | null>(null)
  const [carregandoSugestao, setCarregandoSugestao] = useState(false)
  const [erroSugestao, setErroSugestao] = useState('')

  const buscarSugestao = useCallback(async () => {
    setCarregandoSugestao(true); setErroSugestao('')
    try {
      const res = await fetch(`/api/marketplaces/rascunhos/${rascunho.id}/sugerir-produto`)
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status}`)
      setSugestao(d.sugestao)
      setAlternativas(d.alternativas ?? [])
      setEanEncontrado(d.eanEncontrado ?? null)
    } catch (e: any) {
      setErroSugestao(String(e?.message ?? e))
    } finally {
      setCarregandoSugestao(false)
    }
  }, [rascunho.id])

  // Busca sozinha só quando ainda não há vínculo — é aí que a sugestão vale.
  useEffect(() => {
    if (!rascunho.produto_id) buscarSugestao()
  }, [rascunho.produto_id, buscarSugestao])

  // ── Busca manual de produto ───────────────────────────────────────────────
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<any[]>([])
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) { setResultados([]); return }
    let ativo = true
    setBuscando(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/marketplaces/mapa-anuncios/buscar?q=${encodeURIComponent(termo)}`)
        const d = await res.json()
        if (ativo) setResultados(d.resultados ?? [])
      } finally {
        if (ativo) setBuscando(false)
      }
    }, 300)
    return () => { ativo = false; clearTimeout(t) }
  }, [busca])

  // ── Salvar ────────────────────────────────────────────────────────────────
  async function salvar(extra: Record<string, any> = {}) {
    setSalvando(true); setMsg(null)
    try {
      const res = await fetch(`/api/marketplaces/rascunhos/${rascunho.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dadosEditados: {
            titulo: titulo.trim() || null,
            descricao: descricao.trim() || null,
            marca: marca.trim() || null,
            categoria: categoria.trim() || null,
            preco: preco.trim() ? Number(preco.replace(',', '.')) : null,
            imagens: imagensEscolhidas,
          },
          observacao: observacao.trim() || null,
          ...extra,
        }),
      })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status}`)
      setMsg({ tipo: 'ok', texto: 'Salvo.' })
      router.refresh()
    } catch (e: any) {
      setMsg({ tipo: 'erro', texto: String(e?.message ?? e) })
    } finally {
      setSalvando(false)
    }
  }

  async function vincular(c: Candidato | any, metodoUsado: string, scoreUsado: number | null) {
    setSalvando(true); setMsg(null)
    try {
      const res = await fetch(`/api/marketplaces/rascunhos/${rascunho.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: c.id, metodo: metodoUsado, score: scoreUsado }),
      })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status}`)
      setProduto({
        id: c.id, nome: c.nome, sku: c.sku ?? null, ean: c.ean ?? null, marca: c.marca ?? null,
        preco_venda: c.precoVenda ?? c.preco_venda ?? null,
        preco_custo: c.precoCusto ?? c.preco_custo ?? null,
        estoque: c.estoque ?? null,
      })
      setMetodo(metodoUsado)
      setScore(scoreUsado)
      setMsg({ tipo: 'ok', texto: 'Produto vinculado.' })
      setBusca(''); setResultados([])
      router.refresh()
    } catch (e: any) {
      setMsg({ tipo: 'erro', texto: String(e?.message ?? e) })
    } finally {
      setSalvando(false)
    }
  }

  async function desvincular() {
    setSalvando(true); setMsg(null)
    try {
      const res = await fetch(`/api/marketplaces/rascunhos/${rascunho.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: null }),
      })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status}`)
      setProduto(null); setMetodo(null); setScore(null)
      buscarSugestao()
      router.refresh()
    } catch (e: any) {
      setMsg({ tipo: 'erro', texto: String(e?.message ?? e) })
    } finally {
      setSalvando(false)
    }
  }

  // ── Painel de saúde ───────────────────────────────────────────────────────
  const checks = [
    { ok: !!produto, rotulo: 'Produto do sistema vinculado', dica: 'Sem isso não dá para levar preço nem estoque.' },
    { ok: titulo.trim().length >= 10, rotulo: 'Título próprio escrito', dica: 'Copiar o título do vendedor derruba o anúncio no ranking e pode dar problema de direito autoral.' },
    { ok: descricao.trim().length >= 30, rotulo: 'Descrição própria escrita', dica: 'A descrição capturada é do vendedor de origem — reescreva.' },
    { ok: !!preco.trim(), rotulo: 'Preço definido', dica: 'O preço da origem é referência, não o seu.' },
    { ok: imagensEscolhidas.length > 0, rotulo: 'Imagens escolhidas', dica: 'Escolha na aba Imagens quais entram no anúncio — algumas trazem logo ou marca da loja de origem.' },
  ]
  const prontos = checks.filter(c => c.ok).length

  const st = STATUS[rascunho.status] ?? STATUS.capturado

  return (
    <div className="p-6 max-w-[1400px]">
      {/* Cabeçalho */}
      <div className="flex items-start gap-3 mb-4">
        <Link href="/dashboard/anuncios-rascunhos"
          className="text-sm text-slate-500 hover:text-slate-800 mt-0.5">← Voltar</Link>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900 truncate">
            {editados.titulo || rascunho.titulo || 'Rascunho'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full ${st.cor}`}>{st.rotulo}</span>
            <span>{rascunho.origem_marketplace === 'mercadolivre' ? 'Mercado Livre' : rascunho.origem_marketplace}</span>
            {rascunho.origem_id_externo && <span className="font-mono">{rascunho.origem_id_externo}</span>}
            {rascunho.origem_url && (
              <a href={rascunho.origem_url} target="_blank" rel="noreferrer noopener"
                className="text-blue-600 hover:underline">ver original ↗</a>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        <div>
          {/* Abas */}
          <div className="flex gap-1 border-b border-slate-200 mb-4">
            {([
              ['conteudo', 'Conteúdo'],
              ['imagens', `Imagens${imagensEscolhidas.length > 0 ? ` (${imagensEscolhidas.length})` : ''}`],
              ['produto', produto ? 'Produto ✓' : 'Produto'],
              ['origem', 'Origem'],
            ] as const).map(([chave, rotulo]) => (
              <button key={chave} onClick={() => setAba(chave as any)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${aba === chave ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {rotulo}
              </button>
            ))}
          </div>

          {msg && (
            <div className={`mb-3 px-3 py-2 rounded-lg text-sm ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {msg.texto}
            </div>
          )}

          {/* ── ABA CONTEÚDO ──────────────────────────────────────────── */}
          {aba === 'conteudo' && (
            <div className="space-y-4">
              <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                O texto ao lado de cada campo é o <b>do anúncio de origem</b>, guardado só como referência.
                Anúncio duplicado é penalizado no ranking dos marketplaces — reescreva com suas palavras.
              </div>

              {/* Reescrever com IA — texto novo, não texto limpo */}
              <div className="px-3 py-3 rounded-lg border border-violet-200 bg-violet-50">
                <div className="flex items-center gap-3 flex-wrap">
                  <button type="button" onClick={reescreverComIA} disabled={reescrevendo}
                    className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50">
                    {reescrevendo ? 'Escrevendo...' : '🪄 Reescrever com IA'}
                  </button>
                  <span className="text-xs text-slate-600">
                    Escreve um texto <b>novo</b>, a partir da ficha técnica — não é o texto do
                    vendedor limpo, é outro texto.
                  </span>
                </div>
                {(titulo.trim() || descricao.trim()) && !reescrevendo && (
                  <p className="text-[11px] text-amber-700 mt-2">
                    Isso vai substituir o que já está escrito. Nada é salvo até você clicar em Salvar.
                  </p>
                )}
                {erroReescrita && (
                  <p className="text-[11px] text-red-700 mt-2">{erroReescrita}</p>
                )}
                {vazouNaReescrita.length > 0 && (
                  <p className="text-[11px] text-red-700 mt-2">
                    ⚠ O texto gerado ainda cita: {vazouNaReescrita.join(', ')}. Tire antes de publicar.
                  </p>
                )}
                {/* A ficha técnica fica à vista aqui, e não só na aba Origem,
                    por um motivo concreto: no primeiro teste real, a ficha
                    capturada de uma luminária de dobradiça trazia "Com Wi-Fi:
                    Sim" — erro de quem preencheu o anúncio de origem. A IA
                    usou o dado corretamente e o texto saiu com Wi-Fi. Quem
                    pega isso é o olho de quem conhece o produto, e para isso
                    a ficha precisa estar na mesma tela do texto. */}
                {Array.isArray(origem.atributos) && origem.atributos.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-violet-800 cursor-pointer">
                      Ficha técnica que a IA usou ({origem.atributos.length} itens) — confira antes de salvar
                    </summary>
                    <div className="mt-2 max-h-48 overflow-y-auto rounded border border-violet-200 bg-white divide-y divide-violet-50">
                      {origem.atributos.map((a: any, i: number) => (
                        <div key={i} className="flex gap-2 px-2 py-1 text-[11px]">
                          <span className="text-slate-500 w-44 shrink-0">{a.nome}</span>
                          <span className="text-slate-800">{a.valor}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Esta ficha é do anúncio de origem e pode estar errada — quem preencheu foi
                      o outro vendedor. Medida, material, quantidade e voltagem merecem conferência.
                    </p>
                  </details>
                )}
              </div>

              {/* Base a partir do original */}
              <div className="px-3 py-3 rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-3 flex-wrap">
                  <button type="button" onClick={gerarBaseDoOriginal}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium">
                    ✨ Montar base a partir do original
                  </button>
                  <span className="text-xs text-slate-500">
                    Copia o texto de origem já sem a loja e sem a marca dela
                    {produto?.marca ? <> — a marca vira <b>{produto.marca}</b>, do seu cadastro</> : null}.
                  </span>
                </div>
                {(titulo.trim() || descricao.trim()) && (
                  <p className="text-[11px] text-amber-700 mt-2">
                    Isso vai substituir o que já está escrito nos campos de título e descrição.
                  </p>
                )}
                {!produto && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    Sem produto vinculado, a marca de origem é apenas removida — vincule na aba
                    Produto para que a sua entre no lugar.
                  </p>
                )}
                {mudancasLimpeza && (
                  <div className="mt-2 text-[11px] text-slate-600">
                    {mudancasLimpeza.length > 0 ? (
                      <>Foi tirado do texto: {mudancasLimpeza.join(' · ')}.</>
                    ) : (
                      <>Nada precisou ser removido — o texto de origem não citava loja, marca nem contato.</>
                    )}
                    <p className="text-amber-700 mt-1">
                      Isto <b>não é</b> um texto reescrito: sem os nomes, ele ainda é o texto do vendedor
                      de origem. Use como ponto de partida e escreva do seu jeito antes de publicar.
                    </p>
                  </div>
                )}
              </div>

              <Campo rotulo="Título" original={origem.titulo}>
                <input value={titulo} onChange={e => setTitulo(e.target.value)}
                  maxLength={300}
                  placeholder="Escreva o título do seu anúncio"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                <p className="text-[11px] text-slate-400 mt-1">{titulo.length}/300</p>
              </Campo>

              <Campo rotulo="Descrição" original={origem.descricao}>
                <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
                  rows={10} maxLength={20000}
                  placeholder="Escreva a descrição do seu anúncio"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-sans" />
                <p className="text-[11px] text-slate-400 mt-1">{descricao.length} caracteres</p>
              </Campo>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Marca</label>
                  <input value={marca} onChange={e => setMarca(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Categoria</label>
                  <input value={categoria} onChange={e => setCategoria(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Seu preço
                    {rascunho.preco_origem != null && (
                      <span className="text-slate-400 font-normal"> · origem {brl(rascunho.preco_origem)}</span>
                    )}
                  </label>
                  <input value={preco} onChange={e => setPreco(e.target.value)}
                    type="number" step="0.01" placeholder="0,00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  {produto && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Produto: venda {brl(produto.preco_venda)} · custo {brl(produto.preco_custo)}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Observação interna</label>
                <textarea value={observacao} onChange={e => setObservacao(e.target.value)}
                  rows={2} maxLength={2000}
                  placeholder="Anotação para você — não vai para lugar nenhum."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              </div>
            </div>
          )}

          {/* ── ABA IMAGENS ───────────────────────────────────────────── */}
          {aba === 'imagens' && (
            <div className="space-y-4">
              <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <b>Confira cada imagem antes de marcar.</b> É comum a foto trazer marca d&apos;água,
                logotipo ou telefone da loja de origem — e isso não pode ir para o seu anúncio.
                Clique na imagem para ver grande.
              </div>

              {imagensOrigem.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma imagem foi capturada neste rascunho.</p>
              ) : (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm text-slate-700">
                      <b>{imagensEscolhidas.length}</b> de {imagensOrigem.length} escolhida(s)
                    </span>
                    <button type="button" onClick={() => setImagensEscolhidas([])}
                      className="text-xs text-slate-500 hover:text-slate-800">desmarcar todas</button>
                    <span className="text-xs text-slate-400">
                      A primeira da sua lista é a capa do anúncio.
                    </span>
                  </div>

                  {/* Escolhidas, na ordem */}
                  {imagensEscolhidas.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Escolhidas, na ordem</p>
                      <div className="flex gap-2 flex-wrap">
                        {imagensEscolhidas.map((src, i) => (
                          <div key={src} className="w-28">
                            <div className="relative aspect-square rounded-lg overflow-hidden border-2 border-emerald-400 bg-slate-50">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt="" className="w-full h-full object-contain cursor-zoom-in"
                                onClick={() => setZoom(src)} />
                              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
                                {i === 0 ? 'capa' : i + 1}
                              </span>
                            </div>
                            <div className="flex items-center justify-center gap-1 mt-1">
                              <button type="button" onClick={() => moverImagem(src, -1)} disabled={i === 0}
                                title="Mover para trás"
                                className="px-1.5 py-0.5 text-xs rounded border border-slate-200 disabled:opacity-30">←</button>
                              <button type="button" onClick={() => moverImagem(src, 1)} disabled={i === imagensEscolhidas.length - 1}
                                title="Mover para frente"
                                className="px-1.5 py-0.5 text-xs rounded border border-slate-200 disabled:opacity-30">→</button>
                              <button type="button" onClick={() => alternarImagem(src)}
                                title="Tirar do anúncio"
                                className="px-1.5 py-0.5 text-xs rounded border border-slate-200 text-red-600">×</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Todas as capturadas */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      Todas as capturadas ({imagensOrigem.length})
                    </p>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                      {imagensOrigem.map((src, i) => {
                        const escolhida = imagensEscolhidas.includes(src)
                        return (
                          <div key={i}
                            className={`relative aspect-square rounded-lg overflow-hidden border-2 bg-slate-50 ${escolhida ? 'border-emerald-400' : 'border-slate-200'}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt="" className="w-full h-full object-contain cursor-zoom-in"
                              onClick={() => setZoom(src)} />
                            <button type="button" onClick={() => alternarImagem(src)}
                              className={`absolute bottom-1 left-1 right-1 py-1 rounded text-[10px] font-semibold ${escolhida ? 'bg-emerald-600 text-white' : 'bg-white/90 border border-slate-300 text-slate-700'}`}>
                              {escolhida ? '✓ escolhida' : 'usar esta'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    As imagens continuam hospedadas no site de origem — o sistema guarda o endereço
                    delas, não uma cópia. Se você tiver foto própria do produto, ela é sempre a
                    escolha melhor.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── ABA PRODUTO ───────────────────────────────────────────── */}
          {aba === 'produto' && (
            <div className="space-y-4">
              {produto ? (
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Vinculado a</p>
                      <p className="text-sm font-medium text-slate-900 mt-0.5">{produto.nome}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        SKU {produto.sku ?? '—'} · venda {brl(produto.preco_venda)} · estoque {produto.estoque ?? 0}
                      </p>
                      {metodo && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          Vinculado por {METODO_ROTULO[metodo] ?? metodo}
                          {score != null && metodo !== 'ean' && metodo !== 'manual' ? ` (${score}% de semelhança)` : ''}
                        </p>
                      )}
                    </div>
                    <button onClick={desvincular} disabled={salvando}
                      className="text-xs text-red-600 hover:underline shrink-0">desvincular</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-800">Sugestão do sistema</h2>
                    <button onClick={buscarSugestao} disabled={carregandoSugestao}
                      className="text-xs text-blue-600 hover:underline">
                      {carregandoSugestao ? 'buscando...' : 'recalcular'}
                    </button>
                    {eanEncontrado && (
                      <span className="text-[11px] text-slate-500">
                        código de barras na ficha: <span className="font-mono">{eanEncontrado}</span>
                      </span>
                    )}
                  </div>

                  {erroSugestao && (
                    <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{erroSugestao}</div>
                  )}

                  {carregandoSugestao ? (
                    <p className="text-sm text-slate-400">Comparando com o seu catálogo...</p>
                  ) : sugestao ? (
                    <LinhaCandidato c={sugestao} destaque onEscolher={() => vincular(sugestao, sugestao.metodo, sugestao.score)} desabilitado={salvando} />
                  ) : (
                    <p className="text-sm text-slate-500">
                      Nenhum produto do catálogo se parece com este anúncio. Busque abaixo pelo nome certo.
                    </p>
                  )}

                  {alternativas.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Outras possibilidades</p>
                      <div className="space-y-2">
                        {alternativas.map(a => (
                          <LinhaCandidato key={a.id} c={a} onEscolher={() => vincular(a, a.metodo, a.score)} desabilitado={salvando} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Busca manual — sempre disponível, inclusive para trocar o vínculo */}
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  {produto ? 'Trocar por outro produto' : 'Procurar o produto certo'}
                </p>
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Nome, SKU ou código de barras..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                {buscando && <p className="text-xs text-slate-400 mt-2">buscando...</p>}
                {resultados.length > 0 && (
                  <div className="mt-2 space-y-2 max-h-80 overflow-y-auto">
                    {resultados.map((p: any) => (
                      <div key={p.id} className="flex items-center gap-3 px-3 py-2 border border-slate-200 rounded-lg">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-800 truncate">{p.nome}</p>
                          <p className="text-[11px] text-slate-500">
                            SKU {p.sku ?? '—'} · venda {brl(p.preco_venda)} · estoque {p.estoque ?? 0}
                          </p>
                        </div>
                        <button onClick={() => vincular(p, 'manual', null)} disabled={salvando}
                          className="px-3 py-1 text-xs rounded-lg bg-slate-800 text-white hover:bg-slate-700 shrink-0">
                          usar este
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {busca.trim().length >= 2 && !buscando && resultados.length === 0 && (
                  <p className="text-xs text-slate-400 mt-2">Nenhum produto encontrado.</p>
                )}
              </div>
            </div>
          )}

          {/* ── ABA ORIGEM ────────────────────────────────────────────── */}
          {aba === 'origem' && (
            <div className="space-y-4">
              <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                Tudo aqui é <b>somente leitura</b> — é o que foi capturado, guardado sem alteração.
                Editar acontece na aba Conteúdo.
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Vendedor', rascunho.origem_vendedor ?? '—'],
                  ['Preço', brl(rascunho.preco_origem)],
                  ['Preço cheio', origem.precoDe ? brl(origem.precoDe) : '—'],
                  ['Condição', origem.condicao ?? '—'],
                ].map(([r, v]) => (
                  <div key={r} className="border border-slate-200 rounded-lg px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{r}</p>
                    <p className="text-sm text-slate-800 mt-0.5 truncate">{v}</p>
                  </div>
                ))}
              </div>

              {origem.categoriaAparente && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Categoria na origem</p>
                  <p className="text-sm text-slate-700">{origem.categoriaAparente}</p>
                </div>
              )}

              {imagensOrigem.length > 0 && (
                <p className="text-sm text-slate-600">
                  {imagensOrigem.length} imagem(ns) capturada(s) —{' '}
                  <button type="button" onClick={() => setAba('imagens')}
                    className="text-blue-600 hover:underline">escolher quais entram no anúncio</button>.
                </p>
              )}

              {Array.isArray(origem.atributos) && origem.atributos.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Ficha técnica ({origem.atributos.length})
                  </p>
                  <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                    {origem.atributos.map((a: any, i: number) => (
                      <div key={i} className="flex gap-3 px-3 py-1.5 text-sm">
                        <span className="text-slate-500 w-56 shrink-0">{a.nome}</span>
                        <span className="text-slate-800">{a.valor}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {origem.descricao && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Descrição capturada</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-72 overflow-y-auto">
                    {origem.descricao}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Coluna lateral ──────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="border border-slate-200 rounded-xl p-4 bg-white">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">Saúde do rascunho</h2>
              <span className="text-xs text-slate-500">{prontos}/{checks.length}</span>
            </div>
            <ul className="space-y-1.5">
              {checks.map(c => (
                <li key={c.rotulo} className="flex gap-2 text-xs" title={c.ok ? '' : c.dica}>
                  <span className={c.ok ? 'text-emerald-600' : 'text-amber-500'}>{c.ok ? '✓' : '!'}</span>
                  <span className={c.ok ? 'text-slate-600' : 'text-slate-800'}>{c.rotulo}</span>
                </li>
              ))}
            </ul>
            {prontos < checks.length && (
              <p className="text-[11px] text-slate-400 mt-2">Passe o mouse no item pendente para saber por quê.</p>
            )}
          </div>

          <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-2">
            <button onClick={() => salvar()} disabled={salvando}
              className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50">
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
            <button onClick={() => salvar({ status: 'aguardando_revisao' })} disabled={salvando}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-50">
              Salvar e marcar para revisão
            </button>
            <button onClick={() => salvar({ status: 'pronto' })} disabled={salvando || prontos < checks.length}
              title={prontos < checks.length ? 'Resolva os itens pendentes da saúde do rascunho primeiro.' : ''}
              className="w-full px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-sm hover:bg-emerald-50 disabled:opacity-40">
              Marcar como pronto
            </button>
            <p className="text-[11px] text-slate-400 pt-1">
              Publicar em marketplace ainda não faz parte deste módulo — por enquanto o rascunho
              chega até &quot;pronto&quot;.
            </p>
          </div>

          {historico.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-4 bg-white">
              <h2 className="text-sm font-semibold text-slate-800 mb-2">Histórico</h2>
              <ul className="space-y-1.5">
                {historico.map(h => (
                  <li key={h.id} className="text-[11px] text-slate-500">
                    <span className="text-slate-700">{h.acao}</span>
                    {' · '}
                    {new Date(h.created_at).toLocaleString('pt-BR')}
                    {h.usuario_nome ? ` · ${h.usuario_nome}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Imagem em tamanho grande — é aqui que dá para enxergar marca d'água,
          logotipo ou telefone impresso na foto, que no polegar não aparece. */}
      {zoom && (
        <div onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain" />
          <div className="absolute bottom-4 left-0 right-0 text-center">
            <p className="text-white/80 text-xs">
              Tem logo, marca d&apos;água ou telefone de outra loja? Então essa imagem não serve.
              {' '}<a href={zoom} target="_blank" rel="noreferrer noopener"
                onClick={e => e.stopPropagation()}
                className="underline">abrir em outra aba</a>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Campo editável com o texto da origem ao lado, para comparar sem copiar. */
function Campo({ rotulo, original, children }: { rotulo: string; original?: string | null; children: React.ReactNode }) {
  const [verOriginal, setVerOriginal] = useState(false)
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="text-xs font-medium text-slate-600">{rotulo}</label>
        {original && (
          <button type="button" onClick={() => setVerOriginal(v => !v)}
            className="text-[11px] text-blue-600 hover:underline">
            {verOriginal ? 'esconder o da origem' : 'ver o da origem'}
          </button>
        )}
      </div>
      {children}
      {verOriginal && original && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Texto do anúncio de origem</p>
          <p className="text-xs text-slate-600 whitespace-pre-wrap max-h-52 overflow-y-auto">{original}</p>
        </div>
      )}
    </div>
  )
}

function LinhaCandidato({ c, destaque, onEscolher, desabilitado }: {
  c: Candidato; destaque?: boolean; onEscolher: () => void; desabilitado?: boolean
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${destaque ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm text-slate-800 truncate">{c.nome}</p>
          <BadgeConfianca metodo={c.metodo} score={c.score} />
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">
          SKU {c.sku ?? '—'} · venda {brl(c.precoVenda)} · estoque {c.estoque}
          {c.marca ? ` · ${c.marca}` : ''}
        </p>
      </div>
      <button onClick={onEscolher} disabled={desabilitado}
        className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-white hover:bg-slate-700 shrink-0 disabled:opacity-50">
        vincular
      </button>
    </div>
  )
}
