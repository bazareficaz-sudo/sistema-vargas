import { createClient } from '@supabase/supabase-js'

// A ÚNICA porta entre a vitrine pública e o banco.
//
// A regra que governa este arquivo, e o projeto inteiro da Loja Online:
//
//     O NAVEGADOR DO CONSUMIDOR NUNCA RECEBE CHAVE DE BANCO.
//
// Não é preciosismo. Medido em produção em 23/08/2026, a chave `anon` — que
// é pública por natureza, vai dentro do JavaScript — lê sem nenhum login:
// 28.593 produtos COM `preco_custo`, 64 clientes com CPF, 1.863 vendas, e o
// `senha_hash` dos operadores do PDV. Isso está documentado em
// supabase-fechar-acesso-publico-2.sql, no bloco "AINDA ABERTO", e a causa é
// o PDV externo conectar sem sessão — não dá para fechar sem trocar o
// terminal.
//
// Enquanto isso existir, publicar um site feito para atrair tráfego usando a
// mesma chave seria multiplicar a chance de alguém extraí-la do bundle. Então
// a vitrine renderiza no servidor e conversa com o banco só por aqui, com
// chave de serviço e por views de lista branca (loja_vitrine_produtos), onde
// custo e margem não existem nem como coluna.

/** Barreira em tempo de execução. Sem `server-only` no projeto, esta é a trava. */
function garantirServidor(): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[commerce] src/lib/commerce/db.ts foi importado no navegador. ' +
      'Este módulo usa a chave de serviço do Supabase e só pode rodar no servidor. ' +
      'Mova a chamada para um Server Component ou uma Route Handler.',
    )
  }
}

// `any` no genérico porque este projeto não gera os tipos do banco
// (`supabase gen types`). Sem isso, todo `.from()` e `.rpc()` volta `never` e
// o TypeScript rejeita o código inteiro. É a mesma convenção do resto do
// sistema, onde o cliente circula como `sb: any`.
let cliente: any = null

/**
 * Cliente de leitura da vitrine.
 *
 * Usa a chave de serviço porque a vitrine não tem sessão de usuário e não
 * pode ter chave pública. O isolamento entre lojas NÃO vem da RLS aqui — vem
 * de toda consulta desta camada carregar `loja_id`, que por sua vez resolve
 * empresa, grupo e tenant. Por isso nenhuma função abaixo aceita ser chamada
 * sem `lojaId`.
 */
export function db(): any {
  garantirServidor()
  if (!cliente) {
    cliente = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  }
  return cliente
}

/**
 * Colunas que jamais podem sair para uma página pública.
 *
 * A defesa real é estrutural — a view `loja_vitrine_produtos` não tem
 * nenhuma delas. Esta lista existe como segunda camada, para o caso de
 * alguém, algum dia, consultar `produtos` diretamente daqui.
 */
export const COLUNAS_PROIBIDAS = [
  'preco_custo', 'markup', 'obs_interna', 'codigo_fornecedor', 'fornecedor_padrao_id',
  'estoque', 'estoque_minimo', 'ncm', 'cfop', 'icms_cst', 'icms_origem', 'pis_cst',
  'cofins_cst', 'csosn', 'cest', 'ibs_cst', 'ibs_aliquota', 'cbs_aliquota',
  'icms_percentual', 'pis_percentual', 'cofins_percentual', 'ipi_percentual',
] as const

/**
 * Remove qualquer campo proibido antes de o objeto virar HTML.
 *
 * Rede de segurança, não a proteção principal: em desenvolvimento estoura,
 * para o erro aparecer na hora de escrever o código; em produção só limpa,
 * porque derrubar a vitrine por causa de um campo a mais seria pior que
 * omiti-lo.
 */
export function limpar<T extends Record<string, unknown>>(linha: T): T {
  const achados = COLUNAS_PROIBIDAS.filter(c => c in linha)
  if (achados.length > 0) {
    const aviso = `[commerce] campo interno chegou à vitrine: ${achados.join(', ')}`
    if (process.env.NODE_ENV !== 'production') throw new Error(aviso)
    console.error(aviso)
    const copia = { ...linha }
    for (const c of achados) delete (copia as Record<string, unknown>)[c]
    return copia
  }
  return linha
}
