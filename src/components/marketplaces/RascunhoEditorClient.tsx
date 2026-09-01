'use client'

import { useState, useEffect, useCallback, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { limparTextoOrigem } from '@/lib/marketplaces/limparTextoOrigem'
import CriarAnuncioMercadoLivreModal from './CriarAnuncioMercadoLivreModal'
import CriarAnuncioShopeeModal from './CriarAnuncioShopeeModal'

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
  rascunho, historico, canais, empresaId,
}: {
  rascunho: Rascunho
  historico: { id: string; acao: string; observacao: string | null; created_at: string; usuario_nome: string | null }[]
  canais: { id: string; nome: string; plataforma: string }[]
  empresaId: string
}) {
  const router = useRouter()
  const origem = rascunho.dados_origem ?? {}
  const editados = rascunho.dados_editados ?? {}

  const [aba, setAba] = useState<'conteudo' | 'imagens' | 'produto' | 'comercial' | 'origem'>(
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

  // Imagens que o operador trouxe: subiu do computador ou colou o endereço.
  // Ficam separadas das capturadas porque são de outra natureza — a captura é
  // material de terceiro, para conferir; estas são da loja, e o próprio aviso
  // desta tela diz que foto própria é sempre a escolha melhor.
  const [imagensProprias, setImagensProprias] = useState<string[]>(
    Array.isArray(editados.imagensProprias) ? editados.imagensProprias : [])
  const [subindoImagem, setSubindoImagem] = useState(false)
  const [erroImagem, setErroImagem] = useState('')
  const [urlNova, setUrlNova] = useState('')

  function adicionarPropria(url: string) {
    setImagensProprias(atual => (atual.includes(url) ? atual : [...atual, url]))
    // Já entra escolhida: quem subiu a foto quer usá-la — e como entra no fim
    // da lista, não rouba a capa de quem já estava escolhido.
    setImagensEscolhidas(atual => (atual.includes(url) ? atual : [...atual, url]))
  }

  function removerPropria(url: string) {
    setImagensProprias(atual => atual.filter(x => x !== url))
    setImagensEscolhidas(atual => atual.filter(x => x !== url))
  }

  async function subirImagens(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? [])
    if (arquivos.length === 0) return
    setSubindoImagem(true); setErroImagem('')
    const sb = createClient()
    const falhas: string[] = []
    for (const arquivo of arquivos) {
      const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      // Guardadas por rascunho, não por produto: no momento do upload o
      // rascunho pode nem ter produto vinculado ainda.
      const caminho = `${empresaId}/rascunhos/${rascunho.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await sb.storage.from('produto-imagens').upload(caminho, arquivo, { upsert: false })
      if (error) { falhas.push(`${arquivo.name}: ${error.message}`); continue }
      const { data: { publicUrl } } = sb.storage.from('produto-imagens').getPublicUrl(caminho)
      adicionarPropria(publicUrl)
    }
    if (falhas.length > 0) setErroImagem('Não subiu: ' + falhas.join('; '))
    setSubindoImagem(false)
    e.target.value = ''
  }

  function adicionarPorUrl() {
    const url = urlNova.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      setErroImagem('O endereço precisa começar com http:// ou https://')
      return
    }
    setErroImagem('')
    adicionarPropria(url)
    setUrlNova('')
  }

  // ── Conferência das capturadas com IA ─────────────────────────────────────
  // A IA olha e opina; ela não marca nem desmarca imagem nenhuma. Quem escolhe
  // continua sendo o operador — o resultado aqui é aviso, não decisão.
  type AchadoImagem = { url: string; problemas: string[]; observacao: string | null; serveDeCapa: boolean }
  const [conferindo, setConferindo] = useState(false)
  const [achados, setAchados] = useState<Record<string, AchadoImagem> | null>(null)
  const [melhorCapa, setMelhorCapa] = useState<string | null>(null)
  const [erroConferencia, setErroConferencia] = useState('')

  const ROTULO_PROBLEMA: Record<string, string> = {
    marca_dagua: "marca d'água", logotipo: 'logotipo', telefone: 'telefone/contato',
    texto_promocional: 'texto de propaganda', colagem: 'montagem',
    outro_produto: 'outro produto', baixa_qualidade: 'qualidade ruim',
  }

  async function conferirImagensComIA() {
    setConferindo(true); setErroConferencia('')
    try {
      const res = await fetch(`/api/marketplaces/rascunhos/${rascunho.id}/analisar-imagens`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status}`)
      const mapa: Record<string, AchadoImagem> = {}
      for (const item of d.imagens as AchadoImagem[]) mapa[item.url] = item
      setAchados(mapa)
      setMelhorCapa(d.melhorCapaUrl ?? null)
      if (d.naoAnalisadas > 0) {
        // Pode ser teto da rodada ou imagem que não baixou — em qualquer dos
        // casos o que importa ao operador é que aquelas continuam sem conferir.
        setErroConferencia(`${d.naoAnalisadas} imagem(ns) ficaram de fora (limite de 12 por rodada, ou não abriram). Confira essas no olho.`)
      }
    } catch (e: unknown) {
      setErroConferencia(e instanceof Error ? e.message : 'Falha ao conferir as imagens')
    } finally {
      setConferindo(false)
    }
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

  // ── Publicação ────────────────────────────────────────────────────────────
  // Só Mercado Livre e Shopee sabem criar anúncio hoje. Canal de outra
  // plataforma aparece na lista com o motivo, em vez de sumir e deixar o
  // operador procurando por que a loja dele não está ali.
  const PUBLICAVEIS = ['mercadolivre', 'shopee']
  const [publicandoEm, setPublicandoEm] = useState<{ id: string; nome: string; plataforma: string } | null>(null)
  const [copiandoImagens, setCopiandoImagens] = useState(false)
  const publicacoes: any[] = Array.isArray(editados.publicacoes) ? editados.publicacoes : []

  // Manda a escolha que está NA TELA, e não a que está salva: o operador pode
  // ter mexido nas imagens sem salvar, e o conteúdo do anúncio (título,
  // descrição, preço) já sai daqui do mesmo jeito.
  async function copiarImagensParaProduto(): Promise<{ ok: boolean; erro?: string }> {
    setCopiandoImagens(true); setMsg(null)
    try {
      const res = await fetch(`/api/marketplaces/rascunhos/${rascunho.id}/copiar-imagens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagens: imagensEscolhidas }),
      })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status}`)
      // `recusadas` deve ser sempre zero — a tela só oferece imagem que o
      // rascunho conhece. Se aparecer, é sinal de que a escolha e o rascunho
      // saíram de sincronia, e isso precisa ser dito: imagem sumindo em
      // silêncio foi o defeito que este caminho existe para consertar.
      const ignoradas = d.recusadas > 0
        ? ` ${d.recusadas} imagem(ns) fora deste rascunho foram ignoradas.`
        : ''
      setMsg({
        tipo: 'ok',
        texto: (d.adicionadas > 0
          ? `${d.adicionadas} imagem(ns) adicionada(s) ao produto${d.jaExistiam ? ` (${d.jaExistiam} já estavam lá)` : ''}.`
          : 'Essas imagens já estavam no produto.') + ignoradas,
      })
      router.refresh()
      return { ok: true }
    } catch (e: any) {
      const erro = String(e?.message ?? e)
      setMsg({ tipo: 'erro', texto: erro })
      return { ok: false, erro }
    } finally {
      setCopiandoImagens(false)
    }
  }

  // Publicar leva as imagens escolhidas para o cadastro do produto ANTES de
  // abrir o modal — é de lá que o anúncio as lê (produto_imagens), tanto no
  // Mercado Livre quanto na Shopee.
  //
  // Enquanto essa ponte foi só um botão à parte, o caminho natural (escolher,
  // salvar, marcar como pronto, publicar) chegava no marketplace com ZERO
  // imagem, e o modal abria dizendo que o produto não tem foto cadastrada. A
  // tela avisava que era assim, em letra miúda; ninguém lê letra miúda no meio
  // de um fluxo que parece pronto.
  //
  // Falhou a cópia? Não abre. Publicar sem foto é erro garantido no Mercado
  // Livre (ele exige pelo menos uma) e anúncio ruim na Shopee.
  async function abrirPublicacao(c: { id: string; nome: string; plataforma: string }) {
    if (imagensEscolhidas.length === 0) { setPublicandoEm(c); return }
    const r = await copiarImagensParaProduto()
    if (!r.ok) return
    setPublicandoEm(c)
  }

  async function registrarPublicacao(canal: { id: string; nome: string }) {
    try {
      await fetch(`/api/marketplaces/rascunhos/${rascunho.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrarPublicacao: { canalId: canal.id } }),
      })
    } finally {
      setPublicandoEm(null)
      router.refresh()
    }
  }

  // ── Preço e estoque pelas regras já cadastradas ───────────────────────────
  const [precificacao, setPrecificacao] = useState<any>(null)
  const [carregandoPreco, setCarregandoPreco] = useState(false)
  const [erroPreco, setErroPreco] = useState('')

  const calcularPrecos = useCallback(async () => {
    setCarregandoPreco(true); setErroPreco('')
    try {
      const res = await fetch(`/api/marketplaces/rascunhos/${rascunho.id}/precificar`)
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status}`)
      setPrecificacao(d)
    } catch (e: any) {
      setErroPreco(String(e?.message ?? e))
    } finally {
      setCarregandoPreco(false)
    }
  }, [rascunho.id])

  // Só busca quando a aba é aberta, e só uma vez — é consulta que varre
  // canais, regras e estoque por depósito; não faz sentido pagar isso em toda
  // abertura do rascunho.
  useEffect(() => {
    if (aba === 'comercial' && !precificacao && !carregandoPreco) calcularPrecos()
  }, [aba, precificacao, carregandoPreco, calcularPrecos])

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
            imagensProprias,
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
              ['comercial', 'Preço e estoque'],
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

              {imagensOrigem.length > 0 && (
                <div className="space-y-2">
                  <button type="button" onClick={conferirImagensComIA} disabled={conferindo}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 border border-violet-200 text-violet-700 text-sm font-medium rounded-lg transition-colors">
                    {conferindo ? '✨ Olhando as imagens...' : `✨ Conferir as ${imagensOrigem.length} capturadas com IA`}
                  </button>
                  {erroConferencia && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{erroConferencia}</p>
                  )}
                  {achados && (
                    <p className="text-xs text-slate-500">
                      {(() => {
                        const sujas = Object.values(achados).filter(a => a.problemas.length > 0).length
                        if (sujas === 0) return 'A IA não viu marca d\'água, logo nem telefone em nenhuma. Confira mesmo assim antes de publicar.'
                        return `A IA desconfiou de ${sujas} imagem(ns) — veja as tarjas abaixo. Ela pode errar nos dois sentidos: olhe as marcadas e também as limpas.`
                      })()}
                    </p>
                  )}
                </div>
              )}

              {/* Imagens próprias — subir do computador ou colar o endereço */}
              <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Suas imagens {imagensProprias.length > 0 && `(${imagensProprias.length})`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 bg-blue-50 text-xs font-medium cursor-pointer hover:bg-blue-100 ${subindoImagem ? 'opacity-50' : ''}`}>
                    <input type="file" accept="image/*" multiple className="hidden"
                      onChange={subirImagens} disabled={subindoImagem} />
                    {subindoImagem ? 'Subindo...' : '↑ Subir do computador'}
                  </label>
                  <input value={urlNova} onChange={e => setUrlNova(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarPorUrl() } }}
                    placeholder="ou cole o endereço de uma imagem (https://...)"
                    className="flex-1 min-w-[220px] border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                  <button type="button" onClick={adicionarPorUrl} disabled={!urlNova.trim()}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                    Adicionar
                  </button>
                </div>
                {erroImagem && <p className="text-xs text-red-600">{erroImagem}</p>}
                {imagensProprias.length > 0 && (
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {imagensProprias.map(src => (
                      <div key={src} className="relative aspect-square rounded-lg overflow-hidden border-2 border-blue-300 bg-slate-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="w-full h-full object-contain cursor-zoom-in"
                          onClick={() => setZoom(src)} />
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold">sua</span>
                        <button type="button" onClick={() => removerPropria(src)}
                          title="Tirar esta imagem"
                          className="absolute top-1 right-1 w-5 h-5 rounded bg-white/90 border border-slate-300 text-red-600 text-xs leading-none">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-slate-400">
                  As que você sobe ficam guardadas no sistema e já entram escolhidas. Diferente das
                  capturadas, não dependem do site de origem continuar no ar.
                </p>
              </div>

              {/* Contagem e ordem valem para capturadas e próprias juntas, por
                  isso ficam fora do bloco das capturadas: um rascunho pode não
                  ter captura nenhuma e ainda assim ter foto sua. */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-slate-700">
                  <b>{imagensEscolhidas.length}</b> escolhida(s) de {imagensOrigem.length + imagensProprias.length}
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
              {imagensOrigem.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma imagem foi capturada neste rascunho.</p>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      Todas as capturadas ({imagensOrigem.length})
                    </p>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                      {imagensOrigem.map((src, i) => {
                        const escolhida = imagensEscolhidas.includes(src)
                        const achado = achados?.[src]
                        const suja = (achado?.problemas.length ?? 0) > 0
                        return (
                          <div key={i} className="space-y-1">
                            <div
                              className={`relative aspect-square rounded-lg overflow-hidden border-2 bg-slate-50 ${
                                suja ? 'border-red-400' : escolhida ? 'border-emerald-400' : 'border-slate-200'
                              }`}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt="" className="w-full h-full object-contain cursor-zoom-in"
                                onClick={() => setZoom(src)} />
                              {suja && (
                                <span className="absolute top-1 left-1 right-1 px-1 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold text-center leading-tight">
                                  {achado!.problemas.map(p => ROTULO_PROBLEMA[p] ?? p).join(' · ')}
                                </span>
                              )}
                              {!suja && melhorCapa === src && (
                                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-violet-600 text-white text-[9px] font-bold">
                                  boa capa
                                </span>
                              )}
                              <button type="button" onClick={() => alternarImagem(src)}
                                className={`absolute bottom-1 left-1 right-1 py-1 rounded text-[10px] font-semibold ${escolhida ? 'bg-emerald-600 text-white' : 'bg-white/90 border border-slate-300 text-slate-700'}`}>
                                {escolhida ? '✓ escolhida' : 'usar esta'}
                              </button>
                            </div>
                            {achado?.observacao && (
                              <p className={`text-[10px] leading-tight ${suja ? 'text-red-700' : 'text-slate-400'}`}>
                                {achado.observacao}
                              </p>
                            )}
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

          {/* ── ABA PREÇO E ESTOQUE ───────────────────────────────────── */}
          {aba === 'comercial' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-800">Preço pelas regras da empresa</h2>
                <button onClick={calcularPrecos} disabled={carregandoPreco}
                  className="text-xs text-blue-600 hover:underline">
                  {carregandoPreco ? 'calculando...' : 'recalcular'}
                </button>
              </div>

              {erroPreco && (
                <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{erroPreco}</div>
              )}

              {!precificacao && carregandoPreco && (
                <p className="text-sm text-slate-400">Consultando canais e regras...</p>
              )}

              {precificacao?.semProduto && (
                <div className="px-3 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                  {precificacao.aviso}{' '}
                  <button onClick={() => setAba('produto')} className="underline">ir para a aba Produto</button>
                </div>
              )}

              {precificacao && !precificacao.semProduto && (
                <>
                  {/* Referências: de onde sai o cálculo */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      ['Custo de referência', brl(precificacao.custoReferencia),
                        precificacao.kit ? 'somado dos componentes do kit' : 'custo do produto'],
                      ['Preço no seu catálogo', brl(precificacao.produto.precoVenda), null],
                      ['Estoque', String(precificacao.kit ? precificacao.kit.estoque : precificacao.produto.estoque),
                        precificacao.kit ? 'kits possíveis' : null],
                      ['Preço na origem', precificacao.precoOrigem != null ? brl(precificacao.precoOrigem) : '—',
                        'só referência'],
                    ].map(([r, v, nota]) => (
                      <div key={r as string} className="border border-slate-200 rounded-lg px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{r}</p>
                        <p className="text-sm text-slate-800 mt-0.5">{v}</p>
                        {nota && <p className="text-[10px] text-slate-400">{nota}</p>}
                      </div>
                    ))}
                  </div>

                  {precificacao.custoReferencia <= 0 && (
                    <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      O produto vinculado está <b>sem custo cadastrado</b>. Regras que calculam a
                      partir do custo não têm como rodar, e o markup não pode ser conferido.
                    </div>
                  )}

                  {precificacao.canais.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Nenhum canal ativo. Conecte um marketplace em Marketplaces → Canais.
                    </p>
                  ) : precificacao.totalRegras === 0 ? (
                    <p className="text-sm text-slate-500">
                      Você tem canal ativo, mas nenhuma regra de preço cadastrada. Crie em
                      Marketplaces → Regras de Preço — as mesmas regras valem aqui.
                    </p>
                  ) : (
                    precificacao.canais.map((canal: any) => (
                      <div key={canal.canalId}>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                          {canal.canalNome}
                        </p>

                        {/* DE ONDE SAIU CADA NÚMERO deste canal. Um frete
                            suposto não pode ter a mesma cara de um medido —
                            é a regra que este módulo aprendeu caro. */}
                        {canal.economia && (
                          <div className="flex items-center gap-1.5 flex-wrap mb-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              canal.economia.comissaoMedida
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                              {canal.economia.comissaoMedida ? '🔵 comissão medida' : '⚠ comissão suposta'}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              canal.economia.freteMedido
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                              {canal.economia.freteMedido ? '🔵 frete medido' : '⚠ frete NÃO medido'}
                            </span>
                          </div>
                        )}

                        {canal.economia?.avisos?.length > 0 && (
                          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
                            {canal.economia.avisos.map((a: string, i: number) => (
                              <p key={i} className="text-[11px] text-amber-800">{a}</p>
                            ))}
                          </div>
                        )}

                        {canal.regras.length === 0 ? (
                          <p className="text-xs text-slate-400 mb-3">
                            Sem regra ativa neste canal.{' '}
                            <a href={`/dashboard/marketplaces/${canal.canalId}/regras`}
                              className="text-blue-600 hover:underline">cadastrar regra</a>
                          </p>
                        ) : (
                          <div className="space-y-2 mb-4">
                            {canal.regras.map((r: any) => (
                              <div key={r.id}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${r.abaixoDoCusto ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm text-slate-800">{r.nome}</p>
                                    {r.paraPausar && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                                        estoque de risco
                                      </span>
                                    )}
                                    {r.abaixoDoCusto && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                                        no prejuízo
                                      </span>
                                    )}
                                  </div>
                                  {r.aplicavel ? (
                                    <>
                                      <p className="text-[11px] text-slate-500 mt-0.5">
                                        {r.preco != null ? <>preço {brl(r.preco)}</> : 'sem preço'}
                                        {r.margemLiquida != null && (
                                          <> · <span className={r.margemLiquida < 0 ? 'text-red-700 font-semibold' : ''}>
                                            margem líquida {r.margemLiquida.toFixed(1)}%
                                          </span></>
                                        )}
                                        {r.lucroUnitario != null && <> ({brl(r.lucroUnitario)}/un)</>}
                                        {r.estoque != null && <> · estoque {r.estoque}</>}
                                        {r.depositoNome && <> · depósito {r.depositoNome}</>}
                                      </p>
                                      {/* A DECOMPOSIÇÃO. Sem ela "margem 12%"
                                          é um número para acreditar; com ela é
                                          um número para conferir. */}
                                      <p className="text-[10px] text-slate-400 mt-0.5">
                                        {r.comissao != null && <>comissão {brl(r.comissao)}</>}
                                        {r.frete != null && (
                                          <> · frete {brl(r.frete)}
                                            {!canal.economia?.freteMedido && r.frete === 0 && (
                                              <span className="text-amber-700 font-semibold"> (suposto)</span>
                                            )}
                                          </>
                                        )}
                                        {r.markup != null && <> · markup {r.markup.toFixed(1)}%</>}
                                      </p>
                                    </>
                                  ) : (
                                    <p className="text-[11px] text-amber-700 mt-0.5">{r.motivo}</p>
                                  )}
                                </div>
                                {r.aplicavel && r.preco != null && (
                                  <button
                                    onClick={() => { setPreco(String(r.preco)); setAba('conteudo') }}
                                    className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-white hover:bg-slate-700 shrink-0">
                                    usar {brl(r.preco)}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  <p className="text-[11px] text-slate-400">
                    A margem líquida é o que sobra depois de comissão, frete, imposto e embalagem —
                    calculada com a configuração real de cada canal, não com a de outro. O markup é
                    sobre o custo e por isso é sempre maior que a margem.
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Clicar em &quot;usar&quot; só preenche o campo de preço na aba Conteúdo. Nada é
                    enviado para marketplace nenhum — publicar ainda não faz parte deste módulo.
                  </p>
                </>
              )}
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
          </div>

          {/* ── Publicar ───────────────────────────────────────────────── */}
          <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-2">
            <h2 className="text-sm font-semibold text-slate-800">Publicar</h2>

            {publicacoes.length > 0 && (
              <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                Já publicado em: {publicacoes.map((p: any) => p.canalNome).join(', ')}
              </div>
            )}

            {!produto ? (
              <p className="text-xs text-slate-500">Vincule um produto antes de publicar.</p>
            ) : prontos < checks.length ? (
              <p className="text-xs text-amber-700">
                Resolva os itens pendentes da saúde do rascunho antes de publicar.
              </p>
            ) : canais.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum canal ativo.</p>
            ) : (
              <>
                {imagensEscolhidas.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                    <button onClick={() => copiarImagensParaProduto()} disabled={copiandoImagens}
                      className="text-xs text-blue-700 hover:underline disabled:opacity-50">
                      {copiandoImagens ? 'copiando...' : `Levar as ${imagensEscolhidas.length} imagens escolhidas para o produto`}
                    </button>
                    <p className="text-[10px] text-slate-500 mt-1">
                      O anúncio usa as imagens do <b>cadastro do produto</b>. Publicar já leva as
                      escolhidas para lá — este botão serve para mandá-las antes.
                    </p>
                  </div>
                )}

                {canais.map(c => {
                  const podePublicar = PUBLICAVEIS.includes(c.plataforma)
                  const jaFoi = publicacoes.some((p: any) => p.canalId === c.id)
                  return (
                    <div key={c.id} className="flex items-center gap-2">
                      <button
                        onClick={() => abrirPublicacao(c)}
                        disabled={!podePublicar || copiandoImagens}
                        title={podePublicar ? '' : `O sistema ainda não cria anúncio em ${c.plataforma}.`}
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-40 text-left">
                        {copiandoImagens
                          ? 'levando as imagens para o produto...'
                          : <>{jaFoi ? '↻ Publicar de novo em ' : 'Publicar em '}<b>{c.nome}</b></>}
                        {!podePublicar && <span className="text-[10px] text-slate-400"> (não disponível)</span>}
                      </button>
                    </div>
                  )
                })}

                <p className="text-[11px] text-amber-700 pt-1">
                  Publicar cria um anúncio <b>de verdade</b> na sua conta de vendedor, com o preço
                  que estiver na tela de confirmação. Confira antes de concluir.
                </p>
              </>
            )}
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

      {/* Publicação: reaproveita as mesmas telas usadas para criar anúncio a
          partir do produto, já preenchidas com o conteúdo do rascunho. Elas é
          que sabem pedir categoria, atributos obrigatórios e logística de cada
          marketplace — refazer isso aqui seria duplicar o que já funciona. */}
      {publicandoEm?.plataforma === 'mercadolivre' && produto && (
        <CriarAnuncioMercadoLivreModal
          canal={{ id: publicandoEm.id, nome: publicandoEm.nome }}
          empresaId={empresaId}
          produtoIdInicial={produto.id}
          conteudoInicial={{ titulo, descricao, preco }}
          onClose={() => setPublicandoEm(null)}
          onCriado={() => registrarPublicacao(publicandoEm)}
        />
      )}
      {publicandoEm?.plataforma === 'shopee' && produto && (
        <CriarAnuncioShopeeModal
          canal={{ id: publicandoEm.id, nome: publicandoEm.nome }}
          empresaId={empresaId}
          produtoIdInicial={produto.id}
          conteudoInicial={{ titulo, descricao, preco }}
          onClose={() => setPublicandoEm(null)}
          onCriado={() => registrarPublicacao(publicandoEm)}
        />
      )}

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
