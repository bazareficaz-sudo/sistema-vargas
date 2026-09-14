import { NextResponse } from 'next/server'
import { contextoAdmin, lojaDaSessao } from '@/lib/commerce/admin'
import { sanitizarHost, statusDominio, vercelConfigurado } from '@/lib/vercel/dominios'

// Passo 2: "já configurei o DNS, confere agora?" — chamado a cada clique em
// "Verificar", e por isso é GET (idempotente, sem efeito no banco).

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const url = new URL(req.url)
  const lojaId = url.searchParams.get('lojaId') ?? ''
  const dominio = sanitizarHost(url.searchParams.get('dominio'))

  if (!UUID.test(lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  if (!dominio) return NextResponse.json({ erro: 'Domínio inválido' }, { status: 400 })
  if (!vercelConfigurado()) {
    return NextResponse.json(
      { erro: 'Recurso não configurado: falta a variável VERCEL_API_TOKEN no projeto.' },
      { status: 501 },
    )
  }

  try {
    const status = await statusDominio(dominio)
    return NextResponse.json({ ok: true, dominio, ...status })
  } catch (e) {
    console.error('[loja-admin] dominio/status falhou', { dominio, erro: e instanceof Error ? e.message : e })
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : 'Não foi possível checar o domínio' },
      { status: 502 },
    )
  }
}
