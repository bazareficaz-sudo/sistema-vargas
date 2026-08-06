// Estoque unificado entre empresas do mesmo grupo.
//
// Quando duas empresas do grupo vendem o mesmo item e a mercadoria é atendida
// indistintamente, o número que vale para os anúncios é a SOMA — não o
// estoque isolado de cada CNPJ. Sem isso, cada loja anuncia só a parte dela e
// deixa venda na mesa.
//
// O que decide "qual produto da empresa B é o mesmo da empresa A" já existe:
// `produto_vinculos`, da fase de Parcerias. Aqui só se soma.
//
// ONDE ISSO VALE — importante: este número é o que vai para os ANÚNCIOS dos
// marketplaces. O PDV continua vendendo do estoque da própria empresa, e é
// deliberado: deixar o balcão vender o que está fisicamente na outra loja
// criaria promessa que a operação não cumpre. Se um dia isso for desejado, é
// uma decisão separada e consciente.

export type ParticipanteUnificacao = {
  empresaId: string
  empresaNome: string
  /** null = todos os depósitos daquela empresa. */
  depositoId: string | null
  depositoNome: string | null
}

export type ConfigUnificacao = {
  ativo: boolean
  /** Depósito da própria empresa que entra na conta. null = total. */
  depositoProprioId: string | null
  participantes: ParticipanteUnificacao[]
}

export async function buscarConfigUnificacao(sb: any, empresaId: string): Promise<ConfigUnificacao> {
  const { data: cfg } = await sb.from('empresa_config_estoque')
    .select('estoque_unificado_ativo, estoque_unificado_deposito_id')
    .eq('empresa_id', empresaId).maybeSingle()

  const ativo = !!cfg?.estoque_unificado_ativo
  if (!ativo) return { ativo: false, depositoProprioId: null, participantes: [] }

  const { data: linhas } = await sb.from('estoque_unificado_participantes')
    .select('participante_id, deposito_id')
    .eq('empresa_id', empresaId)

  const ids = (linhas ?? []).map((l: any) => l.participante_id)
  const depIds = (linhas ?? []).map((l: any) => l.deposito_id).filter(Boolean)

  const [{ data: empresas }, { data: depositos }] = await Promise.all([
    ids.length ? sb.from('empresas').select('id, nome_fantasia, razao_social').in('id', ids) : Promise.resolve({ data: [] }),
    depIds.length ? sb.from('depositos').select('id, nome').in('id', depIds) : Promise.resolve({ data: [] }),
  ])
  const nomeEmpresa = (id: string) => {
    const e = (empresas ?? []).find((x: any) => x.id === id)
    return e?.nome_fantasia ?? e?.razao_social ?? 'Empresa'
  }
  const nomeDeposito = (id: string | null) =>
    id ? ((depositos ?? []).find((d: any) => d.id === id)?.nome ?? null) : null

  return {
    ativo: true,
    depositoProprioId: cfg?.estoque_unificado_deposito_id ?? null,
    participantes: (linhas ?? []).map((l: any) => ({
      empresaId: l.participante_id,
      empresaNome: nomeEmpresa(l.participante_id),
      depositoId: l.deposito_id ?? null,
      depositoNome: nomeDeposito(l.deposito_id ?? null),
    })),
  }
}

/**
 * Estoque de um conjunto de produtos, somando as empresas participantes.
 *
 * Devolve `null` quando a unificação está desligada — o chamador segue usando
 * o estoque de sempre, sem nenhum desvio de comportamento.
 */
export async function estoqueUnificadoDeProdutos(
  sb: any,
  empresaId: string,
  produtoIds: string[],
  configPronta?: ConfigUnificacao,
): Promise<Map<string, number> | null> {
  if (produtoIds.length === 0) return null
  const cfg = configPronta ?? await buscarConfigUnificacao(sb, empresaId)
  if (!cfg.ativo || cfg.participantes.length === 0) return null

  const soma = new Map<string, number>()

  // 1) Estoque da própria empresa, do depósito escolhido (ou o total).
  if (cfg.depositoProprioId) {
    const { data } = await sb.from('produto_estoque').select('produto_id, quantidade')
      .eq('deposito_id', cfg.depositoProprioId).in('produto_id', produtoIds)
    for (const id of produtoIds) soma.set(id, 0)
    for (const r of data ?? []) soma.set(r.produto_id, Number(r.quantidade ?? 0))
  } else {
    const { data } = await sb.from('produtos').select('id, estoque').in('id', produtoIds)
    for (const r of data ?? []) soma.set(r.id, Number(r.estoque ?? 0))
  }

  // 2) Cada participante: acha o produto equivalente pelo vínculo e soma.
  for (const p of cfg.participantes) {
    // O vínculo não tem lado fixo — a empresa dona pode estar em `a` ou em
    // `b`, dependendo de quem criou a parceria. Consultar os dois sentidos.
    const [ladoA, ladoB] = await Promise.all([
      sb.from('produto_vinculos').select('produto_id_a, produto_id_b').in('produto_id_a', produtoIds),
      sb.from('produto_vinculos').select('produto_id_a, produto_id_b').in('produto_id_b', produtoIds),
    ])
    const pares: { meu: string; outro: string }[] = [
      ...((ladoA.data ?? []).map((v: any) => ({ meu: v.produto_id_a, outro: v.produto_id_b }))),
      ...((ladoB.data ?? []).map((v: any) => ({ meu: v.produto_id_b, outro: v.produto_id_a }))),
    ]
    if (pares.length === 0) continue

    // Só interessam os produtos que pertencem a ESTE participante — o mesmo
    // produto pode ter vínculo com mais de uma empresa do grupo.
    const idsOutros = Array.from(new Set(pares.map(x => x.outro)))
    const { data: doParticipante } = await sb.from('produtos')
      .select('id, estoque').eq('empresa_id', p.empresaId).in('id', idsOutros)
    const validos = new Map<string, number>(
      (doParticipante ?? []).map((r: any) => [r.id, Number(r.estoque ?? 0)]),
    )
    if (validos.size === 0) continue

    // Depósito específico: troca o total pelo saldo daquele depósito.
    if (p.depositoId) {
      const { data: pe } = await sb.from('produto_estoque').select('produto_id, quantidade')
        .eq('deposito_id', p.depositoId).in('produto_id', [...validos.keys()])
      for (const id of validos.keys()) validos.set(id, 0)
      for (const r of pe ?? []) validos.set(r.produto_id, Number(r.quantidade ?? 0))
    }

    for (const { meu, outro } of pares) {
      if (!validos.has(outro)) continue
      soma.set(meu, (soma.get(meu) ?? 0) + validos.get(outro)!)
    }
  }

  return soma
}
