import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OrcamentosClient from '@/components/orcamentos/OrcamentosClient'
import { promocaoVigente } from '@/lib/produtos/promocao'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { numeroOculto } from '@/lib/whatsapp/contatos'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SELECT_ORC = '*, clientes(nome, telefone), orcamento_itens(id, produto_id, produto_nome, quantidade, preco_unitario, desconto, total)'

// ?abrir=<orçamento> abre ele na tela; ?conversa=<contato do WhatsApp> faz o
// "Enviar por WhatsApp" desse orçamento ir para o telefone da conversa (vem
// do PDV aberto a partir da caixa de entrada).
export default async function OrcamentosPage({ searchParams }: { searchParams: Promise<{ abrir?: string; conversa?: string }> }) {
  const sp = await searchParams
  const abrirId = sp.abrir && UUID.test(sp.abrir) ? sp.abrir : null
  const conversaId = sp.conversa && UUID.test(sp.conversa) ? sp.conversa : null
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: recentes } = await sb
    .from('orcamentos')
    .select(SELECT_ORC)
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(100)
  let orcamentos = recentes
  if (abrirId && !(recentes ?? []).some((o: { id: string }) => o.id === abrirId)) {
    const { data: um } = await sb.from('orcamentos').select(SELECT_ORC).eq('empresa_id', empresaId).eq('id', abrirId).maybeSingle()
    if (um) orcamentos = [um, ...(recentes ?? [])]
  }
  const { data: conv } = conversaId
    ? await sb.from('whatsapp_conversas').select('id, telefone, cliente_nome, nome_whatsapp').eq('empresa_id', empresaId).eq('id', conversaId).maybeSingle()
    : { data: null }
  const conversa = conv && !numeroOculto(conv.telefone)
    ? { id: conv.id, telefone: conv.telefone, nome: conv.cliente_nome || conv.nome_whatsapp || conv.telefone }
    : null

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
      abrirId={abrirId}
      conversa={conversa}
    />
  )
}
