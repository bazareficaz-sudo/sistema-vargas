// Validação compartilhada dos blocos de produto da Home
// (`loja_blocos_home`), entre criar e editar.
//
// O tipo decide o formato de `config` — cada um valida o seu, e um tipo sem
// regra própria (`ofertas`, `novidades`, `destaques`, `mais_vendidos`,
// `categorias`, `marcas`) simplesmente ignora o que vier em `config` e grava
// `{}`: são os tipos automáticos, o conteúdo já vem do catálogo.

const TIPOS = ['destaques', 'ofertas', 'novidades', 'mais_vendidos', 'categorias', 'marcas', 'selecao', 'destaque_tag', 'secao_filtro'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Mesmo alfabeto que `GerenciarTagsModal` aceita ao criar uma tag nova.
const TAG = /^.{1,60}$/
const CRITERIOS = ['tag', 'marca', 'categoria', 'subcategoria'] as const

export function validarBloco(corpo: any): { erro: string } | { valores: Record<string, unknown> } {
  const tipo = TIPOS.includes(corpo.tipo) ? corpo.tipo : undefined
  if (!tipo) return { erro: `Tipo de bloco inválido (aceita: ${TIPOS.join(', ')})` }

  const titulo = typeof corpo.titulo === 'string' ? corpo.titulo.trim().slice(0, 120) : ''
  if (!titulo) return { erro: 'Título é obrigatório' }
  const subtitulo = typeof corpo.subtitulo === 'string' && corpo.subtitulo.trim()
    ? corpo.subtitulo.trim().slice(0, 200) : null

  const limite = Math.floor(Number(corpo.limite))
  if (!Number.isFinite(limite) || limite < 2 || limite > 24) {
    return { erro: 'Limite aceita de 2 a 24' }
  }

  const ordem = Number.isFinite(Number(corpo.ordem)) ? Math.floor(Number(corpo.ordem)) : 0
  const ativo = !!corpo.ativo

  let config: Record<string, unknown> = {}
  if (tipo === 'selecao') {
    const ids = Array.isArray(corpo.produtoIds)
      ? corpo.produtoIds.filter((x: unknown): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 24)
      : []
    if (ids.length === 0) return { erro: 'Escolha ao menos um produto para a seleção' }
    config = { produto_ids: ids }
  } else if (tipo === 'destaque_tag') {
    const tag = typeof corpo.tag === 'string' ? corpo.tag.trim() : ''
    if (!tag || !TAG.test(tag)) return { erro: 'Escolha uma tag' }
    config = { tag }
  } else if (tipo === 'secao_filtro') {
    const criterio = CRITERIOS.includes(corpo.criterio) ? corpo.criterio : undefined
    if (!criterio) return { erro: `Critério inválido (aceita: ${CRITERIOS.join(', ')})` }
    const valor = typeof corpo.valor === 'string' ? corpo.valor.trim().slice(0, 120) : ''
    if (!valor) return { erro: 'Escolha um valor para o critério' }
    config = { criterio, valor }
  }

  return { valores: { tipo, titulo, subtitulo, limite, ordem, ativo, config } }
}
