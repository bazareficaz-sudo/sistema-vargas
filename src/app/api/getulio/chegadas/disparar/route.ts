import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { lerConfigChegadas, processarChegada, REFERENCIAS_NOTA, type ReferenciaNota } from '@/lib/getulio/chegadas'

// Chamada pela tela que finaliza a nota (manual ou XML), logo depois de
// gravar tudo: é o que faz o boletim sair "logo após cada nota".
//
// Quem lança nota não precisa ser administrador — a permissão é a de
// entradas. O envio usa o cliente de serviço porque a credencial do
// WhatsApp não é legível por todo usuário; a nota é conferida contra a
// empresa da sessão antes.
export const maxDuration = 60

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_compras')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({}))
  const tipo = String(body.referencia_tipo ?? '') as ReferenciaNota
  const id = String(body.referencia_id ?? '')
  if (!REFERENCIAS_NOTA.includes(tipo) || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, erro: 'Nota inválida' }, { status: 400 })
  }

  const admin = createAdminClient()
  const cfg = await lerConfigChegadas(admin, guarda.empresaId)
  if (!cfg.ativo) return NextResponse.json({ ok: true, status: 'desligado' })

  const { count } = await admin.from('estoque_movimentacoes').select('id', { count: 'exact', head: true })
    .eq('empresa_id', guarda.empresaId).eq('referencia_tipo', tipo).eq('referencia_id', id)
  if (!count) return NextResponse.json({ ok: true, status: 'sem_entrada' })

  const r = await processarChegada(admin, cfg, tipo, id)
  return NextResponse.json(r)
}
