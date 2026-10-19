import { cookies } from 'next/headers'
import { empresasDoUsuario } from '@/lib/auth/empresaAtiva'
import { COOKIE_EMPRESAS_PAGAR, empresasEscolhidas, montarEmpresas, type EmpresaPagar } from './empresasPagar'

/**
 * As empresas que o usuário pode ver no contas a pagar e as que escolheu.
 *
 * Permitidas = vínculos ativos em usuario_empresas. Quem não tem vínculo
 * registrado (cadastro antigo) fica só com a empresa ativa.
 */
export async function empresasDoPagar(
  sb: Parameters<typeof empresasDoUsuario>[0], userId: string, ativa: string,
): Promise<{ empresas: EmpresaPagar[]; escolhidas: string[] }> {
  let lista = (await empresasDoUsuario(sb, userId)).map(e => ({ id: e.id, nome: e.nome }))
  if (!lista.some(e => e.id === ativa)) {
    const { data } = await sb.from('empresas').select('id, nome, nome_fantasia').eq('id', ativa).maybeSingle()
    lista = [{ id: ativa, nome: data?.nome_fantasia || data?.nome || 'Empresa' }, ...lista]
  }
  const empresas = montarEmpresas(lista)
  let cookie: string | undefined
  try { cookie = (await cookies()).get(COOKIE_EMPRESAS_PAGAR)?.value } catch { cookie = undefined }
  return { empresas, escolhidas: empresasEscolhidas(cookie, empresas.map(e => e.id), ativa) }
}
