// Detecta ruptura (estoque <= 0) sem instrumentar cada lugar que escreve
// em `produtos.estoque` — venda no PDV, entrada manual, entrada por XML,
// ajuste, sincronização de marketplace, kit. São pontos demais para tocar
// pelo mesmo ganho.
//
// Em vez disso, compara o retrato de ontem com o de hoje. Roda dentro do
// cron noturno de reposição, que já lê o catálogo inteiro — aproveita a
// mesma leitura, não abre outra.

const DIA_MS = 86_400_000
const hoje = () => new Date().toISOString().slice(0, 10)

export type ResumoRupturas = { abertas: number; fechadas: number }

export async function atualizarRupturas(
  sb: any, empresaId: string, produtos: { id: string; estoque: number }[],
): Promise<ResumoRupturas> {
  const { data: abertasRows } = await sb.from('reposicao_rupturas')
    .select('id, produto_id, inicio').eq('empresa_id', empresaId).is('fim', null)
  const abertaPorProduto = new Map((abertasRows ?? []).map((r: any) => [r.produto_id, r]))

  const d = hoje()
  let novasAbertas = 0, fechadas = 0
  const novasLinhas: Record<string, unknown>[] = []

  for (const p of produtos) {
    const estoque = Number(p.estoque ?? 0)
    const jaAberta = abertaPorProduto.get(p.id) as { id: string; inicio: string } | undefined

    if (estoque <= 0 && !jaAberta) {
      novasLinhas.push({ empresa_id: empresaId, produto_id: p.id, inicio: d })
      novasAbertas++
    } else if (estoque > 0 && jaAberta) {
      // Quantas solicitações do balcão caíram dentro da janela da ruptura
      // — a medida de demanda perdida (item 34). Consulta por ruptura
      // fechada, não é caro: normalmente poucas fecham por noite.
      const { data: faltas } = await sb.from('faltas')
        .select('quantidade_solicitada')
        .eq('empresa_id', empresaId).eq('produto_id', p.id)
        .gte('created_at', `${jaAberta.inicio}T00:00:00Z`)

      const solicitacoes = faltas?.length ?? 0
      const unidades = (faltas ?? []).reduce((s: number, f: any) => s + Number(f.quantidade_solicitada ?? 0), 0)
      const dias = Math.max(1, Math.round((new Date(d).getTime() - new Date(jaAberta.inicio).getTime()) / DIA_MS))

      await sb.from('reposicao_rupturas').update({
        fim: d, dias, solicitacoes_durante: solicitacoes, unidades_solicitadas_durante: unidades,
        updated_at: new Date().toISOString(),
      }).eq('id', jaAberta.id)
      fechadas++
    }
    // estoque <= 0 e já aberta: ruptura continua, nada a fazer.
    // estoque > 0 e nunca esteve aberta: nunca faltou, nada a fazer.
  }

  if (novasLinhas.length > 0) {
    for (let i = 0; i < novasLinhas.length; i += 500) {
      await sb.from('reposicao_rupturas').insert(novasLinhas.slice(i, i + 500))
    }
  }

  return { abertas: novasAbertas, fechadas }
}
