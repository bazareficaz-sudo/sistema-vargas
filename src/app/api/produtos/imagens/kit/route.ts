import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { MAX_COMPONENTES, montarImagemKit, type ParteDaMontagem } from '@/lib/imagens/montagemKit'

// Imagem do kit montada com as fotos dos componentes (ver montagemKit.ts).
//
// A composição vem da tela, não de kit_itens: quem está editando o kit pode
// ter acabado de trocar um componente sem salvar, e a imagem tem de mostrar
// o que ele está vendo. Os produtos são conferidos contra a empresa aqui.
//
// `salvar: false` devolve só a prévia; `salvar: true` grava a imagem como a
// foto principal do kit (primeira da lista), mantendo as outras.
//
// As fotos baixadas são as do cadastro dos componentes (produto_imagens),
// nunca um endereço vindo da requisição.

export const maxDuration = 60

const TAMANHO_MAXIMO_BYTES = 15 * 1024 * 1024
const TIMEOUT_MS = 15_000

type Corpo = {
  kitId?: string
  componentes?: { produtoId: string; quantidade: number; imagemId?: string | null }[]
  selo?: boolean
  salvar?: boolean
}

type Img = { id: string; produto_id: string; url: string; ordem: number | null; principal: boolean | null }

async function baixar(url: string): Promise<Buffer> {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SistemaVargas/1.0)' },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const buffer = Buffer.from(await resp.arrayBuffer())
  if (buffer.byteLength > TAMANHO_MAXIMO_BYTES) throw new Error('imagem grande demais')
  return buffer
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'editar_produtos')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const componentes = (body.componentes ?? []).filter(c => c?.produtoId)
  if (!body.kitId || componentes.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Informe o kit e os componentes.' }, { status: 400 })
  }

  const { data: kit } = await sb.from('produtos').select('id')
    .eq('id', body.kitId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!kit) return NextResponse.json({ ok: false, erro: 'Kit não encontrado.' }, { status: 404 })

  const ids = [...new Set(componentes.map(c => c.produtoId))]
  const [{ data: produtos }, { data: imagens }] = await Promise.all([
    sb.from('produtos').select('id, nome').eq('empresa_id', guarda.empresaId).in('id', ids),
    sb.from('produto_imagens').select('id, produto_id, url, ordem, principal').in('produto_id', ids).order('ordem', { ascending: true }),
  ])
  const nomePorId = new Map(((produtos ?? []) as { id: string; nome: string }[]).map(p => [p.id, p.nome]))
  const imgs = (imagens ?? []) as Img[]

  const semFoto: string[] = []
  const falharam: string[] = []
  const partes: ParteDaMontagem[] = []
  for (const c of componentes) {
    const nome = nomePorId.get(c.produtoId)
    if (!nome) continue // produto de outra empresa ou apagado
    const doProduto = imgs.filter(i => i.produto_id === c.produtoId)
    const escolhida = doProduto.find(i => i.id === c.imagemId) ?? doProduto.find(i => i.principal) ?? doProduto[0]
    if (!escolhida) { semFoto.push(nome); continue }
    if (partes.length >= MAX_COMPONENTES) continue
    try {
      partes.push({ imagem: await baixar(escolhida.url), quantidade: Number(c.quantidade) || 1 })
    } catch {
      falharam.push(nome)
    }
  }
  if (partes.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum componente tem foto que dê para usar.', semFoto, falharam }, { status: 400 })
  }

  let jpeg: Buffer
  try {
    jpeg = await montarImagemKit(partes, { selo: !!body.selo })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: 'Não foi possível montar a imagem: ' + (e as Error).message, semFoto, falharam }, { status: 400 })
  }

  if (!body.salvar) {
    return NextResponse.json({ ok: true, previa: `data:image/jpeg;base64,${jpeg.toString('base64')}`, usados: partes.length, semFoto, falharam })
  }

  const caminho = `${guarda.empresaId}/${body.kitId}/kit-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  const { error: erroUpload } = await sb.storage.from('produto-imagens')
    .upload(caminho, jpeg, { contentType: 'image/jpeg', upsert: false })
  if (erroUpload) return NextResponse.json({ ok: false, erro: erroUpload.message }, { status: 400 })
  const { data: pub } = sb.storage.from('produto-imagens').getPublicUrl(caminho)

  // Entra como a primeira (principal); as que já existiam descem uma posição.
  const { data: atuais } = await sb.from('produto_imagens').select('id, ordem')
    .eq('produto_id', body.kitId).order('ordem', { ascending: true })
  for (const [i, img] of ((atuais ?? []) as { id: string; ordem: number | null }[]).entries()) {
    await sb.from('produto_imagens').update({ ordem: i + 1, principal: false }).eq('id', img.id)
  }
  const { data: nova, error: erroIns } = await sb.from('produto_imagens').insert({
    empresa_id: guarda.empresaId, produto_id: body.kitId, url: pub.publicUrl, ordem: 0, principal: true,
  }).select('id, url, ordem, principal, titulo').single()
  if (erroIns) return NextResponse.json({ ok: false, erro: erroIns.message }, { status: 400 })
  await sb.from('produtos').update({ foto_url: pub.publicUrl }).eq('id', body.kitId).eq('empresa_id', guarda.empresaId)

  return NextResponse.json({ ok: true, imagem: nova, usados: partes.length, semFoto, falharam })
}
