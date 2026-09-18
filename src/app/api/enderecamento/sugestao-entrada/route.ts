import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { buscarSugestoesEndereco } from '@/lib/enderecamento/estoque'

export const dynamic = 'force-dynamic'

// Chamado ao finalizar uma entrada — sugere, pra cada produto recebido, o
// endereço onde ele já mora no depósito (ver ConfirmarEnderecoEntradaModal).

type Corpo = { depositoId?: string; produtoIds?: string[] }

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const { depositoId, produtoIds } = body
  if (!depositoId || !produtoIds?.length) {
    return NextResponse.json({ ok: false, erro: 'Depósito e produtos são obrigatórios.' }, { status: 400 })
  }

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const sugestoes = await buscarSugestoesEndereco(sb, depositoId, produtoIds)
  return NextResponse.json({ ok: true, sugestoes: Object.fromEntries(sugestoes) })
}
