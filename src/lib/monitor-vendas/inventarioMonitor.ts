// "Conferir estoque" no Monitor de Vendas — o funcionário está em dúvida
// sobre o saldo de um produto e quer colocá-lo numa lista de contagem, sem
// abrir a tela de Inventário nem escolher depósito/categoria.
//
// Não cria um inventário por clique: existe UM inventário chamado
// "MONITOR DE VENDA" por empresa, reaproveitado enquanto estiver aberto.
// Some as regras já usadas em `InventarioDetalheClient.tsx` — mesmos campos,
// mesmo histórico — só que decidindo sozinho o inventário de destino.

const NOME_INVENTARIO_MONITOR = 'MONITOR DE VENDA'

export type ProdutoParaInventario = {
  id: string
  nome: string
  sku: string | null
  ean: string | null
  categoria: string | null
  marca: string | null
  unidade: string
  custo: number
  estoque: number
}

export type ResultadoInserirInventario =
  | { ok: true; jaEstavaNaLista: boolean; inventarioId: string }
  | { ok: false; erro: string }

export async function inserirNoInventarioMonitor(
  sb: any,
  empresaId: string,
  operador: string,
  produto: ProdutoParaInventario,
): Promise<ResultadoInserirInventario> {
  try {
    const { data: existente, error: erroBusca } = await sb.from('inventarios')
      .select('id')
      .eq('empresa_id', empresaId)
      .eq('descricao', NOME_INVENTARIO_MONITOR)
      .eq('status', 'aberto')
      .maybeSingle()
    if (erroBusca) throw erroBusca

    let inventarioId: string = existente?.id ?? ''

    if (!inventarioId) {
      // Depósito só entra como rótulo do cabeçalho — o item guarda
      // `estoque_sistema` do produto como um todo, não por depósito (mesmo
      // comportamento de `adicionarProduto` na tela de Inventário).
      const { data: deposito } = await sb.from('depositos')
        .select('id, nome')
        .eq('empresa_id', empresaId)
        .eq('ativo', true)
        .order('principal', { ascending: false })
        .limit(1)
        .maybeSingle()

      const { data: criado, error: erroCriar } = await sb.from('inventarios').insert({
        empresa_id: empresaId,
        deposito_id: deposito?.id ?? null,
        deposito_nome: deposito?.nome ?? null,
        descricao: NOME_INVENTARIO_MONITOR,
        tipo: 'geral',
        responsavel: operador,
        observacao: 'Criado automaticamente pelo Monitor de Vendas, para conferir produtos em dúvida durante a venda.',
        status: 'aberto',
      }).select('id').single()
      if (erroCriar) throw erroCriar
      inventarioId = criado.id

      await sb.from('inventario_historico').insert({
        inventario_id: inventarioId, acao: 'criado',
        descricao: `Inventário criado automaticamente por ${operador}, a partir do Monitor de Vendas`,
        usuario: operador,
      })
    }

    const { error: erroItem } = await sb.from('inventario_itens').insert({
      inventario_id: inventarioId,
      produto_id: produto.id,
      produto_nome: produto.nome,
      produto_sku: produto.sku,
      produto_ean: produto.ean,
      categoria: produto.categoria,
      marca: produto.marca,
      unidade: produto.unidade || 'UN',
      origem: 'monitor_vendas',
      estoque_sistema: produto.estoque,
      preco_custo: produto.custo,
      status_item: 'pendente',
    })

    if (erroItem) {
      // 23505 = já está na lista deste inventário — o pedido foi "inserir se
      // não tiver", então isto é sucesso, não falha.
      if (erroItem.code !== '23505') throw erroItem
      return { ok: true, jaEstavaNaLista: true, inventarioId }
    }

    await sb.from('inventario_historico').insert({
      inventario_id: inventarioId, acao: 'produto_adicionado',
      descricao: `Produto "${produto.nome}" adicionado pelo Monitor de Vendas`,
      usuario: operador,
    })

    // Recontar em vez de incrementar às cegas: este helper não sabe quantos
    // itens o inventário já tinha, e recontar do banco nunca desalinha por
    // corrida entre dois cliques quase simultâneos.
    const { count } = await sb.from('inventario_itens')
      .select('id', { count: 'exact', head: true })
      .eq('inventario_id', inventarioId)
    if (typeof count === 'number') {
      await sb.from('inventarios').update({ total_itens: count }).eq('id', inventarioId)
    }

    return { ok: true, jaEstavaNaLista: false, inventarioId }
  } catch (e: any) {
    return { ok: false, erro: e?.message ?? 'Não foi possível inserir no inventário.' }
  }
}
