import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { zapiSendText } from '@/lib/zapi'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Envio do pedido ao fornecedor por WhatsApp.
//
// O texto leva NOME e CÓDIGO DO FORNECEDOR de cada produto, e a quantidade.
// Não leva custo nem total de propósito: o preço que está aqui é o que a loja
// PAGOU da última vez ou o que ela estima pagar — mandá-lo para o fornecedor é
// abrir a própria carta na mesa antes de ele cotar. O código do fornecedor é o
// que ele reconhece no catálogo dele; o nosso SKU não diz nada para ele.
//
// GET monta e devolve a prévia (a tela mostra e deixa editar).
// POST envia o texto que voltou da tela.

type Item = { quantidade: number; produto_id: string }

async function contexto(sb: any) {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  return profile?.empresa_id ?? null
}

async function montar(sb: any, empresaId: string, id: string) {
  const { data: pedido } = await sb.from('pedidos_compra')
    .select('id, numero, status, data_pedido, previsao_entrega, observacoes, fornecedor_id')
    .eq('id', id).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido) return { erro: 'Pedido não encontrado' as const }

  const { data: itens } = await sb.from('pedidos_compra_itens')
    .select('produto_id, quantidade').eq('pedido_id', id)

  const ids = [...new Set((itens ?? []).map((i: Item) => i.produto_id))]
  const { data: produtos } = ids.length > 0
    ? await sb.from('produtos').select('id, nome, sku, codigo_fornecedor, unidade, ean').in('id', ids)
    : { data: [] as any[] }
  const porId = new Map((produtos ?? []).map((p: any) => [p.id, p]))

  const { data: fornecedor } = pedido.fornecedor_id
    ? await sb.from('fornecedores')
        .select('id, nome_fantasia, razao_social, telefone').eq('id', pedido.fornecedor_id).maybeSingle()
    : { data: null }

  const { data: empresa } = await sb.from('empresas')
    .select('nome_fantasia, nome').eq('id', empresaId).maybeSingle()
  const nomeLoja = empresa?.nome_fantasia || empresa?.nome || ''

  // Item com quantidade zero fica de fora: "0 UN" numa lista de compra faz o
  // fornecedor parar para perguntar o que é aquilo. Medido no pedido real:
  // 6 dos 14 itens estavam zerados.
  const comQuantidade = (itens ?? []).filter((i: Item) => (Number(i.quantidade) || 0) > 0)
  const itensZerados = (itens ?? []).length - comQuantidade.length

  // Quantos itens só têm o EAN como código. Não é problema — o EAN identifica
  // o produto em qualquer catálogo —, mas a tela avisa para o comprador saber
  // que aquele número não é o código interno do fornecedor.
  let semCodigoFornecedor = 0

  const linhas = comQuantidade.map((item: Item, i: number) => {
    const p: any = porId.get(item.produto_id)
    const nome = p?.nome ?? 'Produto'
    // Código do fornecedor primeiro: é o que ele procura no sistema dele.
    // Sem ele, o EAN ainda identifica o produto; o nosso SKU não serve.
    if (!p?.codigo_fornecedor) semCodigoFornecedor++
    const codigo = p?.codigo_fornecedor || p?.ean || null
    const qtd = Number(item.quantidade) || 0
    const unidade = p?.unidade ?? 'UN'
    const quantidade = Number.isInteger(qtd) ? String(qtd) : String(qtd).replace('.', ',')
    return `${i + 1}. ${nome}\n   ${codigo ? `Cód: ${codigo} · ` : ''}${quantidade} ${unidade}`
  })

  const unidades = comQuantidade.reduce((s: number, i: Item) => s + (Number(i.quantidade) || 0), 0)

  const cabecalho = [
    `*Pedido de compra${pedido.numero ? ` #${pedido.numero}` : ''}*`,
    nomeLoja ? `${nomeLoja}` : '',
    pedido.data_pedido ? `Data: ${new Date(pedido.data_pedido + 'T00:00:00').toLocaleDateString('pt-BR')}` : '',
    pedido.previsao_entrega ? `Entrega prevista: ${new Date(pedido.previsao_entrega + 'T00:00:00').toLocaleDateString('pt-BR')}` : '',
  ].filter(Boolean).join('\n')

  const rodape = [
    `${linhas.length} item(ns) · ${Number.isInteger(unidades) ? unidades : unidades.toFixed(2).replace('.', ',')} unidades`,
    pedido.observacoes ? `\nObs.: ${pedido.observacoes}` : '',
    '\nPor favor, confirme disponibilidade e prazo.',
  ].filter(Boolean).join('\n')

  const texto = `${cabecalho}\n\n${linhas.join('\n')}\n\n${rodape}`

  return {
    pedido: { id: pedido.id, numero: pedido.numero, status: pedido.status },
    fornecedor: fornecedor
      ? { nome: fornecedor.nome_fantasia || fornecedor.razao_social || '', telefone: fornecedor.telefone ?? '' }
      : null,
    texto,
    semItens: linhas.length === 0,
    itensZerados,
    semCodigoFornecedor,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const empresaId = await contexto(sb)
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const dados = await montar(sb, empresaId, id)
  if ('erro' in dados) return NextResponse.json({ ok: false, erro: dados.erro }, { status: 404 })
  return NextResponse.json({ ok: true, ...dados })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { telefone, texto, marcarEnviado } = await req.json() as
    { telefone?: string; texto?: string; marcarEnviado?: boolean }

  const sb = await createClient()
  const empresaId = await contexto(sb)
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const digitos = (telefone ?? '').replace(/\D/g, '')
  if (digitos.length < 10) {
    return NextResponse.json({ ok: false, erro: 'Informe um número com DDD.' }, { status: 400 })
  }
  if (!texto?.trim()) {
    return NextResponse.json({ ok: false, erro: 'A mensagem está vazia.' }, { status: 400 })
  }

  const { data: cfg } = await sb.from('whatsapp_config')
    .select('instance_id, token, client_token, url_base, ativo')
    .eq('empresa_id', empresaId).maybeSingle()

  if (!cfg?.ativo || !cfg.instance_id || !cfg.token) {
    return NextResponse.json({ ok: false, erro: 'WhatsApp não configurado ou inativo para esta empresa.' }, { status: 400 })
  }

  const envio = await zapiSendText(
    { instanceId: cfg.instance_id, token: cfg.token, clientToken: cfg.client_token, urlBase: cfg.url_base },
    // Sem o 55 o WhatsApp não entrega, e o erro que volta não diz isso.
    digitos.startsWith('55') ? digitos : `55${digitos}`,
    texto,
  )
  if (!envio.success) {
    return NextResponse.json({ ok: false, erro: envio.error ?? 'Falha ao enviar pela Z-API' }, { status: 502 })
  }

  // Pedido mandado ao fornecedor não é mais rascunho. Só sobe de rascunho —
  // nunca rebaixa um pedido já recebido por causa de um reenvio.
  let statusNovo: string | null = null
  if (marcarEnviado) {
    const { data: pedido } = await sb.from('pedidos_compra')
      .select('status').eq('id', id).eq('empresa_id', empresaId).maybeSingle()
    if (pedido && ['rascunho', 'em_cotacao', 'aguardando_aprovacao'].includes(pedido.status)) {
      await sb.from('pedidos_compra')
        .update({ status: 'enviado', updated_at: new Date().toISOString() })
        .eq('id', id).eq('empresa_id', empresaId)
      statusNovo = 'enviado'
    }
  }

  return NextResponse.json({ ok: true, statusNovo })
}
