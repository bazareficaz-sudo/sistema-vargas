import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { registrarImpressao } from '@/lib/pedidos/impressao'

// Marca (ou desmarca) a etiqueta de vários pedidos de marketplace como
// impressa — o passo 3 → 4 da esteira. Ver src/lib/pedidos/impressao.ts.

const LIMITE = 300

export async function POST(req: Request) {
  const { ids, impresso } = await req.json() as { ids: string[]; impresso: boolean }
  if (!Array.isArray(ids) || ids.length === 0 || typeof impresso !== 'boolean') {
    return NextResponse.json({ ok: false, erro: 'Pedidos inválidos' }, { status: 400 })
  }
  if (ids.length > LIMITE) {
    return NextResponse.json({ ok: false, erro: `Máximo de ${LIMITE} pedidos por vez.` }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: perfil } = await sb.from('profiles').select('nome').eq('id', guarda.userId).maybeSingle()

  try {
    const { alterados } = await registrarImpressao(sb, {
      empresaId: guarda.empresaId, ids, impresso,
      usuarioId: guarda.userId, usuarioNome: perfil?.nome ?? null,
      origem: 'Marcado na esteira de pedidos',
    })
    return NextResponse.json({ ok: true, alterados })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao registrar impressão' }, { status: 500 })
  }
}
