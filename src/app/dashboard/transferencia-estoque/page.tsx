import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao, empresasDoUsuario } from '@/lib/auth/empresaAtiva'
import TransferenciaEstoqueClient from '@/components/estoque/TransferenciaEstoqueClient'

export const dynamic = 'force-dynamic'

// Transferência de estoque — entre depósitos da mesma empresa, ou entre
// empresas do mesmo grupo.
//
// O catálogo de produtos (14 mil+ linhas) NÃO é carregado aqui — a busca de
// produto é sempre ao vivo, no client (mesmo padrão de NovaEntradaClient e
// AnunciosClient). Esta página só monta o que é necessário ANTES de
// escolher um produto: para onde dá para transferir, e o histórico recente
// de entradas (para o modo "a partir de uma entrada").

export default async function TransferenciaEstoquePage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: depositosProprios } = await sb.from('depositos')
    .select('id, nome, principal').eq('empresa_id', empresaId).eq('ativo', true).order('nome')

  const { data: categorias } = await sb.from('categorias')
    .select('id, nome, pai_id').eq('empresa_id', empresaId).order('nome')

  // Empresas do grupo com as quais existe parceria ATIVA — o mesmo portão
  // que a rota de execução confere de novo no servidor (nunca confia só
  // nesta lista, que é pra montar a tela).
  const [{ data: comoA }, { data: comoB }] = await Promise.all([
    sb.from('empresa_parcerias').select('id, empresa_id_b').eq('empresa_id_a', empresaId).eq('status', 'ativa'),
    sb.from('empresa_parcerias').select('id, empresa_id_a').eq('empresa_id_b', empresaId).eq('status', 'ativa'),
  ])
  const parceriaPorEmpresa = new Map<string, string>()
  for (const p of comoA ?? []) parceriaPorEmpresa.set(p.empresa_id_b, p.id)
  for (const p of comoB ?? []) parceriaPorEmpresa.set(p.empresa_id_a, p.id)

  // E, dessas, só as que o usuário logado realmente pode operar — ver
  // porquê na rota de execução.
  const permitidas = await empresasDoUsuario(sb, user!.id)
  const idsParceirasPermitidas = permitidas.map(e => e.id).filter(id => id !== empresaId && parceriaPorEmpresa.has(id))

  const empresasParceiras: { id: string; nome: string; parceriaId: string; depositos: { id: string; nome: string; principal: boolean }[] }[] = []
  for (const id of idsParceirasPermitidas) {
    const { data: deps } = await sb.from('depositos')
      .select('id, nome, principal').eq('empresa_id', id).eq('ativo', true).order('nome')
    if (deps && deps.length > 0) {
      empresasParceiras.push({
        id, nome: permitidas.find(e => e.id === id)?.nome ?? 'Empresa',
        parceriaId: parceriaPorEmpresa.get(id)!,
        depositos: deps,
      })
    }
  }

  // Entradas recentes, das duas origens — mesmo padrão de junção usado em
  // /api/pedidos-compra/historico-fornecedor, aqui só os 20 mais recentes
  // de cada uma (a lista serve pra escolher qual entrada usar como ponto de
  // partida, não pra navegar o histórico inteiro).
  const [{ data: entradasManuais }, { data: entradasXml }] = await Promise.all([
    sb.from('entradas')
      .select('id, numero_entrada, numero_nf, data_entrada, fornecedores(nome_fantasia, razao_social)')
      .eq('empresa_id', empresaId).eq('status', 'confirmada')
      .order('data_entrada', { ascending: false }).limit(20),
    sb.from('nfe_entradas')
      .select('id, numero, data_entrada, nome_fornecedor')
      .eq('empresa_id', empresaId)
      .order('data_entrada', { ascending: false }).limit(20),
  ])

  const entradas = [
    ...(entradasManuais ?? []).map((e: any) => ({
      id: e.id, origem: 'manual' as const,
      numero: e.numero_entrada ?? e.numero_nf ?? '—',
      data: e.data_entrada,
      fornecedor: e.fornecedores?.nome_fantasia || e.fornecedores?.razao_social || null,
    })),
    ...(entradasXml ?? []).map((e: any) => ({
      id: e.id, origem: 'xml' as const,
      numero: e.numero ?? '—',
      data: e.data_entrada,
      fornecedor: e.nome_fornecedor ?? null,
    })),
  ].sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''))

  return (
    <TransferenciaEstoqueClient
      empresaId={empresaId}
      depositosProprios={depositosProprios ?? []}
      categorias={categorias ?? []}
      empresasParceiras={empresasParceiras}
      entradas={entradas}
    />
  )
}
