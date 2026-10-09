// FOTO DE PRODUTO PELO WHATSAPP.
//
// No balcão, com o celular: tira a foto, manda para o número da empresa com
// o SKU (ou o nome) na legenda, e o Getúlio põe no cadastro. Medido em
// 08/10/2026: 667 produtos com estoque sem foto, ~500 sem foto em lugar
// nenhum — só fotografando, e abrir o sistema para cada um não acontece.
//
// O produto é achado pela mesma busca de balcão das perguntas: SKU exato, ou
// palavras. Achou mais de um, pergunta qual (com os SKUs); não grava no
// chute. A foto é baixada da Z-API (o link dela expira) e guardada no
// bucket do sistema.

import { buscarProdutoInteligente } from '@/lib/busca/produtoInteligente'
import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'

const MAX_BYTES = 12 * 1024 * 1024

/** SKU na legenda: só dígitos (com ou sem "sku"/"#"). */
export function skuDaLegenda(legenda: string): string | null {
  const m = String(legenda ?? '').trim().match(/^(?:sku\s*[:#-]?\s*|#\s*)?(\d{2,10})$/i)
  return m ? m[1] : null
}

type Achado = { id: string; nome: string; sku: string | null }

async function acharProduto(sb: any, empresaId: string, legenda: string): Promise<{ produto: Achado | null; opcoes: Achado[] }> {
  const sku = skuDaLegenda(legenda)
  if (sku) {
    const { data } = await sb.from('produtos').select('id, nome, sku').eq('empresa_id', empresaId).eq('sku', sku).limit(2)
    if (data?.length === 1) return { produto: data[0], opcoes: [] }
    return { produto: null, opcoes: data ?? [] }
  }
  const r = await buscarProdutoInteligente(sb, empresaId, legenda, 10)
  const ativos = r.exatos.filter(p => p.ativo)
  const lista = ativos.length ? ativos : r.exatos
  if (lista.length === 1) return { produto: lista[0], opcoes: [] }
  return { produto: null, opcoes: (lista.length ? lista : r.parecidos).slice(0, 5) }
}

export async function receberFotoProduto(
  sb: any, empresaId: string, numero: string, imagemUrl: string, legendaBruta: string,
): Promise<void> {
  const numeroLimpo = String(numero).replace(/\D/g, '')
  const legenda = String(legendaBruta ?? '').trim().slice(0, 200)
  await sb.from('getulio_conversas').insert({
    empresa_id: empresaId, numero: numeroLimpo, papel: 'dono', texto: `📷 [foto]${legenda ? ` ${legenda}` : ''}`,
  })
  const responder = async (texto: string, erro?: string) => {
    await enviarWhatsappAutomacao(sb, empresaId, numeroLimpo, texto, { tipo: 'getulio_resposta', referencia_tipo: 'getulio' })
    await sb.from('getulio_conversas').insert({ empresa_id: empresaId, numero: numeroLimpo, papel: 'getulio', texto, erro: erro ?? null })
  }

  if (!legenda) {
    await responder('Recebi a foto 📷 — mas de qual produto? Manda de novo com o *SKU* (ou o nome) na legenda, que eu ponho no cadastro.')
    return
  }

  const { produto, opcoes } = await acharProduto(sb, empresaId, legenda)
  if (!produto) {
    if (opcoes.length) {
      await responder(`Achei mais de um produto para "${legenda}":\n${opcoes.map(o => `• ${o.nome} — SKU ${o.sku ?? '?'}`).join('\n')}\n\nManda a foto de novo com o *SKU* na legenda.`)
    } else {
      await responder(`Não achei produto com "${legenda}". Manda a foto de novo com o *SKU* na legenda.`)
    }
    return
  }

  try {
    const res = await fetch(imagemUrl)
    if (!res.ok) throw new Error(`não consegui baixar a foto (${res.status})`)
    const tipo = res.headers.get('content-type') ?? 'image/jpeg'
    if (!tipo.startsWith('image/')) throw new Error('o arquivo não é uma imagem')
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) throw new Error('a foto passa de 12 MB')
    const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg'
    const caminho = `${empresaId}/${produto.id}/${Date.now()}-whatsapp.${ext}`
    const { error: erroUp } = await sb.storage.from('produto-imagens').upload(caminho, bytes, { contentType: tipo, upsert: false })
    if (erroUp) throw new Error(erroUp.message)
    const { data: pub } = sb.storage.from('produto-imagens').getPublicUrl(caminho)

    const { count } = await sb.from('produto_imagens').select('id', { count: 'exact', head: true }).eq('produto_id', produto.id)
    const { error: erroIns } = await sb.from('produto_imagens').insert({
      empresa_id: empresaId, produto_id: produto.id, url: pub.publicUrl, ordem: count ?? 0, principal: (count ?? 0) === 0,
    })
    if (erroIns) throw new Error(erroIns.message)
    const total = (count ?? 0) + 1
    await responder(`✅ Foto adicionada em *${produto.nome}* (SKU ${produto.sku ?? '?'}). Agora ele tem ${total} foto${total > 1 ? 's' : ''}.${total < 3 ? ' Os marketplaces vendem melhor com 3 ou mais.' : ''}`)
  } catch (e: any) {
    await responder(`Não consegui salvar a foto de *${produto.nome}*: ${e?.message ?? 'erro'}. Tenta mandar de novo.`, e?.message ?? String(e))
  }
}
