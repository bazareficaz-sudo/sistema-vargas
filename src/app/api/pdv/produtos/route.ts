import { createAdminClient } from '@/lib/supabase/admin'
import { operacaoProtegida } from '@/lib/pdv/operacaoProtegida'
import { leituraProtegida } from '@/lib/pdv/leituraProtegida'
import { validarAtualizacaoProduto } from '@/lib/pdv/payloadProduto'

// O CATÁLOGO SAI DE BAIXO DA CHAVE ANÔNIMA.
//
// ── O QUE FOI MEDIDO ─────────────────────────────────────────────────────
//
// Auditoria de 13/09/2026: com a chave `anon`, sem login nenhum, dá para ler
// 28.676 produtos — COM `preco_custo`. É a maior exposição das três tabelas
// medidas, e a única cujo peso é o próprio conteúdo: não é um id que vazou, é
// a margem da loja inteira num `select`.
//
// ── POR QUE ESTA ETAPA CABE AGORA ────────────────────────────────────────
//
// `produtos` parecia travada atrás da 0.6D, porque o CAS de estoque escreve
// nela. Mas o CAS mexe em UMA coluna, `estoque`. Tudo o mais que o PDV faz
// com `produtos` é catálogo:
//
//   sincronizarProdutos   select('*') paginado, 28.676 linhas  → GET aqui
//   contarProdutosRemoto  count exato                          → ./contagem
//   atualizarProduto      update de fiscal e comercial         → PATCH aqui
//   getProduto            select('*') por id                   → REMOVIDO
//
// `getProduto` não tinha um único chamador. Código morto que lê a tabela
// inteira se apaga, não se migra — foi o mesmo destino de `atualizarCliente`.
//
// Depois desta etapa, o que sobra de `produtos` sob `anon` é exatamente o
// CAS de estoque, que é a 0.6D e continua pausada. `criar_produto_pdv` já
// saiu antes, por RPC `SECURITY DEFINER`.

/**
 * O que o PDV consome de fato — a lista literal de `mapProduto` no sync.js.
 *
 * `select('*')` numa tabela de 28.676 linhas manda dezenas de colunas que o
 * terminal descarta na linha seguinte. Aqui o que ele não usa não sai do
 * servidor.
 *
 * `preco_custo` FICA: o balcão mostra margem, e tirá-lo seria mudar o produto
 * dentro de uma migração de transporte. O que muda é quem pode lê-lo — agora
 * é um terminal autenticado, não qualquer um com a chave pública.
 */
const CAMPOS_SNAPSHOT = [
  'id', 'nome', 'sku', 'ean', 'preco_venda', 'preco_custo', 'unidade',
  'categoria', 'marca', 'foto_url', 'ativo', 'disponivel_pdv',
  'permite_fracao', 'updated_at', 'estoque', 'estoque_minimo',
  'ncm', 'cfop', 'icms_cst', 'icms_origem', 'pis_cst', 'cofins_cst', 'tags',
  'preco_promocional', 'promocao_ativa', 'promocao_inicio', 'promocao_fim',
].join(', ')

const PAGINA = 500

// ── SNAPSHOT ─────────────────────────────────────────────────────────────
//
// SEM FILTRO DE `ativo`, e isto não é esquecimento: um produto que virou
// inativo no ERP precisa continuar aparecendo aqui (o `updated_at` dele
// mudou) para que o terminal receba a baixa e PARE de vender. Quem decide o
// que pode ser vendido é o filtro local `produtos.buscar`, não esta consulta.
// Filtrar por `ativo` aqui deixaria o produto inativado vendável para sempre
// em todo terminal que já o tinha.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const desde = url.searchParams.get('desde')
  const pagina = Math.max(0, Number(url.searchParams.get('pagina') ?? 0) || 0)

  return leituraProtegida(req, {
    flagDaOperacao: 'produtos',
    ler: async (ctx) => {
      const sb = createAdminClient()
      let q = sb.from('produtos').select(CAMPOS_SNAPSHOT)
        .eq('empresa_id', ctx.empresa_id)
        .order('nome').order('id')
        .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)
      if (desde) q = q.gte('updated_at', desde)

      const { data, error } = await q
      if (error) throw new Error(error.message)

      const produtos = data ?? []
      return { produtos, pagina, tem_mais: produtos.length === PAGINA }
    },
  })
}

// ── EDIÇÃO ───────────────────────────────────────────────────────────────
//
// Fiscal e comercial. `estoque` NÃO — ver `payloadProduto.ts`: o saldo tem um
// escritor só, o CAS, e um segundo caminho seria como a divergência de 472
// produtos aconteceu.
export async function PATCH(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  return operacaoProtegida(req, {
    operacao: 'produtos.atualizar',
    flagDaOperacao: 'produtos',
    corpo,
    executar: async (ctx) => {
      const produtoId = String(corpo?.produto_id ?? '')
      if (!produtoId) throw new Error('produto_id é obrigatório.')

      const v = validarAtualizacaoProduto(corpo)
      if (!v.ok) throw new Error(v.erro)

      const sb = createAdminClient()
      // O `.eq('empresa_id')` não é redundante com a autenticação: impede que
      // um terminal legítimo altere o produto de outra empresa passando um id
      // que não é dele. Autenticar diz quem é; isto diz onde pode mexer.
      const { data, error } = await sb.from('produtos')
        .update(v.dados)
        .eq('id', produtoId)
        .eq('empresa_id', ctx.empresa_id)
        .select('id').maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new Error('Produto não encontrado nesta empresa.')

      return { produto_id: produtoId, campos: Object.keys(v.dados) }
    },
  })
}
