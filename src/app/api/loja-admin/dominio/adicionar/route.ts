import { NextResponse } from 'next/server'
import { contextoAdmin, lojaDaSessao } from '@/lib/commerce/admin'
import { adicionarDominio, sanitizarHost, vercelConfigurado } from '@/lib/vercel/dominios'

// Passo 1 do fluxo de domínio próprio: anexa o host ao projeto na Vercel e
// devolve os registros de DNS que ELA recomenda para aquele domínio
// específico — não um valor fixo no código, que ficaria errado no dia em
// que a Vercel trocar a infraestrutura por baixo.
//
// Isto NÃO grava `loja_config.dominio_proprio`. Só depois de o domínio
// aparecer configurado (rota `status`) é que a aba oferece "Ativar" — que
// reaproveita `/api/loja-admin/config`, a mesma rota das outras abas.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as { lojaId?: string; dominio?: string } | null
  if (!corpo?.lojaId || !UUID.test(corpo.lojaId)) {
    return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  }
  if (!(await lojaDaSessao(ctx, corpo.lojaId))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }

  const dominio = sanitizarHost(corpo.dominio)
  if (!dominio) {
    return NextResponse.json({ erro: 'Domínio inválido' }, { status: 400 })
  }
  if (!vercelConfigurado()) {
    return NextResponse.json(
      { erro: 'Recurso não configurado: falta a variável VERCEL_API_TOKEN no projeto.' },
      { status: 501 },
    )
  }

  try {
    const status = await adicionarDominio(dominio)
    return NextResponse.json({ ok: true, dominio, ...status })
  } catch (e) {
    console.error('[loja-admin] dominio/adicionar falhou', { dominio, erro: e instanceof Error ? e.message : e })
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : 'Não foi possível anexar o domínio' },
      { status: 502 },
    )
  }
}
