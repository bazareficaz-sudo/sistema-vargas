import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { requisitoDe } from '@/lib/imagens/requisitos'

// Ajusta uma imagem para atender o mínimo do marketplace.
//
// Feito no servidor, com sharp, e não no navegador: desenhar imagem de outro
// domínio num canvas "contamina" o canvas e o navegador proíbe exportar o
// resultado. Aqui o servidor baixa e processa sem essa restrição, o que
// também faz funcionar para imagem adicionada por URL externa.
//
// O ajuste é enquadrar em um quadrado com fundo branco, sem cortar nada
// (`fit: contain`). Fundo branco é o que os dois marketplaces pedem, e não
// cortar preserva o produto inteiro.
//
// Uma ressalva honesta que a tela também mostra: ampliar uma foto pequena
// atende a exigência de tamanho, mas não cria detalhe que não existe no
// original. Foto de 200px ampliada para 1024 fica borrada — a saída certa é
// tirar/obter a foto maior.

export const maxDuration = 60

const TAMANHO_MAXIMO_BYTES = 15 * 1024 * 1024

export async function POST(req: Request) {
  const { url, produtoId, plataforma, imagemId } = await req.json() as {
    url: string; produtoId: string; plataforma?: string; imagemId?: string
  }
  if (!url || !produtoId) {
    return NextResponse.json({ ok: false, erro: 'Imagem ou produto não informado' }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: produto } = await sb.from('produtos')
    .select('id').eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  const alvo = requisitoDe(plataforma ?? 'shopee').alvoAjuste

  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`não foi possível baixar a imagem (HTTP ${resp.status})`)
    const buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.byteLength > TAMANHO_MAXIMO_BYTES) throw new Error('imagem grande demais para processar')

    const original = await sharp(buffer).metadata()

    const ajustada = await sharp(buffer)
      .resize(alvo, alvo, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        withoutEnlargement: false,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } }) // PNG transparente vira fundo branco
      .jpeg({ quality: 90 })
      .toBuffer()

    const caminho = `${guarda.empresaId}/${produtoId}/ajustada-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
    const { error: erroUpload } = await sb.storage.from('produto-imagens')
      .upload(caminho, ajustada, { contentType: 'image/jpeg', upsert: false })
    if (erroUpload) throw new Error(erroUpload.message)

    const { data: pub } = sb.storage.from('produto-imagens').getPublicUrl(caminho)
    const novaUrl = pub.publicUrl

    // Se a imagem já estava no cadastro, troca a URL na própria linha —
    // assim o ajuste vale para todos os anúncios daquele produto, não só
    // para o que está sendo criado agora.
    if (imagemId) {
      await sb.from('produto_imagens').update({ url: novaUrl }).eq('id', imagemId).eq('produto_id', produtoId)
      const { data: img } = await sb.from('produto_imagens')
        .select('principal').eq('id', imagemId).maybeSingle()
      if (img?.principal) await sb.from('produtos').update({ foto_url: novaUrl }).eq('id', produtoId)
    }

    return NextResponse.json({
      ok: true,
      url: novaUrl,
      antes: { largura: original.width ?? 0, altura: original.height ?? 0 },
      depois: { largura: alvo, altura: alvo },
      ampliou: (Math.min(original.width ?? 0, original.height ?? 0) || 0) < alvo,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao ajustar a imagem' }, { status: 400 })
  }
}
