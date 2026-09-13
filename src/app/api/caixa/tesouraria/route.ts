import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { buscarOuCriarTesouraria } from '@/lib/caixa/tesourariaServidor'
import { calcularSaldo } from '@/lib/caixa/movimento'

// Saldo do Caixa da Empresa — sempre calculado somando o ledger, nunca lido
// de uma coluna. `movimentos` só traz tipo/valor porque é só disso que o
// saldo precisa; o extrato completo vive em /movimentos.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_financeiro')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const caixa = await buscarOuCriarTesouraria(sb, guarda.empresaId, guarda.userId)

  const { data: movimentos, error } = await sb.from('caixa_movimento')
    .select('tipo, valor').eq('caixa_id', caixa.id)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, caixa, saldo: calcularSaldo(movimentos ?? []) })
}
