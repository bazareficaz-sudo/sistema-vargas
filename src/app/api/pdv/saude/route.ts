import { createAdminClient } from '@/lib/supabase/admin'
import { leituraProtegida } from '@/lib/pdv/leituraProtegida'

// A POLÍTICA COMERCIAL, PARA O PDV EXTERNO.
//
// ── O QUE ESTA ROTA CONSERTA ─────────────────────────────────────────────
//
// Existem hoje duas réguas de saúde da venda, e elas não se falam:
//
//   web           `saude_faixas`     70 / 50 / 30 / 5 %   desc. 10 / 5 / 2 %
//   PDV externo   fixo no código     30 / 15 /  8 %       desc. 12 %
//
// A tabela que o PDV lê para saber a política de desconto (`config_desconto`)
// está VAZIA em produção. Por isso o terminal mostra "desconto máx. 12%" —
// um número que ninguém configurou, que veio de um default de código.
//
// Na prática: o vendedor no balcão é guiado por números que ninguém definiu,
// enquanto a política real fica no web e nunca chega nele. Uma venda de 35%
// de margem aparece como "Excelente" no terminal e é "Atenção" na política.
//
// ── POR QUE UMA ROTA, E NÃO O ANON ───────────────────────────────────────
//
// `saude_config` está aberta ao `anon` e o PDV já a lê assim. `saude_faixas`
// NÃO está — conferido em produção com `has_table_privilege`. Abrir seria
// devolver um privilégio que foi retirado de propósito, e seria abrir
// `preco_custo` por tabela vizinha: as faixas carregam a política de margem
// da loja inteira.
//
// Sem flag de rollout, pelo mesmo motivo do compre-junto: isto é leitura de
// política, não substitui caminho nenhum, e o pior que uma resposta ausente
// faz é o terminal seguir com o que já tinha.
export async function GET(req: Request) {
  return leituraProtegida(req, {
    exigirFlag: false,
    ler: async (ctx) => {
      const sb = createAdminClient()

      const [{ data: config }, { data: faixas }] = await Promise.all([
        sb.from('saude_config').select('*').eq('empresa_id', ctx.empresa_id).maybeSingle(),
        sb.from('saude_faixas').select('*').eq('empresa_id', ctx.empresa_id).order('ordem'),
      ])

      // `null` e lista vazia são respostas diferentes, e o terminal trata
      // cada uma do seu jeito: sem config, mantém o que tinha; sem faixas,
      // usa as de fábrica. Achatar as duas em `{}` apagaria a distinção.
      return {
        config: config ?? null,
        faixas: faixas ?? [],
      }
    },
  })
}
