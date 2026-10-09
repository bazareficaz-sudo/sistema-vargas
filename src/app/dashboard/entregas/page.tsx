import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import EntregasClient from '@/components/entregas/EntregasClient'

export const dynamic = 'force-dynamic'

// Agenda de entregas das vendas do PDV. Os dados carregam no navegador
// porque o "hoje" é o do fuso da loja, não o do servidor.
export default async function EntregasPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id, 'empresa_id, empresas(nome, nome_fantasia)')
  const empresa = perfil?.empresas as unknown as { nome: string; nome_fantasia: string | null } | null
  // Ver a agenda é de quem abre a tela; dar baixa é de quem vende.
  const guarda = await exigirPermissao(sb, 'realizar_vendas')

  return (
    <EntregasClient
      empresaId={perfil?.empresa_id ?? ''}
      empresaNome={empresa?.nome_fantasia ?? empresa?.nome ?? ''}
      podeBaixar={guarda.ok}
    />
  )
}
