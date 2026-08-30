import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'

// Gravação da configuração da loja — uma rota para todas as abas.
//
// A defesa é a LISTA BRANCA abaixo. Sem ela, um `PATCH` com
// `{ empresa_id: "<outra empresa>" }` moveria a loja de dono; com ela, o
// campo é simplesmente descartado. Campo que não está na lista não existe
// para esta rota.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COR = /^#[0-9a-f]{6}$/i
const SUBDOMINIO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const HOST = /^[a-z0-9.-]{4,253}$/

type Regra =
  | { tipo: 'texto'; max: number }
  | { tipo: 'bool' }
  // `vazioVira` existe porque limpar um campo numérico na tela manda `null`,
  // e para uma coluna NOT NULL isso virava "Valor inválido" — recusando o
  // formulário INTEIRO, inclusive os campos que estavam certos. Quem apaga
  // "Sem juros até" quer dizer zero, não quer dizer erro.
  | { tipo: 'inteiro'; min: number; max: number; nulavel?: boolean; vazioVira?: number }
  | { tipo: 'numero'; min: number; max: number; vazioVira?: number }
  | { tipo: 'opcao'; valores: string[] }
  | { tipo: 'cor' }
  | { tipo: 'uuid'; nulavel: true }
  | { tipo: 'subdominio' }
  | { tipo: 'host'; nulavel: true }

const CAMPOS: Record<string, Regra> = {
  // Identidade
  nome: { tipo: 'texto', max: 120 },
  descricao: { tipo: 'texto', max: 400 },
  logo_url: { tipo: 'texto', max: 500 },
  favicon_url: { tipo: 'texto', max: 500 },
  telefone: { tipo: 'texto', max: 40 },
  whatsapp: { tipo: 'texto', max: 40 },
  email: { tipo: 'texto', max: 200 },
  cep: { tipo: 'texto', max: 20 },
  logradouro: { tipo: 'texto', max: 200 },
  numero: { tipo: 'texto', max: 20 },
  complemento: { tipo: 'texto', max: 100 },
  bairro: { tipo: 'texto', max: 100 },
  cidade: { tipo: 'texto', max: 100 },
  uf: { tipo: 'texto', max: 2 },
  instagram: { tipo: 'texto', max: 300 },
  facebook: { tipo: 'texto', max: 300 },
  tiktok: { tipo: 'texto', max: 300 },
  horario_atendimento: { tipo: 'texto', max: 200 },

  // Aparência
  cor_primaria: { tipo: 'cor' },
  cor_destaque: { tipo: 'cor' },

  // SEO e publicação
  seo_title: { tipo: 'texto', max: 120 },
  meta_description: { tipo: 'texto', max: 200 },
  og_image_url: { tipo: 'texto', max: 500 },
  indexavel: { tipo: 'bool' },
  ativo: { tipo: 'bool' },
  em_manutencao: { tipo: 'bool' },

  // Endereço na web
  subdominio: { tipo: 'subdominio' },
  dominio_proprio: { tipo: 'host', nulavel: true },

  // Política de preços
  //
  // Os limites aqui repetem os CHECK do banco de propósito: o banco é a
  // garantia, esta lista é a mensagem de erro legível. Sem ela, digitar 900%
  // de desconto no Pix devolveria "Não foi possível salvar".
  preco_exibicao: { tipo: 'opcao', valores: ['preco_unico', 'dois_precos'] },
  avista_origem: { tipo: 'opcao', valores: ['percentual', 'promocao'] },
  pix_desconto_pct: { tipo: 'numero', min: 0, max: 90, vazioVira: 0 },
  pix_rotulo: { tipo: 'texto', max: 40 },
  // `parcelas_max` é o único que aceita nulo de verdade: vazio significa "a
  // vitrine não fala de parcelamento", que é diferente de zero.
  parcelas_max: { tipo: 'inteiro', min: 2, max: 24, nulavel: true },
  parcelas_sem_juros: { tipo: 'inteiro', min: 0, max: 24, vazioVira: 0 },
  parcelas_juros_mes: { tipo: 'numero', min: 0, max: 20, vazioVira: 0 },
  parcela_minima: { tipo: 'numero', min: 0, max: 100_000, vazioVira: 0 },

  // Aviso de pedido novo
  notificar_loja: { tipo: 'bool' },
  notificar_cliente: { tipo: 'bool' },
  notificar_numero: { tipo: 'texto', max: 40 },

  // Política de estoque
  estoque_modo: { tipo: 'opcao', valores: ['deposito_unico', 'depositos_selecionados', 'empresa_consolidado', 'grupo_consolidado'] },
  estoque_deposito_id: { tipo: 'uuid', nulavel: true },
  estoque_fonte: { tipo: 'opcao', valores: ['produto_estoque', 'produto_campo'] },
  estoque_seguranca: { tipo: 'numero', min: 0, max: 1_000_000 },
  estoque_percentual_publicado: { tipo: 'numero', min: 1, max: 100 },
  estoque_maximo_publicado: { tipo: 'inteiro', min: 1, max: 1_000_000, nulavel: true },
  permitir_venda_sem_estoque: { tipo: 'bool' },
  sem_estoque_comportamento: { tipo: 'opcao', valores: ['ocultar', 'mostrar_indisponivel'] },
  limite_maximo_por_compra: { tipo: 'inteiro', min: 1, max: 100_000, nulavel: true },
  reserva_minutos: { tipo: 'inteiro', min: 5, max: 1440 },
  entrega_ativa: { tipo: 'bool' },
  retirada_ativa: { tipo: 'bool' },
}

