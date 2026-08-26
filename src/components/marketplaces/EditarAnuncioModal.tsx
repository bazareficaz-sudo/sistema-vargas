'use client'

import { useState, useEffect, type ChangeEvent, type DragEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'
import { formatarTituloAnuncio } from '@/lib/texto/titulo'
import PainelDimensoesImagens from './PainelDimensoesImagens'
import CampoAtributo, {
  atributosVisiveis, atributoPreenchido,
  type AtributoShopee, type ValorEscolhidoShopee,
} from './CampoAtributoShopee'

// Editar um anúncio que JÁ EXISTE no marketplace.
//
// O modal antigo editava sete campos de texto e gravava direto na tabela. O
// problema não era o tamanho: `marketplace_anuncios` é um ESPELHO, e o sync
// sobrescreve título, descrição, fotos e preço com o que a plataforma diz a
// cada rodada. Editar só aqui era escrever na areia — e a tela não avisava.
//
// Então esta tela edita o anúncio LÁ, e relê o resultado. O que a plataforma
// não aceita, ela diz, e o aviso aparece. O que a plataforma não deixa mudar
// por API (categoria, variação existente) fica de fora, escrito, em vez de
// virar um campo que finge funcionar.

type Foto = { url: string; idExterno: string | null }
type AtributoML = { id: string; name: string; obrigatorio: boolean; condicional?: boolean; tipo: string; valores: { id: string; name: string }[] }
type Marca = { brand_id: number; original_brand_name: string }
type Variacao = { id: string; model_id: string; nome_variacao: string | null; sku_variacao: string | null; preco: number | null; estoque: number | null; status_externo: string | null; produto_id: string | null }

type Dados = {
  anuncio: any
  canal: { id: string; nome: string; plataforma: string; conectado: boolean }
  limites: { titulo: number; descricao: number; imagens: number }
  aceitaEdicaoNoCanal: boolean
  imagens: Foto[]
  atributosShopee: { attributeId: number; valueIds: number[]; texto?: string; unidade?: string }[]
  atributosML: { id: string; valor: string }[]
  tipoDescricao: string | null
  ficha: {
    pesoKg: number | null; comprimentoCm: number | null; larguraCm: number | null; alturaCm: number | null
    condicao: string | null; marcaId: number | null; marcaNome: string | null; categoriaId: string | null; skuCanal: string | null
  }
  variacoes: Variacao[]
  produto: any | null
}

const ABAS = [
  ['conteudo', 'Conteúdo'],
  ['imagens', 'Imagens'],
  ['ficha', 'Ficha técnica'],
  ['preco', 'Preço e estoque'],
  ['variacoes', 'Variações'],
  ['sistema', 'Vínculo e sistema'],
] as const
type Aba = typeof ABAS[number][0]

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho', ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado', erro: 'Erro',
}

/**
 * Texto estável para comparar o mapa de valores dos atributos com o que ele
 * era ao abrir a aba.
 *
 * `JSON.stringify` cru não serve: o objeto de valor montado na carga tem as
 * chaves noutra ordem do que o montado ao editar, e a comparação acusaria
 * mudança em atributo que ninguém tocou — que é justamente o que este
 * retrato existe para evitar.
 */
function retratoAtributos(valores: Record<string | number, unknown>): string {
  return JSON.stringify(
    Object.keys(valores).sort().map(k => {
      const v = valores[k]
      if (v == null || typeof v !== 'object') return [k, v ?? null]
      const obj = v as Record<string, unknown>
      return [k, Object.keys(obj).sort().map(c => [c, obj[c] ?? null])]
    }),
  )
}

