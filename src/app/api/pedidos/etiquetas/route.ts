import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { buscarEtiquetaDoPedido } from '@/lib/etiquetas/buscar'
import { montarFolha, type FormatoEtiqueta, type PedidoNaFolha } from '@/lib/etiquetas/folha'
import { registrarImpressao } from '@/lib/pedidos/impressao'
import { numeroInterno } from '@/lib/pedidos/envio'

// IMPRESSÃO DE ETIQUETAS EM LOTE.
//
// Para cada pedido escolhido: baixa a etiqueta que o marketplace já liberou
// (src/lib/etiquetas/buscar.ts), monta UM PDF só no formato escolhido
// (src/lib/etiquetas/folha.ts), guarda no bucket privado e devolve um link
// de curta duração. Os pedidos que entraram no PDF passam a "etiqueta
// impressa" (→ 4. Aguardando postagem); os que não entraram voltam com o
// motivo dado pelo canal — nenhum some calado.

export const maxDuration = 300

const LIMITE = 60

type Ordem = 'sku' | 'prazo' | 'canal'

const COLUNAS = [
  'id, empresa_id, canal_id, id_externo, numero_pedido, numero_interno, cliente_nome, entrega_cidade, entrega_estado',
  'prazo_postagem, nfe_numero, observacoes, dados_brutos',
  'marketplace_pedido_itens(nome_produto, sku, quantidade, produtos(nome, sku))',
  'marketplace_canais(id, nome, plataforma, empresa_id, seller_id, shop_cipher, access_token, refresh_token, token_expira_em)',
].join(', ')

