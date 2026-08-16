import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OrcamentosClient from '@/components/orcamentos/OrcamentosClient'
import { promocaoVigente } from '@/lib/produtos/promocao'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function OrcamentosPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: orcamentos } = await sb
    .from('orcamentos')
    .select('*, clientes(nome, telefone), orcamento_itens(id, produto_id, produto_nome, quantidade, preco_unitario, desconto, total)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(100)

  // Custo de cada produto que aparece nos orçamentos — é o que permite dizer
  // se o orçamento fecha com lucro. É o custo de HOJE, não o do dia em que o
  // orçamento foi montado (orcamento_itens não guarda custo), e a tela avisa
  // isso em vez de apresentar como número exato.
  const produtoIds = [...new Set(
    (orcamentos ?? []).flatMap((o: any) => (o.orcamento_itens ?? []).map((i: any) => i.produto_id).filter(Boolean)))]
  const custoPorProduto: Record<string, number> = {}
  // Preço cheio de tabela — base da estratégia "promoção vira desconto à
  // vista". Só entra aqui o produto que está REALMENTE em promoção.
  //
  // Isso importa: conferido na produção, existe item de orçamento abaixo do
  // preço de tabela sem promoção nenhuma — é desconto que o vendedor deu na
  // negociação. Tratar essa diferença como promoção transformaria um
  // desconto já concedido em "desconto à vista", mudando o combinado com o
  // cliente pelas costas de quem negociou.
  const precoCheioPorProduto: Record<string, number> = {}
  if (produtoIds.length > 0) {
    const { data: prods } = await sb.from('produtos')
      .select('id, preco_custo, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim')
      .in('id', produtoIds as string[])
    for (const p of prods ?? []) {
      custoPorProduto[p.id] = Number(p.preco_custo ?? 0)
      // Promoção fora da janela de datas não conta como promoção — senão um
      // desconto de fim de semana ficaria mascarando a margem para sempre.
      if (promocaoVigente(p)) {
        precoCheioPorProduto[p.id] = Number(p.preco_venda ?? 0)
      }
    }
  }

  // Mesma configuração de saúde usada na tela de Vendas — o orçamento é uma
  // venda que ainda não aconteceu, e medir com régua diferente daria dois
  // números para a mesma pergunta.
  const [{ data: cfg }, { data: faixas }, { data: empresa }] = await Promise.all([
    sb.from('saude_config').select('*').eq('empresa_id', empresaId).maybeSingle(),
    sb.from('saude_faixas').select('*').eq('empresa_id', empresaId).order('minimo'),
    sb.from('empresas').select('nome').eq('id', empresaId).maybeSingle(),
  ])

  return (
    <OrcamentosClient
      empresaId={empresaId}
      empresaNome={empresa?.nome ?? null}
      orcamentos={orcamentos ?? []}
      custoPorProduto={custoPorProduto}
      precoCheioPorProduto={precoCheioPorProduto}
      saudeConfig={cfg ?? null}
      saudeFaixas={faixas ?? null}
    />
  )
}