/** Devolve o valor validado, ou o símbolo `RECUSA` se o valor não serve. */
const RECUSA = Symbol('recusa')

function validar(regra: Regra, bruto: unknown): unknown | typeof RECUSA {
  const vazio = bruto === '' || bruto === null || bruto === undefined

  switch (regra.tipo) {
    case 'texto':
      if (vazio) return null
      if (typeof bruto !== 'string') return RECUSA
      return bruto.trim().slice(0, regra.max) || null

    case 'bool':
      return !!bruto

    case 'cor':
      if (typeof bruto !== 'string' || !COR.test(bruto)) return RECUSA
      return bruto.toLowerCase()

    case 'opcao':
      return typeof bruto === 'string' && regra.valores.includes(bruto) ? bruto : RECUSA

    case 'uuid':
      if (vazio) return null
      return typeof bruto === 'string' && UUID.test(bruto) ? bruto : RECUSA

    case 'subdominio': {
      if (typeof bruto !== 'string') return RECUSA
      const s = bruto.trim().toLowerCase()
      return SUBDOMINIO.test(s) ? s : RECUSA
    }

    case 'host': {
      if (vazio) return null
      if (typeof bruto !== 'string') return RECUSA
      const h = bruto.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      return HOST.test(h) ? h : RECUSA
    }

    case 'inteiro': {
      if (vazio) {
        if (regra.nulavel) return null
        return regra.vazioVira ?? RECUSA
      }
      const n = Math.floor(Number(bruto))
      return Number.isFinite(n) && n >= regra.min && n <= regra.max ? n : RECUSA
    }

    case 'numero': {
      if (vazio) return regra.vazioVira ?? RECUSA
      const n = Number(bruto)
      return Number.isFinite(n) && n >= regra.min && n <= regra.max ? n : RECUSA
    }
  }
}

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as
    { lojaId?: string; campos?: Record<string, unknown> } | null
  if (!corpo?.lojaId || !UUID.test(corpo.lojaId)) {
    return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  }
  if (!(await lojaDaSessao(ctx, corpo.lojaId))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  const recusados: string[] = []

  for (const [chave, bruto] of Object.entries(corpo.campos ?? {})) {
    const regra = CAMPOS[chave]
    // Campo fora da lista branca é ignorado em silêncio: é o caso de
    // `empresa_id`, `canal_id`, `id`. Não é erro do usuário, é tentativa.
    if (!regra) continue
    const valor = validar(regra, bruto)
    if (valor === RECUSA) { recusados.push(chave); continue }
    patch[chave] = valor
  }

  if (recusados.length > 0) {
    // Nomear a coluna do banco não ajuda quem está olhando um rótulo em
    // português. Dizer o limite, sim — é a informação que falta para
    // consertar sem adivinhar.
    const detalhe = recusados.map(c => {
      const r = CAMPOS[c]
      if (r.tipo === 'inteiro' || r.tipo === 'numero') return `${c} (aceita de ${r.min} a ${r.max})`
      if (r.tipo === 'opcao') return `${c} (aceita ${r.valores.join(' ou ')})`
      return c
    })
    return NextResponse.json(
      { erro: `Valor fora do permitido em: ${detalhe.join('; ')}` },
      { status: 400 },
    )
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ erro: 'Nada para salvar' }, { status: 400 })
  }

  const { error } = await ctx.sb
    .from('loja_config').update(patch)
    .eq('id', corpo.lojaId).eq('empresa_id', ctx.empresaId)

  if (error) {
    // Subdomínio repetido é o erro esperado aqui, e merece mensagem própria.
    const duplicado = error.code === '23505'
    console.error('[loja-admin] config falhou', { lojaId: corpo.lojaId, erro: error.message })
    return NextResponse.json(
      { erro: duplicado ? 'Este endereço já está em uso por outra loja.' : 'Não foi possível salvar' },
      { status: duplicado ? 409 : 500 },
    )
  }

  // Mudou a política de estoque? O cache de disponibilidade da vitrine está
  // velho na hora. Recalcular aqui evita o lojista salvar e continuar vendo
  // os números antigos.
  if (Object.keys(patch).some(k => k.startsWith('estoque_'))) {
    await ctx.sb.rpc('loja_atualizar_estoque_cache', { p_loja_id: corpo.lojaId, p_produto_ids: null })
  }

  invalidarVitrine(corpo.lojaId)
  return NextResponse.json({ ok: true })
}