function dataCurta(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

export async function POST(req: Request) {
  const { ids, formato = 'paisagem', ordem = 'sku' } = await req.json() as { ids: string[]; formato?: FormatoEtiqueta; ordem?: Ordem }
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ ok: false, erro: 'Nenhum pedido selecionado' }, { status: 400 })
  if (ids.length > LIMITE) return NextResponse.json({ ok: false, erro: `Máximo de ${LIMITE} etiquetas por vez.` }, { status: 400 })
  if (formato !== 'original' && formato !== 'paisagem') return NextResponse.json({ ok: false, erro: 'Formato inválido' }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Filtro de empresa: ninguém imprime etiqueta de pedido de outra conta
  // passando um id na mão.
  const { data: pedidos, error } = await sb.from('marketplace_pedidos').select(COLUNAS)
    .in('id', ids).eq('empresa_id', guarda.empresaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const chaveOrdem = (p: any): string => {
    const it = p.marketplace_pedido_itens?.[0]
    if (ordem === 'prazo') return p.prazo_postagem ?? '9999'
    if (ordem === 'canal') return `${p.marketplace_canais?.nome ?? ''}|${p.prazo_postagem ?? ''}`
    // Por produto: pedidos do mesmo item saem juntos — separa-se uma vez.
    return `${it?.produtos?.sku ?? it?.sku ?? '~'}|${it?.produtos?.nome ?? it?.nome_produto ?? ''}`
  }
  const ordenados = [...(pedidos ?? [])].sort((a: any, b: any) => chaveOrdem(a).localeCompare(chaveOrdem(b), 'pt-BR'))

  const etiquetas: { pdf: Uint8Array; pedido: PedidoNaFolha; id: string; paginas: 'primeira' | 'todas' }[] = []
  const falhas: { id: string; pv: string; erro: string }[] = []
  for (const p of ordenados as any[]) {
    const pv = numeroInterno(p) ?? p.numero_pedido ?? p.id_externo
    try {
      const pdf = await buscarEtiquetaDoPedido(sb, p.marketplace_canais, p)
      etiquetas.push({
        id: p.id, pdf,
        // ML: a 2ª página é a lista de conteúdo do despacho — o mini pedido
        // já faz esse papel, e ela viraria uma "etiqueta" a mais.
        paginas: p.marketplace_canais?.plataforma === 'mercadolivre' ? 'primeira' : 'todas',
        pedido: {
          pv,
          canal: p.marketplace_canais?.nome ?? '',
          numeroMarketplace: p.numero_pedido ?? p.id_externo,
          comprador: /^\*+$/.test(String(p.cliente_nome ?? '').trim()) ? '' : (p.cliente_nome ?? ''),
          cidade: [p.entrega_cidade, p.entrega_estado].filter(c => c && !/^\*+$/.test(String(c))).join(', '),
          prazo: dataCurta(p.prazo_postagem),
          nf: p.nfe_numero ? `NF-e ${p.nfe_numero}` : null,
          observacao: p.observacoes ?? null,
          itens: (p.marketplace_pedido_itens ?? []).map((i: any) => ({
            nome: i.produtos?.nome ?? i.nome_produto ?? '', sku: i.produtos?.sku ?? i.sku ?? null, quantidade: Number(i.quantidade ?? 1),
          })),
        },
      })
    } catch (e: any) {
      falhas.push({ id: p.id, pv, erro: e?.message ?? 'Falha ao buscar a etiqueta' })
    }
  }
  for (const id of ids) {
    if (!(pedidos ?? []).some((p: any) => p.id === id)) falhas.push({ id, pv: '—', erro: 'Pedido não encontrado' })
  }

  if (etiquetas.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma etiqueta pôde ser obtida.', falhas }, { status: 400 })
  }

  let pdf: Uint8Array
  try {
    const montado = await montarFolha(etiquetas, formato)
    pdf = montado.pdf
    // Etiqueta que o canal mandou mas não abriu: sai do lote com o motivo.
    for (const f of montado.falhas.sort((a, b) => b.indice - a.indice)) {
      const [fora] = etiquetas.splice(f.indice, 1)
      falhas.push({ id: fora.id, pv: fora.pedido.pv, erro: f.erro })
    }
  } catch (e: any) {
    console.error('[etiquetas] montagem', e?.message ?? e)
    return NextResponse.json({ ok: false, erro: `Falha ao montar o PDF: ${e?.message ?? e}`, falhas }, { status: 500 })
  }
  if (etiquetas.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma etiqueta pôde ser montada.', falhas }, { status: 400 })
  }

  // O arquivo é guardado e assinado PELO SERVIDOR: o bucket é privado e não
  // tem regra de acesso para o navegador — a etiqueta carrega nome e
  // endereço do comprador, e o único caminho até ela é o link curto abaixo.
  const admin = createAdminClient()
  const caminho = `lotes/${guarda.empresaId}/${Date.now()}-${formato}.pdf`
  const { error: erroUpload } = await admin.storage.from('etiquetas-envio').upload(caminho, pdf, { contentType: 'application/pdf', upsert: true })
  if (erroUpload) {
    console.error('[etiquetas] upload', erroUpload.message)
    return NextResponse.json({ ok: false, erro: `Falha ao guardar o PDF: ${erroUpload.message}`, falhas }, { status: 500 })
  }
  const { data: link, error: erroLink } = await admin.storage.from('etiquetas-envio').createSignedUrl(caminho, 900)
  if (erroLink || !link?.signedUrl) return NextResponse.json({ ok: false, erro: erroLink?.message ?? 'Falha ao gerar o link', falhas }, { status: 500 })

  const { data: perfil } = await sb.from('profiles').select('nome').eq('id', guarda.userId).maybeSingle()
  try {
    await registrarImpressao(sb, {
      empresaId: guarda.empresaId, ids: etiquetas.map(e => e.id), impresso: true,
      usuarioId: guarda.userId, usuarioNome: perfil?.nome ?? null,
      origem: `Impressão de etiquetas em lote (${formato === 'paisagem' ? 'paisagem com mini pedido' : 'original'})`,
    })
  } catch { /* o PDF saiu; a marcação pode ser feita à mão na lista */ }

  return NextResponse.json({ ok: true, url: link.signedUrl, impressos: etiquetas.map(e => e.id), falhas })
}
