import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { buscarDepositoPrincipal } from '@/lib/produtos/movimentacao'

// Dados do romaneio de separação.
//
// Devolve as duas visões que a separação realmente usa, e por motivos
// diferentes:
//
//   agregado → uma linha por produto, com o total somado de todos os
//              pedidos selecionados. É o que faz a pessoa andar UMA vez
//              pelo galpão em vez de uma vez por pedido.
//   pedidos  → cada pedido com seus itens. É a conferência na hora de
//              embalar, para o produto certo entrar na caixa certa.

const LIMITE = 200

type Item = { fonte: 'venda' | 'marketplace'; id: string }

export async function POST(req: Request) {
  const { itens } = await req.json() as { itens: Item[] }
  if (!Array.isArray(itens) || itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum pedido selecionado' }, { status: 400 })
  }
  if (itens.length > LIMITE) {
    return NextResponse.json({ ok: false, erro: `Máximo de ${LIMITE} pedidos por romaneio.` }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const idsVenda = itens.filter(i => i.fonte === 'venda').map(i => i.id)
  const idsMkt = itens.filter(i => i.fonte === 'marketplace').map(i => i.id)

  const pedidos: any[] = []

  if (idsVenda.length > 0) {
    const [cab, its] = await Promise.all([
      sb.from('vendas').select('id, numero, cliente_nome, created_at, observacao, etapa_operacional')
        .in('id', idsVenda).eq('empresa_id', guarda.empresaId),
      sb.from('venda_itens').select('venda_id, produto_id, produto_nome, produto_sku, quantidade')
        .in('venda_id', idsVenda),
    ])
    const porVenda = new Map<string, any[]>()
    for (const i of its.data ?? []) {
      const arr = porVenda.get(i.venda_id) ?? []
      arr.push({ produtoId: i.produto_id, nome: i.produto_nome, sku: i.produto_sku, quantidade: Number(i.quantidade) })
      porVenda.set(i.venda_id, arr)
    }
    for (const v of cab.data ?? []) {
      pedidos.push({
        fonte: 'venda', id: v.id, numero: v.numero, cliente: v.cliente_nome,
        data: v.created_at, canal: 'PDV / aplicativo', etapa: v.etapa_operacional,
        entrega: null, rastreio: null, transportadora: null, observacao: v.observacao,
        itens: porVenda.get(v.id) ?? [],
      })
    }
  }

  if (idsMkt.length > 0) {
    const [cab, its] = await Promise.all([
      sb.from('marketplace_pedidos')
        .select('id, canal_id, numero_pedido, id_externo, cliente_nome, data_pedido, created_at, observacoes, etapa_operacional, codigo_rastreio, transportadora, entrega_cidade, entrega_estado, prazo_postagem')
        .in('id', idsMkt).eq('empresa_id', guarda.empresaId),
      sb.from('marketplace_pedido_itens').select('pedido_id, produto_id, nome_produto, sku, quantidade')
        .in('pedido_id', idsMkt),
    ])

    const canaisIds = [...new Set((cab.data ?? []).map((p: any) => p.canal_id).filter(Boolean))]
    const { data: canais } = canaisIds.length
      ? await sb.from('marketplace_canais').select('id, nome').in('id', canaisIds)
      : { data: [] as any[] }
    const nomeCanal = new Map((canais ?? []).map((c: any) => [c.id, c.nome]))

    const porPedido = new Map<string, any[]>()
    for (const i of its.data ?? []) {
      const arr = porPedido.get(i.pedido_id) ?? []
      arr.push({ produtoId: i.produto_id, nome: i.nome_produto, sku: i.sku, quantidade: Number(i.quantidade) })
      porPedido.set(i.pedido_id, arr)
    }
    for (const p of cab.data ?? []) {
      pedidos.push({
        fonte: 'marketplace', id: p.id, numero: p.numero_pedido ?? p.id_externo, cliente: p.cliente_nome,
        data: p.data_pedido ?? p.created_at, canal: nomeCanal.get(p.canal_id) ?? 'Marketplace',
        etapa: p.etapa_operacional,
        entrega: [p.entrega_cidade, p.entrega_estado].filter(Boolean).join(' / ') || null,
        rastreio: p.codigo_rastreio, transportadora: p.transportadora,
        prazoPostagem: p.prazo_postagem, observacao: p.observacoes,
        itens: porPedido.get(p.id) ?? [],
      })
    }
  }

  pedidos.sort((a, b) => String(a.data ?? '').localeCompare(String(b.data ?? '')))

  // Agregação por produto. A chave é o produto_id quando existe; item sem
  // vínculo cai no par nome+sku, senão dois itens diferentes se somariam
  // por acaso só porque os dois estão sem produto no cadastro.
  const agregadoMapa = new Map<string, { produtoId: string | null; nome: string; sku: string | null; quantidade: number; pedidos: string[] }>()
  for (const p of pedidos) {
    for (const i of p.itens) {
      const chave = i.produtoId ?? `sem:${i.sku ?? ''}|${i.nome ?? ''}`
      const atual = agregadoMapa.get(chave)
      if (atual) {
        atual.quantidade += i.quantidade
        if (!atual.pedidos.includes(p.numero)) atual.pedidos.push(p.numero)
      } else {
        agregadoMapa.set(chave, {
          produtoId: i.produtoId ?? null, nome: i.nome, sku: i.sku,
          quantidade: i.quantidade, pedidos: [p.numero],
        })
      }
    }
  }

  // Localização no depósito principal — sem isso a lista agregada diz o que
  // pegar mas não onde, que é metade do trabalho.
  const produtoIds = [...agregadoMapa.values()].map(a => a.produtoId).filter(Boolean) as string[]
  const depositoId = await buscarDepositoPrincipal(sb, guarda.empresaId)
  const localizacoes = new Map<string, string>()
  const saldos = new Map<string, number>()
  if (produtoIds.length > 0 && depositoId) {
    const { data } = await sb.from('produto_estoque')
      .select('produto_id, localizacao, quantidade')
      .eq('deposito_id', depositoId).in('produto_id', produtoIds)
    for (const r of data ?? []) {
      if (r.localizacao) localizacoes.set(r.produto_id, r.localizacao)
      saldos.set(r.produto_id, Number(r.quantidade ?? 0))
    }
  }

  const agregado = [...agregadoMapa.values()].map(a => ({
    ...a,
    localizacao: a.produtoId ? localizacoes.get(a.produtoId) ?? null : null,
    saldo: a.produtoId ? saldos.get(a.produtoId) ?? null : null,
  })).sort((a, b) =>
    // Ordenado pela localização, que é a ordem em que se anda no galpão.
    // Sem localização vai para o fim: são os que exigem procurar.
    (a.localizacao ?? '￿').localeCompare(b.localizacao ?? '￿') || a.nome.localeCompare(b.nome))

  const { data: empresa } = await sb.from('empresas').select('nome').eq('id', guarda.empresaId).maybeSingle()

  return NextResponse.json({
    ok: true, pedidos, agregado, empresaNome: empresa?.nome ?? null,
    totalItens: agregado.reduce((s, a) => s + a.quantidade, 0),
    temDeposito: !!depositoId,
  })
}
