import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { ehPolitica, POLITICA_PADRAO } from '@/lib/entradas/politicaPreco'

export const dynamic = 'force-dynamic'

// A política de preço é REGRA DA EMPRESA, não preferência de quem está
// lançando a nota. Guardá-la no navegador faria com que dois compradores da
// mesma loja aplicassem regras diferentes na mesma semana sem nunca saber —
// e é justamente o tipo de divergência que só aparece três meses depois, na
// margem.
//
// Ler exige ver custo/margem (a escolha só faz sentido para quem enxerga o
// número que ela move). Gravar exige mexer em preço, que é a consequência.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'ver_custos_margens')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data } = await sb.from('empresa_config_comercial')
    .select('politica_preco_custo_mudou').eq('empresa_id', guarda.empresaId).maybeSingle()

  // Empresa sem linha de config, ou banco ainda sem a coluna (a migração
  // deste recurso não rodou), respondem a mesma coisa: o padrão histórico.
  // A tela não pode ficar sem resposta por causa disso.
  const valor = (data as { politica_preco_custo_mudou?: string } | null)?.politica_preco_custo_mudou
  return NextResponse.json({ ok: true, politica: ehPolitica(valor) ? valor : POLITICA_PADRAO })
}

export async function PATCH(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'editar_precos')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as { politica?: string }
  if (!ehPolitica(body.politica)) {
    return NextResponse.json({ ok: false, erro: 'Política inválida.' }, { status: 400 })
  }

  const { error } = await sb.from('empresa_config_comercial')
    .upsert({ empresa_id: guarda.empresaId, politica_preco_custo_mudou: body.politica, updated_at: new Date().toISOString() },
      { onConflict: 'empresa_id' })

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, politica: body.politica })
}
