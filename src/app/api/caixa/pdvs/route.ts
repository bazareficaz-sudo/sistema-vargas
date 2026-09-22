import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { contextoCaixa } from '@/lib/caixa/contextoCaixa'
import { listarCaixasPdv } from '@/lib/caixa/caixaPdvServidor'

// Os caixas de PDV da empresa ativa — o que a tela de sangria oferece como
// origem.
//
// Lista TERMINAIS, com o caixa de cada um quando já existe. Terminal sem
// caixa vem com `caixa_id: null`: a gaveta só passa a existir como caixa na
// primeira operação. Ver `caixaPdvServidor.ts`.
//
// A empresa vem de `contextoCaixa`, nunca da query.

export const dynamic = 'force-dynamic'

export async function GET() {
  const sb = await createClient()
  const guarda = await contextoCaixa(sb)
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const caixas = await listarCaixasPdv(sb, guarda.empresaId)
  return NextResponse.json({ ok: true, caixas })
}
