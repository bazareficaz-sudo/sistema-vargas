import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// Usa as fotos de um produto "irmão" (mesma família, ex.: o kit com 3 peças
// para o de 2 peças). Sempre a pedido — o irmão às vezes é de outra cor
// ("GUEPARCOLOR CROMADO" sugeria a foto do DOURADO), então quem aprova é a
// pessoa, vendo a miniatura na tela.
export async function POST(req: Request) {
  const { itens } = await req.json().catch(() => ({})) as { itens?: { destino: string; origem: string }[] }
  if (!Array.isArray(itens) || itens.length === 0) return NextResponse.json({ ok: false, erro: 'Nada para copiar' }, { status: 400 })
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'editar_produtos')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  let produtos = 0
  let fotos = 0
  const falhas: string[] = []
  for (const it of itens.slice(0, 200)) {
    if (typeof it?.destino !== 'string' || typeof it?.origem !== 'string') continue
    const { data, error } = await sb.rpc('copiar_fotos_irmao', { p_empresa: guarda.empresaId, p_destino: it.destino, p_origem: it.origem })
    if (error) { falhas.push(error.message); continue }
    if (Number(data) > 0) { produtos++; fotos += Number(data) }
  }
  return NextResponse.json({ ok: falhas.length === 0, produtos, fotos, falhas })
}
