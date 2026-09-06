import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { FORMAS_PAGAMENTO_VALIDAS } from '@/lib/pdv/formasPagamento'

// Configuração do PDV por empresa. Leitura para qualquer sessão da empresa
// (o PDV precisa dela para precificar), escrita só para quem administra
// configurações.

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  if (!profile?.empresa_id) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 403 })

  const { data } = await sb
    .from('empresa_config_pdv')
    .select('promocao_exige_forma, promocao_formas')
    .eq('empresa_id', profile.empresa_id)
    .maybeSingle()

  // Sem linha = empresa criada antes desta configuração existir. O padrão
  // desligado é o comportamento antigo, byte a byte.
  return NextResponse.json({
    ok: true,
    config: {
      exigirFormaPagamento: !!data?.promocao_exige_forma,
      formasPermitidas: (data?.promocao_formas ?? []) as string[],
    },
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const exigir = !!body.exigirFormaPagamento
  // Só formas que o PDV realmente oferece. Um valor inventado aqui viraria uma
  // condição que nenhuma venda cumpre, e o desconto sumiria sem explicação.
  const formas = Array.isArray(body.formasPermitidas)
    ? [...new Set(body.formasPermitidas.filter((f: unknown) =>
        typeof f === 'string' && FORMAS_PAGAMENTO_VALIDAS.includes(f)))] as string[]
    : []

  // A RECUSA QUE IMPORTA: ligar a exigência sem escolher forma nenhuma é
  // configuração pela metade. O código do PDV trata isso como "sem restrição"
  // para não tirar desconto em silêncio, mas deixar salvar assim produziria
  // uma tela que promete uma regra que não está valendo.
  if (exigir && formas.length === 0) {
    return NextResponse.json({
      ok: false,
      erro: 'Escolha pelo menos uma forma de pagamento que dá direito ao preço promocional.',
    }, { status: 400 })
  }

  const { error } = await sb.from('empresa_config_pdv').upsert({
    empresa_id: guarda.empresaId,
    promocao_exige_forma: exigir,
    promocao_formas: formas,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'empresa_id' })

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    config: { exigirFormaPagamento: exigir, formasPermitidas: formas },
  })
}
