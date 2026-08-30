import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { db } from './db'
import type { Loja } from './tipos'

// Resolução da loja pelo endereço. É a raiz de todo o multiempresa da vitrine.
//
//   hostname → loja_config → canal → empresa → grupo → tenant
//
// Nenhuma função desta camada aceita `empresaId` direto, e nenhuma delas tem
// valor padrão. Loja não resolvida é 404, nunca "usa a primeira". Foi assim
// que se garantiu que não existe hardcode do Bazar Eficaz em lugar nenhum:
// ele é só a primeira linha de `loja_config`.

/** Cabeçalho que o proxy escreve com o subdomínio resolvido. Ver src/proxy.ts. */
export const CABECALHO_LOJA = 'x-loja-slug'

/**
 * Domínio raiz da plataforma. `bazareficaz.dominio.com.br` → `bazareficaz`.
 * Configurável porque o domínio muda entre desenvolvimento, homologação e
 * produção — e porque o dia em que existir um segundo domínio, isto não pode
 * estar espalhado pelo código.
 */
export const DOMINIO_RAIZ = process.env.NEXT_PUBLIC_LOJA_DOMINIO_RAIZ ?? ''

/**
 * Extrai o identificador da loja a partir do host.
 *
 * Devolve `null` para o host do próprio ERP — é o que faz o painel continuar
 * funcionando normalmente no domínio principal.
 */
export function slugDoHost(host: string | null | undefined): string | null {
  if (!host) return null
  const limpo = host.split(':')[0].toLowerCase().trim()
  if (!limpo) return null

  // Desenvolvimento: `bazareficaz.localhost:3000`.
  if (limpo.endsWith('.localhost')) {
    const s = limpo.slice(0, -'.localhost'.length)
    return s && s !== 'www' ? s : null
  }

  if (DOMINIO_RAIZ && limpo.endsWith('.' + DOMINIO_RAIZ)) {
    const s = limpo.slice(0, -(DOMINIO_RAIZ.length + 1))
    // `www` e host sem subdomínio são o ERP, não uma loja.
    if (!s || s === 'www') return null
    // Subdomínio de segundo nível não é loja — evita `a.b.dominio` virar loja "a.b".
    return s.includes('.') ? null : s
  }

  // Não bate com o domínio raiz: pode ser domínio próprio de um cliente.
  // Devolve o host inteiro; a consulta tenta casar em `dominio_proprio`.
  return limpo
}

function paraLoja(l: Record<string, any>): Loja {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    canalId: l.canal_id,
    subdominio: l.subdominio,
    dominioProprio: l.dominio_proprio,
    ativo: l.ativo,
    emManutencao: l.em_manutencao,
    indexavel: l.indexavel,
    nome: l.nome,
    descricao: l.descricao,
    logoUrl: l.logo_url,
    faviconUrl: l.favicon_url,
    telefone: l.telefone,
    whatsapp: l.whatsapp,
    email: l.email,
    cidade: l.cidade,
    uf: l.uf,
    instagram: l.instagram,
    facebook: l.facebook,
    tiktok: l.tiktok,
    horarioAtendimento: l.horario_atendimento,
    corPrimaria: l.cor_primaria,
    corDestaque: l.cor_destaque,
    // Coalescido campo a campo: a loja pode ter sido lida antes de
    // supabase-loja-precos.sql rodar, e uma vitrine no ar não pode cair
    // porque uma coluna ainda não existe. Sem a migração, o resultado é
    // exatamente a política da Fase 1 — um preço só.
    politicaPreco: {
      exibicao: l.preco_exibicao === 'dois_precos' ? 'dois_precos' : 'preco_unico',
      avistaOrigem: l.avista_origem === 'promocao' ? 'promocao' : 'percentual',
      pixDescontoPct: Number(l.pix_desconto_pct ?? 0),
      pixRotulo: l.pix_rotulo ?? 'no Pix',
      parcelasMax: l.parcelas_max != null ? Number(l.parcelas_max) : null,
      parcelasSemJuros: Number(l.parcelas_sem_juros ?? 0),
      jurosMes: Number(l.parcelas_juros_mes ?? 0),
      parcelaMinima: Number(l.parcela_minima ?? 0),
    },
    seoTitle: l.seo_title,
    metaDescription: l.meta_description,
    ogImageUrl: l.og_image_url,
    semEstoqueComportamento: l.sem_estoque_comportamento,
    permitirVendaSemEstoque: l.permitir_venda_sem_estoque,
    limiteMaximoPorCompra: l.limite_maximo_por_compra,
    entregaAtiva: l.entrega_ativa,
    retiradaAtiva: l.retirada_ativa,
    // Coalescido como a política de preços, e pelo mesmo motivo: a loja pode
    // ser lida antes de supabase-loja-checkout.sql rodar.
    pagamentoFormas: Array.isArray(l.pagamento_formas) ? l.pagamento_formas : [],
  }
}

/**
 * Busca a loja por subdomínio ou domínio próprio.
 *
 * Cacheada por 5 minutos: é consultada em TODA renderização de TODA página da
 * vitrine, e muda quando alguém salva o painel — que invalida pela tag.
 * Sem cache, cada visita começaria com uma ida ao banco só para descobrir de
 * quem é a loja.
 */
const buscarLoja = unstable_cache(
  async (identificador: string): Promise<Loja | null> => {
    const { data } = await db()
      .from('loja_config')
      .select('*')
      .or(`subdominio.eq.${identificador},dominio_proprio.eq.${identificador}`)
      .maybeSingle()
    return data ? paraLoja(data as Record<string, any>) : null
  },
  ['loja-config'],
  { revalidate: 300, tags: ['loja-config'] },
)

/** Tag de cache de uma loja. Usada pelo painel para invalidar ao salvar. */
export function tagLoja(lojaId: string): string {
  return `loja:${lojaId}`
}

/**
 * A loja da requisição atual.
 *
 * Devolve `null` quando o host não é de loja nenhuma (o domínio do ERP) ou
 * quando a loja está desativada. Quem chama decide o que fazer — as páginas
 * da vitrine chamam `lojaObrigatoria()`.
 */
export async function lojaAtual(): Promise<Loja | null> {
  const h = await headers()
  const slug = h.get(CABECALHO_LOJA) ?? slugDoHost(h.get('host'))
  if (!slug) return null

  const loja = await buscarLoja(slug)
  if (!loja || !loja.ativo) return null
  return loja
}

/** Igual a `lojaAtual`, mas 404 em vez de `null`. Para as páginas da vitrine. */
export async function lojaObrigatoria(): Promise<Loja> {
  const loja = await lojaAtual()
  if (!loja) notFound()
  return loja
}

/** Só para o painel do ERP, que já sabe a empresa pela sessão. */
export async function lojaDaEmpresa(sb: any, empresaId: string): Promise<Loja | null> {
  const { data } = await sb.from('loja_config').select('*').eq('empresa_id', empresaId).maybeSingle()
  return data ? paraLoja(data) : null
}