export default function EditarAnuncioModal({ anuncio, canal, empresaId, produtos, onClose, onSalvo }: {
  anuncio: any
  canal: any
  empresaId: string
  produtos: any[]
  onClose: () => void
  onSalvo: (anuncioAtualizado: any) => void
}) {
  const plataforma: string = canal.plataforma
  const nomePlataforma = plataforma === 'mercadolivre' ? 'Mercado Livre'
    : plataforma === 'shopee' ? 'Shopee'
    : plataforma === 'nuvemshop' ? 'Nuvemshop' : canal.nome

  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState('')
  const [aba, setAba] = useState<Aba>('conteudo')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])
  const [sucesso, setSucesso] = useState('')
  const [enviarAoCanal, setEnviarAoCanal] = useState(true)

  // ── Formulário ────────────────────────────────────────────────────────────
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [precoVenda, setPrecoVenda] = useState('')
  const [precoPromocional, setPrecoPromocional] = useState('')
  const [promoInicio, setPromoInicio] = useState('')
  const [promoFim, setPromoFim] = useState('')
  const [estoque, setEstoque] = useState('')
  const [skuCanal, setSkuCanal] = useState('')
  const [idExterno, setIdExterno] = useState('')
  const [urlAnuncio, setUrlAnuncio] = useState('')
  const [status, setStatus] = useState('')
  const [produtoId, setProdutoId] = useState('')
  const [buscaProd, setBuscaProd] = useState('')
  const [fotos, setFotos] = useState<Foto[]>([])
  const [peso, setPeso] = useState('')
  const [comprimento, setComprimento] = useState('')
  const [largura, setLargura] = useState('')
  const [altura, setAltura] = useState('')
  const [formVariacoes, setFormVariacoes] = useState<Record<string, { preco: string; estoque: string }>>({})

  // Original, para mandar ao marketplace só o que de fato mudou. Enviar um
  // campo inalterado não é inofensivo: cada campo enviado é um campo que a
  // plataforma pode revalidar e recusar.
  const [original, setOriginal] = useState<any>(null)

  useEffect(() => {
    let ativo = true
    ;(async () => {
      try {
        const resp = await fetch(`/api/marketplaces/anuncios/${anuncio.id}/editar`)
        const d = await resp.json()
        if (!ativo) return
        if (!d.ok) { setErroCarga(d.erro ?? 'Não foi possível abrir este anúncio'); setCarregando(false); return }

        const a = d.anuncio
        setDados(d)
        setTitulo(a.titulo ?? '')
        setDescricao(a.descricao ?? '')
        setPrecoVenda(a.precoVenda != null ? String(a.precoVenda) : '')
        setPrecoPromocional(a.precoPromocional != null ? String(a.precoPromocional) : '')
        setPromoInicio(a.promoInicio ?? '')
        setPromoFim(a.promoFim ?? '')
        setEstoque(a.estoqueReservado != null ? String(a.estoqueReservado) : '0')
        setSkuCanal(a.skuCanal ?? '')
        setIdExterno(a.idExterno ?? '')
        setUrlAnuncio(a.urlAnuncio ?? '')
        setStatus(a.status ?? 'rascunho')
        setProdutoId(a.produtoId ?? '')
        setBuscaProd(d.produto?.nome ?? '')
        setFotos(d.imagens ?? [])
        setPeso(d.ficha.pesoKg != null ? String(d.ficha.pesoKg) : '')
        setComprimento(d.ficha.comprimentoCm != null ? String(d.ficha.comprimentoCm) : '')
        setLargura(d.ficha.larguraCm != null ? String(d.ficha.larguraCm) : '')
        setAltura(d.ficha.alturaCm != null ? String(d.ficha.alturaCm) : '')
        setMarcaId(d.ficha.marcaId != null ? String(d.ficha.marcaId) : '')

        const vars: Record<string, { preco: string; estoque: string }> = {}
        for (const v of d.variacoes ?? []) {
          vars[v.id] = { preco: v.preco != null ? String(v.preco) : '', estoque: v.estoque != null ? String(v.estoque) : '' }
        }
        setFormVariacoes(vars)
        setEnviarAoCanal(!!d.aceitaEdicaoNoCanal)
        setOriginal({
          titulo: a.titulo ?? '', descricao: a.descricao ?? '',
          precoVenda: a.precoVenda ?? null, estoque: a.estoqueReservado ?? null,
          skuCanal: a.skuCanal ?? '', status: a.status ?? '',
          fotos: JSON.stringify((d.imagens ?? []).map((f: Foto) => f.url)),
          peso: d.ficha.pesoKg, comprimento: d.ficha.comprimentoCm, largura: d.ficha.larguraCm, altura: d.ficha.alturaCm,
          marcaId: d.ficha.marcaId != null ? String(d.ficha.marcaId) : '',
          variacoes: vars,
        })
      } catch (e: any) {
        if (ativo) setErroCarga(e?.message ?? 'Erro ao carregar o anúncio')
      } finally {
        if (ativo) setCarregando(false)
      }
    })()
    return () => { ativo = false }
  }, [anuncio.id])

  // ── Atributos da categoria ────────────────────────────────────────────────
  // Carregados sob demanda, na primeira vez que a aba é aberta: são uma
  // chamada à API do marketplace, e a maioria das edições é de texto ou foto.
  const [atributosShopee, setAtributosShopee] = useState<AtributoShopee[]>([])
  const [valoresShopee, setValoresShopee] = useState<Record<number, ValorEscolhidoShopee>>({})
  const [atributosML, setAtributosML] = useState<AtributoML[]>([])
  const [valoresML, setValoresML] = useState<Record<string, string>>({})
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [marcaId, setMarcaId] = useState('')
  const [carregandoAtributos, setCarregandoAtributos] = useState(false)
  const [erroAtributos, setErroAtributos] = useState('')
  const [atributosCarregados, setAtributosCarregados] = useState(false)
  const [caminhoCategoria, setCaminhoCategoria] = useState<string>('')
  // Retrato dos atributos como estavam ao abrir a aba, para saber se o
  // operador realmente mexeu neles — ver `atributosMudaram`.
  const [atributosOriginais, setAtributosOriginais] = useState<string | null>(null)

  useEffect(() => {
    if (aba !== 'ficha' || !dados || atributosCarregados || carregandoAtributos) return
    const categoriaId = dados.ficha.categoriaId ?? dados.anuncio.categoriaExterna
    if (!categoriaId || !dados.canal.conectado) return
    if (plataforma !== 'shopee' && plataforma !== 'mercadolivre') return

    setCarregandoAtributos(true); setErroAtributos('')
    ;(async () => {
      try {
        const resp = await fetch(`/api/marketplace/${plataforma}/atributos`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canal.id, categoryId: plataforma === 'shopee' ? Number(categoriaId) : String(categoriaId) }),
        })
        const d = await resp.json()
        if (!d.ok) { setErroAtributos(d.erro ?? 'Não foi possível carregar a ficha desta categoria'); return }

        if (plataforma === 'shopee') {
          setAtributosShopee(d.atributos ?? [])
          setMarcas(d.marcas ?? [])
          // O que já está no anúncio entra preenchido: editar ficha técnica é
          // corrigir o que existe, não redigitar tudo.
          const iniciais: Record<number, ValorEscolhidoShopee> = {}
          for (const a of dados.atributosShopee) {
            iniciais[a.attributeId] = {
              valueId: a.valueIds.length === 1 ? a.valueIds[0] : undefined,
              valueIds: a.valueIds.length > 1 ? a.valueIds : undefined,
              texto: a.texto, unidade: a.unidade,
            }
          }
          setValoresShopee(iniciais)
          setAtributosOriginais(retratoAtributos(iniciais))
        } else {
          setAtributosML(d.atributos ?? [])
          const iniciais: Record<string, string> = {}
          for (const a of dados.atributosML) iniciais[a.id] = a.valor
          setValoresML(iniciais)
          setAtributosOriginais(retratoAtributos(iniciais))
        }
        setAtributosCarregados(true)
      } catch (e: any) {
        setErroAtributos(e?.message ?? 'Erro ao carregar a ficha da categoria')
      } finally {
        setCarregandoAtributos(false)
      }
    })()
  }, [aba, dados, atributosCarregados, carregandoAtributos, plataforma, canal.id])

  // Caminho da categoria só existe na Shopee (o ML já manda o nome pronto no
  // anúncio). Falhar aqui nunca trava a tela: é informação, não campo.
  useEffect(() => {
    if (plataforma !== 'shopee' || !dados || caminhoCategoria) return
    const categoriaId = dados.ficha.categoriaId ?? dados.anuncio.categoriaExterna
    if (!categoriaId || !dados.canal.conectado || aba !== 'ficha') return
    ;(async () => {
      try {
        const d = await fetch('/api/marketplace/shopee/categoria-caminho', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canal.id, categoryId: Number(categoriaId) }),
        }).then(r => r.json())
        if (d.ok && Array.isArray(d.caminho) && d.caminho.length > 0) {
          setCaminhoCategoria(d.caminho.map((c: any) => c.original_category_name).join(' › '))
        }
      } catch { /* informação acessória */ }
    })()
  }, [aba, dados, plataforma, canal.id, caminhoCategoria])

  const atributosEmJogo = atributosVisiveis(atributosShopee, valoresShopee)
  const obrigatoriosFaltando = plataforma === 'shopee'
    ? atributosEmJogo.filter(a => a.is_mandatory && !atributoPreenchido(a, valoresShopee)).map(a => a.attribute_name)
    : atributosML.filter(a => a.obrigatorio && !valoresML[a.id]?.trim()).map(a => a.name)

  // ── Imagens ───────────────────────────────────────────────────────────────
  const limiteImagens = dados?.limites.imagens ?? 9
  const [subindo, setSubindo] = useState(false)
  const [erroImagem, setErroImagem] = useState('')
  const [urlNova, setUrlNova] = useState('')
  const [arrastando, setArrastando] = useState<number | null>(null)

  function moverFoto(de: number, para: number) {
    if (para < 0 || para >= fotos.length || de === para) return
    setFotos(atual => {
      const copia = [...atual]
      const [f] = copia.splice(de, 1)
      copia.splice(para, 0, f)
      return copia
    })
  }

  function soltarEm(destino: number) {
    if (arrastando == null) return
    moverFoto(arrastando, destino)
    setArrastando(null)
  }

  function removerFoto(i: number) {
    setFotos(atual => atual.filter((_, idx) => idx !== i))
  }

  function adicionarFoto(url: string) {
    setFotos(atual => (atual.some(f => f.url === url) ? atual : [...atual, { url, idExterno: null }]))
  }

  async function subirFotos(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? [])
    if (arquivos.length === 0) return
    setSubindo(true); setErroImagem('')
    const sb = createClient()
    const falhas: string[] = []
    for (const arquivo of arquivos) {
      const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      // Guardadas por anúncio, e não por produto: a foto pode ser específica
      // deste canal (arte com selo de frete grátis, por exemplo), e o anúncio
      // pode nem ter produto vinculado.
      const caminho = `${empresaId}/anuncios/${anuncio.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await sb.storage.from('produto-imagens').upload(caminho, arquivo, { upsert: false })
      if (error) { falhas.push(`${arquivo.name}: ${error.message}`); continue }
      const { data: { publicUrl } } = sb.storage.from('produto-imagens').getPublicUrl(caminho)
      adicionarFoto(publicUrl)
    }
    if (falhas.length > 0) setErroImagem('Não subiu: ' + falhas.join('; '))
    setSubindo(false)
    e.target.value = ''
  }

  function adicionarPorUrl() {
    const url = urlNova.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) { setErroImagem('O endereço precisa começar com http:// ou https://'); return }
    setErroImagem('')
    adicionarFoto(url)
    setUrlNova('')
  }

  function trazerDoProduto() {
    const p = dados?.produto
    if (!p) return
    const urls: string[] = [
      ...(p.foto_url ? [p.foto_url] : []),
      ...((p.imagens ?? []).map((i: any) => i.url)),
    ]
    let novas = 0
    for (const url of urls) {
      if (!fotos.some(f => f.url === url)) { adicionarFoto(url); novas++ }
    }
    setErroImagem(novas === 0 ? 'As fotos do cadastro já estão todas aqui.' : '')
  }

  // ── Produto vinculado ─────────────────────────────────────────────────────
  const produtosFiltrados = buscaProd.length >= 2 && !produtoId
    ? produtos.filter(p =>
        p.nome?.toLowerCase().includes(buscaProd.toLowerCase()) ||
        p.sku?.toLowerCase().includes(buscaProd.toLowerCase())
      ).slice(0, 8)
    : []

  // ── Gravar ────────────────────────────────────────────────────────────────

  function mudou(campo: string, valorAtual: any): boolean {
    if (!original) return false
    return String(original[campo] ?? '') !== String(valorAtual ?? '')
  }

  const fotosMudaram = !!original && original.fotos !== JSON.stringify(fotos.map(f => f.url))
  const fichaMudou = mudou('peso', peso) || mudou('comprimento', comprimento) || mudou('largura', largura) || mudou('altura', altura)
  // Atributo só vai para a plataforma se o operador tiver mexido nele.
  //
  // Sem isso, salvar QUALQUER coisa — trocar a ordem das fotos, corrigir uma
  // vírgula do título — reenviava a ficha técnica inteira junto. E o que é
  // reenviado não é o que está no anúncio: é o que a árvore da categoria
  // conseguiu mostrar na tela. Atributo que o anúncio tem e a categoria não
  // devolve (ou filho de um valor que não está marcado agora) simplesmente
  // não entra na lista — e `attribute_list` chega na Shopee como substituição,
  // não como remendo.
  //
  // É também o que torna possível o primeiro uso recomendado no CONTINUIDADE:
  // mexer numa coisa de cada vez. Antes, a primeira reordenação de fotos
  // levava a ficha técnica inteira de carona, sem ninguém ter pedido.
  const atributosMudaram = atributosCarregados && atributosOriginais !== null && (
    atributosOriginais !== retratoAtributos(plataforma === 'shopee' ? valoresShopee : valoresML)
  )
  const variacoesMudaram = !!original && Object.entries(formVariacoes).some(
    ([id, v]) => original.variacoes[id]?.preco !== v.preco || original.variacoes[id]?.estoque !== v.estoque)

  async function salvar() {
    if (!titulo.trim()) { setErro('O título não pode ficar vazio.'); setAba('conteudo'); return }
    if (fotos.length === 0 && fotosMudaram && enviarAoCanal) {
      setErro('O anúncio precisa de pelo menos uma foto no marketplace.'); setAba('imagens'); return
    }
    setSalvando(true); setErro(''); setAvisos([]); setSucesso('')

    // O que vai para o marketplace: só o que mudou. Atributo só entra se a
    // ficha chegou a ser carregada — mandar lista vazia apagaria a ficha
    // inteira do anúncio.
    const campos: any = {}
    if (mudou('titulo', titulo)) campos.titulo = titulo.trim()
    if (mudou('descricao', descricao)) campos.descricao = descricao
    if (fotosMudaram && fotos.length > 0) campos.imagens = fotos
    if (mudou('skuCanal', skuCanal)) campos.skuCanal = skuCanal
    if (mudou('precoVenda', precoVenda)) campos.preco = parseFloat(precoVenda) || 0
    if (mudou('estoque', estoque)) campos.estoque = parseInt(estoque) || 0
    if (fichaMudou) {
      if (peso) campos.pesoKg = parseFloat(peso)
      if (comprimento) campos.comprimentoCm = parseFloat(comprimento)
      if (largura) campos.larguraCm = parseFloat(largura)
      if (altura) campos.alturaCm = parseFloat(altura)
    }
    if (dados?.tipoDescricao) campos.tipoDescricao = dados.tipoDescricao

    if (atributosCarregados) {
      if (plataforma === 'shopee') {
        const preenchidos = atributosEmJogo
          .filter(a => atributoPreenchido(a, valoresShopee))
          .map(a => {
            const v = valoresShopee[a.attribute_id]
            return {
              attribute_id: a.attribute_id, value_id: v.valueId, valueIds: v.valueIds,
              texto: v.texto, unidade: v.unidade, inputType: a.input_type,
            }
          })
        if (atributosMudaram && preenchidos.length > 0) campos.atributosShopee = preenchidos
        const marca = marcas.find(m => String(m.brand_id) === marcaId)
        if (marca && mudou('marcaId', marcaId)) { campos.marcaId = marca.brand_id; campos.marcaNome = marca.original_brand_name }
      } else if (plataforma === 'mercadolivre') {
        const preenchidos = Object.entries(valoresML)
          .filter(([, valor]) => !!valor?.trim())
          .map(([id, valor]) => ({ id, valueName: valor.trim() }))
        // Peso e medidas do ML são atributos escondidos: não aparecem na
        // lista da categoria e precisam ser montados na mão, com a unidade
        // grudada no valor, como na publicação.
        if (fichaMudou) {
          if (altura) preenchidos.push({ id: 'SELLER_PACKAGE_HEIGHT', valueName: `${parseFloat(altura)} cm` })
          if (largura) preenchidos.push({ id: 'SELLER_PACKAGE_WIDTH', valueName: `${parseFloat(largura)} cm` })
          if (comprimento) preenchidos.push({ id: 'SELLER_PACKAGE_LENGTH', valueName: `${parseFloat(comprimento)} cm` })
          if (peso) preenchidos.push({ id: 'SELLER_PACKAGE_WEIGHT', valueName: `${Math.round(parseFloat(peso) * 1000)} g` })
        }
        // A ficha do ML viaja como atributo (SELLER_PACKAGE_*), então mudar
        // só peso/medidas também precisa mandar a lista.
        if ((atributosMudaram || fichaMudou) && preenchidos.length > 0) campos.atributosML = preenchidos
      }
    }

    if (variacoesMudaram && dados) {
      campos.variacoes = dados.variacoes
        .filter(v => {
          const f = formVariacoes[v.id]
          return f && (original.variacoes[v.id]?.preco !== f.preco || original.variacoes[v.id]?.estoque !== f.estoque)
        })
        .map(v => ({
          modelId: v.model_id,
          preco: formVariacoes[v.id].preco ? parseFloat(formVariacoes[v.id].preco) : null,
          estoque: formVariacoes[v.id].estoque ? parseInt(formVariacoes[v.id].estoque) : null,
        }))
    }

    const temAlgoParaEnviar = Object.keys(campos).filter(k => k !== 'tipoDescricao').length > 0

    try {
      // Variações são linhas nossas: gravadas aqui, no mesmo caminho que o
      // modal de envio de preço já usa.
      if (variacoesMudaram && dados) {
        const sb = createClient()
        for (const v of dados.variacoes) {
          const f = formVariacoes[v.id]
          if (!f) continue
          if (original.variacoes[v.id]?.preco === f.preco && original.variacoes[v.id]?.estoque === f.estoque) continue
          await sb.from('marketplace_anuncio_variacoes').update({
            preco: f.preco ? parseFloat(f.preco) : null,
            estoque: f.estoque ? parseInt(f.estoque) : null,
            updated_at: new Date().toISOString(),
          }).eq('id', v.id)
        }
      }

      const resp = await fetch(`/api/marketplaces/anuncios/${anuncio.id}/editar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enviar: enviarAoCanal && temAlgoParaEnviar,
          local: {
            produtoId: produtoId || null,
            titulo: titulo.trim(),
            descricao,
            precoVenda: parseFloat(precoVenda) || 0,
            precoPromocional: precoPromocional ? parseFloat(precoPromocional) : null,
            promoInicio: promoInicio || null,
            promoFim: promoFim || null,
            estoqueReservado: parseInt(estoque) || 0,
            skuCanal: skuCanal || null,
            idExterno: idExterno || null,
            urlAnuncio: urlAnuncio || null,
            status,
            ...(fotosMudaram ? { imagens: fotos.map(f => f.url) } : {}),
          },
          canal: campos,
        }),
      })
      const d = await resp.json()

      // Status ativo↔pausado tem endpoint próprio nas duas plataformas, já
      // usado pelo seletor da listagem — reaproveitar em vez de abrir um
      // segundo caminho que faz a mesma coisa.
      const trocouPausa = mudou('status', status) && (status === 'ativo' || status === 'pausado')
        && (original.status === 'ativo' || original.status === 'pausado')
      if (trocouPausa && enviarAoCanal && (plataforma === 'shopee' || plataforma === 'mercadolivre') && idExterno) {
        try {
          const r = await fetch(`/api/marketplace/${plataforma}/pausar-ativar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ canalId: canal.id, anuncioIds: [anuncio.id], acao: status === 'pausado' ? 'pausar' : 'ativar' }),
          }).then(x => x.json())
          if (!r.ok) setAvisos(prev => [...prev, `Status não alterado ${plataforma === 'shopee' ? 'na Shopee' : 'no Mercado Livre'}: ${r.erros?.[0] ?? r.erro ?? 'recusado'}`])
        } catch (e: any) {
          setAvisos(prev => [...prev, `Status não alterado no canal: ${e?.message ?? 'falha de conexão'}`])
        }
      }

      if (d.erro) setErro(d.erro)
      if (Array.isArray(d.avisos) && d.avisos.length > 0) setAvisos(prev => [...prev, ...d.avisos])

      if (d.anuncio) onSalvo(d.anuncio)

      if (!d.erro) {
        setSucesso(
          d.enviado
            ? `Salvo e enviado para ${nomePlataforma}${d.ressincronizado ? ' — anúncio relido de lá' : ''}.`
            : temAlgoParaEnviar && !enviarAoCanal
              ? 'Salvo aqui. Nada foi enviado para o marketplace.'
              : 'Salvo.'
        )
        // Sem alteração pendente e sem aviso, não há o que revisar na tela.
        if ((d.avisos?.length ?? 0) === 0) setTimeout(onClose, 900)
      }
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  // ── Tela ──────────────────────────────────────────────────────────────────

  const limiteTitulo = dados?.limites.titulo ?? 120
  const limiteDescricao = dados?.limites.descricao ?? 3000

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl mx-4 overflow-hidden max-h-[92vh] flex flex-col">

        {/* Cabeçalho */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Editar anúncio</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {canal.nome} · {nomePlataforma}
              {idExterno && <> · ID {idExterno}</>}
              {dados?.anuncio.vendas != null && <> · {dados.anuncio.vendas} venda(s)</>}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {urlAnuncio && (
              <a href={urlAnuncio} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                Ver no marketplace ↗
              </a>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>
        </div>

        {carregando && <div className="px-6 py-16 text-center text-sm text-gray-400">Carregando o anúncio…</div>}
        {erroCarga && <div className="px-6 py-16 text-center text-sm text-red-600">{erroCarga}</div>}

        {dados && !carregando && (
          <>
            {/* Abas */}
            <div className="px-6 pt-3 border-b border-gray-200 flex gap-1 overflow-x-auto flex-shrink-0">
              {ABAS.filter(([k]) => k !== 'variacoes' || dados.variacoes.length > 0).map(([k, rotulo]) => (
                <button key={k} onClick={() => setAba(k as Aba)}
                  className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                    aba === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                  {rotulo}
                  {k === 'imagens' && <span className="ml-1 text-xs text-gray-400">({fotos.length})</span>}
                  {k === 'variacoes' && <span className="ml-1 text-xs text-gray-400">({dados.variacoes.length})</span>}
                </button>
              ))}
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">

              {/* Aviso de canal: o mais importante da tela quando vale. */}
              {!dados.aceitaEdicaoNoCanal && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  <b>Esta edição fica só no sistema.</b>{' '}
                  {!dados.anuncio.idExterno
                    ? 'Este anúncio não veio de sincronização (não tem ID externo), então não há o que atualizar no marketplace.'
                    : !dados.canal.conectado
                      ? 'O canal não está conectado — refaça a autenticação em Configurar para poder enviar.'
                      : `A integração com ${nomePlataforma} ainda não escreve conteúdo, só lê.`}
                  {' '}E a sincronização sobrescreve título, descrição, fotos e preço com o que a plataforma disser na próxima rodada.
                </div>
              )}

              {/* ── Conteúdo ── */}
              {aba === 'conteudo' && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-gray-600">Título do anúncio *</label>
                      <span className={`text-[11px] ${titulo.length > limiteTitulo ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                        {titulo.length}/{limiteTitulo}
                      </span>
                    </div>
                    <input value={titulo} onChange={e => setTitulo(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    <div className="flex flex-wrap gap-3 mt-1.5">
                      <button type="button" onClick={() => setTitulo(formatarTituloAnuncio(titulo))}
                        className="text-xs text-blue-600 hover:text-blue-800">Arrumar maiúsculas</button>
                      {dados.produto?.nome && (
                        <button type="button" onClick={() => setTitulo(formatarTituloAnuncio(dados.produto.nome))}
                          className="text-xs text-blue-600 hover:text-blue-800">Usar o nome do cadastro</button>
                      )}
                      {titulo.length > limiteTitulo && (
                        <span className="text-xs text-red-600">
                          {nomePlataforma} corta em {limiteTitulo} caracteres.
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-gray-600">Descrição</label>
                      <span className={`text-[11px] ${descricao.length > limiteDescricao ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                        {descricao.length}/{limiteDescricao}
                      </span>
                    </div>
                    <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={12}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono leading-relaxed" />
                    {dados.anuncio.descricaoBuscadaAgora && (
                      <p className="text-[11px] text-gray-500 mt-1">
                        Texto buscado agora no Mercado Livre — o catálogo sincronizado não traz descrição.
                      </p>
                    )}
                    {dados.tipoDescricao === 'extended' && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        Este anúncio usa descrição estendida na Shopee (com blocos e imagens). Ela só pode ser editada lá.
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* ── Imagens ── */}
              {aba === 'imagens' && (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-xs text-gray-500">
                      A <b>primeira</b> é a capa — é ela que aparece na busca do marketplace.
                      Arraste para reordenar, ou use as setas. {nomePlataforma} aceita {limiteImagens} fotos.
                    </p>
                    <span className={`text-xs flex-shrink-0 ${fotos.length > limiteImagens ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                      {fotos.length}/{limiteImagens}
                    </span>
                  </div>

                  {fotos.length > limiteImagens && (
                    <p className="text-xs text-red-600">
                      As {fotos.length - limiteImagens} últimas não serão enviadas — tire as que não quiser antes de salvar.
                    </p>
                  )}

                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                    {fotos.map((f, i) => (
                      <div key={`${f.url}-${i}`}
                        draggable
                        onDragStart={() => setArrastando(i)}
                        onDragOver={(e: DragEvent) => e.preventDefault()}
                        onDrop={() => soltarEm(i)}
                        className={`relative group border rounded-xl overflow-hidden bg-gray-50 cursor-move transition-all ${
                          arrastando === i ? 'opacity-40' : ''} ${
                          i >= limiteImagens ? 'border-red-300 opacity-60' : i === 0 ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt={`Foto ${i + 1}`} className="w-full aspect-square object-contain bg-white" />
                        <div className="absolute top-1 left-1 flex items-center gap-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${i === 0 ? 'bg-blue-600 text-white' : 'bg-black/50 text-white'}`}>
                            {i === 0 ? 'Capa' : i + 1}
                          </span>
                          {!f.idExterno && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600 text-white font-semibold" title="Ainda não está no marketplace — sobe ao salvar">nova</span>
                          )}
                        </div>
                        <div className="absolute inset-x-0 bottom-0 bg-white/95 border-t border-gray-200 px-1 py-1 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="flex gap-0.5">
                            <button onClick={() => moverFoto(i, i - 1)} disabled={i === 0}
                              className="px-1.5 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="Mover para trás">←</button>
                            <button onClick={() => moverFoto(i, i + 1)} disabled={i === fotos.length - 1}
                              className="px-1.5 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="Mover para frente">→</button>
                            {i !== 0 && (
                              <button onClick={() => moverFoto(i, 0)} className="px-1.5 text-blue-600 hover:text-blue-800 text-[11px]" title="Usar como capa">capa</button>
                            )}
                          </div>
                          <button onClick={() => removerFoto(i)} className="px-1.5 text-red-500 hover:text-red-700" title="Tirar do anúncio">✕</button>
                        </div>
                      </div>
                    ))}
                    {fotos.length === 0 && (
                      <div className="col-span-full border border-dashed border-gray-300 rounded-xl py-10 text-center text-sm text-gray-400">
                        Este anúncio está sem foto.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <label className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
                      {subindo ? 'Subindo…' : 'Subir do computador'}
                      <input type="file" accept="image/*" multiple className="hidden" onChange={subirFotos} disabled={subindo} />
                    </label>
                    {dados.produto && (
                      <button type="button" onClick={trazerDoProduto}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50">
                        Trazer as fotos do cadastro
                      </button>
                    )}
                    <div className="flex gap-2 flex-1 min-w-[240px]">
                      <input value={urlNova} onChange={e => setUrlNova(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarPorUrl() } }}
                        placeholder="ou cole o endereço de uma imagem (https://...)"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                      <button type="button" onClick={adicionarPorUrl}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50">Adicionar</button>
                    </div>
                  </div>
                  {erroImagem && <p className="text-xs text-red-600">{erroImagem}</p>}

                  <PainelDimensoesImagens
                    imagens={fotos.map((f, i) => ({ id: f.idExterno ?? `nova-${i}`, url: f.url, principal: i === 0 }))}
                    plataforma={plataforma}
                    produtoId={produtoId || null}
                    onImagemAjustada={(imagemId, novaUrl) => {
                      setFotos(atual => atual.map((f, i) => ((f.idExterno ?? `nova-${i}`) === imagemId ? { url: novaUrl, idExterno: null } : f)))
                    }}
                  />
                </>
              )}

              {/* ── Ficha técnica ── */}
              {aba === 'ficha' && (
                <>
                  <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-600">
                    <div className="flex flex-wrap gap-x-6 gap-y-1">
                      <span><b>Categoria:</b> {caminhoCategoria || dados.ficha.categoriaId || dados.anuncio.categoriaExterna || '—'}</span>
                      {dados.anuncio.marcaExterna && <span><b>Marca no anúncio:</b> {dados.anuncio.marcaExterna}</span>}
                    </div>
                    <p className="mt-1.5 text-gray-500">
                      A categoria não é editável por aqui: trocá-la zera a ficha técnica inteira e nem todo anúncio
                      aceita a troca por API. Para mudar de categoria, publique um anúncio novo.
                    </p>
                  </div>

                  {carregandoAtributos && <p className="text-sm text-gray-400">Carregando a ficha desta categoria…</p>}
                  {erroAtributos && <p className="text-sm text-red-600">{erroAtributos}</p>}
                  {!dados.canal.conectado && <p className="text-sm text-gray-500">Canal não conectado — a ficha da categoria não pode ser carregada.</p>}

                  {obrigatoriosFaltando.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
                      Falta preencher: <b>{obrigatoriosFaltando.join(', ')}</b>. {nomePlataforma} pode recusar a atualização sem esses campos.
                    </div>
                  )}

                  {plataforma === 'shopee' && atributosCarregados && (
                    <>
                      {marcas.length > 0 && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Marca</label>
                          <select value={marcaId} onChange={e => setMarcaId(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
                            <option value="">Sem marca (NoBrand)</option>
                            {marcas.map(m => <option key={m.brand_id} value={m.brand_id}>{m.original_brand_name}</option>)}
                          </select>
                        </div>
                      )}
                      <div className="space-y-3">
                        {atributosShopee.map(a => (
                          <CampoAtributo key={a.attribute_id} atributo={a} valores={valoresShopee} setValores={setValoresShopee} />
                        ))}
                        {atributosShopee.length === 0 && <p className="text-sm text-gray-400">Esta categoria não tem atributos.</p>}
                      </div>
                    </>
                  )}

                  {plataforma === 'mercadolivre' && atributosCarregados && (
                    <div className="space-y-3">
                      {atributosML.map(a => (
                        <div key={a.id}>
                          <label className="block text-xs text-gray-600 mb-1">
                            {a.name} {a.obrigatorio && <span className="text-red-500">*</span>}
                            {a.condicional && <span className="text-amber-600"> (cobrado em alguns casos)</span>}
                          </label>
                          {a.valores.length > 0 ? (
                            <select value={a.valores.some(v => v.name === valoresML[a.id]) ? valoresML[a.id] : (valoresML[a.id] ? '__outro' : '')}
                              onChange={e => setValoresML(prev => ({ ...prev, [a.id]: e.target.value === '__outro' ? '' : e.target.value }))}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
                              <option value="">Selecione...</option>
                              {a.valores.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                              <option value="__outro">Outro — digitar</option>
                            </select>
                          ) : (
                            <input value={valoresML[a.id] ?? ''} onChange={e => setValoresML(prev => ({ ...prev, [a.id]: e.target.value }))}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                          )}
                          {a.valores.length > 0 && valoresML[a.id] != null && !a.valores.some(v => v.name === valoresML[a.id]) && (
                            <input value={valoresML[a.id]} onChange={e => setValoresML(prev => ({ ...prev, [a.id]: e.target.value }))}
                              placeholder="Digite o valor"
                              className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                          )}
                        </div>
                      ))}
                      {atributosML.length === 0 && <p className="text-sm text-gray-400">Esta categoria não tem atributos editáveis.</p>}
                    </div>
                  )}

                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-600 mb-2">
                      Pacote — é com esses números que o marketplace calcula o frete.
                    </p>
                    <div className="grid grid-cols-4 gap-3">
                      {([['Peso (kg)', peso, setPeso], ['Compr. (cm)', comprimento, setComprimento],
                         ['Largura (cm)', largura, setLargura], ['Altura (cm)', altura, setAltura]] as const).map(([rotulo, valor, setter]) => (
                        <div key={rotulo}>
                          <label className="block text-[11px] text-gray-500 mb-1">{rotulo}</label>
                          <input type="number" step="0.01" value={valor} onChange={e => (setter as any)(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                        </div>
                      ))}
                    </div>
                    {dados.produto && (dados.produto.peso_kg || dados.produto.comprimento_cm) && (
                      <button type="button"
                        onClick={() => {
                          setPeso(dados.produto.peso_kg ? String(dados.produto.peso_kg) : peso)
                          setComprimento(dados.produto.comprimento_cm ? String(dados.produto.comprimento_cm) : comprimento)
                          setLargura(dados.produto.largura_cm ? String(dados.produto.largura_cm) : largura)
                          setAltura(dados.produto.altura_cm ? String(dados.produto.altura_cm) : altura)
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 mt-2">
                        Usar as medidas do cadastro
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* ── Preço e estoque ── */}
              {aba === 'preco' && (
                <>
                  {dados.anuncio.temVariacao && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900">
                      Este anúncio tem variações: preço e estoque valem por variação, na aba Variações. O que estiver aqui não é enviado.
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Preço de venda (R$) *</label>
                      <input type="number" step="0.01" value={precoVenda} onChange={e => setPrecoVenda(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Preço promocional</label>
                      <input type="number" step="0.01" value={precoPromocional} onChange={e => setPrecoPromocional(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <p className="text-[11px] text-gray-400 mt-1">Só do sistema — promoção de marketplace é criada lá.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Estoque do anúncio</label>
                      <input type="number" value={estoque} onChange={e => setEstoque(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <p className="text-[11px] text-gray-400 mt-1">
                        {dados.anuncio.estoqueExterno != null ? `No canal hoje: ${dados.anuncio.estoqueExterno}.` : 'É este número que vai para o canal.'}
                      </p>
                    </div>
                  </div>

                  {precoPromocional && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Início da promoção</label>
                        <input type="date" value={promoInicio} onChange={e => setPromoInicio(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Fim da promoção</label>
                        <input type="date" value={promoFim} onChange={e => setPromoFim(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      </div>
                    </div>
                  )}

                  {dados.produto && (
                    <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-600">
                      <b>No cadastro:</b> {dados.produto.nome} · venda {fmt(dados.produto.preco_venda)} ·
                      custo {fmt(dados.produto.preco_custo)} · estoque {dados.produto.estoque ?? 0}
                    </div>
                  )}
                </>
              )}

              {/* ── Variações ── */}
              {aba === 'variacoes' && (
                <>
                  <p className="text-xs text-gray-500">
                    Preço e estoque de cada variação. Nome e SKU da variação são criados no marketplace e não mudam por aqui.
                  </p>
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Variação</th>
                          <th className="text-left px-3 py-2 font-medium">SKU</th>
                          <th className="text-right px-3 py-2 font-medium w-32">Preço</th>
                          <th className="text-right px-3 py-2 font-medium w-28">Estoque</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {dados.variacoes.map(v => (
                          <tr key={v.id}>
                            <td className="px-3 py-2 text-gray-900">
                              {v.nome_variacao ?? `Modelo ${v.model_id}`}
                              {!v.produto_id && <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">sem produto</span>}
                            </td>
                            <td className="px-3 py-2 text-gray-500 font-mono text-xs">{v.sku_variacao ?? '—'}</td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="0.01" value={formVariacoes[v.id]?.preco ?? ''}
                                onChange={e => setFormVariacoes(p => ({ ...p, [v.id]: { ...p[v.id], preco: e.target.value } }))}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-blue-500" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" value={formVariacoes[v.id]?.estoque ?? ''}
                                onChange={e => setFormVariacoes(p => ({ ...p, [v.id]: { ...p[v.id], estoque: e.target.value } }))}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-blue-500" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* ── Vínculo e sistema ── */}
              {aba === 'sistema' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Produto vinculado <span className="text-gray-400">(é ele que dá custo, estoque e margem ao anúncio)</span>
                    </label>
                    <div className="relative">
                      <input value={buscaProd} onChange={e => { setBuscaProd(e.target.value); if (produtoId) setProdutoId('') }}
                        placeholder="Buscar produto do sistema..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      {produtosFiltrados.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-10 overflow-hidden">
                          {produtosFiltrados.map(p => (
                            <button key={p.id} onClick={() => { setProdutoId(p.id); setBuscaProd(p.nome) }}
                              className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                              <p className="text-sm font-medium text-gray-900">{p.nome}</p>
                              <p className="text-xs text-gray-400">{p.sku} · Venda: {fmt(p.preco_venda)} · Estoque: {p.estoque}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {produtoId && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">✓ {buscaProd}</span>
                        <button onClick={() => { setProdutoId(''); setBuscaProd('') }} className="text-xs text-gray-400 hover:text-gray-600">remover</button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">SKU no canal</label>
                      <input value={skuCanal} onChange={e => setSkuCanal(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">ID externo</label>
                      <input value={idExterno} onChange={e => setIdExterno(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
                      <p className="text-[11px] text-gray-400 mt-1">É a chave que liga esta linha ao anúncio lá. Mudar aqui desfaz a ligação.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                      <select value={status} onChange={e => setStatus(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
                        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      {dados.anuncio.statusExterno && (
                        <p className="text-[11px] text-gray-400 mt-1">No canal: {dados.anuncio.statusExterno}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Endereço do anúncio</label>
                    <input type="url" value={urlAnuncio} onChange={e => setUrlAnuncio(e.target.value)} placeholder="https://..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>

                  {(dados.anuncio.qualidadeFaltas?.length ?? 0) > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-medium text-gray-600 mb-1">
                        Qualidade do anúncio{dados.anuncio.qualidadeScore != null ? ` — ${dados.anuncio.qualidadeScore}/100` : ''}
                      </p>
                      <p className="text-xs text-gray-500">Falta: {dados.anuncio.qualidadeFaltas.join(' · ')}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Rodapé */}
            <div className="px-6 py-4 border-t border-gray-200 flex-shrink-0 space-y-2">
              {erro && <p className="text-sm text-red-600">{erro}</p>}
              {avisos.length > 0 && (
                <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  {avisos.map((a, i) => <li key={i}>• {a}</li>)}
                </ul>
              )}
              {sucesso && <p className="text-sm text-emerald-700">{sucesso}</p>}

              <div className="flex items-center justify-between gap-4">
                <label className={`flex items-center gap-2 text-xs ${dados.aceitaEdicaoNoCanal ? 'text-gray-700 cursor-pointer' : 'text-gray-400'}`}>
                  <input type="checkbox" checked={enviarAoCanal && dados.aceitaEdicaoNoCanal} disabled={!dados.aceitaEdicaoNoCanal}
                    onChange={e => setEnviarAoCanal(e.target.checked)} className="rounded border-gray-300" />
                  Enviar as alterações para {nomePlataforma}
                </label>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
                  <button onClick={salvar} disabled={salvando}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                    {salvando ? 'Salvando…' : enviarAoCanal && dados.aceitaEdicaoNoCanal ? 'Salvar e enviar' : 'Salvar aqui'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
