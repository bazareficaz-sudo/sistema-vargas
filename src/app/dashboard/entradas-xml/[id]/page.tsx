import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import EntradaXmlDetalheClient from '@/components/entradas-xml/EntradaXmlDetalheClient'
import { podeAcessarModulo } from '@/lib/plans/access'

export const dynamic = 'force-dynamic'

export default async function EntradaXmlDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  // Planos restritos (ex.: "Consulta Fiscal") têm o módulo entradas_xml sem o
  // módulo entradas completo — nesse caso a tela abre em modo só-leitura.
  const somenteLeitura = !(await podeAcessarModulo('entradas', empresaId, user.id))

  const [entradaRes, itensRes, dupRes, depositosRes, produtosRes, fornecedoresRes, configComercialRes] = await Promise.all([
    sb.from('nfe_entradas').select('*').eq('id', id).eq('empresa_id', empresaId).single(),
    sb.from('nfe_itens').select('*').eq('entrada_id', id).order('num_item'),
    sb.from('nfe_duplicatas').select('*').eq('entrada_id', id).order('data_vencimento'),
    sb.from('depositos').select('id, nome, principal').eq('empresa_id', empresaId).eq('ativo', true).order('principal', { ascending: false }),
    sb.from('produtos')
      .select('id, nome, sku, ean, estoque, unidade, preco_venda, preco_custo, marca, categoria')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .order('nome')
      .limit(2000),
    sb.from('fornecedores').select('id, nome, cnpj').eq('empresa_id', empresaId).order('nome'),
    // Limite de aumento de custo que destaca a linha na revisão de preços.
    // maybeSingle: empresa sem linha de config cai no padrão de 5%.
    sb.from('empresa_config_comercial')
      .select('alerta_aumento_custo_ativo, alerta_aumento_custo_pct')
      .eq('empresa_id', empresaId).maybeSingle(),
  ])

  if (!entradaRes.data) notFound()

  return (
    <EntradaXmlDetalheClient
      entrada={entradaRes.data}
      itensIniciais={itensRes.data ?? []}
      duplicatasIniciais={dupRes.data ?? []}
      depositos={depositosRes.data ?? []}
      produtos={produtosRes.data ?? []}
      fornecedores={fornecedoresRes.data ?? []}
      empresaId={empresaId}
      operador={user.email ?? ''}
      somenteLeitura={somenteLeitura}
      alertaCustoAtivo={configComercialRes.data?.alerta_aumento_custo_ativo ?? true}
      alertaCustoPct={Number(configComercialRes.data?.alerta_aumento_custo_pct ?? 5)}
    />
  )
}
