import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'
import { removerDominio, sanitizarHost, vercelConfigurado } from '@/lib/vercel/dominios'

// Desfaz os dois passos de uma vez: solta o domínio do projeto na Vercel e
// limpa `loja_config.dominio_proprio` — para trocar de domínio, ou para
// desistir de um que foi anexado mas nunca chegou a "Ativar".
//
// Se o domínio pedido para remover não é o que está ativo (ex: a pessoa
// anexou um, desistiu, nunca ativou, e está limpando esse mesmo domínio),
// não toca em `dominio_proprio` — só solta da Vercel.

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
  if (!dominio) return NextResponse.json({ erro: 'Domínio inválido' }, { status: 400 })

  if (vercelConfigurado()) {
    try {
      await removerDominio(dominio)
    } catch (e) {
      console.error('[loja-admin] dominio/remover falhou na Vercel', { dominio, erro: e instanceof Error ? e.message : e })
      // Segue para limpar o banco mesmo assim — o pior caso é o domínio
      // continuar anexado ao projeto na Vercel sem servir a loja nenhuma,
      // o que não expõe nada.
    }
  }

  const { data: atual } = await ctx.sb
    .from('loja_config').select('dominio_proprio').eq('id', corpo.lojaId).single()

  if (atual?.dominio_proprio === dominio) {
    await ctx.sb.from('loja_config').update({ dominio_proprio: null }).eq('id', corpo.lojaId)
    invalidarVitrine(corpo.lojaId)
  }

  return NextResponse.json({ ok: true })
}
