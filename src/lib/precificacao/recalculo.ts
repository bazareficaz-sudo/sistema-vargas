import { buscarConfigDoCanal } from './config'
import { saudeDaMargem, calcular } from './motor'
import { aplicarRegra, buscarRegras, descreverObjetivo, resolverRegra, type Regra } from './regras'
import { calcularKit } from '@/lib/produtos/kit'
import type { SaudePreco } from './tipos'

// Varredura de recálculo: percorre os anúncios, aplica a regra que vale pra
// cada um e devolve o que MUDARIA — sem alterar nada.
//
// A parte que importa tanto quanto o cálculo: contar honestamente o que NÃO
// deu pra calcular e por quê. Um recálculo que diz "142 anúncios" quando
// existem 8.655 precisa dizer o que houve com os outros 8.513, senão passa a
// impressão de que a loja inteira foi coberta.

export type ItemRecalculo = {
  anuncioId: string
  canalId: string
  canalNome: string
  titulo: string
  produtoId: string
  produtoNome: string
  sku: string | null
  custo: number
  precoAtual: number
  precoNovo: number
  diferenca: number
  margemAtual: number
  margemNova: number
  saudeAtual: SaudePreco
  saudeNova: SaudePreco
  regraNome: string
  regraObjetivo: string
  regraId: string
  avisos: string[]
}

export type ResumoRecalculo = {
  totalAnuncios: number
  calculados: number
  semProduto: number
  semCusto: number
  semRegra: number
  semPrecoAtual: number
  sobem: number
  descem: number
  iguais: number
  emPrejuizoAgora: number
  emPrejuizoDepois: number
  somaDiferenca: number
}

const TOLERANCIA = 0.01 // centavos: abaixo disso o preço é "o mesmo"

export async function varrerRecalculo(
  sb: any,
  empresaId: string,
  opcoes: { canaisIds?: string[]; apenasAtivos?: boolean; limiteItens?: number } = {},
): Promise<{ resumo: ResumoRecalculo; itens: ItemRecalculo[]; truncado: boolean }> {
  const limiteItens = opcoes.limiteItens ?? 500

  let qCanais = sb.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', empresaId)
  if (opcoes.canaisIds?.length) qCanais = qCanais.in('id', opcoes.canaisIds)
  const { data: canais } = await qCanais.order('nome')

  const regras = await buscarRegras(sb, empresaId)
  const configPorCanal = new Map<string, any>()
  for (const c of canais ?? []) {
    const { cfg } = await buscarConfigDoCanal(sb, empresaId, c)
    configPorCanal.set(c.id, cfg)
  }

  const resumo: ResumoRecalculo = {
    totalAnuncios: 0, calculados: 0, semProduto: 0, semCusto: 0, semRegra: 0, semPrecoAtual: 0,
    sobem: 0, descem: 0, iguais: 0, emPrejuizoAgora: 0, emPrejuizoDepois: 0, somaDiferenca: 0,
  }
  const itens: ItemRecalculo[] = []
  // Custo de kit é caro (consulta os componentes) — calcula uma vez por
  // produto, não uma vez por anúncio.
  const custoKitCache = new Map<string, number>()

  const TAM = 1000
  for (const canal of canais ?? []) {
    const cfg = configPorCanal.get(canal.id)
    for (let off = 0; off < 30 * TAM; off += TAM) {
      let q = sb.from('marketplace_anuncios')
        .select('id, titulo, preco_venda, preco_promocional, status, produto_id, produtos(id, nome, sku, categoria, marca, tipo, preco_custo, peso_kg)')
        .eq('canal_id', canal.id).eq('empresa_id', empresaId)
        .range(off, off + TAM - 1)
      if (opcoes.apenasAtivos) q = q.eq('status', 'ativo')
      const { data } = await q
      const lote = data ?? []

      for (const a of lote) {
        resumo.totalAnuncios++
        const p: any = a.produtos
        if (!p) { resumo.semProduto++; continue }

        let custo = Number(p.preco_custo ?? 0)
        if (p.tipo === 'kit') {
          if (!custoKitCache.has(p.id)) {
            custoKitCache.set(p.id, Number((await calcularKit(sb, p.id))?.custo ?? 0))
          }
          custo = custoKitCache.get(p.id)!
        }
        if (!(custo > 0)) { resumo.semCusto++; continue }

        const resolucao = resolverRegra(regras, { id: p.id, categoria: p.categoria, marca: p.marca }, canal)
        if (!resolucao.vencedora) { resumo.semRegra++; continue }

        const precoAtual = Number(a.preco_promocional || a.preco_venda || 0)
        if (!(precoAtual > 0)) { resumo.semPrecoAtual++; continue }

        const pesoKg = p.peso_kg != null ? Number(p.peso_kg) : null
        const novo = aplicarRegra({ cfg, custoProduto: custo, regra: resolucao.vencedora, pesoKg })
        const atual = calcular({ cfg, custoProduto: custo, objetivo: { tipo: 'preco', valor: precoAtual }, pesoKg })

        const diferenca = Number((novo.preco - precoAtual).toFixed(2))
        resumo.calculados++
        resumo.somaDiferenca += diferenca
        if (diferenca > TOLERANCIA) resumo.sobem++
        else if (diferenca < -TOLERANCIA) resumo.descem++
        else resumo.iguais++
        if (atual.lucro < 0) resumo.emPrejuizoAgora++
        if (novo.lucro < 0) resumo.emPrejuizoDepois++

        if (itens.length < limiteItens && Math.abs(diferenca) > TOLERANCIA) {
          itens.push({
            anuncioId: a.id, canalId: canal.id, canalNome: canal.nome,
            titulo: a.titulo ?? '', produtoId: p.id, produtoNome: p.nome, sku: p.sku ?? null,
            custo, precoAtual, precoNovo: novo.preco, diferenca,
            margemAtual: Number(atual.margemLiquida.toFixed(2)),
            margemNova: Number(novo.margemLiquida.toFixed(2)),
            saudeAtual: saudeDaMargem(atual.margemLiquida, cfg.faixasSaude),
            saudeNova: saudeDaMargem(novo.margemLiquida, cfg.faixasSaude),
            regraNome: resolucao.vencedora.nome,
            regraObjetivo: descreverObjetivo(resolucao.vencedora.objetivoTipo, resolucao.vencedora.objetivoValor),
            regraId: resolucao.vencedora.id,
            avisos: novo.avisos,
          })
        }
      }

      if (lote.length < TAM) break
    }
  }

  // Maior impacto primeiro: quem está mais longe do preço certo é quem mais
  // custa dinheiro deixar como está.
  itens.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))

  const totalComDiferenca = resumo.sobem + resumo.descem
  return { resumo, itens, truncado: totalComDiferenca > itens.length }
}

export function regraDoItem(regras: Regra[], id: string): Regra | undefined {
  return regras.find(r => r.id === id)
}
