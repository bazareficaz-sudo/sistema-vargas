import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { gerarComprovanteVendaPdfBuffer } from '@/lib/vendas/comprovantePdf'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: vendaId } = await params

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: venda } = await sb.from('vendas').select('*').eq('id', vendaId).eq('empresa_id', empresaId).single()
  if (!venda) return NextResponse.json({ ok: false, erro: 'Venda não encontrada' }, { status: 404 })

  const { data: itens } = await sb.from('venda_itens').select('*').eq('venda_id', vendaId)

  let cliente = null as { nome: string; cpf_cnpj: string | null; telefone: string | null } | null
  if (venda.cliente_id) {
    const { data: cli } = await sb.from('clientes').select('nome, cpf_cnpj, telefone').eq('id', venda.cliente_id).single()
    cliente = cli ?? null
  }

  const { data: empresa } = await sb.from('empresas')
    .select('nome, cnpj, telefone, logradouro, numero, bairro, cidade, uf')
    .eq('id', empresaId).single()
  if (!empresa) return NextResponse.json({ ok: false, erro: 'Empresa não encontrada' }, { status: 400 })

  const buffer = await gerarComprovanteVendaPdfBuffer({
    empresa,
    cliente,
    venda,
    itens: itens ?? [],
  })

  const path = `${empresaId}/${vendaId}.pdf`
  const { error: uploadError } = await sb.storage.from('comprovantes-venda')
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
  if (uploadError) return NextResponse.json({ ok: false, erro: uploadError.message }, { status: 500 })

  const { data: signed, error: signError } = await sb.storage.from('comprovantes-venda').createSignedUrl(path, 600)
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ ok: false, erro: signError?.message ?? 'Falha ao gerar link do PDF' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, url: signed.signedUrl })
}
