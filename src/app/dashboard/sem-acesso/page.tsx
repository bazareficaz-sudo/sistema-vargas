import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { buscarExcecoes } from '@/lib/auth/permissoes'
import { telaDoPathname, podeAbrirTela } from '@/lib/auth/telas'

export const dynamic = 'force-dynamic'

// Para onde o proxy manda quem tentou abrir uma tela bloqueada. Existe como
// página própria (e não como um alerta na Visão Geral) para o endereço da
// barra deixar claro o que aconteceu, em vez de o clique parecer que falhou.
export default async function SemAcessoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string }>
}) {
  const { de = '' } = await searchParams
  const tela = de ? telaDoPathname(de) : null

  // Oferecer "voltar para a Visão Geral" para quem tem a Visão Geral
  // bloqueada manda a pessoa para outra recusa — um laço. Só mostra o botão
  // quando ele leva a algum lugar que ela pode abrir.
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const excecoes = user ? await buscarExcecoes(sb, user.id) : {}
  const podeVoltarAoInicio = podeAbrirTela('/dashboard', excecoes)

  return (
    <div className="p-6 max-w-lg">
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <span className="text-3xl block mb-2">🔒</span>
        <h1 className="text-lg font-semibold text-slate-900">Sem acesso a esta tela</h1>
        <p className="text-sm text-slate-600 mt-1">
          {tela
            ? <>A tela <b>{tela.label}</b> não está liberada para o seu usuário.</>
            : 'Esta tela não está liberada para o seu usuário.'}
        </p>
        <p className="text-xs text-slate-500 mt-3">
          Quem libera é um administrador, em Configurações → Usuários → botão Permissões.
        </p>
        {podeVoltarAoInicio ? (
          <Link href="/dashboard"
            className="inline-block mt-4 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700">
            Voltar para a Visão Geral
          </Link>
        ) : (
          <p className="text-xs text-slate-500 mt-4">
            Use o menu à esquerda — ele já mostra só as telas liberadas para você.
          </p>
        )}
      </div>
    </div>
  )
}
