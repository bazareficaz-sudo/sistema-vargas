import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validarTokenExtensao, registrarUso } from '@/lib/extensao/token'

export const dynamic = 'force-dynamic'

// A extensão chama isto ao abrir, para dizer ao usuário em qual empresa ele
// está capturando. Sem essa confirmação visível, é fácil passar a tarde
// capturando para a empresa errada.

// A extensão roda em chrome-extension://, uma origem que o navegador trata
// como cross-origin — sem estes cabeçalhos o navegador bloqueia a resposta.
// A autorização real é o token; o CORS aqui só destrava o transporte.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-vargas-extensao-token, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(req: Request) {
  const v = await validarTokenExtensao(req)
  if (!v.ok) return NextResponse.json({ ok: false, erro: v.erro }, { status: v.status, headers: CORS })

  const sb = createAdminClient()
  const [{ data: empresa }, { data: perfil }] = await Promise.all([
    sb.from('empresas').select('nome').eq('id', v.ctx.empresaId).single(),
    sb.from('profiles').select('nome').eq('id', v.ctx.userId).single(),
  ])

  await registrarUso(v.ctx.tokenId, req, false)

  return NextResponse.json({
    ok: true,
    empresa: empresa?.nome ?? 'Empresa',
    usuario: perfil?.nome ?? 'Usuário',
    dispositivo: v.ctx.nomeDispositivo,
  }, { headers: CORS })
}
