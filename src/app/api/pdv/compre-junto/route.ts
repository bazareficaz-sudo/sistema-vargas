import { createAdminClient } from '@/lib/supabase/admin'
import { leituraProtegida } from '@/lib/pdv/leituraProtegida'
import { lerPedidoCompreJunto, soDaEmpresa, type LinhaCompreJunto } from '@/lib/pdv/compreJunto'

// COMPRE JUNTO PARA O PDV DESKTOP.
//
// O PDV web já mostra "quem costuma levar junto" chamando
// `compre_junto_sugestoes` direto. O desktop sugeria só a partir das vendas
// do PRÓPRIO terminal, no SQLite local — sem o histórico da loja inteira e
// sem os ajustes de "fixar" e "ocultar" feitos no cadastro do produto.
//
// ── POR QUE SEM FLAG DE ROLLOUT ──────────────────────────────────────────
//
// As flags existem para as rotas que SUBSTITUEM um caminho legado: com a
// flag desligada, o terminal volta ao caminho antigo sem alarde. Aqui não há
// caminho antigo no servidor para voltar, e a resposta é conselho, nunca
// estado: o pior que uma sugestão errada faz é não ser clicada. Qualquer
// terminal ativo da empresa pode perguntar.
//
// ── A RESPOSTA É SÓ ID ───────────────────────────────────────────────────
//
// O terminal já tem o catálogo inteiro no SQLite: nome, preço, promoção e
// estoque saem de lá, com a mesma regra de preço do resto do carrinho. Mandar
// isso de novo daqui criaria uma segunda fonte de preço na mesma tela.
type Resposta = { erro: string } | { sugestoes: LinhaCompreJunto[] }

export async function GET(req: Request) {
  const pedido = lerPedidoCompreJunto(new URL(req.url).searchParams)

  return leituraProtegida<Resposta>(req, {
    exigirFlag: false,
    httpDoResultado: (r) => ('erro' in r ? 400 : 200),
    ler: async (ctx) => {
      if (!pedido.ok) return { erro: pedido.erro }
      const sb = createAdminClient()

      // Entrada: só os produtos do carrinho que são desta empresa.
      const { data: base, error: eBase } = await sb.from('produtos')
        .select('id').in('id', pedido.ids).eq('empresa_id', ctx.empresa_id)
      if (eBase) throw new Error(eBase.message)
      const idsBase = (base ?? []).map((p) => p.id as string)
      if (idsBase.length === 0) return { sugestoes: [] }

      const { data, error } = await sb.rpc('compre_junto_sugestoes', {
        p_produto_ids: idsBase,
        p_limite: pedido.limite,
      })
      if (error) throw new Error(error.message)
      const linhas = ((data ?? []) as LinhaCompreJunto[])
        .map((l) => ({ produto_id: l.produto_id, base_id: l.base_id, vezes: l.vezes, fixo: l.fixo }))
      if (linhas.length === 0) return { sugestoes: [] }

      // Saída: os sugeridos também têm de ser desta empresa.
      const { data: sugeridos, error: eSug } = await sb.from('produtos')
        .select('id').in('id', linhas.map((l) => l.produto_id)).eq('empresa_id', ctx.empresa_id)
      if (eSug) throw new Error(eSug.message)
      const daEmpresa = new Set([...idsBase, ...(sugeridos ?? []).map((p) => p.id as string)])

      return { sugestoes: soDaEmpresa(linhas, daEmpresa) }
    },
  })
}
