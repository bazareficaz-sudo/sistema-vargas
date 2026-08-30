import { contextoAdmin } from '@/lib/commerce/admin'
import PrecosLojaClient, { type AmostraPreco } from '@/components/loja-admin/PrecosLojaClient'

export const dynamic = 'force-dynamic'

// Preços.
//
// A política de preço da vitrine: um preço ou dois, quanto de desconto no à
// vista, e em quantas vezes. Vale para o catálogo inteiro — o campo por
// produto (Loja Online → Produtos → Preço no Pix) continua existindo como
// exceção.
//
// A tela busca produtos DE VERDADE para a prévia em vez de usar R$ 100,00 de
// exemplo. O motivo é o mesmo que fez a aba Estoque mostrar a conta aberta:
// número de exemplo esconde o caso que importa. Aqui o caso que importa é o
// produto barato, onde a parcela mínima derruba o parcelamento inteiro — e
// este catálogo tem muitos.

const CAMPOS = [
  'preco_exibicao', 'pix_desconto_pct', 'pix_rotulo',
  'parcelas_max', 'parcelas_sem_juros', 'parcelas_juros_mes', 'parcela_minima',
] as const

/**
 * O que a tela mostra enquanto a migração não rodou. São os MESMOS padrões
 * de `supabase-loja-precos.sql`, para o operador não ver um valor aqui e
 * outro depois de aplicar.
 */
const PADRAO: Record<string, unknown> = {
  preco_exibicao: 'preco_unico',
  pix_desconto_pct: 0,
  pix_rotulo: 'no Pix',
  parcelas_max: null,
  parcelas_sem_juros: 0,
  parcelas_juros_mes: 0,
  parcela_minima: 5,
}

/** Só o que a prévia precisa. `preco_pix` vem à parte — ver abaixo. */
const COLUNAS_AMOSTRA = 'produto_id, nome, preco, preco_de'

/** A linha crua da view, antes de virar `AmostraPreco`. */
type LinhaVitrine = {
  produto_id: string
  nome: string
  preco: number | string | null
  preco_de: number | string | null
}

/** O preço à vista digitado produto a produto — a exceção à política. */
type ExcecaoPix = { produto_id: string; preco_pix: number | string | null }

export default async function Precos() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const base = () => ctx.sb
    .from('loja_vitrine_produtos')
    .select(COLUNAS_AMOSTRA)
    .eq('loja_id', ctx.lojaId)
    .eq('status', 'publicado')
    .gt('preco', 0)

  // Três recortes, porque a política acerta cada um de um jeito:
  // em promoção (é o caso que inverte o destaque), caro (parcelamento cheio)
  // e barato (onde a parcela mínima corta as vezes, ou tira o parcelamento).
  const [{ data: config }, { data: promo }, { data: caros }, { data: baratos }] = await Promise.all([
    // `select('*')` de propósito, e não a lista de colunas: pedir uma coluna
    // que ainda não existe derruba a consulta inteira, e com ela a tela.
    // Assim esta aba funciona ANTES e DEPOIS da migração, e o deploy deixa de
    // depender da ordem — que é a regra deste repositório escrita ao
    // contrário, resolvendo a causa em vez de lembrar dela.
    // A tabela é do painel (sessão autenticada, RLS por empresa), o mesmo que
    // `lojaDaEmpresa` já faz.
    ctx.sb.from('loja_config').select('*').eq('id', ctx.lojaId).single(),
    base().not('preco_de', 'is', null).order('preco', { ascending: false }).limit(2),
    base().is('preco_de', null).order('preco', { ascending: false }).limit(2),
    base().is('preco_de', null).order('preco', { ascending: true }).limit(1),
  ])

  const vistos = new Set<string>()
  const linhas = ([...(promo ?? []), ...(caros ?? []), ...(baratos ?? [])] as LinhaVitrine[])
    .filter(r => {
      // Os três recortes podem devolver o mesmo produto — o mais caro sem
      // promoção também é o mais barato quando o catálogo tem um item só.
      if (vistos.has(r.produto_id)) return false
      vistos.add(r.produto_id)
      return true
    })

  // O `preco_pix` da view já sai calculado com o percentual SALVO, e a prévia
  // precisa reagir ao que está sendo digitado. Então ela lê a exceção crua —
  // o que alguém digitou produto a produto — e aplica o percentual em tela.
  const excecoes: ExcecaoPix[] = linhas.length === 0 ? [] : (
    (await ctx.sb.from('loja_produtos')
      .select('produto_id, preco_pix')
      .eq('loja_id', ctx.lojaId)
      .in('produto_id', linhas.map(r => r.produto_id))
    ).data ?? []
  ) as ExcecaoPix[]

  const manual = new Map<string, number | null>(
    excecoes.map(e => [e.produto_id, e.preco_pix != null ? Number(e.preco_pix) : null]),
  )

  const amostra: AmostraPreco[] = linhas.map(r => ({
    produtoId: r.produto_id,
    nome: r.nome,
    preco: Number(r.preco ?? 0),
    precoDe: r.preco_de != null ? Number(r.preco_de) : null,
    precoPixManual: manual.get(r.produto_id) ?? null,
  }))

  // Se a coluna não voltou, a migração ainda não rodou. A tela diz isso em
  // vez de deixar o operador configurar e descobrir no erro do Salvar.
  const bruto = (config ?? {}) as Record<string, unknown>
  const migracaoPendente = !('preco_exibicao' in bruto)
  const valores = Object.fromEntries(
    CAMPOS.map(c => [c, migracaoPendente ? PADRAO[c] : bruto[c]]),
  )

  return (
    <div className="space-y-4">
      <PrecosLojaClient
        lojaId={ctx.lojaId}
        valores={valores}
        amostra={amostra}
        migracaoPendente={migracaoPendente}
      />
      <p className="text-xs text-gray-500">
        O parcelamento aqui é <strong>informação</strong>: a loja ainda não cobra pelo site.
        Escreva o que o balcão pratica de verdade — o cliente vai cobrar essa condição.
      </p>
    </div>
  )
}
