import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'
import { APP_URL } from '@/lib/appUrl'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Gera um novo link de acesso para um usuário que ainda não definiu senha.
//
// Antes esta rota chamava inviteUserByEmail, que só funciona para e-mail que
// ainda NÃO existe em auth.users. Como o convite original já criou a conta,
// o reenvio sempre respondia "A user with this email address has already been
// registered" e o usuário ficava sem saída: sem senha e sem link novo.
//
// Agora usa generateLink type 'recovery', que serve exatamente para isso.
// Dois ganhos além de funcionar:
//  - o link é gerado no servidor e verificado pelo Supabase, então abre em
//    qualquer navegador ou celular (o fluxo de "esqueci minha senha" pedido
//    pelo navegador usa PKCE e falha se a pessoa abre o e-mail em outro
//    aparelho — foi o que aconteceu aqui);
//  - o gestor recebe o link na tela e pode mandar por WhatsApp, sem depender
//    do e-mail chegar (o template do Supabase ainda está em inglês).

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_usuarios')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const alvo = await perfilDaSessao(sb, id, 'empresa_id, status')
  if (!alvo || alvo.empresa_id !== guarda.empresaId) {
    return NextResponse.json({ ok: false, erro: 'Usuário não encontrado' }, { status: 404 })
  }

  const admin = createAdminClient()
  const { data: authUser } = await admin.auth.admin.getUserById(id)
  const email = authUser?.user?.email
  if (!email) return NextResponse.json({ ok: false, erro: 'E-mail do usuário não encontrado' }, { status: 400 })

  const appUrl = APP_URL
  const redirectTo = `${appUrl}/auth/callback?next=/auth/definir-senha`

  // Conta já existe (é o caso de todo convite que já saiu uma vez): o que
  // vale é um link de recuperação. Só e-mail nunca visto aceita convite.
  const jaExiste = !!authUser?.user
  const { data, error } = jaExiste
    ? await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    : await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } })

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  // Monta o link apontando pra NOSSA tela, levando o token pra ser validado
  // lá com verifyOtp.
  //
  // O action_link do Supabase passa pelo /auth/v1/verify dele, que devolve a
  // sessão no FRAGMENTO da URL (#access_token=...). Fragmento não é enviado
  // ao servidor, e a tela abria antes do cliente terminar de processá-lo —
  // resultado: "Link expirado" num link recém-gerado. Com token_hash o
  // caminho é determinístico e funciona em qualquer navegador ou celular.
  const tokenHash = data?.properties?.hashed_token
  if (!tokenHash) return NextResponse.json({ ok: false, erro: 'O Supabase não devolveu o token de acesso.' }, { status: 400 })
  const link = `${appUrl}/auth/definir-senha?token_hash=${encodeURIComponent(tokenHash)}&type=${jaExiste ? 'recovery' : 'invite'}`

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'link_acesso_gerado', tabela: 'profiles',
    valorNovo: { usuarioAlvo: id, tipo: jaExiste ? 'recovery' : 'invite' },
  })

  return NextResponse.json({ ok: true, link, email })
}
