import { createClient } from '@/lib/supabase/server'
import PedidosEcommerceClient from '@/components/marketplaces/PedidosEcommerceClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Colunas da listagem. Sem `dados_brutos` (o JSON inteiro do canal, pesado
// demais para centenas de linhas): da TikTok só interessa se ainda falta a
// nota, e isso vem extraído no próprio select.
const COLUNAS = [
  'id, canal_id, id_externo, numero_pedido, cliente_nome, cliente_email, cliente_doc',
  'entrega_cep, entrega_logradouro, entrega_numero, entrega_bairro, entrega_cidade, entrega_estado',
  'valor_produtos, valor_frete, valor_desconto, valor_total, status, status_externo, etapa_interna',
  'pendencia_motivo, prazo_postagem, data_pedido, data_envio, transportadora, codigo_rastreio, observacoes',
  'nfe_numero, nfe_chave, nfe_informada_em, venda_id',
  'envio_status, envio_substatus, etiqueta_impressa_em, etiqueta_impressa_por',
  'etiqueta_arquivo, etiqueta_baixada_em, etiqueta_erro',
  'need_upload_invoice:dados_brutos->>need_upload_invoice',
  // Número interno e meio de envio/rastreio (ver src/lib/pedidos/envio.ts):
  // extraídos aqui para a listagem não trazer o JSON inteiro de cada pedido.
  'numero_interno, data_pagamento, created_at',
  'envio_logistica:envio_dados->shipment->logistic->>type, envio_rastreio_ml:envio_dados->shipment->>tracking_number',
  'tt_transportadora:dados_brutos->>shipping_provider, tt_opcao_entrega:dados_brutos->>delivery_option_name, tt_rastreio:dados_brutos->>tracking_number',
  'sh_transportadora:dados_brutos->package_list->0->>shipping_carrier',
  'marketplace_pedido_itens(*, produtos(nome, sku), marketplace_anuncios(imagens, id_externo, titulo))',
  'marketplace_pedido_pacotes(*)',
  'marketplace_canais(id, nome, plataforma)',
].join(', ')

// Pedido que já saiu, chegou ou foi cancelado. Os abertos são todos
// carregados (é o trabalho do dia); do histórico, só os mais recentes.
const FINALIZADOS_STATUS = '(enviado,entregue,cancelado,devolvido)'
const FINALIZADOS_ETAPA = '(concluido,cancelado,enviado)'
const JANELA_ABERTOS_DIAS = 45
const LIMITE_ABERTOS = 1000
const LIMITE_HISTORICO = 150

export default async function PedidosEcommercePage({ searchParams }: {
  searchParams: Promise<{ q?: string; canalId?: string }>
}) {
  const { q = '', canalId = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: canais } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  // Empresa que debita estoque e empresa que emite fiscal — config da
  // conta (Empresas → Estoque/Fiscal), mesma resolução usada no PDV web.
  // Igual pra toda linha da listagem hoje (não existe override por canal).
  const [{ data: configEstoque }, { data: configFiscal }] = await Promise.all([
    supabase.from('empresa_config_estoque').select('empresa_estoque_id').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresa_config_fiscal').select('empresa_fiscal_id').eq('empresa_id', empresaId).maybeSingle(),
  ])
  const empresaEstoqueId = configEstoque?.empresa_estoque_id || empresaId
  const empresaFiscalId = configFiscal?.empresa_fiscal_id || empresaId
  // Cada canal pode ter sua própria empresa emissora (Configurar → canal);
  // sem escolha, vale a da conta.
  const emissorIdPorCanal = new Map((canais ?? []).map(c => [c.id, (c.empresa_fiscal_id as string | null) || empresaFiscalId]))
  const idsParaNome = [...new Set([empresaEstoqueId, empresaFiscalId, ...emissorIdPorCanal.values()])]
  const { data: empresasNomes } = await supabase.from('empresas').select('id, nome, nome_fantasia').in('id', idsParaNome)
  const nomePorId = new Map((empresasNomes ?? []).map(e => [e.id, e.nome_fantasia ?? e.nome]))
  const empresaEstoqueNome = nomePorId.get(empresaEstoqueId) ?? ''
  const empresaFiscalNome = nomePorId.get(empresaFiscalId) ?? ''
  const emissorPorCanal: Record<string, string> = Object.fromEntries(
    [...emissorIdPorCanal].map(([canalId, id]) => [canalId, nomePorId.get(id) ?? '']))

  const filtrar = (query: any) => {
    let r = query.eq('empresa_id', empresaId)
    if (canalId) r = r.eq('canal_id', canalId)
    if (q) r = r.or(`cliente_nome.ilike.%${q}%,numero_pedido.ilike.%${q}%,id_externo.ilike.%${q}%`)
    return r
  }

  // Antes era um único .limit(200) do mais novo para o mais velho: numa
  // semana cheia o histórico empurrava para fora da lista justamente pedido
  // que ainda não tinha saído. Agora abertos e histórico são consultas
  // separadas.
  const desde = new Date(Date.now() - JANELA_ABERTOS_DIAS * 86_400_000).toISOString()
  const [{ data: abertos }, { data: historico }, { count: totalReal }] = await Promise.all([
    filtrar(supabase.from('marketplace_pedidos').select(COLUNAS))
      .not('status', 'in', FINALIZADOS_STATUS)
      // etapa_interna nula (pedido lançado à mão) conta como aberto — o
      // `not in` sozinho descartaria o nulo.
      .or(`etapa_interna.is.null,etapa_interna.not.in.${FINALIZADOS_ETAPA}`)
      .gte('data_pedido', desde)
      .order('data_pedido', { ascending: false })
      .limit(LIMITE_ABERTOS),
    filtrar(supabase.from('marketplace_pedidos').select(COLUNAS))
      .or(`status.in.${FINALIZADOS_STATUS},etapa_interna.in.${FINALIZADOS_ETAPA}`)
      .order('data_pedido', { ascending: false })
      .limit(LIMITE_HISTORICO),
    filtrar(supabase.from('marketplace_pedidos').select('id', { count: 'exact', head: true })),
  ])

  const pedidos = [...(abertos ?? []), ...(historico ?? [])]

  return (
    <PedidosEcommerceClient
      canais={canais ?? []}
      pedidos={pedidos}
      totalReal={totalReal ?? pedidos.length}
      empresaId={empresaId}
      empresaEstoqueNome={empresaEstoqueNome}
      empresaFiscalNome={empresaFiscalNome}
      emissorPorCanal={emissorPorCanal}
      qInicial={q}
      canalIdInicial={canalId}
      operador={user?.email ?? ''}
    />
  )
}
